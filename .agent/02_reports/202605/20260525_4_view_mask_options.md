# Slot 4 — view_mask_options

- **Branch:** dev/claude/view_mask_options
- **Parent branch:** dev/summer_camp_readiness (parent SHA 97a3267)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/view_mask_options
- **Slot ports:** engine 31468, OSC 31400 (config.yaml override reverted before commit), sim 31469 (not started), metro 31481 (not started)

## Scope

Operator ask (verbatim): *"the view selection works great, but it only shows the groups, can we add the view masks to the selections too?"*

Extended the engine + CaptainPad mixer view-selection picker to surface named view-mask presets alongside the existing ALL / GROUPS rows, per docs/27 §3.1 and the slot brief. Engine-side: `compileViewSelectionMask` now resolves `{type:'viewMask', target:'<name>'}` against an in-memory dictionary of `{name, bit}` entries supplied by the model. The dictionary is loaded from one of two sources at boot — an inline `export const viewMasks = [...]` on the model file, or a sidecar `<model>.viewmasks.js` that ALSO declares per-entry `pixelIndices` which the engine OR-merges into the corresponding `pixels[i].vMask` at load time. The sidecar path is the preferred one because the auto-generated model file (`test_bench.js` etc.) would otherwise clobber any hand-edited `viewMasks` on the next simulator save. `/model/view-selection-options` returns the dictionary as `viewMasks: [{name, bit, inUse}, ...]` (where `inUse` is true iff at least one pixel has that bit set, used by the picker to dim "no pixels yet" presets without hiding them). `validateViewSelection` accepts BOTH a string name (new, operator-friendly) and a positive integer bitmask (legacy, programmatic). CaptainPad mixer strip: the view-selection modal now renders three sections — ALL, GROUPS, VIEW MASKS — with the view-mask rows tapping through to `{type:'viewMask', target:'<name>'}`; the strip label renders the uppercased name when `viewSel.type === 'viewMask'`. Test_bench got a sidecar with four presets (`ParsOnly` / `VintageOnly` / `BarsOnly` / `MainWash`) so the HIL test (and operators on the rig) have meaningful presets to drive immediately.

## Files changed

```
M  CaptainPad/app/(tabs)/mixer.tsx           # third section (VIEW MASKS) in picker, viewSel label
M  CaptainPad/utils/api.ts                   # fetchViewSelectionOptions return type adds viewMasks
M  marsin_engine/engine.js                   # loadModel reads inline viewMasks OR sidecar + merges vMask
M  marsin_engine/lib/api_server.js           # validateViewSelection accepts string|int viewMask target,
                                              /model/view-selection-options returns viewMasks
M  marsin_engine/lib/pattern_mixer.js        # compileViewSelectionMask resolves string viewMask target
                                              via dictionary, PatternMixer stores viewMasks,
                                              recompileChannelMask threads viewMasks through
A  marsin_engine/models/test_bench.viewmasks.js   # sidecar with 4 named presets for the test bench
M  marsin_engine/tests/pattern_mixer_masking.test.js   # +6 unit assertions for named viewMask path
M  marsin_engine/tests/hil/hil_view_selection_test.mjs # +9 HIL assertions for viewMasks enumeration +
                                                        named-target PATCH + legacy-int still works
```

## Tests run

### Unit (`marsin_engine/tests/pattern_mixer_masking.test.js`)
- `node --test tests/pattern_mixer_masking.test.js` → **33/33 PASS** (was 27, +6).
- New coverage:
  - `compileViewSelectionMask` with string viewMask target resolves via dictionary.
  - `compileViewSelectionMask` with string viewMask + invert flips correctly.
  - Unknown viewMask name produces all-zero mask (loud nothing, not silent all — guard against silent black-out).
  - String target with no dictionary supplied → no pixels selected (defensive default).
  - `validateViewSelection`: viewMask accepts string name; empty string rejected; integer bitmask still works.
  - Full render-loop integration: overlay `setChannelViewSelection({type:'viewMask', target:'Wall'})` paints only the matching pixels, leaves background otherwise.

### Integration / HIL (`marsin_engine/tests/hil/hil_view_selection_test.mjs`)
- Engine: `node engine.js --pattern test_const --model test_bench --port 31468`.
- 26/26 assertions PASS (was 14, +12 covering the new viewMask paths).
- New coverage:
  - `[TEST 7]` `/model/view-selection-options` returns `viewMasks` array, each entry well-formed (`{name:string, bit:int>0, inUse:bool}`). All 4 sidecar presets enumerated (`ParsOnly`, `VintageOnly`, `BarsOnly`, `MainWash`), all `inUse: true` because the sidecar's `pixelIndices` map them to live pixels at load time.
  - `[TEST 8]` PATCH `viewSelection:{type:'viewMask', target:'ParsOnly'}` → 200; round-trips via GET `/mixer`.
  - `[TEST 9]` PATCH malformed targets (object, empty string) → 400.
  - `[TEST 10]` Legacy integer bitmask path still works: PATCH `target: 1` → 200, round-trips.

### Sim smoke
- Not run — this slice is engine + UI only; no sim/scene changes. The HIL covers the full HTTP round-trip the iPad would make and asserts the rendered viewSelection persists through GET `/mixer`.

### CaptainPad
- `npx tsc --noEmit`: 0 errors in `mixer.tsx` or `api.ts` (pre-existing OSC pill-state errors in `osc.tsx` are unrelated and unchanged).
- `npx expo lint`: 0 NEW errors or warnings in `mixer.tsx` / `api.ts`. The 3 lint warnings reported under `mixer.tsx` (`visVersion`, `e`, `fader` unused) all predate this slice.
- No manual smoke on the iPad — Metro wasn't started (no visual UI change beyond the picker addition; the engine wiring and the existing modal+picker structure are validated by the HIL test).

### State hygiene
- Snapshot+restore protocol followed: `marsin_engine/states/test_bench/{audio,deck,globals,mixer}_state.yaml` snapshotted to `~/tmp/view_mask_options_state/` before engine boot, restored after.
- `marsin_engine/config.yaml`: port edits (OSC 31400, audio disabled) made in-worktree to start engine on slot 4, then reverted via `git checkout --` before commit. Final diff carries no config changes.
- All processes killed; ports 31468 and 31400 free.

## Known gaps / follow-ups

- **Pixel `vMask` seeding is sidecar-only.** The simulator's pixelblaze model exporter (`simulation/src/dmx/pixelblaze_model_exporter.js`) writes `vMask: light.viewMask || 0` per pixel. There's no UI in the simulator to set per-fixture `viewMask` yet, so on the auto-generated `test_bench.js` every pixel still has `vMask: 0`. The sidecar approach side-steps this by OR-merging at engine load time, but if/when the simulator gets per-fixture viewMask editing, the exporter should preserve the values and we can deprecate the sidecar's `pixelIndices` field (leaving `viewMasks` declaration where it is).
- **Sidecar is only present for `test_bench`.** `summer_camp_dome`, `summer_camp_logsville`, and `titanic` have no `viewmasks.js` sidecar yet; their `/model/view-selection-options` will return `viewMasks: []` and the picker will hide the VIEW MASKS section. The operator should declare presets for those rigs as they get scheduled.
- **No invert UI in the picker.** Engine + validator + compile path all support `invert: true` for view masks (and groups/sections/fixtures). The picker doesn't expose a toggle yet — this matches the existing GROUP picker behavior and stays out of scope for this slot.
- **Section / fixture targets stay backend-only.** Per slot 1's report and reaffirmed here: they target by numeric id which isn't operator-friendly. If/when we want them in the picker UI we'll need an enrichment endpoint that returns names per section/fixture id.
- **No engine-side render-tick assertion in HIL.** The HIL asserts API round-trip + state persistence; it does NOT read back the rendered pixel buffer to confirm the mask actually masked the right indices on the wire. The unit test's "renderAll6ch with named viewMask only paints those pixels" assertion covers that math end-to-end on a synthetic mixer, so the HIL gap is the WASM-handle path; that's the same gap slot 1's HIL had and is acceptable here.

## Anticipated merge conflicts with other slices

- **Slot 5 (fader_lock)** also edits `marsin_engine/lib/pattern_mixer.js` and `CaptainPad/app/(tabs)/mixer.tsx`. Conflict surfaces:
  - `pattern_mixer.js`: I added `viewMasks` to the `PatternMixer` constructor signature (line ~113) and the constructor body (storage line ~167); I also added the `viewMasks` parameter to `compileViewSelectionMask` (top of file). If slot 5's fader-lock changes also touch the constructor or `setChannelViewSelection`, the merge will need a hand-resolution that keeps both signatures. Lock-button work shouldn't touch these methods, so the conflict is mechanical.
  - `mixer.tsx ChannelStrip`: I extended the `viewSelLabel` block (around line 66), added a `viewSelectionViewMasks` prop, and added a third section + `<ScrollView>` to the showViewPicker modal (around line 180). Slot 5's lock buttons are elsewhere in `ChannelStrip` (top header lock toggle) but if it also touches the muteSoloRow / picker area, conflict will be localized. Operator should keep BOTH: lock UI in the header, view-mask section in the modal.
- **Slot 0 (layer_add_refresh)** edits `CaptainPad/app/(tabs)/mixer.tsx` and `api.ts`. Conflicts:
  - `mixer.tsx`: I added the `viewSelectionViewMasks` state and prop pass-through (parent component). If slot 0 also changes the channel-strip prop list or the parent state surface, three-way merge should work cleanly since we're adding disjoint props.
  - `api.ts`: I only extended `fetchViewSelectionOptions`'s return type. If slot 0 touches that function, conflict is mechanical.
- **Slot 2 (globals_unification)** edits `CaptainPad/utils/api.ts`. My change is one isolated function's typing — cleanly mergeable unless slot 2 also touches `fetchViewSelectionOptions`.
- **`marsin_engine/engine.js`**: I added ~50 lines inside `loadModel` for the sidecar-loading block plus 4 lines on the `PatternMixer` constructor call. Localized; should merge cleanly with anything else touching boot/render-loop, conflict only if another slice changed `loadModel`'s return shape.
- **`api_server.js`**: extended `validateViewSelection` (viewMask branch) and the `/model/view-selection-options` route body. Conflict only if another slice ALSO modified those exact spots.

## Operator action requested

Ready for review and merge. Two soft asks before pushing to the rig:

1. **Verify view-mask names render correctly on the iPad picker.** Open the mixer tab, tap VIEW on any channel — the modal should now show three sections: ALL, GROUPS (3 entries), VIEW MASKS (4 entries: PARSONLY, VINTAGEONLY, BARSONLY, MAINWASH). Tapping MASK · PARSONLY should restrict that channel to the four UkingPar lights only; the rest of the rig should still show whatever base/other-overlay content was there.
2. **Test on real rig.** Confirm `ParsOnly` only lights the par cans and `BarsOnly` only lights the LED bars on the actual fixtures — the sidecar's `pixelIndices` were derived from reading the model file's pixel ordering, so a mismatch would point to the sidecar needing an index update.

The simulator side (no UI for editing per-fixture `viewMask` yet) is the next logical follow-up — once that lands we can retire the sidecar's `pixelIndices` field and let the model file carry both the table and the per-pixel bits.
