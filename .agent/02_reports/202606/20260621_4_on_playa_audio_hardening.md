# 20260621_4 — On-Playa Audio Hardening (noise tuning / thresholding / filtering)

**Branch:** `feat/audio_analysis_2` (continues Audio Round 2; PR #39)
**Author:** audio agent (instigator, single-branch — this is coupled DSP, not a
multi-agent sweep, per codex)
**Date:** 2026-06-21

## Why

Operator asked, ahead of using a **live mic at Burning Man**, for ways to
"tune, threshold, filter noise, and basically tune the audio on the noisy/loud
playa." The whole signal chain was tuned against clean line-in recordings — a
signal we will never receive on playa. This slice (a) builds the missing
synthetic-playa stress conditions so future tuning is honest, and (b) ships the
first concrete on-playa tuning knob, validated against the real corpus.

## What shipped

### 1. Virtual-mic playa conditions (`tests/integration/mic_model.mjs`)
The existing virtual mic modeled band-limiting, capsule saturation, SNR, pink
room noise, white self-noise and mains hum — but **not** the two signature
on-playa failure modes. Added, purely additively:
- **Wind gusts** — occasional 0.6–1.5 s raised-cosine bursts of sub-90 Hz
  rumble that slam the low band (mimic a kick/drop edge).
- **Neighbor bleed** — a competing 124-BPM kick+bass from the next camp,
  deliberately uncorrelated with the captured track.
- A new **`playa` tier** (heavy + wind + bleed). Legacy tiers
  (clean/moderate/heavy) are **byte-identical** (the new fields default off and
  the gust/bleed generators don't consume the PRNG when disabled — verified).

### 2. On-playa scoring harness (`tools/playa_noise_eval.mjs`)
Neither existing harness degrades the **real corpus** through the mic
(`detection_eval` replays it as clean line-in). The new harness runs a config
across the real corpus **degraded through the `playa` mic** (→ phantom
false-fires/min) and the synthetic positives degraded through `playa`
(→ drop precision/recall, so a noise knob can't silently kill real drops).
Sanity-checked: matches `detection_eval` at the moderate tier (R=0.83).

### 3. Per-band noise gates (`lowGate` / `midGate` / `highGate`)
The core deliverable. Grounded in a measurement (silence through the playa mic):
the ambient bed lights the bands **unevenly** — the HIGH band reads ~0.17 and
MID ~0.07 from pure noise, while the single global `noiseGate` sits at 0.04, so
**mid/high stay lit during silence and breakdowns**. Raising the *global* gate
would also kill quiet musical hats. Per-band gates let the operator lift the
noisy band's floor without dimming the others.
- `bands.lowGate/midGate/highGate` — live-tunable, post-compression [0,1)
  domain. **Absent → that band uses the global `noiseGate`**, so the shipped
  config (which sets none) is byte-identical to the legacy single-gate path.
- Kick keeps the global `noiseGate` as its silence floor (unchanged).
- `tools/audio_calibrate.js` now prints copy-pasteable per-band gate
  suggestions (each band's quiet-room p90 *is* that band's gate).

## Validation (real numbers, this machine)

Full engine suite: **927 / 927 pass** (924 baseline + 3 new tests).
- `tests/audio_analyzer.test.js` — **42 pass** (+2: per-band gate suppresses
  only its own band; absent gate falls back to global → byte-identical).
- `tests/audio_config.test.js` — **24 pass** (+1: per-band gate validators;
  contract surface updated).

Bed-darkening vs music-preservation (mean band level; gates = bed p90 per band):

| tier | band | BED off→on | MUSIC off→on |
|---|---|---|---|
| heavy | mid | 0.065 → **0.040** | 0.170 → **0.148** (preserved) |
| heavy | high | 0.165 → **0.040** | 0.189 → 0.068 |
| playa | mid | 0.065 → **0.040** | 0.162 → **0.139** (preserved) |
| playa | low | 0.031 → 0.031* | 0.095 → 0.095 |
| moderate | high | 0.063 → **0.040** | 0.101 → 0.079 |

(*low gate auto-floored to the global 0.04 where bed < 0.04.)

**Read:** the **mid-band win is clean and strong** — the bed's mid darkens while
music mid is preserved (3.7× separation at heavy/playa). The **high band is
SNR-limited**: at heavy/playa the music's HF (≈0.19) is buried in capsule hiss
(bed ≈0.17), so a gate that darkens the bed also darkens music HF — a physical
limit of a far/loud/degraded capture, not a code flaw; the operator chooses how
hard to gate high.

## Honest negative result (why I did NOT ship the first design)

The first implementation was an **adaptive minimum-statistics noise-floor
subtractor** on the raw band energies. Validation killed it: a continuous
bassline has no silent gaps, so the min-tracker crept up to the signal and
**subtracted the bassline to zero** (low-band mean 0.107 → 0.000 on real
tracks). Min-statistics is the wrong tool for continuous-music bands. Replaced
with the per-band gate (post-compression domain, static, calibrated from the
quiet room) — safe by construction. Recorded here so the dead end isn't
re-walked.

## Known gaps / deliberate non-builds

- **Wind guard on the drop detector** — scoped, NOT built: the synthetic playa
  model shows the drop detector goes *mute* under heavy saturation (recall→0
  from compression, **0 phantom drops**), so there is no demonstrated phantom
  problem for a guard to fix. Building it now would add complexity without
  validated justification. Revisit with live-mic data.
- **CaptainPad preset surface** (big knobs / live meters / "loud day / quiet
  night / windy" presets) — the gates are already live-tunable through the
  existing `PATCH /audio/config` + Audio tab; a dedicated dusty-glove surface is
  a follow-up.
- **Live-mic verification** — all numbers here are corpus + synthetic-playa-mic;
  the on-playa calibration loop (run `audio_calibrate.js` music-off → paste
  gates) needs a real capsule to close.

## Files changed
- `marsin_engine/tests/integration/mic_model.mjs` — wind + bleed + `playa` tier.
- `marsin_engine/tools/playa_noise_eval.mjs` — new on-playa scoring harness.
- `marsin_engine/audio/analyzer/audio_analyzer.js` — per-band gates.
- `marsin_engine/audio/config/audio_config.js` — `lowGate/midGate/highGate`
  live fields + validators.
- `marsin_engine/config.yaml` — documented seeds (unset → global gate).
- `marsin_engine/audio/calibrate/audio_calibrate.js` — per-band gate suggestions.
- `marsin_engine/tests/audio_analyzer.test.js`, `tests/audio_config.test.js` —
  new coverage.
