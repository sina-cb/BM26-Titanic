# Slot 2 — globals_unification

- **Branch:** dev/claude/globals_unification
- **Parent branch:** dev/summer_camp_readiness (SHA 97a3267)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/globals_unification
- **Slot ports:** engine 31268, sim 31269/31270/31271/31272, OSC 31200, Metro 31281

## Scope

Operator's combined ask was twofold:
1. The "loading global effect macros" strip in the deck Rig globals never resolves and the buttons don't expose the alternate effects.
2. The legacy RigGlobals (vintage white / blast white / UV blast / fogger) and the new Global Effect Macros (GEM) should be ONE compact grid, with a single red BLACKOUT button acting as a true e-stop.

This slice migrates the four legacy rig-globals into the engine-side GEM library (so they're real slot effects, persisted in `global_effect_slots.yaml`), replaces the dual UI with a single compact 2-row grid, adds hold-to-swap for slot reassignment, ships a 2-stage BLACKOUT e-stop that clears every active macro and silences DMX-only fixtures (fogger / horn / fire), and adds unit + HIL coverage for the precedence and dispatcher contracts.

## Files changed

```
A  marsin_engine/effects/blastWhite.js
A  marsin_engine/effects/fogger.js
A  marsin_engine/effects/uvBlast.js
A  marsin_engine/effects/vintageWhite.js
A  marsin_engine/states/test_bench/global_effect_slots.yaml
A  marsin_engine/tests/global_effect_blackout.test.js
A  marsin_engine/tests/hil/hil_blackout_estop_test.mjs
M  marsin_engine/engine.js                                 # pass blackout into applyDmx
M  marsin_engine/lib/api_server.js                         # POST /global-effect-macros/blackout
M  marsin_engine/lib/global_effect_library.js              # 4 new legacy effects, validateParams
M  marsin_engine/lib/global_effect_slot_manager.js         # MIN/MAX_SLOTS, dispatch+isActive for legacy
M  marsin_engine/lib/global_effects_controller.js          # panicStop clears legacy, applyDmx honours blackout
M  marsin_engine/tests/global_effect_macros.test.js        # contract updates for variable-length slot config
M  CaptainPad/components/GlobalEffectMacros.tsx            # full rewrite: compact, hold-to-swap, blackout, loading-bug fix
M  CaptainPad/components/RigGlobals.tsx                    # thin wrapper around GEM; RigContext API preserved
M  CaptainPad/utils/api.ts                                 # patchGlobalEffectSlot, setGlobalEffectBlackout, fetchGlobalEffectLibrary
```

## Tests run

- **Unit (engine):**
  - `node --test marsin_engine/tests/global_effect_macros.test.js` — 32 / 32 pass (updated to reflect variable slot count)
  - `node --test marsin_engine/tests/global_effect_blackout.test.js` — 6 / 6 pass (new file)
  - Full unit-test sweep `node --test marsin_engine/tests/*.test.js`: 238 / 239 pass. The single failing test `Two entries of same pattern keep independent defaults across restart` in `playlist_api.test.js` fails identically on the parent branch (confirmed by stash + retest); it's an unrelated pre-existing issue around `13_sparkle.js` exports.
- **HIL:** `ENGINE_PORT=31268 node marsin_engine/tests/hil/hil_blackout_estop_test.mjs` — 16 / 16 pass (new file). Boots a real engine on slot 2 ports, exercises slot activate → blackout → release → state file snapshot-restore cycle.
- **CaptainPad:**
  - `tsc --noEmit` — 0 new errors (the 7 pre-existing errors are all in `osc.tsx`).
  - `eslint components/RigGlobals.tsx components/GlobalEffectMacros.tsx utils/api.ts` — 0 new warnings (the 5 pre-existing warnings are all in unrelated regions of `api.ts`).
- **Manual smoke:** Engine + tests round-trip; full state file snapshot/restore left `git status` clean apart from the intended diff. No manual iPad test in this slot — operator follow-up notes the hold-to-swap UX should be checked on an 11" iPad in landscape.

## What changed in detail

### Engine

- **New effect modules** (`marsin_engine/effects/{vintageWhite,blastWhite,uvBlast,fogger}.js`): thin pure-function wrappers so the GEM library can carry the legacy rig-globals as first-class entries. The actual write path stays inside `GlobalEffectsController.applyPixels()` / `applyDmx()` because those effects are dimmer-aware (`ignoreDimmerForRGB` etc.) — relocating them into the post-mixer macro pipeline would break the bypass-dimmer contract.
- **Library** (`global_effect_library.js`): four new entries (`vintageWhite`, `blastWhite`, `uvBlast`, `fogger`) under a new `category: 'legacy'`. Each carries a `legacyEffectId` field so the slot dispatcher knows to route through `controller.setEffect(...)` instead of the macro pipeline. `describeLibrary()` includes `legacyEffectId` so CaptainPad's swap sheet can render the migrated effects too.
- **Slot manager** (`global_effect_slot_manager.js`):
  - `DEFAULT_SLOT_CONFIG` expanded from 6 → 10 entries (slots 7..10 are the migrated legacy effects). Slots 1..6 unchanged so operator muscle memory + existing tests survive.
  - `MIN_SLOTS = 1`, `MAX_SLOTS = 16`. `validateSlotsConfig` accepts any length in that range.
  - `_isSlotActive` knows about the four legacy effects (returns the boolean on `controller.effects[id]`).
  - New `_dispatchLegacy({ resolved, action })` translates `activate/deactivate/toggle/trigger/down/up` into `controller.setEffect(...)` calls, including mirroring `bypassDimmer` into the matching `*BypassDimmer` flag.
- **Controller** (`global_effects_controller.js`):
  - `panicStop()` now also clears the four legacy toggles + their `*BypassDimmer` twins, and disables `colorWash`. The old docs/28 §5.3 carve-out for color wash was removed because the unified e-stop semantics require one hard "everything off" switch.
  - `applyDmx(dmxBuffers, { blackout })` short-circuits fogger / horn / fire when blackout is set. Without this, pixel-level blackout would still leave the DMX-only fixtures running.
  - `getStatus()` includes `effects: { ...this.effects }` so CaptainPad's RigContext can mirror engine-side legacy-effect changes via the WS push.
- **Engine** (`engine.js`): passes `{ blackout: intensityController.blackoutActive }` to `applyDmx()`.
- **API** (`api_server.js`): new endpoint **`POST /global-effect-macros/blackout`** with body `{ enabled: boolean }`. Engages: sets `intensityController` blackout, persists `globalsState.blackout`, calls `controller.panicStop()`, broadcasts `globalEffectMacroStatus` with the new blackout flag. Releases: just flips the flag and broadcasts. Returns `{ status: 'ok', blackout: <bool> }`.
- **State file** (`states/test_bench/global_effect_slots.yaml`): pre-populated 10-slot config so the test_bench scene boots into the same layout the operator will see on the rig.

### CaptainPad

- **`GlobalEffectMacros.tsx`** (full rewrite):
  - Loading-bug fix: instead of an infinite "Loading global effect macros…" text, the component first paints button shells from `/global-effect-slots` (no spinner) and shows the actual engine error if the request fails (codex P0 — no fallbacks). The previous version stuck on "Loading…" because it gated on `slots.length === 0` without distinguishing "empty response" from "in flight".
  - Compact layout: every slot button is 32 pt tall (down from 78 pt), labels at 10 pt, no per-button safety badge sprawl — just a 2 pt border accent in the safety-tier colour. Two rows of N columns, padded so column widths align.
  - **Hold-to-swap**: long-press a slot button (≥500 ms) opens a modal listing every effect / preset from the registry. Tapping one PATCHes `/global-effect-slots/:id` with the new `effectId / presetId / behavior / label`. Quick tap dispatches the slot's default action (toggle / trigger / down).
  - **BLACKOUT e-stop**: red, 2-stage tap — first tap arms for 1.5 s ("CONFIRM"), second tap engages. Already-engaged → tap to "RELEASE". Routes through the new `setGlobalEffectBlackout()` API.
  - Subscribes to `engineEvents` for `globalEffectMacroStatus` / `globalEffectSlots` so the UI mirrors remote changes (PortWatch / other tablets) without polling.
- **`RigGlobals.tsx`** (thin wrapper): now exports `RigContext` + `RigProvider` with the same shape so `dimmer_rack.tsx`'s `BypassCheckbox` and `RESTORE RIG` button keep working. `<RigGlobals />` renders the unified `<GlobalEffectMacros />` grid. `toggleBlackout()` now hits the new e-stop endpoint so the dimmer rack's RESTORE RIG is a true e-stop too. RigProvider also mirrors `controller.effects` from `globalEffectMacroStatus` WS pushes so bypass checkboxes track GEM-driven state.
- **`api.ts`**: three new typed helpers — `setGlobalEffectBlackout`, `patchGlobalEffectSlot`, `fetchGlobalEffectLibrary`. All follow the existing `ApiResult<T>` + `warnThrottled` pattern.

## Known gaps / follow-ups

- The hold-to-swap modal is functional but not fancy: no preset preview, no "filter by category", and the params override is reset to `{}` on swap. Adding a "favorites" tab and preset preview would be a nice polish pass.
- The 2-stage blackout tap is intentional; if the operator prefers a press-and-hold gesture instead (debouncing accidental taps a different way), that's a one-line behavioural swap in `onPressBlackout`.
- Mixer-tab `<RigGlobals variant="mixer" />` now renders the same vertical 2-row grid the deck does. The mixer's `globalRigBar` flexbox was sized for a horizontal strip; on iPad portrait it'll look a touch tall. The operator agreed unification matters more than the old horizontal aesthetic but a real iPad smoke test is worth it.
- `controller.getStatus().effects` is now sent on every `globalEffectMacroStatus` push. Payload grew by ~150 bytes — negligible at the macro broadcast rate, but worth noting if anyone profiles WS throughput later.
- No simulation smoke run this slot (engine-only changes + UI rewrite are covered by HIL + unit tests). If the operator wants the sim cycled too I can add a quick smoke step before merge.

## Operator action requested

Ready for review and merge.

## Anticipated merge conflicts (concrete)

- **Slot 0 (`layer_add_refresh`)** also edits `CaptainPad/utils/api.ts`. My change adds three new helpers at the bottom of the file (after `panicStopGlobalEffectMacros`) — should be a clean append unless slot 0 also touched that exact region.
- **Slot 3 (`deck_card_compact`)** edits `CaptainPad/app/(tabs)/index.tsx` and `CaptainPad/components/DeckTransitionControls.tsx`. I did NOT touch `index.tsx` — the `<RigGlobals />` call site is unchanged because I preserved that API. No conflict expected on `index.tsx` from my side.
- `CaptainPad/components/RigGlobals.tsx` was fully rewritten; no other slot lists it as a modified file, so this should be conflict-free.
- Engine-side: `marsin_engine/lib/api_server.js` (route additions) and `marsin_engine/lib/global_effect_*.js` (new entries) — no other slot lists these as touched, so conflict-free.
- `marsin_engine/tests/global_effect_macros.test.js` was updated to remove the "exactly 6 entries" assertion and to use `DEFAULT_SLOT_CONFIG.length` instead of `6`. If another slot independently expanded this test file, the merge will need a manual review.

## Merge-readiness statement

All in-tree assertions pass (unit + HIL). The single failing engine unit test (`13_sparkle` exports) is a pre-existing failure on the parent branch and is out of scope here. tsc / eslint are clean on the touched files. State files were snapshot+restored around the HIL run — `git status` shows only the intended diff. Ready for review and merge.
