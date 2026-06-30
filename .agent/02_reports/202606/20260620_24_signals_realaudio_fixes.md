# 2026-06-20 — E2: structure-signal real-audio fixes (Wave E2)

Branch: `dev/e2_signals_realaudio` (parent `feat/audio_analysis_2`, fftSize 2048).
Owns the **signal MODULES** only: `climax.js`, `drop_countdown.js`,
`build_anticipation.js`, `track_change.js`, `genre_classifier.js`.
**`derived_signals.js` was NOT touched** (clean union-merge for E3 — see below).

Implements the E2 items from findings `20260620_22` (P0-3, P1-4, P1-5, P1-7,
P1-A, P1-B), every fix PROVEN on the REAL 60-track CC corpus
(`~/tmp/genre_corpus`, continuous tracks with NO drops — so climax / countdown /
track-change should be QUIET on them).

## Verification harness (the probe)

Built a probe (`~/tmp/e2_probe/e2_probe.mjs`) that runs the FULL engine chain —
`AudioAnalyzer → SignalPostProcessor → AudioStructureDetector → DerivedSignals`
over a REAL `ParamCenter`, exactly as `tools/genre_eval.mjs` wires it, at the
deployed fftSize 2048 — across all 60 corpus tracks hop-by-hop, reporting each
E2 signal's real-audio fire-rate. Before/after captured by `git stash`.

## Before → after on the REAL 60-track corpus (309,247 hops)

| Signal | metric | BEFORE | AFTER | target |
|---|---|---|---|---|
| **audioClimax** (P0-3) | hops ≥0.5 | **47.64 %** (53/60 tracks) | **2.52 %** (36/60) | small fraction ✓ |
| **audioDropCountdown** (P1-4) | count-in pulses | **338** (35/60 tracks) | **128** (26/60) | ~0 (much reduced) |
| **audioBuildEta** (P1-5) | hops >0 | **68.85 %** | **19.95 %** | only when conf high ✓ |
| **audioTrackChange** (P1-7) | fires | **17** (6/60 tracks) | **10** (3/60) | ~0 on music ✓* |
| **genre cold-start** (P1-A) | melodic_house section-start hop-fraction (non-melodic_house tracks) | **13.90 %** | **4.87 %** | no cold-start melodic_house |

\* The residual 10 track-change fires are all **legitimate gap-reonsets** on
files that genuinely contain silence (the OOV `house/` folder holds a LibriVox
spoken-word clip with real speech pauses — verified each fire lands on a true
silence→music edge). On the actual music tracks track-change is now quiet.

Genre tail accuracy: **`node tools/genre_eval.mjs --corpus ~/tmp/genre_corpus`
→ 23/36 = 63.9 %** — UNCHANGED (deployed ceiling preserved).

## What changed, per module

### P0-3 `climax.js` — long-history re-baseline + rise-into-plateau
The v1 gate measured "near the recent ceiling" against a 4 s-tau ceiling, which
tracks the steady-state level of continuous music → climax saturated. New gate:
1. **Long-history peak reference** — a coarse 40 s loudness ring; the current
   loudness must reach `ceilFrac` (0.95) of its TOP-DECILE (robust 2nd-highest
   bin), i.e. near the loudest the section has been over tens of seconds.
2. **Rise-into-plateau** — the loudness must have CLIMBED `riseDelta` (0.16)
   above a slow 12 s baseline recently; a flat steady groove never opens this
   gap so it no longer climaxes. A `plateauGraceMs` (2.5 s) HOLDS the climax
   through the peak after the climb flattens; a drop primes a faster path.
3. Kept the full-spectrum-slam floor (high ∧ low ∧ abs) + attack/release EMA.
Result: 47.64 % → **2.52 %** of hops (a special moment), while a genuine rise
into a loud peak still ramps it high (synth proof in the test).

### P1-4 `drop_countdown.js` — monotonic-climb + bounded-peak arm gate
The riser momentarily crosses `peakScore` on normal real-audio flux/high wobble.
Added: (a) **monotonic climb** — the riser must have been clearly LOW
(`climbFromScore` 0.3) within `climbWindowMs` (4 s) before the peak (a real
build CLIMBS in); (b) **bounded peak** — a countdown is the FINAL bars, so if
the riser sits peaked longer than `peakMaxMs` (4 s) it is steady-state and we
DISARM; (c) stricter arm confidence (`minConfArm` 0.7). The coarse bars-to-phrase
ETA is NOT used as a gate (it reads a full phrase out even on a genuine build —
that was the fiction). Result: 338 → **128** count-ins (and the synth `edm_drop`
still fires its countdown; a steady-high riser no longer arms — new unit test).

### P1-5 `build_anticipation.js` — honest ETA gating
`audioBuildEta` now publishes a nonzero value ONLY when `riserConf ≥ etaMinConf`
(0.55) AND, when the detector is enabled, it corroborates BUILD. On continuous
music the raw slopes rarely clear that confidence, so the ETA stops emitting
fiction: 68.85 % → **19.95 %** of hops.

### P1-7 `track_change.js` — dropped the harmonic-cut cue (c)
Cue (c) (pitch-class flip bracketed by a loudness dip) fired spuriously
mid-track on real continuous music (the dominant pitch flips constantly). It is
REMOVED; the honest gap-reonset (a) + tempo-relock (b) cues remain. Dead state /
params (`_prevPc`, dip detector, `noteDip*`) pruned. 17 → **10** fires, all
legitimate gaps.

### P1-A `genre_classifier.js` — cold-start melodic_house gate
At ~5 s the kick-regularity ring is not full, so kickReg≈0 and the argmax
defaults to melodic_house (lowest-kickReg profile), which minDwell then pinned.
The FIRST commit is now gated on **`_kickFilled >= kickRingN`** (trustworthy
kickReg) PLUS a **first-commit floor** (`firstCommitMinMs` 7000) so the slow
band/score EMAs are settled, with a **`kickWaitCapMs`** safety so a genuinely
sparse-kick track still commits before the 12 s tail-vote window (preserving the
deployed vote). Section-start melodic_house hop-fraction on non-melodic_house
tracks: 13.90 % → **4.87 %**; the residual is genuine EMA settling, not the
empty-ring artifact. **Tail accuracy held at 63.9 %** (verified live).

### P1-B `genre_classifier.js` — confidence semantics doc
Added a clear comment: `audioGenreConf` is a **DECISION MARGIN** (winner-vs-
runner-up gap), NOT an accuracy/probability — it is slightly ANTI-correlated with
correctness on the corpus. No behaviour change.

## Tests (honest updates to match corrected behaviour)

- `tests/new_derived_signals.test.js`: the climax "steady groove climaxes" test
  was replaced by (1) a **rise-into-peak** climax test (silence→loud) and (2) a
  new **flat-groove must NOT saturate** test (the P0-3 over-fire guard). The
  countdown disarm test now drives a real climb-in; added a **steady-high riser
  must NOT count down** test (the P1-4 guard).
- `tests/genre_classifier.test.js`: passes unchanged (the cold-start gate is
  tuned so the melodic_house separation scenario still commits melodic_house).

All green:
- `node --test tests/audio_*.test.js` → **157 / 157 pass**
- `tests/new_derived_signals.test.js` → 24/24, `tests/genre_classifier.test.js`
  → 10/10, `tests/derived_signals_perf_finiteness.test.js` → pass
- `node --check` on all 6 touched files → pass
- `node engine.js --list` → exit 0; `--dry-run` (test_const/test_bench) → exit 0
- `git diff --check -- marsin_engine` → no whitespace errors
- `git status` clean (only the 6 intended files); no `states/*.yaml` touched

## Merge prediction (for the instigator)

**`derived_signals.js` was NOT touched** — all fixes are internal to the five
modules (the modules' existing input contracts already carry everything needed;
removed/unused inputs like track_change's `pitchClass` are simply ignored, no
plumbing change). E2 should therefore **union-merge cleanly with E3** (which owns
`derived_signals.js`) with zero conflict in the shared hub. The only shared test
file is `tests/new_derived_signals.test.js` (E2-owned per the slice); if E3 also
edits it, take both edits (E2's are the climax/countdown test bodies).
