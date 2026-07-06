# 2026-06-20 — Adversarial re-wave 2: consolidated findings (Wave E plan)

5 read-only auditors hit the merged `feat/audio_analysis_2` (post Wave D). The
headline: **the synthetic test suite is structurally blind to real-audio failures**
— several Wave-D signals that merged with synthetic proof are broken on real music.
The 60-track CC corpus (`~/tmp/genre_corpus`) is the validation surface that exposed
them. Fixes are organized into Wave E slices below.

## P0 — real-audio breakage (Adv-B, tested on 60 min of real corpus)
- **P0-1 detector false-fires 1.48/min on real music** (`audio_structure_detector.js`
  build-memory THIN-firing edge, report-17's recall fix). 89 drops / 60 min, 37/60
  tracks. D4's "recall 1.00 / 0 false-fires" was a SYNTHETIC artifact — real music
  sits at sustained-high `buildScore` so both THIN-edge gates stay open. → **Wave E1.**
- **P0-2 `dropFired.buildDurationMs = Infinity`** broadcast to WS consumers when the
  THIN edge fires without BUILD latching (`_buildStartedAtMs = -Infinity`). One-line
  clamp. → **Wave E1.**
- **P0-3 `audioClimax` saturates** (≥0.5 for 48% of hops, peaks on 77% of tracks) →
  pattern 65 always full-white, no contrast, burns brightness headroom. Re-baseline
  against a long (30–60s) history, not a 4s-tau ceiling. → **Wave E2.**

## P1 — signals & detector (Adv-B)
- **P1-4 `audioDropCountdown` fires on steady tracks** (338× / 35 tracks) — arm gate
  trips on momentary riser. Require monotonic climb. → E2.
- **P1-5 `audioBuildEta` emits fiction 69% of hops** — only publish when riserConf high
  AND detector corroborates. → E2.
- **P1-7 `audioTrackChange` spurious mid-track** (harmonic-cut cue c). Tighten/drop cue c. → E2.
- **P1-6 drop latency 232ms** (regressed from 180/196; high for a *cue*). Investigate. → E1.
- **P1-8 phrase grid corrupted by phantom drops** (anchors on `audioDropPulse`). Fixed
  transitively once P0-1 lands; gate re-anchor on high-confidence drops. → E1/E2.
- **Structural: wire the real corpus into `detection_eval` as a NEGATIVE set**, gate on
  real-audio `falseFiresPerMin ≤ 0.1`. The single highest-leverage fix. → E1.

## P1 — perf/tests/robustness (Adv-C DSP/perf + Adv-E robustness, AGREE)
- **Perf test is flaky AND wrong**: asserts an arbitrary 0.5ms ceiling (real deadline is
  11.6ms/hop — ~30× headroom) and measures only `DerivedSignals.tick` (1 of 3 stages).
  Flake = OS-scheduler artifact (p50 rock-stable, only p99 tail moves under load). Fix:
  full-chain, real-deadline budget, assert p50 + soft/ env-gated p99. → **Wave E3.**
- **Per-hop allocation** (~5,340 obj/s: the 3 `setMany` payloads) violates codex
  allocation-free. Hoist payload arrays to reusable instance fields. → E3.
- **`DerivedSignals.tick` swallows ALL exceptions** → permanently disables the whole
  derived chain for the session (fail-quiet, codex P0). Scope per-signal + fail loud. → E3.
- **`genre_eval_harness.test.mjs` tests fftSize 1024**, not deployed 2048 (XS). → E3.
- NOTE (Adv-C): **the audio chain runs on the laptop, not the Pi** (Pi only runs the LoRa
  bridge) — perf is a non-issue; these are correctness/hygiene, not throughput.
- P2 (file): `Math.hypot`→`sqrt` in flux loop (2.8×), wall-clock `dt` distortion under
  jitter-buffer drain (real sleeper risk), sub-window label imprecise (bins 1–2 ≈ 10–55Hz).

## P1/P2 — patterns/companion/CaptainPad (Adv-D)
- **P1 patterns 59/64/65/66 near-black in silence** (~10/255) on the real 970px rig vs
  "never dark / visibility mission-critical". Lift silence floor. → **Wave E4.**
- **P1 no committed harness drives the derived signals 64–68 react to** → reactivity
  unproven in-tree. Promote a derived-signal harness to `tools/`. → E4.
- **P1 `/osc_accounting` lists only the 9 OSC-sent signals**; the rich derived signals
  are engine-internal. Add an "engine-internal derived" label. → E4.
- P2: CaptainPad renders pulse keys as dull bars (should flash); pattern #55/#56 gap. → deferred polish.

## Confirmed SOLID (attacked, held)
Companion 5-theme var completeness; manifest integrity (68 entries); CaptainPad dynamic
key surfacing; genre 7-name lockstep across engine↔companion↔CaptainPad; bin math at 2048
(no aliasing, no retune needed); submodule buffers preallocated; offline-readiness (no CDN
in shipped paths, genre_eval throws on missing corpus); state cleanup; mic-failure backoff.

## Wave E slices (disjoint file ownership)
- **E1 detector real-audio re-tune** — corpus-as-negative in `detection_eval`, fix P0-1
  THIN-edge false-fires to real ff/min ≤ 0.1 (keep synthetic recall), P0-2 Infinity clamp,
  P1-6 latency, P1-8 drop-reanchor gate. Owns `audio/detector/*`, detection_eval, scenarios, audio_config.
- **E2 structure-signal real-audio fix** — P0-3 climax long-baseline, P1-4 countdown
  monotonic-climb, P1-5 eta gating, P1-7 track-change cue-c. Owns `audio/signals/climax.js,
  drop_countdown.js, build_anticipation.js, track_change.js` (minimize derived_signals.js edits).
- **E3 perf/robustness** — full-chain real-deadline perf test (p50+soft p99), hoist
  allocations, DerivedSignals per-signal fail-loud, genre harness fft2048. Owns perf/genre
  tests, `audio_analyzer.js`, `derived_signals.js`, `engine.js`.
- **E4 visibility/observability** — pattern silence-floor lift, derived-signal harness →
  `tools/`, `/osc_accounting` engine-internal label, #55/#56 doc. Owns `patterns/*`,
  `tools/`, `audio/companion/*`.
- (Adv-A genre/BPM pending → may add E5.)

VERIFICATION BAR for Wave E: every fix must be proven on the REAL corpus where the bug
was real-audio (not just synthetic) — the lesson from this wave.

## P1 — genre/BPM (Adv-A, live-harness validated)
- **P1-A genre = melodic_house for ~11s (max 42s) at every section start** — cold-start
  attractor: first commit happens before the kick-reg ring / band EMAs are warm, argmax
  of instantaneous similarity = melodic_house (lowest kickReg target), then pinned by
  minDwell. Invisible to the tail-vote eval but it's the LIVE `audioGenre`. Fix: gate the
  FIRST commit on `kickFilled >= kickRingN` (+extend warmupMs ~8000). `genre_classifier.js`. → **Wave E2.**
- **P1-B genre confidence meaningless** (mean conf wrong 0.229 > correct 0.176). Document
  as "decision margin, not accuracy" (or 1-line comment). `genre_classifier.js`. → E2.
- **P1-C 63.9% IS the ceiling** — independently reproduced every search (coord-descent,
  zero-weight re-intro, re-anchor: all ≤23/36; the only 24/36 is overfit, moves an anchor
  0.15 off its measured centroid to fish 1 track). DO NOT ship >63.9%. techno/downtempo
  (33%) need a harmonic/timbre feature that doesn't exist. → document, NO code change.
- **P1-D BPM octave fix validated**: ZERO EDM regressions (118–174), FIXED a 150 halving,
  fold-boundary 95→80 clean. Remaining 170/half-time halvings are PRE-EXISTING. Optional
  follow-up only if fast-EDM sets matter. `bpm_tracker.js`. → defer/optional.

## Wave E final slices (4 agents, disjoint)
- **E1** detector real-audio re-tune (P0-1/P0-2/P1-6/P1-8) — `audio/detector/*` + detection_eval + scenarios + audio_config.
- **E2** signals real-audio fixes (P0-3 climax, P1-4 countdown, P1-5 eta, P1-7 track-change, P1-A genre cold-start, P1-B genre conf) — `audio/signals/` MODULES (climax/drop_countdown/build_anticipation/track_change/genre_classifier; minimize derived_signals.js edits).
- **E3** perf/robustness (full-chain real-deadline perf test, hoist allocations, DerivedSignals per-signal fail-loud, genre harness fft2048) — tests + `audio_analyzer.js` + `derived_signals.js` + `engine.js`.
- **E4** visibility/observability (pattern silence-floor lift, derived-signal harness→tools, /osc_accounting engine-internal label, #55/#56 doc) — `patterns/*` + `tools/` + `audio/companion/*`.
