# motion-extraction

A Chrome extension that shows **only the motion** in any web video.

Based on Posy's video: https://www.youtube.com/watch?v=NSS6yAMZF78

## How it works

Duplicate the footage, invert the duplicate's colours, set it to ~50% strength
and lay it back over the original — but offset in time. Where nothing moved
between the two moments, a colour and its inverse blend to flat grey and cancel
out. Only the parts that changed (the motion) survive, standing out against the
grey.

## Presets & controls

Pick a **Preset** for an instant look, then tweak any control to taste and
**Save as…** your own (saved presets persist; built-ins can't be deleted).
Each preset is just a **Method** plus parameter values — nothing is hard-coded,
so a preset is fully reproducible from the controls.

**Methods** (the underlying pipeline):

| Method | What it does |
| --- | --- |
| **Blend (invert + delay)** | The classic invert-and-delay; static averages to grey. |
| **Difference** | `|current − delayed|`: static **black**, motion bright in real colour. |
| **Matte on black** | Reveals the moving **subject in real colour** over black. |
| **Glow on scene** | Adds the motion as a **glow over the real, full-colour footage**. |
| **RGB time-shift** | Delays R/G/B independently → **rainbow motion** (turbines, clouds). |
| **Vanishing (auto bg)** | A self-learning background; hold still and you **dissolve and vanish**. |
| **Direction** | Past→red, present→cyan, so colour shows **which way things moved**. |
| **Motion history** | Accumulates motion into a glowing **map of where motion happened**. |

**Controls** (only the ones a method uses are shown):

| Control | Applies to | What it does |
| --- | --- | --- |
| **Delay** | most | Time gap between the two copies (seconds). |
| **Red/Green/Blue delay** + **Greyscale** | RGB | Per-channel delays; greyscale gives the rainbow-on-grey look, off keeps real colour. |
| **Strength** | Blend | Opacity of the inverted layer (`0.50` = clean cancellation). |
| **Gain** | Matte/Glow/Vanishing | Amplifies the extracted motion. |
| **Memory** | Vanishing | How long until still things are absorbed and vanish. |
| **Trail decay** | History | How quickly the motion map fades. |
| **Freeze reference** | single-delay methods | Compare against one frozen moment so change accumulates. |
| **Saturation / Brightness / Contrast** | all | Post tone — `Saturation 0%` = mono, high = vivid. |
| **Blur** | all | Suppress fine detail / set the Glow bloom size. |
| **Tint hue / amount** | all | Recolour the result toward a chosen hue. |
| **Reveal original** | all | Fade the effect back over the real video. |

## Install (unpacked)

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** and pick this folder.
3. Open a page with a video, **reload the page** (so the content script is
   present), then click the extension icon and press **Start**.

> Tip: after editing any file, hit the reload icon on the extension card *and*
> reload the video page.

## Files

| File | Role |
| --- | --- |
| `motionEffect.js` | The effect engine — time-based frame buffer, compositing, modes. Page-agnostic. |
| `contentScript.js` | Page integration — finds the video, overlays the canvas, handles fullscreen, talks to the popup. |
| `popup.html` / `popup.js` | The control panel. |
| `manifest.json` | Extension manifest (MV3). |
| `index.html` / `script.js` | A standalone test bench — try modes/settings on a local video with no extension reload loop. |
| `webcam.html` / `webcam.js` | A minimal camera demo (controls pinned to the bottom) — a starting point for a standalone / PWA build. |

## Reusing the engine in your own app

`motionEffect.js` is self-contained and knows nothing about the extension — it's
the file to drop into other projects (webcam app, PWA, etc.). It loads as a
global via `<script>` or through `require()`/bundlers.

```js
const fx = MotionEffect.create(outputCanvas);

// apply a built-in preset (merge onto DEFAULTS so nothing leaks between presets)
const preset = MotionEffect.PRESETS[2];               // e.g. "Motion on black"
fx.setSettings({ ...MotionEffect.DEFAULTS, ...preset.settings });

function loop() {
  requestAnimationFrame(loop);
  if (source.readyState >= 2) fx.render(source);       // call once per frame
}
loop();
```

- `MotionEffect.create(canvas)` → an effect bound to that output canvas.
- `fx.render(source)` — `source` is anything `drawImage` accepts: a `<video>`
  (including a `getUserMedia` webcam stream), `<img>` or `<canvas>`.
- `fx.setSettings({...})` — any subset of the parameters; see
  `MotionEffect.DEFAULTS` for the full list and their defaults.
- `fx.reset()` — clear the frame history / accumulators.
- `MotionEffect.MODES` (methods), `MotionEffect.PRESETS` (built-in looks),
  `MotionEffect.DEFAULTS`, `MotionEffect.MAX_DELAY_SECONDS` — for building UI.

A preset is just `{ name, settings }`; persist your own with `localStorage` (or
`chrome.storage`) and merge them the same way. The canvas's pixel size is managed
by the engine; size it on screen with CSS. `webcam.js` is an end-to-end example.

## Adding new looks

Most new looks need **no code** — pick a method, dial in the controls, and
**Save as…**. To ship one as a built-in, add a row to `PRESETS` in
`motionEffect.js`:

```js
{ name: 'My look', settings: { mode: 'rgb', delayG: 0.2, delayB: 0.4, saturation: 2 } },
```

It then appears automatically in the popup, the test bench and the webcam demo
(they read `MODES`/`PRESETS`/`DEFAULTS` from the engine).

To add a whole new **method** (a new compositing pipeline), add an entry to
`MODES` with a `kind` and a matching branch in `render()` — the existing
`difference` / `mask` / `glow` / `rgb` branches are good starting points.

## Notes / limitations

- The effect never reads pixels back from the canvas, so it works on
  cross-origin videos (most of the web), not just YouTube.
- Buffers are capped to 854px on the long side and a fixed frame count; long
  delays store frames more sparsely to stay within that budget. A long delay
  therefore needs that many seconds of playback to "fill" before it's accurate.
- Letterboxed players (black bars baked into the video element) can show slight
  overlay misalignment — a known rough edge.
- Stabilization (Posy uses it to isolate one subject's motion) isn't practical
  to do live in-browser, so it's out of scope here — stabilize the clip first if
  you need it.
