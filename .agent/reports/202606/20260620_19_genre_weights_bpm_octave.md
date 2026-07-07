# 2026-06-20 — Genre weights re-tune (live harness) + BPM half/double-tempo fix

**Branch:** `dev/genre_bpm_v3` (parent `feat/audio_analysis_2`, fftSize 2048).
**Author role:** DSP sub-agent.
**Owns:** `audio/signals/genre_classifier.js`, `audio/signals/bpm_tracker.js`.
**Companion:** plan `20260620_0` (D8), verification `20260620_1`, corpus report
`20260620_13`, genre v2 report `20260620_18`, eval harness
`marsin_engine/tools/genre_eval.mjs`, corpus `~/tmp/genre_corpus` (60 CC tracks,
never committed). Tuned ONLY against the LIVE `tools/genre_eval.mjs`.

## TL;DR

- **The "44.4%" in the brief was a harness artifact, not the real accuracy.**
  `tools/genre_eval.mjs` defaulted to **fftSize 1024**, but the deployed engine
  (config.yaml) and every other integration harness (`run_analysis.mjs`) use
  **fftSize 2048**. The genre profiles are anchored to MEASURED fft-2048
  centroids, so running the harness at its stale default scored the classifier
  at a resolution the engine never uses → 44.4%. At the DEPLOYED fftSize the
  same live harness gives **63.9%** — and that 63.9% confusion matrix is
  byte-identical to what genre v2 (`20260620_18`) reported. The D7 "replay
  artifact" worry was a red herring; the divergence was the harness fftSize, not
  a replay.
- **Fix:** made the harness default fftSize = 2048 (the product value), so the
  live `genre_eval.mjs` now reports the honest DEPLOYED accuracy by default.
  **Genre: 44.4% (harness@1024) → 63.9% (harness@2048 = deployed).**
- **Genre weights/profiles: explored thoroughly against the LIVE harness; KEPT
  AS-IS at 63.9%.** A faithful in-process tuner (verified to reproduce the live
  63.9% EXACTLY — the fidelity check D7 lacked) showed: weight coordinate-descent
  cannot beat 23/36; profile perturbation reaches 24/36 (66.7%) only by moving
  ONE anchor (melodic_house `melodic` 0.30→0.20) AWAY from its measured centroid
  to flip a single track — overfit on a 36-track noisy-label corpus, so NOT
  shipped; re-introducing a BPM weight (global, downtempo-only, or techno-only)
  REGRESSES even with corrected BPM. The honest best is the unchanged 63.9%.
- **BPM octave-doubling: FIXED in `bpm_tracker.js`.** Slow tracks no longer
  report ~2× tempo. Real downtempo: **DWK217 144→72, DWK301 141→70**; EDM
  (120–174 on kick + full-mix synths, edm_drop) **unchanged**. New regression
  test guards it.
- All required tests green: **224 pass / 0 fail.** Engine `--dry-run` exit 0.
  Clean git status (2 modified + 1 new test).

## Part A — genre accuracy (LIVE harness only)

### The fftSize-default bug (the real "44.4%")

`tools/genre_eval.mjs` `parseArgs` defaulted `fftSize: 1024`. The deployed
analyzer uses `config.yaml audio.fftSize: 2048` (engine.js passes `cfg.fftSize`;
`run_analysis.mjs` pins `FFT_SIZE = 2048` with the comment "config.yaml
audio.fftSize"). The genre profiles (v2) were anchored to centroids measured at
fft 2048. So:

```
node tools/genre_eval.mjs --corpus ~/tmp/genre_corpus            (old default 1024) → 16/36 = 44.4%
node tools/genre_eval.mjs --corpus ~/tmp/genre_corpus --fft 2048 (deployed value)   → 23/36 = 63.9%
```

The 44.4% scores the classifier at a resolution the engine never runs. **Fix:**
default the harness to the product fftSize (2048). Now the no-flag run reports
the honest deployed number.

### Live confusion — BEFORE (harness@1024, the misleading number)

```
  TRUE\PRED       deep_hou melodic_ tech_hou   techno melodic_ downtemp
  deep_house             1        1        2        0        2        0
  melodic_house          1        4        0        0        1        0
  tech_house             0        0        6        0        0        0
  techno                 1        1        2        1        1        0
  melodic_techno         1        0        1        0        4        0
  downtempo              0        3        0        2        1        0
  deep 17% · down 0% · mel_house 67% · mel_techno 67% · tech_h 100% · techno 17%
  OVERALL: 16/36 = 44.4%
```

### Live confusion — AFTER (harness@2048 = deployed; classifier weights UNCHANGED)

```
  TRUE\PRED       deep_hou melodic_ tech_hou   techno melodic_ downtemp
  deep_house             4        1        1        0        0        0
  melodic_house          0        5        0        1        0        0
  tech_house             0        0        6        0        0        0
  techno                 2        1        1        2        0        0
  melodic_techno         1        0        1        0        4        0
  downtempo              0        3        1        0        0        2
  deep 67% · down 33% · mel_house 83% · mel_techno 67% · tech_h 100% · techno 33%
  OVERALL: 23/36 = 63.9%
```

### Why the weights were KEPT (not re-tuned) — honest, anti-overfit

A faithful tuner (`~/tmp/tune_genre.mjs`, scratch) caches each track's full
per-hop `_feat` sequence ONCE (weight-independent — `_buildFeatures` uses no
weights) and replays the EXACT `_scoreAndDecide` decision (score-EMA + hysteresis
+ min-dwell + tail vote). It reproduces the live `genre_eval.mjs` **23/36 = 63.9%
EXACTLY** (the fidelity check the D7 replay lacked — D7's replay claimed 63.9%
while the live harness then gave 44.4% only because the live run used the wrong
default fftSize). Every candidate below was searched against this faithful
replay and the winner re-confirmed live:

- **Weight coordinate-descent** (11-value grid × 12 dims × 6 passes): cannot
  exceed 23/36. Weights are already at a local optimum.
- **Decision params** (scoreTau, switchMargin, minDwell, warmupMs): current
  values are best or tied — no robust gain.
- **Profile perturbation** reaches 24/36 (66.7%) — but the entire gain is ONE
  change: melodic_house `melodic` 0.30→0.20, moving the anchor 0.10 AWAY from its
  measured centroid (0.297) to flip a single track. On a 36-track corpus with
  uploader-tag labels, a 1-track anchor perturbation is fitting noise, not a
  generalizable improvement. NOT shipped.
- **Re-anchoring all profiles to freshly-measured centroids** (a principled move
  toward the means): 21/36 = 58.3% — WORSE. The shipped profiles already beat the
  raw means.
- **Re-introducing BPM** after the octave fix (Part B): the corrected per-genre
  BPM centroids separate well (deep 0.41 < down 0.46 < melH 0.56 < techH 0.62 <
  melT 0.66 < techno 0.72), but per-track BPM variance + label noise overwhelm it
  — a global BPM weight drops to 47%; a downtempo-only weight drops to 58%
  (downtempo→melodic_house); a techno-only weight drops to 50–56%. BPM is NOT a
  usable genre axis on this corpus even when reliable. The classifier keeps BPM
  weight 0; the BPM fix's value is to the `audioBpm` signal + beat-sync, not genre.

**Decision (per plan §5 + the brief's "if you can't beat it honestly, keep it
and say so"): genre stays at the unchanged 63.9%.** No overfit number shipped.
`genre_classifier.js` is byte-for-byte unchanged (enum / GENRE_NAMES / decision
logic / weights / profiles all intact).

## Part B — BPM half/double-tempo (octave) fix

### Root cause (measured)

The comb-enhanced autocorrelation + the 128-BPM perceptual prior both bias the
raw measurement toward the FASTER metrical level, and once a doubled tempo LOCKS,
the metric-relative guard folds every true (half-tempo) read back UP to the lock
(`_toLockOctave`), so the lock NEVER recovers. Two concrete failure modes on the
corpus: DWK217 locked at 144 while the measurement consistently read 72 (a clean
÷2); the histogram fold floor (`histFoldLo=95`) also folded any genuine <95 BPM
tempo UP into the 95–190 band.

### The fix (three coordinated parts, all in `bpm_tracker.js`)

1. **`_chooseTempoOctave`** — after the comb argmax picks a candidate period,
   re-evaluate the PURE (non-comb) normalized autocorrelation at the candidate,
   its half-tempo (2·lag) and double-tempo (lag/2) octaves, weight each by a WIDE
   perceptual preference (`_octavePref`, log-Gaussian centred at
   `octaveCenterBpm=115`, `octaveSigma=0.42`), and pick the octave maximizing
   (autocorr × preference). An alternate octave must carry ≥ `octaveAcRatio=0.65`
   of the candidate's autocorr to count as a real metrical level (rejects noise
   lags; 0.65 is low enough to recover a genuine 150 that also has a strong 75).
2. **Lock-octave migration** (`_accumulateOctaveMigration`, called every locked
   hop on the RAW octave-corrected measurement BEFORE folding) — when a
   sustained, confident measurement is a clean half/double of the lock (the
   autocorrelation genuinely prefers the other level), accumulate evidence and,
   after `octMigrateHops=40` (~3.7 s), MIGRATE the lock down/up an octave. The
   streak decays (not hard-resets) on intermittent ×4/3 reads so the strong
   half-tempo reads between them still accumulate. This is the only path that
   lets a lock that latched the doubled tempo recover without a full unlock.
3. **`histFoldLo` 95 → 80** so genuine ~80–95 BPM tempos keep their own octave in
   the SEARCH histogram instead of being folded up before lock.

### BEFORE → AFTER (measured via the REAL analyzer + BpmTracker)

Synths (deterministic `test_synths.js`, fft 2048):

| synth / tempo | BEFORE | AFTER |
|---|---|---|
| kick_4floor @ **90** (known-90) | 90.1 | **90.1** ✓ |
| kick_4floor @ **128** (known-128) | 128.2 | **128.2** ✓ |
| edm_drop @ 124 | 123.9 | **124.2** ✓ |
| full_track 120/124/128/132/140/**150**/174 (EDM) | all ≈true | **all ≈true** (150: 150.3, NOT halved) |

(Note: `full_track @ 90` reads 120 both before and after — that is a 4:3 METRIC
ambiguity, not a half/double octave error; the 8th-note bassline creates a real
120-ish periodicity. Out of scope for octave fixing; the clean known-90 proof is
`kick_4floor @ 90` = 90.1.)

Real corpus downtempo (`audioBpm`, mean over steady tail):

| track | BEFORE | AFTER |
|---|---|---|
| DWK031 | 115.4 | 115.7 |
| **DWK217** | **144.1** | **72.3** (octave fix) |
| **DWK301** | **140.6** | **70.3** (octave fix) |
| MIXG016 | 167.5 | 167.5 (genuine fast read — half-tempo autocorr too weak) |
| Vkrsnl037 | 116.4 | 116.7 |
| Vkrsnl038 | 116.4 | 115.8 |

Two of the three doubled downtempo tracks recovered to their true slow tempo;
the third (MIXG016) is a genuine fast/ambiguous read the autocorrelation
prefers, left alone to avoid an EDM regression. **No EDM 4/4 tempo regressed.**

## Proof (LIVE harness + tests)

- Genre BEFORE→AFTER (live): `node tools/genre_eval.mjs --corpus ~/tmp/genre_corpus`
  **16/36 = 44.4% (old default fft1024)** → **23/36 = 63.9% (default now fft2048 =
  deployed)**. Full matrices above. `genre_classifier.js` UNCHANGED.
- BPM BEFORE→AFTER: tables above (90-BPM synth, 128-BPM synth, real downtempo);
  EDM 120–174 unchanged.
- `node --test tests/audio_*.test.js tests/genre_classifier.test.js
  tests/note_estimator_synthetic.test.js
  tests/integration/audio_analysis_validation.test.mjs
  tests/bpm_tracker_octave.test.js tests/bpm_speed_sync.test.js
  tests/genre_eval_harness.test.mjs` → **224 tests, 224 pass, 0 fail.**
- `node engine.js --pattern test_const --model test_bench --dry-run` → exit 0,
  "Pattern loads and compiles OK". `node engine.js --list` → 65 patterns.
- `git diff --check -- marsin_engine` → clean. `node --check` on all changed
  files → OK. `git status` → only `audio/signals/bpm_tracker.js`,
  `tools/genre_eval.mjs` modified + `tests/bpm_tracker_octave.test.js` new. No
  state-file / node_modules residue.

## Deliverables

- `marsin_engine/audio/signals/bpm_tracker.js` — tempo-octave disambiguation
  (`_chooseTempoOctave`, `_octavePref`) + lock-octave migration
  (`_accumulateOctaveMigration`) + `histFoldLo` 95→80 + the new DEFAULTS knobs.
- `marsin_engine/tools/genre_eval.mjs` — default fftSize 1024 → 2048 (product
  value) so the live harness reports the honest DEPLOYED accuracy.
- `marsin_engine/tests/bpm_tracker_octave.test.js` — new regression test (90 not
  doubled, 128 correct, EDM 120–174 not halved).
- `marsin_engine/audio/signals/genre_classifier.js` — **UNCHANGED** (63.9% kept;
  no overfit shipped).
- `~/tmp/{tune_genre,verify_replay,search*,bpm_*}.mjs` — scratch tuning/probe
  tools (NOT committed).
- This report.
