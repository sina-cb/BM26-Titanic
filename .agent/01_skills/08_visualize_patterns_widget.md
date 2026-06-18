---
description: When the operator says "visualize the pattern(s)" — run the pattern through the engine's WASM VM, capture the real per-pixel output, and render it as a live animated LED widget inline in chat. Full widget anatomy for future agents.
---

# 🔦 Visualize Patterns — live per-pixel widget

When the operator asks to **"visualize the pattern"**, "show me the swipe",
"send a clip", or "see the lights", build them an **animated LED widget** that
replays the pattern's real per-pixel output — the same look as CaptainPad's
DECK MAIN strip. This is the go-to skill for that request.

It pairs with `07_pixel_vis_clips.md` (the capture/clip CLI tools) and the spec
`.agent/02_reports/202606/20260618_5_serialized_vis_and_dmx_layout_spec.md`
(buffer format + fixture map). This doc focuses on the **widget itself** so any
agent can build, explain, or adapt it.

## Where the pixels come from (READ THIS — sourcing matters)
The pattern runs in the **MarsinVM (WASM)**. There are two ways to read its
per-pixel output; only one is faithful:

- ✅ **Live engine capture (USE THIS).** The engine runs the WASM in its real
  context (export defaults applied, real frame timing, mixer, global palette).
  Tap its vis broadcast `ws://<host>:6968/ws/viz` — `master` (composition /
  DECK MAIN) or `rig` (post dimmers+blackout+FX, hardware-truth). 6 bytes per
  pixel **R,G,B,W,A,U**, in `model.pixels[]` order, NOT subsampled under the
  cap (52 px test_bench → full 52). This is color-accurate.
- ⚠️ **Standalone WASM harness** (`lib/wasm_host.js` driven directly): great for
  ASSERTIONS at a frozen control state (which fixtures light, relative
  brightness, self-filter, single-pixel core, monotonic sweep) — but it does
  NOT apply the pattern's export-default globals or reproduce engine frame
  timing, so free-running animation and **palette colour are unreliable** (a
  pattern can render the wrong end / wrong hue). NEVER build a colour clip from
  it. Use it only for numeric checks; source the widget from the live engine.

So: to visualize, make sure the engine is up (`node engine.js --model
test_bench --pattern <name>`, or `node launcher.js dev --scene test_bench`),
then capture, then render the widget.

## The fast path (CLI tools from skill 07)
```bash
cd marsin_engine
# 1) run the pattern + capture its live per-pixel frames
node tools/capture_vis.mjs --pattern 27_swipe --frames 48 --buffer master \
    --sections 1,2,3 --set sliderBlur=0,sliderTrail=0.5,sliderLocalSpeed=1.0 \
    --out ~/tmp/vis.json
# 2) build the widget HTML (auto-groups by section, auto-detects X/Y axis)
node tools/make_vis_clip.mjs --in ~/tmp/vis.json --out ~/tmp/clip.html --fps 14
```
Then **as the agent**: call the visualize `read_me` once, `Read` `~/tmp/clip.html`,
and pass its contents to the visualize **`show_widget`** tool
(`title` + the HTML as `widget_code`). It renders inline with Pause + Speed.

## Widget anatomy (build or adapt by hand)
The clip is a self-contained HTML fragment. Structure, in order (matches the
visualize tool's streaming rules: styles/markup first, `<script>` last):

1. **Screen-reader summary** — `<h2 class="sr-only">one sentence</h2>`.
2. **The LED panel** — a *dark inner panel* (the "device"): `background:#0a0a0e;
   border-radius:var(--border-radius-lg); padding; 0.5px border`. The OUTER
   container stays transparent (host provides the bg) — only this inner panel is
   dark, which is allowed as a device mockup and is what makes LEDs read.
3. **Per-section groups.** One labelled block per rig section:
   - **Horizontal section (X axis)** → a flex `row` of thin cells
     (`flex:1 1 0; min-width:4px; height`), one per LED, ordered **left→right**.
   - **Vertical section (Y axis)** → one flex `column` per fixture
     (`width:26px; height:15px` cells), ordered **top→bottom**.
   Label each with a small caption (`PARS`, `VINTAGE`, `BARS`) + a sub-label
   (`swipe x` / `swipe y · N strips`).
4. **Transport** — a `Pause` button and a `Speed` range input (fps 4–30).
5. **`<script>` (last).**
   - `const F = [[ "#rrggbb", … per pixel ], … per frame ]` — frames as hex
     strings, indexed by **model pixel index** (the capture order).
   - `mk(elId, idxs, kind)` builds the cells for one group: `idxs` is the list
     of MODEL indices in PHYSICAL display order (so the visual matches the rig);
     each cell remembers its model index.
   - `draw(fr)` sets every cell's `background` from `F[fr][modelIndex]`.
   - `loop(t)` is a `requestAnimationFrame` loop gated to `fps`; Pause toggles
     it; the Speed slider sets `fps`. Cells use `transition:background 60ms` for
     a smooth handoff.

### The load-bearing detail: physical order
The frame arrays are in `model.pixels[]` order, which is **neither DMX wiring
order nor physical order**. `mk()` is fed a **physical-order index list** so the
strip reads correctly. Derive it by sorting each section's pixels by coordinate:
horizontal → ascending `nx` (left→right); vertical → descending `ny`
(top→bottom), one column per `fId`. `make_vis_clip.mjs` does this automatically
from the captured `meta[]` (it picks the axis from whichever of nx/ny has the
larger spread). If you hand-build, replicate that. (If the BENCH disagrees with
the widget, that's a model-vs-wiring shift — calibrate with the pattern's
`shift` control, not the widget.)

### Minimal hand-built template
```html
<h2 class="sr-only">Live per-pixel replay of <pattern> on <model>.</h2>
<div style="padding:1rem 0;">
  <div style="background:#0a0a0e;border-radius:var(--border-radius-lg);padding:18px 20px;border:0.5px solid var(--color-border-tertiary);">
    <div style="font-size:12px;letter-spacing:1px;color:#9aa;margin-bottom:6px;">BARS</div>
    <div id="row" style="display:flex;gap:2px;height:28px;"></div>
  </div>
  <div style="display:flex;gap:14px;margin-top:12px;align-items:center;">
    <button id="pp" style="font-size:13px;">Pause</button>
    <input id="spd" type="range" min="4" max="30" value="14" step="1" style="flex:1;max-width:200px;">
    <span style="font-size:12px;color:var(--color-text-tertiary);">live engine vis · no subsampling</span>
  </div>
</div>
<script>
const F = /* [[ "#rrggbb" ×Npx ] ×Nframes] from the capture */;
const ORDER = /* model indices in physical left→right order, e.g. [33,32,…,16,51,…,34] */;
const el=document.getElementById('row'), cells=[];
for(const mi of ORDER){const c=document.createElement('div');
  c.style.cssText='flex:1 1 0;min-width:4px;height:100%;border-radius:3px;background:#000;transition:background 60ms linear;';
  el.appendChild(c);cells.push([c,mi]);}
let f=0,playing=true,fps=14,last=0;
function draw(fr){const cols=F[fr];for(const [c,mi] of cells)c.style.background=cols[mi];}
function loop(t){if(playing&&t-last>1000/fps){f=(f+1)%F.length;draw(f);last=t;}requestAnimationFrame(loop);}
draw(0);requestAnimationFrame(loop);
document.getElementById('pp').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play';};
document.getElementById('spd').oninput=e=>{fps=+e.target.value;};
</script>
```

## Widget rules (from the visualize tool)
- No DOCTYPE/`<html>`/`<head>`/`<body>`; start with content. Outer container
  transparent; the only dark surface is the inner LED panel.
- `<style>`/markup first, `<script>` last (it executes after streaming).
- Use CSS variables for any chrome (`var(--color-text-tertiary)`, radius vars);
  the LED cell colours are literal hex from the capture.
- No `position:fixed`. Keep it one self-contained fragment.
- Round any displayed numbers. Sentence case for labels.

## Choosing capture options for a good clip
- `--frames 48` ≈ 9.6 s at the 5 Hz vis rate; replay `--fps 14` reads smooth.
- `--buffer master` for the composition look; `--buffer rig` to show exactly
  what the lights get (incl. dimmers) — also the right buffer to spot an
  all-LEDs-on floor glow (invisible in a dark UI, visible on hardware).
- `--set sliderX=…` to pin the control state you want to show (e.g.
  `sliderBlur=0,sliderTrail=0.6`); `--sections 1,2,3` to undim the rig.
- Multiple patterns: capture each to its own JSON and make separate widgets, or
  capture one at a time and stack the rendered widgets in your reply.
```
