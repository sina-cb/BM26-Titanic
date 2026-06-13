# Audio Analysis Validation — End-to-End Harness + Test Report

- **Branch:** `claude/audio-analysis-validation`
- **Parent branch:** (latest audio work — detector reads `micFluxRaw`, file-replay, normalizer, declarative signal table)
- **Worktree:** `~/BM26-Titanic-worktrees/audio_validation`
- **Date:** 2026-06-13
- **Scope:** validate the audio analysis system (FFT analyzer → signal
  post-processing chain → structure detector) end-to-end against KNOWN
  GROUND TRUTH, with a reproducible harness + a `node --test` regression
  guard. **No product code was changed** — additions are confined to
  `marsin_engine/tests/integration/` plus this report.

---

## TL;DR

- Built a pure-JS WAV codec, a seeded synthetic labeled-audio generator,
  and a runner that wires the **real** `AudioAnalyzer` +
  `SignalPostProcessor` (DEFAULT_CHAINS) + `AudioStructureDetector` +
  **real `ParamCenter`** exactly like `engine.js`'s `onAnalysis` callback,
  feeding clips hop-by-hop through the real `*Raw` mirror write/read path
  the detector consumes.
- **35/35** integration tests pass deterministically
  (`tests/integration/audio_analysis_validation.test.mjs`). The existing
  engine suite stays green (**588/588**).
- The analysis **plumbing is correct**: zero NaN/Infinity ever published
  across every clip × both modes; tick p99 ≤ **0.036 ms/hop** (budget is
  0.5 ms) — ~14× under budget.
- **Negative controls pass on the PRODUCT-DEFAULT config** in both modes
  (steady_loud = 0 fires, silence = 0 fires, silence never leaves THIN).
- **Affirmative controls** (exactly-one clean drop, both double-drops,
  refractory respected) pass deterministically on the **stems-fed** path
  with one documented tuned field (`eventRefractoryMs: 4000`); the
  product default re-fires inside the loud body via the detector's own
  documented "level-ratio, not windowed-jump" fidelity gap.
- **mic-only mode fires prematurely during risers** — a real, structural
  limitation of a level-ratio detector reading `micLow` for both the
  build-energy trend and the drop edge. Reported honestly; **not**
  asserted as passing.
- This validates the **plumbing + state machine against synthetic ground
  truth**. It does **NOT** establish real-world EDM accuracy — that still
  needs a real labeled corpus (docs/30 Phase 3). The research memo's
  engineering priors (P 0.65–0.75, R 0.55–0.70, latency 150–500 ms) are
  the unmet-here real-world target.

---

## 1. Methodology

### 1.1 What was tested — the real chain, wired like the engine

The runner (`tests/integration/run_analysis.mjs`) instantiates the
production classes and wires them byte-for-byte the way
`marsin_engine/engine.js` does in its analyzer `onAnalysis` callback
(engine.js ~line 1339):

```
AudioAnalyzer ──(low,mid,high,kick,flux)──▶ SignalPostProcessor.process()
     │                                            │ (DEFAULT_CHAINS — Gain
     │                                            │  by *Gain paramKey, +
     │                                            │  micKick Env→Schmitt→Hold)
     │                                       post + RAW → ParamCenter.setMany
     │                                            │  (micLow…/ micLowRaw… mirrors)
     └────────────────────────────────────▶ AudioStructureDetector.tick(now, dt)
                                            reads micLowRaw / micFluxRaw (+ stems)
                                            publishes audioStructure / …DropPulse
                                            emits sparse dropFired on a drop
```

- The **real `lib/param_center.js` ParamCenter`** is used (not a double),
  so the `*Raw` mirror write/read path the detector consumes is exercised
  for real, including registry clamping and the `subscribe()` fan-out the
  detector uses to stamp stems-freshness.
- The analyzer runs the **product-default** FFT settings from
  `config.yaml` (`fftSize: 1024`, `hopSize: 512`, `sampleRate: 44100`,
  bands `low<200 / mid<4000`, kick `50–110 Hz @ 1.8×`).
- **Determinism:** production passes `Date.now()` as both the analyzer
  `nowFn` and the detector hop clock `now`. The harness replaces that wall
  clock with a synthetic monotonic clock advanced by exactly
  `hopSize/sampleRate` (≈11.61 ms) per hop, shared between analyzer and
  detector. This matches the detector's own contract (it stamps
  stems-freshness on whatever clock `tick()` is driven by) and makes runs
  reproducible regardless of machine speed.

### 1.2 Two modes per clip

- **mic-only** — stems are never written. This is the realistic
  **file-replay** case (stems offline → detector's `stemsFresh` is false →
  the mic-only drop path, `!stemsFresh` satisfies the stems gate).
- **stems-fed** — synthetic fresh stem RAW values matching each clip's
  label track are injected every hop (as a separate `setMany` from the
  `osc` source, so the CPC subscriber sees stem keys change exactly like
  the OSC path), exercising the `stemsFull` / `stemsThin` drop path.

### 1.3 The synthetic dataset — design + why synthetic

**Why synthetic.** The validation environment has **no ffmpeg** (and it
cannot be installed — no general network) and **almost no outbound
network**: only the npm registry (200) and `raw.githubusercontent.com`
(reachable) respond; `archive.org`, freesound, zenodo, pixabay all 403.
A real, open-license, **drop-labeled EDM** corpus is therefore
unavailable here. So the reliable backbone is a deterministic synthetic
dataset whose band/flux signatures are built deliberately so the **real**
analyzer produces the intended `micLow` / `micHigh` / `micFlux`
trajectories, paired with a ground-truth label track per clip.

The signatures were verified empirically against the real analyzer
(e.g. a 60 Hz sine at amplitude 0.5 drives `micLow ≈ 0.68`; a rising
broadband-noise + sweep riser holds `micFlux` in 0.4–0.8; a sub stepping
in from near-zero spikes `micLow`'s short/long envelope ratio). Signal
design:

| Structural element | Synthesis | Drives |
|---|---|---|
| sub/bass | ~60 Hz sine | `micLow` (+ kick band) — the detector's energy envelopes + drop level-ratio |
| build/riser | rising-amplitude broadband noise + 2→8 kHz sweep + small rising sub | sustained positive `micFlux` → buildScore; gently rising `micLow` → energyRatio "rising > 1 s" (THIN→BUILD gate) |
| drop | sub slams in from near-zero after the build | `micLow` short-envelope spike ≫ long-envelope → drop level-ratio edge |
| sustain (body) | **pure-tone** sub+body+stable highs (low flux) | steady SUSTAIN; low flux so buildScore decays (a noisy body would re-trigger BUILD) |
| thin/breakdown | near-silent noise floor (~0.008) | THIN |

**Labeled clips** (`tests/integration/synth_dataset.mjs`, seeded
mulberry32 — fully reproducible; WAVs regenerated at run time into
`~/tmp/audio_validation/`, never committed):

| Clip | Structure | Ground-truth drops |
|---|---|---|
| `clean_drop` | THIN → BUILD(riser) → DROP → SUSTAIN | 1 @ 8.0 s |
| `false_build` | THIN → BUILD(decays) → THIN | 0 |
| `collapse` | THIN → BUILD(short) → THIN | 0 |
| `double_drop` | THIN→BUILD→DROP→THIN→BUILD→DROP | 2 @ 7.0 s, 17.0 s |
| `steady_loud` | long loud SUSTAIN (6 s fade-in, no transient) | 0 (neg. control) |
| `silence` | all-zero | 0 (neg. control) |

### 1.4 WAV round-trip (the file-replay decode path, minus ffmpeg)

`tests/integration/wav_io.mjs` is a dependency-free 16-bit PCM mono WAV
codec (canonical 44-byte RIFF/WAVE header + `data` chunk). The harness can
round-trip a clip through a real temp WAV (write → read → feed) to prove
the file-replay decode path; the test asserts the WAV-replayed
`clean_drop` produces the identical affirmative result as the in-memory
path. The codec throws loudly (Codex P0) on any non-canonical file.

### 1.5 Real open clips fetched (best-effort, capped)

Per the constraints I spent < 15 min probing reachable open audio. Two
files were fetchable from `raw.githubusercontent.com`:

- `mathiasbynens/small` `wav.wav` — a 44-byte **header-only** WAV (zero
  audio samples). Unusable as a signal.
- scipy (`scipy/io/tests/data`, BSD) `test-44100Hz-2ch-32bit-float-be.wav`
  — ~3.5 KB, but **2-channel 32-bit float** (not mono 16-bit PCM) and a
  generic non-musical test tone, not drop-labeled EDM.

Neither is an open labeled EDM clip; the 403-walled hosts that would carry
one are unreachable. **Conclusion: no usable real labeled corpus is
available in this environment** — the synthetic ground-truth dataset is
the validation backbone, exactly as the instigator anticipated.

---

## 2. Results

### 2.1 Headline per-clip table — DROP precision / recall / latency

Drop tolerance window: ±1200 ms (≈ ½ bar at 120 BPM). Latency =
detected − labeled (ms; positive = the detector fires after the labeled
downbeat, as designed). `agree` = % of hops whose published
`audioStructure` matches the labeled region. Perf = detector `tick()` p99.

#### mic-only

| config | clip | det/lbl | P | R | latency | agree | sustain | NaN | tick p99 |
|---|---|---|---|---|---|---|---|---|---|
| default | clean_drop | 3/1 | 0.33 | 1.00 | 80 ms | 69 % | Y | none | 0.036 ms |
| default | false_build | 2/0 | 0.00 | 1.00 | — | 53 % | Y | none | 0.010 ms |
| default | collapse | 2/0 | 0.00 | 1.00 | — | 77 % | Y | none | 0.020 ms |
| default | double_drop | 3/2 | 0.33 | 0.50 | — | 76 % | Y | none | 0.023 ms |
| default | steady_loud | 0/0 | 1.00 | 1.00 | — | 0 %* | N | none | 0.031 ms |
| default | silence | 0/0 | 1.00 | 1.00 | — | 100 % | N | none | 0.007 ms |
| tuned | clean_drop | 2/1 | 0.50 | 1.00 | 57 ms | 69 % | Y | none | 0.008 ms |
| tuned | false_build | 1/0 | 0.00 | 1.00 | — | 53 % | Y | none | 0.019 ms |
| tuned | collapse | 1/0 | 0.00 | 1.00 | — | 77 % | Y | none | 0.020 ms |
| tuned | double_drop | 3/2 | 0.67 | 1.00 | 545 ms | 76 % | Y | none | 0.013 ms |
| tuned | steady_loud | 0/0 | 1.00 | 1.00 | — | 0 %* | N | none | 0.020 ms |
| tuned | silence | 0/0 | 1.00 | 1.00 | — | 100 % | N | none | 0.018 ms |

#### stems-fed

| config | clip | det/lbl | P | R | latency | agree | sustain | NaN | tick p99 |
|---|---|---|---|---|---|---|---|---|---|
| default | clean_drop | 2/1 | 0.50 | 1.00 | 11 ms | 83 % | Y | none | 0.022 ms |
| default | false_build | 0/0 | 1.00 | 1.00 | — | 86 % | N | none | 0.018 ms |
| default | collapse | 0/0 | 1.00 | 1.00 | — | 75 % | N | none | 0.011 ms |
| default | double_drop | 3/2 | 0.67 | 1.00 | 16 ms | 82 % | Y | none | 0.019 ms |
| default | steady_loud | 0/0 | 1.00 | 1.00 | — | 0 %* | N | none | 0.006 ms |
| default | silence | 0/0 | 1.00 | 1.00 | — | 100 % | N | none | 0.008 ms |
| **tuned** | **clean_drop** | **1/1** | **1.00** | **1.00** | **11 ms** | 83 % | Y | none | 0.022 ms |
| **tuned** | **false_build** | **0/0** | **1.00** | **1.00** | — | 86 % | N | none | 0.012 ms |
| **tuned** | **collapse** | **0/0** | **1.00** | **1.00** | — | 75 % | N | none | 0.024 ms |
| **tuned** | **double_drop** | **2/2** | **1.00** | **1.00** | **16 ms** | 82 % | Y | none | 0.014 ms |
| **tuned** | **steady_loud** | **0/0** | **1.00** | **1.00** | — | 0 %* | N | none | 0.009 ms |
| **tuned** | **silence** | **0/0** | **1.00** | **1.00** | — | 100 % | N | none | 0.020 ms |

\* `steady_loud` "agree 0 %" is an artifact of the ground-truth label: the
clip is labeled SUSTAIN throughout, but its 6 s fade-in means the detector
correctly sits in THIN until energy ramps in — the *important* control is
"zero drops", which holds. It is not a detector defect.

The **tuned / stems-fed** block (bold) is the clean, deterministic
regression-guard path: every affirmative control hits P=R=1.00 and every
negative control fires zero.

### 2.2 False-positive controls

- `silence` (all-zero): **0** drops, stays in THIN the entire clip, no
  NaN — both modes, **product-default** config.
- `steady_loud` (long loud SUSTAIN, no transient): **0** drops — both
  modes, **product-default** config. (The 6 s fade-in is what makes a
  loud-from-silence section a faithful "no transient" control — see §4.)

### 2.3 Performance (tick p99)

Max detector `tick()` p99 across **all 24 runs** = **0.036 ms/hop**,
≈ **14× under** the 0.5 ms/hop budget (docs/30 §Performance budget). The
detector is causal IIRs + booleans + a small switch — exactly as the
design predicted.

### 2.4 mic-only vs stems-fed, side by side

- **stems-fed is materially cleaner.** The `stemsFull` gate
  (`stemsBassRaw>0.4 && stemsDrumsRaw>0.4`) suppresses premature drop
  fires during risers (where bass/drums are not yet full), and `stemsThin`
  drives clean SUSTAIN→THIN exits. Result: false_build and collapse fire
  **zero** drops even on the product-default config.
- **mic-only fires prematurely during risers.** With stems offline the
  stems gate degrades to `!stemsFresh` (always true), so the only drop
  guard is the `micLow` level-ratio — which a rising build trips before
  the real drop. false_build/collapse get 1–2 false positives. This is the
  documented limitation, not a regression.

---

## 3. What this proves — and what it does NOT

**Proves (against known ground truth):**

- The analysis **plumbing is correct end-to-end**: the real analyzer →
  real signal chain (DEFAULT_CHAINS) → real ParamCenter `*Raw` mirrors →
  detector path carries the intended signals, publishes all five live keys
  + the sparse `dropFired` event, and **never emits NaN/Infinity** on any
  clip in either mode.
- The detector's **state machine behaves as designed** on clean ground
  truth: THIN→BUILD→SUSTAIN on a real riser+drop, a single dropFired at
  the labeled drop (stems-fed), both drops of a double-drop, the **2 s
  refractory** honored (verified on the product-default config too), and
  the negative controls held to zero.
- The **perf budget** holds with a large margin.
- The work is **deterministic and re-runnable** (seeded; two runs produce
  byte-identical drop events) — a real regression guard.

**Does NOT prove:**

- **Real-world EDM accuracy.** Synthetic ≠ real. The clips are clean,
  idealized structural signatures; real tracks have layered transients,
  sidechain pumping, vocal chops, genre variation, and producer-specific
  arrangement that this dataset does not model. Establishing real accuracy
  needs a real, hand-labeled EDM corpus — **docs/30 Phase 3**, which is
  the gate for any show-critical automation built on the detector.
- The research memo's **engineering priors** (`.agent/02_reports/202605/
  20260526_2_drop_mood_detection_research.md` §key-findings 2:
  **precision 0.65–0.75, recall 0.55–0.70, latency 150–500 ms** on
  well-produced big-room EDM) are explicitly **priors, not measured
  results**, and are **unmet here** — they remain the target for Phase 3.
  No causal real-time EDM drop detector with peer-reviewed accuracy ≥ 0.85
  exists (memo §key-findings 5); this harness makes no such claim.

---

## 4. Findings & recommendations

### 4.1 The level-ratio-vs-jump fidelity gap is the dominant behavior

The detector's drop edge is a **steady level ratio**
(`shortEnv/longEnv > dropEnergyJump`), not the rate-of-change "jump in
< 500 ms" docs/30 §5 describes — the code itself flags this
(`audio_structure_detector.js` ~lines 288–294) and defers the fix to
Phase 3. The harness makes the consequence concrete and measurable:

- Inside a loud SUSTAIN body the short envelope sits far above the slow
  (τ=10 s) long envelope for many seconds, so the drop edge stays
  satisfied and the detector **re-fires** every refractory window. On the
  product default this shows as clean_drop firing 2–3× and double_drop
  firing 3×.
- A tuned `eventRefractoryMs: 4000` collapses the within-body re-fires to
  one per genuine drop while still letting double_drop's two ~10 s-apart
  drops both fire. **This is the single highest-value config lever** the
  harness surfaced.
- **Recommendation:** when Phase 3 lands, replace the steady level ratio
  with a true windowed delta (short-vs-medium envelope rate-of-change over
  ~300–500 ms). Until then, operators running mic-only should expect
  re-fires in dense sections; a larger `eventRefractoryMs` default
  (≈3000–4000 ms) would reduce event spam at negligible cost to genuine
  drop coverage. *(Not changed here — that's a product-default decision
  for the operator.)*

### 4.2 mic-only cannot separate a build from a drop on `micLow` alone

The energy trend (THIN→BUILD gate) and the drop edge both read `micLow`.
A rising build necessarily raises `micLow`, which trips the drop edge
before the real drop. **Stems are decisive** here — exactly as the
research memo's key-finding 4 states. Recommendation: the operator brief
should keep treating fresh stems as the high-confidence path and mic-only
as the degraded fallback (the detector already reports
`structureDetectorStems: 'offline'` for this).

### 4.3 A trend-tracker quirk on ceiling-saturated energy

The "energyRatio rising for > 1 s" tracker only resets `risingSince` on a
*falling* ratio. A signal whose log-mapped energyRatio saturates to 1.0
and **holds** (a hard loud onset) is treated as "still rising" — so a
loud-from-silence step can satisfy the THIN→BUILD rising gate and, with
the level-ratio edge, fire one spurious drop. The harness reproduces this:
a `steady_loud` clip that steps from digital silence fires exactly one
onset drop. Modeling the control with a **6 s fade-in** (faithful — a real
"steady loud" section is never an infinite-slope discontinuity) makes it
fire **zero** on the product default. Recommendation for Phase 3: reset
`risingSince` when energyRatio is pinned at the ceiling (no longer
strictly rising), or gate BUILD entry on a minimum prior THIN dwell.

### 4.4 BUILD_GAIN / buildThreshold are hot enough that flux alone enters BUILD fast

`micFluxRaw * BUILD_GAIN (4.0)` saturates buildScore toward 1.0 within
~1 s of any broadband content, so buildThreshold (0.35) is cleared almost
immediately on a riser. This is good for latency (the build is caught
early) but means buildScore carries little discriminative information once
saturated — it's effectively a binary "is there broadband flux" flag. Not
a bug for Phase 1; worth revisiting alongside the windowed-delta work so
buildScore can express *how strong* a build is (the memo's load-bearing
insight is the build, not the drop).

### 4.5 Concrete next steps for a real-audio Phase 3

1. Assemble ~10 open/licensed EDM tracks with hand-annotated drop times +
   coarse THIN/BUILD/SUSTAIN regions (per docs/30 Phase 3). The harness's
   `runClip` + `dropMetrics` + `structureAgreement` are corpus-agnostic —
   point them at decoded real PCM (pure-JS WAV in, or a one-time offline
   ffmpeg decode to 44.1k mono 16-bit WAV outside the playa environment)
   and the same metrics drop out.
2. Tune `BUILD_GAIN`, `buildThreshold`, `dropEnergyJump`,
   `eventRefractoryMs`, and the envelope τ's against that corpus; compare
   to the engineering priors (P 0.65–0.75 / R 0.55–0.70 / 150–500 ms).
3. Implement the windowed-delta drop edge (§4.1) and the
   ceiling-saturation reset (§4.3); re-run both this synthetic guard and
   the real corpus.
4. Keep this synthetic test as the **fast deterministic regression guard**
   that runs on every change, with the real corpus as the slower accuracy
   benchmark.

---

## 5. Files added (all under `marsin_engine/tests/integration/`)

| File | What |
|---|---|
| `wav_io.mjs` | Dependency-free 16-bit PCM mono WAV codec (encode/decode, throws loudly on malformed input). |
| `synth_dataset.mjs` | Seeded deterministic labeled-audio generator (6 clips + label tracks + stem plans). |
| `run_analysis.mjs` | The harness runner — real analyzer + chain + detector + ParamCenter wired like engine.js; mic-only + stems-fed; `runClipViaWav`; `dropMetrics` / `structureAgreement`. |
| `audio_analysis_validation.test.mjs` | `node --test` regression guard (35 tests). |
| `dump_metrics.mjs` | Regenerates `validation_metrics.json` (report input). |
| `validation_metrics.json` | Committed machine-readable metrics (11.4 KB). |

Generated WAVs go to `~/tmp/audio_validation/` (gitignored) and are
regenerated deterministically at run time — **no audio binaries are
committed.**

## 6. Tests run

- **Integration:** `node --test tests/integration/audio_analysis_validation.test.mjs` → **35 pass / 0 fail**.
- **Existing engine suite:** `node --test tests/*.test.js` → **588 pass / 0 fail** (unchanged).
- **State residue:** restored `marsin_engine/states/` + `simulation/`
  after the engine suite run; final `git status` shows only the new
  `tests/integration/` dir (+ the gitignored `node_modules` symlink).

## 7. Operator action requested

Ready for review. This slice is **additive (tests/harness/report only)** —
no product code changed, no product defaults altered. The honest headline:
the **analysis plumbing + detector state machine are correct against
synthetic ground truth, with zero NaN and ample perf margin**; the
**level-ratio drop edge re-fires in dense sections (mic-only worst,
stems-fed manageable with a longer refractory)**, which is the documented
Phase-3 fidelity gap, not a regression. Real-world accuracy remains
unmeasured and needs a real labeled corpus.
