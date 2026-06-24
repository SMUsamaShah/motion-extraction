// motionEffect.js
// Core, page-agnostic motion-extraction engine.
//
// Base technique (Posy, "Motion Extraction"): duplicate the footage, invert it,
// make it 50% transparent and shift it in time. Static cancels; motion remains.
//
// But almost every shot in the video uses a richer presentation than flat grey.
// Reviewing his frames, the looks are:
//   motion   - invert + delay, static averages to grey (the classic look)
//   black    - Difference blend: static is black, motion bright/coloured
//   isolate  - the moving subject shown in real colour over black (matte)
//   over     - motion added as a glow on top of the real (colour) scene
//   rgb      - red/green/blue delayed by different amounts; greyscale static,
//              rainbow motion (the turbines, iridescent clouds)
//   rgbcolor - same channel shift but keeping the real colours
// plus global Saturation (0 = mono ... >1 = vivid), Blur, Tint, Reveal, and a
// Freeze reference that works with every single-delay look.
//
// Implementation notes:
//   * Never reads pixels back (no getImageData) -> works on cross-origin video.
//     All looks are ctx.filter + globalCompositeOperation compositing.
//   * History is a ring of offscreen canvases; long delays store every Nth frame
//     (a stride) so memory stays bounded to MAX_FRAMES.

(function () {
  const MAX_FRAMES = 120;        // hard cap on buffered frames (memory bound)
  const BUFFER_LONG_SIDE = 854;  // cap buffer resolution (long side, px)
  const MAX_DELAY_SECONDS = 6;

  // kind drives the render path; base/overlay are ctx.filter strings for the
  // 'overlay' look; canvas is a CSS filter on the finished result; gray marks
  // whether the RGB shift desaturates first.
  const MODES = {
    motion:   { label: 'Motion (grey)',      kind: 'overlay',    base: 'none', overlay: 'invert(1)', canvas: 'none' },
    black:    { label: 'Motion on black',    kind: 'difference', canvas: 'brightness(1.4) contrast(1.5)' },
    isolate:  { label: 'Moving on black',    kind: 'mask',       canvas: 'none' },
    over:     { label: 'Glow on scene',      kind: 'glow',       canvas: 'none' },
    rgb:      { label: 'RGB shift (grey)',   kind: 'rgb', gray: true,  canvas: 'none' },
    rgbcolor: { label: 'RGB shift (colour)', kind: 'rgb', gray: false, canvas: 'none' },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createMotionEffect(canvas) {
    const ctx = canvas.getContext('2d');

    let ring = [];
    let capacity = 0;
    let writeIndex = 0;
    let stored = 0;
    let stride = 1;
    let sinceStore = 1e9;

    let scratch = null, sctx = null;     // for rgb / mask / glow compositing
    let reference = null, refCtx = null; // frozen reference frame
    let refValid = false;

    let bufW = 0, bufH = 0;
    let fps = 30, lastT = 0;
    let wasFrozen = false;

    const settings = {
      mode: 'motion',
      delaySeconds: 0.1,
      delayR: 0,      // RGB shift: per-channel delays (seconds)
      delayG: 0.1,
      delayB: 0.2,
      strength: 0.5,  // overlay blend (0.5 = clean cancellation)
      reveal: 0,      // 0 = pure effect; >0 lets the real video show through
      blur: 0,        // px
      tint: 0,        // hue degrees; 0 = no recolour
      saturation: 1,  // 0 = greyscale, 1 = normal, >1 = vivid
      frozen: false,
    };

    const makeCanvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };

    function rebuild(w, h) {
      bufW = w; bufH = h;
      ring = []; capacity = 0; writeIndex = 0; stored = 0; sinceStore = 1e9;
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

    // ctx.filter string: a mode filter plus the global blur.
    function fstr(modeFilter) {
      let s = modeFilter && modeFilter !== 'none' ? modeFilter : '';
      if (settings.blur > 0) s += (s ? ' ' : '') + `blur(${settings.blur}px)`;
      return s || 'none';
    }

    function applyCanvasStyle() {
      const mode = MODES[settings.mode] || MODES.motion;
      let f = mode.canvas === 'none' ? '' : mode.canvas;
      if (settings.saturation !== 1) f += (f ? ' ' : '') + `saturate(${settings.saturation})`;
      if (settings.tint > 0) f += (f ? ' ' : '') + `sepia(1) saturate(5) hue-rotate(${settings.tint}deg)`;
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
      settings.saturation = clamp(settings.saturation, 0, 4);

      if (settings.frozen && !wasFrozen) refValid = false; // (re)capture next frame
      wasFrozen = settings.frozen;
      applyCanvasStyle();
    }

    // k stored-slots back from the newest stored frame.
    const storedAt = k => ring[(writeIndex - 1 - k + capacity * 1000) % capacity];

    // Draw one channel of `src` tinted to a pure colour and add it to the output.
    // gray = desaturate first (rainbow on grey); otherwise keep real colours.
    function addChannel(src, colour, gray) {
      sctx.globalCompositeOperation = 'source-over';
      sctx.globalAlpha = 1;
      sctx.filter = gray ? fstr('grayscale(1)') : fstr('none');
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

      const t = performance.now();
      if (lastT) {
        const dt = t - lastT;
        if (dt > 0 && dt < 1000) fps = fps * 0.9 + (1000 / dt) * 0.1;
      }
      lastT = t;
      const efps = clamp(fps, 1, 120);

      const mode = MODES[settings.mode] || MODES.motion;
      const isRgb = mode.kind === 'rgb';

      // frame offsets this mode needs to reach into the past
      const rF = isRgb ? Math.round(settings.delayR * efps) : 0;
      const gF = isRgb ? Math.round(settings.delayG * efps) : 0;
      const bF = isRgb ? Math.round(settings.delayB * efps) : 0;
      const topF = isRgb ? 0 : Math.round(settings.delaySeconds * efps);

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

      // capture frozen reference if just enabled
      if (settings.frozen && !refValid) {
        refCtx.globalCompositeOperation = 'source-over';
        refCtx.filter = 'none';
        refCtx.drawImage(video, 0, 0, bufW, bufH);
        refValid = true;
      }

      const pickAt = frames => {
        if (frames <= 0) return video;
        const back = Math.round(frames / stride);
        return stored > back ? storedAt(back) : video;
      };
      // the delayed comparison frame, honouring Freeze (single-delay looks)
      const delayed = () => (settings.frozen && refValid) ? reference : pickAt(topF);
      const haveDelayed = () => settings.frozen ? refValid : stored > Math.round(topF / stride) || topF === 0;

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (isRgb) {
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        addChannel(pickAt(rF), '#ff0000', mode.gray);
        addChannel(pickAt(gF), '#00ff00', mode.gray);
        addChannel(pickAt(bF), '#0000ff', mode.gray);
      } else if (mode.kind === 'difference') {
        // |current - delayed|: black where nothing changed, bright/colour where it did
        ctx.filter = fstr('none');
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(delayed(), 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'difference';
        ctx.drawImage(video, 0, 0, bufW, bufH);
      } else if (mode.kind === 'mask') {
        // matte from the motion difference -> reveal the moving subject (real
        // colours) over black
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
        sctx.filter = fstr('none');
        sctx.clearRect(0, 0, bufW, bufH);
        sctx.drawImage(delayed(), 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'difference';
        sctx.drawImage(video, 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'copy';
        sctx.filter = 'grayscale(1)';
        sctx.drawImage(scratch, 0, 0, bufW, bufH);
        sctx.filter = 'none';
        sctx.globalCompositeOperation = 'lighter';
        sctx.drawImage(scratch, 0, 0, bufW, bufH);
        sctx.drawImage(scratch, 0, 0, bufW, bufH);

        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else if (mode.kind === 'glow') {
        // add the motion as a (blurred, brightened) glow on top of the real scene
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
        sctx.filter = fstr('none'); // blur here = bloom
        sctx.clearRect(0, 0, bufW, bufH);
        sctx.drawImage(delayed(), 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'difference';
        sctx.drawImage(video, 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'copy';
        sctx.filter = 'grayscale(1)';
        sctx.drawImage(scratch, 0, 0, bufW, bufH);
        sctx.filter = 'none';
        sctx.globalCompositeOperation = 'lighter';
        sctx.drawImage(scratch, 0, 0, bufW, bufH); // brighten the glow
        sctx.drawImage(scratch, 0, 0, bufW, bufH);

        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH); // sharp real scene
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else {
        // overlay: base = current frame, top = inverted delayed frame at strength
        ctx.filter = fstr(mode.base);
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        if (haveDelayed()) {
          ctx.globalAlpha = settings.strength;
          ctx.filter = fstr(mode.overlay);
          ctx.drawImage(delayed(), 0, 0, bufW, bufH);
        }
      }

      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
    }

    function reset() {
      stored = 0; writeIndex = 0; sinceStore = 1e9; refValid = false; lastT = 0;
    }

    setSettings();
    return { setSettings, render, reset, get settings() { return settings; } };
  }

  window.MotionEffect = { create: createMotionEffect, MODES, MAX_DELAY_SECONDS };
})();
