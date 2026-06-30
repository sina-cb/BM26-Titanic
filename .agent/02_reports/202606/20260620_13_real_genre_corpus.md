# 2026-06-20 — Real CC dance-music genre corpus + genre-eval harness + baseline

**Branch:** `dev/audio_corpus_real` (parent `feat/audio_analysis_2`).
**Author role:** DATA/DSP sub-agent.
**Companion:** plan `20260620_0`, verification `20260620_1`, datasets
`marsin_engine/datasets/README.md`, manifest
`marsin_engine/datasets/genre_corpus_manifest.json`.

## TL;DR

- Network audio fetch **works** here now → built a **real, genre-labelled,
  Creative-Commons dance-music corpus** from **archive.org**: **60 tracks,
  6 per genre, 10 genres** (6 canonical classifier genres + 4 BM extras).
  Decoded to mono 44.1k 16-bit WAV in `~/tmp/genre_corpus/<genre>/<id>.wav`
  (audio never committed). Provenance pinned in
  `datasets/genre_corpus_manifest.json`.
- Built a reusable **genre-eval harness** `tools/genre_eval.mjs` that runs each
  WAV through the **REAL** engine chain (analyzer → postproc → detector →
  derivedSignals), forces party on, collects published `audioGenre`, and scores
  vs the folder label → confusion matrix + per-genre + overall accuracy +
  measured per-genre feature centroids.
- **Baseline @ fftSize 1024 (shipped): 8/36 = 22.2%** overall on the 6 scored
  genres (chance ≈ 17%). The classifier collapses house/techno-family tracks
  onto **techno/tech_house** and **never emits melodic_house or melodic_techno**.
- Added a CI guard `tests/genre_eval_harness.test.mjs` (synthetic, no real-audio
  dependency). **Full suite: 291 tests green.**
- I did **NOT** edit `genre_classifier.js` (a sibling, `dev/fft2048_retune`,
  owns it). This report hands them the data + concrete PROFILE-tuning suggestions.

## 1. The corpus

- **Source:** archive.org netlabel/electronic. Search per genre via
  `advancedsearch.php?q=subject:(<genre>) AND mediatype:(audio) AND
  licenseurl:(*creativecommons*)` sorted by downloads; one audio file per item
  from `/metadata/<id>`; downloaded from `/download/<id>/<file>`.
- **Genres (6/each):** `techno`, `deep_house`, `melodic_house`, `tech_house`,
  `melodic_techno`, `downtempo` (canonical), plus `house`, `psytrance`,
  `drum_and_bass`, `progressive` (BM extras — decoded, reported out-of-vocab;
  the classifier can only emit the 6 canonical genres).
- **Processing:** each track trimmed to 60 s (start 30 s, to skip quiet intros),
  decoded to mono 44.1 kHz 16-bit WAV via `ffmpeg-static`. ~303 MB total in
  `~/tmp`.
- **Licenses:** all Creative Commons — CC0/public-domain-mark, CC-BY, CC-BY-SA,
  CC-BY-NC, CC-BY-NC-ND. Exact per-track license/identifier/title/source URL in
  `datasets/genre_corpus_manifest.json`. Use is **offline tuning only** (audio
  never committed/redistributed, no derivative distributed), so the ND tracks
  are fine for this.
- **Caveats (honest):** a few archive.org items are mis-tagged at the source
  (some `house` hits are spoken-word/LibriVox); `melodic_house`/`progressive`
  are dominated by one netlabel artist (Prototype 202). Labels are uploader
  subject tags, not expert annotation. The numbers are a real, reproducible
  **lower bound**, not a polished benchmark.

Rebuild: `node ~/tmp/corpus_fetch/build_corpus.mjs` (scratch tool, in ~/tmp).

## 2. The harness — `tools/genre_eval.mjs`

```bash
cd marsin_engine
node tools/genre_eval.mjs                     # ~/tmp/genre_corpus, fft 1024
node tools/genre_eval.mjs --corpus <dir> --fft 2048 --json
node tools/genre_eval.mjs --no-force-party    # also require the real party gate
node --test tests/genre_eval_harness.test.mjs # CI guard (synthetic)
```

It wires the EXACT engine `onAnalysis` chain from `engine.js` (analyzer params
from config.yaml: fftSize 1024, hop 512, the product BANDS/KICK/SUB), runs the
real `DerivedSignals.tick`, and reads the published `audioGenre`. Party is
forced by dropping `PartyMode` thresholds to ~0 (faithful: loud dance music
clears the real gate; we just remove the latch latency so short trims qualify).
Prediction = **majority vote of `audioGenre` over the post-12 s tail** (after
the classifier's ~5 s warmup + window fill). `runWav`/`GENRE_NAMES` are exported
for the test.

## 3. Baseline result (fftSize 1024 — the shipped value)

```
Confusion matrix (rows = TRUE, cols = PREDICTED):
  TRUE\PRED       deep_hou melodic_ tech_hou   techno melodic_ downtemp
  deep_house             1        0        1        3        0        1
  melodic_house          0        0        2        2        0        2
  tech_house             0        0        2        4        0        0
  techno                 0        0        3        2        0        1
  melodic_techno         1        0        2        3        0        0
  downtempo              1        0        1        1        0        3

Per-genre accuracy:  deep_house 17% · downtempo 50% · melodic_house 0% ·
                     melodic_techno 0% · tech_house 33% · techno 33%
OVERALL: 8/36 = 22.2%
```

For context only (the sibling owns the retune): re-running at **fftSize 2048**
with the *current* 1024-tuned profiles **drops to 5/36 = 13.9%** — confirming
the PROFILES are fftSize-specific and must be re-tuned per fftSize.

## 4. Measured per-genre feature centroids (the key tuning data)

What the REAL analyzer feeds the classifier (mean over each genre's tracks,
tail window). Feature order = the classifier's `_feat` layout:

```
  genre               bpm  kickReg  kickDens  lowMid  sparkle  sparkleVar  melodic   flux
  deep_house        0.519    0.690    0.936    0.496    0.442    0.513    0.116    0.347
  downtempo         0.372    0.476    0.814    0.485    0.280    0.590    0.214    0.340
  melodic_house     0.449    0.469    0.809    0.488    0.324    0.536    0.183    0.351
  melodic_techno    0.580    0.729    0.973    0.481    0.331    0.667    0.115    0.290
  tech_house        0.786    0.597    0.932    0.401    0.280    0.573    0.103    0.215
  techno            0.611    0.530    0.924    0.514    0.330    0.692    0.164    0.298
```

(`--json` also emits these as `centroids` + `featLabels`, plus per-track rows.)

## 5. Diagnosis — why it fails (data-grounded)

1. **`melodic` (note-change rate) is BROKEN as a discriminator on real audio.**
   The synthetic-tuning note in `genre_classifier.js` assumed `melodic`
   saturates ~0.85–1.0 for any track with moving chord roots and reads ~0 only
   for single-root techno. **On real audio it is ~0.10–0.21 for EVERY genre**
   (techno 0.164 is *not* the minimum — deep_house 0.116 and melodic_techno
   0.115 are lower). So: (a) the techno profile's `melodic p=0.0, w=1.8` now
   *mis-rewards low-melodic tracks across all genres* and pulls them toward
   techno; (b) the melodic_house/melodic_techno profiles demand `melodic=1.0`
   that **no real track reaches**, which is exactly why those two genres are
   **NEVER predicted** (0/6 each). This is the single biggest accuracy hole.

2. **`kickDens` saturates (~0.81–0.97 everywhere).** Zero discriminative power
   on real 4/4 dance music. Currently weighted 0.5–0.9; effectively dead.

3. **`sparkle` (high band) lost its dark/bright separation.** Profiles assume
   techno≈0.05, tech_house≈0.37, deep_house≈0.14; real audio reads
   techno 0.33, tech_house 0.28, deep_house 0.44. The ordering is partly
   **inverted** (deep_house is the brightest, not techno the darkest). The
   `sparkle` targets are stale.

4. **`sparkleVar` does NOT flag tech_house.** Profile says tech_house≈1.0 vs
   ~0.35 elsewhere; real audio: tech_house 0.573, techno 0.692, melodic_techno
   0.667 — tech_house is **not** the highest. The "offbeat-hat groove" signature
   didn't survive the real-audio + fft-1024 resolution. tech_house's 4 misfires
   all go to techno, consistent with this.

5. **BPM is the only axis that still separates** (downtempo 0.37 lowest,
   tech_house 0.79 / melodic_techno 0.58 / techno 0.61 higher). Downtempo's 50%
   (best) is almost entirely BPM-driven. This matches the header's "BPM is the
   strongest single axis" — but right now it is nearly the *only* working axis.

Net: with `melodic`, `kickDens`, `sparkle`, `sparkleVar` all degraded on real
audio, the classifier leans on BPM + noise and collapses onto techno/tech_house.

## 6. Concrete PROFILE-tuning suggestions (for `dev/fft2048_retune` sibling)

Order by expected impact. All target values below are the **measured real
centroids** from §4 — retune PROFILES toward these, not the synthetic priors.

1. **Fix or drop `melodic`.** Either (a) re-derive the feature so it actually
   separates melodic genres (the note-rate read is saturating low — likely the
   NoteEstimator rarely commits stable pitch-class flips on dense mixes at fft
   1024; raising fft to 2048 may help, the sibling owns that), OR (b) until it
   does, **set `melodic` weight ≈ 0 for ALL profiles** and stop using
   `melodic=0.0` as the techno flag and `melodic=1.0` as the melodic_* flag.
   Right now it is the main reason melodic_house/melodic_techno are 0/6 and
   techno over-fires. This is the #1 fix.

2. **Drop `kickDens` weight to ~0** (saturated, no signal).

3. **Re-anchor `sparkle` targets to measured values** and flip the polarity
   assumption: deep_house is the *brightest* (0.44), techno/melodic_techno mid
   (0.33), tech_house/downtempo darker (0.28). Use `sparkle` to pull deep_house
   UP, not techno down.

4. **Re-anchor `sparkleVar`**: techno highest (0.692), then melodic_techno
   (0.667), downtempo (0.590), tech_house (0.573), deep_house (0.513). It no
   longer flags tech_house — repurpose it as a mild techno-family cue or lower
   its weight.

5. **Lean harder on BPM** (the one working axis): tighten the BPM targets to the
   measured centroids — downtempo 0.37, melodic_house 0.45, deep_house 0.52,
   melodic_techno 0.58, techno 0.61, tech_house 0.79 — and raise BPM weight.
   Note deep_house/melodic_house/melodic_techno cluster in 0.45–0.58, so BPM
   alone won't split them — they need a *second* working feature (see #1/#3).

6. **Consider a `lowMid` cue for tech_house** — it is the only genre with a
   distinctly LOW `lowMid` (0.401 vs 0.48–0.51 elsewhere). Small but real; could
   help separate tech_house from techno (currently its worst confusion).

7. **Re-run `node tools/genre_eval.mjs --fft <N>` after each profile edit** to
   measure, and re-capture centroids at the chosen fftSize (they shift with
   fft — see the 2048 numbers in the manifest/README). The harness is the
   feedback loop; profiles must be tuned at whatever fftSize ships.

## 7. Proof

- `node tools/genre_eval.mjs --fft 1024` → **8/36 = 22.2%** (matrix + centroids
  in §3/§4 above; captured live this run).
- `node tools/genre_eval.mjs --fft 2048` → 5/36 = 13.9% (context).
- `node --test tests/genre_eval_harness.test.mjs` → 2/2 pass.
- Full audio+companion+integration suite (incl. the new test):
  `node --test tests/audio_*.test.js tests/note_estimator_synthetic.test.js
  tests/companion_*.test.js tests/genre_classifier.test.js
  tests/detector_eval.test.mjs tests/genre_eval_harness.test.mjs
  tests/integration/audio_analysis_validation.test.mjs` → **291 tests, 291 pass,
  0 fail**.
- `git status` clean of audio/node_modules; only `datasets/genre_corpus_manifest.json`,
  `tools/genre_eval.mjs`, `tests/genre_eval_harness.test.mjs`, and the
  `datasets/README.md` + this report are added.

## 8. Deliverables

- `marsin_engine/tools/genre_eval.mjs` — reusable genre-eval harness.
- `marsin_engine/tests/genre_eval_harness.test.mjs` — CI guard.
- `marsin_engine/datasets/genre_corpus_manifest.json` — 60-track provenance.
- `marsin_engine/datasets/README.md` — corpus section added.
- `~/tmp/corpus_fetch/build_corpus.mjs` — scratch acquisition tool (not committed).
- This report.
