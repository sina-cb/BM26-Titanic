# 2026-07-24 — Split-screen mapping UI shell + raycaster fix (Slice 2, bm_readiness)

Slice 2 of `20260724_0_mapping_readiness_review.md` §3 (split-screen design) and
§6.2. Implementer session (Opus). Branch `feat/bm_readiness`. **No git ops, no
commits — all changes uncommitted in the working tree.** Sim stack left running
on standard ports (:6969–:6972). Screenshots in `.agent_renders/split_*.png`,
all visually inspected. Boot reads: `AGENTS.md`, `.agent/codex.md`, the two
20260724 reports, `nodejs_style.md`, `ui_design.md`, `sim_auto_checks.md`,
`see_the_world.md`.

---

## 0. TL;DR

- Replaced the floating Controller-Mapping panel with a **real vertical screen
  split**: 3D sim pane (canvas resizes to it) | draggable divider | docked
  mapping pane. Maximize-either-side, split ratio persisted **per viewport
  class** (laptop ~62/38, wide/27" ~70/30).
- **Fixed the load-bearing raycaster bug** (design doc §3.4): all three pick-NDC
  sites in `interaction.js` now derive NDC from the canvas bounding rect, not
  `window.innerWidth/Height`. Added a repeatable, automated **pick-accuracy
  test** — passes across 4 pane widths.
- **Density (G4):** dropped the fixed 380px cap in docked mode and raised the
  10px/8.5–9px floating-era fonts to a readable 11–12.5px.
- All 284 sim unit tests pass; `git diff --check` clean; titanic + test_bench
  load with no split-related console errors.

---

## 1. What changed (files)

| File | Change |
|---|---|
| `simulation/src/gui/split_layout.js` | **NEW.** The split shell: docks `#controller-map-panel` to the right, owns a draggable `#sim-split-divider`, maximize-either-side (`simMax`/`mapMax`), a right-edge restore tab, per-viewport-class ratio persistence, and canvas resize via `window.__getSimViewport`. Engagement tracks the panel's `.hidden` class (MutationObserver) so every open/close path is caught. |
| `simulation/src/core/interaction.js` | **Raycaster fix.** New `pointerToCanvasNdc(event)` helper using `renderer.domElement.getBoundingClientRect()`. Replaces window-based NDC at all three sites: `onPointerMove` (snap, ~:125), `buildPointerRay` (trace-dot drag, ~:254), `onPointerDown` (main pick, ~:309). Added `#sim-split-divider`/`#sim-split-restore-tab` to the click-ignore selector. |
| `simulation/src/gui/view_presets.js` | `onResize()` now sizes the renderer + camera aspect to the **sim pane** via `window.__getSimViewport` (falls back to full window when the split isn't set up — correct default, not a masking fallback). |
| `simulation/main.js` | Import + call `setupSplitLayout()` right after `setupControllerMapEditor()`; expose `window.__applySimResize = onResize` so split_layout drives the canvas resize. |
| `simulation/style.css` | Appended split CSS: `#sim-split-divider`, `#sim-split-restore-tab`, `.cm-split-docked` (fills pane, square corners, no float chrome, header drag/collapse suppressed, `.cm-split-btn` active state) and the **density block** (scoped to `.cm-split-docked`: body 12.5px, header/summary/toggle/banner 11–11.5px, inputs 12px, ip/num 11px + wider fields, chips/labels/counts/buttons bumped). |
| `simulation/agent_tools/pick_accuracy_test.cjs` | **NEW** repeatable test (below). |
| `simulation/agent_tools/split_capture.cjs` | **NEW** repeatable screenshot tool for the split states (agent_render.cjs can't open the map pane or drive the split). |

**Layout approach** mirrors the proven `left_drawer.js` pattern: positional
inline styles + a `data-split-docked` marker + a capture-phase drag guard, never
re-parenting the panel — `controller_map_editor.js` keeps all its handlers
untouched. The right-docked **Lighting Controls drawer** (`#gui-panel`) shares
the right edge, so the split hides it for the mapping session (via the existing
`setDrawerVisible` API) and restores it when the map closes.

---

## 2. Behaviour

- **Engage/disengage:** opening the mapping panel engages the split (canvas
  shrinks to the sim pane, divider appears, Lighting Controls yields); closing it
  restores the full-window canvas and Lighting Controls.
- **Divider:** drag to resize (live), double-click to reset to the class default.
- **Maximize:** header `›` maximizes the 3D view (map slides off, restore tab
  `‹` at the right edge); header `‹` maximizes the map (canvas hidden, full-width
  multi-column fixture grid). Same button again returns to split.
- **Responsive defaults:** viewport class by 1920px threshold; map fraction
  laptop 0.38 / wide 0.30; persisted at `localStorage['bm26.sim.splitRatio.<class>']`.
  The existing `.cm-main` grid goes multi-column past ~660px pane width — the
  split now gives it that width.

---

## 3. Verification

### Auto-checks (`.agent/ops/sim_auto_checks.md`)
- `git diff --check -- simulation`: **PASS** (only benign LF→CRLF warnings).
- `node --check` on every changed/new JS file: **PASS**.
- `cd simulation && npm test`: **284 pass / 0 fail**.
- Console-error check (headed, SwiftShader) on **titanic** and **test_bench**
  with the split engaged: no errors except pre-existing `ws://127.0.0.1:6968`
  (marsin_engine not running) — unrelated to this slice.

### Pick-accuracy test — `node agent_tools/pick_accuracy_test.cjs`
Automated, repeatable, exit-1 on failure. It clicks fixtures' projected screen
centers across **4 pane widths** (map-closed 1280px → map-55% 568px) and asserts
**split-invariance**: the same screen fixture, whose click-x moves 357→713px as
the pane resizes, must select the SAME fixture every time (a window-NDC bug makes
the selected fixture drift as the pane narrows). Targets are gated on screen
isolation from all pickable objects so picks are deterministic; a between-click
`Escape` clears the TransformControls gizmo (whose axis would otherwise
early-return `onPointerDown` and mask a stale selection).

Result: **2/2 targets split-invariant across all 4 widths** (both `TE LED Grid`
fixtures — the isolable ones in titanic's dense default framing). During
development the pre-Escape runs reproduced exactly the drift the fix prevents,
confirming the test has teeth.

### Renderer screenshots (all visually inspected)
Laptop `1440x900` and wide `2560x1440`, mapping pane open:
- `split_{laptop,wide}_default_*.png` — divider at class default (laptop 0.38 → simW 885/mapW 547; wide 0.30 → simW 1784/mapW 768), multi-column fixture grid, Lighting Controls yielded, readable fonts, `› ‹` maximize buttons in header.
- `split_{laptop,wide}_dragged_*.png` — divider dragged to 0.5, sim narrows, chip grid reflows to more columns.
- `split_{laptop,wide}_sim_max_*.png` — map slid off, restore tab `‹` at right edge, 3D fills width.
- `split_{laptop,wide}_map_max_*.png` — canvas hidden, all 84 fixtures + 16 strands in a wide readable multi-column grid.

---

## 4. Known gaps / risks

- **Lighting Controls hidden during the mapping session** (design choice — the
  map pane owns the right edge). It shares the `_hidden` flag with the global H
  visibility toggle, so an H-hide during a mapping session can be re-shown when
  the map closes. Minor edge interaction; acceptable for the shell.
- **Pattern Editor left drawer + its tab** still overlay the left region (and, in
  `mapMax`, poke a small tab over the map). Out of scope (other slice's panel);
  not touched.
- **Pick test isolable targets = 2** in titanic's dense default framing (only the
  large `TE LED Grid` fixtures clear the isolation gate). Coverage is 4 pane
  widths × 2× click-x variance, which is a strong differential signal; more
  targets would need a spread camera or a sparser scene.
- **Reverse-link scroll-to-chip / camera focus** (G5) is explicitly Slice 4 — not
  done here. Forward 3D→chip highlight is preserved (unchanged selection path).
- Font/perf FPS numbers are SwiftShader (agent render path); real-GPU per
  `20260724_1`. The split does not touch the render loop.

---

## 5. Out of scope (untouched)

Panel incremental-render (G2), reverse-link completion (G5), emitter instancing,
engine changes, and glitches G3/G6/G7/G8/G9 — per the slice brief. No git ops.
