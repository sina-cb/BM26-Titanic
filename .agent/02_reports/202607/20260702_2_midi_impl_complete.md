# MIDI implementation — build complete (Phase 1-3 + MFT driver)

**Date:** 2026-07-02 · **Branch:** `feat/captainpad-midi-control` (pushed, tip `e4f9c386`)
**Author:** dev-manager session (Opus) + 5 sub-agents · **Plan:** `20260702_1_midi_review_and_opus_plan.md`

Executed the full plan with 5 parallel sub-agents across 2 waves, then integrated
and verified. **All automated gates green** — but the hardware round-trip is
UNVERIFIED (no APC/MFT on this machine); see "Local test" at the end.

## Verification (this machine)
| gate | result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` (CaptainPad) | **188 passed** / 14 files (was 98) |
| engine `node --test tests/midi_mapping.test.js` | 9/9 |
| `expo lint` | 0 errors (12 pre-existing warnings) |
| `web:build` | Exported (Metro bundles `mft.yaml`) |

## What shipped
**Phase 1 — 8 correctness fixes** (each unit-tested): learn rejects
profile-claimed controls (no silent shadow of speed/master); focus/snapshot
race gated by a runtime-authoritative `requestedFocusLayer`; pickup re-lock key
includes the entry id; focusChannel inert on absent layers + focus self-heals;
NOTE bindings bypass pickup; `armMidiLearn` fails loud with `{error}` + token-
scoped cancel; pickup-lock LED flash.

**Phase 2 — cleanup:** shared `PopoverKit`, single clamp/scaler, shared
`useEntryBindings`, dead `mixerLayerSolo` pipeline removed end-to-end,
dispatcher throws on runtime-only/unknown kinds, fail-loud warns on dropped
data.

**Phase 3 — engine upsert-by-target** (PUT re-binds by `target.parameter`,
`save()` backstop intact); **mixer UI** (per-strip FOCUS button + ⊞ badge on
mixer local params, sharing one focus state with the controllers).

**MFT driver (docs/34 "Driver #2"):** pymft → TS protocol port
(`utils/midi/mft/*`, 35 tests, byte-for-byte sysex goldens); 16 relative
encoders drive the focused channel's params in order; accumulating coalescer
(deltas sum); `focusStep` side buttons; connect-time sysex config push with
fail-loud; additive ring feedback (value + identity colour); `mft.yaml` loaded
alongside the APC; sysex requested only when the MFT profile is present.

## Deferrals — ALL RESOLVED 2026-07-02 (second pass, 2 agents + integration)
1. **`focusedParamReset` (MFT encoder push)** — ✅ the hook now threads
   `entry.defaults` into `focused.exports[].defaultValue`; push resets to the
   saved default (no-op-with-status when the entry carries none).
2. **MFT delta anchor** — ✅ `focusedParamDelta` now anchors on
   `exp.base ?? exp.v0`. The hook sources `base` (the operator's stable set
   value) from the `modulationState` bus, so turning a knob on an audio-
   modulated param shifts the base and the modulator keeps layering on top.
3. **`tapTempo`** — ✅ REMOVED end-to-end (not a no-op stub). A manual tap
   would violate the engine's 2026-06-17 tempo contract
   (`marsin_engine/lib/bpm_speed_sync.js`: the Audio Companion is the SOLE
   tempo analyzer, no fallback). The MFT side button (ch3 CC10) is reserved
   with a comment. **Decision for Sina:** if you want a manual tempo source,
   that's a deliberate engine change to the sole-analyzer contract — say the
   word and it's a separate task.
4. **Bank 2 (MFT global CPC params)** — ✅ knobs 1-3 → `speed` / `size` /
   `rotate` (the confirmed [0,1]-normalised CPC floats), relative, with ring
   feedback from `globalParamValues`; knobs 4-16 reserved. Add more keys to
   `mft.yaml` when you pick them.
5. **Ring animations** — ✅ a modulated param's knob ring PULSES
   (`RGB_PULSE_1_BEAT`); the speed knob STROBES + goes inert while BPM→Speed
   sync owns speed (`RGB_TOGGLE_1_BEAT`, mirrors APC fader 7).

Second-pass gate: tsc 0 · **201 vitest** · engine 9/9 · lint 0 · web:build.

## MFT open questions still genuinely needing Sina
- **Bank-2 param list beyond speed/size/rotate** — which other globals, in
  what order? (colour params are HSV, not single-value relative-friendly.)
- **encoder-push** = reset-to-default (current) vs fine-adjust-while-held?
- **step sizes** ±0.005/0.02/0.06 per detent — right feel? (bench call)
- **manual tap-tempo** — do you want to break the sole-analyzer tempo
  contract to add one? (default answer: no)

## Local test — see the session hand-off (Ring 1: APC+MFT → Chrome Web MIDI →
CaptainPad web → engine → sim). Nothing here is hardware-verified yet.
