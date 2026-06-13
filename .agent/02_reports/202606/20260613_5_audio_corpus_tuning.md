# Audio Corpus Tuning — corpus-grounded signal + detector tuning

- **Branch:** `claude/audio-corpus-tuning-olcd6i` (based on the audio stack
  tip `claude/audio-analysis-validation` @ ecc92d9)
- **Date:** 2026-06-13
- **Scope:** assemble a real open-license audio corpus, build a virtual
  playa-mic degradation layer, and tune the two audio tracks — pattern-facing
  signal **feel** and structure **detector** accuracy — with every change
  backed by a measured number. Follows up the validation harness
  (`20260613_4_audio_analysis_validation.md`) which proved the plumbing but
  explicitly did NOT establish real-world behavior.
- **Replication skill:** `.agent/01_skills/06_audio_corpus_tuning.md`

---

## TL;DR

- Assembled a **110-track open-license corpus** in `~/tmp` (never committed):
  50 **MUSDB18** full tracks *with stems* (CC BY-NC-SA) + 60 **FMA-small
  Electronic** clips (assorted CC). Built reusable, unit-tested tooling under
  `marsin_engine/tests/integration/` to decode, mic-degrade, reference-label,
  and measure it.
- Built a **virtual playa mic** (`mic_model.mjs`): band-limit → capsule
  soft-clip → SNR-balanced pink/white/hum noise, at `clean`/`moderate`/`heavy`
  tiers (≈47/18/9 dB SNR). All tuning was measured through it, on BOTH
  synthetic and real audio.
- **Detector (Task E):** replaced the steady level-ratio drop edge with a
  true **windowed rate-of-change** edge and flipped the default. On the
  synthetic ground-truth set degraded through the mic, vs the originally
  shipped default: **precision 0.57 → 1.00, latency 139 → 56 ms, false
  positives halved**, recall 0.89 → 0.78 (a deliberate precision-over-recall
  trade). Meets/beats the research-memo priors (P 0.65-0.75, R 0.55-0.70,
  latency 150-500 ms).
- **Chain feel (Task C):** the pattern-facing low/mid/high/flux signals
  shipped GAIN-ONLY (flickery). Added per-signal smoothing LPFs and made the
  kick SUDDEN. Measured on miced real audio: micLow flicker **6.5 → 4.2 Hz**,
  micFlux **54.6 → 34.8 Hz**, kick decay **2334 → 464 ms**, pulse preserved.
- **Analyzer (Task D):** MEASURED, then deliberately **left at defaults** —
  raising `noiseGate` collapses detector recall at the typical mic tier (the
  detector reads the post-gate mirror), and mic noise causes zero false kicks
  at the default threshold. An honest "don't change it" outcome.
- Full suite green: **589** engine + **54** integration tests. A cold review
  agent caught a label-smoothing bug (zeroed envelope tail) which was fixed +
  guarded.

---

## 1. The corpus (Task A)

A turnkey "EDM + labeled drop-times + open license" corpus barely exists, so
one was assembled from two open sources, each with honestly-stated limits:

| Source | Tracks | License | What it's good for | Caveat |
|---|---|---|---|---|
| **MUSDB18** (Zenodo 1117372) | 50 (test set) | CC BY-NC-SA 4.0 | full-length arcs **with stems** (the stems-fed detector path) | singer-songwriter/rock/pop — near-constant energy, **few real drops** |
| **FMA small** Electronic (mdeff/fma) | 60 | assorted CC (Attribution / NC / SA) | real **Electronic** character | 30-second excerpts → a full drop arc is often outside the window |

110 tracks total; **42 carry ≥1 reference drop** (76 drops total). Manifest
(`~/tmp/corpus/built/manifest.json`) records per-track license + source URL +
genre + drop count. **No audio is committed** — only the tooling. License mix:
50 CC BY-NC-SA (MUSDB) + a spread of CC Attribution/NC/SA variants (FMA).

**What the dataset actually bought us (honest accounting).** Because no human
listened, the corpus's value was NOT a trustworthy accuracy number (that came
from the synthetic ground truth, §3). Its real value, strongest first:
(1) **chain-feel tuning on real miced audio** (§4 — the LPF cutoffs were
validated against real music's spectral jitter, not synthetic tones); (2)
**false-positive robustness** (§6 — spurious fires/min on real quiet clips,
which needs only "this clip has no drop", not exact drop times); (3) the
weak, caveated heuristic drop P/R. **The MUSDB stems** were decoded
(mixture + bass/drums/vocals/other) and used for independent stem-gated label
derivation + the harness `stemsPlan`, but because MUSDB is rock/pop with
near-constant energy the stems yielded **~0 structural drops** — so the 4.7 GB
of stems delivered less than hoped; their real worth was 50 full-length
*real-audio* tracks for feel/FP tuning. The FMA Electronic clips supplied the
EDM character.

### Label provenance — honest disclosure

**0 of the 110 tracks were listened to by a human in this study.** An
autonomous agent cannot hear audio, so the labels are **heuristic, not
human-verified**. `auto_label.mjs` is deliberately INDEPENDENT of the causal
detector it evaluates (to avoid circularity): **non-causal** (look-ahead — a
drop must STAY loud), **global-percentile / loud-reference** region
thresholds, and **stem-aware** on MUSDB (a drop must have bass+drums
engaging). Drops are coupled to SUSTAIN-region onsets so they're consistent
with the region track. Treat the real-corpus precision/recall as
*agreement-with-a-heuristic-reference*, not absolute accuracy. **This is why
the rigorous detector P/R/latency numbers below come from the SYNTHETIC
ground-truth set, and the real corpus is used for false-positive robustness +
chain feel.**

## 2. The virtual playa mic (Task B)

`mic_model.mjs` degrades any clip through the physical chain the playa mic
actually sees: speaker+air+distance **band-limit** → loud-room cheap-capsule
**soft-clip** → **SNR balance** (attenuate signal to a target SNR) → **pink**
room/crowd noise + **white** mic self-noise + optional **mains hum**.
Deterministic (seeded mulberry32). Tiers:

| Tier | target SNR | use |
|---|---|---|
| `clean` | ≈47 dB | near line-in sanity |
| `moderate` | 18 dB | the typical playa night (primary tuning target) |
| `heavy` | 9 dB | far/loud/windy worst case (graceful-degradation target) |

Verified: SNR tiers hit their dB targets on real + synthetic audio; the
synthetic labeled drop @8.0s still detects down to 9 dB SNR. *(Realism nit:
the SNR balance attenuates the signal, so heavy = noisier AND quieter —
realistic for distance, but tier severity mixes SNR and absolute level.)*

## 3. Detector accuracy (Task E) — the windowed drop edge

The shipped detector's drop edge was a **steady level ratio**
(`shortEnv/longEnv > dropEnergyJump`). With the long envelope's 10 s τ, a loud
body keeps that ratio satisfied for seconds, so it **re-fires every refractory
window** (the documented Phase-3 fidelity gap). Replaced with a **windowed
rate-of-change** edge (`dropEdgeMode:'windowed'`): the short envelope NOW vs
the short envelope `dropDeltaWindowMs` (400 ms) ago. A real drop is a fast
step; a plateau stops qualifying once the lagged value catches up, so it fires
**once per genuine edge** by construction.

### Measured on the SYNTHETIC ground-truth set, degraded through the mic (3 SNR tiers)

`node tests/integration/synthetic_accuracy.mjs` — positives stems-fed,
negatives mic-only:

| arm | P | R | mean latency | neg-control false fires | (tp/fp/fn) |
|---|---|---|---|---|---|
| `level2000` — **originally shipped** | 0.57 | 0.89 | 139 ms | 10 | (8/6/1) |
| `level3500` — level edge, new refractory | 1.00 | 0.89 | 139 ms | 7 | (8/0/1) |
| **`windowed` — NEW default** | **1.00** | **0.78** | **56 ms** | **5** | (7/0/2) |

Reading: the longer refractory alone (level2000→level3500) masks the in-body
re-fires that tanked precision (0.57→1.00). The **windowed edge then cuts
latency 139→56 ms (2.5×) and false fires 7→5**, de-bouncing by construction
rather than relying on the refractory window — at a deliberate recall cost
(0.89→0.78: a genuinely close second drop can land inside the 3.5 s
refractory). All three windowed metrics meet/beat the research-memo priors
(P 0.65-0.75, R 0.55-0.70, latency 150-500 ms).

**Product-default changes** (`lib/audio_structure_detector.js`
`DETECTOR_DEFAULTS`):
- `dropEdgeMode: 'level' → 'windowed'` (+ new `dropDeltaWindowMs: 400`)
- `eventRefractoryMs: 2000 → 3500`

Both are deliberate, measured, and **low-risk**: the structure detector is
`enabled:false` by default (opt-in), and `level` remains available as a live
config value. The new fields are registered live-tunable in `audio_config.js`
(`dropEdgeMode` string-enum, `dropDeltaWindowMs` numeric) with validators +
tests. An idea to also reset the rising-tracker on ceiling saturation was
**tried and removed** — it blocked BUILD entry and killed recall.

## 4. Chain feel (Task C) — smooth bands, sudden kick

The non-kick pattern signals shipped as a single GAIN op (no smoothing →
visible flicker on the lights). Appended a per-signal one-pole `lpf` and
retuned the kick to be SUDDEN (`lib/signal_post_processor.js` `DEFAULT_CHAINS`):

| signal | smoothing | character |
|---|---|---|
| micLow | lpf 3.5 Hz | sub/bass slow smooth pump |
| micMid | lpf 5.5 Hz | synths/vocals moderate |
| micHigh | lpf 10 Hz | hats/air livelier shimmer |
| micFlux | lpf 4.5 Hz | rising build-up glow |
| micKick | envelope release 180→**60 ms**, hold decay 120→**60 ms**, schmitt refractory 200→120 ms | **sudden**, crisp, no smear |
| stemsBass/Drums/Vocals | lpf 3.5 / 12 / 5 Hz | bass smooth, drums snappy, vocals smooth |

Measured before→after on a miced real track (`signal_metrics.mjs`, moderate
tier):

| signal | flicker (Hz) | pulse depth | note |
|---|---|---|---|
| micLow | 6.5 → **4.2** | 0.239 → 0.205 | smoother, pump preserved |
| micMid | 7.3 → **5.7** | 0.287 → 0.274 | |
| micHigh | 10.2 → **8.2** | 0.115 → 0.112 | |
| micFlux | 54.6 → **34.8** | 0.146 → 0.111 | big de-jitter |
| micKick | (decay **2334 → 464 ms**) | — | 5× more sudden, no smear |

This is feel-only: the detector reads the raw pre-chain mirrors, so these
chains do not affect detection.

## 5. Analyzer front-end (Task D) — measured, deliberately unchanged

Measured the analyzer's band output on a SILENT input degraded through each
mic tier (the noise floor the gate must exceed) vs a real loud track:

| | clean | moderate | heavy | real signal (p50) |
|---|---|---|---|---|
| micLow floor | 0.004 | 0.021 | 0.050 | 0.105-0.111 |
| micMid floor | 0.009 | 0.036 | 0.083 | 0.19 |
| micHigh floor | 0.029 | 0.081 | 0.163 | 0.16-0.20 |

`noiseGate` is **kept at 0.04**: at the typical (moderate) tier the low floor
(0.021) is already well under it. Raising it to chase the EXTREME heavy floor
(0.050) is **net negative** — because the detector reads the *post-gate*
`micLowRaw`, a 0.05 gate **collapses moderate-tier detector recall to 0.00**
(it eats the build-up energy) while the heavy-room residual is better handled
by the normalizer (AGC) op anyway. Kick `threshold` is **kept at 1.8**:
measurement showed **zero** false kicks from mic noise at 1.8 (the 50-110 Hz
band + EMA-relative onset test reject broadband noise); raising it only costs
real-kick sensitivity. An honest "the defaults are already right here"
outcome.

## 6. Real-corpus sweep — false-positive robustness + feel across SNR tiers

`node tests/integration/corpus_sweep.mjs --corpus … --modes mic-only` over the
110-track corpus, mic-only (the realistic file-replay case), 3 tiers, clips
truncated to 60 s. The `baseline` arm pins the OLD detector edge
(`level`/2000); the `detector`/`tuned` arms use the new `windowed`/3500.

| arm (detector) | drop P | drop R | latency | **FP/min** | struct agree | (tp/fp/fn) |
|---|---|---|---|---|---|---|
| `baseline` (level/2000) | 0.22 | 0.22 | 896 ms | **1.39** | 0.249 | (24/86/84) |
| `detector`/`tuned` (windowed/3500) | 0.05 | 0.04 | 460 ms | **0.87** | 0.175 | (4/75/104) |

**The clean, reliable signal here is FP/min on the genuinely-quiet clips:
windowed cuts spurious fires 1.39 → 0.87 /min (−37 %)** — the robustness win
that matters for the lights (don't false-trigger on ordinary music).

**The drop P/R columns are NOT a reliable accuracy measure and must not be
read as one** (this is exactly why §3's accuracy numbers come from the
synthetic ground truth). Two reasons: (1) the labels are heuristic
energy-lifts that include slow chorus/section entries which are not fast
"drops"; the windowed edge *correctly* ignores those gradual lifts, which
shows up as low "recall" against an over-inclusive reference. (2) On real
music's constant energy variation, any fire not within tolerance of a sparse
heuristic label counts as a "FP", inflating fp. The honest reading: windowed
fires **less overall** — clearly fewer false fires on quiet clips (good),
and fewer of the heuristic lifts (ambiguous without human verification, §9).

**Chain feel is NOT shown per-scenario here** (all arms report identical feel
numbers) because the tuned smoothing is now the PRODUCT DEFAULT, so the
sweep's `baseline` already carries it. The real before→after feel improvement
is the direct measurement in §4, taken before the default was changed.

## 7. What changed (product defaults) + justification

| File | Change | Justified by |
|---|---|---|
| `lib/audio_structure_detector.js` | `dropEdgeMode:'windowed'` (new windowed-delta edge + `dropDeltaWindowMs:400`); `eventRefractoryMs 2000→3500` | §3 — P 0.57→1.00, latency 139→56 ms, fewer false fires |
| `lib/signal_post_processor.js` | `DEFAULT_CHAINS`: per-signal smoothing LPFs + SUDDEN micKick | §4 — flicker down, pulse preserved, kick 5× snappier |
| `lib/audio_config.js` | register `dropEdgeMode` (enum) + `dropDeltaWindowMs` (numeric) live-tunable | the two new detector fields need to be patchable |
| `config.yaml` | (none — `noiseGate`/`kick` deliberately unchanged) | §5 — raising them is net negative |

Tests updated deliberately for the new defaults:
`audio_signals.test.js`, `signal_post_processor.test.js`,
`osc_listener.test.js`, `audio_config.test.js`,
`audio_analysis_validation.test.mjs`.

## 8. Reusable tooling added (all under `marsin_engine/tests/integration/`)

`audio_decode.mjs`, `mic_model.mjs` (+ `.test.mjs`), `auto_label.mjs` (+
`.test.mjs`), `corpus.mjs`, `corpus_build.mjs`, `corpus_relabel.mjs`,
`signal_metrics.mjs` (+ `.test.mjs`), `tuning_configs.mjs`, `corpus_sweep.mjs`,
`synthetic_accuracy.mjs`; harness extensions to `run_analysis.mjs` (per-signal
capture, chain/band/kick overrides). All fail-loud, imports-at-top,
snake_case, deterministic. The synthetic regression guard stays
dependency-free; the real-corpus arm needs `ffmpeg-static` (already a
dependency). Workflow documented in the replication skill (06).

## 9. Remaining gaps / what's still needed for show-readiness

- **Human-verified drop labels.** The real-corpus labels are heuristic. A
  hand-labeled subset (10-20 tracks) would convert the real-corpus P/R from
  "agreement with a heuristic" to a real accuracy number.
- **A true EDM-with-drops corpus.** MUSDB is not EDM; FMA clips are 30 s. A
  set of full-length CC big-room EDM tracks would exercise the
  breakdown→build→drop arc the detector is designed for.
- **On-playa mic calibration.** The mic model's tier constants are
  engineering estimates; one real capture from the installed mic + speakers
  would let us pin the tiers (and re-confirm the noiseGate decision) to the
  actual rig.
- **Close-spaced double drops.** The 3.5 s refractory can suppress a genuine
  second drop <3.5 s after the first; operators running drop-reactive looks on
  rapid-fire sequences can lower `eventRefractoryMs` live.
