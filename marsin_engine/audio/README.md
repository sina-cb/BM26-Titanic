# `marsin_engine/audio/` — the audio subsystem

All audio code lives here (moved out of `lib/` 2026-06-14). The engine wires
these together in `engine.js`'s audio boot path; the live signals flow to
CaptainPad + the Audio Companion over the `/ws/signals` socket.

## ░ HARD, UNBREAKABLE RULE — single source of truth ░

> The **Audio Companion** (`audio/companion/`) and any future audio tooling
> MUST run the engine's REAL audio code by importing it from `audio/…`. They
> MUST NEVER reimplement, fork, or shadow any audio-processing logic (FFT
> bands, kick, flux, the post-processing chain ops, the detector) in their own
> code path. **One source of truth.** A chain/signal that previews in the
> Companion is byte-for-byte what the engine runs. New audio behaviour lands
> in `audio/…` first; tools only render/drive it. (Also stated in `engine.js`.)

| Dir | Holds | Key exports |
|---|---|---|
| `analyzer/` | FFT band energies (low/mid/high) + kick detector + spectral flux + the software `inputGain` preamp | `audio_analyzer.js` → `AudioAnalyzer` |
| `capture/` | mic/line capture (ffmpeg + file replay), device enumeration, mic picker | `audio_capture.js`, `audio_devices.js`, `audio_mic_chooser.js` |
| `postproc/` | the per-signal post-processing **chains** (gain/lpf/envelope/schmitt/hold/…) + the audio signal family registry | `signal_post_processor.js` → `SignalPostProcessor`, `audio_signals.js` |
| `detector/` | structure detector (THIN/BUILD/SUSTAIN + drop cues) — **disabled by default, under development** | `audio_structure_detector.js` → `AudioStructureDetector` |
| `config/` | audio config merge/validate + per-scene state store | `audio_config.js`, `audio_config_store.js` |
| `calibrate/` | venue/mic calibration tool (CLI) | `audio_calibrate.js` |
| `experimental/` | experimental, not-on-the-critical-path surfaces | `audio_companion/` (live visualiser UI) |

Tuning workflow + per-signal recipes: `.agent/01_skills/06_audio_corpus_tuning.md`.
Datasets used for tuning: `marsin_engine/datasets/README.md`.

> The audio test files stay under `marsin_engine/tests/` (so the
> `node --test tests/*.test.js` glob keeps finding them); they import the
> sources from their new `audio/…` homes.
