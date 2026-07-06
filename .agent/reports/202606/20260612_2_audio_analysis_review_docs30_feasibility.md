# Audio Analysis Review + docs/30 Feasibility (Audio Structure Detector)

- **Branch:** dev/claude/audio_review (worktree), report delivered on claude/laughing-lamport-tb6cc9
- **Parent branch:** claude/laughing-lamport-tb6cc9 @ c1bce64
- **Worktree:** ~/BM26-Titanic-worktrees/audio_review
- **Mode:** investigator — read-only code review, no engine boot, no source changes
- **Scope:** (1) review how the in-engine audio analysis works today, (2) feasibility of
  `docs/30_[todo]_audio_structure_detector.md`, (3) recommendations for making audio
  analysis better / more flexible / easier to set up, including third-party library options
  (operator supplied two external research summaries on open-source audio analysis libs).

---

## 1. How the audio analysis system works today

The implementation matches `docs/25_marsin_audio_analysis.md` and `docs/29` closely; both
are **shipped**, not TODO (despite docs/29's filename in some cross-references). The full
signal path:

```
ffmpeg (avfoundation/dshow/pulse/alsa) ── s16le PCM ──▶ AudioCapture (lib/audio_capture.js)
    spawn shell:false, exponential-backoff restart, audioStatus events
        │ Int16Array hop frames (hopSize=512 @ 44.1 kHz ≈ 86 hops/s)
        ▼
AudioAnalyzer (lib/audio_analyzer.js)  — PURE DATA SOURCE
    ring buffer (fftSize=1024) → Hann → fft.js realTransform
    → per-band sum-of-magnitudes (low ≤200 Hz, mid ≤4 kHz, high ≤nyquist)
    → softCompress(8·E) → noiseGate(0.04, rescaled) → asym envelope (atk 8 ms / rel 180 ms)
    → kick: instant vs asymmetric-EMA threshold (slow-up/fast-down + slow-trail ceiling
      clamp ×1.5 — the 2026-05-26 "sustained loud bass kills kick detector" hot-fix)
    → onAnalysis({low, mid, high, kick})  — RAW, pre-gain
        │ engine.js onAnalysis (engine.js:1300-1330): computes dt per hop
        ▼
SignalPostProcessor (lib/signal_post_processor.js)  — docs/29 chain framework
    per-signal op chains, 12-op catalog (gain/bias/clamp/lpf/envelope/schmitt/hold/
    curve/slew/compressor/biquad/slope), strict validation (codex P0, no fallbacks),
    default chains: bands = Gain(paramKey '<sig>Gain'); micKick = Gain→Envelope→Schmitt→Hold
    chains persisted in states/<scene>/audio_state.yaml `chains:`; REST PUT/PATCH/reset;
    5 Hz editor preview gated by setEditorSubscribed
        │
        ▼
ParamCenter (CPC) — paramCenter.setMany([...8 keys], 'audio', 'audio:mic')
    micLow/Mid/High (post) + micKick + micLowRaw/... (pre-gain mirrors)
    live-key policy: persist:false, live:true, broadcastHz 15 (30 for kick)
    multi-subscriber: paramCenter.subscribe(fn) (param_center.js:528) + legacy onChange
        │                                  │
        ▼ shared fns (40 fps engine tick)  ▼ /ws/signals liveParams (throttled)
    patterns (effective = audioReactivity × <sig>Gain × <sig> — gain now applied
    in-chain, patterns read post value)    CaptainPad Audio tab + deck meters
```

Parallel inputs into the same CPC live-key surface:

- **OSC stems** (`lib/osc_listener.js`): `/marsin/stems/{bass,drums,vocals}` from an
  external analyzer. Each scalar with a gain partner goes through the **same**
  SignalPostProcessor chains (osc_listener.js:551-582), with per-key dt computed from
  `_lastDispatchAt[key]` — i.e. per-stem last-write timestamps already exist (private).
  Raw mirrors (`stems*Raw`) published alongside.
- **tempoBpm** via `/lx/tempo/bpm` → `BpmSpeedSync` (lib/bpm_speed_sync.js) subscribes via
  `paramCenter.subscribe` and drives `speed` when `bpmSpeedSync=1`.

Config: `config.yaml audio:` defaults ◀ `states/<scene>/audio_state.yaml` (mic device +
tuning + chains, per-scene everything). Mic setup via `--choose_mic/--mic/--list_mics/
--clear_mic` CLI (lib/engine_cli_flags.js + audio_mic_chooser.js). Live tuning via
`PATCH /audio/config` (validateLivePatch in lib/audio_config.js, grouped
LIVE_FIELD_VALIDATORS incl. `kickEma`). WS routing is a **closed table**
(lib/ws_topic_routing.js) — unknown types throw; audio traffic split onto `/ws/signals`
(liveParams, signalChain) and `/ws/control` (audioStatus, audioChainsChanged).

Test coverage is genuinely good: 9 unit suites (analyzer, capture, capture-platform,
config, config-store, devices, boot-mic-check, bpm-sync, signal_post_processor) plus
`hil_ws_audio_settle_test.mjs` and an `osc_audio_sender.py` helper.

**Assessment:** this is a clean, well-factored, well-documented stack. The separation
(capture → pure analyzer → operator-tunable chain → CPC) is exactly right, the kick
detector's asymmetric EMA + ceiling clamp shows real-world hardening, and the codex
no-fallback discipline is applied consistently. The main *capability* gaps are: only 4
mic-derived scalars (3 band envelopes + kick), no spectral flux/onset-strength primitive,
no mic-side tempo, no loudness normalization (fixed PRE_CLAMP_GAIN=8, hand-tuned
noiseGate), and the chain framework is strictly per-signal (no cross-signal ops).

---

## 2. Feasibility of docs/30 (Audio Structure Detector)

**Verdict: HIGH feasibility, low risk, modest effort.** The design doc is unusually
well-grounded — every integration point it names exists in the code today and matches the
doc's description, line numbers included:

| docs/30 claim | Verified in code |
|---|---|
| CPC live-key pattern to copy (`stems*`/`mic*` block) | param_center.js:88-215 — exact shape (persist:false, live:true, broadcastHz, sharedFnName) |
| Per-key `broadcastHz` supported | registry honors per-entry broadcastHz (param_center.js:632) |
| `dropFired` must be added to closed WS routing table | ws_topic_routing.js TOPIC_BY_TYPE — one line + the unit/HIL tests that pin classification |
| Hook at `audio_analyzer.onAnalysis` with dt available | engine.js:1299-1330 already computes per-hop `dt`; detector `tick(now, dt)` slots in after the four `process()` calls |
| `PATCH /audio/config` + `validateLivePatch` extension | audio_config.js grouped LIVE_FIELD_VALIDATORS (kickEma precedent) — `structureDetector` group follows the same pattern |
| `paramCenter` reads + multi-subscriber | `get()` + `subscribe()` (param_center.js:528) both available |
| Stems freshness timestamp | osc_listener tracks per-key `_lastDispatchAt` (private); detector recording its own last-write times via `paramCenter.subscribe` (as the doc's fallback suggests) is the clean path |
| iPad `liveKeys` Set near line 485 | useEngineState.ts:587 — present, hardcoded, comment admits drift risk |
| Module template `modulation_controller.js` | exists, same tick/reset/getStatus shape |

Effort estimate: **Phase 1 is a 1–2 day single-agent slice** (~1 new module ~300 lines +
~5 registry entries + 1 routing line + config validation + bootstrap + unit tests).
Phase 2 (iPad pill) is small. Phase 3 (labelled dataset) is the real work and correctly
gates show-critical automation only.

The detector math is all O(1) IIRs per hop — the ≤0.5 ms/hop budget is generous by
~2 orders of magnitude. Observe-and-publish only, disabled by default, no new deps: the
blast radius is essentially zero.

### Risks / corrections to fold into implementation

1. **Read the `*Raw` keys, not the post-chain keys.** docs/30 §Consumes lists `micLow`,
   `micHigh`, `micKick` — those are **post-chain** values. If the operator drags a gain
   slider (or a chain op like compressor/schmitt reshapes a band) mid-build, the detector
   sees a step change in "energy" and can false-fire `dropFired`. The pre-gain mirrors
   (`micLowRaw`, `micHighRaw`, `stemsBassRaw`, …) already exist precisely to be
   operator-independent. Recommendation: detector consumes raw mirrors; doc should be
   amended. (Counter-argument "detector should see what patterns see" loses: the
   detector models the *music*, not the rig.)
2. **buildScore flux source.** `highFlux = max(0, micHigh − micHighPrev)` runs on an
   already-enveloped signal. Attack is 8 ms so rises do pass through largely intact, but
   `BUILD_GAIN` will need tuning against that envelope, not raw FFT flux. Cheaper and
   cleaner long-term: emit a true per-hop positive spectral flux from the analyzer (it
   already has the magnitude spectrum in hand — see suggestion §3.2 below) and let the
   detector consume `micFlux`.
3. **barPhase does not exist today.** Only `/lx/tempo/bpm` is bound in CPC/OSC. The doc
   already degrades gracefully (`nearDownbeat = true`); answer to its Open Question 3 is
   "not currently bound — needs an operator-side LX trace + one new OSC live key if LX
   emits phase." Expect the higher false-positive rate of the no-gate config
   (research memo priors: precision ~0.65-0.75 → with bar phase ~0.70-0.80).
4. **State-machine conditions need trend state.** "energyRatio rising for > 1 s" /
   "buildScore decaying" require small extra trackers (last-crossing timestamps); trivial
   but should appear in the module, not be discovered during review.
5. **`audioStructure` as `type: int` live key** — verify the live-key broadcast path and
   iPad meters handle int-typed live params; everything live today is float. The doc
   itself hedges (`audioVocalsHot` is "float for uniform shape"); simplest is to make
   `audioStructure` a float-encoded enum (0/1/2) for uniformity.
6. **Open Questions 1–2** (include buildDurationMs in payload; falseFire self-quiet):
   both cheap; recommend YES to buildDurationMs (consumers sizing the response is exactly
   the anticipation feature) and YES to the self-quiet with the proposed N=3/30 s → 60 s
   defaults, surfaced in `getStatus()` so the operator can see the detector benched itself.
7. **Genre reality check stands** (research memo): expect it to work on main-stage EDM
   and to be wrong on dubstep/DnB/hip-hop/ambient. The disabled-by-default +
   observe-only posture is the correct mitigation; keep it.

---

## 3. Suggestions — better, more flexible, easier to set up

### 3.1 Should we adopt a professional audio analysis library?

Constraints that matter here: the engine is **Node/ESM**, must run **offline on the playa**
(no CDNs, no runtime installs, vendored deps), cross-platform (mac/win/linux + Pi), and
the codex bans un-debuggable black boxes. Mapping the operator's research (ChatGPT/Gemini
summaries) onto those constraints:

| Option | Fit | Notes |
|---|---|---|
| **Keep hand-rolled fast lane** (current) | ✅ baseline | Already tuned, tested, cited, debuggable. Do not replace it. |
| **Meyda** (JS, MIT) | ✅ **best low-friction add** | Pure JS, zero native deps, runs in Node on arbitrary Float32 frames (`Meyda.extract`) — vendorable like fft.js. Buys spectralFlux, spectralCentroid, spectralFlatness, Bark loudness, chroma, MFCC. No BPM/pitch (we don't need them from the mic — LX supplies tempo). |
| **aubio / aubiojs** (WASM, GPL) | ⚠️ niche | Best-in-class causal onset/tempo/pitch. WASM is fine (we already run a WASM pattern VM). Only worth it if we want mic-side BPM or proper onset events; GPL acceptable for this project but heavier than Meyda for what docs/30 needs. |
| **essentia.js** (WASM, AGPL) | ⚠️ hold | Broadest descriptor set, but multi-MB WASM, API friction, AGPL, and its real-time/streaming surface in JS is much thinner than native Essentia. Overkill for THIN/BUILD/SUSTAIN. |
| **Python sidecar (madmom/Essentia/aubio) over OSC** | ✅ **already architecturally supported** | This is exactly what the stems provider is. The OSC live-key surface is our de-facto pro-analyzer plugin interface: any external tool that can emit OSC scalars can feed CPC today. Beat/downbeat (madmom DBN online) or key detection would arrive this way, on a second machine or process, without touching the engine hot path. Document it as the official extension point rather than embedding heavy MIR in-engine. |
| librosa / MSAF / offline neural (EDMFormer etc.) | ❌ runtime | Offline-only; useful for Phase 3 dataset annotation tooling, not the live path. |

**Recommendation:** two-lane architecture, formalized — which is what both research
summaries independently converge on and what the codebase already half-has:

- **Fast lane (in-engine, keep):** current analyzer + chains + (new) structure detector.
- **Descriptor lane (in-engine, add when needed):** vendor **Meyda**, feed it the same hop
  frames, publish selected descriptors as new CPC live keys (`micFlux`, `micCentroid`,
  `micFlatness`). ~50 lines of glue; MIT; offline-safe.
- **Heavy lane (out-of-engine, document):** external analyzers over OSC (the stems path),
  for anything needing real MIR (downbeats, key, ML). Standardize `/marsin/audio/<key>`
  addresses and make new OSC-fed live keys config-driven (see 3.3).

### 3.2 Highest-value new primitive: spectral flux from the analyzer

Independent of any library: the analyzer already computes the magnitude spectrum every
hop and throws it away after band-summing. Keeping the previous hop's spectrum and
emitting `sum(max(0, |X[k]| − |Xprev[k]|))` (SuperFlux-lite, per the research memo §A2)
costs one Float array + one loop and gives:

- a far better `buildScore` input for docs/30 (riser/snare-roll detection is exactly
  high-band positive flux),
- a general-purpose `micFlux` live key patterns can use for "music is changing" effects,
- the onset-strength signal every library survey says is the core trigger primitive.

### 3.3 Flexibility: make signals declarative, kill the 4-step + iPad drift

Adding a live signal today touches: `KNOWN_SIGNALS`, CPC registry, `DEFAULT_CHAINS`, the
call site, **and** the hardcoded `liveKeys` Set in `useEngineState.ts:587` (whose own
comment admits drift risk). Consolidate into one declarative table (single JS module or
YAML): key → {label, broadcastHz, oscAddress?, rawMirror?, defaultChain}. Registry,
KNOWN_SIGNALS, raw mirrors and OSC bindings derive from it; CaptainPad seeds its live-key
set from `GET /param-center/schema` (`live: true` entries) instead of the hardcoded Set.
That makes docs/30's five new keys — and any future OSC-fed pro-analyzer key — a
one-entry change.

### 3.4 Easier setup: auto-level + calibration + file replay

- **AGC / auto-level chain op or analyzer stage.** `PRE_CLAMP_GAIN=8.0` and
  `noiseGate=0.04` are venue-dependent hand-tuned constants. A running-percentile
  normalizer (e.g. map p10→0, p95→1 over a sliding ~30 s window, operator-disableable)
  would make a new venue/mic work without soundcheck retuning. Biggest practical
  "easier" win for the playa.
- **Calibration helper:** `tools/audio_calibrate.js` — listen 10 s of room silence +
  10 s of music, print suggested noiseGate/gain. One-shot, no UI.
- **File-replay capture source.** ffmpeg can already read files; a
  `capture.device: file:<path>` (or `--audio_file`) mode that streams a WAV through the
  exact capture→analyzer path enables (a) docs/30 Phase 3 dataset evaluation, (b)
  deterministic end-to-end tests, (c) tuning chains at a desk without speakers. This is
  the single enabler Phase 3 is currently missing.
- **CaptainPad mic picker** using the already-spec'd `GET /audio/devices` (docs/25 §9
  "optional, future") so re-pointing a mic after `git pull` doesn't require SSH +
  `--choose_mic`.

### 3.5 Chain framework follow-ups (docs/29)

- **Cross-signal ops** (e.g. `source` op referencing another signal, ratio/max/sidechain)
  would let operators author derived signals like energyRatio themselves. Worth doing
  *after* docs/30 ships standalone — the detector should stay a dedicated module (the
  doc's "not the chain framework's first user" call is correct).
- **Normalizer op** (the AGC above) fits naturally as op #13 in the catalog.

---

## Priority order (recommendation)

1. **Ship docs/30 Phase 1 as spec'd** (with §2 corrections: raw-mirror inputs, float enum,
   trend trackers). It needs nothing new — the foundation is verified ready.
2. **Add `micFlux` to the analyzer** (3.2) — tiny, improves the detector + patterns.
3. **File-replay capture mode** (3.4) — unblocks Phase 3 dataset validation.
4. **Declarative signal table + schema-driven iPad seed** (3.3) — pays off on every
   subsequent signal.
5. **AGC/normalizer + calibration tool** (3.4) — playa-robustness.
6. **Vendor Meyda for extra descriptors** (3.1) — only when a concrete pattern/detector
   need for centroid/flatness/chroma materializes; don't add it speculatively.
7. **Pro MIR via OSC sidecar** — document as the official heavy-analysis extension point;
   no engine work required.

## Tests run

None — read-only investigation; no code changed, no servers booted, no tracked state
touched (`git status` clean apart from this report).

## Operator action requested

Review the feasibility verdict + the §2 corrections. If approved, docs/30 Phase 1 can be
filed as a Notion Backlog card and handed to `04.2_marsin_engine_expert`; the §3
suggestions can be filed as separate cards in the priority order above.
