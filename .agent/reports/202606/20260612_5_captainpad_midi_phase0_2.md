# CaptainPad direct MIDI control — phases 0-2 (APC mini mk2)

**Date:** 2026-06-12
**Branch:** `feat/captainpad-midi-control`
**Card:** Notion "CaptainPad direct MIDI control: implement docs/34"
**Doc:** `docs/34_captainpad_midi.md` (updated this pass)
**Scope:** Phases 0-2 (Ring 1, Windows/Web MIDI). Native iOS transport +
EAS/iPad build are the deferred Phase 3-4 follow-up.

## What was built

A **unified, multi-controller MIDI mapping layer, entirely CaptainPad-side,
zero engine changes** — every action dispatches through existing
`utils/api.ts` REST functions. APC mini mk2 is driver #1; the architecture
runs N controllers concurrently so the MIDI Fighter Twister (driver #2, per
Sina's `pymft`) drops in as another profile + a relative-encoder resolver
extension.

Module layout (`CaptainPad/`):

- `utils/midi/transport.ts` — **frozen** `MidiTransport` interface (Web MIDI now,
  native CoreMIDI later sit behind it).
- `utils/midi/web_midi_transport.ts` — Web MIDI adapter + `isMidiAvailable()`.
- `utils/midi/midi_message.ts` — byte (de)code.
- `utils/midi/profile.ts` — profile types + `validateProfile` (throws) +
  `validateProfileParams` (aggregate / strict).
- `utils/midi/endpoints.ts` — `{nameContains, portIndex}` resolution (throws on
  absent/ambiguous/out-of-range).
- `utils/midi/resolver.ts` — pure event → `ResolvedAction` (scaled).
- `utils/midi/coalescer.ts` — per-control ~30 Hz trailing throttle.
- `utils/midi/led_projector.ts` — engine state → diffed LED messages.
- `utils/midi/dispatch.ts` — `ResolvedAction` → `utils/api.ts` (injectable).
- `utils/midi/manager.ts` — `MidiManager` runs the controllers.
- `hooks/useMidiControl.ts` — RootShell lifecycle + module store +
  `useMidiStatus()`.
- `components/MidiStatusChip.tsx` — 🎹 APC header chip (grey/green/red).
- `components/MidiConfigSection.tsx` — Config tab read-only status + monitor.
- `midi_profiles/apc_mini_mk2.yaml` — driver #1 profile.
- `midi_profiles/apc_mini_mk2_reference.md` + `manuals/` — in/out note tables +
  Akai PDFs (User Guide + Communication Protocol v1.0).
- `utils/midi/*.test.ts` — Vitest suite (54 tests).

## Phase 0 — endpoint capture (Chromium Web MIDI, Windows dev PC)

Captured live; **seeds the profile — not guessed.** The device name is on two
ports, so `nameContains` + `portIndex` is required to disambiguate.

| Kind | Port idx | Name (Chromium) | Mfr |
|---|---|---|---|
| input  | 2 | `APC mini mk2` | AKAI Professional | ← port 0, use this |
| input  | 3 | `MIDIIN2 (APC mini mk2)` | AKAI Professional | port 1 (Note Mode) |
| output | 2 | `APC mini mk2` | AKAI Professional | ← port 0, LED feedback |
| output | 3 | `MIDIOUT2 (APC mini mk2)` | AKAI Professional | port 1 |

Bome virtual ports (`APCMini -> TouchDesigner/QuickShow`, mfr "Microsoft") are
present and correctly excluded by `nameContains`.

### APC mini mk2 in/out map (from Akai Communication Protocol v1.0)

- **Inbound, Port 0, Ch 0:** grid pads = Note 0-63; Track buttons = 100-107
  (`0x64-0x6B`); Scene buttons = 112-119 (`0x70-0x77`); Shift = 122 (`0x7A`,
  **no LED**); Faders 1-8 = CC 48-55, Fader 9 (master) = CC 56, absolute 0-127.
- **Outbound LEDs, Port 0:** RGB pads `9c nn vv` (channel = brightness/behaviour,
  `0x96` solid 100%; velocity = colour, fixed 128-palette: 5=red, 9=orange,
  13=yellow, 21=green, 45=blue, 3=white, 0=off). Single-colour buttons (Track=red,
  Scene=green) `90 nn vv` (0x00 off / 0x01 on / 0x02 blink).
- LED **output path confirmed** against the real unit (note-on sent without
  error, diagonal lit). Full detail in `apc_mini_mk2_reference.md`.

## Default mapping (docs/34 sketch, valid CPC keys)

Faders 1-3 → `speed`/`size`/`rotate` (CPC `[0,1]`); Fader 9 → master; bottom pad
row (notes 0-7) → pattern bank 0 (order-bound, page size 8, green=active pad);
Track Button 8 (note 107) → blackout toggle, red LED reflects state.

**Deviations from the doc's illustrative example:** blackout is on a Track
button (Shift has no LED); endpoint disambiguation uses a deterministic port
index (explicit, not a silent auto-pick); param-key validation is aggregate +
non-fatal by default (Config tab names the bad key, other controls keep working)
with a `strict` throw for tests.

## Verification

- `npx tsc --noEmit`: **all new code clean.** Two pre-existing errors remain in
  `components/Modulation.tsx` (`transitionDuration`) — present verbatim on
  `main`, tracked by the separate Notion card; **not** introduced here.
- `npm run lint`: exit 0. New files: zero warnings.
- `npm run web:build`: `Exported: dist` (validates the YAML profile import via
  the existing transformer + the capability gate compiling for web).
- `npm run test` (Vitest, added as a devDependency — repo standard, same as
  PortWatch): **54/54 pass** — profile validation, endpoint resolution, resolver
  scaling, coalescer trailing throttle, dispatch→api, LED projector diffing, and
  a fake-transport `MidiManager` integration (CC→param, pad→pattern, blackout
  toggle, LED repaint, hotplug→grey).
- **Hardware-in-the-loop:** [to fill in once the bench pass with Sina is done —
  fader→engine param→sim, pad→pattern, blackout+LED, unplug/replug].

## Open issues / follow-ups

1. **Phase 3-4 (deferred):** native CoreMIDI Expo module (`modules/captain-midi/`)
   + EAS dev-client build from Windows + iPad bench gate. The `MidiTransport`
   interface is frozen and ready.
2. **Driver #2 — MIDI Fighter Twister:** add `midi_profiles/mft.yaml` + a
   relative-encoder decode path in the resolver (APC faders are absolute CC;
   MFT encoders send relative deltas + expect colour/value writes back).
   Reference: `pymft` (https://github.com/sina-cb/pymft) — portable to native
   engine code later, but a *spec* here (MIDI stays CaptainPad-side for iPad).
3. **Pre-existing:** `Modulation.tsx` tsc errors block a fully-green
   `tsc --noEmit`; owned by its own card.
4. **Pattern-bank binding** is order-based (open question #2 in docs/34) — pin
   pad→pattern names explicitly if the library churns.

## Addendum (2026-06-13) — tab-aware operator mapping (Sina's spec)

After the phase 0-2 base landed, the mapping was extended per Sina's direction:

- **Per-tab contexts.** A profile now declares `contexts:` (deck / mixer); the
  same hardware maps to different actions depending on the active CaptainPad
  tab. `MidiManager.setContext()` switches; deck/mixer screens publish on focus.
- **Dedicated MIDI tab** (`app/(tabs)/midi.tsx`) replaces the Config sub-section;
  the 🎹 chip taps through to it.
- **Multiple/flexible profiles** per device (`MidiManager` takes a list).
- **Stage 1 mapping:** fader 9 → master (both tabs); Mixer faders 1-4 → layer
  faders, track buttons 1-4 → layer **solo** (red LED), fader 5 → speed; Scene
  buttons (bottom→up) → blackout (GEM e-stop) + global-effect slots 1..N (off
  when out of slots); best-practice Deck layout. **Activity auto-disable**: any
  MIDI input turns off autopilot + deck transitions; restored after 60 s idle.
- **Stage 2 mapping:** new `column` match type for strided pad columns. Mixer
  pad cols 1-4 = per-layer **playlist window browser** (bottom=scroll-down,
  top=scroll-up, middle 6 = select within a 6-entry window; LED window with the
  active entry bright; absent layer → column dark). The window is mirrored in
  the Mixer playlist UI as an amber border (`useMidiWindow`). Mixer pad cols 5-8
  = **colour-pair pads** (cols 5-6 = palettes 1-8, cols 7-8 = 9-16; apply the
  curated pair, pad LEDs show the hues). Fader 6 (active-layer local speed) is
  left TBD pending an "active layer" definition.

New action kinds: `mixerLayerFader`, `mixerLayerSolo`, `globalEffectSlot`,
`playlistScroll`, `playlistWindowSelect`, `colorPalettePair`. Tests: 71 green
(Vitest), `tsc` clean (Modulation.tsx pre-existing), lint 0, web:build ✅.

### Engine runtime residue (do not commit)
Running the stack for HITL dirtied tracked engine files (expected, per
`.agent/01_skills/05_full_stack_smoke.md`): `marsin_engine/states/test_bench/*.yaml`
and `marsin_engine/config.yaml` (`playlist.active: true→false` — this is the
**MIDI activity auto-disable** firing and the engine persisting it, i.e. proof
the feature works). These were **left for the operator**, not committed.

### Open verification
HITL confirmed: endpoint resolution + connect against real hardware, LED output
path, fader → engine param → sim, the 🎹 chip + MIDI tab + monitor, and the
activity auto-disable. Still to bench with hands-on: layer solo LEDs, the pad
window browser end-to-end (needs mixer layers + playlists), colour-pair pads,
and the scene-button orientation assumption (Scene 8 = bottom = blackout).
