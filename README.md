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
| **Strength** | Blend of the top layer. `0.50` gives clean cancellation (flat grey); off `0.50` tints the static parts. |
| **Freeze duplicate** | Compare every frame to one *frozen* reference instead of a rolling delay, so change **accumulates over time** (Posy's moon-setting / brightening-light shots). |
| **Reveal original** | Fades the effect back over the real video, so you keep the scene as context. |
| **Blur** | Blurs the input so fine detail/noise cancels and only **larger motion** shows. |
| **Tint** | Recolours the (grey) motion to a chosen hue. `off` = no recolour. |

## Modes

- **Motion (colour / mono / boosted / glow)** — the invert-and-delay technique.
  `boosted` cranks contrast/saturation to surface tiny motion; `glow` adds bloom.
- **RGB time-shift** — delays the red, green and blue channels by different
  amounts (Posy's 0 / d / 2d trick) so moving things leave **rainbow trails**.
  Static stays grey because the three channels still match. Driven by the same
  Delay control.

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

Add a row and it appears automatically in both the popup and the test bench.
The `RGB time-shift` mode (`kind: 'rgb'`) uses a custom render path instead of
these filters — copy it as a starting point for other multi-frame composites.

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
