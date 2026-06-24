// popup.js
// Controls + presets live here; the effect runs in the page's content script.
// The authoritative MODES/PRESETS/DEFAULTS come from the content script (which
// has the engine); these fallbacks are only used if it isn't reachable yet.

const FALLBACK_MODES = [
  ['motion', 'Blend (invert + delay)'], ['black', 'Difference'], ['isolate', 'Matte on black'],
  ['over', 'Glow on scene'], ['rgb', 'RGB time-shift'], ['ghost', 'Vanishing (auto bg)'],
  ['anaglyph', 'Direction'], ['history', 'Motion history'],
];
const FALLBACK_DEFAULTS = {
  mode: 'motion', delaySeconds: 0.1, delayR: 0, delayG: 0.1, delayB: 0.2, grayscale: true,
  strength: 0.5, gain: 2.5, memorySeconds: 2, decay: 0.02, reveal: 0, blur: 0,
  saturation: 1, brightness: 1, contrast: 1, tintHue: 0, tintAmount: 0, frozen: false,
};
const FALLBACK_PRESETS = [
  { name: 'Motion (grey)', settings: { mode: 'motion' } },
  { name: 'Motion on black', settings: { mode: 'black', brightness: 1.4, contrast: 1.5, saturation: 1.6 } },
  { name: 'RGB rainbow', settings: { mode: 'rgb', saturation: 1.6 } },
  { name: 'Vanishing act', settings: { mode: 'ghost', memorySeconds: 2, gain: 3 } },
];

// id -> setting key + how to display it
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

const $ = id => document.getElementById(id);
const toggle = $('toggle'), hint = $('hint'), presetSel = $('preset');

let defaults = FALLBACK_DEFAULTS;
let builtins = FALLBACK_PRESETS;
let userPresets = [];
let state = { ...FALLBACK_DEFAULTS };
let running = false;

function fillModes(modes) {
  $('mode').innerHTML = '';
  for (const [value, label] of modes) $('mode').add(new Option(label, value));
}

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
  // show only the controls this method uses
  document.querySelectorAll('[data-for]').forEach(el => {
    el.style.display = el.dataset.for.split(' ').includes(state.mode) ? '' : 'none';
  });
  toggle.textContent = running ? 'Stop' : 'Start';
  toggle.classList.toggle('on', running);
}

const save = () => chrome.storage.local.set({ mxState: state });

async function send(type, extra) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { type, ...extra }, resp => {
      resolve(chrome.runtime.lastError ? { unreachable: true } : resp);
    });
  });
}

async function pushUpdate() {
  if (running) await send('mx-update', { settings: settings() });
  save();
}

function applyPreset(p) {
  state = Object.assign({ ...defaults }, p.settings);
  reflect();
  pushUpdate();
}

// --- events ---

presetSel.addEventListener('change', () => {
  const v = presetSel.value;
  if (v.startsWith('b:')) applyPreset(builtins[+v.slice(2)]);
  else if (v.startsWith('u:')) { const p = userPresets.find(x => x.name === v.slice(2)); if (p) applyPreset(p); }
});

$('mode').addEventListener('change', () => {
  state.mode = $('mode').value;
  presetSel.value = '';
  reflect();
  pushUpdate();
});

for (const f of FIELDS) {
  $(f.id).addEventListener(f.bool ? 'change' : 'input', () => {
    const el = $(f.id);
    state[f.key] = f.bool ? el.checked : el.value;
    presetSel.value = '';
    if (!f.bool) $(f.id + 'Val').textContent = f.fmt(state[f.key]);
    pushUpdate();
  });
}

$('save').addEventListener('click', async () => {
  const name = (prompt('Save preset as:') || '').trim();
  if (!name) return;
  userPresets = userPresets.filter(p => p.name !== name).concat([{ name, settings: settings() }]);
  await chrome.storage.local.set({ mxPresets: userPresets });
  fillPresets();
  presetSel.value = 'u:' + name;
  hint.textContent = '';
});

$('del').addEventListener('click', async () => {
  const v = presetSel.value;
  if (!v.startsWith('u:')) { hint.textContent = 'Only your saved presets can be deleted.'; return; }
  userPresets = userPresets.filter(p => p.name !== v.slice(2));
  await chrome.storage.local.set({ mxPresets: userPresets });
  fillPresets();
  presetSel.value = '';
  hint.textContent = '';
});

toggle.addEventListener('click', async () => {
  hint.textContent = '';
  if (!running) {
    const resp = await send('mx-start', { settings: settings() });
    if (resp && resp.ok) running = true;
    else if (resp && resp.unreachable) hint.textContent = 'Open a normal page with a video and reload it, then try again.';
    else hint.textContent = (resp && resp.error) || 'Could not start.';
  } else {
    await send('mx-stop');
    running = false;
  }
  save();
  reflect();
});

async function init() {
  const stored = await chrome.storage.local.get(['mxState', 'mxPresets']);
  userPresets = stored.mxPresets || [];
  const status = await send('mx-status');
  if (status && status.modes && status.modes.length) fillModes(status.modes);
  else fillModes(FALLBACK_MODES);
  if (status && status.presets) builtins = status.presets;
  if (status && status.defaults) defaults = status.defaults;
  state = Object.assign({ ...defaults }, stored.mxState || {});
  running = !!(status && status.running);
  fillPresets();
  reflect();
}

init();
