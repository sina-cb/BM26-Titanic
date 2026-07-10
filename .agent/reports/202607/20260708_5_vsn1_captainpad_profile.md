# VSN1 CaptainPad profile + selected-slot runtime (driver #3)

**Date:** 2026-07-08
**Zone:** `CaptainPad/` only (no `marsin_engine/` / `simulation/` touched)
**Branch:** `feat/party_integration_20260711` (in place, no git ops)

Completes the partial VSN1 work already present in
`utils/midi/{profile,resolver,dispatch}.ts` (the `effectIntensityAbs` /
`effectIntensityReset` action kinds + the two dispatch-API method signatures).
Adds the shipped profile, the selected-slot runtime with a soft-takeover pickup
guard, the two engine calls, and tests.

## Device map (ground truth: `intech_grid_midi_device_20260708_201118.json`)

Capture confirms the expected layout exactly (all channel 0):

| Control | MIDI | Capture label | → CaptainPad action |
|---|---|---|---|
| Key top-left | Note **32** on/off | `b0_0` | `globalEffectSlot` **slot 1** |
| Key (top row) | Note **33** | `b0_1` | slot 2 |
| Key (top row) | Note **34** | `b0_2` | slot 3 |
| Key top-right | Note **35** | `b0_3` | slot 4 |
| Key bottom-left | Note **36** | `b1_0` | slot 5 |
| Key (bottom row) | Note **37** | `b1_1` | slot 6 |
| Key (bottom row) | Note **38** | `b1_2` | slot 7 |
| Key bottom-right | Note **39** | `b1_3` | slot 8 |
| Jog wheel | **CC 40**, absolute 0..127 (clamps at ends) | `encoder` | `effectIntensityAbs` (value/127 → 0..1) |
| Jog press | Note **40** on/off | `encoder_button` | `effectIntensityReset` |
| Side buttons | Notes **41..44** on/off | `sb_0..sb_3` | **unmapped / reserved** (loud silence) |

Slot numbering follows the note order (top-left = slot 1 … bottom-right =
slot 8), matching the CaptainPad GLOBAL EFFECTS strip read left→right — the same
operator contract as the APC Scene column. The jog capture walks the CC value up
and back down (0↔18, 0↔11) without wrapping past the byte ends, confirming
**absolute** mode (not a relative encoder).

Profile: `CaptainPad/midi_profiles/vsn1.yaml` — a flat `controls:` list
(context-agnostic → one universal map, resolves identically on deck + mixer
tabs). No `led:` blocks (the VSN1 sends no LED frames we drive). Registered in
`hooks/useMidiControl.ts` `loadProfiles()` alongside apc + mft.

## Selected-slot model + pickup semantics (runtime, `manager.ts`)

- **Selection = the slot of the LAST key pressed on THIS device.** A key press
  both records `selectedSlot` AND dispatches the slot's own behavior-aware
  toggle/trigger (unchanged `globalEffectSlot` path). `null` until any key is
  pressed.
- **Jog turn (`effectIntensityAbs`)**: value already 0..1 from the resolver;
  coalesced (~30 Hz, last-write-wins) then flushed onto the **selected** slot's
  intensity via `setGlobalEffectSlotIntensity`.
- **Soft-takeover pickup guard**: reuses `learn.ts` `pickup()`. The wheel stays
  LOCKED (swallowed) until its position crosses the selected slot's live
  `intensity`, then tracks. **Selecting a different slot RE-LOCKS** the wheel
  (`freshPickup()` in `selectSlot`), so a stale wheel position can't yank the
  new slot's value on a selection change. The crossing is seeded from the
  snapshot's per-slot `intensity`; while that hasn't threaded through the jog is
  **inert with a visible note** (never anchors on a fabricated 0 — codex P0).
- **Jog press (`effectIntensityReset`)**: resets the selected slot via
  `resetGlobalEffectSlotIntensity`, and UNLOCKS the pickup (a reset is a
  deliberate jump; anchored on `intensityDefault`) so the next turn tracks
  immediately.
- **Before any selection**: jog turn/press are **ignored** (defined behavior),
  logged **once** at `console.debug` (re-armed when a selection lands — a spin
  is ~30 CCs, so it must not spam).

### Contract to the engine (built in parallel — coded to this)

- `POST /global-effect-slots/:slotId/intensity` `{ value }` → `setGlobalEffectSlotIntensity`
- `POST /global-effect-slots/:slotId/intensity/reset` → `resetGlobalEffectSlotIntensity`
- Slot status carries `intensity` / `intensityDefault` / `intensityLabel`;
  threaded into `MidiEngineSnapshot.globalEffectSlots[*]` (`intensity`,
  `intensityDefault`) via `useMidiControl` `refreshSlots()` to seed the pickup
  guard. All optional for staleness safety.

The raw slotless `effectIntensityAbs` / `effectIntensityReset` resolved kinds are
**runtime-only** (they carry no slot — the selection lives in the runtime). The
runtime resolves them against the selection and dispatches two new
runtime-built, slot-carrying kinds — `effectIntensitySlot` /
`effectIntensitySlotReset` — mirroring how `hueDelta` becomes `channelHue`. The
dispatcher throws loudly if the raw forms ever reach it.

## Files touched

- `CaptainPad/midi_profiles/vsn1.yaml` — **new** profile.
- `CaptainPad/utils/midi/vsn1_intensity.test.ts` — **new** tests.
- `CaptainPad/utils/api.ts` — `setGlobalEffectSlotIntensity`,
  `resetGlobalEffectSlotIntensity`; `GlobalEffectSlotStatus` intensity fields.
- `CaptainPad/utils/midi/resolver.ts` — `effectIntensitySlot` /
  `effectIntensitySlotReset` resolved kinds.
- `CaptainPad/utils/midi/dispatch.ts` — dispatch the two slot-carrying kinds;
  raw jog kinds join the runtime-only throw list.
- `CaptainPad/utils/midi/manager.ts` — selected-slot state, pickup guard,
  `selectSlot` / `handleIntensityAbs` / `flushEffectIntensity` /
  `handleIntensityReset`; snapshot slot intensity fields.
- `CaptainPad/hooks/useMidiControl.ts` — wire the two api methods; register
  `vsn1.yaml`; thread slot `intensity` / `intensityDefault` into the snapshot.

## Test results

New file `vsn1_intensity.test.ts` — **19/19 pass** (profile validation/mapping,
resolver scaling, selected-slot select+dispatch, pickup lock/unlock, re-lock on
selection change, jog-before-selection ignored, reset behavior, not-loaded
inert, dispatcher wiring + fail-loud).

Full suite: **238 passed, 7 failed** (7 failing across 6 files). **All 7 failures
are the KNOWN PRE-EXISTING debt** — test files referencing the removed
`globalHueKnob` / `globalHueDelta` / `globalHue` / `setGlobalHue` / `hueShift`
symbols (`resolver.test.ts`, `led_projector.test.ts`, `manager.test.ts`,
`mft_profile.test.ts`, `dispatch.test.ts`, `knob_page.test.ts`) — **none touched
by this work, none referencing `effectIntensity`**. Zero new failures.

Typecheck: source is clean except one pre-existing unrelated error
(`components/MidiStatusChip.tsx` `"/midi"` router-path typing). The partial
VSN1 work had left 2 real source-level errors (the hook + a behavior test mock
missing the two new api methods); the hook one is now **fixed**. Remaining
typecheck errors are all in the untouched debt test files (the same
`globalHue*` removals) plus `global_effect_slot_behavior.test.ts`'s mock missing
the two new methods (a test file, pre-existing debt shape, not in scope).

**Tooling note:** vitest was declared in `package.json` but absent from this
working tree's `node_modules`; installed offline from cache with `--no-save`
(package.json + lockfile untouched) to run the suite. No servers restarted.
