# Slot 1 — mixer_layer_view

- **Branch:** dev/claude/mixer_layer_view
- **Parent branch:** dev/summer_camp_readiness (parent SHA d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/mixer_layer_view
- **Slot ports:** engine 31168, OSC 31100 (config.yaml override reverted before commit), sim 31169, metro 31181 (not started — UI work was tsc/lint only)

## Scope

Implemented the engine-side per-channel view-selection masking pipeline described in `docs/27_[todo]_mixer_layer_view_selection.md`. The base channel now seeds the live `mixerBuffer` so overlay layers can paint on top of a real background (Step A of §2). Each overlay's blend output is committed via a pre-compiled `Uint8Array` mask (Step B), so a "blue on Wall" overlay no longer zeroes out the rest of the rig under any blend mode. The PFL/deck preview applies a separate blackout mask so the operator can see at a glance which fixtures a focused channel covers. The linear crossfade between `deckBuffer` and `mixerBuffer` is unchanged but the default `viewFader` is now 1.0 (mixer view on boot) per the design doc. The REST API gained strict validation for `viewSelection`, an enumeration endpoint `/model/view-selection-options`, and persistence of the per-channel selection in `mixer_state.yaml` / `deck_state.yaml`. A minimal CaptainPad UI hook in the mixer channel strip lets the operator flip a channel between ALL and any model group via a modal picker.

## Files changed

```
M  CaptainPad/app/(tabs)/mixer.tsx           # view-selection picker + handler + groups state
M  CaptainPad/utils/api.ts                   # fetchViewSelectionOptions
M  marsin_engine/engine.js                   # pass model.pixels into PatternMixer
M  marsin_engine/lib/api_server.js           # validateViewSelection (exported), PATCH/POST wiring,
                                              /model/view-selection-options endpoint, serialize broadcast
M  marsin_engine/lib/pattern_channel.js      # viewSelection + compiledPixelMask fields
M  marsin_engine/lib/pattern_mixer.js        # compileViewSelectionMask, mask helpers,
                                              base-seeding of mixerBuffer, per-layer masked commit,
                                              PFL blackout, default viewFader = 1.0, scratch buffers,
                                              setChannelViewSelection / recompileChannelMask
M  marsin_engine/lib/state_manager.js        # persist viewSelection in mixer/deck YAML
A  marsin_engine/tests/pattern_mixer_masking.test.js   # 27 unit assertions
A  marsin_engine/tests/hil/hil_view_selection_test.mjs # HIL on port 31168 (14 assertions)
```

## Tests run

### Unit (`marsin_engine/tests/pattern_mixer_masking.test.js`)
- 27 assertions, all PASS via `node --test`.
- Coverage: `compileViewSelectionMask` for every type incl. invert and `sId`/`sectionId` fallback; `validateViewSelection` for all valid + every documented reject case; PatternMixer pixel-alignment guard; default viewFader == 1.0; viewFader=0 / =1 / =0.5 output assertions (deck vs mixer vs linear lerp); base-channel seeding of mixerBuffer; muted/zeroed base does NOT seed; overlay masked to "Wall" only paints wall pixels (rest stays red); invert flips the painted region; PFL blackout zeroes unselected pixels in deck output while leaving the mixer composition's background intact.

### Integration / HIL (`marsin_engine/tests/hil/hil_view_selection_test.mjs`)
- Engine: `node engine.js --pattern test_const --model test_bench --port 31168`
- 14 assertions, all PASS:
  - GET `/model/view-selection-options` enumerates 3 groups + 3 sections + pixelCount=52.
  - GET `/mixer` carries `viewSelection` on every channel.
  - PATCH valid `{type:'group', target:'<group>'}` → 200, value round-trips.
  - PATCH malformed shapes (`type:'group'` with int target, `type:'roomBitmap'`, `type:'section'` with string target) → 400 with channel state unchanged (regression-guard for §3.1).
  - PATCH `{type:'all'}` clears the mask.
  - PATCH `{type:'section', target:<int>}` round-trips.

### Sim smoke
- Not run — this slice is engine-only on the rendering side, no model export / scene changes. The HIL test covers the full HTTP round-trip the iPad would make.

### CaptainPad
- `npx tsc --noEmit`: 0 errors in `mixer.tsx` or `api.ts` (pre-existing OSC pill-state errors in `osc.tsx` are unrelated).
- `npx expo lint`: 0 warnings or errors in `mixer.tsx` or `api.ts` (pre-existing lint errors elsewhere in the repo).
- No manual smoke on the iPad — Metro wasn't started for this slice (no visual UI change beyond the new picker + handler; the engine wiring is the load-bearing change and is covered by the HIL test).

### State hygiene
- Snapshot+restore protocol followed: `marsin_engine/states/test_bench/{mixer,deck}_state.yaml` snapshotted to `~/tmp/` before engine boot, restored after, `git status` shows clean state files.
- `marsin_engine/config.yaml`: port edits (OSC 31100, audio disabled) made in-worktree to start engine on slot 1, then reverted via `git checkout --` before commit. Final diff carries no config changes.
- All processes killed; port 31168 free.

## Known gaps / follow-ups

- The CaptainPad view-selection picker ships as ALL vs GROUP only (per slot brief: "at least all vs group for one group"). The full §3.1 set (sections / fixtures / viewMask, plus an `invert` toggle) is not in the UI yet — the engine accepts those today via the REST API, so a follow-up is just UI work.
- The `/model/view-selection-options` endpoint returns the union of `viewMask` bits the model uses but does not enumerate individual viewMask names (the model has no naming convention for them yet — `vMask` is all zero or a single bit). When/if the model author starts using named view bits, surface them here.
- The base-channel seeding behaviour change is the single most observable behaviour shift in this slice. Per the design doc §2 Warning callout, existing show configs should be validated by an operator with `viewFader=0`, `=1`, and intermediate values. The unit test covers the math; a human eye on the rig is the final check.
- The `mixer.maxChannels` default in config.yaml stayed at 4 (preexisting). The design doc mentions 6; raising it is out of scope here and orthogonal to view selection.

## Anticipated merge conflicts with other slices

- **Slot 6 (channel_isolation)**: this slice changes the meaning of "the base channel seeds mixerBuffer" and removes the `if (channel.id === this.baseChannelId) continue;` skip from the per-channel composite loop (now replaced by an explicit "Step A: seed from base" block). If Slot 6 also touches the mixer-state shape (`this.channels`, `baseChannelId`), the merge will need careful resolution around `renderAll6ch` in `marsin_engine/lib/pattern_mixer.js`. The `PatternChannel` constructor signature additions (`viewSelection`) are purely additive and should not collide.
- **api_server.js**: I added `validateViewSelection` near the top of the file and a `/model/view-selection-options` route + viewSelection branches in PATCH/POST `/mixer/channels`. These are localized; a textual conflict in PATCH is possible if another slice also added per-PATCH branches but `git merge` should handle the typical case.
- **state_manager.js**: viewSelection added to `saveMixerState` and `saveDeckState` channel serializers. Localized.
- **engine.js**: a single argument added to `new PatternMixer({...})`. Trivial.

## Operator action requested

Ready for review and merge. The behaviour change in §2 (base channel now seeds mixerBuffer) is the only item worth a smoke check on the real rig before merge — please confirm a deck-only show config with `viewFader=1` (mixer view) looks like the base channel's pattern as expected, not pure black.
