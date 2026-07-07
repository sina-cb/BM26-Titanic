# Audio Analysis / DSP — Cold-Start Code Review

**Date:** 2026-06-18
**Branch:** `claude/audio-corpus-tuning-olcd6i` (HEAD `2c3f052`, 141 ahead of main)
**Reviewer:** DSP review agent (read-only; no source edits, no git mutations)
**Scope:** raw analysis, capture, derived signals — the DSP up to (not including) the
post-process op chain. Files under `marsin_engine/audio/{analyzer,detector,signals,capture,calibrate,config}`.

---

## VERDICT — MERGE-READY (audio/dsp): **YES, WITH-FIXES**

The DSP core is correct, well-reasoned, and defensively coded. Every targeted test passes
(169/169), there is no NaN/Inf leak on the synthetic corpus, the perf budget holds with
~25× margin, and the codex P0 "fail loud / no silent fallback" discipline is largely
honoured in the hot path. Nothing here is a merge blocker for the analysis/DSP slice.

The WITH-FIXES qualifier is for a cluster of **silent-degradation** issues in the capture
layer (sub-agent review) plus two **dead-config / stale-doc** issues in the analysis layer
that will mislead the operator and the next tuner. None change correct-input behaviour;
all matter on the playa where there is no second chance to notice a wrong mic or an ignored
config knob.

**Accuracy-claims note (important):** the validation tests are HONEST and do NOT overclaim.
`validation_metrics.json` is explicitly stamped *"Synthetic ground-truth validation. NOT
real-world EDM accuracy"* and the "real-world" precision/recall numbers are flagged
*"engineering priors, NOT measured here."* The test file only asserts affirmative drop
detection on the **stems-fed** path and discloses that **mic-only over-fires on risers**.
See "Tests / validation" below — coverage is real but narrower than a casual reader of the
JSON might assume.

---

## Checks performed

- Read every in-scope source file in full (analyzer, dom-freq tracker, structure detector,
  derived signals: bpm/note/party/switch; capture/devices/chooser/jitter/calibrate/config
  via sub-agent).
- `node --check` on all 8 analysis/signals files → all clean.
- Ran the unit + integration test sets below (synthetic / file-based only; no live-mic
  tests, per the running-engine constraint).
- Cross-checked `validation_metrics.json` against what the test actually asserts.
- Traced DSP math: FFT window/scale, Hz↔bin, band normalization, flux, kick adaptive
  threshold, dom-freq peak-pick/parabolic/cluster, structure thresholds/hysteresis,
  BPM lock/octave logic, note pitch-class hysteresis, divide-by-zero / NaN paths.

## Test results (all PASS, run from `marsin_engine/`)

| Test file | tests | result |
|---|---|---|
| `tests/audio_analyzer.test.js` + structure + note + bpm_speed + jitter (one run) | 67 | PASS |
| `tests/audio_config.test.js` + config_store + devices + calibrate | 67 | PASS |
| `tests/integration/{signal_metrics, mic_model, audio_analysis_validation}` | 35 | PASS |

Total **169 pass / 0 fail / 0 skip**. No live-mic test was run (engine holds the USB mic).
Integration suite ran in ~6.4 s; nothing hung.

---

## Findings (severity · file:line · fix)

### HIGH

**H1 — Stale/contradictory doc on the dom-freq smoother (will misdirect the next tuner).**
`audio/analyzer/audio_analyzer.js:74-75` comment: *"EMA smoothing beat the Kalman path …
so useKalman:false"* — but the actual param at `audio_analyzer.js:91` is **`useKalman: true`**
(with Kalman Q/R also set). The shipped code runs the Kalman path; the comment claims the
opposite was chosen. Either the comment is stale (most likely — the surrounding Kalman Q/R
tuning notes suggest Kalman is intentional) or the wrong flag shipped. Fix: reconcile —
correct the comment to match `useKalman: true`, or flip the flag if EMA was truly the
validated winner. As-is, a tuner reading the comment will "fix" the flag and silently change
the validated behaviour. (Not a runtime bug; a correctness-of-intent hazard.)

**H2 — `DerivedSignals` passes a dead BPM param block; v2 tracker silently ignores it.**
`audio/signals/derived_signals.js:28` defines a rich `PARAMS.bpm` (`octaveCorrFloor`,
`octaveVotes`, `octaveStickiness`, `lockConf`, `lockHoldHops`, `kfQ`, `kfRMin: 4`, …) but
`derived_signals.js:41` constructs `new BpmTracker()` **with no arguments**, so the v2
tracker uses its own frozen `DEFAULTS` (`bpm_tracker.js:55`) and the entire `PARAMS.bpm`
object is unreachable. Several of those keys (`octaveCorrFloor`, `lockConf`, `lockHoldHops`)
don't even exist in v2 — they're v1 leftovers. Net effect: the "corpus-tuned" BPM params in
`signals_params.json`/`PARAMS.bpm` are NOT what runs. This is a quiet config/behaviour
divergence (codex P0 spirit). Fix: either `new BpmTracker(PARAMS.bpm)` (after pruning the
keys v2 doesn't read and reconciling `windowS` 4 vs v2 default 6, `kfRMin` 4 vs 6, etc.), or
delete `PARAMS.bpm` and document that v2 owns its tuning. Right now it reads as tuned but is
inert.

**H3 — Jitter-buffer underruns are counted but never surfaced (capture layer).**
`audio/capture/jitter_buffer.js:78` + `audio_capture.js:494`: the buffer's own docs promise
the caller will warn on sustained underrun, but `engine.js` never reads `jitterStats()`.
When the source falls behind, hops are silently skipped and the analyzer sees a frozen/sparse
timeline with zero operator-visible signal — a silent-degradation path that hides a sick
audio source. Fix: fold `jitterStats().underruns` into the periodic `audioStatus` broadcast
and warn when it climbs.

**H4 — Windows label-only mic match can silently bind the wrong device (capture layer).**
`audio/capture/audio_devices.js:172-189` `findConfiguredDevice` third pass matches on
case-insensitive label only; on dshow the `id` is derived from the label, so two devices
sharing a label (common: "Microphone Array") return a confident match for the wrong
hardware. Mission-relevant (audio-reactive show). Fix: log the label-only match loudly
("matched by label not id — verify"), or gate it behind explicit opt-in. (The deviceId-match
path is correctly preferred and is unit-tested.)

**H5 — `audio_capture.stop()` ignores configured `stopTimeoutMs`; can also hang (capture layer).**
`audio/capture/audio_capture.js:357-361`: constructor stores `this._stopTimeoutMs`
(engine passes it from config) but `stop()` hardcodes the 2000 ms SIGKILL backstop, so the
config knob is dead. The SIGKILL timer is also never cleared and there is no final
resolve-fallback, so `await capture.stop()` (used in `audio_calibrate.js:291` and engine
shutdown) can hang forever if the child ignores both signals. Fix: use `this._stopTimeoutMs`,
`clearTimeout` on exit, and add a hard resolve fallback.

### MEDIUM

**M1 — Malformed audio config / scene YAML silently falls back to defaults (capture layer).**
`audio/config/audio_config.js:151-161` and `audio_config_store.js:55-65` catch a YAML parse
error, `console.warn`, and return `{}` — reverting the operator's saved tuning/mic to engine
defaults. Per codex P0 this is exactly the "silent fallback" pattern: a missing file → `{}`
is fine, but a *corrupt* file should fail loud (throw / propagate). Fix: distinguish
missing-file from parse-error; rethrow on parse-error.

**M2 — Config / mic-override save failures are swallowed; caller sees success (capture layer).**
`audio_config.js:163-176` / `audio_config_store.js:142-150`: a failed atomic write (disk
full, perms) is caught and only warned, then the function returns normally, so the PATCH
endpoint reports success while nothing persisted. A stray `.tmp` can also be left behind.
Fix: rethrow or return a status the API can 500 on; clean up the temp file on failure.

**M3 — `onFrame`/`onStatus` callback exceptions warn-and-continue at up to ~86/s (capture layer).**
`audio_capture.js:467-525`: a persistently broken downstream consumer is invisible beyond
log spam while capture keeps feeding a dead sink. Defensible for resilience but borderline
P0; at minimum rate-limit the warn and surface a failure count in status.

**M4 — `AudioAnalyzer.onAnalysis` exception is swallowed (`console.warn` only).**
`audio/analyzer/audio_analyzer.js:628-630`: if the engine's `onAnalysis` callback throws,
the analyzer logs once per hop and continues — the same warn-and-continue pattern as M3, in
the analysis layer. Acceptable as a hot-path guard, but a sustained throw means every
downstream signal is frozen with only log noise to show for it. Consider a failure counter
in `audioStatus` so a stuck callback is observable.

**M5 — Device-list timeout resolves silently with partial output (capture layer).**
`audio_devices.js:143-147`: a hung ffmpeg is SIGTERM'd and the promise *resolves* (not
rejects) with whatever arrived, so "timed out" is indistinguishable from "no mics." Fix:
flag `timedOut: true` in the result so the chooser can say so.

### LOW / NIT

- **L1** `note_estimator.js:30` (`PARAMS.note`) duplicates `NOTE_ESTIMATOR_DEFAULTS`; here it
  IS wired (`new NoteEstimator(PARAMS.note)`), unlike the BPM case (H2) — but the two default
  sets can drift. Consider a single source of truth.
- **L2** `audio_capture.js:357` SIGKILL backstop swallows `child.kill` errors with empty
  `catch {}`; `audio_config_store.js:74/133/144` and `audio_devices.js:144` have several empty
  `catch {}` on `mkdir`/`unlink`/`kill`. Mostly idempotent; the `unlinkSync` swallow in
  `clearSavedMic` reports `{cleared:true}` even when the file persists.
- **L3** `jitter_buffer.js:31` `opts.hopSamples | 0` silently floors a non-integer hop rather
  than rejecting it (other config paths validate with `Number.isInteger`). Minor consistency.
- **L4** `bpm_tracker._advancePhase` (`bpm_tracker.js:486`) early-returns `this.beat = 0` when
  `bpm<=0` but leaves `beatInBar`/`barPhase`/`downbeat` at stale values from the last locked
  hop. Harmless during warmup (they start 0) but on an unlock→re-lock these can briefly read
  stale. Consider zeroing them on the no-tempo branch.

---

## DSP correctness — what I verified is RIGHT (no action)

- **FFT setup:** Hann window pre-baked (`audio_analyzer.js:113`), `fftSize` validated
  power-of-two, real transform, energy taken from positive-freq bins only. Sum-of-magnitudes
  `/ fftSize` normalization is window-length-independent and the rationale (band meter, not
  per-bin RMS) is sound.
- **Hz↔bin:** `hzToBin` rounds `hz·fftSize/sampleRate`; band edges chained low→mid→high with
  high capped at `fftSize/2`; kick band validated `0 < min < max ≤ nyquist`. No off-by-one
  in band sums (`for k in [start,end)`). Dom tracker neighbour access (`mag[k±1]`, cluster
  walk) is bounded by `_minBin≥1` and `_maxBin≤numBins-2`.
- **Frame-rate independence:** band attack/release and all detector/derived envelopes use
  `1 - exp(-Δt/τ)` (or `dt/τ`) forms, not fixed per-hop alphas — correct.
- **Silence / divide-by-zero:** `clamp01` rejects non-positive/NaN; energy ratios use
  `Math.max(x, EPS)`; flux first hop is 0; kick is a ratio with `_kickEma>0` guard; parabolic
  interpolation guards zero denominators; `_foldOctave` guards `bpm<=0`. No div0 found.
- **Kick detector:** asymmetric slow-attack/fast-release adaptive threshold + slow-trailing
  ceiling clamp + 50-hop warmup seed is a textbook adaptive-onset design and correctly
  computed on LINEAR (un-compressed) energy so softCompress saturation can't collapse the
  ratio. Gain-on-PCM cancels in the ratio — verified.
- **Gain double-count check (negative):** input gain is applied to PCM pre-FFT; the dom
  tracker is constructed WITHOUT `inputGain` (defaults to 1), so dom energy is gained exactly
  once via `prevMag`. No double gain.
- **Dom-freq tracker:** parabolic vertex on log-magnitude, constant-Q association gate
  (`clamp(freq·6%, 12, 90)`) to fight bass octave-smear, energy-weighted centroid as the
  reported freq, cluster window for energy, scalar random-walk Kalman per dimension, slow
  rank-EMA for stable dom1/dom2 ordering, and a dom2-inside-dom1-window separation retarget.
  Freq/energy are tracked independently. All coherent.
- **Structure detector:** stems-freshness is a hard prerequisite stamped on the hop clock
  (not wall clock) — good; non-finite inputs warn-once and treat-as-0 for the hop rather than
  poisoning state; the windowed drop edge is a true rate-of-change (kills in-body re-fires);
  THIN guard against the flat-buildScore flap is correct; refractory + N-in-M self-quiet are
  sound; `_shortEnvHist` is bounded (windowed mode) and unused (kalman mode) — no leak;
  fatal-latch on a paramCenter write failure (no silent retry) matches P0.
- **BPM v2:** 2-state SEARCH/LOCK with octave-folded histogram voting, metric-relative
  (×2/÷2/×3/2…) reads excluded from unlock, stiff vs loose Kalman regimes, PLL phase applied
  AFTER edge detection so it can't fabricate/suppress a beat — the tempo-doubling/halving
  story is handled deliberately. Honestly documents the downbeat "1" as a kick-energy guess.
- **Note estimator:** circular-safe pitch-class MODE (not numeric median — correctly avoids
  the B↔C wrap bug), continuous-MIDI Kalman for glide, HOLD_HOPS hysteresis before committing
  a pc change, energy-gate freezes (not resets) colour, non-finite input throws loud.
  `DerivedSignals` then HOLDS the last committed note so silence never blinks to C — there's
  an explicit regression test for the "NOTE always C" bug.
- **Imports:** all at top of file in every reviewed module; none inside functions; none
  wrapped in try/catch. Compliant.

## Tests / validation — is the coverage real, and do they back the accuracy claims?

**Real, and honest.** The integration suite asserts: WAV codec round-trips losslessly,
non-WAV rejected loudly, clean_drop fires exactly one drop and reaches SUSTAIN (stems-fed,
tuned), double_drop fires both and respects the 2 s refractory (asserted on BOTH tuned and
product-default config), steady_loud and silence fire ZERO drops in BOTH mic-only and
stems-fed on the product-default config, NO NaN/Inf across the whole dataset × both modes,
tick p99 ≤ 0.5 ms/hop, and run-to-run determinism. These are genuine assertions, not smoke.

**But the scope is narrower than the JSON snapshot suggests, and the code is upfront about
it:**
- `validation_metrics.json` header: *"Synthetic ground-truth validation. NOT real-world EDM
  accuracy."* The `realWorldEngineeringPriors` (precision 0.65-0.75, recall 0.55-0.7) are
  explicitly *"engineering priors, NOT measured here; unmet target for a real Phase-3
  corpus."* So the JSON does **not** claim those numbers are achieved.
- The snapshot's own `default`/`mic-only` rows show drop **precision 0-0.333** (many false
  positives) — and the test file's CONFIG NOTE states plainly that mic-only over-fires on
  risers and that the affirmative single-/double-fire assertions therefore run on the
  stems-fed path only. The mic-only limitation is reported, not asserted-as-passing.
- The metrics JSON is a generated artifact (`generatedAt` 2026-06-13) and is **not** consumed
  by the test as an assertion oracle — the test recomputes drops live and asserts fixed
  ground truth. So the JSON can go stale without breaking CI; treat it as a report, not a
  guarantee.

**Bottom line on accuracy:** the tests genuinely back the claims they make (drop
exact-fire/refractory/negative-controls on stems-fed, plus universal NaN/perf/determinism
invariants both modes). They do NOT — and do not claim to — establish real-world EDM
precision/recall, and mic-only drop precision is openly acknowledged as weak. That honesty is
correct per codex P0; just don't read the JSON's `realWorldEngineeringPriors` as measured
results.

---

## Recommended pre-merge actions (priority order)

1. **H1** reconcile the `useKalman` comment vs the shipped `true` (one line; prevents a
   future tuner silently reverting validated behaviour).
2. **H2** wire or delete `PARAMS.bpm` so the running BPM tuning matches what's documented.
3. **H3/H5** surface jitter underruns in status; honour `stopTimeoutMs` + add a stop()
   resolve-fallback (real-time safety on the playa).
4. **H4** loud-log the label-only mic match.
5. **M1/M2** fail loud on corrupt config and on save failures.

All other items are LOW/NIT and can ride a follow-up.
