# Slot 2 — detector_tuning

- **Branch:** dev/detector_tuning
- **Parent branch:** feat/audio_analysis_2
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/detector_tuning
- **Slot ports:** engine 31268, OSC 31200 (dry-run only; no servers left running)

## Scope

Operator priority #14: "Drop detection, slow zone, build-up all need SUPER
tuning and validation" + "scoring of detections". Built a real detection
SCORING / EVAL harness with precision/recall/F1 + latency for drops and
accuracy metrics for build + slow-zone, then super-tuned the
`AudioStructureDetector` drop edge, slow-zone, and validated the build score
against known ground truth — every change backed by numbers from the harness.

## What was built

**1. Scoring/eval harness (the headline deliverable, reusable):**
- `tests/integration/detector_scenarios.mjs` — richer LABELED synthetic arcs
  (intro→build→drop→sustain→breakdown→build2→drop2, single-drop-long, ambient,
  techno-steady, false-build, sustain→slow) with ground-truth drop times,
  region labels, true slow zones, and build ramps. Deterministic (seeded);
  drives the REAL analyzer like `synth_dataset.mjs` but does NOT perturb the
  frozen regression set.
- `tools/detection_eval.mjs` — scores DROP (P/R/F1 + signed latency + spurious
  drops on no-drop clips), BUILD (Pearson corr of `audioBuildScore` vs the true
  ramp + buildScore-peak timing error), SLOW (mean `audioSlowZone` in true-slow
  vs non-slow regions, margin, threshold accuracy), over all scenarios × 3 mic
  tiers via `mic_model.mjs`. Outputs a machine-readable JSON + a per-scenario
  HTML/SVG overlay (detector traces vs labels).
- `tools/detection_sweep.mjs` — grid-sweeps the drop knobs, ranked by
  F1 − negFP·penalty − latency.
- Scoring math added to `tests/integration/run_analysis.mjs`
  (`f1Score`, `pearson`, `buildCorrelation`, `slowZoneSeparation`) + a
  per-hop `detectorSeries` capture (buildScore/slowZone/energyRatio/etc.).

**2. Drop super-tune** (`audio/detector/audio_structure_detector.js`):
- Root cause of poor recall/precision found via the harness: a near-silent
  BUILD posts a huge short-env RATIO off the noise floor (e.g. 0.004/0.002=2×)
  that the windowed/level edge read as a drop — firing prematurely DURING the
  build, then sitting in SUSTAIN and MISSING the real drop. Through the playa
  mic the build sub is ~0.00–0.02 while a real drop slams micLow to 0.10–0.65.
- Fix: new `dropMinLevel` ABSOLUTE sub-energy floor (a drop's short-env must
  reach it) gating BOTH ratio edges + the kalman edge. Raised `dropEnergyJump`
  1.5→1.8. Sweep-verified winner: **zero spurious drops, precision 1.00**.
- Added an opt-in `dropLevelAssist` (windowed-edge level assist) that lifts
  recall 0.56→0.78 but at negFP 0→3 — shipped OFF (a phantom drop on calm music
  is worse than a miss on a dance floor; per-scene PATCH can enable it).

**3. Slow-zone super-tune:** replaced the linear `(ref−activity)/ref` map (ref
0.5, calibrated for clean line-in — left BOTH calm and active ≈0.75 once the
mic compressed dynamics) with a SMOOTHSTEP soft-knee (`slowZoneRef` 0.07,
`slowZoneWidth` 0.04) on activity = `max(micLow, micFlux−slowFluxFloor)`. The
`slowFluxFloor` (0.10) discounts the mic's constant flux floor so ambient (no
sub) reads calm while techno/drop bodies (high sub) read active.

**4. Build validation:** the buildScore already tracks the riser with
correlation 0.97 and peaks within −6 ms of the true drop — verified and locked
with a regression, not re-tuned (it was already excellent).

**5. Regression tests:** `tests/detector_eval.test.mjs` (8 tests — locks the
P/R/F1/negFP/build-corr/slow-margin acceptance bar + per-scenario behaviour),
`tests/integration/detection_metrics.test.mjs` (5 tests — guards the scoring
math + scenario determinism).

## Files changed

```
M marsin_engine/audio/detector/audio_structure_detector.js
M marsin_engine/audio/config/audio_config.js
M marsin_engine/tests/audio_config.test.js          (contract surface + new fields)
M marsin_engine/tests/integration/run_analysis.mjs  (scoring helpers + detectorSeries)
M marsin_engine/tests/integration/tuning_configs.mjs (TUNED_DETECTOR = new winner)
A marsin_engine/tests/integration/detector_scenarios.mjs
A marsin_engine/tools/detection_eval.mjs
A marsin_engine/tools/detection_sweep.mjs
A marsin_engine/tests/detector_eval.test.mjs
A marsin_engine/tests/integration/detection_metrics.test.mjs
M .agent/01_skills/06_audio_corpus_tuning.md         (§9.5 points at the new harness)
```

## New CPC / config keys (for siblings/instigator to reconcile)

No new CPC live keys (the detector still publishes the same six:
audioStructure / audioBuildScore / audioEnergyRatio / audioVocalsHot /
audioDropPulse / audioSlowZone). New `audio.structureDetector.*` CONFIG fields
(live-tunable, range-validated, registered in `audio_config.js`
AUDIO_LIVE_FIELDS): **`dropMinLevel`** (0.06), **`dropLevelAssist`** (bool,
false), **`slowZoneWidth`** (0.04), **`slowFluxFloor`** (0.10). Changed
defaults: `dropEnergyJump` 1.5→1.8, `slowZoneRef` 0.5→0.07.

## Tests run

- Unit/integration: `node --test` over the audio + detector + new suites →
  **134/134 pass** (see Verification proof).
- Engine `--dry-run` on port 31268 → exit 0, no missing-script warnings.
- Sim smoke: n/a (detector is engine-side, no sim change).
- CaptainPad: n/a (no UI change in this slice).

## Verification proof (paste-ready for `_verification.md`)

### B2 — detector super-tuning + scoring/eval  [PASS]  2026-06-20

- Branch / commit: `dev/detector_tuning` (off `feat/audio_analysis_2`).

**Drop / slow / build BEFORE→AFTER** (labeled `detector_scenarios`, all 3 mic
tiers, via `node tools/detection_eval.mjs`):

| metric | BEFORE (orig: windowed jump1.5, no floor, slow ref0.5) | AFTER (shipped tuned) |
|---|---|---|
| Drop F1 | 0.29 | **0.71** |
| Drop precision | 0.40 | **1.00** |
| Drop recall | 0.22 | **0.56** |
| Drop latency | 104 ms | 196 ms |
| Spurious drops (negFP) | 2 | **0** |
| Build corr | 0.97 | 0.97 |
| Build peak err | −6 ms | −6 ms |
| Slow-zone margin | 0.12 | **0.65** |
| Slow-zone accuracy | 0.46 | **0.91** |
| Slow (slow-region mean / non-slow mean) | 0.86 / 0.74 | 0.83 / **0.18** |

Commands (exact):
```
# BEFORE
node tools/detection_eval.mjs --json '{"dropEdgeMode":"windowed","dropEnergyJump":1.5,"dropMinLevel":0,"dropLevelAssist":false,"slowZoneRef":0.5,"slowZoneWidth":0.000001,"slowFluxFloor":0}'
#   → DROP P=0.40 R=0.22 F1=0.29 negFP=2 ; SLOW margin=0.12 acc=0.46
# AFTER
node tools/detection_eval.mjs --config default
#   → DROP P=1.00 R=0.56 F1=0.71 negFP=0 ; BUILD corr=0.97 peakErr=-6ms ; SLOW margin=0.65 acc=0.91
```

**On the ORIGINAL frozen synth set** (`node tests/integration/synthetic_accuracy.mjs`):
windowed edge BEFORE P=0.43 R=0.33 F1≈0.37 negFP=4 → AFTER **P=1.00 R=0.78
F1≈0.88 negFP=0** (zero negative-control false positives at every tier).

**Sweep proof** (`node tools/detection_sweep.mjs`): winner
`{windowed, dropMinLevel:0.06, dropEnergyJump:1.8}` → P=1.00 R=0.56 F1=0.71
negFP=0; the `level` edge reached F1=0.78 but negFP=3 (rejected).

**Tests** (`node --test`, all green):
```
tests/audio_structure_detector.test.js .................. 11/11
tests/integration/audio_analysis_validation.test.mjs ..... 35/35   (NOT regressed)
tests/audio_config.test.js ............................... 22/22
tests/detector_eval.test.mjs ............................. 8/8     (new)
tests/integration/detection_metrics.test.mjs ............. 5/5     (new)
tests/audio_analyzer.test.js + audio_signals.test.js ..... 56
broad audio suite (10 files) ............................ 134/134 total
```

**Engine dry-run:** `node engine.js --pattern test_const --model test_bench
--port 31268 --dry-run` → "🏁 Dry run complete", exit 0, no missing
blend/transition warnings.

**Captures (visual):** per-scenario detector-vs-label overlays (SVG: buildScore
+ slowZone + energyRatio traces, true-drop vs fired-drop markers, region/slow
bands) at `~/tmp/detection_eval/overlays/default.html` (and baseline/tuned).
Text sparklines confirmed the traces: full_arc buildScore rises through both
risers and peaks at the drops; slowZone high in intro/breakdown, low in drop
bodies; ambient slowZone climbs and holds high with zero drops; techno slowZone
correctly falls to low once the body engages, zero phantom drops. No PNG
rasteriser (no chromium/puppeteer in this datacenter) — the self-contained SVG
HTML is the viewable capture.

**Process / what was ruled out:** found the premature-build-fire root cause by
dumping micLowRaw/micFluxRaw around the labeled drops across tiers; the sub is
near-zero during a mic-compressed build and slams high at the drop → an
absolute floor (not just a ratio) is the robust discriminator. Ruled out the
level-assist (higher F1 but reintroduces calm-music false fires) and the kalman
edge (under-fires through the mic). Slow-zone: probed per-region micLow/micFlux,
found `max(micLow,micFlux)` conflates ambient flux-floor with real activity →
discounted the flux floor; verified the knee separates calm (act≈0.04) from
active (act≥0.09) at every tier.

- Verdict: ready to cross off B2 in plan §6.

## Known gaps / follow-ups

- Drop recall is 0.56 on the hardest scenarios (heavy-mic second-drops + a
  breakdown→drop2 that the windowed edge under-shoots). The `dropLevelAssist`
  arm recovers them (R 0.78) but at negFP 3 — left as an opt-in per-scene knob,
  not the default. A real human-labeled EDM corpus is still the right way to
  close the recall gap (synthetic ground truth only).
- Detector remains DISABLED by default + UI-locked (unchanged) — this slice
  makes it trustworthy; re-enabling is the operator's call after a listening
  pass.

## Operator action requested

Ready for review and merge into `feat/audio_analysis_2`.
