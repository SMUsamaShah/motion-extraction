// motionEffect.js
// Core, page-agnostic motion-extraction engine.
//
// The technique (from Posy's "Motion Extraction" video):
//   Take the footage, duplicate it, invert the duplicate's colours, set it to
//   50% strength and lay it back on top of the original, offset by a few frames
//   in time. Wherever nothing moved between the two moments a colour and its
//   inverse blend to flat grey and cancel out; only the parts that changed
//   (i.e. motion) survive, standing out against the grey.
//
// Why it's built this way:
//   * We never call getImageData()/toDataURL(). Drawing a cross-origin <video>
//     to a canvas "taints" it, but only *reading pixels back* throws — and we
//     never read back. So the effect works on cross-origin videos (most of the
//     web), which the old per-pixel version could not.
//   * Inversion / desaturation is done with ctx.filter (GPU-friendly) instead
//     of a per-pixel JS loop.
//   * Past frames live in a small ring of offscreen canvases so the delayed
//     frame is a cheap lookup. The ring only grows to the chosen delay, so
//     memory stays bounded (the old code allocated ~1.6 GB at 1080p).

(function () {
  const MAX_DELAY = 60;          // upper bound for the delay control (frames)
  const BUFFER_LONG_SIDE = 960;  // cap offscreen buffer resolution (memory/perf)

  // Each mode describes how the two layers are filtered and how the finished
  // canvas is post-processed. This is the place to add new looks — see README.
  //   base:    filter applied to the current frame (bottom layer)
  //   overlay: filter applied to the delayed frame (top layer). Must include
  //            invert(1) for the cancellation to work.
  //   canvas:  CSS filter applied to the whole result (post-processing)
  const MODES = {
    motion:  { label: 'Motion (colour)',  base: 'none',         overlay: 'invert(1)',              canvas: 'none' },
    mono:    { label: 'Motion (mono)',    base: 'grayscale(1)', overlay: 'grayscale(1) invert(1)', canvas: 'none' },
    boosted: { label: 'Motion (boosted)', base: 'none',         overlay: 'invert(1)',              canvas: 'saturate(4) contrast(1.6)' },
    glow:    { label: 'Motion (glow)',    base: 'none',         overlay: 'invert(1)',              canvas: 'contrast(1.4) brightness(1.3)' },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createMotionEffect(canvas) {
    const ctx = canvas.getContext('2d');

    let ring = [];          // ring buffer of offscreen frame canvases
    let writeIndex = 0;     // next slot to write into
    let filled = 0;         // how many slots hold a real frame
    let bufW = 0, bufH = 0; // current buffer resolution

    const settings = {
      mode: 'motion',
      delay: 3,       // frames between the two copies
      strength: 0.5,  // blend of the inverted layer (0.5 == clean cancellation)
      reveal: 0,      // 0 = pure effect; >0 lets the real video show through
    };

    function ensureBuffers(srcW, srcH) {
      // Size buffers from the source, capped to BUFFER_LONG_SIDE for memory.
      const scale = Math.min(1, BUFFER_LONG_SIDE / Math.max(srcW, srcH));
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));
      const needed = settings.delay + 1;
      if (w === bufW && h === bufH && ring.length >= needed) return;

      bufW = w; bufH = h;
      ring = [];
      for (let i = 0; i < needed; i++) {
        const c = document.createElement('canvas');
        c.width = bufW; c.height = bufH;
        ring.push(c);
      }
      writeIndex = 0;
      filled = 0;
      canvas.width = bufW;
      canvas.height = bufH;
    }

    function setSettings(next) {
      if (next) Object.assign(settings, next);
      settings.delay = clamp(Math.round(settings.delay), 0, MAX_DELAY);
      settings.strength = clamp(settings.strength, 0, 1);
      settings.reveal = clamp(settings.reveal, 0, 1);

      const mode = MODES[settings.mode] || MODES.motion;
      canvas.style.filter = mode.canvas;
      canvas.style.opacity = String(1 - settings.reveal);

      // Grow the ring if the delay increased (shrinking just uses fewer slots).
      if (bufW && settings.delay + 1 > ring.length) ensureBuffers(bufW, bufH);
    }

    function render(video) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      ensureBuffers(vw, vh);

      // 1. Capture the current frame into the ring.
      ring[writeIndex].getContext('2d').drawImage(video, 0, 0, bufW, bufH);
      writeIndex = (writeIndex + 1) % ring.length;
      if (filled < ring.length) filled++;

      const mode = MODES[settings.mode] || MODES.motion;
      const curIdx = (writeIndex - 1 + ring.length) % ring.length;
      const delayIdx = (writeIndex - 1 - settings.delay + ring.length * 2) % ring.length;

      // 2. Base layer: the current frame.
      ctx.globalAlpha = 1;
      ctx.filter = mode.base;
      ctx.clearRect(0, 0, bufW, bufH);
      ctx.drawImage(ring[curIdx], 0, 0);

      // 3. Top layer: the inverted, delayed frame at `strength`.
      //    Skip until the delayed slot actually holds a frame, otherwise the
      //    warm-up would invert against a blank (transparent) canvas.
      if (filled > settings.delay) {
        ctx.globalAlpha = settings.strength;
        ctx.filter = mode.overlay;
        ctx.drawImage(ring[delayIdx], 0, 0);
      }

      ctx.globalAlpha = 1;
      ctx.filter = 'none';
    }

    function reset() {
      writeIndex = 0;
      filled = 0;
    }

    setSettings(); // apply defaults to the canvas element up front

    return {
      setSettings,
      render,
      reset,
      get settings() { return settings; },
    };
  }

  window.MotionEffect = { create: createMotionEffect, MODES, MAX_DELAY };
})();
