// motionEffect.js
// Core, page-agnostic motion-extraction engine.
//
// A "method" (MODES) is a compositing pipeline; everything else is a numeric
// parameter. A "look" is therefore just a bundle of parameter values — see
// PRESETS for the built-in ones. Apps build their UI from MODES/PRESETS/DEFAULTS
// and let users tweak any parameter and save their own presets.
//
// Usage (same in the extension, the test bench, or a webcam PWA):
//   const fx = MotionEffect.create(outputCanvas);
//   fx.setSettings({ ...MotionEffect.DEFAULTS, ...preset.settings });
//   function loop(){ requestAnimationFrame(loop); if (src.readyState>=2) fx.render(src); }
//   loop();   // `src` can be a <video> (incl. a webcam stream), <img> or <canvas>
//
// Loads as a global (classic <script>) or via require() (CommonJS/bundlers).
// Never reads pixels back (no getImageData), so it works on cross-origin video.

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

  // Methods = the irreducible render pipelines. The look comes from the params.
  const MODES = {
    motion:   { label: 'Blend (invert + delay)', kind: 'overlay' },
    black:    { label: 'Difference',             kind: 'difference' },
    isolate:  { label: 'Matte on black',         kind: 'mask' },
    over:     { label: 'Glow on scene',          kind: 'glow' },
    rgb:      { label: 'RGB time-shift',         kind: 'rgb' },
    ghost:    { label: 'Vanishing (auto bg)',    kind: 'ghost' },
    anaglyph: { label: 'Direction',              kind: 'anaglyph' },
    history:  { label: 'Motion history',         kind: 'history' },
  };

  const DEFAULTS = {
    mode: 'motion',
    delaySeconds: 0.1,     // main time gap
    delayR: 0, delayG: 0.1, delayB: 0.2, // RGB per-channel delays
    grayscale: true,       // RGB: desaturate before shifting channels
    strength: 0.5,         // Blend: opacity of the inverted layer
    gain: 2.5,             // Matte/Glow/Vanishing: motion amplification
    memorySeconds: 2,      // Vanishing: how long until still things vanish
    decay: 0.02,           // History: trail fade per frame (higher = shorter)
    reveal: 0,             // fade the effect back over the original
    blur: 0,               // px (also bloom size for Glow)
    saturation: 1,         // 0 = mono, >1 = vivid
    brightness: 1,
    contrast: 1,
    tintHue: 0,            // 0..360
    tintAmount: 0,         // 0 = no recolour .. 1 = full
    frozen: false,         // compare against one frozen reference
  };

  // Built-in looks = a name + a partial settings bundle (merged onto DEFAULTS).
  const PRESETS = [
    { name: 'Motion (grey)',   settings: { mode: 'motion', delaySeconds: 0.1, strength: 0.5 } },
    { name: 'Mono',            settings: { mode: 'motion', delaySeconds: 0.1, strength: 0.5, saturation: 0 } },
    { name: 'Motion on black', settings: { mode: 'black', delaySeconds: 0.1, brightness: 1.4, contrast: 1.5, saturation: 1.6 } },
    { name: 'Moving on black', settings: { mode: 'isolate', delaySeconds: 0.15, gain: 3 } },
    { name: 'Glow on scene',   settings: { mode: 'over', delaySeconds: 0.15, gain: 3, blur: 5 } },
    { name: 'RGB rainbow',     settings: { mode: 'rgb', delayR: 0, delayG: 0.1, delayB: 0.2, grayscale: true, saturation: 1.6 } },
    { name: 'RGB colour',      settings: { mode: 'rgb', delayR: 0, delayG: 0.05, delayB: 0.1, grayscale: false } },
    { name: 'Vanishing act',   settings: { mode: 'ghost', memorySeconds: 2, gain: 3 } },
    { name: 'Direction',       settings: { mode: 'anaglyph', delaySeconds: 0.1 } },
    { name: 'Motion history',  settings: { mode: 'history', delaySeconds: 0.05, decay: 0.02, saturation: 1.6 } },
  ];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createMotionEffect(canvas) {
    const ctx = canvas.getContext('2d');

    let ring = [];            // [{ canvas, ctx, t }]
    let capacity = 0, writeIndex = 0, stored = 0, lastCapture = 0;
    let scratch = null, sctx = null;
    let reference = null, refCtx = null, refValid = false;
    let bg = null, bgCtx = null, bgSeeded = false;
    let hist = null, histCtx = null;
    let bufW = 0, bufH = 0, wasFrozen = false;

    const settings = Object.assign({}, DEFAULTS);

    const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

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
      while (ring.length < n) { const c = makeCanvas(bufW, bufH); ring.push({ canvas: c, ctx: c.getContext('2d'), t: 0 }); }
      capacity = ring.length;
    }

    function fstr(modeFilter) {
      let s = modeFilter && modeFilter !== 'none' ? modeFilter : '';
      if (settings.blur > 0) s += (s ? ' ' : '') + `blur(${settings.blur}px)`;
      return s || 'none';
    }

    function applyCanvasStyle() {
      let f = '';
      if (settings.brightness !== 1) f += `brightness(${settings.brightness}) `;
      if (settings.contrast !== 1) f += `contrast(${settings.contrast}) `;
      if (settings.saturation !== 1) f += `saturate(${settings.saturation}) `;
      if (settings.tintAmount > 0) {
        f += `sepia(${settings.tintAmount}) saturate(${1 + settings.tintAmount * 4}) hue-rotate(${settings.tintHue}deg) `;
      }
      canvas.style.filter = f.trim() || 'none';
      canvas.style.opacity = String(1 - settings.reveal);
    }

    function setSettings(next) {
      if (next) Object.assign(settings, next);
      if (!MODES[settings.mode]) settings.mode = 'motion';
      settings.delaySeconds = clamp(settings.delaySeconds, 0, MAX_DELAY_SECONDS);
      settings.delayR = clamp(settings.delayR, 0, MAX_DELAY_SECONDS);
      settings.delayG = clamp(settings.delayG, 0, MAX_DELAY_SECONDS);
      settings.delayB = clamp(settings.delayB, 0, MAX_DELAY_SECONDS);
      settings.strength = clamp(settings.strength, 0, 1);
      settings.gain = clamp(settings.gain, 0.2, 8);
      settings.memorySeconds = clamp(settings.memorySeconds, 0.1, MAX_DELAY_SECONDS);
      settings.decay = clamp(settings.decay, 0.002, 0.5);
      settings.reveal = clamp(settings.reveal, 0, 1);
      settings.blur = clamp(settings.blur, 0, 40);
      settings.saturation = clamp(settings.saturation, 0, 4);
      settings.brightness = clamp(settings.brightness, 0, 4);
      settings.contrast = clamp(settings.contrast, 0, 4);
      settings.tintHue = clamp(settings.tintHue, 0, 360);
      settings.tintAmount = clamp(settings.tintAmount, 0, 1);
      settings.grayscale = !!settings.grayscale;
      settings.frozen = !!settings.frozen;
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

    // greyscale |a - b| onto scratch (blur included); caller amplifies via gain
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
    }

    function render(video) {
      const vw = video.videoWidth || video.naturalWidth || video.width || 0;
      const vh = video.videoHeight || video.naturalHeight || video.height || 0;
      if (!vw || !vh) return;

      const ar = vw / vh;
      if (!bufW || Math.abs(ar - bufW / bufH) > 0.02) {
        const w = ar >= 1 ? BUFFER_LONG_SIDE : Math.round(BUFFER_LONG_SIDE * ar);
        const h = ar >= 1 ? Math.round(BUFFER_LONG_SIDE / ar) : BUFFER_LONG_SIDE;
        rebuild(Math.max(1, w), Math.max(1, h));
      }

      const mode = MODES[settings.mode] || MODES.motion;
      const isRgb = mode.kind === 'rgb';
      const now = performance.now();

      let needSec = 0;
      if (isRgb) needSec = Math.max(settings.delayR, settings.delayG, settings.delayB);
      else if (mode.kind !== 'ghost') needSec = settings.delaySeconds;
      ensureCapacity(Math.round(needSec * CAPTURE_HZ) + 2);

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

      const pickAt = sec => {
        if (sec <= 0 || stored === 0) return video;
        const target = now - sec * 1000;
        let best = entryAt(0), bestd = Math.abs(best.t - target);
        for (let k = 1; k < stored; k++) {
          const e = entryAt(k), d = Math.abs(e.t - target);
          if (d <= bestd) { bestd = d; best = e; } else break;
        }
        return best.canvas;
      };
      const delayed = () => (settings.frozen && refValid) ? reference : pickAt(settings.delaySeconds);
      const gain = `brightness(${settings.gain})`;

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (isRgb) {
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        addChannel(pickAt(settings.delayR), '#ff0000', settings.grayscale);
        addChannel(pickAt(settings.delayG), '#00ff00', settings.grayscale);
        addChannel(pickAt(settings.delayB), '#0000ff', settings.grayscale);
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
        ctx.filter = gain;
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else if (mode.kind === 'glow') {
        buildMatte(delayed(), video);
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = gain;
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else if (mode.kind === 'ghost') {
        const alpha = bgSeeded ? clamp(1 / (settings.memorySeconds * CAPTURE_HZ), 0.004, 1) : 1;
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
        ctx.filter = gain;
        ctx.drawImage(scratch, 0, 0, bufW, bufH);
      } else if (mode.kind === 'anaglyph') {
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        addChannel(delayed(), '#ff0000', true);
        addChannel(video, '#00ffff', true);
      } else if (mode.kind === 'history') {
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
        sctx.filter = fstr('none');
        sctx.clearRect(0, 0, bufW, bufH);
        sctx.drawImage(delayed(), 0, 0, bufW, bufH);
        sctx.globalCompositeOperation = 'difference';
        sctx.drawImage(video, 0, 0, bufW, bufH);
        histCtx.globalCompositeOperation = 'source-over';
        histCtx.filter = 'none';
        histCtx.globalAlpha = settings.decay;
        histCtx.fillStyle = '#000';
        histCtx.fillRect(0, 0, bufW, bufH);
        histCtx.globalAlpha = 1;
        histCtx.globalCompositeOperation = 'lighter';
        histCtx.drawImage(scratch, 0, 0, bufW, bufH);
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(hist, 0, 0, bufW, bufH);
      } else {
        ctx.filter = 'none';
        ctx.clearRect(0, 0, bufW, bufH);
        ctx.drawImage(video, 0, 0, bufW, bufH);
        const top = settings.frozen ? (refValid ? reference : null) : (stored > 0 ? pickAt(settings.delaySeconds) : null);
        if (top) {
          ctx.globalAlpha = settings.strength;
          ctx.filter = fstr('invert(1)');
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

  return { create: createMotionEffect, MODES, PRESETS, DEFAULTS, MAX_DELAY_SECONDS };
});
