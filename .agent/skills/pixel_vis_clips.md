---
description: Capture the engine's live per-pixel light buffer and replay it as an animated clip (the CaptainPad DECK MAIN look) inline for the operator
---

# 🎞️ Pixel Vis Clips — capture live pixels & show a clip

Use this when the operator wants to **see a pattern play** without standing at
the bench — a faithful, per-pixel replay of what the lights are actually doing,
rendered inline in chat. It taps the **same data CaptainPad's DECK MAIN strip
draws** (the engine's vis broadcast), so it is the real visualization, not a
mock or a re-render.

It also documents how the serialized vis buffer maps to fixtures — see the
companion spec `.agent/02_reports/202606/20260618_5_serialized_vis_and_dmx_layout_spec.md`.

## When to use
- "Show me the swipe / pattern", "send me a clip", "what does it look like".
- Verifying a pattern end-to-end **through the real engine** (mixer + dimmers),
  not just the offline WASM harness (which renders position/brightness but, in
  the standalone host, NOT palette hue — see fidelity note below).

## What you need
- The engine running on `:6968` (e.g. `node engine.js --model test_bench
  --pattern <name>`, or the full stack via `node launcher.js dev --scene
  test_bench`). The capture talks to its HTTP + `/ws/viz` WebSocket.

## The two tools (committed, reusable)
Run both from `marsin_engine/`:

```bash
# 1) capture the live per-pixel buffer to JSON
node tools/capture_vis.mjs --pattern 27_swipe --frames 48 --buffer master \
    --sections 1,2,3 --set sliderBlur=0,sliderTrail=0.5,sliderLocalSpeed=1.0 \
    --out ~/tmp/vis.json

# 2) turn that JSON into an animated clip widget (HTML)
node tools/make_vis_clip.mjs --in ~/tmp/vis.json --out ~/tmp/clip.html --fps 14
```

Then, **as the agent**: `Read` `~/tmp/clip.html` and pass its contents to the
visualize **`show_widget`** tool (`title` + the HTML as `widget_code`). The clip
renders inline with Pause + Speed controls. (Call `read_me` on the visualize
tool once first, per its instructions.)

### capture_vis.mjs flags
- `--pattern <name>`  load this pattern on the deck first (omit to capture
  whatever is live).
- `--frames N`        number of frames (vis WS is ~5 Hz, so N≈48 ≈ 9.6 s).
- `--buffer master|rig`  `master` = mixer composition (what DECK MAIN shows);
  `rig` = post section-dimmers + blackout + global FX (hardware truth — use
  this to judge brightness floors as they reach the lights).
- `--sections 1,2,3`  raise these section dimmers to 100% so the capture isn't
  dimmed (1=Pars, 2=Vintage, 3=Bars).
- `--set name=val,…`  push deck control values by export name (resolved via
  `/exports`) before capturing, e.g. `sliderShift=0.1`.
- `--view deck`       route the mixer to the deck so the pattern is the output
  (default; otherwise an empty mixer overlay can read black).
- `--model`, `--host`, `--out`.

Output JSON: `{ pattern, buffer, model, meta:[{i,fId,sId,nx,ny,nz}], frames:[[ [r,g,b]×Npx ]…] }`.
6-byte RGBWAU per pixel collapses to `[r,g,b]` here; pixels are in
`model.pixels[]` order. NOT subsampled when the model is under the cap (52 px
test_bench → full 52).

### make_vis_clip.mjs
Groups pixels by **section (`sId`)** and **auto-detects each section's axis from
the coordinate spread** — wider `nx` → horizontal row sorted by `nx` (left→
right); wider `ny` → one vertical column per fixture sorted by `ny` (top→bottom).
So it lays the rig out physically for any model with no hardcoding
(test_bench → `Pars[x] Vintage[y, 2 strips] Bars[x]`). Embeds the frames as hex
and animates at `--fps`.

## Physical order vs model/wiring order
The vis buffer is in `model.pixels[]` order, which is **neither DMX wiring order
nor guaranteed physical order**. `make_vis_clip` sorts each section by `nx`/`ny`
so the clip reads physically. If the **bench** disagrees with the clip (a
left↔right shift), that's a model-vs-hardware calibration gap — use the
pattern's `shift` control to align, and capture again with
`--set sliderShift=<v>` to confirm.

## Fidelity notes
- The clip is the **live engine** buffer → correct colour (including the global
  color-palette system, which overrides a pattern's cp1/cp2 defaults).
- The offline WASM harness (`~/tmp/*_harness.mjs`, driving `lib/wasm_host.js`
  directly) is great for position/brightness/self-filter checks but renders the
  palette **hue wrong** in the standalone host — do NOT build colour clips from
  it; capture from the engine instead.
- Judge brightness floors (e.g. an all-LEDs-on glow) on `--buffer rig`, not the
  dark vis UI: a few-percent floor is invisible in the preview but lights real
  LEDs.

## One-shot example (engine already up)
```bash
cd marsin_engine
node tools/capture_vis.mjs --pattern 27_swipe --frames 48 --buffer master --sections 1,2,3 --out ~/tmp/vis.json
node tools/make_vis_clip.mjs --in ~/tmp/vis.json --out ~/tmp/clip.html
# agent: Read ~/tmp/clip.html → show_widget(title, widget_code=<contents>)
```
