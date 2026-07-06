# 20260621_11 — Companion is the SOLE analyzer: all derived signals over OSC

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-21

## Ask
Move all engine-side audio computation into the Audio Companion, send every
signal over OSC, clean up the engine, and have it work transparently (no-op).

## Diagnosis (recap)
With `audio.enabled:false` in the engine (the deployment), the engine's own
DerivedSignals/detector NEVER run — they live inside the analyzer hop, which only
exists when audio is enabled. The companion computed the full derived set but
only EMITTED the raw bands + BPM, so ~25 derived signals (note, genre, beat,
climax, drop, onsets, phrase…) reached the engine as nothing — they were dead.
The engine's `audio_signals.js` registry only bound ~5 of them for OSC inbound.

## Done — the move (verified)
**Part A — engine binds every derived address** (`audio/postproc/audio_signals.js`):
added `osc: '/marsin/audio/<x>'` to every DETECTOR / DERIVED / ONSET_PULSE key
that lacked one (~25 new inbound bindings). `onsetPulseDescriptor` now honors
`osc`. Additive — the bindings are dormant unless OSC arrives.

**Part B — companion emits every derived signal** (`companion_server.js`): imports
the shared `audioRegistryEntries` (single source of truth for key→address),
registers every computed derived key as a built-in OSC output, and emits them all
each hop at their canonical addresses (guarded + throttled by the OSC OUTPUT
RATE). The OSC OUT page's old "engine-internal, not routed" tier is gone — every
signal is now in the sent table.

**Validation:** full engine suite **1314/1314**. Companion booted on :6966, OSC
OUT page shows **38 outputs** all sending (~55.6/s at 60 fps) — micLow…micDom
(designed) + BPM + the full derived set (beat/party/note/notehue/switch×2/
beatinbar/barphase/downbeat/onset×3/chest/genre×2/riser/buildeta/riserconf/
silence/trackchange/climax/phrase×2/dropcountdown/build/drop/slow/energy/
structure), each at `/marsin/audio/<x>`. Live values flowing (party 1.0, note 9,
riser 0.32, build 0.72…). Screenshot `~/tmp/mic_shots/15_osc_all_signals.png`.

## Engine computation status (Part C)
In the deployment (`audio.enabled:false`) the engine now performs **zero** audio
computation — every audio CPC key is driven by the companion's OSC. The
companion uses the SAME DerivedSignals + AudioStructureDetector modules, so the
values are identical (a true no-op move, just a different host).

The engine's derived/detector CODE is **retained** as the `audio.enabled:true`
self-contained fallback (engine-mic / file-replay testing). It is DORMANT in the
companion-analyzer deployment. Physically deleting it is a separate, riskier step
(abandons the fallback + rewrites the file-replay/HIL tests that exercise it) and
was deliberately NOT done on the mission-critical audio→light path without
isolating it first. Recommend keeping it; revisit removal as its own task.

## Note for the operator
For the detector-derived keys (drop / slow / structure / build / energy) to carry
non-zero values, enable the structure detector in the COMPANION (it defaults off,
same as the engine did) — then they flow over OSC like the rest.
