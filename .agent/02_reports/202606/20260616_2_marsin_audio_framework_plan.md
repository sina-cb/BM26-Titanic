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
- P1 framework core: `Port` types + `Op` base + registry + raw `Source`s + core
  ops (Gain/Smooth/Kalman) + `OscSink`. Port the dom-dance to a **`DanceMaker`**
  op with a **parity test** vs the current spring output.
- P2 engine integration: `audioCompanion:` config block, engine boot
  starts/supervises the Companion, OSC output → CPC, OSC auto-enable.
- P3 UI: CaptainPad/Sim theme + color-theme selector, configurable visualizers,
  the **Output UI** (choose signals → OSC mappings).
- P4 realtime: jitter buffer + capture-latency tuning (driven by the new
  `{type:'diag'}` metrics on the operator's mic).

Docs authored coherently here; the build phases parallelize across sub-agents.
