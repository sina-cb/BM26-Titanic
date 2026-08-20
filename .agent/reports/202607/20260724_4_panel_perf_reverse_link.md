# 2026-07-24 — Mapping panel incremental render (G2) + reverse-link completion (G5), split flipped to map-left

Slices 3+4 of `20260724_0_mapping_readiness_review.md` §6.3–6.4, building on the
Slice 2 split shell (`20260724_2_split_screen_shell.md`). Implementer session
(Opus). Branch `feat/bm_readiness`. **No git ops, no commits — all changes
uncommitted in the working tree.** Sim stack left running on the standard ports
(:6969–:6972); every change is client-side, picked up on a fresh page load.
Screenshots in `.agent_renders/panel_*.png`, all visually inspected. Boot reads:
`AGENTS.md`, `.agent/codex.md`, the three 20260724 reports, `nodejs_style.md`,
`ui_design.md`, `sim_auto_checks.md`, `see_the_world.md`.

---

## 0. TL;DR

- **G2 (the felt lag) fixed.** A 3D-click selection no longer tears down and
  rebuilds `#cm-body` or recomputes any projection. The selection hot path
  dropped from **median 19.1 ms → 1.8 ms** (p95 26.9 → 2.8 ms) on a fully
  auto-patched titanic — a **~10×** cut, measured before/after with the same
  instrumented puppeteer probe.
- **G5 (reverse link) completed, both directions, DMX + LED strands.** A 3D pick
  now **scrolls the matching chip into view** and highlights it; clicking a chip
  **selects the fixture/strand in 3D and flies the camera to frame it** (gated by
  a new "Camera Follows Chip" toggle, default on). LED strands — which had **no**
  reverse link — now locate both ways.
- **G3 folded in** (it lived in code I was already editing): the two
  render-thread-freezing `window.prompt()` gap-width calls are replaced with a
  non-blocking inline modal.
- **Operator scope change landed:** the split now docks the **mapping pane on the
  LEFT** and the 3D sim on the right, and the **right-edge Lighting Controls
  drawer stays open during mapping** (the operator drives its fixture/DMX-group
  lists to find lights on the unlabeled ship). The **left-edge Pattern Editor**
  yields for the session and returns when the map closes.
- All **284** sim unit tests pass; `pick_accuracy_test` is **2/2 split-invariant**
  after the canvas moved right; titanic + test_bench load with no new console
  errors; `git diff --check` clean.

---

## 1. What changed (files)

| File | Change |
|---|---|
| `simulation/src/gui/controller_map_editor.js` | **G2:** new `computeRenderProjection()` computes the DMX projection + both LED field maps + LED claims + manual-universe warnings **once per structural render** (was 3–4× + once per LED port). New `syncSelectionUi()` patches only chip highlights + "+ sel (n)" counters + scroll-to-chip — the light path `window.syncControllerMapSelection` that interaction.js now fires on a pick; no DOM teardown, no reprojection. Chips carry `data-cm-fixture`/`data-cm-kind`; "+ sel" buttons carry `cm-sel-btn` and read the CURRENT selection at click time. **G5:** `selectStrandIn3D()` + `focusCameraOn()`; DMX-fixture and strand chips (mapped + unmapped-tray) locate + camera-focus in 3D; new "🎯 Camera Follows Chip" toggle (localStorage `bm26.map.cameraFocusOnChip`). **G3:** `promptForGapWidth()` non-blocking modal replaces both `window.prompt()` sites. |
| `simulation/src/core/interaction.js` | The two selection-change call sites (pick + empty-click) now fire `window.syncControllerMapSelection` (light) instead of `window.refreshControllerMapPanel` (full render). Undo + the unpatched-overlay toggle keep the full-render hook. |
| `simulation/src/gui/view_presets.js` | Factored the eased camera move into `animateCameraTo()`; new exported `focusCameraOnPoint(point, opts)` (keeps the current view direction, pulls back to a legible 28–90u distance) exposed as `window.focusCameraOnPoint`. |
| `simulation/src/gui/split_layout.js` | **Flip:** map pane docks LEFT (`dockPanel(0, mapW)`), divider at `mapW`, canvas shifted RIGHT via new `placeCanvas(mapW+DIVIDER_W)`; `slidePanelOff` slides left; divider drag sign flipped (drag right grows map); restore tab + chevron on the left. **Drawer policy:** stop hiding the right Lighting Controls drawer; instead `setLeftDrawersVisible(false/true)` on engage/disengage yields the left Pattern Editor for the session. |
| `simulation/style.css` | `#sim-split-restore-tab` → left edge; `.cm-split-docked` shadow → right; new `.cm-camera-focus-toggle` (full-width, ok-tinted when ON). |
| `simulation/agent_tools/panel_perf_test.cjs` | **NEW** repeatable latency probe (before/after; below). |
| `simulation/agent_tools/panel_capture.cjs` | **NEW** repeatable screenshot tool (split/drawer states + reverse-link demos). |
| `simulation/agent_tools/scene_console_smoke.cjs` | **NEW** per-scene console-error smoke. |
| `simulation/agent_tools/pick_accuracy_test.cjs` | Collapses the (now-visible) Lighting Controls drawer before testing so clicks aren't occluded — isolates the raycaster NDC check. |

**Architecture note.** The map renderer is deliberately split into two entry
points: **structural** (`renderIfOpen` → `render()`, full rebuild, on data
mutations) and **selection** (`syncSelectionUi`, DOM patch only). interaction.js
only ever changes *selection*, so it takes the light path — that is the entire
G2 win. This keeps the door open for the companion-app renderer (design §3.5):
the selection sync is a pure DOM patch over `data-cm-*` markers, not coupled to
`three`/`window` beyond the camera-focus call.

---

## 2. Before/after latency (G2)

`node agent_tools/panel_perf_test.cjs --iters 40`, titanic, map pane open, whole
rig Test-Auto-Patched (595 `#cm-body` nodes, 100 chips), SwiftShader. It times
the exact function interaction.js fires on a 3D pick.

| Metric | Before (full render) | After (selection sync) |
|---|---|---|
| refresh() bare — median | **19.10 ms** | **1.80 ms** |
| refresh() bare — mean / p95 / max | 19.49 / 26.90 / 27.80 ms | 1.84 / 2.80 / 6.70 ms |
| selection round-trip — median | **12.30 ms** | **1.80 ms** |
| selection round-trip — mean / p95 | 15.54 / 26.40 ms | 1.71 / 2.60 ms |
| correctness | 1 chip `cm-chip-selected` ✓ | 1 chip `cm-chip-selected` ✓ |

The 16–38 ms the review measured is gone; selection is now a sub-2 ms DOM patch.
(Numbers are SwiftShader software-GL per the agent render path — a real GPU will
differ, but the ~10× ratio is methodology-independent.)

## 3. Verification

### Auto-checks (`.agent/ops/sim_auto_checks.md`)
- `git diff --check -- simulation`: **PASS** (only benign LF→CRLF warnings on
  `common.yaml`/`manifest.json`, untouched by this slice).
- `node --check` on every changed/new JS/CJS file: **PASS**.
- `cd simulation && npm test`: **284 pass / 0 fail**.
- Console-error smoke (`scene_console_smoke.cjs`, open map → auto-patch → 3D
  select → chip click → close) on **titanic** and **test_bench**: **no
  `pageerror` / uncaught JS**. Remaining lines are pre-existing environment
  noise — a 404 and `ERR_CONNECTION_REFUSED` to the sACN/engine bridges not
  running in the harness — none from the changed modules.

### Pick-accuracy (`pick_accuracy_test.cjs`) — the load-bearing raycaster guard
After the flip the canvas shifts RIGHT (`left = mapW + DIVIDER_W`). Because the
raycaster reads `getBoundingClientRect()` (Slice 2 fix), a correct x-offset keeps
picks accurate. Result: **2/2 targets split-invariant across all 4 pane widths**
(full → map-55%). During the first run the picks "drifted" only because target
fixtures projected UNDER the now-visible Lighting Controls drawer and clicks hit
the panel — the test now collapses that drawer to isolate the NDC math; the
raycaster itself was correct at every width.

### Screenshots (`.agent_renders/panel_*.png`, all visually inspected)
- `panel_{laptop,wide}_split_map_left_*.png` — mapping pane docked LEFT, 3D sim
  center/right, **Lighting Controls drawer open on the right simultaneously**,
  Pattern Editor yielded, new green "Camera Follows Chip: ON" toggle present.
- `panel_{laptop,wide}_before_patterneditor_left_*.png` /
  `..._after_patterneditor_restored_*.png` — Pattern Editor docked LEFT before
  mapping, restored after close (hidden during — probe logged visible→hidden→
  visible).
- `panel_reverse_3d_to_chip_highlight_*.png` — 3D pick of "Left Back Deck
  Generator 4" → its chip highlighted **and scrolled into view** at the bottom
  of the chain, gizmo attached in 3D.
- `panel_reverse_chip_to_3d_camera_focus_*.png` — chip "Left Center Auditorium 1"
  clicked → 3D selected + **camera flew 83.8 units** to frame it.
- `panel_reverse_strand_chip_to_3d_*.png` — strand chip "Left_Front_Left" clicked
  → strand selected in 3D (pixels lit) + camera focus; the LED reverse link that
  did not exist before.

---

## 4. Discovered pre-existing bug (out of scope — flagged, not fixed)

`simulation/src/gui/gui_builder.js:1708` — the DMX-group **"select group"** button
handler calls `syncGuiFolders()`, which is a *private* function in
`interaction.js` and is **not imported** there, so the click throws
`ReferenceError: syncGuiFolders is not defined`. The selection still applies (the
add/setSelected run before the throw); only the GUI-folder sync + blur are
skipped. Pre-existing and unrelated to these slices — but it now matters more,
because the operator ruling keeps the Lighting Controls open during mapping and
uses those group-select buttons constantly. **Fix** (one line): expose
`window.syncGuiFolders` from interaction.js (mirroring `window.deselectAllFixtures`)
and call it via `window.syncGuiFolders?.()`. Filed as a background task.

## 5. Known gaps / risks

- **Panel occlusion of the sim's right edge.** With the map pane on the LEFT and
  the Lighting Controls drawer on the RIGHT, a fixture that projects under the
  drawer can't be picked (the click hits the panel). This is inherent to "both
  drawers usable at once" — the operator can collapse the drawer (B) when
  picking near the right edge. The pick test collapses it to isolate the
  raycaster; it is not an NDC bug.
- **Drawer visibility vs the global H toggle.** `setLeftDrawersVisible(true)` on
  map-close will re-show the Pattern Editor even if the operator had H-hidden it
  mid-session — the same accepted edge Slice 2 noted for the right drawer. Once
  per open/close transition only.
- **Camera-focus distance is heuristic** (28–90u pull-back keeping the current
  view direction). It frames the fixture legibly but isn't a tight fit; fine for
  "find it," not a cinematic move.
- **Strand selection stickiness** (pre-existing): the 3D `_selected` flag on a
  strand isn't cleared by an empty-space click (only par selection is). The panel
  mirrors that state, so an unmapped strand chip can stay highlighted until a par
  is picked. Par selection always wins in `syncSelectionUi`, so it never
  mis-highlights during DMX work. Left as-is (beauty-view behavior, out of scope).
- Perf/FPS numbers are SwiftShader per the agent render path; the render-loop
  ~1 FPS (G1) is untouched — a separate slice.

## 6. Out of scope (untouched)

G6/G7/G8/G9, emitter instancing, engine changes, split-layout rework beyond the
operator's left-dock flip, and the render-loop perf root-cause (G1). No git ops.
