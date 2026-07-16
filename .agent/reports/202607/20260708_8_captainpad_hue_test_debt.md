# CaptainPad — hue-removal test debt cleanup

**Date:** 2026-07-08
**Zone:** `CaptainPad/` (tests only — no app code touched)
**Goal:** green CaptainPad test suite + clean typecheck after the global hue
shifter was removed end-to-end (hue is per-channel only now).

## Context

The global hue shifter (`setGlobalHue` / `globalHueKnob` / `globalHueDelta` /
`globalHueReset` / `hueShift` snapshot field / `globalParamValues` hue) was
removed from the app code in prior commits. Hue is now **per-channel only**:

- The MFT hue knob (`hueKnob` action) resolves to `hueDelta`; the runtime
  flushes it onto the **FOCUSED CHANNEL** in BOTH contexts via
  `setChannelHue(id, degrees, opts)`.
- On the **deck tab** the focused channel is the deck channel (role `'deck'`)
  → `setChannelHue(id, degrees, { deck: true })`.
- On the **mixer tab** it is the focused overlay (role `'mixer'`) →
  `setChannelHue(id, degrees, undefined)`.
- The hue push (`hueReset`) resets that same channel to 0°.
- There is **no** `autoRotateDegPerSec` per channel and **no** global shifter.

The app code was already done; this pass fixed the remaining **test debt**:
7 failing tests + ~25 typecheck errors across six test files still referencing
the removed APIs.

## Per-file changes

### `utils/midi/dispatch.test.ts`
- **Stale:** `makeApi()` declared `setGlobalHue` (removed) and was missing the
  two VSN1 slot-intensity fns; a throw-test used removed kinds
  `globalHueDelta`/`globalHueReset`; a `globalHue posts degrees AND
  autoRotate` test covered dispatch code that no longer exists.
- **Now:** `makeApi()` matches the current `MidiDispatchApi`
  (`setGlobalEffectSlotIntensity` / `resetGlobalEffectSlotIntensity` added,
  `setGlobalHue` gone). Throw-test asserts the current runtime-only kinds
  `hueDelta`/`hueReset` throw in the dispatcher. Removed the dead `globalHue`
  test (that write is truly gone); the two `channelHue` tests already cover
  the per-channel replacement (mixer → no deck flag; deck → `{ deck: true }`).

### `utils/midi/global_effect_slot_behavior.test.ts`
- **Stale:** `makeApi()` missing the two slot-intensity fns; header comment
  claimed the file was split out because manager.test.ts "can't LOAD" due to a
  removed `globalHueKnob`.
- **Now:** `makeApi()` completed; header comment rewritten (manager.test.ts
  loads again — the file simply stays a focused self-contained proof).

### `utils/midi/knob_page.test.ts`
- **Stale:** "NEVER drifts from mft.yaml" test looked up the hue control by the
  removed action kind `globalHueKnob`.
- **Now:** looks it up by the current `hueKnob` kind (same encoder-pinning
  intent preserved).

### `utils/midi/led_projector.test.ts`
- **Stale:** the hue-knob projection fixture profile declared
  `action: { kind: 'globalHueKnob' }` → threw at `validateProfile` load time,
  failing the whole file.
- **Now:** fixture uses `kind: 'hueKnob'`. LED projection asserts unchanged
  (ring = degrees/360, colour tracks the wheel) — it keys off the control +
  `getHueKnobDegrees`, not the action kind.

### `utils/midi/manager.test.ts`
- **Stale:** `makeApi()` had `setGlobalHue` + missing slot-intensity fns; the
  v2 fixture profile used `globalHueKnob`/`globalHueReset` (threw at load);
  `deckSnap`/`mixerSnap` carried a removed `hueShift` field; the entire deck
  hue-knob block asserted **global** behavior (`setGlobalHue`, autoRotate spin
  preservation, `hue state not loaded`, deck "never touches per-channel API").
- **Now:** `makeApi()` matches current API. Fixture uses `hueKnob`/`hueReset`.
  `hueShift` removed from both snap builders; `deckSnap` now threads the deck
  channel's hue via `focused.hue` (+ a `focusedOver` param mirroring
  `mixerSnap`). The deck block was **rewritten to per-channel**: deck hue turn
  → `setChannelHue('d1', …, { deck: true })` anchored on `focused.hue`, wraps
  past 360°, inert when the channel hue isn't loaded / no focused channel,
  push resets the deck channel to 0° and cancels a pending turn. The mixer
  block's now-dangling `setGlobalHue` negative assertions were dropped. The
  deck-vs-mixer paint test now asserts BOTH contexts paint from their own
  focused channel's hue.

### `utils/midi/mft_profile.test.ts`
- **Stale:** v2 row-0 validation + shipped-yaml tests referenced removed kinds
  `globalHueKnob`/`globalHueReset`, control ids `global_hue_turn`/
  `global_hue_push_reset`, and the removed resolved kind `globalHueDelta`.
- **Now:** kinds → `hueKnob`/`hueReset`; shipped-yaml control ids → the actual
  `hue_turn`/`hue_push_reset`; deck/mixer-identical resolve test → `hueDelta`/
  `hueReset`. Same layout-pinning intent preserved.

### `utils/midi/resolver.test.ts`
- **Stale:** fixture profile + two tests used `globalHueKnob`/`globalHueReset`
  (fixture threw at load) resolving to `globalHueDelta`/`globalHueReset`.
- **Now:** fixture uses `hueKnob`/`hueReset`; tests assert the resolver emits
  `hueDelta` (continuous) / `hueReset` (press, null on release).

## Pre-existing typecheck error (item 2)

`components/MidiStatusChip.tsx(38)` — `router.push('/midi')` failed because
the expo-router generated typed-routes file `.expo/types/router.d.ts` was
**stale**: the route file `app/(tabs)/midi.tsx` exists but was absent from the
generated declaration (all other tabs present). Fixed by regenerating the
types (`npx expo customize tsconfig.json`, which runs the router typegen);
`/midi` now appears in the generated types. `.expo/types/` is gitignored and
`tsconfig.json` was left unchanged — no source edit needed, and the app code
was already correct.

## Tallies

| | Before | After |
|---|---|---|
| Failing tests | 7 | 0 |
| Passing tests | 245 (6 files couldn't load) | **412** (23 files, all load) |
| Typecheck errors | ~26 | **0** |

The passing-test count rose because three test files
(`resolver` / `led_projector` / `manager`) previously threw at
`validateProfile` **load** time and contributed zero runnable tests; with the
fixtures fixed, all 23 files load and their full test bodies run.

Files touched (all `CaptainPad/utils/midi/*.test.ts`):
`dispatch.test.ts`, `global_effect_slot_behavior.test.ts`,
`knob_page.test.ts`, `led_projector.test.ts`, `manager.test.ts`,
`mft_profile.test.ts`, `resolver.test.ts`. No app/source code modified.
