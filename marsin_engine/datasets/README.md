# Audio datasets — what we use, how to get them, how to use them

These are the open-license audio datasets the **audio-analysis tuning** work
uses (signal-chain feel + the drop/structure detector). They feed the
integration harness under `marsin_engine/tests/integration/` (decode →
virtual-mic → analyzer → metrics). Full workflow:
`.agent/01_skills/06_audio_corpus_tuning.md`; results:
`.agent/02_reports/202606/20260613_5_audio_corpus_tuning.md`.

> ⚠️ **Audio is NEVER committed.** All downloads + decoded WAVs live in
> `~/tmp/corpus/` (gitignored). This directory holds **only docs** — no
> audio binaries, no zips. Each dataset is non-commercial / CC; keep it that
> way (research/tuning use only).

---

## The two datasets we use

| Dataset | What it gives us | License | Why we use it | Caveat |
|---|---|---|---|---|
| **MUSDB18** | 150 full-length tracks, each with **isolated stems** (mixture + drums + bass + other + vocals) | CC BY-NC-SA 4.0 (research / non-commercial) | Real full-length audio with **ground-truth stems** — exercises the stems-fed detector path + gives full structural arcs | It's singer-songwriter / rock / pop, **not EDM** → near-constant energy, very few real "drops" |
| **FMA small — Electronic subset** | ~476 Creative-Commons **Electronic** tracks (30-second excerpts) | assorted CC (Attribution / NC / SA variants) | Real **EDM/electronic** spectral character for chain-feel tuning + a few in-window drops | 30 s excerpts → a full breakdown→drop arc is often outside the window |

**Honest takeaway** (from the report): the highest-value use was tuning the
signal-chain *feel* + false-positive robustness on **real miced audio** — not
drop accuracy (that came from synthetic ground truth). The MUSDB **stems**
under-delivered for drop-labeling because MUSDB isn't EDM. For real drop
accuracy you still need a **human-labeled EDM corpus** (open follow-up).

---

## 1. MUSDB18 (Zenodo)

- **Home / DOI:** <https://zenodo.org/records/1117372>
- **License:** CC BY-NC-SA 4.0 — non-commercial research use.
- **Format:** `.stem.mp4` — a single MP4 **container** per track holding 5
  pre-rendered audio streams (the stems are *in the file*; no source
  separation needed). Stream order: `0=mixture 1=drums 2=bass 3=other
  4=vocals` (per `sigsep/sigsep-mus-db` `mus.yaml`).

### Download

```bash
mkdir -p ~/tmp/corpus
# Full set (~4.7 GB, 150 tracks). Or grab just the 50-track test/ split.
curl -sL -o ~/tmp/corpus/musdb18_full.zip \
  "https://zenodo.org/records/1117372/files/musdb18.zip?download=1"
unzip -q ~/tmp/corpus/musdb18_full.zip "test/*" -d ~/tmp/corpus/musdb_raw   # 50 tracks
rm ~/tmp/corpus/musdb18_full.zip   # reclaim disk after extracting

# Tiny smoke option: the 7-second STEMS sample (~141 MB, 50 clips) —
# fast way to prove the decode→stems→analyze path.
curl -sL -o ~/tmp/corpus/musdb7.zip \
  "https://github.com/sigsep/sigsep-mus-db/releases/download/v0.4.0/MUSDB18-7-STEMS.zip"
```

### Use

A stem is extracted by selecting its audio stream — **container demux, not
separation**:

```bash
ffmpeg -i "track.stem.mp4" -map 0:a:2 -ac 1 -ar 44100 -c:a pcm_s16le bass.wav
#                                 ^^^ 0:a:2 = the bass stream
```

The harness does this for you (`tests/integration/audio_decode.mjs` →
`decodeStemMp4`), using the **`ffmpeg-static`** binary (already a
marsin-engine dependency — `npm install` fetches it; no system ffmpeg
needed).

## 2. FMA small — Electronic subset (Free Music Archive)

- **Home / code:** <https://github.com/mdeff/fma>
- **Audio + metadata host:** `os.unil.cloud.switch.ch/fma/`
- **License:** Creative Commons (per-track; `fma_metadata` carries the exact
  license string — we record it per track in the corpus manifest).
- **Format:** `fma_small` is 8,000 × 30-second MP3s, 8 balanced genres; we
  filter to **genre_top == "Electronic"** (~476 tracks).

### Download

```bash
# Metadata (genre + license per track) — ~342 MB:
curl -sL -o ~/tmp/corpus/fma_metadata.zip "https://os.unil.cloud.switch.ch/fma/fma_metadata.zip"
unzip -q ~/tmp/corpus/fma_metadata.zip -d ~/tmp/corpus/meta
# Audio — ~7.2 GB:
curl -sL -o ~/tmp/corpus/fma_small.zip "https://os.unil.cloud.switch.ch/fma/fma_small.zip"
```

### Use

1. Parse `meta/fma_metadata/tracks.csv` (a pandas multi-index CSV): keep rows
   where `set.subset == small` and `track.genre_top == Electronic`; record
   `track_id`, `track.license`, `track.title`.
2. A track lives at `fma_small/XXX/YYYYYY.mp3` where `YYYYYY` is the zero-
   padded 6-digit track id and `XXX` is its first 3 digits
   (e.g. id 14208 → `fma_small/014/014208.mp3`). Selectively `unzip` just the
   Electronic paths, then `rm` the 7 GB zip.
3. Decode each MP3 → mono 44.1 kHz 16-bit WAV
   (`audio_decode.mjs` → `decodeToMonoWav`).

---

## Build the corpus + run the tuning (after download)

```bash
cd marsin_engine
node tests/integration/corpus_build.mjs \
  --musdb ~/tmp/corpus/musdb_raw/test \
  --fma   ~/tmp/corpus/fma_raw --fma-meta ~/tmp/corpus/fma_selected.json \
  --out   ~/tmp/corpus/built          # decodes + reference-labels + writes manifest.json

node tests/integration/corpus_sweep.mjs --corpus ~/tmp/corpus/built --modes mic-only   # feel + FP metrics
node tests/integration/synthetic_accuracy.mjs                                          # rigorous drop P/R
```

`corpus_build.mjs` writes `~/tmp/corpus/built/<name>/{mixture.wav,labels.json}`
+ a `manifest.json` recording **per-track license + source URL + genre** so
provenance is never lost. Reference labels are **heuristic** (algorithmic,
not human-verified) — see the report's "Label provenance" note before
trusting drop precision/recall.

## Disk & etiquette

- Budget ~25-30 GB free for both full datasets; extract the subset you need
  then delete the zips (the commands above do this).
- Re-decoding is cheap; iterate labels without re-decoding via
  `corpus_relabel.mjs`.
- Keep usage **non-commercial** (both datasets require it / are CC). Don't
  redistribute the audio; don't commit it.

## Genre detection — datasets used (2026-06-20, dev/genre_signals)

The party-mode genre classifier (`audio/signals/genre_classifier.js`) was
developed and validated **offline against deterministic synthetic profiles**,
NOT a fetched audio corpus. Rationale: this datacenter IP is bot-gated for
YouTube/streaming audio (documented in report 20260616_1 §7), and the operator
offered SoundCloud/Spotify creds that are not reachable here. The classifier is
driven entirely from already-derived signals (BPM, kick density/regularity,
band balance + high-band variance, note-change rate), so genre-characteristic
**signal scenarios** are a faithful tuning/validation surface.

Datasets / fixtures used:
- **Synthetic genre scenarios** (`tests/genre_classifier.test.js`): per-genre
  raw-signal profiles (techno / tech_house / house / downtempo …) constructed
  from the musical priors in the classifier header. Deterministic, committed.
- **`chord_progression` synth** (`audio/synth/test_synths.js`, new): a
  bass-rooted 4-chord walk with clear NOTE CHANGES, used to validate the
  note→colour cue (`audioSwitchColor`) end-to-end through the real analyzer.
- The classifier's per-genre PROFILE vectors were tuned against the real
  `AudioAnalyzer`'s measured feature vectors on these synthetic tracks (see the
  PROFILE TUNING NOTE in `genre_classifier.js`).

**Follow-up (needs un-gated network):** re-tune the genre profiles against real
labelled audio per genre (e.g. a CC dance-music set, or the operator's
SoundCloud/Spotify on a residential IP). The synthetic profiles are a solid
v1 but real-audio tuning is the path to field-grade accuracy.

## Real CC dance-music genre corpus (2026-06-20, dev/audio_corpus_real)

The follow-up above is now **DONE for acquisition**: network audio fetch works
from this environment, so we built a **real, genre-labelled, Creative-Commons
dance-music corpus** from **archive.org** netlabel/electronic collections and
stood up a reusable **genre-eval harness** to score the classifier on it.

- **Source:** `https://archive.org` — searched per genre via the advancedsearch
  API (`subject:(<genre>) AND mediatype:(audio) AND licenseurl:(*creativecommons*)`,
  sorted by downloads), picked one audio file per item from
  `/metadata/<id>`, downloaded from `/download/<id>/<file>`.
- **Size:** **60 tracks, 6 per genre**, across **10 genres**: the 6 canonical
  classifier genres (`techno`, `deep_house`, `melodic_house`, `tech_house`,
  `melodic_techno`, `downtempo`) **plus 4 Burning-Man extras** (`house`,
  `psytrance`, `drum_and_bass`, `progressive`) decoded but reported as
  out-of-vocab (the classifier can only emit the 6 canonical genres).
- **Processing:** each track trimmed to **60 s** (skipping the first 30 s to
  avoid quiet intros) and decoded to **mono 44.1 kHz 16-bit WAV** with the
  `ffmpeg-static` binary (same path the production file-replay decode uses).
- **Licenses:** all Creative Commons (mix of CC0/public-domain-mark, CC-BY,
  CC-BY-SA, CC-BY-NC, CC-BY-NC-ND). The **exact per-track license + identifier
  + title + source URL** is recorded in
  `datasets/genre_corpus_manifest.json` (committed; small). Use is **offline
  analysis/tuning only** — the audio is never committed, never redistributed,
  and no derivative work is distributed (so the ND tracks are fine for this).

> ⚠️ Audio stays in **`~/tmp/genre_corpus/<genre>/<id>.wav`** (gitignored).
> Only the manifest is committed.

### Rebuild the corpus

The fetch script is scratch (it lives in `~/tmp`, not the tree). To re-acquire
(identifiers may rotate on archive.org — the manifest pins what we used):

```bash
# scratch fetch tool: ~/tmp/corpus_fetch/build_corpus.mjs
node ~/tmp/corpus_fetch/build_corpus.mjs   # → ~/tmp/genre_corpus/<genre>/*.wav
cp ~/tmp/genre_corpus_manifest.json marsin_engine/datasets/genre_corpus_manifest.json
```

### Evaluate the genre classifier on it

`tools/genre_eval.mjs` runs each corpus WAV through the **REAL** engine audio
chain (AudioAnalyzer → SignalPostProcessor → AudioStructureDetector →
DerivedSignals), forces party mode on, collects the published `audioGenre`
(tail majority vote), and scores it vs the folder label — printing a confusion
matrix, per-genre accuracy, overall accuracy, and the **measured per-genre
feature centroids** the classifier reads (for re-tuning the PROFILES).

```bash
cd marsin_engine
node tools/genre_eval.mjs                       # default corpus ~/tmp/genre_corpus, fft 1024
node tools/genre_eval.mjs --corpus <dir> --fft 2048 --json
node tools/genre_eval.mjs --no-force-party      # also require the real party gate to fire
node --test tests/genre_eval_harness.test.mjs   # CI guard (synthetic, no real-audio dep)
```

**Baseline (fftSize 1024, the shipped value):** **8/36 = 22.2%** overall on the
6 scored genres (vs ~17% chance). Per-genre: downtempo 50%, techno 33%,
tech_house 33%, deep_house 17%, melodic_house 0%, melodic_techno 0%. The
classifier collapses most house/techno-family tracks onto **techno/tech_house**
and **never emits melodic_house or melodic_techno**. See report
`.agent/02_reports/202606/20260620_13_real_genre_corpus.md` for the confusion
matrix, the measured feature centroids, and concrete PROFILE-tuning suggestions
for the sibling that owns `genre_classifier.js`.

**Corpus caveats (real-world noise, documented honestly):** a few archive.org
items are mis-tagged at the source (e.g. some `house` hits are spoken-word/
LibriVox), and `melodic_house`/`progressive` are dominated by a single netlabel
artist (Prototype 202), so within-genre diversity is uneven. The numbers are a
real, reproducible **lower bound** on field accuracy, not a polished benchmark —
treat genre labels as the uploader's subject tags, not expert annotation.
