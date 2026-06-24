// contentScript.js
// Page integration layer. Finds the video, lays a canvas over it, drives the
// MotionEffect engine (from motionEffect.js, injected just before this file),
// and responds to control messages from the popup.
//
// It does NO work until the popup tells it to start, so leaving it injected on
// every page is cheap.

(function () {
  const OVERLAY_ID = '__motionExtractionOverlay';

  let effect = null;
  let overlay = null;
  let video = null;
  let rafId = null;
  let running = false;
  let lastTime = -1;

  // Pick the largest video that actually has pixels — handles pages with
  // several <video> elements (ads, thumbnails, the real player).
  function pickVideo() {
    const playable = Array.from(document.querySelectorAll('video'))
      .filter(v => v.videoWidth > 0 && v.videoHeight > 0)
      .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);
    return playable[0] || document.querySelector('video') || null;
  }

  function makeOverlay() {
    const c = document.createElement('canvas');
    c.id = OVERLAY_ID;
    Object.assign(c.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      margin: '0',
      padding: '0',
      pointerEvents: 'none',          // never swallow clicks on the page
      zIndex: '2147483646',
    });
    document.documentElement.appendChild(c);
    return c;
  }

  // Keep the overlay aligned with the video every frame so it follows scroll,
  // resize and layout changes. In fullscreen the overlay must be a descendant
  // of the fullscreen element or it won't render, so re-parent as needed.
  function positionOverlay() {
    if (!overlay || !video) return;
    const r = video.getBoundingClientRect();

    const fs = document.fullscreenElement;
    const parent = fs && fs.contains(video) ? fs : document.documentElement;
    if (overlay.parentElement !== parent) parent.appendChild(overlay);

    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    overlay.style.display = r.width && r.height ? 'block' : 'none';
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);

    if (!video || !video.isConnected) {
      video = pickVideo();
      if (!video) return;
    }
    if (video.readyState < 2) return; // no current frame yet

    positionOverlay();

    if (video.currentTime === lastTime) return; // same frame, nothing new
    lastTime = video.currentTime;
    effect.render(video);
  }

  function start(settings) {
    video = pickVideo();
    if (!video) return { ok: false, error: 'No playing <video> found on this page.' };

    if (!overlay) overlay = makeOverlay();
    if (!effect) effect = window.MotionEffect.create(overlay);
    if (settings) effect.setSettings(settings);

    running = true;
    overlay.style.display = 'block';
    if (rafId === null) loop();
    return { ok: true };
  }

  function stop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (overlay) overlay.style.display = 'none';
    if (effect) effect.reset();
    lastTime = -1;
    return { ok: true };
  }

  function modeList() {
    const modes = (window.MotionEffect && window.MotionEffect.MODES) || {};
    return Object.keys(modes).map(k => [k, modes[k].label, modes[k].kind]);
  }

  window.addEventListener('fullscreenchange', positionOverlay, true);

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    switch (req && req.type) {
      case 'mx-start':
        sendResponse(start(req.settings));
        break;
      case 'mx-stop':
        sendResponse(stop());
        break;
      case 'mx-update':
        if (effect) effect.setSettings(req.settings);
        sendResponse({ ok: running });
        break;
      case 'mx-status':
        sendResponse({
          ok: true,
          running,
          modes: modeList(),
          presets: (window.MotionEffect && window.MotionEffect.PRESETS) || null,
          defaults: (window.MotionEffect && window.MotionEffect.DEFAULTS) || null,
        });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
    return true;
  });
})();
