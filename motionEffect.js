// motionEffect.js
// Core, page-agnostic motion-extraction engine.
//
// Base technique (Posy, "Motion Extraction"): duplicate the footage, invert it,
// make it 50% transparent and shift it in time. Static cancels; motion remains.
// Reviewing his frames, most shots use a richer presentation than flat grey, so
// the looks are organised as modes (see MODES) plus global Saturation/Blur/Tint.
//
// Usage (same in the extension, the test bench, or a webcam PWA):
//   const fx = MotionEffect.create(outputCanvas);
//   fx.setSettings({ mode: 'black', delaySeconds: 0.1, saturation: 1.5 });
//   function loop(){ requestAnimationFrame(loop); if (src.readyState>=2) fx.render(src); }
//   loop();   // `src` can be a <video> (incl. a webcam stream), <img> or <canvas>
//
// Loads as a global (classic <script>) or via require() (CommonJS/bundlers).
//
// Implementation notes:
//   * Never reads pixels back (no getImageData) -> works on cross-origin video.
//     Every look is ctx.filter + globalCompositeOperation compositing.
//   * Past frames are kept in a ring of offscreen canvases, each stamped with a
//     capture time. Frames are captured at a fixed cadence (CAPTURE_HZ) so memory
//     is bounded regardless of source fps, and the delayed frame is found by
//     timestamp -> delay-in-seconds is accurate and changing it never resets the
//     buffer (no flash). Looking further back than we've buffered clamps to the
//     oldest frame, so long delays deepen gradually instead of blacking out.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MotionEffect = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CAPTURE_HZ = 30;         // frames captured per second (caps memory/cost)
  const MAX_FRAMES = 160;        // hard cap on buffered frames
  const BUFFER_LONG_SIDE = 800;  // cap buffer resolution (long side, px)
  const MAX_DELAY_SECONDS = 5;

  // kind drives the render path; base/overlay are ctx.filter strings (overlay
  // look); canvas is a CSS filter on the result; gray = desaturate the RGB shift.
  const MODES = {
    motion:   { label: 'Motion (grey)',      kind: 'overlay',    base: 'none', overlay: 'invert(1)', canvas: 'none' },
    black:    { label: 'Motion on black',    kind: 'difference', canvas: 'brightness(1.4) contrast(1.5)' },
    isolate:  { label: 'Moving on black',    kind: 'mask',       canvas: 'none' },
    over:     { label: 'Glow on scene',      kind: 'glow',       canvas: 'none' },
    rgb:      { label: 'RGB shift (grey)',   kind: 'rgb', gray: true,  canvas: 'none' },
    rgbcolor: { label: 'RGB shift (colour)', kind: 'rgb', gray: false, canvas: 'none' },
    ghost:    { label: 'Vanishing act',      kind: 'ghost',      canvas: 'none' },
    anaglyph: { label: 'Direction (colour)', kind: 'anaglyph',   canvas: 'none' },
    history:  { label: 'Motion history',     kind: 'history',    canvas: 'none' },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createMotionEffect(canvas) {
    const ctx = canvas.getContext('2d');

    let ring = [];            // [{ canvas, ctx, t }] newest at writeIndex-1
    let capacity = 0;
    let writeIndex = 0;
    let stored = 0;
    let lastCapture = 0;

    let scratch = null, sctx = null;       // rgb / mask / glow / ghost / history scratch
    let reference = null, refCtx = null;   // frozen reference
    let refValid = false;
    let bg = null, bgCtx = null, bgSeeded = false; // running-average background (ghost)
    let hist = null, histCtx = null;       // accumulating motion map (history)

    let bufW = 0, bufH = 0;
    let wasFrozen = false;

    const settings = {
      mode: 'motion',
      delaySeconds: 0.1,
      delayR: 0, delayG: 0.1, delayB: 0.2,
      strength: 0.5,
      reveal: 0,
      blur: 0,
      tint: 0,
      saturation: 1,
      frozen: false,
    };

    const makeCanvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };

    function rebuild(w, h) {
      bufW = w; bufH = h;
      ring = []; capacity = 0; writeIndex = 0; stored = 0; lastCapture = 0;
      scratch = makeCanvas(w, h); sctx = scratch.getContext('2d');
      reference = makeCanvas(w, h); refCtx = reference.getContext('2d'); refValid = false;
      bg = makeCanvas(w, h); bgCtx = bg.getContext('2d'); bgSeeded = false;
      hist = makeCanvas(w, h); histCtx = hist.getContext('2d');
      canvas.width = w; canvas.height = h;
    }

    function ensureCapacity(n) {
      n = Math.min(MAX_FRAMES, Math.max(2, n));
      while (ring.length < n) {
        const c = makeCanvas(bufW, bufH);
        ring.push({ canvas: c, ctx: c.getContext('2d'), t: 0 });
      }
      capacity = ring.length;
    }

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
      if (settings.frozen && !wasFrozen) refValid = false;
      wasFrozen = settings.frozen;
      applyCanvasStyle();
    }

    const entryAt = k => ring[(writeIndex - 1 - k + capacity * 1000) % capacity];

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

    // build a greyscale, brightened motion matte from |a - b| onto scratch
    function buildMatte(a, b) {
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = 'source-over';
      sctx.filter = fstr('none');
      sctx.clearRect(0, 0, bufW, bufH);
      sctx.drawImage(a, 0, 0, bufW, bufH);
      sctx.globalCompositeOperation = 'difference';
      sctx.drawImage(b, 0, 0, bufW, bufH);
      sctx.globalCompositeOperation = 'copy';
      sctx.filter = 'grayscale(1)';
      sctx.drawImage(scratch, 0, 0, bufW, bufH);
      sctx.filter = 'none';
      sctx.globalCompositeOperation = 'lighter';
      sctx.drawImage(scratch, 0, 0, bufW, bufH);
      sctx.drawImage(scratch, 0, 0, bufW, bufH);
    }

    function render(video) {
      // `video` is anything drawImage accepts: <video> (incl. webcam), <img>, <canvas>
      const vw = video.videoWidth || video.naturalWidth || video.width || 0;
      const vh = video.videoHeight || video.naturalHeight || video.height || 0;
      if (!vw || !vh) return;

      // only rebuild on aspect change, so a resolution/quality switch doesn't flash
      const ar = vw / vh;
      if (!bufW || Math.abs(ar - bufW / bufH) > 0.02) {
        const w = ar >= 1 ? BUFFER_LONG_SIDE : Math.round(BUFFER_LONG_SIDE * ar);
        const h = ar >= 1 ? Math.round(BUFFER_LONG_SIDE / ar) : BUFFER_LONG_SIDE;
        rebuild(Math.max(1, w), Math.max(1, h));
      }

      const mode = MODES[settings.mode] || MODES.motion;
      const isRgb = mode.kind === 'rgb';
      const now = performance.now();

      // grow ring to the deepest delay this mode needs (ghost uses bg, not ring)
      let needSec = 0;
      if (isRgb) needSec = Math.max(settings.delayR, settings.delayG, settings.delayB);
      else if (mode.kind !== 'ghost') needSec = settings.delaySeconds;
      ensureCapacity(Math.round(needSec * CAPTURE_HZ) + 2);

      // capture the current frame at a fixed cadence (timestamped)
      if (now - lastCapture >= 1000 / CAPTURE_HZ) {
        const e = ring[writeIndex];
        e.ctx.globalCompositeOperation = 'source-over';
        e.ctx.filter = 'none';
        e.ctx.drawImage(video, 0, 0, bufW, bufH);
        e.t = now;
        writeIndex = (writeIndex + 1) % capacity;
        if (stored < capacity) stored++;
        lastCapture = now;
      }

      if (settings.frozen && !refValid) {
        refCtx.globalCompositeOperation = 'source-over';
        refCtx.filter = 'none';
        refCtx.drawImage(video, 0, 0, bufW, bufH);
        refValid = true;
      }

      // frame ~`sec` seconds ago, found by timestamp and clamped to the oldest
      // frame we have (so long delays deepen gradually rather than blacking out)
      const pickAt = sec => {
        if (sec <= 0 || stored === 0) return video;
        const target = now - sec * 1000;
        let best = entryAt(0), bestd = Math.abs(best.t - target);
        for (let k = 1; k < stored; k++) {
          const e = entryAt(k);
          const d = Math.abs(e.t - target);
          if (d <= bestd) { bestd = d; best = e; } else break;
        }
        return best.canvas;
      };
      const delayed = () => (settings.frozen && refValid) ? reference : pickAt(settings.delaySeconds);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (isRgb) {
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        addChannel(pickAt(settings.delayR), '#ff0000', mode.gray);
        addChannel(pickAt(settings.delayG), '#00ff00', mode.gray);
        addChannel(pickAt(settings.delayB), '#0000ff', mode.gray);
      } else if (mode.kind === 'difference') {
        ctx.filter = fstr('none');
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(delayed(), 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'difference';
        ctx.drawImage(video, 0, 0, bufW, bufH);
      } else if (mode.kind === 'mask') {
        buildMatte(delayed(), video);
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else if (mode.kind === 'glow') {
        buildMatte(delayed(), video);
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH); // sharp real scene
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(scratch, 0, 0, bufW, bufH); // glow added on top
      } else if (mode.kind === 'ghost') {
        // self-healing background: a running average that absorbs anything that
        // holds still. Show the moving subject (real colour) over black; hold
        // still and you dissolve into the background and vanish.
        const memSec = Math.max(0.2, settings.delaySeconds);
        const alpha = bgSeeded ? clamp(1 / (memSec * CAPTURE_HZ), 0.004, 1) : 1;
        bgCtx.globalCompositeOperation = 'source-over';
        bgCtx.filter = 'none';
        bgCtx.globalAlpha = alpha;
        bgCtx.drawImage(video, 0, 0, bufW, bufH);
        bgCtx.globalAlpha = 1;
        bgSeeded = true;

        buildMatte(bg, video);
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else if (mode.kind === 'anaglyph') {
        // past -> red, present -> cyan: the colour of a moving edge tells you
        // which way it moved (static stays grey).
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        addChannel(delayed(), '#ff0000', true);
        addChannel(video, '#00ffff', true);
      } else if (mode.kind === 'history') {
        // accumulate the motion signal with slow decay -> a map of where motion
        // has happened (paths, trails) rather than a long exposure of light.
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
        sctx.filter = fstr('none');
        sctx.clearRect(0, 0, bufW, bufH);
        sctx.drawImage(delayed(), 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'difference';
        sctx.drawImage(video, 0, 0, bufW, bufH);

        histCtx.globalCompositeOperation = 'source-over';
        histCtx.filter = 'none';
        histCtx.globalAlpha = 0.02;          // fade the map (~1.5s memory)
        histCtx.fillStyle = '#000';
        histCtx.fillRect(0, 0, bufW, bufH);
        histCtx.globalAlpha = 1;
        histCtx.globalCompositeOperation = 'lighter';
        histCtx.drawImage(scratch, 0, 0, bufW, bufH);

        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(hist, 0, 0, bufW, bufH);
      } else {
        // overlay: base = current frame, top = inverted delayed frame at strength
        ctx.filter = fstr(mode.base);
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        const top = settings.frozen ? (refValid ? reference : null)
                                    : (stored > 0 ? pickAt(settings.delaySeconds) : null);
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
      stored = 0; writeIndex = 0; lastCapture = 0; refValid = false; bgSeeded = false;
      if (bgCtx) bgCtx.clearRect(0, 0, bufW, bufH);
      if (histCtx) histCtx.clearRect(0, 0, bufW, bufH);
    }

    setSettings();
    return { setSettings, render, reset, get settings() { return settings; } };
  }

  return { create: createMotionEffect, MODES, MAX_DELAY_SECONDS };
});
