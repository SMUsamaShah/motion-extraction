// motionEffect.js
// Core, page-agnostic motion-extraction engine.
//
// The base technique (Posy, "Motion Extraction"): duplicate the footage,
// invert it, make it 50% transparent, and shift it in time. Where nothing
// changed between the two moments a colour and its inverse blend to flat grey
// and cancel; only motion survives.
//
// This engine also implements the variations he demonstrates:
//   * Delay in *seconds* (1 frame for fast motion ... 5+ seconds for slow
//     drift), via a time-based frame buffer.
//   * Freeze the duplicate  -> compare every frame to one frozen reference and
//     watch change accumulate over time.
//   * RGB time-shift         -> delay the red/green/blue channels by different
//     amounts (his 0/3/6 trick) for rainbow motion trails.
//   * Blur                   -> suppress fine detail so only larger motion shows.
//   * Tint                   -> recolour the (grey) motion to any hue.
//
// Implementation notes:
//   * We never call getImageData()/toDataURL(); drawing a cross-origin <video>
//     only "taints" the canvas, and we never read pixels back -> works on
//     cross-origin videos. Inversion/grayscale/blur use ctx.filter (GPU-side).
//   * History lives in a ring of offscreen canvases. For long delays we store
//     every Nth frame (a "stride") so memory stays bounded to MAX_FRAMES no
//     matter how long the delay.

(function () {
  const MAX_FRAMES = 120;        // hard cap on buffered frames (memory bound)
  const BUFFER_LONG_SIDE = 854;  // cap buffer resolution (long side, px)
  const MAX_DELAY_SECONDS = 6;

  // kind 'overlay' = the invert-and-delay technique (base + inverted top layer).
  // kind 'rgb'     = the channel time-shift technique (custom render path).
  //   base/overlay are ctx.filter strings; canvas is a CSS filter on the result.
  const MODES = {
    motion:  { label: 'Motion (colour)',  kind: 'overlay', base: 'none',         overlay: 'invert(1)',              canvas: 'none' },
    mono:    { label: 'Motion (mono)',    kind: 'overlay', base: 'grayscale(1)', overlay: 'grayscale(1) invert(1)', canvas: 'none' },
    boosted: { label: 'Motion (boosted)', kind: 'overlay', base: 'none',         overlay: 'invert(1)',              canvas: 'saturate(4) contrast(1.6)' },
    glow:    { label: 'Motion (glow)',    kind: 'overlay', base: 'none',         overlay: 'invert(1)',              canvas: 'contrast(1.4) brightness(1.3)' },
    black:   { label: 'Motion on black',  kind: 'difference', base: 'none',      overlay: 'none',                   canvas: 'brightness(1.5) contrast(1.7)' },
    isolate: { label: 'Moving on black',  kind: 'mask',       base: 'none',      overlay: 'none',                   canvas: 'none' },
    rgb:     { label: 'RGB time-shift',   kind: 'rgb',     base: 'none',         overlay: 'none',                   canvas: 'none' },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createMotionEffect(canvas) {
    const ctx = canvas.getContext('2d');

    // sparse ring of past frames (spacing = `stride` source frames)
    let ring = [];
    let capacity = 0;
    let writeIndex = 0;
    let stored = 0;
    let stride = 1;
    let sinceStore = 1e9;

    let scratch = null, sctx = null;          // for RGB channel compositing
    let reference = null, refCtx = null;      // frozen reference frame
    let refValid = false;

    let bufW = 0, bufH = 0;
    let fps = 30, lastT = 0;                   // estimated source frame rate
    let wasFrozen = false;

    const settings = {
      mode: 'motion',
      delaySeconds: 0.1,
      delayR: 0,       // RGB time-shift: per-channel delays (seconds)
      delayG: 0.1,
      delayB: 0.2,
      strength: 0.5,   // blend of the top layer (0.5 == clean cancellation)
      reveal: 0,       // 0 = pure effect; >0 lets the real video show through
      blur: 0,         // px
      tint: 0,         // hue degrees; 0 = no recolour
      frozen: false,
    };

    const makeCanvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };

    function rebuild(w, h) {
      bufW = w; bufH = h;
      ring = [];
      capacity = 0;
      writeIndex = 0;
      stored = 0;
      sinceStore = 1e9;
      scratch = makeCanvas(w, h); sctx = scratch.getContext('2d');
      reference = makeCanvas(w, h); refCtx = reference.getContext('2d');
      refValid = false;
      canvas.width = w; canvas.height = h;
    }

    function ensureCapacity(n) {
      n = Math.min(MAX_FRAMES, n);
      while (ring.length < n) ring.push(makeCanvas(bufW, bufH));
      capacity = ring.length;
    }

    function bufferSizeFor(srcW, srcH) {
      const scale = Math.min(1, BUFFER_LONG_SIDE / Math.max(srcW, srcH));
      return [Math.max(1, Math.round(srcW * scale)), Math.max(1, Math.round(srcH * scale))];
    }

    // Build a ctx.filter string from a mode filter plus the global blur.
    function fstr(modeFilter) {
      let s = modeFilter && modeFilter !== 'none' ? modeFilter : '';
      if (settings.blur > 0) s += (s ? ' ' : '') + `blur(${settings.blur}px)`;
      return s || 'none';
    }

    function applyCanvasStyle() {
      const mode = MODES[settings.mode] || MODES.motion;
      let f = mode.canvas === 'none' ? '' : mode.canvas;
      if (settings.tint > 0) {
        f += (f ? ' ' : '') + `sepia(1) saturate(5) hue-rotate(${settings.tint}deg)`;
      }
      canvas.style.filter = f || 'none';
      canvas.style.opacity = String(1 - settings.reveal);
    }

    function setSettings(next) {
      if (next) Object.assign(settings, next);
      settings.delaySeconds = clamp(settings.delaySeconds, 0, MAX_DELAY_SECONDS);
      settings.delayR = clamp(settings.delayR, 0, MAX_DELAY_SECONDS);
      settings.delayG = clamp(settings.delayG, 0, MAX_DELAY_SECONDS);
      settings.delayB = clamp(settings.delayB, 0, MAX_DELAY_SECONDS);
      settings.strength = clamp(settings.strength, 0, 1);
      settings.reveal = clamp(settings.reveal, 0, 1);
      settings.blur = clamp(settings.blur, 0, 40);
      settings.tint = clamp(settings.tint, 0, 360);

      if (settings.frozen && !wasFrozen) refValid = false; // (re)capture next frame
      wasFrozen = settings.frozen;

      applyCanvasStyle();
    }

    // k stored-slots back from the newest stored frame
    const storedAt = k => ring[(writeIndex - 1 - k + capacity * 1000) % capacity];

    // Draw the greyscale of `src` tinted to a pure channel colour and add it to
    // the output. Three of these (red=now, green/blue=delayed) make the RGB
    // time-shift: static stays grey (R=G=B), motion gains colour.
    function addChannel(src, colour) {
      sctx.globalCompositeOperation = 'source-over';
      sctx.globalAlpha = 1;
      sctx.filter = fstr('grayscale(1)');
      sctx.clearRect(0, 0, bufW, bufH);
      sctx.drawImage(src, 0, 0, bufW, bufH);
      sctx.filter = 'none';
      sctx.globalCompositeOperation = 'multiply';
      sctx.fillStyle = colour;
      sctx.fillRect(0, 0, bufW, bufH);

      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(scratch, 0, 0, bufW, bufH);
    }

    function render(video) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;

      const [w, h] = bufferSizeFor(vw, vh);
      if (w !== bufW || h !== bufH) rebuild(w, h);

      // estimate frame rate (render runs once per new video frame)
      const t = performance.now();
      if (lastT) {
        const dt = t - lastT;
        if (dt > 0 && dt < 1000) fps = fps * 0.9 + (1000 / dt) * 0.1;
      }
      lastT = t;
      const efps = clamp(fps, 1, 120);

      const mode = MODES[settings.mode] || MODES.motion;

      // frame offsets this mode needs to reach into the past
      const isRgb = mode.kind === 'rgb';
      const rF = isRgb ? Math.round(settings.delayR * efps) : 0;
      const gF = isRgb ? Math.round(settings.delayG * efps) : 0;
      const bF = isRgb ? Math.round(settings.delayB * efps) : 0;
      const topF = isRgb ? 0 : Math.round(settings.delaySeconds * efps);

      // pick a storage stride so the buffer never exceeds MAX_FRAMES
      const maxBack = Math.max(rF, gF, bF, topF);
      const newStride = Math.max(1, Math.ceil(maxBack / (MAX_FRAMES - 1)));
      if (newStride !== stride) { stride = newStride; stored = 0; writeIndex = 0; sinceStore = 1e9; }
      ensureCapacity(Math.floor(maxBack / stride) + 2);

      // capture the raw current frame into the sparse ring
      if (++sinceStore >= stride) {
        const sc = ring[writeIndex].getContext('2d');
        sc.globalCompositeOperation = 'source-over';
        sc.filter = 'none';
        sc.drawImage(video, 0, 0, bufW, bufH);
        writeIndex = (writeIndex + 1) % capacity;
        if (stored < capacity) stored++;
        sinceStore = 0;
      }

      // capture the frozen reference if just enabled
      if (settings.frozen && !refValid) {
        refCtx.globalCompositeOperation = 'source-over';
        refCtx.filter = 'none';
        refCtx.drawImage(video, 0, 0, bufW, bufH);
        refValid = true;
      }

      // a source frame `frames` behind now (live video when 0 or not yet buffered)
      const pickAt = frames => {
        if (frames <= 0) return video;
        const back = Math.round(frames / stride);
        return stored > back ? storedAt(back) : video;
      };

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (isRgb) {
        // each channel from its own moment -> static stays grey, motion gains colour
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        addChannel(pickAt(rF), '#ff0000'); // red
        addChannel(pickAt(gF), '#00ff00'); // green
        addChannel(pickAt(bF), '#0000ff'); // blue
      } else if (mode.kind === 'difference') {
        // |current - delayed|: black where nothing changed, bright where it did
        const delayed = pickAt(topF);
        ctx.filter = fstr('none');
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(delayed, 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'difference';
        ctx.drawImage(video, 0, 0, bufW, bufH);
      } else if (mode.kind === 'mask') {
        // use the motion difference as a matte to reveal the moving subject
        // (in its real colours) over black
        const delayed = pickAt(topF);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
        sctx.filter = fstr('none');
        sctx.clearRect(0, 0, bufW, bufH);
        sctx.drawImage(delayed, 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'difference';
        sctx.drawImage(video, 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'copy';   // collapse the matte to luminance
        sctx.filter = 'grayscale(1)';
        sctx.drawImage(scratch, 0, 0, bufW, bufH);
        sctx.filter = 'none';
        sctx.globalCompositeOperation = 'lighter'; // amplify so real motion fully reveals
        sctx.drawImage(scratch, 0, 0, bufW, bufH);
        sctx.drawImage(scratch, 0, 0, bufW, bufH);

        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = fstr('none');
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'multiply'; // keep the frame only inside the matte
        ctx.filter = 'none';
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else {
        // base layer: the current frame (freshest, straight from the video)
        ctx.filter = fstr(mode.base);
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);

        // top layer: inverted delayed (or frozen) frame at `strength`
        let top = null;
        if (settings.frozen) {
          top = refValid ? reference : null;
        } else {
          const back = Math.round(topF / stride);
          if (stored > back) top = storedAt(back);
        }
        if (top) {
          ctx.globalAlpha = settings.strength;
          ctx.filter = fstr(mode.overlay);
          ctx.drawImage(top, 0, 0, bufW, bufH);
        }
      }

      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
    }

    function reset() {
      stored = 0; writeIndex = 0; sinceStore = 1e9; refValid = false; lastT = 0;
    }

    setSettings(); // apply defaults to the canvas element
    return { setSettings, render, reset, get settings() { return settings; } };
  }

  window.MotionEffect = { create: createMotionEffect, MODES, MAX_DELAY_SECONDS };
})();
