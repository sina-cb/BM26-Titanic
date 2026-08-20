# Investigation: LED strand move leaves pixel trail + selection/orange line never clears

**Mode:** bug (diagnosis only — no source edits)
**Branch + commit reviewed:** feat/bm_readiness @ d091977b (+ uncommitted working tree)
**Live repro:** yes — against the already-running stack, sim :6969, scene `titanic` (own puppeteer page; operator stack untouched, not restarted)
**Probe:** `~/tmp/led_move_trail_probe/probe.cjs` (throwaway, safe: `params.autoSave=false` scene default verified before any mutation — zero disk writes)

## TL;DR

All three operator symptoms reproduce live and have exactly **two root causes**:

1. **Pixel trail** — the 3D-handle move path (`window._onStrandTransformChange`,
   `simulation/src/gui/gui_builder.js:4329-4337`) never calls
   `invalidateMarsinBatchCache`, so the global instanced-dot mesh, the 2D pixel
   map entries, and the engine's normalized pattern coords all keep the strand's
   OLD pixel positions. The strand's own bulb/halo meshes move; the batch-list
   consumers don't → ghost pixels left behind. Measured: after a +4x/+4y move,
   **40/40 global dots still at the old line, 40/40 strand bulbs at the new line**.
2. **Selection + orange line persist** — `deselectAllFixtures()`
   (`simulation/src/core/interaction.js:98-105`) only clears PAR fixtures.
   Nothing on the click-away path (interaction.js:489-495) or Escape path
   (interaction.js:541-543) ever calls `LedStrand.setSelected(false)`, so
   `_selected` stays true and the selection glow tube
   (`simulation/src/fixtures/led_strand.js:157`, `tube.visible = this._selected`)
   keeps rendering. The tube is colored `config.color` (led_strand.js:146-154);
   7 of 8 titanic strands are `#ff8800` → **the persistent "orange line" IS the
   selection glow tube**. The GUI card highlight (`gui-card-selected`) sticks too.

Both mechanisms are **longstanding** (present since the main.js split,
30495f12; the handler body is byte-identical there). Nothing in the current
uncommitted diff introduced them — the recent LED-wave work (34c8c52f: guides
hidden by default, strand groups/generators) made strand editing a primary
workflow and exposed them.

## Repro steps (probe, all programmatic checks + screenshots)

1. Open `http://127.0.0.1:6969/simulation/?scene=titanic&profile=full&renderer=webgl`
   in a fresh page (operator stack already running — NOT restarted).
2. Wait for load; verify `params.autoSave === false` (safety gate — probe aborts otherwise).
3. `window.openStrandFolder(0)` (the GUI selection path) → strand 0
   `Left_Front_Left` selected, handles visible.
4. Real canvas click on the projected start-handle position → real pick path:
   `transformControl.attach(handle)` (verified `tc.object.userData.isLedStrand === true`).
5. Simulate the drag exactly as TransformControls does: mutate
   `startHandle.position` / `endHandle.position` in 6 steps, dispatching
   `{type:'change'}` on the TransformControls instance each step
   (`main.js:229` binds change → `onTransformChange` → strand branch
   `interaction.js:231-234` → `_onStrandTransformChange`). Total move +4x/+4y,
   both endpoints (rigid).
6. Count global-dot instances within 0.4 wu of the OLD vs NEW per-pixel lerp
   positions; same for the strand's own `bulbInst`.
7. Real mouse click on empty sky; oracle that the empty branch ran:
   `transformControl.object === null` (the branch calls `detach()`,
   interaction.js:490-494). Then press Escape and re-check.

### Measurements (probe output, ts 1784994218)

| Check | Result |
|---|---|
| Global dot mesh (root InstancedMesh, 981 instances) — dots near OLD strand line | **40** (all of the strand's pixels) |
| — dots near NEW strand line | 1 (coincidental unrelated pixel) |
| Strand `bulbInst` instances near NEW line / OLD line | **40 / 0** |
| `config.startX/startY` after move | -27.5 / 6.5 (write-through worked) |
| After empty-space click: `tc.object === null` (empty branch ran) | true |
| — `strand._selected` | **true (bug)** |
| — glow tube `.visible` | **true (bug)** |
| — endpoint handles visible | **true (bug)** |
| — GUI card `gui-card-selected` class | **true (bug)** |
| After Escape: `_selected` / tube visible | **true / true (bug)** |

### Screenshots (`.agent_renders/`, visually inspected)

- `1784994218_trail_1_before.png` — baseline, strand at original position.
- `1784994218_trail_2_selected.png` — strand selected: teal glow tube + handles
  (strand 0 is `#00ffaa`; the operator's strands are `#ff8800` → orange tube,
  same mechanism).
- `1784994218_trail_3_after_move.png` — **the trail**: strand tube/bulbs moved
  up-right, a dotted line of ghost pixels (global dot mesh) still lit along the
  OLD diagonal, gizmo attached.
- `1784994218_trail_4_after_clickaway.png` — **the sticky selection**: gizmo
  GONE (detach ran ⇒ the click really was processed as empty-space), but glow
  tube + handles + ghost trail all persist.
- `1784994218_trail_5_after_escape.png` — same after Escape.

## Root cause per symptom (file:line)

### 1. Pixel trail on move

- `simulation/src/core/interaction.js:231-234` — `onTransformChange` branches to
  `window._onStrandTransformChange(obj)` and **returns early**, so the
  `invalidateMarsinBatchCache('transform')` at interaction.js:298 (which every
  PAR/DMX fixture drag hits) never runs for strands.
- `simulation/src/gui/gui_builder.js:4329-4337` — `_onStrandTransformChange`
  does `writeTransformToConfig` + `rebuildVisuals` + `debounceAutoSave` and
  nothing else. No invalidation. (Byte-identical since 30495f12.)
- `simulation/src/core/animate.js:536-592` — the per-frame V2 dot flush writes
  **colors only**; instance **matrices** are written only when `touchMatrices`
  (view isolation) is active (L544-559) or on a full `_rebuildBatchCache()`
  (L130-225). Positions come from `entry.wx/wy/wz`, snapshotted at build time.
- `simulation/src/dmx/pixelblaze_model_exporter.js:393-395` — LED entry x/y/z
  are lerped from the strand config **when `generatePixelMap()` runs**, i.e.
  only on rebuild. So until something else bumps `_batchCacheVersion`, every
  batch-list consumer holds the old positions.

**Stale-consumer blast radius** (all cured by the same invalidation, all rebuilt
from `generatePixelMap()` in `_rebuildBatchCache`):
- Global instanced-dot mesh — the visible ghost trail (proven above).
- Engine pattern coords `_batchCoords` (animate.js:173-180) — patterns keep
  painting the strand as if it were at the old location, and those colors go to
  the wire; the sACN **patch addresses** (`entry.patch`) are position-independent,
  so routing is unaffected, only pattern-space geometry.
- 2D Pixel Map tap — `onPixelFrame` hands out the same `_batchRenderList`
  (animate.js:40-57, 594-597); its layout keys off the stale entries until the
  built-version bumps.

**Asymmetry that confirms the diagnosis:** the GUI Start/End sliders
(gui_builder.js:4896-4912) call `rebuildLedStrands()` on every tick, which DOES
invalidate (gui_builder.js:4324, `'led_strands_rebuilt'`). Moving a strand via
sliders leaves no trail; moving via 3D handles does.

### 2 + 3. Selection not cleared / orange line persists (one cause)

- `simulation/src/core/interaction.js:98-105` — `deselectAllFixtures()` iterates
  `selectedFixtureIndices` → `window.parFixtures` only. LED strands are not in
  that set; their selection state is per-fixture `_selected`.
- Empty-space click (interaction.js:489-495) and Escape (interaction.js:541-543)
  call `transformControl.detach()` + `deselectAllFixtures()` — the gizmo goes,
  the strand stays selected. Picking a PAR (L477) or trace (L461) likewise never
  clears strands.
- The ONLY strand deselect paths are GUI-side exclusive selects:
  `openStrandFolder` (gui_builder.js:4577-4579), `selectStrandGroup`
  (gui_builder.js:4534-4539), and the rename flow (4845). So the operator can
  only "deselect" a strand by selecting a different strand.
- The orange line: `led_strand.js:146-159` — the selection glow tube is a
  cylinder colored `this.config.color`, `tube.visible = this._selected` (L157,
  re-applied in `_applyVisibility` L331-341, which also keeps the endpoint
  handles visible while selected). Titanic strand colors: 7×`#ff8800` (orange),
  1×`#00ffaa` (`simulation/scenes/titanic/scene_config.yaml:1743-1848`).
- The GUI card keeps `gui-card-selected` because only `openStrandFolder`
  removes it (gui_builder.js:4569); `syncGuiFolders` (interaction.js:180-198)
  touches `window.parGuiFolders` only.

### Which change introduced it

Neither is a fresh regression. `git log -S`: the strand transform handler has
lacked invalidation since the main.js split (30495f12); the tube has been
selection-gated and `deselectAllFixtures` PAR-only equally long. The global dot
mesh (the trail's visible surface) predates the LED-wave day. The 20260724
LED-wave campaign (34c8c52f + uncommitted tree) made strand editing a
first-class workflow (guides hidden by default, groups, generators), which is
why the operator is hitting both now. The current uncommitted diffs
(trace-rename fix in gui_builder, DMX gate in animate.js) do not touch these
paths.

## Honesty notes

- The drag was simulated by mutating handle positions + dispatching real
  `{type:'change'}` events on the live TransformControls instance — the exact
  handler chain a physical gizmo drag fires (main.js:229). The pointer-down/up
  `dragging-changed` bracket (main.js:194-228) was not exercised; it contains
  no strand logic (PAR rigid-move capture only), so this does not affect the
  diagnosis.
- Click-away and Escape used real `page.mouse.click` / `page.keyboard.press`.
- Probe page briefly ran with sACN-out enabled: `window.__readonlyMode` is
  overwritten from the URL at main.js:267, clobbering my pre-load flag (the
  right way is `&readonly=1`). The sim's own "2 sim windows connected" banner
  flagged the contention (visible in the screenshots); the probe browser was
  closed at the end of the run. Transient, self-healed.
- Screenshots show the engine-model STALE banner (engine on :6968 is serving
  `test_bench`, 132→206 px) — pre-existing operator-stack state, unrelated to
  these bugs; strand pixels were lit via the sACN-in path regardless.
- Tested strand 0 (teal). The orange color of the operator's line is config
  data, not a separate mechanism.
- SwiftShader rendering; not pixel-accurate to the show GPU. Irrelevant to
  geometry/selection evidence.
- No sim/engine source files were edited; no git operations; no state files
  written (autoSave false verified in-page before any mutation).

## Fix plan (for the Opus implementer)

### Fix 1 — trail: invalidate the batch cache on strand handle moves

- **File:** `simulation/src/gui/gui_builder.js`, `window._onStrandTransformChange`
  (L4329-4337).
- **Mechanism:** after `fixture.rebuildVisuals()`, invalidate the marsin batch
  cache exactly the way `rebuildLedStrands` does at L4324
  (`window.invalidateMarsinBatchCache('strand_transform')` guarded by the same
  existing-pattern `if`). Next frame, `_rebuildBatchCache()` re-runs
  `generatePixelMap()` → dot mesh, 2D map, engine coords, and sACN pattern
  geometry all pick up the new positions. This is the same per-tick cost the
  Start/End sliders already pay (they call `rebuildLedStrands()` per onChange
  tick, which is strictly heavier — it also destroys/recreates every LedStrand).
- **Perf note (optional, not required for correctness):** this fires per
  drag-frame. If drag FPS on the titanic scene (981 px) degrades noticeably,
  throttle the invalidation (e.g. ≥100 ms between bumps) and add one final
  invalidation on drag end — but ship the simple version first and measure;
  matching the existing slider behavior is the low-risk baseline.
- **Regression risks:** none identified beyond drag-time FPS; invalidation is
  already fired from ten call sites, and `_rebuildBatchCache` is
  re-entrant-safe (version latch, animate.js:385/411/445/474/483).

### Fix 2 — sticky selection + orange line: teach deselect about strands

- **File:** `simulation/src/core/interaction.js`, `deselectAllFixtures()`
  (L98-105).
- **Mechanism:** in addition to the PAR loop, iterate
  `window.ledStrandFixtures || []` calling `setSelected(false)` on each, and
  clear the strand GUI card highlight: remove `gui-card-selected` from each
  entry of `window.strandGuiFolders || []` (mirror of what `openStrandFolder`
  does at gui_builder.js:4569-4573). Doing it inside `deselectAllFixtures`
  automatically covers every entry point: empty-space click (L491), Escape
  (L542), picking a trace (L447/L461), picking a PAR (L477), and the delete/
  duplicate flows — no per-call-site edits.
- **Why not a gui_builder-side helper:** `deselectAllFixtures` already reads
  `window.parFixtures` directly; reading `window.ledStrandFixtures` the same
  way avoids a new import cycle and keeps ONE deselect authority.
- **Regression risks to check:**
  - Strand pick branch (interaction.js:463-465) calls `deselectAllFixtures()`
    *before* `openStrandFolder(index)` — order already correct; the picked
    strand is re-selected right after. Keep that order.
  - GUI-side flows that select strands (`openStrandFolder`,
    `selectStrandGroup`, group Select-All at gui_builder.js:4534-4539, rename
    at 4845) do not route through `deselectAllFixtures` — unaffected.
  - `window.ledStrandFixtures` is undefined before the GUI section builds —
    guard with `|| []`.
  - The TE Sign halves are PAR-class fixtures (params.parLights) — untouched by
    this change.

### Verification recipe (implementer MUST run)

1. Re-run the probe (copy `~/tmp/led_move_trail_probe/probe.cjs`; it is
   self-contained, safe with autoSave=false, and prints JSON). Expected after
   the fix:
   - `dotsNearOldPositions: 0`, `dotsNearNewPositions: ≥ ledCount` (40),
   - `clickAway.strandStillSelected: false`, `tubeStillVisible: false`,
     `handlesStillVisible: false`, `guiCardStillHighlighted: false`,
   - `escape.strandStillSelected: false`.
2. Screenshots (skill `see_the_world` conventions, visually inspect): after a
   handle move there must be NO ghost dots at the old position; after
   click-away NO glow tube/handles.
3. Open the 2D Pixel Map (`M`) after a strand move — the strand's cluster must
   sit at the new position without a stale copy.
4. `cd simulation && npm test` — must stay **542/542 green**.
5. Drag-perf sanity on the titanic scene: FPS during a strand-handle drag
   should stay in the same band as a Start/End slider scrub (both now rebuild
   per tick).

## Out of scope (intentional, filed as observations)

- **Locked strand groups don't rigid-move on 3D handle drags** — the lock is
  honored by the numeric sliders (`applyLockedStrandNumericMove`,
  gui_builder.js:4896-4912) but `_onStrandTransformChange` moves a single
  endpoint only; `computeRigidMoveIndices` (interaction.js:207-218) is
  PAR-only. Behavioral gap, not part of the reported symptoms.
- Engine-side model staleness banner (test_bench vs titanic) — pre-existing
  operator-stack state.
