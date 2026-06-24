// webcam.js
// Minimal camera demo for the shared MotionEffect core — a starting point for a
// standalone / PWA build. Presets come from the core; the bottom bar exposes a
// handful of controls for live tweaking (the rest come from the chosen preset).

const $ = id => document.getElementById(id);
const cam = $('cam');
const out = $('out');
const fx = MotionEffect.create(out);

let facing = 'environment';
let state = { ...MotionEffect.DEFAULTS };

// preset + method dropdowns from the core
MotionEffect.PRESETS.forEach((p, i) => $('preset').add(new Option(p.name, i)));
for (const key in MotionEffect.MODES) $('mode').add(new Option(MotionEffect.MODES[key].label, key));

// bottom-bar controls -> setting keys
const FIELDS = [
  { id: 'delay', key: 'delaySeconds', fmt: v => (+v).toFixed(2) + 's' },
  { id: 'delayR', key: 'delayR' }, { id: 'delayG', key: 'delayG' }, { id: 'delayB', key: 'delayB' },
  { id: 'sat', key: 'saturation', fmt: v => Math.round(v * 100) + '%' },
  { id: 'blur', key: 'blur', fmt: v => v + 'px' },
];

function reflect() {
  $('mode').value = state.mode;
  for (const f of FIELDS) {
    $(f.id).value = state[f.key];
    if (f.fmt) $(f.id + 'Val').textContent = f.fmt(state[f.key]);
  }
  document.body.classList.toggle('is-rgb', state.mode === 'rgb');
  fx.setSettings(state);
}

$('preset').addEventListener('change', () => {
  const p = MotionEffect.PRESETS[+$('preset').value];
  if (p) { state = Object.assign({ ...MotionEffect.DEFAULTS }, p.settings); reflect(); }
});
$('mode').addEventListener('change', () => { state.mode = $('mode').value; reflect(); });
for (const f of FIELDS) {
  $(f.id).addEventListener('input', () => {
    state[f.key] = +$(f.id).value;
    if (f.fmt) $(f.id + 'Val').textContent = f.fmt(state[f.key]);
    fx.setSettings(state);
  });
}

async function startCamera() {
  if (cam.srcObject) cam.srcObject.getTracks().forEach(t => t.stop());
  cam.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
  await cam.play();
  out.classList.toggle('mirror', facing === 'user');
}

$('go').addEventListener('click', async () => {
  try {
    await startCamera();
    $('start').hidden = true;
    $('bar').hidden = false;
    // start on a nice preset
    state = Object.assign({ ...MotionEffect.DEFAULTS }, MotionEffect.PRESETS[2].settings); // Motion on black
    $('preset').value = '2';
    reflect();
    loop();
  } catch (e) { alert('Could not start camera: ' + e.message); }
});

$('flip').addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch (e) { alert('Could not switch camera: ' + e.message); }
});

function loop() {
  requestAnimationFrame(loop);
  if (cam.readyState >= 2) fx.render(cam);
}
