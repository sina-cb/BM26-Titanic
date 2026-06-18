# Skill 06 — Audio corpus tuning (decode → mic-model → measure → tune)

**When to use:** you need to tune the in-engine audio analysis — the
pattern-facing signal *feel* (smooth bands / sudden kick) or the structure
**detector** (drop/build/sustain) — against REAL music heard through a
REAL playa microphone, and prove the change with numbers instead of vibes.

This skill documents the reusable harness under
`marsin_engine/tests/integration/` built during the 2026-06 corpus-tuning
pass (report `.agent/02_reports/202606/20260613_5_audio_corpus_tuning.md`).
**All audio lives in `~/tmp/` (gitignored) — never commit audio binaries.**

- **Datasets** (what/where/how to download): `marsin_engine/datasets/README.md`.
- **§9 is the step-by-step PER-SIGNAL recipe** — the part to follow when you
  want to (re)tune ANY signal (input gain / low / mid / high / kick / flux /
  stems) against the datasets. §0–§8 are the harness it builds on.

---

## Datasets we can use

Two open-license datasets feed the harness (decode → virtual-mic → analyzer →
metrics), plus a synthetic set. Full download/use/license detail lives in
`marsin_engine/datasets/README.md`; the download commands are in §2 below.

| Dataset | What it gives us | License | Best for | Caveat |
|---|---|---|---|---|
| **MUSDB18** (Zenodo `record/1117372`) | 150 full tracks with isolated **stems** (mixture + drums + bass + other + vocals) | CC BY-NC-SA 4.0 | the stems-fed detector path + full structural arcs | rock / pop / singer-songwriter, **not EDM** → near-constant energy, few real drops |
| **FMA small — Electronic** (`github.com/mdeff/fma`) | ~476 CC **Electronic** tracks (30 s excerpts) | per-track CC (recorded in the corpus manifest) | real EDM spectral character for chain-feel + a few in-window drops | 30 s excerpts → a full breakdown→drop arc is often outside the window |
| **Synthetic** (`synth_dataset.mjs`, no download) | labeled clips with **known ground truth** | n/a (generated) | rigorous drop **P/R/latency** (the real sets can't — sparse/heuristic labels) | not real audio — always cross-check feel on the real sets |

**Division of use:** real datasets → false-positive robustness + chain *feel*
on real miced audio; synthetic → rigorous drop accuracy. **Open follow-up:**
neither real set is a human-labeled EDM drop corpus — true drop accuracy still
needs one (see the report + the detector Notion task). Audio stays in
`~/tmp/corpus/` (gitignored); usage is non-commercial.

---

## 0. The two tuning tracks (keep them separate)

| Track | What it controls | Where it lives | How to measure |
|---|---|---|---|
| **Pattern feel** | what the LIGHTS react to (smooth low/mid/high, sudden kick) | `DEFAULT_CHAINS` in `audio/postproc/signal_post_processor.js` + `config.yaml audio.bands/kick` | `signal_metrics.mjs`: flicker Hz / pulse depth / kick attack+decay |
| **Detector accuracy** | drop/structure detection | `DETECTOR_DEFAULTS` in `audio/detector/audio_structure_detector.js` | drop P/R/latency + false-positives/min |

The detector reads the **raw pre-chain** mirrors (`micLowRaw`, `micFluxRaw`,
`stems*Raw`), so **chain tuning does NOT affect the detector.** This is the
single most important thing to keep straight.

---

## 1. Environment

Needs Node v22 + outbound net to the corpus hosts (Zenodo, GitHub, the FMA
SWITCH store). `ffmpeg-static` is already a marsin-engine dependency
(`npm install` fetches the binary). Confirm:

```bash
cd marsin_engine && npm install
node --test tests/integration/audio_analysis_validation.test.mjs   # 35 pass (synthetic guard)
```

## 2. Acquire the corpus (→ `~/tmp/corpus/`)

A turnkey "EDM + labeled drop-times + open license" corpus barely exists, so
we assemble one from two open sources (honest about each one's limits):

- **MUSDB18** (Zenodo `record/1117372`, CC BY-NC-SA) — full-length tracks
  **with stems** (mixture/drums/bass/other/vocals as `.stem.mp4`). High value
  for the stems-fed detector path + full structural arcs. Caveat: it is
  singer-songwriter/rock/pop, NOT EDM — most tracks have **no** big
  breakdown→drop energy lift (energy is near-constant), so few real drops.
- **FMA small** (`github.com/mdeff/fma` → `os.unil.cloud.switch.ch/fma/`,
  CC) — real **Electronic** tracks (476 in the `small` subset, all CC). Caveat:
  30-second excerpts, so a full drop arc is often outside the window.

```bash
# MUSDB18 (4.7 GB) + the 7-second STEMS sample (fast smoke):
curl -sL -o ~/tmp/corpus/musdb18_full.zip "https://zenodo.org/records/1117372/files/musdb18.zip?download=1"
unzip -q ~/tmp/corpus/musdb18_full.zip "test/*" -d ~/tmp/corpus/musdb_raw   # 50 test tracks
# FMA metadata (genre + license) then the audio:
curl -sL -o ~/tmp/corpus/fma_metadata.zip "https://os.unil.cloud.switch.ch/fma/fma_metadata.zip"   # 342 MB
curl -sL -o ~/tmp/corpus/fma_small.zip     "https://os.unil.cloud.switch.ch/fma/fma_small.zip"     # 7.2 GB
# filter tracks.csv to subset==small & genre_top==Electronic → fma_electronic.json,
# selective-unzip ~60 of those mp3s into ~/tmp/corpus/fma_raw, then DELETE the zips.
```

Disk is tight (~30 GB): extract the subsets you need, then `rm` the zips.

## 3. Decode + reference-label → corpus tree

```bash
node tests/integration/corpus_build.mjs \
  --musdb ~/tmp/corpus/musdb_raw/test \
  --fma   ~/tmp/corpus/fma_raw --fma-meta ~/tmp/corpus/fma_selected.json \
  --out   ~/tmp/corpus/built
```

This decodes every track to mono 44.1 kHz 16-bit (`audio_decode.mjs`), derives
**reference labels** (`auto_label.mjs`), and writes
`built/<name>/{mixture.wav, labels.json}` + `built/manifest.json`
(license/source/genre/drop-count per track). MUSDB stems are decoded to a
temp dir, used for the stem-gated labels, then discarded (only the mixture is
kept — the stem plan rides in `labels.json`).

**Label provenance — be honest.** Labels are HEURISTIC, not human-verified
(an agent can't listen). `auto_label.mjs` is deliberately INDEPENDENT of the
causal detector: it is non-causal (look-ahead — a drop must STAY loud),
percentile-based (global energy baselines), and stem-aware on MUSDB (a drop
must have bass+drums engaging). Drops are coupled to SUSTAIN-region onsets so
they're consistent with the region track. Re-label without re-decoding via
`corpus_relabel.mjs --jumpRatio …` to iterate sensitivity. Treat the
resulting P/R as agreement-with-a-heuristic-reference, not absolute accuracy.

## 4. The virtual playa mic (`mic_model.mjs`) — REQUIRED

The playa mic hears speakers through air + crowd + wind + cheap capsule, not
clean line-in. `applyMicModel(samples, sr, {tier})` degrades any clip:
band-limit → capsule soft-clip → SNR balance → pink room/crowd noise + white
self-noise + optional mains hum. Tiers `clean` / `moderate` / `heavy`
(≈47 / 18 / 9 dB SNR). Tune for **moderate** (typical) and verify graceful
degradation at **heavy**. This is what makes `noiseGate` + the normalizer
(AGC) op earn their keep. Always degrade BOTH synthetic and real audio
through this before drawing tuning conclusions.

## 5. Measure

```bash
# Rigorous detector accuracy (known ground truth, degraded through the mic):
node tests/integration/synthetic_accuracy.mjs            # level vs windowed, 3 tiers
# Real-corpus false-positive robustness + chain feel:
node tests/integration/corpus_sweep.mjs --corpus ~/tmp/corpus/built \
  --modes mic-only --maxSeconds 60 --out ~/tmp/corpus/sweep_real.json
```

`corpus_sweep` compares the SCENARIOS in `tuning_configs.mjs` (baseline /
feel / detector / tuned) side by side: drop P/R/latency on the drop-bearing
subset, **spurious drops/minute** on the zero-drop subset (the metric that
matters most — real music must not false-trigger the lights), structure
agreement, and chain feel (flicker/pulse/attack) at the moderate tier.

**Division of measurement (important):** the real corpus is drop-SPARSE and
its labels are heuristic, so use it for **false-positive robustness + feel**.
Use the **synthetic** set (`synthetic_accuracy.mjs`) for rigorous drop
**P/R/latency** — known ground truth, degraded through the same mic model.

## 6. Tune, with every change backed by a number

- **Chains (feel):** the non-kick signals shipped GAIN-ONLY (no smoothing →
  flicker). Add a one-pole `lpf` per signal (`tuning_configs.TUNED_CHAINS`):
  low ~3.5 Hz, mid ~5.5 Hz, high ~10 Hz, flux ~4.5 Hz; kick stays SUDDEN
  (short envelope release + tight schmitt + short hold decay). A/B without
  touching source via `runClip(clip, { chainsOverride })`.
- **Analyzer (`config.yaml`):** set `noiseGate` from the MEASURED miced noise
  floor (silent input → mic tier → analyzer with gate=0; gate just above the
  heavy low floor). The kick threshold only needs raising if mic noise
  false-fires kicks — MEASURE it (it didn't, at 1.8).
- **Detector:** the `dropEdgeMode:'windowed'` rate-of-change edge replaces the
  steady level ratio — fires ONCE per genuine drop instead of every
  refractory window in a loud body. Validate on synthetic + real before
  flipping `DETECTOR_DEFAULTS`, and update the regression test + this skill
  deliberately.

## 7. Hygiene

- Keep the synthetic regression green: `node --test tests/*.test.js` +
  `node --test tests/integration/audio_analysis_validation.test.mjs`.
- After any engine boot/test, restore state residue:
  `git restore marsin_engine/states/ simulation/` (NOT `config.yaml` if you
  intentionally changed `noiseGate` — check the diff).
- New tooling has deterministic unit guards: `mic_model.test.mjs`,
  `auto_label.test.mjs`, `signal_metrics.test.mjs` (no audio/network needed).

## 8. Module map (`marsin_engine/tests/integration/`)

| File | Role |
|---|---|
| `audio_decode.mjs` | ffmpeg-static decode (mp3/flac/`.stem.mp4`) → mono 44.1k WAV |
| `mic_model.mjs` | virtual playa-mic degradation (tiers: clean/moderate/heavy) |
| `auto_label.mjs` | non-causal heuristic reference labels (regions + drops) |
| `corpus_build.mjs` | CLI: decode + label a raw corpus → tree + manifest |
| `corpus_relabel.mjs` | CLI: re-label without re-decoding (iterate thresholds) |
| `corpus.mjs` | load the corpus tree into harness clip shape |
| `signal_metrics.mjs` | chain-feel metrics (flicker / pulse / attack / decay) |
| `tuning_configs.mjs` | the candidate scenarios (baseline / feel / detector / tuned) |
| `corpus_sweep.mjs` | CLI: run scenarios over the real corpus, report metrics |
| `synthetic_accuracy.mjs` | CLI: rigorous drop P/R/latency on synthetic + mic |
| `run_analysis.mjs` | the real analyzer+chain+detector wired like engine.js |
| `synth_dataset.mjs` / `wav_io.mjs` | synthetic labeled clips / pure-JS WAV codec |

---

## 9. Per-signal tuning recipes (step-by-step) — THE REPLICATION GUIDE

Every signal is tuned with the **same loop**, only the knobs + acceptance
metric change. Always measure through the **virtual mic** (`mic_model.mjs`,
`moderate` tier = typical), on BOTH a synthetic clip (known) and a few real
clips from the corpus (`marsin_engine/datasets/README.md`).

```
THE LOOP (per signal):
 1. pick clips: 1 synthetic (known shape) + 3–5 real corpus mixtures.
 2. degrade through applyMicModel(samples, sr, {tier:'moderate'}).
 3. push through runClip(...) → read rec.signals.<signal> (post) + *Raw (pre).
 4. measure with signal_metrics.signalFeel(series, hopMs, {...}).
 5. change ONE knob; A/B via runClip overrides (bands / kick / chainsOverride).
 6. accept when the metric hits the target AND the synthetic regression stays
    green AND it behaves across mic tiers (clean→heavy).
```

Two knob locations (keep straight): **analyzer front-end** (`config.yaml
audio.bands` / `audio.kick`, applied in `audio/analyzer/audio_analyzer.js`) vs
**post-processing chain** (`DEFAULT_CHAINS` in `audio/postproc/signal_post_processor.js`).
Patterns + meters see the chain output; the detector sees the raw analyzer
output. **`audio.bands.inputGain` is the software mic-preamp applied first.**

### 9.0 INPUT GAIN (software mic-preamp) — set this FIRST
- **Goal:** a quiet mic / line feed should drive the bands into a usable
  range (not pinned near 0, not clipping). Lifts low/mid/high/flux above the
  noise gate. Applied in `audio_analyzer._analyzeOnce` to the band energies
  before softCompress.
- **Knob:** `config.yaml audio.bands.inputGain` (default 1.0, range [0,64]);
  live-tunable from the iPad AUDIO strip (INPUT GAIN slider) or
  `PATCH /audio/config {bands:{inputGain}}`.
- **Procedure:** with the real mic/feed running, raise inputGain until
  `micLow/micMid/micHigh` sit roughly 0.2–0.8 on typical-loud passages
  (measure: `signalFeel(rec.signals.micLow).mean`). Verify silence stays near
  0 (the gate holds).
- **Note:** the KICK is a RATIO detector and is intentionally **decoupled**
  from inputGain (gain cancels in a ratio and would only lift the noise floor
  → phantom kicks). So input gain ≠ kick sensitivity.

### 9.1 LOW / MID / HIGH (FFT bands)
- **Goal:** smooth, dance-like, **low flicker** but a preserved beat **pulse**.
- **Knobs:** band edges `audio.bands.lowMaxHz` (200) / `midMaxHz` (4000);
  smoothing **LPF cutoff** in `DEFAULT_CHAINS` (`SMOOTHING_HZ`: low 3.5, mid
  5.5, high 10 Hz); envelope `attackMs/releaseMs`; `noiseGate`.
- **Measure:** `signalFeel(rec.signals.micLow, hopMs)` →
  `flickerHz` (LOWER = smoother), `pulseDepth` (KEEP it — smooth ≠ flat).
- **Targets (from the 2026-06 pass, on miced real audio):** micLow flicker
  ~4 Hz, mid ~5–6, high ~8–10, pulse depth preserved vs the gain-only baseline.
- **noiseGate:** set from the MEASURED floor — feed a SILENT clip through the
  mic tier into the analyzer with `noiseGate:0`, read the band p95; set the
  gate just above the moderate-tier floor (raising it too far starves the
  detector — see report §Task D, why 0.04 was kept).

### 9.2 KICK (transient trigger)
- **Goal:** fires on real kicks, **never on silence/noise**, and is a crisp
  **PULSE** (no staying high).
- **Design (don't break):** the kick prominence is the LINEAR energy ratio
  `kickLin > _kickEma·threshold`, with `kickGated>0` (softCompress+gate) as a
  **silence floor only**, computed on RAW energy (decoupled from inputGain).
  This makes it gain-invariant + saturation-free.
- **Knobs:** `audio.kick.threshold` (1.8 — raise to reject noise variance,
  lower for more sensitivity), `minHz/maxHz` (50–110), `refractoryMs` (140),
  `decayMs` (70 — shorter = crisper pulse). Chain shape: `micKick`
  envelope/schmitt/hold in `DEFAULT_CHAINS` (short release + short hold = sudden).
- **Measure (functional, no labels needed):** run a clip, count fresh fires
  (`rec.signals.micKick >= 0.999`); on a **noise-floor** clip (low-amp white
  noise) at several inputGains the count MUST be 0 (regression:
  `audio_analyzer.test.js` "kick does NOT fire on a noisy room floor"). On a
  real kick-drum clip, ~2–4 events/sec is sane.
- **Acceptance:** 0 false kicks on room noise at any inputGain; fires on real
  kicks; the POST kick drops back to ~0 between hits (a pulse).

### 9.3 FLUX (spectral-flux / build glow)
- **Goal:** a gentle rising "glow" on build-ups, no flicker.
- **Knobs:** smoothing LPF in `DEFAULT_CHAINS.micFlux` (~4.5 Hz). Flux IS
  coupled to inputGain (it's a display/build signal, unlike the kick).
- **Measure:** `signalFeel(rec.signals.micFlux).flickerHz` (de-jitter it; the
  raw flux is very jittery — 2026-06 got it 54→35 Hz) while keeping pulseDepth.

### 9.4 STEMS (bass / drums / vocals — OSC sidecar, when present)
- Per-character chain smoothing in `DEFAULT_CHAINS`: bass smooth (~3.5 Hz),
  drums snappy (~12 Hz), vocals smooth (~5 Hz). Same `signalFeel` measure.
  Only live when the OSC stem sidecar feeds the engine.

### 9.5 STRUCTURE DETECTOR (drop/build/sustain) — DEFERRED, under development
- Currently **disabled by default + locked in the UI** ("under development").
- Tuning recipe + open work live in the Notion task ("Audio structure detector
  — tune to reliable, then re-enable") and report §3/§9. Measure with
  `synthetic_accuracy.mjs` (rigorous P/R/latency on known ground truth) +
  `corpus_sweep.mjs` (false-positive/min on real). Needs a real labeled EDM
  corpus + a human listening pass before re-enabling.

### Applying the result — defaults vs SHOW SCENES (read before you celebrate)
The engine boots `config.yaml` < `states/<model>/audio_state.yaml`, and loads
each scene's `chains:` over `DEFAULT_CHAINS`. The committed `titanic` /
`test_bench` scenes pin their OWN `bands` / `kick` / `chains`, which **shadow
the tuned defaults**. So tuning the defaults does NOT change the show scenes
unless you ALSO migrate the scene `audio_state.yaml` (or "Reset to defaults"
in the iPad Audio tab for that scene). Always confirm which config the running
model actually uses.
