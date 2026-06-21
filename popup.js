// popup.js
// Controls live in the popup; the actual effect lives in the page's content
// script. The popup just sends settings over and remembers them in storage.

// Fallback mode list (used if the content script isn't reachable yet). The
// content script reports the authoritative list via the mx-status response.
const FALLBACK_MODES = [
  ['motion', 'Motion (colour)'],
  ['mono', 'Motion (mono)'],
  ['boosted', 'Motion (boosted)'],
  ['glow', 'Motion (glow)'],
];

const DEFAULTS = { mode: 'motion', delay: 3, strength: 0.5, reveal: 0 };

const $ = id => document.getElementById(id);
const els = {
  toggle: $('toggle'),
  mode: $('mode'),
  delay: $('delay'),
  strength: $('strength'),
  reveal: $('reveal'),
  hint: $('hint'),
};

let state = { ...DEFAULTS };
let running = false;

function fillModes(modes) {
  els.mode.innerHTML = '';
  for (const [value, label] of modes) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    els.mode.appendChild(o);
  }
  els.mode.value = state.mode;
}

function reflect() {
  els.mode.value = state.mode;
  els.delay.value = state.delay;
  els.strength.value = state.strength;
  els.reveal.value = state.reveal;
  $('delayVal').textContent = state.delay;
  $('strengthVal').textContent = (+state.strength).toFixed(2);
  $('revealVal').textContent = (+state.reveal).toFixed(2);
  els.toggle.textContent = running ? 'Stop' : 'Start';
  els.toggle.classList.toggle('on', running);
}

const settings = () => ({
  mode: state.mode,
  delay: +state.delay,
  strength: +state.strength,
  reveal: +state.reveal,
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

els.toggle.addEventListener('click', async () => {
  els.hint.textContent = '';
  if (!running) {
    const resp = await send('mx-start', { settings: settings() });
    if (resp && resp.ok) {
      running = true;
    } else if (resp && resp.unreachable) {
      els.hint.textContent = 'Open a normal web page with a video and reload it, then try again.';
    } else {
      els.hint.textContent = (resp && resp.error) || 'Could not start.';
    }
  } else {
    await send('mx-stop');
    running = false;
  }
  save();
  reflect();
});

for (const key of ['mode', 'delay', 'strength', 'reveal']) {
  els[key].addEventListener('input', async () => {
    state[key] = els[key].value;
    reflect();
    if (running) await send('mx-update', { settings: settings() });
    save();
  });
}

init();
