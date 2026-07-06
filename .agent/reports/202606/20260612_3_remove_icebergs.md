# Slot 3 — remove_icebergs

- **Branch:** dev/claude/remove_icebergs
- **Parent branch:** claude/nice-cerf-bl2jnk (created at 6d603f5)
- **Worktree:** ~/BM26-Titanic-worktrees/remove_icebergs
- **Slot ports:** sim HTTP 31369, sACN bridge 31371, sACN out 31372, engine 31368.
  Save server ran on **6970** instead of slot 31370: the browser code hardcodes
  `http://localhost:6970` for every save/export POST, so the slot port would have
  made model regeneration impossible. 6970 was verified free (`lsof`) before use,
  and `simulation/config.yaml` was reverted before committing.

## Scope

Operator request (2026-06-12): "Remove all references to the icebergs in the
code, configs, and all places." Icebergs were a legacy fixture type (floating
peaked LED sculptures with floods) retired from the design. This is a wholesale
deletion refactor — fixture class, GUI section, state/undo/config plumbing,
exporter branch, scene data, view bits, cached geometry, and doc mentions —
with no compatibility shims and no warning scaffolding.

## Files changed

`git diff --name-status 6d603f5..HEAD` (29 files, +998 −9,936):

```
D  simulation/src/fixtures/iceberg.js            (570 LOC — fixture class)
D  simulation/assets/iceberg_*.stl               (4 cached berg meshes)
M  simulation/src/core/state.js                  (params.icebergs default)
M  simulation/src/core/config.js                 (extract/reconstruct branches)
M  simulation/src/core/environment.js            (boot instantiation loop + import)
M  simulation/src/core/interaction.js            (raycast select + transform branches)
M  simulation/src/core/undo.js                   (snapshot/restore/rebuild)
M  simulation/src/dmx/pixelblaze_model_exporter.js  (iceberg pixel export branch)
M  simulation/src/dmx/view_registry.js           (comment only — logic is generic)
M  simulation/src/gui/gui_builder.js             (entire buildIcebergsSection ~300 LOC,
                                                  icebergArray dispatch, import,
                                                  showHelpers flood toggle, comments)
M  simulation/src/gui/view_masks_editor.js       (fixture list + isIceberg branch)
M  simulation/main.js                            (titanicEnd/icebergs section order)
M  simulation/start.js                           (enable_iceberg flag)
M  simulation/style.css, simulation/README.md    (comments / enable_iceberg note)
M  simulation/scenes/{test_bench,titanic,summer_camp_dome,summer_camp_logsville}/
     scene_config.yaml                           (whole titanicEnd icebergArray block;
                                                  titanic carried the 4 real bergs)
M  simulation/scenes/titanic/views.yaml          (Berg Alpha/Beta/Gamma/Delta bits)
M  marsin_engine/models/titanic.js + .viewmasks.js  (regenerated via sim export)
M  marsin_engine/lib/view_mask_constants.js      (Berg example names in comments)
M  marsin_engine/tests/view_mask_constants.test.js  ('Berg Alpha' sample → 'Crow Nest')
M  simulation/tests/controller_registry.test.js  ('Berg 1'/'Bergs' sample → 'Mast 1'/'Masts')
M  .agent/01_skills/00_see_the_world.md          (render-expectation rows mentioning bergs)
```

## Freed view bits

The titanic scene's 4 per-berg group bits are released: `0x04000000`,
`0x08000000`, `0x10000000`, `0x20000000`. Titanic now uses **26 of 31** bits
(was 30/31 — directly addresses the bit-exhaustion pressure flagged in
`20260612_2_titanic_gap_analysis.md`). The regenerated
`marsin_engine/models/titanic.js` dropped the 4 berg pixels (976 → 972); the
sidecar dropped the 4 Berg groups; pixel normalized coords renormalized to the
berg-free bounding box (the bergs at x≈±64/z≈±71 dominated it) — that is the
bulk of the model diff and is correct.

## Kept on purpose (intentional leftovers)

- `marsin_engine/patterns/50_iceberg_fracture.js`, `52_iceberg_shear_line.js`
  (+ `patterns/manifest.json` and the playlist entries in
  `scenes/{test_bench,summer_camp_dome}/playlists/*.yaml`): ice-**themed**
  patterns rendering on TriangleEdges/TrianglePars/BarLights — they never touch
  iceberg fixtures, groups, or MASK_BERG_* constants. Removing them would
  delete working rig patterns and break playlists for no fixture-related gain.
- `marsin_engine/lib/global_effect_library.js` / `global_effect_slot_manager.js`
  presets `iceberg_flash` / `iceberg_cyan` (+ their echoes in
  `marsin_engine/states/*/global_effect_slots.yaml` runtime state): thematic
  names for whole-rig dropHit/tint effects, not fixture-bound.
- `design_intent.md` and `docs/*` (e.g. `02_ice_ice.md`, `06_pixelblaze_engine.md`):
  dated design records / operator-authored intent — left as history, same
  policy as `.agent/02_reports/`.
- `.agent/02_reports/202603..202606/*`: historical reports, explicitly out of scope.

## Tests run

- Unit (sim): `npm test` — **62/62 pass** (includes the renamed
  controller_registry samples).
- Unit (engine): `node --test tests/*.test.js` — **525/526 pass**. The single
  failure (`audio_config.test.js`, kickEma contract surface) is **pre-existing**:
  it fails identically on the parent branch in the operator's main checkout and
  touches nothing in this diff.
- Syntax: `node --check` clean on all 13 touched JS files.
- Sim smoke (headless xvfb + puppeteer, 1280x720, webgl/SwiftShader, slot HTTP
  31369), both `?scene=test_bench` and `?scene=titanic`: **zero page errors**;
  `window.icebergFixtures` / `window.rebuildIcebergs` undefined; GUI text
  contains no "iceberg"; Views panel and `window.__viewRegistry` contain no
  Berg groups (titanic: 26 groups); fixtures render (test_bench 10 pars,
  titanic 61 pars + 16 strands). Screenshots visually inspected
  (`~/tmp/smoke_{test_bench,titanic}.png`): both scenes render, GUI section
  order goes Atmosphere → Model Transform → Layout Tools → DMX Fixtures →
  LED Lights with no Icebergs section, and no berg geometry in the scene.
  Remaining console noise was engine-offline (6968) and the browser's
  hardcoded ws 6972 vs slot bridge 31372 — infra-only, unrelated.
- Engine HIL-lite: `node engine.js --model titanic --pattern 01_cylon_sweep
  --port 31368` on the regenerated model — loaded 972 px, validated the new
  sidecar, rendered 747 frames, clean shutdown.
- Residue hygiene: reverted `marsin_engine/states/`, playlist regeneration
  residue, timestamp-only regenerations of `test_bench.*` / `titanic.effects.js`
  models, and the local `simulation/config.yaml` port edits. `git status` clean
  after commit. All servers killed; slot ports verified free.

## Known gaps / follow-ups

- `params.focusOnSelect` (camera fly-to on select, shared with the trace
  generator GUI) was persisted inside the deleted icebergs YAML section. The
  generator GUI still offers the toggle but now boots with its built-in default
  (`true`, previously saved as `false` in the scenes) and the value is no
  longer persisted. If the operator wants it saved again, it needs a small
  home in the options section — deliberately not added here (deletion refactor).
- The browser save/export code hardcodes port 6970 (and ws 6972) — worktree
  slot ports can't fully apply to the save path. Worth a follow-up card if
  multi-agent sim work keeps needing real saves.
- `summer_camp_*` engine models were untouched (their scenes had `icebergs: []`,
  so no berg pixels existed there).

## Operator action requested

Ready for review and merge.
