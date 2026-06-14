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
