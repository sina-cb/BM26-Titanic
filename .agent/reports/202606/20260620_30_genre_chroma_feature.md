# 2026-06-20 — GENRE v3: a CHROMA harmonic/timbre feature (building block + honest verdict)

**Branch:** `dev/g1_genre_chroma` (parent `feat/audio_analysis_2`, fftSize 2048).
**Author role:** DSP/ML sub-agent.
**Companion context:** P1-C in `20260620_22_adversarial_rewave2_findings.md`
("63.9% IS the ceiling — techno/downtempo need a harmonic/timbre feature that
doesn't exist"), the v2 retune `20260620_18`, the weights/BPM note `20260620_19`.
Corpus `~/tmp/genre_corpus` (60 CC tracks, 36 scored, never committed).

## TL;DR (HONEST)

- Built a real **12-bin pitch-class CHROMA** in the analyzer (additive, the
  proven dom-freq/onset pattern — existing outputs byte-identical) and derived
  **three level-robust harmonic/timbre scalars**: `tonalStability` (chroma
  concentration), `chromaFlux` (harmonic-change rate), `chromaTilt`
  (treble/bass timbre). Wired them end-to-end into the classifier as new CPC
  keys `micTonalStabilityRaw` / `micChromaFluxRaw` / `micChromaTiltRaw`.
- The features **genuinely separate at the centroid level** (chromaTilt: techno
  darkest 0.30, melodic_* brightest 0.46; Fisher ~1.9 / chromaFlux ~7.5 on the
  corpus) — but on these **36 noisy-label tracks the harmonic axis does NOT
  beat the 63.9% ceiling.** Within-genre variance swamps the separation for the
  two hard genres (techno scatters chromaTilt 0.20–0.41; downtempo is BRIGHT
  0.40–0.61 so chromaTilt pulls it TOWARD melodic_house, its main confuser).
- A **faithful in-engine weight search** (cache per-rescore feature streams,
  replay the EXACT score-EMA + hysteresis + min-dwell + tail-vote decision)
  over the 3 new axes PLUS the v2 axes they could augment found **no
  combination above 23/36** — the only 63.9% routes that USE chroma trade
  melodic_techno for downtempo, a lateral move, not a net gain. **P1-C holds.**
- **Decision (no overfit):** SHIP the chroma feature as a documented building
  block (analyzer + CPC plumbing live), set its classifier weights to **0** so
  the deployed genre accuracy and exact per-genre breakdown are **UNCHANGED at
  63.9%**. No fabricated number.

## BEFORE → AFTER (real corpus, `node tools/genre_eval.mjs --corpus ~/tmp/genre_corpus`)

Identical — by design. The chroma feature is plumbed but weighted 0 in the
classifier, so the committed decision is byte-for-byte the v2 baseline:

```
Confusion (BEFORE == AFTER):
  TRUE\PRED       deep_hou melodic_ tech_hou   techno melodic_ downtemp
  deep_house             4        1        1        0        0        0
  melodic_house          1        5        0        0        0        0
  tech_house             0        0        6        0        0        0
  techno                 2        1        1        2        0        0
  melodic_techno         1        0        1        0        4        0
  downtempo              0        3        1        0        0        2

Per-genre: deep 67% · down 33% · mel_house 83% · mel_techno 67% · tech_h 100% · techno 33%
OVERALL: 23/36 = 63.9%
```

| Genre | before | after |
|---|---|---|
| techno | 33% (2/6) | **33% (2/6)** |
| downtempo | 33% (2/6) | **33% (2/6)** |
| (all others) | unchanged | unchanged |
| **OVERALL** | **63.9%** | **63.9%** |

## 1. The chroma feature design (analyzer)

`audio/analyzer/audio_analyzer.js` — ADDITIVE, in the existing per-bin flux loop
(no extra FFT, no per-hop allocation; `_chroma` + `_prevChromaNorm` are reused
instance buffers, `_chromaBinClass` precomputed at reconfigure):

- **Chroma fold.** A precomputed `Int8Array` maps each positive FFT bin in the
  fundamental band **65 Hz–2000 Hz** (≈C2–B6; above the octave-ambiguous
  sub/kick, below the unpitched cymbal hiss) to its pitch class
  `round(12·log2(f/C0)) mod 12`, C0 = 16.3516 Hz. Bins outside the band → class
  −1 (ignored). The hot loop does one array index + add per bin.
- **`tonalStability`** = `1 − normalizedEntropy(chroma)` — chroma CONCENTRATION
  (1 = a single pitch class, 0 = flat across all 12). Static loops read high.
- **`chromaFlux`** = ½·L1 distance between successive **L1-normalized** chroma
  vectors — the harmonic-CHANGE rate (0 = a harmonically static loop).
- **`chromaTilt`** = treble/(bass+treble) of the in-chroma-band magnitude split
  at ~500 Hz — a level-robust brightness/timbre.

All three land in [0,1], are emitted from `onAnalysis`, and the legacy
`{low,mid,high,kick,flux}` outputs stay byte-identical (the existing
"additive guarantee" analyzer test passes).

## 2. Wiring (CPC keys + classifier)

- New live, engine-internal RAW CPC mirrors (descriptors in
  `audio/postproc/audio_signals.js`, broadcastHz 15, [0,1], no OSC):
  **`micTonalStabilityRaw`, `micChromaFluxRaw`, `micChromaTiltRaw`.**
- `engine.js` + `tools/genre_eval.mjs` publish them in the analyzer `onAnalysis`
  payload (hoisted `micWrites`, allocation-free).
- `audio/signals/derived_signals.js` reads them and passes them into
  `GenreClassifier.update({ tonalStability, chromaFlux, chromaTilt, ... })`
  (one small localized block).
- `audio/signals/genre_classifier.js`: feature vector 12 → **15 dims**
  (`F_TONALSTAB`, `F_CHROMAFLUX`, `F_CHROMATILT`), section-window EMAs
  (`featTau`), profiles re-anchored to the MEASURED corpus centroids for the 3
  new dims. Canonical 7-genre enum + `GENRE_NAMES` UNCHANGED.

## 3. Measured per-genre centroids (the separability evidence)

From `genre_eval` (classifier-internal `_feat`, tail window), new dims:

```
genre            tonalStab  chromaFlux  chromaTilt
deep_house          0.127      0.109       0.371
downtempo           0.106      0.084       0.414
melodic_house       0.108      0.076       0.458
melodic_techno      0.107      0.095       0.459
tech_house          0.157      0.123       0.338
techno              0.153      0.092       0.301
```

Real, ordered separation exists: **techno is the DARKEST (chromaTilt 0.301)**
and **tech_house/techno are the most tonally CONCENTRATED** (static loops). But
it does not survive the within-genre scatter (see §4).

## 4. Why it can't break the ceiling (the honest part — §technodiag)

Per-track new-feature values for the hard genres + their confuser:

```
techno     XX tech_house    tilt=0.203  (a dark techno that looks like dark tech_house)
techno     XX deep_house    tilt=0.405  (a BRIGHT techno — no dark extreme)
techno     XX melodic_house tilt=0.318
techno     XX tech_house    tilt=0.318
techno     OK techno        tilt=0.285
techno     OK techno        tilt=0.275

downtempo  XX melodic_house tilt=0.423  (downtempo is BRIGHT → looks melodic_house)
downtempo  XX melodic_house tilt=0.608
downtempo  XX tech_house    tilt=0.419
downtempo  XX melodic_house tilt=0.417
```

- **techno** has no exclusive extreme: its chromaTilt spans 0.20–0.41, fully
  overlapping tech_house and melodic_house. The cheap dark/static cue fits the 2
  tracks that already classified correctly and does nothing for the 4 that
  scatter.
- **downtempo** is harmonically BRIGHT (0.40–0.61) and low-tonalStab — exactly
  the melodic_house signature — so chromaTilt pulls it the WRONG way. Its real
  best cue (low BPM) is destroyed upstream by the BPM tracker octave-doubling it
  into the 4/4 band (`20260620_18` §4). Chroma can't fix a tempo problem.

The corpus labels are uploader tags, not expert annotation, and melodic_* is one
netlabel artist — the noise floor here is high. A feature with a Fisher ~1.9 on
clean data still loses to that scatter.

## 5. Faithful weight search (no overfit, reproduces the ceiling)

A scratch harness (`~/tmp`, not committed) cached each track's per-rescore
feature stream (weight-independent) by running the REAL
analyzer+detector+derived chain, then replayed the EXACT in-engine decision
under candidate weights — the report-18 method. Coordinate descent over the 3
new weights **plus** the v2 axes they could augment/replace (band-tilt, fluxVar,
flux, lowMid, bassW, midW): **best = 23/36 = 63.9%**, every chroma-using route a
lateral trade. Independently reproduces P1-C a third way.

## 6. Deliverable & proof

- `node tools/genre_eval.mjs --corpus ~/tmp/genre_corpus`: **63.9% (23/36),
  unchanged** (full matrix §BEFORE→AFTER).
- `node --test tests/audio_*.test.js tests/genre_classifier.test.js
  tests/genre_eval_harness.test.mjs tests/new_derived_signals.test.js` →
  **199 tests, 199 pass, 0 fail** (analyzer 40 incl. 5 new chroma tests +
  the additive byte-identical guard; audio_signals registry snapshot updated to
  58 entries; harness feature-dim 12 → 15).
- `node engine.js --list` OK; `node engine.js --pattern test_const --model
  test_bench --dry-run` → **exit 0**, no missing-blend warning.
- `git diff --check -- marsin_engine marsin_pb` clean; `node --check` on all 6
  changed JS files OK; `git status` only the 9 intended files; **no states/
  diff, no node_modules residue.**
- PRE-EXISTING (not introduced here): 3 detector drop-firing failures in
  `tests/integration/audio_analysis_validation.test.mjs` (`runClipViaWav`,
  `clean_drop`, `double_drop`) — **verified identical on the parent analyzer**
  (stashed the analyzer change → same 3 fails), and consistent with the Wave-E
  detector real-audio findings. Out of this slice's scope.

## 7. Files changed

- `marsin_engine/audio/analyzer/audio_analyzer.js` — chroma fold + 3 derived
  scalars (additive; legacy outputs byte-identical).
- `marsin_engine/audio/postproc/audio_signals.js` — 3 RAW CPC descriptors.
- `marsin_engine/engine.js`, `marsin_engine/tools/genre_eval.mjs` — publish the
  3 mirrors in `onAnalysis`.
- `marsin_engine/audio/signals/derived_signals.js` — pass them to the classifier.
- `marsin_engine/audio/signals/genre_classifier.js` — 12 → 15-dim feature
  vector + EMAs + re-anchored profiles; chroma weights = 0 (honest, no overfit).
- `marsin_engine/tests/audio_analyzer.test.js` (5 chroma tests),
  `tests/audio_signals.test.js` (registry snapshot +3), `tests/genre_eval_harness.test.mjs`
  (dim 15).
- This report.

## 8. Honest verdict

The chroma harmonic/timbre axis P1-C asked for now EXISTS, is correctly
engineered, separates at the centroid level, and is shipped live as a building
block. It does **not** raise genre accuracy on this noisy 36-track corpus — the
ceiling is real, and forcing a number out of it would be overfitting. The most
likely path to actually move techno/downtempo is upstream: **fix the BPM
octave-doubling** (recovers downtempo's strongest cue) and re-test the chroma
axis on a cleaner, expert-labelled corpus, where the now-available chromaTilt /
tonalStability keys can carry weight.
