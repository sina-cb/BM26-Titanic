# Plan — marsin_audio_framework doc + audio-docs reconciliation

**Date:** 2026-06-16 · **Branch/PR:** `claude/audio-corpus-tuning-olcd6i` (#22)

Operator asked for a single design doc that tells the audio-analysis story end
to end (companion → tune signals → OSC → engine CPC) and reconciles the older,
now-fragmented audio docs.

## Deliverables
1. **`docs/37_marsin_audio_framework.md`** — the unifying framework + story:
   typed-port op graph (raw **Sources** → **Ops** incl. Kalman / DanceMaker →
   **OSC Sink** into CPC), native-signal selection, in-app post-processing,
   visualizers, an **Output UI** to choose what lands in the engine over OSC,
   launch-with-engine + config in `config.yaml`, port registration, and
   bulletproof-startup best practices.
2. **Reconcile** the audio docs:
   - **Superseded → folded into 36** (deprecation header pointing to 36):
     `25_marsin_audio_analysis`, `29_node_based_audio_post_processing`,
     `30_[todo]_audio_structure_detector`.
   - **Kept, cross-referenced** (different concern, still valid):
     `24_osc_integration` (OSC transport into CPC), `26_audio_params_playlist`
     (routing CPC audio signals → pattern/global params),
     `34_pro_audio_via_osc_sidecar` (external heavy-analysis sidecar — the
     Companion is a first-party realization of the same OSC-in pattern).
3. **Ports:** register the Companion in the central ports table
   (`.agent/00_gol/13_multi_agent.md`) and fix the **6970 collision** (Sim save
   server) → Companion moves to **6973**.

## Phasing (build, after the doc lands — candidate agent fan-out)
> Updated 2026-06-16 after the 4-review consolidation
> (`20260616_3_…`) + operator additions (Audio Slice lane, ops migration).
> P0 now leads — the shipped drop detector is broken.

- **P0 drop-detector re-tune** (blocking): lower `KALMAN_Q` and/or relax the
  same-hop AND to a ±N-hop co-occurrence window; re-validate on the corpus until
  `tests/integration/audio_analysis_validation.test.mjs` passes. Fix the stale
  `useKalman:false` comment in `audio_analyzer.js`. (docs/37 §12.2)
- P1 framework core: `Port` types (incl. `freqWindow`) + `Op` base + registry +
  raw `Source`s + `OscSink`. **Migrate ALL 13 existing ops** (Gain/Bias/Clamp/
  Lpf/Biquad/Envelope/Slew/Curve/Compressor/Slope/Normalizer/Schmitt/Hold) from
  `signal_post_processor.js` into the typed-port node interface, then **remove the
  old `OP_SCHEMA` + `apply()` path** (one code path per op; snapshot/parity tests
  guard behavior). Port the dom-dance to a **`DanceMaker`** op with a **parity
  test** vs the current spring; add the **`Kalman`** op. (docs/37 §2.2, §11)
- P1 realtime (was P4): **jitter buffer + drift-corrected hop clock + nominal
  `dt`** (docs/37 §13) — the real fix for "discretized packets"; extend
  `{type:'diag'}` with the post-buffer metrics + ffmpeg low-latency flags.
- P1 config exposure: `audio.dom.*` / `audio.structureDetector.drop.*` validators
  in `audio_config.js` + Companion tuning UI (also the field workaround for P0).
- P2 engine integration: `audioCompanion:` config block, engine boot
  starts/supervises the Companion (and, when enabled, **Audio Slice** —
  local-only), OSC output → CPC, OSC verify (not auto-enable; §7 read-back).
- P2 **Audio Slice lane** (local-only, docs/37 §6.2): supervised CLI launch +
  OSC-in listener (port 10001) + `rawStem*` / `rawSliceBpm` / `rawSliceBeat`
  Sources. Buildable anywhere; end-to-end validation requires the local binary.
- P2 UI: HiDPI/`dpr` + resize fix, theme rehaul on the Sim's `theme.js` token
  pipeline, a11y, configurable visualizers, the **Output UI**. Decide graph-editor
  scope (full node graph vs linear-chains + Output list) before building.

Docs authored coherently here; the build phases parallelize across sub-agents.
