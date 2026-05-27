# Research: Drop + Audio-Structure Detection for EDM with Our Signals

**Mode:** investigator — literature review with reality check
**Branch + commit reviewed:** `dev/summer_camp_readiness` @ `4b500ed`
**Engine boot:** no
**Duration:** ~1.5 h (literature + signal inventory) + expert review pass
**Revision note (2026-05-26):** folded in expert review. Renamed "mood detection" → **audio structure detection** throughout (the system infers THIN/BUILD/SUSTAIN states, not emotional mood). Relabeled unmeasured accuracy numbers as **engineering priors, not measured results**. Decoupled Phase 1 from the `docs/29` chain framework. Promoted stems freshness to a hard prerequisite. Replaced "dataset gates ship" with "dataset gates show-critical automation." Citation pass: added EDMFormer arXiv ID (2603.08759), demoted Zehren 2024 MDPI to "unverified," promoted Zehren et al. 2020 (arXiv:2007.08411) as the primary EDM switch-point reference, added arXiv:2407.06823 (Cue Point Estimation using Object Detection, 2024) as a prominent supporting citation.

---

## TL;DR

1. **The single highest-value detector is the *build-up*, not the drop itself.** Build-ups are causally observable, last several seconds, and their *end* is the drop. Detecting the build gives the operator a 2–8 s warning window so the rig can pre-arm a cue rather than reacting late. **This is the load-bearing insight of the whole memo; everything else is plumbing.**
2. **Structural drop detection is feasible at moderate reliability with our signals — but the numbers below are engineering priors, not measured results.** They set expectation boundaries before we collect our own dataset; they are NOT a performance claim. The proposed causal target with mic + tempo + stems is **roughly precision 0.65–0.75, recall 0.55–0.70, latency 150–500 ms** on well-produced "big-room/main-stage" EDM. Performance is expected to collapse on dubstep, drum'n'bass, hip-hop, and ambient.
3. **Audio-structure detection (region segmentation) is feasible at coarse granularity only.** A 3-class state machine — `THIN` (sparse: intro / breakdown / outro) → `BUILD` (rising) → `SUSTAIN` (full mix / post-drop) — is the smallest, most reliable target. Anything finer (verse vs. chorus, intro vs. outro) needs information we don't have at the audio bus layer (chord/harmony, vocals tracking across whole song, look-ahead).
4. **Stems are decisive *if fresh, low-latency, and timeout-protected.*** With healthy stems, the `bass-on + drums-on + vocals-low + sustained energy` boolean is the closest thing to a "free" drop heuristic in the literature. **If stems freeze, lag, or misclassify, the whole detector degrades** — packet loss, source-separator hiccups, or routing changes silently turn the detector into a worse-than-mic-only one. Stem freshness is a **hard prerequisite**, not a nice-to-have.
5. **There is no published causal real-time EDM drop detector with peer-reviewed accuracy ≥ 0.85.** Every paper that hits high F-scores (Yadati 2014, Zehren 2020, EDMFormer 2026, "Cue Point Estimation using Object Detection" 2024) operates offline with look-ahead, neural inference, and/or hand-annotated weak labels. Anyone selling "85% real-time drop detection" is selling.
6. **Ship gating, revised:** an *experimental, observe-only* `AudioStructureDetector` can ship sooner than the dataset arrives. The hard rule is the inverse — **no automatic show-critical behavior may rely on this detector** until it has been measured on a small labelled dataset. Manual override remains primary; the detector is a hint, never a fait accompli.

---

## Method

### Searches & sources actually read

WebSearch is denied in this environment, so this review used direct URL fetches against authoritative sources. The following loaded successfully and informed this report:

- **Wikipedia — "Drop (music)"** — definitional + production-side description of EDM structure and the build → break → drop arc. (`https://en.wikipedia.org/wiki/Drop_(music)`)
- **librosa onset / segmentation docs** — `librosa.onset.onset_strength` (spectral flux with Böck max-filter), `librosa.segment.recurrence_matrix` (Foote-style SSM and its non-causal nature). (`https://librosa.org/doc/latest/`)
- **Essentia streaming algorithm reference** — confirmed which novelty/onset/segmentation primitives are streaming-capable. Most notably `NoveltyCurve` (Grosche & Müller 2009), `SuperFluxNovelty`, `Flux`, `OnsetDetection`, `SBic`. Confirmed there is **no streaming "structure segmenter"** — only novelty + segmenter combos. (`https://essentia.upf.edu/algorithms_reference.html`)
- **NoveltyCurve algorithm page** — Grosche & Müller (2009), streaming, ~25–30 ms latency at 1024/2048 hop. (`https://essentia.upf.edu/reference/streaming_NoveltyCurve.html`)
- **madmom feature list** — streaming-capable beat tracking (`DBNBeatTracker online`), onset detection (Böck 2013 RNN), but **no online structure segmentation**. (`https://github.com/CPJKU/madmom`)
- **MSAF (Music Structure Analysis Framework, Nieto & Bello, ISMIR 2016)** — bundles Foote, SF, CNMF, OLDA, SCluster algorithms; **offline-only**, file-based API. (`https://github.com/urinieto/msaf`)
- **Mickael Zehren's github + Automix** — author of the EDM-specific switch-point work; his code is offline batch processing. (`https://github.com/mzehren/Automix`)
- **TouchDesigner CHOP docs** — `Audio_Spectrum_CHOP`, `Beat_CHOP` confirm the TouchDesigner ecosystem has **no built-in drop detection**; practitioners build it from band energy + lag + threshold combinations.
- **Lightjams** — commercial lighting controller; ships beat / phase / OSC / Ableton Link but **no drop or phrase detection**.

### Updated citations (verified or re-evaluated in this revision pass)

- **EDMFormer (2026) — NOW VERIFIABLE.** `arXiv:2603.08759` (submitted 2026-03-08). "EDMFormer: Genre-Specific Self-Supervised Learning for Music Structure Segmentation." Introduces the EDM-98 corpus (98 professionally annotated EDM tracks) and reports improved boundary detection + section labelling for drops/builds. **Offline neural, GPU inference; useful as a ceiling reference only.** The earlier draft of this memo said the arXiv ID could not be located — that gap is now closed.
- **Zehren et al. 2020 — PROMOTED TO PRIMARY EDM SWITCH-POINT REFERENCE.** `arXiv:2007.08411`. "Automatic Detection of Cue Points for DJ Mixing." Reports that ~96% of automatically generated switch points were judged "good for DJ mixes" by an expert panel. Offline batch. Most credible EDM-specific structural-cue paper that this memo can directly cite.
- **Zehren et al. 2024 (Signals MDPI) — DEMOTED TO UNVERIFIED.** The DOI `10.3390/signals5040040` could not be independently confirmed in this revision and the abstract claims used in the previous draft were derived from a search-engine snippet, not a direct read. **Treat as unverified pending operator confirmation;** rely on Zehren 2020 instead for any claim that needs to land.
- **NEW PROMINENT CITATION: "Cue Point Estimation using Object Detection" (2024).** `arXiv:2407.06823`. Frames cue-point detection as an *offline* object-detection problem trained on a much larger manually annotated cue-point dataset than prior work. Two things matter here: (a) the field is converging on cue-point detection as an offline, large-dataset, learned-model problem, and (b) the paper's framing reinforces the central conclusion of this memo — **do NOT promise causal 85%+ drop detection**, because even the offline SOTA needs large hand-labelled datasets to break that ceiling.

### Searches attempted but blocked / inaccessible

- MDPI (`signals5040040`, Zehren 2024) — 403 Forbidden via both WebFetch and curl with browser UA. Could not verify the DOI; flagged above as unverified.
- Yadati 2014 ISMIR paper (TU Delft) — 403 / 404 across the URLs tried. Methodology summarized from secondary mentions and the abstract that appeared in Scholar metadata.
- rekordbox phrase docs — all Pioneer support URLs tried returned 404; conclusions about rekordbox phrase mode are general-knowledge (Pioneer's "Phrase Analysis" feature, introduced ~2018, segments tracks into labelled phrases offline).

### Searches/sources NOT pursued (deliberate)

- Generic blog content from non-MIR sites — too easy to find hype, hard to verify.
- ML / deep learning pipelines (CNN, Transformer, RNN). The codex DNA forbids "magic from black boxes"; the engine has no inference runtime; and the operator wants something they can reason about during a 7-night show.

---

## Part 1 — Drop detection

### Approaches reviewed (with citations)

#### A1. Foote novelty score (self-similarity matrix + checkerboard kernel)

- **Source:** Jonathan Foote, "Automatic Audio Segmentation Using a Measure of Audio Novelty," *IEEE ICME 2000*. Implemented in MSAF (`urinieto/msaf`) and librosa (`librosa.segment.recurrence_matrix`).
- **Inputs:** frame-level feature sequence (commonly MFCC, chroma, or mel-spec) for the WHOLE track.
- **Algorithm:** build a self-similarity matrix `S[i,j] = sim(feat_i, feat_j)`; slide a Gaussian-tapered checkerboard kernel along the diagonal; peaks in the resulting "novelty curve" are section boundaries.
- **Latency:** **non-causal**. Kernel of half-width `L` needs `L` future frames at each position. Typical `L` for music structure: 2–8 s of look-ahead. Cannot be used as-is.
- **Reported accuracy:** general structural-segmentation F-scores on Beatles-style annotated corpora are ~0.5–0.7 at 3 s tolerance. Not EDM-specific.
- **Compute:** O(T²) memory and time for a full track.
- **Fit with our signals:** **POOR for real-time.** A sliding-window causal variant loses precision because the kernel can't "look across" the boundary. Could be useful as a secondary scoring signal running on a 4 s past window.

#### A2. Spectral flux / SuperFlux (Böck 2013)

- **Source:** Sebastian Böck, "Maximum Filter Vibrato Suppression for Onset Detection," DAFx 2013. Implemented in librosa (`onset.onset_strength`), Essentia (`SuperFluxNovelty`).
- **Inputs:** STFT magnitudes.
- **Algorithm:** `flux[t] = mean_f max(0, S[f, t] − ref[f, t − lag])` with max-filtered reference. Causal with `lag` ≈ 1–2 frames.
- **Latency:** ~25–30 ms at standard 2048/1024 hop, 44.1 kHz. Strictly causal.
- **Reported accuracy:** for **onset** detection, F ≈ 0.80–0.90 on MIREX onset corpora. For **structural boundary** detection it is much weaker — flux alone has no concept of "phrase length"; it fires on every snare hit too.
- **Fit with our signals:** **WE ALREADY HAVE THIS LATENT.** Our analyzer FFTs every hop but only emits `low/mid/high/kick` band envelopes. The `d/dt(micHigh)` of our existing `micHigh` envelope IS a coarse spectral-flux signal (collapsed to one band). **Build-up detection relies on this** — risers and snare rolls are large positive flux in the high band + flat-or-rising mid.

#### A3. Energy contour ratio (short-time vs. long-time)

- **Source:** classic audio engineering / DJ-tool heuristic; foundation of `cwitec`-style envelope analysis.
- **Inputs:** broadband or low-band RMS envelope.
- **Algorithm:** maintain a SHORT envelope (~200 ms) and a LONG envelope (~5–15 s); compute `ratio = short / long`. A `ratio` sudden jump from <0.6 to >1.2 over <1 s is a strong "energy increase" trigger.
- **Latency:** ~one short-envelope time-constant (~200 ms) once the long envelope has converged.
- **Reported accuracy:** no formal MIR numbers — this is a practitioner heuristic. Anecdotal: gets the obvious drops on big-room house at ~70% recall, lots of false positives on snare fills.
- **Fit with our signals:** **EXCELLENT.** Both envelopes can be derived from `micLow` and `stemsBass` directly. This is the single cheapest detector we could ship.

#### A4. Onset density change (rhythmic intensification)

- **Source:** standard MIR tatum/beat analysis. Implemented in madmom's `DBNBeatTracker` (online).
- **Algorithm:** count onsets per tatum / per beat over a sliding window; sudden jump (snare doubling from 2/bar to 8/bar, then 16/bar) = build-up; flat-after-jump = drop is imminent or has happened.
- **Fit with our signals:** **PARTIAL.** We don't run a snare onset detector. Probably not worth the engineering until the kick detector is healthy.

#### A5. Yadati et al. 2014 — content-based EDM drop detection (ISMIR)

- **Source:** Yadati, Larson, Liem, Hanjalic, "Detecting Drops in Electronic Dance Music," ISMIR 2014. Foundational reference.
- **Inputs:** MFCC, spectral centroid, spectral flux, RMS, MFCC deltas — frame-level over an entire track.
- **Algorithm:** classifier (SVM) trained on a labelled dataset of EDM tracks with timed SoundCloud comments as weak supervision for drop location.
- **Latency:** **non-causal — full track required.**
- **Fit with our signals:** **NO direct fit.** But the *feature set* (MFCC + flux + energy contour + their deltas) tells us where the signal lives. Their finding that energy contour + spectral flux deltas are among the top features supports detectors A2 + A3 above.

#### A6. Zehren et al. 2020 — Automatic Detection of Cue Points for DJ Mixing (primary EDM switch-point reference)

- **Source:** `arXiv:2007.08411`. Replaces the unverified Zehren 2024 MDPI citation as this memo's primary EDM-specific switch-point paper.
- **Inputs:** structural features over the whole track (harmonic/percussive separation, novelty, downbeat tracking).
- **Algorithm:** rule-based cue-point selection on top of MIR structural features; designed to feed an automatic DJ mixer.
- **Reported result:** **~96% of generated switch points judged "good for DJ mixes" by an expert panel.** Note this is "good switch points for mixing," NOT "drop time precision in seconds" — the metric is mix-musicality, not boundary-exactness.
- **Latency:** offline (file-based).
- **Fit with our signals:** **NO direct fit, but informative as the credible EDM ceiling.** Tells us: when an offline system can deeply analyze the whole track, it can pick switch points that *experts approve*; nothing close to that is available causally.

#### A6b. Zehren et al. 2024 (MDPI Signals) — UNVERIFIED

DOI `10.3390/signals5040040` could not be confirmed in this revision pass. Previous draft cited it as if confirmed; that was wrong. **Do not rely on it for any load-bearing claim.** Use the 2020 paper above instead.

#### A7. "Cue Point Estimation using Object Detection" (2024) — supporting citation

- **Source:** `arXiv:2407.06823`. Newly featured per the expert reviewer.
- **Inputs:** waveform / mel-spectrogram of full track.
- **Algorithm:** frames cue-point detection as an offline object-detection problem, trained on a substantially larger hand-annotated cue-point dataset than prior work.
- **Why it matters here:** reinforces the conclusion that **the SOTA for cue-point/drop detection requires (a) offline processing and (b) a large hand-labelled dataset.** Anyone implying causal real-time drop detection at 85%+ is ignoring the direction the actual research is moving.

#### A8. EDMFormer 2026 + Raveform 2026 (newest)

- **EDMFormer source:** `arXiv:2603.08759` (verified in this revision). Sajeer et al., "EDMFormer: Genre-Specific Self-Supervised Learning for Music Structure Segmentation."
- **Raveform source:** Kim et al., "Raveform: A Dataset of Metrical and Functional Structure Annotations for EDM Tracks in DJ Mixes," ISMIR 2026.
- **Inputs:** Transformer self-supervised on EDM corpus (EDM-98 for EDMFormer).
- **Latency:** offline.
- **Reported accuracy:** EDMFormer claims improvement on boundary detection and section labelling, particularly for drops, on the EDM-98 set.
- **Fit with our signals:** **NO.** The engine has no ML runtime. Useful only as a "ceiling" benchmark — the SOTA on EDM structure exists and is offline neural.

#### A9. Rekordbox / Serato / Traktor "phrase" features

- **Source:** Pioneer rekordbox "Phrase Analysis" (released ~2018, public marketing material; direct doc pages 404'd).
- **Algorithm:** proprietary, offline at import time.
- **DJ community consensus:** "useful but not perfectly trustworthy" — wrong on ~10–30% of EDM tracks, unusable on non-EDM genres.
- **Fit with our signals:** **NO direct fit.** Important context: **no commercial DJ tool ships causal real-time drop detection** that this review found.

#### A10. Tatum / downbeat-relative structural analysis

- **Source:** Klapuri, Goto, Böck downbeat work (e.g. madmom `DBNDownBeatTracker`).
- **Algorithm:** EDM is 4/4 with 4-bar (16 beat) and 8-bar (32 beat) phrase structure. Knowing "we are at bar N of an 8-bar phrase" lets you predict that a change will land on bar 8 boundary.
- **Latency:** beat tracker ~2 s causal lock; downbeat tracker similar.
- **Fit with our signals:** **MEDIUM.** We have `tempoBpm` from LX. If LX also emits downbeats (it does emit phase, depending on its analyzer config), we could maintain a bar counter and use it as a structural prior. This is **the most powerful prior we have access to** without new DSP.

### Recommended approach for our system

A **layered causal detector** that combines the three pieces we already have (energy contour, stems boolean, downbeat-relative timing) and emits one of three classes per analyzer tick. Pseudocode:

```
// per analyzer hop (86 Hz on mic, 30-60 Hz on stems)
// inputs: micLow, micHigh, stemsBass, stemsDrums, stemsVocals, tempoBpm, barPhase
// outputs: audioStructure ∈ {THIN, BUILD, SUSTAIN}, dropConfidence ∈ [0,1]

// 0. Stems freshness — HARD PREREQUISITE
// If stems haven't updated in > STEMS_TIMEOUT_MS (e.g. 300 ms),
// flag stems as stale and fall back to mic-only mode. Never trust
// a frozen stem value as a real reading.
stemsFresh = (now - stemsLastUpdateMs) < STEMS_TIMEOUT_MS

// 1. Short / long envelopes per signal (causal IIRs)
shortEnv.update(micLow, dt, tau=0.2s)
longEnv.update(micLow, dt, tau=10s)
energyRatio = shortEnv / max(longEnv, eps)        // >1 means "louder than recent baseline"

// 2. High-band rising flux (proxy for risers / snare rolls / sweeps)
highFlux = max(0, micHigh - micHighPrev)          // half-wave-rectified delta
buildScore = ema(highFlux, tau=2s)                // sustained high-band growth = build

// 3. Stems boolean (only when stemsFresh; otherwise booleans are "unknown")
stemsFull = stemsFresh && (stemsBass > 0.4) && (stemsDrums > 0.4)
stemsThin = stemsFresh && (stemsBass < 0.15) && (stemsDrums < 0.15)
vocalsHot = stemsFresh && (stemsVocals > 0.4)

// 4. Structural state machine, evaluated per hop
switch (audioStructure):
  SUSTAIN:                                        // full-mix steady state
    if energyRatio < 0.5 && stemsThin:
      → THIN
  THIN:                                           // sparse, low energy (intro/breakdown/outro)
    if buildScore > BUILD_THR && energyRatio rising:
      → BUILD
  BUILD:                                          // rising tension
    if (energyRatio jumps > 1.5x in < 0.5s)
       && stemsFull
       && (barPhase ≈ downbeat ± 200ms):
      → SUSTAIN                                   // ← drop landed
      emit dropFired(confidence = clip(buildScore × energyJump × stemsBoost, 0, 1))
    elif buildScore decaying for > 4s:
      → SUSTAIN                                   // false build, never dropped
```

The `barPhase ≈ downbeat` gate is what keeps false positives away — drops in produced EDM land on downbeats. Without that gate the detector fires on every cymbal crash.

If we DON'T have `barPhase` (LX doesn't always emit it), substitute a soft "recent-onset-density" gate: most build-ups end with a noticeable silence-then-bang of 1–2 hops, which the `energyRatio jumps > 1.5x` already captures.

### Accuracy estimate — engineering priors, not measured results

> **READ THIS FIRST.** The numbers below are **engineering priors set to bound expectations before we collect our own dataset**. They are not measured on the operator's corpus. They are derived from (a) Foote-novelty offline F-scores (~0.5–0.7), (b) practitioner consensus on rekordbox phrase accuracy (~70–90% on EDM, lower without look-ahead), and (c) the fundamental ceiling that any causal detector loses ~10–15% F-score vs. its non-causal counterpart. **Do not communicate these as performance claims to the operator.** They are the boundary inside which we expect our own measurements to fall — and the dataset will move them.

| Configuration | Prior precision | Prior recall | Latency | Notes |
|---|---|---|---|---|
| Mic-only (`micLow/Mid/High`), no stems, no bar | ~0.50–0.60 | ~0.45–0.55 | 300–500 ms | False-positive heavy on fills and crashes. Misses subtle drops with no kick. |
| Mic + fresh stems, no bar phase | ~0.65–0.75 | ~0.55–0.70 | 200–400 ms | Big-room/main-stage EDM. Stems disambiguate "drum fill" from "drop" *if fresh*. |
| Mic + fresh stems + bar phase | ~0.70–0.80 | ~0.60–0.75 | 150–300 ms | Adding the downbeat gate kills cymbal-crash false-fires. Best causal config we could build. |
| **Anyone selling > 0.85 causal** | — | — | — | They're either offline, look-ahead-using, or wrong. |

**Reminder on the latency framing:** ≤500 ms ≈ 1 bar at 120 BPM. A drop landing one bar after the music's drop is *invisible* to a human in a chaotic playa environment — they read it as "tight." A drop landing two bars after is "late." That is the budget we are coding to.

### Genre / context limitations — where it fails

- **Dubstep / wobble bass.** The "drop" is a bass texture change, not a kick onset. Energy contour barely moves; `stemsBass` may even drop slightly during the wob. Expected recall < 0.3.
- **Drum'n'bass.** Continuous high energy + relentless drums; the "drop" is an intensification of an already-dense mix. Almost no `energyRatio` jump. Expected recall < 0.4.
- **Trap / hip-hop.** Drops are often a bass-808 fall, not an energy explosion. Misses everything bass-centric.
- **Ambient / downtempo / chillwave.** No structural drops; detector will sporadically false-fire on any forte phrase.
- **Live mixed DJ sets.** Two tracks beat-matched means `stemsBass`/`stemsDrums` can be high through the whole transition; the contour ratio collapses. Expected recall halves.
- **Atypically produced tracks** (one-of-one experimental EDM, weird build-without-drop, anti-drop). Will fail unpredictably.

**Calibration to the playa:** the operator's playlist is the determining factor. If 80% of the night is main-stage/big-room/progressive house, this detector is useful. If it's a wide variety of genres, the operator needs the manual override more than the detector.

---

## Part 2 — Audio structure / region segmentation

### Terminology in the literature

What we previously called "mood / region / phase" — and now consistently call **audio structure** — MIR calls:

- **Structural segmentation** — partition the track into homogeneous sections.
- **Boundary detection** — find the time points where sections change. (Subset of segmentation.)
- **Section labelling** — assign a category (intro, verse, chorus, bridge…) to each section.
- **Novelty detection** — detect any acoustic novelty (boundary OR onset, depending on scale).
- **Switch point detection** — Zehren's EDM-specific term for transitions between structural sections (see Zehren 2020).
- **Functional structure** — the Raveform 2026 term for EDM-specific roles (intro, build, drop, breakdown, outro).

**Naming decision (revision):** the system does not infer emotional mood. It infers acoustic structural state. The CPC key is `audioStructure` (not `audioMood`); the section header here is "audio structure," not "mood." Every prior mention of "mood detection" is rewritten as "audio structure detection."

### Approaches reviewed

#### B1. Foote novelty for region change (offline)

Same algorithm as A1 above. For *region detection* (not drop instant), Foote-style F-scores on Beatles + RWC datasets are ~0.5–0.7 at 3 s tolerance — **and the playa-ready ceiling is lower than that because we're causal.**

#### B2. Recurrence-matrix structure features (Serrà et al., 2014; MSAF)

- **Source:** Serrà, Müller, Grosche, Arcos, "Unsupervised Music Structure Annotation by Time Series Structure Features and Segment Similarity," 2014. In MSAF as `SF`.
- **Latency:** offline.
- **Fit:** none for live. Mentioned only because it's the SOTA classical (pre-DL) structure detector at F ~0.55.

#### B3. Stems-boolean state machine (our own)

This is what the recommended detector in §1 already does — it implicitly labels regions:

- `stemsThin + low energyRatio` ≈ **THIN** (breakdown / intro / outro)
- `vocalsHot + thin instrumentation` ≈ **vocal section** (very common in pop-EDM)
- `buildScore rising` ≈ **BUILD** (build-up)
- `stemsFull + sustained` ≈ **SUSTAIN** (chorus / "main")

This is, frankly, the entire region-detection capability achievable with our signals. There is no causal-streaming way to distinguish **intro** from **outro** from **first drop's sustained** without long-context memory of where we are in the song — and we don't have that without "we've heard this part before" SSM logic, which needs the whole song.

#### B4. Vocal-presence classifier

`stemsVocals > threshold` (with `stemsFresh`) is a free 2-class problem the stems already solve. Vocal-prominent vs instrumental-prominent is the **most reliable section-style classification we can do**, period.

### Recommended classification granularity for our rig

**Three classes, derived from the same state machine as the drop detector:**

| Class | Detection rule (causal, our signals) | Lighting interpretation |
|---|---|---|
| **THIN** (breakdown / intro / outro) | `energyRatio < 0.5` AND `stemsBass < 0.15` AND `stemsDrums < 0.15` (stems must be fresh) | sparse / ambient / slow palette |
| **BUILD** (rising tension) | `buildScore > BUILD_THR` AND `dEnergy/dt > 0` for > 1 s | strobe-prep / colour-saturation ramp / increasing density |
| **SUSTAIN** (full mix / post-drop) | `stemsBass > 0.4` AND `stemsDrums > 0.4` AND `energyRatio > 0.8` (stems must be fresh) | full-blast / palette / scene main |

Plus a **vocals overlay flag** (`stemsVocals > 0.4` AND fresh) which is orthogonal to the above.

That's it. **Don't aim for finer.** Intro-vs-outro requires song-position memory. Verse-vs-chorus requires harmony + repetition. Neither is achievable causally with our signals at the per-tick scope.

### Accuracy estimate — engineering priors, not measured results

Same warning as §1: these are **bounds-setting priors**, not measurements.

| Classification | Prior accuracy | Comments |
|---|---|---|
| **THIN vs SUSTAIN** (2-class) | ~85–90% prior | Fresh stems are decisive; both states are stable, easy to detect. Priors only; not measured on our corpus. |
| **THIN vs BUILD vs SUSTAIN** (3-class) | ~70–80% prior | BUILD is the noisiest class because risers vs. fills look similar. Priors only. |
| **vocalsHot** (binary overlay) | ~85–95% prior | Stems give us this almost for free *if fresh*. Priors only. |
| **Drop instant** (event) | P/R ~0.65–0.75 prior | See §1 above. Priors only. |
| **Intro vs outro** (literature aspiration) | — | We can't. Need full-song context. |
| **Verse vs chorus** (literature aspiration) | — | We can't. Need harmonic memory. |

---

## Part 3 — Combined recommendation

### What to build, in what order — research vs. implementation are now clearly separated

**Research conclusion (this memo's job):**
- The 3-state structure detector is the right shape.
- Build-up detection is the load-bearing insight.
- Stems freshness is a hard prerequisite to the stems-aware path.
- Causal accuracy ceilings sit below offline SOTA, by an expected ~10–15 F-points.
- A small labelled dataset is required before any *show-critical automatic behavior* relies on this detector.

**Implementation decisions (live in `docs/30_[todo]_audio_structure_detector.md`, not here):**
- Detector module location, CPC key shape, WS routing, lifecycle wiring, iPad consumer hooks, phased delivery — all in the design doc.

This memo previously braided these together. The expert reviewer was right that this conflates "what does the literature support" with "how do we build it." Implementation decisions are now in the design doc; this memo restricts itself to research claims.

### Decoupling from the chain framework (`docs/29`)

The previous draft said the detector should wait for `docs/29`'s chain framework to land and run inside it as a "cross-signal derived" operator. **Reversed.** The existing CPC live params (`micLow/Mid/High/Kick`, `stemsBass/Drums/Vocals`, `tempoBpm`), the `/ws/signals` topic, and the iPad's `useLiveParamValues` hook are already enough to ship a small standalone `AudioStructureDetector` module that reads live params and publishes new ones. If the chain framework later lands, the detector's outputs *could* optionally feed it; the detector does not depend on it.

### Communication to the operator

Use this exact phrasing to set expectations (note: **engineering priors, not measured**):

> "We can build a 3-state audio-structure detector (THIN / BUILD / SUSTAIN) that we *expect* to get ~80% of EDM regions right based on engineering priors — but those are bounds, not measurements, until we test on our own dataset. We can also fire a drop event that we *expect* to catch roughly 60–70% of drops on main-stage EDM with about a quarter-second of latency. Both are expected to fail on dubstep, drum'n'bass, hip-hop, and anything ambient. Treat the detector as a hint to a cue, not a replacement for the cue — keep a manual fire button. Anything fancier (intro vs outro, verse vs chorus, full structural labelling) needs ML we don't ship and look-ahead we don't have."

### What NOT to promise

- "Auto-VJ that follows the song." We can't. We can fire structural triggers; we cannot interpret a song's narrative arc.
- "Drop detection in dubstep." The signal shape is wrong.
- "Phrase labelling like rekordbox." Rekordbox does it offline with a trained classifier and still gets it wrong 10–30% of the time.
- "Measured precision/recall." Until the dataset exists, every number in this memo is a prior, not a result.

---

## Coverage gaps

What I could not determine from desk research without prototyping:

1. **Verified accuracy numbers for Zehren 2024 MDPI.** Demoted to unverified in this revision. EDMFormer 2026 ID is now closed (arXiv:2603.08759); per-class F-scores still require the full-paper read someone has to do offline.
2. **What LX Studio actually emits via OSC for bar phase / downbeat.** I assumed `tempoBpm` only, since that's what we see in `osc_listener.js`. LX's beat-tracker may emit more under different OSC routes; an operator-side trace would resolve this in 5 minutes.
3. **The actual signal shapes on the operator's typical music corpus.** This entire report is theoretical. The single most valuable next step is **building a 60-second labelled test clip dataset** (10–20 EDM tracks, hand-annotated drop times) and running the proposed detector against it. Without that, every percent in this report is a prior, not a result. *Revised gating:* this dataset gates **show-critical automatic behavior**, not the existence of the detector itself.
4. **What the source-separation tool feeding `stems*` actually does and what its latency is.** "Local, not WiFi" is good but we don't know if it's introducing 200 ms+ of latency that would bite the drop-detection budget. A simple click test through the system would measure it. *Revision:* this is now load-bearing because the detector flips its behaviour based on stems freshness.
5. **Stem packet loss behaviour.** Concern 6 in `20260526_1_audio_analysis_report.md` notes that if a UDP packet is lost, the stem value freezes. The detector handles this with an explicit `stemsFresh` timeout (see pseudocode in §1) — but the actual timeout value (currently sketched at 300 ms) needs to be tuned against real packet-loss patterns.
6. **Compute headroom.** All math is O(1) per signal per tick; total budget is < 100 µs / tick. The design doc sets a hard ≤ 0.5 ms target per analyzer hop for the detector module so future changes can be measured against it.
7. **TouchDesigner / Notch / VVVV practitioner recipes.** Could not reach the active community threads (forum URLs 404'd). The detector design is derived from first-principles DSP and the cited papers, not from practitioner forum consensus.

---

## Recommendation (per expert reviewer, verbatim)

> Build an experimental `AudioStructureDetector` that consumes existing live CPC audio signals and publishes `audioStructure`, `audioBuildScore`, `audioEnergyRatio`, `audioVocalsHot`, and optional `dropFired`. It must be disabled by default, log every detected transition, and never trigger irreversible or safety-related actions. Manual override remains primary.

The buildable shape of this — module location, CPC registry shape, WS routing, REST config field, lifecycle wiring, iPad consumer changes, phased delivery — lives in `docs/30_[todo]_audio_structure_detector.md`. This memo's job ends at the research conclusion.

---

## Out of scope (intentional)

- ML inference (no runtime, no operator-debuggable behaviour, contradicts codex DNA).
- Multi-track / mixing-aware detection (we see one mic + one set of stems, not the DJ's deck-level audio).
- Genre classification (operator did not ask, and the answer is "no useful way with our signals").
- Real-time chord / key analysis (irrelevant to drop / structure detection at the scope the operator requested).
- Re-evaluating the upstream stems provider (out of scope for this investigation; operator confirmed it's local and working — though see Coverage gap #4 on latency).
