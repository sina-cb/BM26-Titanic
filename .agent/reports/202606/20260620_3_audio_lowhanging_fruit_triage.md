# 2026-06-20 — Audio low-hanging-fruit + latent-bug triage

**Author:** investigator/reviewer sub-agent (slot 3, read-only) of the Audio Round 2 fleet.
**Parent branch:** `feat/audio_analysis_2`. **Verification:** ran
`node --test tests/audio_structure_detector.test.js tests/integration/audio_analysis_validation.test.mjs`
→ **46/46 pass**. No repo files modified by the investigator.

**Headline:** both P0/P1 defects from `20260616_3` (drop-detector under-fire +
burst-clocked capture) are now **FIXED** in the current tree. Remaining items below
are new/lingering and mostly cheap.

## Known-defect triage (vs `20260616_3` + audio reports)
| Defect | Status | Evidence |
|---|---|---|
| A. Drop detector under-fires (`KALMAN_Q` mistune) | **FIXED** | `dropKalmanQ:0.001` + `dropCoWindowMs:60` co-occurrence window + RISING test (`audio_structure_detector.js:65-66,345-349`); default mode now `'windowed'` (`:63`); the 3 red integration tests are green. |
| B. Burst-clocked analysis / `dt` corruption | **FIXED (mostly)** | `JitterBuffer` (`capture/jitter_buffer.js`) wired via `jitterBufferHops:4` (`config.yaml:45`, `engine.js:1495`); ffmpeg low-latency flags present (`audio_capture.js:197-208`). Residual: see P2 #4. |
| Stale `useKalman` comment vs value | **STILL INCONSISTENT** | `audio_analyzer.js:73-78` prose says EMA won (`useKalman:false`) but `DOM_FREQ_PARAMS` ships `useKalman:true` (`:91`). See P3 #5. |
| Validators for `audio.dom.*` / `drop.*` | **PARTLY** | `drop.*` validators exist (`audio_config.js:104-109`); `audio.dom.*` still frozen const, no live tuning (low priority). |
| dom retarget assigns raw (un-Kalman'd) peak | **STILL OPEN** | `dominant_freq_tracker.js:399`. See P3 #7. |
| `_kalmanNis(dt)` ignores `dt` | **STILL OPEN (latent)** | `audio_structure_detector.js:544,559`. See P3 #8. |
| Analyzer FFT 1024→2048 bump (`20260616_1` §8) | **STILL OPEN** | `config.yaml:48 fftSize:1024`. See P2 #3. |

## ⭐ LAND THESE NOW (high value / low risk)

### 1. `switch_signals` startup guard never fires — P1, bug — (audio/signals/*, sibling-coordinate)
`audio/signals/switch_signals.js:133` `pastStartup = now >= p.startupGuardMs`. But `now`
is the **absolute epoch clock** (`engine.js:1440` `nowMs = Date.now()` ~1.75e12,
forwarded via `derived_signals.js:90`), so `now >= 2000` is **always true** — the
"suppress swaps in the first 2 s" guard is dead. With `_lastPatternMs = -Infinity`
(`:73`), the **opening transient CAN burn a pattern swap** — the exact failure the guard
was meant to prevent. **Fix:** stamp `_firstTickMs` on first `update()`, gate on
`(now - this._firstTickMs) >= p.startupGuardMs`. Add a unit test (loud onset in first 2 s
→ no `switchPattern`).

### 2. `DerivedSignals` ignores its own tuned BPM params — P1/P2, bug — (audio/signals/*, sibling-coordinate)
`derived_signals.js:41` `new BpmTracker()` — `PARAMS.bpm` (`:28`, a full corpus-tuned
block) is **constructed but never passed**, so `bpm_tracker.js DEFAULTS` run instead
(`windowS 6.0` vs `4`, `kfRMin 6` vs `4`, `combHarmonics 4` vs `3`, `priorStrength 0.18`
vs `0.15`…). Worse, several `PARAMS.bpm` keys (`octaveCorrFloor`, `octaveVotes`,
`lockConf`, `lockHoldHops`) don't exist in v2 — stale v1 params that lie about what runs.
**Fix:** either `new BpmTracker(PARAMS.bpm)` (after reconciling stale keys) OR delete
`PARAMS.bpm` and document v2 defaults as authoritative. Decide which set is corpus-validated
before wiring; re-validate BPM on the corpus if you switch.

### 3. Bump analyzer FFT 1024 → 2048 — P2, tuning (independent) — DEFERRED, see note
`config.yaml:48`. Per `20260616_1` §8: "single change that improves BPM octave on fast EDM
+ dom-freq/key accuracy on sub-bass." 1024 → ~43 Hz/bin, too coarse for bass roots. Keep
`hopSize:512` (hop rate unchanged ⇒ all `hopsPerSec`-tuned constants stay valid). **Caveat:**
changes `binHz` ⇒ `DominantFreqTracker._minBin/_maxBin` + cluster windows shift; re-run
`audio_analysis_validation.test.mjs`. **Instigator note:** deferred this run — bumping FFT
mid-flight would invalidate the genre classifier's tuning (tuned at 1024). Land as a
dedicated follow-up that re-tunes genre + dom + note together.

## P2 — worth doing, slightly more care
### 4. Engine still derives `dt` from wall-clock — P2, robustness (engine.js)
`engine.js:1441` `dt = (nowMs - lastAnalysisAtMs)/1000`. The JitterBuffer releases hops on
a steady cadence, but when it releases 2 hops in one timer tick (`audio_capture.js:483`
loops), both `onFrame` calls land in the same event-loop tick ⇒ 2nd hop `dt≈0`, 1st
`dt≈2×nominal` — defect B's corruption, now rarer. Detector guards `dt>0` but BPM PLL /
dance spring / IIRs still see uneven `dt`. **Fix:** feed a fixed
`dt = hopSize/sampleRate` to post-proc + detector + derived signals when the JB is on.
Verify with `tests/hil/hil_audio_realtime_test.mjs`. **Instigator note:** deferred — needs
live HIL validation; changing dt semantics touches every signal incl. genre. Follow-up.

## P3 — cheap latent-bug / quality
- **5. Stale dom `useKalman` comment** (`audio_analyzer.js:73-78` vs `:91`) — reconcile the
  prose to match `useKalman:true`. Code-only, safe independently.
- **6. `audioBpm` doc range** (`derived_signals.js:9` says `[0,300]`; tracker clamps
  `[70,180]`) — fix docstring to `[0,180]`. Trivial.
- **7. dom2 retarget jump** (`dominant_freq_tracker.js:399`) — retarget overwrites
  `d2.freqHz/energy` with a raw peak, not a smoothed track ⇒ discontinuous `micDomFreq2`
  on the retarget hop. Retarget to nearest *track* or LPF toward previous value.
- **8. `_kalmanNis` ignores `dt`** (`audio_structure_detector.js:544,559`) — `Pp = kf.P+Q`
  should grow `Q·dt`; latent under variable rate. Trivial; flag-and-leave acceptable at
  fixed 86 Hz.

## Test gaps (small tests that lock behavior)
- No dedicated tests for `bpm_tracker.js`, `party_mode.js`, `switch_signals.js`,
  `derived_signals.js`, `dominant_freq_tracker.js`.
- Highest value: `switch_signals` startup-guard test (catches #1); `party_mode` hysteresis/
  hold (silence→loud→1-bar-gap→loud stays `party:true`); `derived_signals` asserting the
  BpmTracker is constructed with intended params (catches #2). All pure `node --test`.

## Ranking
1. #1 switch startup guard (P1, small) · 2. #2 BpmTracker params (P1, trivial-align)
· 3. #3 FFT bump (P2, deferred) · 4. #4 fixed-dt (P2, deferred) · 5. #5/#6 docs (P3, safe)
· 6. #7/#8 latent (P3) · 7. test gaps.

**Sibling-overlap:** #1, #2, #6 touch `audio/signals/*` (slot-0 owned) — applied by the
instigator post-merge. #3 (config), #4 (engine.js), #5 (analyzer), #7 (dom tracker),
#8 (detector) are outside the sibling-owned trees.
