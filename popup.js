// popup.js
// Controls live in the popup; the effect lives in the page's content script.
// The popup sends settings over and remembers them in storage.

// Fallback mode list (used if the content script isn't reachable yet). The
// content script reports the authoritative list via the mx-status response.
const FALLBACK_MODES = [
  ['motion', 'Motion (colour)'],
  ['mono', 'Motion (mono)'],
  ['boosted', 'Motion (boosted)'],
  ['glow', 'Motion (glow)'],
  ['rgb', 'RGB time-shift'],
];

const DEFAULTS = {
  mode: 'motion',
  delaySeconds: 0.1,
  strength: 0.5,
  reveal: 0,
  blur: 0,
  tint: 0,
  frozen: false,
};

// Each control: element id, the setting it drives, and how to read/show it.
const FIELDS = [
  { id: 'mode', key: 'mode', kind: 'string' },
  { id: 'delay', key: 'delaySeconds', kind: 'number', fmt: v => `${(+v).toFixed(2)} s` },
  { id: 'strength', key: 'strength', kind: 'number', fmt: v => (+v).toFixed(2) },
  { id: 'reveal', key: 'reveal', kind: 'number', fmt: v => (+v).toFixed(2) },
  { id: 'blur', key: 'blur', kind: 'number', fmt: v => `${v} px` },
  { id: 'tint', key: 'tint', kind: 'number', fmt: v => (+v === 0 ? 'off' : `${v}°`) },
  { id: 'freeze', key: 'frozen', kind: 'bool', event: 'change' },
];

const $ = id => document.getElementById(id);
const toggle = $('toggle');
const hint = $('hint');

let state = { ...DEFAULTS };
let running = false;

function fillModes(modes) {
  $('mode').innerHTML = '';
  for (const [value, label] of modes) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    $('mode').appendChild(o);
  }
  $('mode').value = state.mode;
}

function reflect() {
  for (const f of FIELDS) {
    const el = $(f.id);
    if (f.kind === 'bool') el.checked = !!state[f.key];
    else el.value = state[f.key];
    if (f.fmt) $(f.id + 'Val').textContent = f.fmt(state[f.key]);
  }
  toggle.textContent = running ? 'Stop' : 'Start';
  toggle.classList.toggle('on', running);
}

const settings = () => ({
  mode: state.mode,
  delaySeconds: +state.delaySeconds,
  strength: +state.strength,
  reveal: +state.reveal,
  blur: +state.blur,
  tint: +state.tint,
  frozen: !!state.frozen,
});

const save = () => chrome.storage.local.set({ mxState: state });

async function send(type, extra) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { type, ...extra }, resp => {
      if (chrome.runtime.lastError) resolve({ unreachable: true });
      else resolve(resp);
    });
  });
}

async function init() {
  const stored = (await chrome.storage.local.get('mxState')).mxState;
  if (stored) state = { ...DEFAULTS, ...stored };

  const status = await send('mx-status');
  if (status && status.modes && status.modes.length) fillModes(status.modes);
  else fillModes(FALLBACK_MODES);
  running = !!(status && status.running);

  reflect();
}

toggle.addEventListener('click', async () => {
  hint.textContent = '';
  if (!running) {
    const resp = await send('mx-start', { settings: settings() });
    if (resp && resp.ok) running = true;
    else if (resp && resp.unreachable) hint.textContent = 'Open a normal web page with a video and reload it, then try again.';
    else hint.textContent = (resp && resp.error) || 'Could not start.';
  } else {
    await send('mx-stop');
    running = false;
  }
  save();
  reflect();
});

for (const f of FIELDS) {
  $(f.id).addEventListener(f.event || 'input', async () => {
    const el = $(f.id);
    state[f.key] = f.kind === 'bool' ? el.checked : el.value;
    reflect();
    if (running) await send('mx-update', { settings: settings() });
    save();
  });
}

init();
