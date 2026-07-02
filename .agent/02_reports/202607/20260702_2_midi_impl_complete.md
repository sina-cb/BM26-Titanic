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

## Deferred — non-blocking follow-ups (documented, not lost)
1. **`focusedParamReset` (MFT encoder push)** — writes a focused export's
   `defaultValue` when present, but `useMidiControl` does not yet thread the
   playlist entry's `defaults` into `focused.exports`, so push currently
   no-ops-with-status. Small hook follow-up (TODO in `manager.handleParamReset`).
2. **MFT delta anchor** — `focusedParamDelta` applies to the export's current
   `v0`; for an audio-modulated param the ideal anchor is the modulation base.
   TODO in the runtime; fine for non-modulated params (the common case).
3. **`tapTempo`** — resolves + dispatches through an optional `MidiDispatchApi.
   tapTempo()`, but no tap endpoint exists in `utils/api.ts`/engine yet, so it
   is a documented no-op. Wire an endpoint to activate the MFT tap side button.
4. **Bank 2 (MFT global CPC params)** — unmapped pending Sina's curated list
   (open question in docs/34). Runtime + ring projector already support
   `paramCenterRelative` + `globalParamValues` when authored.
5. **Ring animations** — pulse-on-modulated + global-speed strobe deferred
   (ring VALUE + colour ship now).

## MFT open questions still needing Sina (from docs/34)
Bank-2 param list + order · encoder-push = reset vs fine-adjust · step sizes
(currently ±0.005/0.02/0.06) · tap-tempo side button wanted?

## Local test — see the session hand-off (Ring 1: APC+MFT → Chrome Web MIDI →
CaptainPad web → engine → sim). Nothing here is hardware-verified yet.
