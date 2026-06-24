# motion-extraction

A Chrome extension that shows **only the motion** in any web video.

Based on Posy's video: https://www.youtube.com/watch?v=NSS6yAMZF78

## How it works

Duplicate the footage, invert the duplicate's colours, set it to ~50% strength
and lay it back over the original — but offset in time. Where nothing moved
between the two moments, a colour and its inverse blend to flat grey and cancel
out. Only the parts that changed (the motion) survive, standing out against the
grey.

## Controls

| Control | What it does |
| --- | --- |
| **Mode** | Which look (see below). |
| **Delay** | Time gap between the two copies, in seconds. ~1 frame (≈0.02–0.04 s) shows only fast motion; 1 s shows slower motion; 5 s+ reveals very slow drift (light, shadows). |
| **Red / Green / Blue delay** | (RGB modes only) per-channel delays — the bigger the spread, the wider the rainbow. |
| **Strength** | (Motion mode) blend of the inverted layer. `0.50` gives clean cancellation; off `0.50` tints the static parts. |
| **Freeze duplicate** | Compare every frame to one *frozen* reference instead of a rolling delay, so change **accumulates over time** (the moon-setting / footprints shots). Works with the grey, black and glow modes. |
| **Reveal original** | Fades the effect back over the real video. |
| **Saturation** | `0%` = greyscale (mono look), `100%` = as-is, higher = vivid (punchy difference, electric rainbows). |
| **Blur** | Blurs the input so fine detail cancels and only **larger motion** shows (also the bloom size for *Glow on scene*). |
| **Tint** | Recolours the motion to a chosen hue. `off` = no recolour. |

## Modes

Reviewing Posy's video, almost every shot is one of these (he rarely shows the
flat-grey version):

- **Motion (grey)** — the classic invert-and-delay; static averages to grey.
  Drop **Saturation** to 0% for the black-and-white "mono" look.
- **Motion on black** — *Difference* blend (`|current − delayed|`): static is
  **black**, motion bright and in its real colour (rain ripples, stones, the
  moon). Raise **Saturation** to make it pop.
- **Moving on black** — uses the motion as a matte to reveal the moving
  **subject in real colour** over black (the wind-blown reeds).
- **Glow on scene** — adds the motion as a white **glow on top of the real,
  full-colour footage** (grass tips, drifting clouds, insects). Use **Blur** for
  the bloom.
- **RGB shift (grey)** — delays R/G/B by independent amounts over a greyscale
  scene → **rainbow motion** (the turbine blades, iridescent clouds). Static
  stays grey because the channels still match.
- **RGB shift (colour)** — the same channel shift but keeping the real colours,
  for subtle chromatic-aberration motion.

Selecting an RGB mode swaps the single Delay control for three per-channel
sliders. **Saturation** turns the rainbow from pastel to electric.

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
fx.setSettings({ mode: 'black', delaySeconds: 0.1, saturation: 1.5 });

function loop() {
  requestAnimationFrame(loop);
  if (source.readyState >= 2) fx.render(source); // call once per frame
}
loop();
```

- `MotionEffect.create(canvas)` → an effect bound to that output canvas.
- `fx.render(source)` — `source` is anything `drawImage` accepts: a `<video>`
  (including a `getUserMedia` webcam stream), `<img>` or `<canvas>`.
- `fx.setSettings({...})` — any of `mode`, `delaySeconds`, `delayR/G/B`,
  `strength`, `reveal`, `blur`, `tint`, `saturation`, `frozen`.
- `fx.reset()` — clear the frame history.
- `MotionEffect.MODES` / `MotionEffect.MAX_DELAY_SECONDS` — for building UI.

The canvas's pixel size is managed by the engine; size it on screen with CSS.
`webcam.js` is a ~60-line end-to-end example.

## Adding new looks

The simplest looks (`kind: 'overlay'`) are one row in the `MODES` table in
`motionEffect.js`:

```js
mono: { label: 'Motion (mono)', kind: 'overlay',
        base: 'grayscale(1)', overlay: 'grayscale(1) invert(1)', canvas: 'none' },
```

- `base` — [CSS filter](https://developer.mozilla.org/en-US/docs/Web/CSS/filter)
  on the current frame (bottom layer).
- `overlay` — filter on the delayed frame (top layer). **Keep `invert(1)`** or
  the cancellation breaks.
- `canvas` — filter applied to the finished result (post-processing).

Add a row and it appears automatically in both the popup and the test bench
(the popup reads the mode list, with each mode's `kind`, from the content
script). The other `kind`s — `difference`, `mask`, `glow`, `rgb` — use custom
render paths in `render()`; copy whichever is closest as a starting point for a
new multi-frame composite.

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
