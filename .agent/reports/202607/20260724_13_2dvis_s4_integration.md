# 2026-07-24 — 2D vis multiview, Slice S4: integration (impl)

Implementer S4 (final slice) of the 2D-vis multiview wave, project
`bm_readiness_mapping`, branch `feat/bm_readiness`. Shared working tree — all
prior slices' uncommitted work left untouched. **No git ops, no commits.**
Wires S1 (geometry/frame core), S2 (view model) and S3 (pane shell) into the
LIVE app, exclusive to the `2d_pixels` profile. Folds in three mid-task
operator drops (TE-sign LED classification, TE Sign V3 install, and a
placement-correctness reprioritization). Design: `20260724_9`; slice reports
`20260724_10/11/12`; TE-sign slice `20260724_14`.

## What landed — the multiview is REAL

The single-canvas Pixel Map is replaced by the multiview pane grid inside the
existing full-screen `#pixel-map-panel`, `2d_pixels`-only:

- **Data plane (store).** `pixel_map_store.js` rewritten to own: the
  "views-are-data" container (build from `params.pixelMapViews` → migrate legacy
  `pixelMap2d` → seed the 4 defaults on first open, all fail-loud), the ONE
  shared frame source (`startFrameSource(onPixelFrame)` once at init), the
  topology bridge (frame-source `onTopology` → `buildClusters` → fan out to the
  mounted multiview), the `deps` object the S3 shell consumes, the per-pane edit
  context, and persistence (`toParams` → `params.pixelMapViews`). Opening the map
  no longer dirties the scene — defaults are published to params SILENTLY;
  only an actual view/placement edit autosaves (`commitViews`).
- **Panel host + Views manager.** `pixel_map_panel.js` rewritten to mount the S3
  multiview into the canvas host (mounted/unmounted on show/hide so painters
  unregister and the frame source tears down its onPixelFrame subscription in 3D
  profiles — clean teardown), plus a top toolbar (VIEW/EDIT, live count, Views
  manager) and a status strip. The Views manager overlay does add / duplicate /
  rename (label) / delete at runtime through S2's engine, fail-loud (removing the
  last view is refused with a legible toast; a bound-then-deleted view leaves its
  pane in the loud "view removed — pick another" state).
- **Per-pane interaction.** `pixel_map_interaction.js` rewritten to
  `attachPaneInteraction(canvas, paneView, ctx)` — per-pane pan / wheel-zoom-to-
  cursor / hover, EDIT-mode click-select (Shift multi) + drag-move + Q/E rotate +
  arrow nudge + double-click panel focus-maximize. Every key/pointer event is
  `stopPropagation`'d so the 3D scene shortcuts never fire while a pane has
  focus.
- **Shortcuts + CSS.** `shortcuts.js` gains a "2D Vis (focused)" group so the
  help panel stays truthful; `style.css` gains the Views-manager + multiview-host
  styling (the S3 pane grid still injects its own CSS).

## Operator rulings folded in (each logged explicitly)

1. **TE sign classifies as LED type** (Sina, 2026-07-24). `buildClusters` now
   derives `kind:'led'` for LED-class DMX fixtures via a new
   `LED_CLASS_FIXTURE_TYPES` set (`pixel_map_layout.js`). Display/selector
   classification only — the exporter/model bytes and wire transport are
   untouched, so S1's byte-parity test stays green.
2. **TE Sign V3 install** (report `_14`): the titanic scene's `TeLedGrid40`
   placeholders are gone, replaced by `TE Sign V3 A` (`TeSignV3A40`, 40 px) +
   `TE Sign V3 B` (`TeSignV3B34`, 34 px), group `TE Sign`, 74 px total. Applied:
   - `main.js` — the 3-part fixture-model registration patch (2 fetches, 2
     destructure names, 2 load entries). Live console confirms
     `[FixtureRegistry] Loaded 8 fixture type(s): … TeSignV3A40, TeSignV3B34` —
     no `[FixtureModels]` errors, no generic-par fallback.
   - `LED_CLASS_FIXTURE_TYPES` → `{TeSignV3A40, TeSignV3B34}` (TeLedGrid40
     retired); `TYPE_STYLES` gains both sign types.
   - `pixel_map_view_defaults.js` — `te_sign` selects both new types;
     `top_down`/`strands` exclude both (operator spec: top-down = LED bars +
     strands + stack rings; strands = strands ALONE; the sign has its own view).
   - Coupled tests updated (`pixel_map_views.test.js`,
     `pixel_map_te_led_classification.test.js`).
3. **Placement correctness = top priority** (Sina, live). The original
   `spatial`/`planar` seed abstracted each fixture to a centroid + rotated line
   plus collision relaxation — which distorted real positions and pushed pixels
   OFF-canvas (probed a top_down pixel at `cssY:-34`). **Rewrote `expandPanel`:
   `spatial` and `planar` are now TRUE whole-panel projections** — every pixel
   placed at its real world position on the projection plane, then fit to the
   canvas (spatial: aspect-preserving letterbox; planar: cell-pitch scale +
   center). Top-down now genuinely looks like the ship from above (two fixture
   clusters + satellites, cross-checked against the 3D `top` render), front like
   the front, the TE-sign halves interlock into one unified logo along their real
   seam. `radial`/`lanes` keep the per-fixture anchor/line model (editable
   arrangements).

## Bugs found + fixed during integration

- **topoRef mount-ordering race** — the store dispatched the first topology
  before the S3 component's `onTopology` effect registered, so `topoRef` never
  set and rebound panes rendered blank. Fixed with a `getTopo()` fallback that
  reads `deps.currentTopology()` (live `store.list`) + a prime-on-subscribe. All
  four views now render on rebind.
- **off-canvas placements** — see ruling #3.

## Edits inside S1–S3 files (seam edits, justified)

- **`src/gui/pixel_map/pixel_map_layout.js` (S1).** `expandPanel` stamps `fixKey`
  on every pixel (per-fixture selection + edit hit tests need it — the §5
  `expandPanel` shape documents `fixKey`); `buildClusters` LED-class `kind`
  derivation (ruling #1); `LED_CLASS_FIXTURE_TYPES` + `TYPE_STYLES` sign entries
  (ruling #2); `spatial`/`planar` rewritten to true whole-panel projection
  (ruling #3). Design docs `spatial`/`planar` as "scoped seed / true 2-D"; the
  projection is the faithful realization the operator demanded. All S1 layout
  tests stay green (grid/line/radial/lanes assertions unaffected; byte-parity
  untouched).
- **`src/gui/pixel_map/pixel_map_view_defaults.js` (S2).** te_sign selects the V3
  pair; top_down/strands exclude it (ruling #2). Header note updated.
- **`src/gui/modern/pixel_map_multiview_panel.js` (S3).** Consumes the real data
  plane via `deps.buildPanels` (persisted placements + edit metadata),
  `deps.attachInteraction`, `deps.subscribeMode`, `deps.subscribeViews`; adds the
  mode/views-change subscriptions, focus publish, `getTopo()` topology fallback,
  and interaction-detach cleanup; the focus-scoped keydown now swallows ALL keys
  while the vis root holds focus (no 3D shortcut ever leaks). No behavioural change
  to the pane-tree model or the mock capture path (`deps.buildPanels` is optional
  with a local fallback).
- **`main.js`.** The report `_14` fixture-model registration patch (owned file).
- `src/gui/pixel_map/pixel_map_renderer.js` (S4-owned) is **retired** — nothing
  imports it now (the panel hosts pane_view via the multiview). Left in place
  (harmless); a follow-up can delete it.

## Verification

- **Sim unit suite: 426 pass / 0 fail** (`node --test tests/*.test.js`) — 410
  baseline + TE-sign slice's 16, with my 2 new files (`pixel_map_expand_fixkey`,
  `pixel_map_te_led_classification`, 4 tests) and the coupled `pixel_map_views`
  updates keeping the total at 426.
- **`git diff --check -- simulation`: clean** (only pre-existing LF/CRLF
  advisories; no whitespace errors).
- **`scene_console_smoke.cjs` titanic + test_bench:** clean of any pixel-map /
  FixtureModels error. Residual noise is pre-existing/environmental (favicon 404,
  save-server `:6970` + LED endpoints down in the render box).
- **`pick_accuracy_test.cjs`: 2/2** split-invariant — the 3D pick path is
  unaffected.
- **Real-GPU perf gate** (`pixel_map_perf_test.cjs`, `--use-angle=gl`):
  1 pane **1.40 ms / 59 FPS**, 2 panes 2.20 ms / 56.6 FPS, 4 panes 4.10 ms /
  58.5 FPS, 6 panes **6.00 ms / 57.7 FPS**; per-pane linearity **0.71×** (≤1.5×
  gate PASS). The 6-pane median (6.0 ms) is modestly over the 4 ms design
  estimate but still sustains ~58 FPS (6 ms is ~36% of a 16.6 ms frame); typical
  1–2 pane use is 1.4–2.2 ms. SwiftShader run is non-authoritative (12 ms/3 FPS).
- **Screenshots (`.agent_renders/s4_*`, all visually inspected):**
  - `s4_view_top_down/front/strands/te_sign.png` — the 4 default views live on
    titanic, each a true spatial projection (top-down cross-checked vs the 3D
    `top` render `1784933119_top.png`); te_sign is the interlocking 74-px sign.
  - `s4_split_4pane.png` — 3–4 pane 2×2 split, a different view per pane (Top-Down
    incl. the two radial chimney rings / Strands / Front / TE Sign).
  - `s4_divider_drag.png`, `s4_zoom.png` — divider resize + per-pane wheel zoom.
  - `s4_views_manager_add.png` — Views manager add (5 rows) + remove round-trip
    (→4, logged).
  - `s4_persist_reload.png` — reload → the 4-pane layout survives (per-scene
    localStorage pane tree).
  - `s4_edit_select.png` / `_zoom` / `_drag` — EDIT mode; selection confirmed
    functionally (clicking a real pixel selects its fixture).

## Gaps / flags

- **EDIT drag is anchor-based (radial/lanes) only.** With `spatial`/`planar` now
  projection-locked to true world positions (operator priority: correctness over
  edit polish, "the dropdown is enough"), per-fixture DRAG has no anchor to move
  there — SELECTION still highlights the fixture, but a drag is a no-op on
  spatial/planar. Radial/lanes stay fully editable. Flagging as the deliberate
  tradeoff, not a silent regression.
- **TE-sign geometry (for the TE-sign agent's deferred checks).** The two halves
  now interlock into one unified logo via the shared-frame `planar` projection
  (screenshot `s4_view_te_sign.png`). The projection uses the tightest combined
  world cell as the pitch; if A and B carry different dot pitches the seam
  spacing could read slightly off — worth confirming in their chase-direction /
  seam-spacing pass. Nothing looked obviously wrong (a clean symmetric diamond),
  but I did not measure the seam.
- **Scene-YAML views round-trip** is wired (`toParams` ↔ `createViewsContainer`,
  proven by S2 unit tests) but could not be exercised across a live disk reload
  because the save-server (`:6970`) is down in the render env; the pane-layout
  localStorage round-trip WAS proven live (4-pane survived reload).
- **`view:` custom-view selectors** resolve group-only (S2 known limit) — no
  default view uses one.
- **`pixel_map_renderer.js`** is now dead code (retired) — safe to delete in a
  follow-up.

Report path: `.agent/reports/202607/20260724_13_2dvis_s4_integration.md`
