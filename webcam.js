// webcam.js
// Minimal camera demo for the shared MotionEffect core — a starting point for a
// standalone / PWA build. Note how little glue there is: get a camera stream
// into a <video>, then call fx.render(video) every frame. The core is unchanged
// from the one the extension uses.

const $ = id => document.getElementById(id);
const cam = $('cam');
const out = $('out');
const fx = MotionEffect.create(out);

let facing = 'environment'; // 'environment' = back camera, 'user' = selfie

const settings = {
  mode: 'black', delaySeconds: 0.1,
  delayR: 0, delayG: 0.1, delayB: 0.2,
  strength: 0.5, reveal: 0, blur: 0, tint: 0, saturation: 1.4, frozen: false,
};

// Populate the mode dropdown from the core's MODES table.
for (const [key, mode] of Object.entries(MotionEffect.MODES)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = mode.label;
  $('mode').appendChild(o);
}
$('mode').value = settings.mode;

function sync() {
  settings.mode = $('mode').value;
  settings.delaySeconds = +$('delay').value;
  settings.delayR = +$('delayR').value;
  settings.delayG = +$('delayG').value;
  settings.delayB = +$('delayB').value;
  settings.saturation = +$('sat').value;
  settings.blur = +$('blur').value;

  $('delayVal').textContent = settings.delaySeconds.toFixed(2) + 's';
  $('satVal').textContent = Math.round(settings.saturation * 100) + '%';
  $('blurVal').textContent = settings.blur + 'px';

  const kind = (MotionEffect.MODES[settings.mode] || {}).kind;
  document.body.classList.toggle('is-rgb', kind === 'rgb');
  fx.setSettings(settings);
}

// reflect initial values onto the controls, then wire change handlers
$('delay').value = settings.delaySeconds;
$('delayR').value = settings.delayR;
$('delayG').value = settings.delayG;
$('delayB').value = settings.delayB;
$('sat').value = settings.saturation;
$('blur').value = settings.blur;
for (const id of ['mode', 'delay', 'delayR', 'delayG', 'delayB', 'sat', 'blur']) {
  $(id).addEventListener('input', sync);
}

async function startCamera() {
  if (cam.srcObject) cam.srcObject.getTracks().forEach(t => t.stop());
  cam.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing }, audio: false,
  });
  await cam.play();
  out.classList.toggle('mirror', facing === 'user'); // mirror the selfie view
}

$('go').addEventListener('click', async () => {
  try {
    await startCamera();
    $('start').hidden = true;
    $('bar').hidden = false;
    sync();
    loop();
  } catch (e) {
    alert('Could not start camera: ' + e.message);
  }
});

$('flip').addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch (e) { alert('Could not switch camera: ' + e.message); }
});

function loop() {
  requestAnimationFrame(loop);
  if (cam.readyState >= 2) fx.render(cam);
}
