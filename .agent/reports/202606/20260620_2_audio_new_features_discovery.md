# 2026-06-20 — Audio-reactive NEW-FEATURE discovery (feasibility-graded)

**Author:** investigator sub-agent (slot 2, read-only) of the Audio Round 2 fleet.
**Parent branch:** `feat/audio_analysis_2`. **Method:** read-only study of the live
`marsin_engine/audio/` tree + the corpus reports; no repo files modified.
**Sibling work in progress (NOT re-proposed):** genre detection + note→color fix
(`dev/genre_signals`).

## Constraints that shape every proposal
- **Capture is MONO** (`config.yaml audio.capture.channels: 1`; `audio_capture.js`
  resolves `-ac 1`). Any stereo/spatial feature is HARD (capture-path change).
- **FFT 1024 @ 44.1 kHz → ~43 Hz/bin, hop 512 → ~86 hops/s.** Report `20260616_1`
  §8 already recommends 2048 before playa; several pitch features want it.
- **Clean two-tier observe-and-publish:** `AudioAnalyzer` (pure DSP) → CPC keys →
  second-tier modules (`detector/`, `signals/derived_signals.js` sub-modules) that
  read CPC each hop and publish their own. New derived features slot in as new
  `DerivedSignals` sub-modules or a sibling detector — **no analyzer change** unless
  new spectral data is needed.
- Offline validation is cheap/real: `tools/pattern_audio_harness.mjs` +
  `tests/integration/run_analysis.mjs` + `audio/synth/test_synths.js`
  (`riser`, `edm_drop`, `full_track`, `bassline`, `hats`, `chord_stab`).
- **Already built (do NOT propose):** bands/kick/flux, dom-freq + energy, spectral
  flux, BPM + beat + **bar phase / beatInBar / downbeat** (`bpm_tracker.js` already
  emits these), party gate, note→hue, drop (Kalman+windowed), build score, energy
  ratio, slow zone, vocals-hot (stems only), switch-pattern/switch-color cues.

## TOP 5 — do next (best value/effort)

### 1. Riser / build-up ANTICIPATION + drop ETA — `audioRiserScore`, `audioBuildEta` — MEDIUM
Let the rig *charge up* (brightness ramp, accelerating chase) BEFORE the drop, not
just react on the transient. Builds on `audioBuildScore`, `audioEnergyRatio`,
`micFluxRaw`, `audioStructure` (BUILD + `_buildStartedAtMs`), and `barPhase`. New
sub-module `signals/build_anticipation.js`: fit build-score slope + count bars since
BUILD entry (via `audioBpm`+`barPhase`) → publish `audioRiserScore` (rising flux ∧
rising high ∧ rising energy) and best-effort `audioBuildEta` (+ `audioRiserConf`),
reset on drop. Validate with `riser`+`edm_drop` synths. Risk: ETA is a guess without
phrase labels — ship riser score as reliable, ETA as best-effort w/ confidence.

### 2. Per-band ONSET → spatial chase — `micOnsetLow/Mid/High` — EASY–MEDIUM
Today there's ONE broadband flux + ONE kick. Split onset into low/mid/high → map each
to a different hull zone = a drum-kit-following spatial chase (big "alive" win for
exterior visibility). The analyzer already computes per-band energy + full-spectrum
mags every hop (flux loop fills `_prevMag`); per-band half-wave-rectified flux is the
same math restricted to each band's bins (near-zero cost, additive output like
dom-freq was). Then a tiny adaptive-threshold peak-picker (reuse kick EMA) in
`signals/band_onsets.js`. Validate with `bassline`/`hats`/`full_track`.

### 3. Track-change / silence detector — `audioTrackChange`, `audioSilence` — EASY
When the DJ swaps tracks or there's a gap, do something intentional (fade / palette
reset / attention sweep) instead of freezing on stale signals — and a musically honest
moment to re-pick pattern/palette. Reuses `PartyMode`'s loudness EMA + hysteresis/hold,
`audioSlowZone`, `audioEnergyRatio`, BPM lock/unlock. `signals/track_change.js` →
`audioSilence` (0/1) + `audioTrackChange` (pulse). Copy party's hold logic so a 1-bar
breakdown isn't a false "track change." Validate with `silence` bookended by `full_track`.

### 4. Sub-bass "chest hit" — `micSub` / `audioChestHit` — EASY–MEDIUM
The body-felt 30–70 Hz slam (distinct from the kick *click*, whose window is 50–110 Hz)
→ full-hull brightness thump for the visceral moment. Dedicated narrow sub-band energy
(30–60 Hz) + transient emphasis, mirror `_binKick`. Strongest concrete argument for the
**FFT 1024→2048 bump** (43 Hz/bin barely resolves 30–60 Hz). Validate `bassline`/`edm_drop`.

### 5. Auto-sensitivity / AGC per venue — `audioAgcGain` (advisory, opt-in) — MEDIUM
Playa SPL varies wildly; a slow multi-second AGC keeps band signals in a usable visual
range so the rig "just works." Builds on the band noise-gate/soft-compress, loudness EMA,
`audio_calibrate.js`, the normalizer op. **Codex P0:** advisory + opt-in (`enabled:false`
default like the structure detector), never silent auto-apply. Needs hold/limit so it
doesn't pump on quiet sections. Validate by replaying corpus at scaled amplitudes.

## Strong second tier
- **6. Phrase / 8–16-bar boundary — `audioPhrasePhase`, `audioPhraseBoundary` — MEDIUM.**
  Land swaps on phrase boundaries (looks intentional). `bpm_tracker.js` already emits
  `downbeat`/`barPhase`/`beatInBar` → count 4/8/16 bars, re-anchor on drops. Upgrades
  `switchPattern`/`switchColor` from beat- to phrase-quantized. Caveat: absolute phrase
  alignment is a guess; relative periodicity anchored to drops is reliable.
- **7. Drop COUNTDOWN pulse train — `audioDropCountdown` — MEDIUM (depends on #1/#6).**
  "4…3…2…1…DROP" beat-synced flashes on the final build bars. Gate hard on riser
  confidence (under-fire > false countdown).
- **8. "Hands-up" climax / sustained-peak — `audioClimax` — EASY–MEDIUM.** Detect a
  sustained max-energy plateau (hold the biggest look), complementary to the transition
  detector. Energy ceiling + high-band presence + post-drop timing.
- **9. Key / scale (chroma) → palette harmony — `audioKeyRoot`, `audioKeyMode` — HARD.**
  Per-track tonal center + major/minor (warm vs moody palettes). Needs a real 12-bin
  chroma pass over `_prevMag` + Krumhansl key-profile correlation; wants 2048 FFT.
  Noisy on modal EDM; sequence after cheap wins; coordinate w/ note→color agent.

## Lower priority / constrained
- **10. Stereo / spatial L-R chase — blocked by mono capture.** Invasive; the per-band
  onset chase (#2) approximates the payoff far more cheaply. Defer unless stereo line-in.
- **11. Crowd / cheer detection — HARD, low-confidence** on a PA-dominated mic. Skip for BM26.
- **12. Vocal "lyrical moment" presence (mic-only) — MEDIUM–HARD, low ROI** without stems
  (synth leads look like vocals). Below the structural wins.

## Recommended sequencing
1. #2 per-band onsets + #3 track-change/silence (cheap, no DSP risk).
2. #4 chest-hit + FFT 1024→2048 bump (1-line config, broad benefit).
3. #1 riser/anticipation → unlocks #7 countdown, pairs with #6 phrase tracking.
4. #5 AGC (advisory/opt-in) + #8 climax (robustness + peak looks).
5. #9 key/scale last (hardest, wants 2048, coordinate w/ note→color).

## Common implementation notes
- Publish continuous/event signals from `DerivedSignals.tick` (or a new sibling
  detector) via `paramCenter.setMany`, like `audioBpm`/`audioBeat`. Analyzer-level
  features (per-band onset, sub-band) go in `audio_analyzer._analyzeOnce()` as
  **additive** outputs (existing fields stay byte-identical — dom-freq is the template).
- Every new CPC key must be registered (`param_center.js audioRegistryEntries()`),
  validated in `audio_config.js`, and wired into patterns/modulation per docs/26/37 +
  the `visual_cue_mapping.md` artifact to actually drive lights.
- Honor codex P0: no silent fallbacks. AGC/auto-act features advisory/opt-in; ETA/
  phrase/countdown publish honest confidence + fail loud (reuse `_warnNonFinite` +
  fatal-latch pattern). All offline-validatable today — no engine boot needed.
