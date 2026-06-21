// script.js
// Standalone test bench — drives the shared MotionEffect engine over a local
// or remote video, so you can dial in modes/settings without loading the
// extension.

const video = document.getElementById('src');
const out = document.getElementById('out');
const effect = MotionEffect.create(out);

const settings = { mode: 'motion', delay: 3, strength: 0.5, reveal: 0 };

// Populate the mode dropdown straight from the engine's MODES table.
const modeSel = document.getElementById('mode');
for (const [key, mode] of Object.entries(MotionEffect.MODES)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = mode.label;
  modeSel.appendChild(o);
}

function applySettings() {
  settings.mode = modeSel.value;
  settings.delay = +document.getElementById('delay').value;
  settings.strength = +document.getElementById('strength').value;
  document.getElementById('delayVal').textContent = settings.delay;
  document.getElementById('strengthVal').textContent = settings.strength.toFixed(2);
  effect.setSettings(settings);
}
for (const id of ['mode', 'delay', 'strength']) {
  document.getElementById(id).addEventListener('input', applySettings);
}
applySettings();

// "show source" hides the result canvas so you can compare with the raw video.
document.getElementById('showSource').addEventListener('change', e => {
  out.style.visibility = e.target.checked ? 'hidden' : 'visible';
});

function loadVideo(src) {
  video.src = src;
  video.play().catch(() => { /* autoplay may need a user gesture */ });
}
document.getElementById('load').addEventListener('click', () => {
  const file = document.getElementById('file').files[0];
  const url = document.getElementById('url').value.trim();
  if (file) loadVideo(URL.createObjectURL(file));
  else if (url) loadVideo(url);
  else alert('Pick a file or paste a URL first.');
});

let lastTime = -1;
function frame() {
  requestAnimationFrame(frame);
  if (video.readyState < 2) return;

  // Match the canvas's on-screen size to the video element.
  out.style.width = video.clientWidth + 'px';
  out.style.height = video.clientHeight + 'px';

  if (video.currentTime === lastTime) return;
  lastTime = video.currentTime;
  effect.render(video);
}
frame();
