# 20260621_12 — Delete the engine's derived/detector computation (sole-analyzer cleanup)

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-21

## Ask
After moving all derived-signal computation to the companion (report 20260621_11),
delete the now-redundant engine-side code and update all tests.

## Done — `engine.js`
Removed the engine's own derived/detector computation (the companion is the sole
analyzer and emits every key over OSC; the engine receives them via the static
`/marsin/audio/*` bindings):
- Removed the `AudioStructureDetector` + `DerivedSignals` imports.
- Removed their instantiation (`audioState.structureDetector` / `derivedSignals`)
  + the derived-health fingerprint state.
- Removed `audioStructureDetector.tick()` / `derivedSignals.tick()` and the
  derived-health `audioStatus` broadcast from the analyzer hop. The engine-mic
  analyzer (audio.enabled path) now writes ONLY the raw mic bands; the derived
  layer is gone from the engine.
- The `structureDetector.*` live-config block is still accepted/persisted (the
  operator tunes the COMPANION's detector through it; the engine stores/forwards).

The detector + derived MODULES (`audio/detector/`, `audio/signals/`) are
untouched — they're now used by the companion, not the engine.

## Tests — nothing to update
Full suite **1314/1314** still green after the removal. No test depended on the
engine WIRING computing derived/detector: the module tests
(`new_derived_signals`, `audio_structure_detector`, `genre_eval_harness`,
`audio_analysis_validation`) drive the modules directly, and `tempo_arbitration`
only uses the `ENGINE_LOCAL_BPM_SOURCE` source-name constant (unchanged).

## Validation
- Full suite **1314/1314**.
- Engine `--dry-run` boot: clean (exit 0).
- **End-to-end**: booted the engine (audio.enabled:false → engine computes NO
  audio) + the companion (Test source) together. OSC listener came up with **59
  bindings** (the new derived addresses). `GET /param-center` on the engine after
  the companion ran confirms the derived keys are driven by the companion's OSC:
  `audioParty=1.0, audioNote=9.0, audioNoteHue=0.75, audioRiserScore=0.45,
  audioBuildScore=1.0, audioGenre=2.0, audioBpm=120, audioBeat=0.53,
  audioStructure=1.0` — the engine receives them, computes none.

## Net architecture (now)
The Audio Companion is the SOLE audio analyzer: it computes the full
analyzer + derived + detector set and emits everything over OSC. The engine
performs ZERO audio derivation — it receives every audio CPC key from the
companion. (The engine's raw-mic analyzer/capture subsystem remains for the
optional audio.enabled engine-mic mode + the CaptainPad Audio-tab device
management; it is dormant in the companion-analyzer deployment.)
