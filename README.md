# motion-extraction

A Chrome extension that shows **only the motion** in any web video.

Based on Posy's video: https://www.youtube.com/watch?v=NSS6yAMZF78

## How it works

Duplicate the footage, invert the duplicate's colours, set it to ~50% strength
and lay it back over the original — but offset by a few frames in time. Where
nothing moved between the two moments, a colour and its inverse blend to flat
grey and cancel out. Only the parts that changed (the motion) survive, standing
out against the grey.

Two controls shape the result:

- **Delay** — how many frames apart the two copies are. Small delay → only fast
  motion shows. Larger delay → slower motion appears too.
- **Strength** — blend of the inverted layer. `0.50` gives clean cancellation
  (a flat grey background); moving it off `0.50` tints the static parts.

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
| `motionEffect.js` | The effect engine — frame buffering, compositing, modes. Page-agnostic. |
| `contentScript.js` | Page integration — finds the video, overlays the canvas, handles fullscreen, talks to the popup. |
| `popup.html` / `popup.js` | The control panel (start/stop, mode, delay, strength, reveal). |
| `manifest.json` | Extension manifest (MV3). |
| `index.html` / `script.js` | A standalone test bench — try modes/settings on a local video with no extension reload loop. |

## Adding new looks (the variations from the video)

Every look is one entry in the `MODES` table in `motionEffect.js`:

```js
const MODES = {
  motion:  { label: 'Motion (colour)',  base: 'none',         overlay: 'invert(1)',              canvas: 'none' },
  mono:    { label: 'Motion (mono)',    base: 'grayscale(1)', overlay: 'grayscale(1) invert(1)', canvas: 'none' },
  boosted: { label: 'Motion (boosted)', base: 'none',         overlay: 'invert(1)',              canvas: 'saturate(4) contrast(1.6)' },
  glow:    { label: 'Motion (glow)',    base: 'none',         overlay: 'invert(1)',              canvas: 'contrast(1.4) brightness(1.3)' },
};
```

- `base` — [CSS filter](https://developer.mozilla.org/en-US/docs/Web/CSS/filter)
  on the current frame (bottom layer).
- `overlay` — filter on the delayed frame (top layer). **Keep `invert(1)`** in
  it or the cancellation breaks.
- `canvas` — filter applied to the finished result (post-processing).

To add a mode, add a row here and it shows up automatically in both the popup
and the test bench. Examples to try: `hue-rotate(90deg)` for colour shifts,
`sepia(1) saturate(6)` for tinted motion, higher `contrast()` for hard edges.

## Notes / limitations

- The effect never reads pixels back from the canvas, so it works on
  cross-origin videos (most of the web), not just YouTube.
- Frame buffers are capped to 960px on the long side and only as deep as the
  chosen delay, to keep memory bounded.
- Letterboxed players (black bars baked into the video element) can show slight
  overlay misalignment — a known rough edge.
