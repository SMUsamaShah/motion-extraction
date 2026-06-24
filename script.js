// script.js
// Standalone test bench — same controls + presets as the extension, driving the
// shared MotionEffect core directly. User presets persist in localStorage.

const video = document.getElementById('src');
const out = document.getElementById('out');
const fx = MotionEffect.create(out);
const $ = id => document.getElementById(id);

const FIELDS = [
  { id: 'delay', key: 'delaySeconds', fmt: v => (+v).toFixed(2) + ' s' },
  { id: 'delayR', key: 'delayR', fmt: v => (+v).toFixed(2) + ' s' },
  { id: 'delayG', key: 'delayG', fmt: v => (+v).toFixed(2) + ' s' },
  { id: 'delayB', key: 'delayB', fmt: v => (+v).toFixed(2) + ' s' },
  { id: 'grayscale', key: 'grayscale', bool: true },
  { id: 'strength', key: 'strength', fmt: v => (+v).toFixed(2) },
  { id: 'gain', key: 'gain', fmt: v => (+v).toFixed(1) + '×' },
  { id: 'memorySeconds', key: 'memorySeconds', fmt: v => (+v).toFixed(1) + ' s' },
  { id: 'decay', key: 'decay', fmt: v => (+v).toFixed(3) },
  { id: 'frozen', key: 'frozen', bool: true },
  { id: 'saturation', key: 'saturation', fmt: v => Math.round(v * 100) + '%' },
  { id: 'brightness', key: 'brightness', fmt: v => (+v).toFixed(2) },
  { id: 'contrast', key: 'contrast', fmt: v => (+v).toFixed(2) },
  { id: 'blur', key: 'blur', fmt: v => v + ' px' },
  { id: 'tintHue', key: 'tintHue', fmt: v => v + '°' },
  { id: 'tintAmount', key: 'tintAmount', fmt: v => (+v === 0 ? 'off' : Math.round(v * 100) + '%') },
  { id: 'reveal', key: 'reveal', fmt: v => (+v).toFixed(2) },
];

const defaults = MotionEffect.DEFAULTS;
const builtins = MotionEffect.PRESETS;
let userPresets = JSON.parse(localStorage.getItem('mxPresets') || '[]');
let state = { ...defaults };
const presetSel = $('preset');

for (const key in MotionEffect.MODES) $('mode').add(new Option(MotionEffect.MODES[key].label, key));

function fillPresets() {
  presetSel.innerHTML = '';
  presetSel.add(new Option('— custom —', ''));
  const g1 = document.createElement('optgroup'); g1.label = 'Presets';
  builtins.forEach((p, i) => g1.appendChild(new Option(p.name, 'b:' + i)));
  presetSel.appendChild(g1);
  if (userPresets.length) {
    const g2 = document.createElement('optgroup'); g2.label = 'Saved';
    userPresets.forEach(p => g2.appendChild(new Option(p.name, 'u:' + p.name)));
    presetSel.appendChild(g2);
  }
}

function settings() {
  const s = { mode: state.mode };
  for (const f of FIELDS) s[f.key] = f.bool ? !!state[f.key] : +state[f.key];
  return s;
}

function reflect() {
  $('mode').value = state.mode;
  for (const f of FIELDS) {
    const el = $(f.id);
    if (f.bool) el.checked = !!state[f.key];
    else { el.value = state[f.key]; $(f.id + 'Val').textContent = f.fmt(state[f.key]); }
  }
  document.querySelectorAll('[data-for]').forEach(el => {
    el.style.display = el.dataset.for.split(' ').includes(state.mode) ? '' : 'none';
  });
  fx.setSettings(settings());
}

function applyPreset(p) { state = Object.assign({ ...defaults }, p.settings); reflect(); }

presetSel.addEventListener('change', () => {
  const v = presetSel.value;
  if (v.startsWith('b:')) applyPreset(builtins[+v.slice(2)]);
  else if (v.startsWith('u:')) { const p = userPresets.find(x => x.name === v.slice(2)); if (p) applyPreset(p); }
});

$('mode').addEventListener('change', () => { state.mode = $('mode').value; presetSel.value = ''; reflect(); });

for (const f of FIELDS) {
  $(f.id).addEventListener(f.bool ? 'change' : 'input', () => {
    const el = $(f.id);
    state[f.key] = f.bool ? el.checked : el.value;
    presetSel.value = '';
    if (!f.bool) $(f.id + 'Val').textContent = f.fmt(state[f.key]);
    fx.setSettings(settings());
  });
}

$('save').addEventListener('click', () => {
  const name = (prompt('Save preset as:') || '').trim();
  if (!name) return;
  userPresets = userPresets.filter(p => p.name !== name).concat([{ name, settings: settings() }]);
  localStorage.setItem('mxPresets', JSON.stringify(userPresets));
  fillPresets();
  presetSel.value = 'u:' + name;
});

$('del').addEventListener('click', () => {
  const v = presetSel.value;
  if (!v.startsWith('u:')) return;
  userPresets = userPresets.filter(p => p.name !== v.slice(2));
  localStorage.setItem('mxPresets', JSON.stringify(userPresets));
  fillPresets();
  presetSel.value = '';
});

// --- source + render ---
function loadVideo(src) { video.src = src; video.play().catch(() => {}); }
$('load').addEventListener('click', () => {
  const file = $('file').files[0], url = $('url').value.trim();
  if (file) loadVideo(URL.createObjectURL(file));
  else if (url) loadVideo(url);
  else alert('Pick a file or paste a URL first.');
});
$('showSource').addEventListener('click', () => {
  out.style.visibility = out.style.visibility === 'hidden' ? 'visible' : 'hidden';
});

let lastTime = -1;
function frame() {
  requestAnimationFrame(frame);
  if (video.readyState < 2) return;
  out.style.width = video.clientWidth + 'px';
  out.style.height = video.clientHeight + 'px';
  if (video.currentTime === lastTime) return;
  lastTime = video.currentTime;
  fx.render(video);
}

fillPresets();
reflect();
frame();
