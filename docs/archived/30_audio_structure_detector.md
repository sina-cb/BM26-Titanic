# Design: Audio Structure Detector (Build / Drop / Sustain Cues)

> **⚠ SUPERSEDED — folded into [docs/37 — The Marsin Audio Framework](./37_marsin_audio_framework.md).**
> The detector shipped (Kalman+NIS drop, slow-zone, build/energy) and is now a framework Source + ops. New structure-signal design lands in docs/37. Kept for history.

**Status:** Superseded by docs/37 (detector implemented; was: Draft)
**Operator request (summarized):** make the rig feel like it *anticipates* the music — light the build-up before the drop lands, not a bar after it — without coupling the work to any larger framework and without ever silently overriding the operator's manual cue.

**Related:**
- Research memo `.agent/02_reports/202605/20260526_2_drop_mood_detection_research.md` (revised 2026-05-26; the "research vs. implementation" split was intentional — that memo holds the literature, this doc holds the buildable shape).
- Existing audio spec `docs/archived/25_marsin_audio_analysis.md`.
- Audio params modulation contract `docs/26_audio_params_playlist.md`.
- Adjacent (not a dependency) `docs/29_[todo]_node_based_audio_post_processing.md`. The chain framework is not required for this to ship; if it lands later, the detector's outputs could optionally feed it.

---

## Why

Today the lights *follow* the music — they see a kick, they react to it, and by the time the rig is on, the drop has been in the room for half a bar. Build-ups are the one place in the song where the music *announces what is coming* several seconds in advance: a riser, a snare roll, a vocal "drop the…" — the operator hears it and braces, and the rig is the only thing in the room that doesn't. The Audio Structure Detector closes that gap by watching the build, publishing a rising `audioBuildScore`, and firing a sparse `dropFired` event the instant the drop lands. The rig can then pre-arm intensity, swap palette on the downbeat, and feel like it's *with* the music instead of *after* it.

**Codex DNA served: "be welcoming."** A rig that anticipates is a rig that feels alive to the audience — they don't need to understand DSP to feel the difference between "the lights know" and "the lights are reacting." That perceived liveness is the difference between "huh, lights" and "I am inside the music."

---

## Processing locality

Mirrors `docs/29`'s rule, verbatim shape: **everything happens on the engine.**

| Concern | Where it lives |
|---|---|
| Envelope IIRs, flux, stems freshness, state machine | engine (`marsin_engine/lib/audio_structure_detector.js`) |
| Detector config (enabled flag, thresholds) | engine (`audio_state.yaml` via `audio_config.js`) |
| New CPC live keys (`audioStructure`, `audioBuildScore`, …) | engine (`param_center.js` registry) |
| `dropFired` event | engine emits on `/ws/control` |
| iPad "STRUCTURE" pill in pinned meters | iPad **displays** values from the engine's `liveParams` |
| iPad reaction to `dropFired` | iPad **displays** (e.g. a flash); never *computes* a structure decision |

Zero detection math runs on the iPad. The iPad reads CPC live values and consumes the sparse `dropFired` event for UI affordances only.

---

## Data shape

### New CPC live keys (registered in `marsin_engine/lib/param_center.js`)

Pattern matches the existing live-key entries in `param_center.js` (the `stems*` and `mic*` block around lines 86–158): `persist: false, live: true, portWatch: false`, no `oscAddress` (these are engine-emitted, not OSC-fed), `sharedFnName` matches `key`.

```yaml
audioStructure:
  type: int            # 0 = THIN, 1 = BUILD, 2 = SUSTAIN
  range: [0, 2]
  default: 0
  persist: false
  live: true
  broadcastHz: 10      # state transitions are coarse, no need for 30 Hz
  portWatch: false
  label: 'Audio · Structure'
  sharedFnName: 'audioStructure'

audioBuildScore:
  type: float
  range: [0.0, 1.0]
  default: 0.0
  persist: false
  live: true
  broadcastHz: 10
  portWatch: false
  label: 'Audio · Build Score'
  sharedFnName: 'audioBuildScore'

audioEnergyRatio:
  type: float
  range: [0.0, 1.0]    # log-mapped from raw short/long ratio so it's display-friendly
  default: 0.0
  persist: false
  live: true
  broadcastHz: 10
  portWatch: false
  label: 'Audio · Energy Ratio'
  sharedFnName: 'audioEnergyRatio'

audioVocalsHot:
  type: float          # 0.0 or 1.0; float for uniform shape with the others
  range: [0.0, 1.0]
  default: 0.0
  persist: false
  live: true
  broadcastHz: 5       # changes slowly; one update every ~200 ms is enough
  portWatch: false
  label: 'Audio · Vocals Hot'
  sharedFnName: 'audioVocalsHot'

audioDropPulse:
  type: float          # short envelope: jumps to 1.0 on drop, decays to 0 over ~600 ms
  range: [0.0, 1.0]
  default: 0.0
  persist: false
  live: true
  broadcastHz: 15      # fastest of the bunch so patterns get a clean ramp
  portWatch: false
  label: 'Audio · Drop Pulse'
  sharedFnName: 'audioDropPulse'
```

**Why a continuous `audioDropPulse` *and* a sparse `dropFired` event:** the event is for one-shot consumers (scene swaps, macro triggers, log lines); the continuous pulse is for shader-y consumers that want a smooth flash they can multiply into a pattern. Both come from the same edge.

### Sparse WS event for the drop instant

```js
{
  type: 'dropFired',
  confidence: 0.0..1.0,          // clip(buildScore × energyJump × stemsBoost, 0, 1)
  ts: <ms since epoch>,
  source: 'audioStructureDetector',
  // OPEN: include buildDurationMs?  See Open Questions §13.
}
```

**Routing:** must register in `marsin_engine/lib/ws_topic_routing.js` — the routing table is closed-by-default and broadcasts of an unknown `type` throw. Add to the `/ws/control` block:

```js
// /ws/control — low-rate UI-relevant events
dropFired: TOPICS.CONTROL,
```

`/ws/control` is right because: (a) the event is sparse (~once every 60 s of music, max), (b) every iPad tab already subscribes to it, and (c) it's UI-relevant (scene swap candidate, macro candidate, logging). It is NOT a high-rate signal; `/ws/signals` is for continuous meter updates and would be a mismatch.

---

## Detector state machine (pseudocode)

```
// Inputs (all from paramCenter live keys, read each tick):
//   micLow, micHigh, micKick
//   stemsBass, stemsDrums, stemsVocals      (consume only when stemsFresh)
//   tempoBpm
//   barPhase                                 (OPTIONAL; defer if LX doesn't expose it)
//
// Outputs (writes to paramCenter + emits dropFired on /ws/control):
//   audioStructure ∈ {0:THIN, 1:BUILD, 2:SUSTAIN}
//   audioBuildScore ∈ [0,1]
//   audioEnergyRatio ∈ [0,1]                 (log-mapped from raw ratio)
//   audioVocalsHot ∈ {0,1}
//   audioDropPulse ∈ [0,1]                   (decaying envelope post-drop)

// 0. Stems freshness — HARD PREREQUISITE.
//    Codex P0: no silent fallback to a "neutral" default. If stems
//    have stopped updating, we KNOW it and act differently — we do
//    not pretend stemsBass=0.0 is a real reading.
stemsFresh = (now - stemsLastUpdateMs) < STEMS_TIMEOUT_MS    // 300 ms default

// 1. Short / long energy envelopes (causal one-pole IIR)
shortEnv += dt / 0.2 * (micLow - shortEnv)           // tau ~200 ms
longEnv  += dt / 10.0 * (micLow - longEnv)           // tau ~10 s
rawRatio = shortEnv / max(longEnv, EPS)
energyRatio = clamp(log1p(rawRatio) / log1p(3.0), 0, 1)   // display-friendly 0..1

// 2. Half-wave-rectified high-band flux → build score
highFlux = max(0, micHigh - micHighPrev)
buildScore += dt / 2.0 * (highFlux * BUILD_GAIN - buildScore)   // ema, tau ~2 s
buildScore = clamp(buildScore, 0, 1)
micHighPrev = micHigh

// 3. Stems booleans (only meaningful when stemsFresh)
stemsFull = stemsFresh && (stemsBass > 0.4) && (stemsDrums > 0.4)
stemsThin = stemsFresh && (stemsBass < 0.15) && (stemsDrums < 0.15)
vocalsHot = stemsFresh && (stemsVocals > 0.4)

// 4. Optional bar-phase gate
nearDownbeat = barPhase ? (abs(barPhase - 0) < 0.05) : true   // permissive if absent

// 5. State machine
switch (state):
  THIN:
    if buildScore > BUILD_THR && energyRatio rising for > 1 s:
      state = BUILD
      buildStartedAtMs = now

  BUILD:
    if energyJump > 1.5x in < 500 ms AND (stemsFull || !stemsFresh) AND nearDownbeat:
      state = SUSTAIN
      conf = clamp(buildScore * energyJump * (stemsFull ? 1.0 : 0.7), 0, 1)
      audioDropPulse = 1.0                         // will decay below
      emitWS({type:'dropFired', confidence:conf, ts:now, source:'audioStructureDetector'})
      logTransition('BUILD→SUSTAIN drop', conf)
    elif (now - buildStartedAtMs) > 6000 && buildScore decaying:
      state = SUSTAIN                              // false build, never dropped
      logTransition('BUILD→SUSTAIN (false build)', 0)
    elif energyRatio < 0.3 for > 1 s:
      state = THIN                                 // collapsed before drop
      logTransition('BUILD→THIN (collapse)', 0)

  SUSTAIN:
    if energyRatio < 0.5 && (stemsThin || !stemsFresh):
      state = THIN
      logTransition('SUSTAIN→THIN', 0)
    elif buildScore > BUILD_THR && energyRatio rising:
      state = BUILD                                // second build inside a sustain block
      buildStartedAtMs = now
      logTransition('SUSTAIN→BUILD', 0)

// 6. Decay the drop pulse every tick
audioDropPulse += dt / 0.6 * (0 - audioDropPulse)  // 600 ms decay

// 7. Publish (write to paramCenter)
pc.set('audioStructure',   stateAsInt(state),     'audioStructureDetector')
pc.set('audioBuildScore',  buildScore,            'audioStructureDetector')
pc.set('audioEnergyRatio', energyRatio,           'audioStructureDetector')
pc.set('audioVocalsHot',   vocalsHot ? 1.0 : 0.0, 'audioStructureDetector')
pc.set('audioDropPulse',   audioDropPulse,        'audioStructureDetector')
```

**Bar-phase note:** if LX doesn't emit a phase signal yet, `nearDownbeat` defaults to `true` and the gate is effectively disabled. False-positive rate goes up; nothing else breaks. The detector reports `barPhaseAvailable: false` in its status so the operator knows what they're losing.

---

## Module location & wiring

### File

`marsin_engine/lib/audio_structure_detector.js` — small stateful module, pattern after `modulation_controller.js` (a class with a `tick(now, dt)` method, a `reset()`, and a `getStatus()` for diagnostics). No new dependencies. Pure JS, no WASM.

### Where it's called from

Either of (TBD by engine expert at implementation):
1. `audio_analyzer.onAnalysis(frame)` — fires per analyzer hop. Lowest latency, naturally rate-limited to the analyzer's hop rate.
2. The engine's tick loop in `engine.js` — fires at the render tick, may need internal rate-limiting.

Recommendation: option (1). The detector's natural sample rate is the analyzer's hop rate (~86 Hz on mic), and tying it there means it auto-pauses when the analyzer is disabled.

### Consumes (read-only)

- `paramCenter` live keys: `micLow`, `micHigh`, `micKick`, `stemsBass`, `stemsDrums`, `stemsVocals`, `tempoBpm`. **No chain framework dependency.**
- A `stemsLastUpdateMs` timestamp the engine already tracks per OSC route (or that the detector itself records on the first stem write it observes).

### Publishes (write)

- `paramCenter.set(...)` for the five new live keys.
- `ws.broadcast({type:'dropFired', ...})` via the engine's existing WS broadcast helper.
- `console.log(...)` for every state transition (operator wants every transition logged with timestamp + confidence).

---

## Lifecycle / wiring

- **Disabled by default.** A new `audio.structureDetector.enabled` field in the audio config defaults to `false`. The detector module is *instantiated* at engine boot regardless, so its REST surface always exists; but `tick()` is a no-op when `enabled === false`.
- **Engine bootstrap** (in `engine.js` or `api_server.js` at audio setup): `const detector = new AudioStructureDetector({ paramCenter, ws, getConfig: () => audioConfig.structureDetector })`. Wire its `tick()` into `audio_analyzer.onAnalysis`.
- **Hot enable/disable** via the existing `PATCH /audio/config` route (already in `api_server.js` around line 2550) with `{ structureDetector: { enabled: true|false, ...thresholds } }`. The `validateLivePatch` in `audio_config.js` validates the new fields.
- **On disable:** the detector resets its state machine to `THIN`, zeroes the five new live keys, and stops emitting. No half-state.
- **Logging:** every state transition writes one line to engine stdout: `[audioStructure] 2026-05-26T03:14:15.926Z THIN→BUILD buildScore=0.62`. Every `dropFired` logs separately with confidence. No filtering — the operator wants every transition during a 7-night show so they can post-mortem.
- **Never triggers irreversible actions.** No deck swaps. No engine blackouts. No playlist auto-advance. No GEM macro fires. The detector is **observe-and-publish only.** A future PR may wire the `dropFired` event to operator-chosen automation, but that's a separate, opt-in act of the operator's hand.

---

## iPad consumer hooks (minimal)

1. **Update the hardcoded live-key seed list** in `CaptainPad/hooks/useEngineState.ts` (the `liveKeys` Set near line 485) to include the new keys:

   ```ts
   const liveKeys = new Set([
     'micLow', 'micMid', 'micHigh', 'micKick',
     'stemsVocals', 'stemsBass', 'stemsDrums',
     'tempoBpm',
     // audio structure detector (docs/30) — appear once detector is enabled
     'audioStructure', 'audioBuildScore', 'audioEnergyRatio',
     'audioVocalsHot', 'audioDropPulse',
   ]);
   ```

   When the detector is disabled, the REST seed simply won't contain these keys; the Set is a *filter*, not a contract, so unused entries are harmless.

2. **"STRUCTURE" pill in the audio tab's pinned meters** (depends on the pinned-meters work currently in flight under `docs/29` Wireframe A). One small pill showing `THIN` / `BUILD` / `SUSTAIN` with a small confidence bar underneath. Future PR — not in Phase 1.

3. **No automatic actions wired to `dropFired` in this PR.** A `dropFired` event lands on `/ws/control`; the iPad's existing control-topic subscriber will receive it, but no handler does anything with it yet. The operator decides separately (in a future PR) whether to wire it to a GEM macro, a pattern transition, or just a UI flash.

---

## Edges

- **Empty state (detector disabled, default).** Module instantiated, `tick()` no-ops, none of the five live keys appear in CPC, no `dropFired` events. iPad sees no change. This is the default and the safe state.
- **Stems offline (OSC silence > `STEMS_TIMEOUT_MS`).** Detector falls back to mic-only mode. Stem booleans report `false` (not "unknown" — we explicitly know they're stale). The state machine still runs but with lower confidence. Surfaces a status field `structureDetectorStems: 'offline'` so the operator can see *why* false-fires are up.
- **Audio analyzer disabled.** No `onAnalysis` callbacks fire → detector receives no input → no state change, no publishes, no events. Effectively the same as disabled. The detector logs `[audioStructure] analyzer offline; idling` once on transition into that state.
- **Music genre outside EDM (hip-hop, drum'n'bass, ambient).** Detector still publishes whatever it can. Expected accuracy degrades materially (see research memo §1 genre-limitations). The operator should disable the detector for non-EDM sets — there is no auto-genre-detection here.
- **Detector enabled but `paramCenter` write fails** (e.g. registry not bootstrapped). The detector logs the failure once and disables itself for the remainder of the session. Codex P0: no silent retry-loop, no muddled "neutral state."
- **Saturated state (drop every 8 seconds, e.g. a remix montage).** Refractory window: after a `dropFired`, suppress further `dropFired` events for at least 2 seconds. The state machine still runs; only the event is rate-limited.
- **Conflict state (operator manually fires a cue at the same instant).** Not a conflict — the detector publishes, the operator presses the button, both events land downstream. The operator's manual action is always primary because the detector does not trigger anything by itself.

---

## Performance budget

**Target:** ≤ 0.5 ms per analyzer hop on a current-gen Mac (M-series or x86 mid-tier). The detector is causal IIRs + booleans + a small switch statement; this should be trivial. Stating the budget explicitly so a future code change can be measured against it — if a regression pushes it past 0.5 ms, that's a signal something has crept in (e.g. someone added a recurrence matrix).

A simple `performance.now()` bracket around `tick()` with a rolling p99 reported in `getStatus()` is sufficient instrumentation; no fancy profiler needed.

---

## What it deliberately is NOT

- **Not a chord/key/genre/affect classifier.** No harmonic analysis. No emotion model.
- **Not an ML model.** No inference runtime. No external model files. No `tensorflow.js`, no `onnxruntime`. The engine boots with zero new dependencies.
- **Not a verse/chorus/intro/outro labeler.** It does not know whether the current SUSTAIN is the first chorus or the second; it has no song-position memory.
- **Not the chain framework's first user.** This module stands alone. If `docs/29`'s chain framework lands later, the detector's output keys could be consumed by a chain like any other live param — but the detector does not live *inside* the chain framework and does not block on it.
- **Not a phrase-level cue system.** Just the 3-state machine + drop event. Phrase-level analysis (8-bar boundaries, sub-phrase risers, breakdown sub-sections) is out of scope.
- **Not an auto-VJ.** The detector never decides what the rig does. It only publishes what it thinks it observed. The operator (or an operator-chosen automation in a future PR) decides what to do about it.

---

## Open questions for the operator

1. **Should the `dropFired` payload include the BUILD duration that preceded it** (so consumers can size the visual response — a long build deserves a bigger flash than a 2-second tease)?
2. **Should there be a `falseFire` confidence-decay mechanism?** After N false positives within M seconds, the detector self-quiets (publishes the live keys but suppresses `dropFired` events) until it sees a clean run again. Default proposal: N=3 in 30 s → 60 s of event-quiet. Yes/no?
3. **LX Studio bar-phase: does the operator's setup expose this on OSC?** If yes, this is the single biggest accuracy win available without ML. If no, the design defers it; the gate degrades gracefully (it becomes a no-op) and the operator just lives with the higher false-positive rate.

---

## Recommended implementation path

Slice-shaped phases. Each phase is shippable on its own; the operator can stop at any phase boundary and still have a coherent system.

1. **Phase 1 — Engine-only, observe-and-publish.**
   `04.2_marsin_engine_expert` to land:
   - `marsin_engine/lib/audio_structure_detector.js` module.
   - Five new CPC live keys registered in `param_center.js`.
   - `dropFired` entry in `ws_topic_routing.js` → `/ws/control`.
   - `audio.structureDetector.enabled` field in `audio_config.js` + validation in `validateLivePatch`.
   - Bootstrap in `engine.js` / `api_server.js`, wired to `audio_analyzer.onAnalysis`.
   - Logging of every state transition + every `dropFired` to stdout.
   - **Disabled by default.** Operator turns it on via `PATCH /audio/config` and observes via stdout + WS frames.
   - No iPad UI change. Phase 1 is verifiable purely with `curl` + log tailing.

2. **Phase 2 — iPad pinned-meter pill + seed-list update.**
   Depends on the audio pinned-meters work currently shipping under `docs/29` Wireframe A. `04.1_captain_pad_expert` to land:
   - Add the five new keys to the `liveKeys` Set in `useEngineState.ts`.
   - Add a small "STRUCTURE" pill in the audio tab's pinned meter row (THIN/BUILD/SUSTAIN text, small confidence bar).
   - Optional: a brief subtle flash when `dropFired` lands on `/ws/control` (UI-only, never wired to a real action).

3. **Phase 3 — Small labelled dataset for validation.**
   `researcher / dataset-builder` task: assemble 10 EDM tracks, hand-annotated drop times + rough region labels. Run the Phase 1 detector against the clips, measure precision/recall on drop events and class agreement on `audioStructure`. Tune the IIR time constants, `BUILD_THR`, `STEMS_TIMEOUT_MS`, `energyJump` threshold against the dataset. **This phase is the gate for any show-critical automatic behavior built on top of the detector** (per the revised research memo's revised gating rule).

4. **Phase 4 (optional) — Operator-tunable knobs in the audio config.**
   `04.2_marsin_engine_expert` + `04.1_captain_pad_expert`:
   - Expose `buildScoreThreshold`, `dropConfidenceCutoff`, `stemsRequired` (boolean: hard-require fresh stems before allowing `dropFired`), `eventRefractoryMs` as fields under `audio.structureDetector`.
   - Add a small "Detector" section to the audio tab with these as standard MiniFader/Toggle controls.
   - This is taste-tuning; not needed until the operator has played with the defaults and decided where they want to push the curve.

---

## Self-check

- [x] Empty state (detector disabled, the default) and error states (stems offline, analyzer offline, paramCenter write failure) are all described in §Edges.
- [x] Codex goal named in §Why ("be welcoming" — anticipation makes the rig feel alive).
- [x] Latency target is quantified (≤ 0.5 ms per analyzer hop; detector latency ≤ 500 ms ≈ 1 bar at 120 BPM).
- [x] Reuses existing components: `paramCenter`, `ws_topic_routing`, `audio_config` / `validateLivePatch`, `audio_analyzer.onAnalysis`. No new module categories invented.
- [x] Clear handoff path: Phase 1 → `04.2_marsin_engine_expert`; Phase 2 → `04.1_captain_pad_expert`; Phase 3 → researcher/dataset-builder; Phase 4 → both experts.
