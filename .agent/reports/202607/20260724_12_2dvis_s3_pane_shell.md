# 2026-07-24 — 2D vis multiview, Slice S3: pane shell (implementation)

Implementer S3 of the 2D-vis multiview wave (project bm_readiness_mapping,
branch `feat/bm_readiness`). Built in parallel with S1 (geometry/frame core)
and S2 (view model) in the shared working tree, strictly disjoint file
ownership. **No git ops, no commits.** Spec: `20260724_9_2d_vis_multiview_design.md`
(§5 contracts, §6 test plan, §2.3 pane-tree model).

## What landed (my 5 files + 2 tests, all NEW)

| File | Role |
|---|---|
| `simulation/src/gui/pixel_map/pixel_map_pane_tree.js` | Pure binary split-tree model + ops + serialize/validate + per-scene localStorage persistence. Zero deps (no DOM/canvas/signals). |
| `simulation/src/gui/pixel_map/pixel_map_pane_view.js` | One pane: own Canvas 2D, static off-bezel layer + per-frame lit fills from the shared color buffer, multi-panel weight arrangement, per-pane zoom/pan/mode, fillRect fast path, loud error banner. No cross-slice imports. |
| `simulation/src/gui/modern/pixel_map_multiview_panel.js` | Preact container: renders the tree, draggable dividers, per-pane headers (view-binding dropdown + split/close/zoom), focus-scoped keybindings, injects its own CSS (style.css untouched). |
| `simulation/agent_tools/pixel_map_perf_test.cjs` | Per-frame draw-cost probe, 1/2/4/6 panes, ~1200px, relative linearity gate. |
| `simulation/agent_tools/pixel_map_capture.cjs` | Screenshots the real multiview shell with a mock data plane (single / 4-pane / error-banner). Output prefix `s3_*`. |
| `simulation/tests/pixel_map_pane_tree.test.js` | 41 tests — every tree op + serialization + persistence. |
| `simulation/tests/pixel_map_pane_view.test.js` | 10 tests — the pure geometry helpers. |

## Contract conformance (§5) — one intentional, contract-preserving deviation

- **Pane tree**: exactly the §2.3 model — `node := {split,ratio,a,b} | {view}`,
  `state := {root, focus, zoom}`, serialized form is the literal node shape.
  Ops: `splitPane / closePane / setRatio / bindView / toggleZoom / moveFocus /
  cycleFocus / resizeFocused`, all pure (return new state).
- **Pane painter (§5)**: `pane.paint(colorBuf /*Float32Array 3n*/, list, version)`
  — reads pre-decoded colors straight from the shared buffer, never re-decodes.
- **Deviation (deliberate):** `pixel_map_multiview_panel.js` consumes the S1/S2
  §5 functions (`registerPanePainter`, `onTopology`, `resolveView`,
  `seedPanel`, `expandPanel`, `getViewDef`, `listViews`) through an **injected
  `deps` object** rather than a static `import` of the not-yet-existing S1/S2
  modules. Rationale: keeps S3 truly import-disjoint (no dependency on files S1/S2
  are writing concurrently), lets the panel mount + be captured with mocks
  *before* integration, and matches §7 ("S3 imports S1's layout helpers **at
  integration time**"). The `deps` contract is documented at the top of the file
  and mirrors §5 one-for-one. **S4 action:** construct `deps` from the real frame
  source + view model + layout expanders and pass it to
  `mountPixelMapMultiview(host, deps)`; convert to static imports if preferred.

## Keybindings implemented (§2.3, focus-scoped, all `stopPropagation`)

`\` split-v · `-` split-h · `x` close · `z` zoom · `Tab`/`Shift+Tab` cycle ·
`Alt+←↑↓→` directional focus · `[`/`]` prev/next view · `1`–`9` bind Nth view ·
`f` fit · `Ctrl+Alt+←→↑↓` grow/shrink. Every handler stops propagation so the 3D
shortcuts (T/R/S/Q/D/P/H/B/M) never fire from the vis.

## Test numbers

- **Sim suite: 406 pass / 0 fail** (was 293 at my boot; the delta is S1/S2 tests
  landing in the shared tree concurrently). My contribution: **51 tests**
  (41 pane-tree + 10 pane-view), all green.
- Pane-tree coverage: split/close (incl. sibling-collapse focus remap,
  close-last no-op), ratio clamp, bind, zoom toggle/clear-on-structural-change,
  cycle/directional/geometric focus, resize, `computeLayout` tiling +
  divider inset + zoom full-bleed, serialize→deserialize round-trip, deserialize
  rejection of unknown viewId / bad split / bad ratio / non-leaf focus·zoom,
  and localStorage save/load/corrupt-throws/stale-viewId-throws round-trips.

## How I verified the panel pre-integration (unwired)

- `pixel_map_capture.cjs` mounts the **real** Preact multiview with a mock data
  plane on the running dev-server origin (import map → vendored preact/htm; my
  modules by absolute URL; no served harness file added). Three PNGs, visually
  inspected in `.agent_renders/` (`s3_multiview_single/4pane/error_banner_*.png`):
  - single pane: Top-Down view's `main`(w3)+`stacks`(w1) panels tile 3:1, full
    lit grid (fillRect squares + every-7th circle) from the shared buffer;
  - 4-pane 2×2: four independent live viewports (Top-Down / Strands / Front /
    TE Sign), focused pane amber-bordered, headers + dropdowns + buttons;
  - error state: the loud red inline banner "⚠ Broken (demo): unknown selector
    key 'colour'" (codex P0 — no silent empty view).
- `pixel_map_perf_test.cjs` (120 frames/pass, SwiftShader): per-pane draw cost
  **1 pane 2.30ms → 6 panes 1.92ms/pane (0.83×)** — stays linear, PASS on the
  relative gate. 6-pane total vis 11.5ms is SwiftShader software raster (noted
  non-authoritative); the ≤4ms/60FPS absolute gate is a real-GPU check for S4.
- Hardened `pane_view` against degenerate geometry found during capture
  (zero-area pane before layout → negative scale/radius and zero-size
  `drawImage`): `panelTransform` clamps scale ≥ 0, `_shape` no-ops on ≤0 size,
  `paint` skips a zero backing store. Correctness guards, not fallbacks.
- `git diff --check` clean (LF/CRLF warnings are on other agents' files).
- Console smoke titanic + test_bench: my files are **not imported by the live
  app** (verified by grep of main.js/index.html/src), so they cannot break the
  page. Residual 404 / ERR_CONNECTION_REFUSED are pre-existing environmental
  noise (engine ws :6968 + LED endpoints absent), not from this slice.

## Gaps / notes for S4 integration

1. **Wire the data plane.** Build `deps` (see the file header contract) from the
   frame source (`registerPanePainter`/`onTopology`) + view model
   (`resolveView`/`getViewDef`/`listViews`/`seedPanel`) + layout
   (`expandPanel`). `onTopology(fn)` is assumed to call `fn(clusters, list,
   version)`; `currentTopology()` (optional) primes panes on first mount.
2. **EDIT-mode fixture editing** (drag/rotate/nudge writing to per-view
   placements) is left to S4's per-pane `pixel_map_interaction.js` refactor — it
   crosses into S2/S4-owned placement stores. `pane_view` exposes the
   primitives S4 needs: `clientToContent`, `pixelAt`, `setSelection`, and the
   `panelTransform` math. View mode (hover/pan/zoom) hooks are ready to attach.
3. **Panel focus-maximize** within a pane (`setFocusPanel`) is implemented in
   `pane_view`; the multiview panel does not yet surface a click affordance for
   it (design §2.3 "click-to-focus maximize") — small S4 add.
4. **Real-GPU perf gate.** Re-run `pixel_map_perf_test.cjs` on the laptop GPU at
   integration to confirm the ≤4ms/60FPS absolute budget; the SwiftShader number
   here only proves per-pane linearity.
5. Divider-drag maps pointer→ratio via a recomputed parent box each move —
   correct but recomputes layout per pointermove; fine at these pane counts,
   revisit only if it ever feels heavy.

Report path: `.agent/reports/202607/20260724_12_2dvis_s3_pane_shell.md`
