# 2026-06-20 — Audio SAFE-quality pass (detector scoring honesty · dom2 retarget smoothing · doc fixes)

**Author:** developer sub-agent (worktree `audio_safe_quality`, branch
`dev/audio_safe_quality` off `feat/audio_analysis_2`).
**Scope:** the three SAFE quality items from the adversarial backlog
(`20260620_9` P3 cleanups + auditor-2's detector-scoring-honesty P1). The
riskier FFT-2048 / fixed-dt / genre-v2 backlog was explicitly OUT OF SCOPE and
NOT touched — `fftSize`, `engine.js` dt, and the genre profiles / `confSpread`
are unchanged.

All three items LANDED. No detector logic, thresholds, or signal math changed —
item 1 is metrics-only/additive, item 2 is a guarded low-pass on a retarget hop,
item 3 is comments only.

---

## Item 1 — Detector scoring HONESTY (auditor-2 P1) ✅

**Problem.** `tools/detection_eval.mjs` excluded phantom drops on NEGATIVE clips
(`negFp`) from `precision`/`f1`, so a tuning could read "precision 1.00" while
still false-firing on calm/steady audio — observability that lies (codex P0).

**Fix (ADDITIVE — existing fields untouched).**
- `tools/detection_eval.mjs`:
  - Accumulate the duration of non-drop audio (`negDurationMs`, summed from each
    negative clip's `rec.durationMs` across all tiers) so the per-minute metric
    has a real denominator.
  - Added two first-class drop metrics to the eval result + JSON + human summary:
    - `guardedPrecision = tp / (tp + fp + negFp)` — every spurious drop (positive
      OR negative clip) counts against precision.
    - `falseFiresPerMin = negFp / (negDurationMs/60000)` — the headline
      dance-floor-safety number, normalized so it is comparable across
      scenario-set sizes.
  - The human summary now prints a `HONEST` line under the existing `DROP` line;
    the original `precision/recall/f1/negFp` numbers are byte-for-byte unchanged.
- `tools/detection_sweep.mjs`: the composite ranking now penalises on the HONEST
  `falseFiresPerMin` (×0.10) instead of the raw `negFp` count, and the ranked
  table surfaces `gP` (guardedPrecision) + `ff/min`.
- `tests/detector_eval.test.mjs`: +2 tests — (a) with the shipped (0-false-fire)
  config, `guardedPrecision == precision` and `falseFiresPerMin == 0`; (b) the
  `level`-edge baseline (KNOWN phantom drops) yields `falseFiresPerMin > 0` and
  `guardedPrecision < precision`, plus exact-formula assertions. This is the
  "inject a known phantom drop → falseFiresPerMin > 0" guard.

**No detector logic / threshold changed.** Confirmed the shipped `default`
config still scores **P=1.00 R=0.56 F1=0.71 negFP=0** (identical to the locked-in
tuning numbers) — the honest metrics are purely additive.

## Item 2 — dom2 retarget smoothing (auditor-1 P3) ✅ (done, clearly safe)

**Problem.** In `audio/analyzer/dominant_freq_tracker.js` `_emit()` (~line 399),
when dom2's centroid collapses inside dom1's cluster window the code retargeted
dom2 to a RAW (un-smoothed) peak, snapping the emitted `micDomFreq2` to that raw
value → a discontinuous jump on the retarget hop.

**Fix.** Low-pass the substituted freq toward the PREVIOUS emitted dom2 freq.
- New `retargetBlend` option (default **0.5**; `1` = old raw behaviour).
- New `_prevD2Freq` state, captured each hop at the top of `_emit()` BEFORE the
  output array is overwritten, reset in `reset()`.
- On retarget: `d2.freqHz = blend*rawPeak + (1-blend)*prevD2Freq`, but ONLY when
  `prevD2Freq` is a plausible continuation (falls inside the new peak's cluster
  window). A jump to a genuinely DISTANT partial is NOT dragged toward a stale
  value — it takes the raw peak (guarded). Energy/window are taken raw (a
  retarget is a different partial; its loudness should not inherit the old
  track's). Only `freqHz` is smoothed.

**Safety.** This feeds `note_estimator` → ran `note_estimator_synthetic` +
`genre_classifier` + `audio_analyzer` tests: **55/55 pass, no regression.**
End-to-end synth dynamics make the retarget branch hard to trigger
deterministically, so the proof is a focused unit test that drives the exact
collapse condition (`tests/dominant_freq_tracker_retarget.test.js`, 5 tests):
blend=1 == raw, blend=0.5 == halfway + strictly smaller step, distant retarget
== raw (guard), prevD2=0 == raw, default == 0.5.

## Item 3 — doc-only cleanups (no behavior change) ✅

- `audio/analyzer/audio_analyzer.js` (~L73): the comment claimed "EMA smoothing
  beat the Kalman path … useKalman:false", but `DOM_FREQ_PARAMS` ships
  `useKalman:true`. Reconciled the prose to describe the shipped Kalman smoother.
- `audio/signals/genre_classifier.js` (header): removed the stale claim that the
  classifier uses "the structure detector's build/energy scores" — `update(s)`
  takes no such params (it uses BPM, kick density/regularity, band balance +
  variance, flux, note-change rate).

---

## Verification proof (ready to paste into `_verification.md`)

### audio-safe-quality — detector scoring honesty + dom2 retarget + doc fixes  [PASS]  2026-06-20

- **Branch / commit:** `dev/audio_safe_quality` (off `feat/audio_analysis_2`).
- **Files changed:** `marsin_engine/tools/detection_eval.mjs`,
  `marsin_engine/tools/detection_sweep.mjs`,
  `marsin_engine/tests/detector_eval.test.mjs`,
  `marsin_engine/audio/analyzer/dominant_freq_tracker.js`,
  `marsin_engine/audio/analyzer/audio_analyzer.js`,
  `marsin_engine/audio/signals/genre_classifier.js`, + new
  `marsin_engine/tests/dominant_freq_tracker_retarget.test.js`.

- **Mandated suite:**
  `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/note_estimator_synthetic.test.js tests/detector_eval.test.mjs tests/integration/detection_metrics.test.mjs tests/dominant_freq_tracker_retarget.test.js`
  → **# tests 194 · # pass 194 · # fail 0**.
- **Item-2 regression set** (note/genre/analyzer):
  `node --test tests/note_estimator_synthetic.test.js tests/genre_classifier.test.js tests/audio_analyzer.test.js`
  → **55 pass / 0 fail** (no note/genre regression from the retarget change).

- **Item 1 — honest metrics computed + existing numbers UNCHANGED:**
  - `node tools/detection_eval.mjs --config default --tiers clean,moderate,heavy`:
    ```
    DROP   P=1.00 R=0.56 F1=0.71 lat=196ms  (tp/fp/fn=5/0/4)  negFP=0
    HONEST guardedP=1.00 falseFiresPerMin=0.00 (negFP=0 over 3.60 min calm audio)
    ```
    (P/R/F1/negFP identical to the locked-in tuning → additive-only confirmed.)
  - `level`-edge baseline (demonstrates the metric catches false-fires):
    ```
    DROP   P=0.78 R=0.78 F1=0.78 lat=655ms  (tp/fp/fn=7/2/2)  negFP=3
    HONEST guardedP=0.58 falseFiresPerMin=0.83 (negFP=3 over 3.60 min calm audio)
    ```
    Positive-only P=0.78 hides the 3 phantom drops; guardedP=0.58 / ff/min=0.83
    expose them.
  - JSON carries the new fields:
    `{precision:1, recall:0.556, f1:0.714, negFp:0, guardedPrecision:1, falseFiresPerMin:0, negDurationMs:215945.6}`.
  - Sweep ranks on the honest metric + surfaces gP/ff/min (top 3, winner
    unchanged = shipped DETECTOR_DEFAULTS):
    ```
    score  F1    P     gP    R     lat   ff/min negFP  edge      minLvl jump  win
    0.68  0.71  1.00  1.00  0.56   196   0.00     0   windowed  0.06   1.8   400
    0.67  0.71  1.00  1.00  0.56   240   0.00     0   windowed  0.08   1.8   400
    0.66  0.71  1.00  0.83  0.56   154   0.28     1   windowed  0.03   1.8   400
    ```
    (3rd-place config false-fires once → demoted to gP=0.83 / ff/min=0.28.)

- **Item 2 — retarget blend proof:** `tests/dominant_freq_tracker_retarget.test.js`
  drives the exact `_emit` retarget branch: blend=1 emits raw 900; blend=0.5
  emits 890 (= halfway between raw 900 and prevD2 880) with a strictly smaller
  step than the raw snap; a DISTANT prevD2 (250) is NOT dragged toward 900 (raw
  taken); prevD2=0 → raw; default retargetBlend == 0.5. → **5 pass / 0 fail.**

- **Engine boot:**
  `node engine.js --pattern test_const --model test_bench --port 31568 --dry-run`
  → **exit 0**, "Pattern loads and compiles OK", 52/52 pixels patched.
- **Syntax:** `node --check` on all 6 touched JS/MJS files → OK.
- **Hygiene:** `git diff --check -- marsin_engine` → CLEAN; no
  `marsin_engine/states/*` residue; no servers left running (dry-run + offline
  harnesses only — no live engine bound). Scratch traces in `~/tmp/` (gitignored).

- **Process / what was ruled out:** detector thresholds/logic untouched (item 1
  additive metrics only — verified by identical default F1/P/negFP); retarget
  smoothing guarded so distant partials aren't smeared (verified by the
  distant-retarget test) and note/genre unaffected (55/55); doc edits are
  comments only (no executable change).
