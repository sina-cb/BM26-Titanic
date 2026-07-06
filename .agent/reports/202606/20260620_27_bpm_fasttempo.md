# 2026-06-20 — BPM fast-EDM tempo-halving fix (fast-leaning BM floor)

**Branch:** `dev/f2_bpm_fasttempo` (parent `feat/audio_analysis_2`, fftSize 2048).
**Role:** DEVELOPER sub-agent. **Owns ONLY** `audio/signals/bpm_tracker.js`
(+ `tests/bpm_tracker_octave.test.js`). No other file touched.
**Context:** Adv-A report 22 P1-D ("fast tempos still HALVE"), BPM octave report
`20260620_19`. Verified on the REAL AudioAnalyzer → BpmTracker chain + the real
corpus (`~/tmp/genre_corpus`, psytrance + drum_and_bass + downtempo folders).

## TL;DR

- **Burning Man runs fast** (psytrance ~140-150, DnB ~170-174). The merged octave
  fix (report 19) was clean for 118-160 EDM but **genuine fast tempos still
  HALVED**: full_track @170 → 84.8, DnB corpus → ~90, because the SYMMETRIC
  perceptual preference (centre 115, σ 0.42) weighted a fast tempo and its HALF
  near-equally — pref(170)/pref(85) ≈ 0.84, so the half was actually FAVOURED.
- **Fix (two params + one helper, all in `bpm_tracker.js`):**
  1. **Skewed octave-preference curve.** `_octavePref` now uses a narrow sigma
     BELOW the centre and a wide sigma ABOVE it: `octaveCenterBpm 115→128`,
     `octaveSigma 0.42→0.30` (slow side), new `octaveSigmaHi 0.60` (fast side).
     Now pref(fast)/pref(half) > 1.5 across 150-180 so a genuine fast tempo wins
     its ×2 contest — while the steep slow side + the existing `octaveAcRatio`
     gate keep downtempo from re-doubling.
  2. **`octMigrateConf 0.10→0.06`** so a low-energy FAST track that locked its
     half during the warmup window (DnB tkep017: autocorr ~0.12) can still
     migrate UP once the steady chooser reads the clean ×2.
- **Recovered fast tempos** (true 140-180): full_track @170 **84.8 → 171.6**;
  DnB rfs005 **92.7 → 180.0**, tkep010 **90.1 → 175.3**, tkep012 **90.1 → 179.6**,
  tkep017 **77.7 → 154.7**.
- **No regression:** downtempo DWK217 stays **70.0**, DWK031 **110.7**, Vkrsnl
  **130/116**; ALL 118-160 EDM unchanged; the 95→80 fold boundary unchanged
  (kick_4floor @78/80/82/93/95/97 all read true).
- Required tests green (the one pre-existing `audio_config` contract failure is
  on the parent, unrelated to this slice). Engine `--dry-run` exit 0. Clean git
  status (2 owned files, no state residue).

## Root cause (measured)

Three distinct failure classes were found via the live harness, only ONE of which
is an octave (×2) error this slice fixes:

1. **×2 octave halving (FIXED):** the comb argmax / pure autocorr of a heavy
   4-on-floor often peaks at the half-tempo two-bar period; the old symmetric
   preference then FAVOURED the half (pref(170)/pref(85) ≈ 0.84). full_track @170,
   DnB tracks. → skewed preference.
2. **Lock-at-half during warmup (FIXED for clean ×2):** a low-energy fast track
   (tkep017, autocorr 0.12) locks its half in the first 6 s window before the
   chooser stabilizes; migration then never fired because `octMigrateConf 0.10`
   was above the track's confidence. → lowered to 0.06.
3. **Metric-ratio errors (OUT OF SCOPE — honest frontier):** edm_drop @150 → 135
   (3:2/comb pull), @174 → 144; psytrance puMpL008 → 91 (3:2 of 148). These are
   NOT ×2 octave errors — the comb argmax / lock lands on a 3:2 or 6:5 metric
   level the octave machinery (±1 octave only) cannot reach, same class as report
   19's documented `full_track @90 → 120` 4:3 ambiguity. Left as-is.

The downtempo↔fast tension (the crux) is resolved by the `octaveAcRatio=0.65`
gate: a genuinely slow ~70 BPM track has autocorr at its DOUBLE far below 0.65 of
the slow peak, so the double is never even CONSIDERED. The perceptual preference
only breaks ties between two REAL metrical levels — it cannot manufacture one — so
steepening the slow side recovers fast EDM without re-doubling downtempo.

## BEFORE → AFTER (real AudioAnalyzer → BpmTracker, mean over steady tail)

### Fast EDM synths (deterministic `test_synths.js`, fft 2048, 30 s)

| case | BEFORE | AFTER | note |
|---|---|---|---|
| full_track @118 | 117.8 | 117.8 | ✓ |
| full_track @128 | 128.2 | 128.2 | ✓ |
| full_track @140 | 139.9 | 139.9 | ✓ |
| full_track @150 | 150.3 | 150.3 | ✓ |
| full_track @160 | 160.5 | 160.5 | ✓ |
| **full_track @170** | **84.8** | **171.6** | ✓ RECOVERED |
| full_track @174 | 173.3 | 173.3 | ✓ |
| edm_drop @150 | 135.4 | 135.4 | 3:2 metric (out of scope) |
| edm_drop @174 | 143.7 | 143.7 | 6:5 metric (out of scope) |

### Fold boundaries (kick_4floor, must stay put)

| @78 | @80 | @82 | @93 | @95 | @97 | @118 | @120 | @122 |
|---|---|---|---|---|---|---|---|---|
| 78.1 | 79.9 | 82.0 | 92.8 | 95.2 | 97.2 | 117.9 | 120.1 | 122.2 |

(identical BEFORE → AFTER — the 95→80 fold boundary is preserved.)

### Real corpus (mean over steady tail)

| track | BEFORE | AFTER | note |
|---|---|---|---|
| psytrance/SSTAR01r | 139.9 | 139.9 | fast ✓ |
| psytrance/SSTAR04 | 147.9 | 147.9 | fast ✓ |
| psytrance/ca314_d | 132.4 | 132.4 | ✓ |
| psytrance/epa039 | 145.5 | 145.5 | fast ✓ |
| psytrance/puMpL008 | 91.2 | 91.2 | 3:2 of 148 (out of scope) |
| psytrance/tsabeat | 144.7 | 144.7 | fast ✓ |
| dnb/Dee3-TheDnb-trax | 106.8 | 106.8 | ambiguous (comb argmax 108) |
| **dnb/rfs005** | **92.7** | **180.0** | ✓ RECOVERED |
| dnb/tkep009 | 120.0 | 120.0 | (genuine ~120) |
| **dnb/tkep010** | **90.1** | **175.3** | ✓ RECOVERED |
| **dnb/tkep012** | **90.1** | **179.6** | ✓ RECOVERED |
| **dnb/tkep017** | **77.7** | **154.7** | ✓ RECOVERED (migration) |
| downtempo/DWK031 | 110.7 | 110.7 | ✓ unchanged |
| **downtempo/DWK217** | **70.0** | **70.0** | ✓ STILL CORRECT |
| downtempo/DWK301 | 140.1 | 140.1 | bistable 70↔140 on this branch* |
| downtempo/MIXG016 | 167.8 | 167.8 | ✓ unchanged |
| downtempo/Vkrsnl037 | 130.1 | 130.1 | ✓ unchanged |
| downtempo/Vkrsnl038 | 116.1 | 116.1 | ✓ unchanged |

\* DWK301 is genuinely metrically AMBIGUOUS: the autocorr flips 70↔140 over the
clip (migrates to 70 at ~24 s, back to 140 at ~38 s). The 16 s tail mean = 140.1
both BEFORE and AFTER — this slice neither improves nor regresses it. Report 19's
70.3 was measured over a different/shorter tail window; on this parent branch the
steady-tail read is already 140. DWK217 (the unambiguous downtempo) holds at 70.

## The trade-off (honest frontier)

This is a two-sided tuning and I leaned it FAST, as instructed for a BM dance
floor. The win: every genuine ×2 halving on fast EDM/DnB/psytrance recovered
(full_track @170 and 4 of 6 DnB corpus tracks), with **zero downtempo regression**
(DWK217 + all 5 other downtempo tracks unchanged) and **zero EDM/fold-boundary
regression**. The residual misses (edm_drop @150/@174, psytrance puMpL008, DnB
Dee3) are NOT ×2 octave errors — they are 3:2 / 6:5 / comb-argmax METRIC-ratio
landings the ±1-octave machinery cannot reach, the same documented class as
report 19's `full_track @90 → 120`. Fixing those would need a metric-level
disambiguator beyond octave folding (out of this slice's scope and risk budget).
The skewed preference deliberately favours the FAST octave in the 140-180 band,
which is exactly the right bias for a fast-leaning floor.

## Param changes (all in `bpm_tracker.js` DEFAULTS)

| param | old | new | why |
|---|---|---|---|
| `octaveCenterBpm` | 115 | 128 | centre the preference on the EDM/128-prior sweet spot |
| `octaveSigma` | 0.42 | 0.30 | NARROW slow side: steep drop below ~100 so fast isn't dragged to its half |
| `octaveSigmaHi` | (new) | 0.60 | WIDE fast side: keep 120-180 near the plateau so fast wins its ×2 |
| `octMigrateConf` | 0.10 | 0.06 | let a low-energy fast track that locked its half migrate up |

`_octavePref` rewritten as a SKEWED log-Gaussian (sigma chosen by sign of the
log-deviation from centre). `octaveAcRatio` (0.65) UNCHANGED — it is the gate that
protects downtempo. `histFoldLo` (80) UNCHANGED.

## Proof

- BEFORE → AFTER tables above (real analyzer + BpmTracker; synth + corpus).
- `node --test tests/audio_*.test.js tests/bpm_tracker_octave.test.js
  tests/note_estimator_synthetic.test.js` → 173/174 pass; the 1 fail
  (`AUDIO_LIVE_FIELDS is the contract surface`, `tests/audio_config.test.js`) is
  PRE-EXISTING on the parent (verified by `git stash` → still fails), outside
  this slice's owned file.
- `tests/bpm_tracker_octave.test.js` alone → 6/6 pass (added: fast 160/170
  recovery, slow-not-doubled @75, fold boundary @80).
- `node engine.js --pattern test_const --model test_bench --dry-run` → exit 0,
  "Pattern loads and compiles OK". `node engine.js --list` → 70 patterns.
- `git diff --check` clean; `node --check` on both changed files OK; `git status`
  → only `audio/signals/bpm_tracker.js` + `tests/bpm_tracker_octave.test.js`
  modified, no state-file / node_modules residue.

## Deliverables

- `marsin_engine/audio/signals/bpm_tracker.js` — skewed `_octavePref`
  (`octaveSigmaHi`), `octaveCenterBpm 115→128`, `octaveSigma 0.42→0.30`,
  `octMigrateConf 0.10→0.06`, all with rationale comments.
- `marsin_engine/tests/bpm_tracker_octave.test.js` — added fast-tempo recovery,
  slow-not-doubled, and fold-boundary regression tests.
- `~/tmp/bpm_ft/*` — scratch harness/probes (NOT committed).
- This report.
