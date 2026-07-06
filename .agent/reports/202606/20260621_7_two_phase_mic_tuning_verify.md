# 20260621_7 — Verify the two-phase on-playa mic-tuning workflow holds

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-21

## The operator's intended workflow
1. At a **playa-night baseline, no art car nearby** (ambient + distant music —
   NOT silence): tune the mic to ignore that noise level.
2. When an **art car is nearby** (loud): tune the **highs and gain** so LOW/MID/
   HIGH and the derived signals look good.

Question: does that assumption hold in our system?

## Verified empirically (real corpus track, fixed ambient bed, NO SNR re-balance
so the distant-vs-near level gap is preserved — the auto-SNR mic tiers erase it)

Raw band levels (no gates): distant baseline low/mid/high = **0.124 / 0.175 /
0.172**; loud art car = **0.491 / 0.551 / 0.181**.

Calibrate the noise floor on the baseline → gates 0.124 / 0.175 / 0.172, then:
- baseline WITH gates → **0.040 / 0.040 / 0.040** (all calm ✓)
- art car WITH gates → **0.443 / 0.477 / 0.050** (LOW, MID lit ✓; HIGH barely ✗)

**Conclusion — the assumption HOLDS, with one expected nuance:**
- **LOW & MID**: calibrate-at-quiet-baseline works cleanly. The baseline is
  rejected; loud music clears the gate by a wide margin (low 0.04→0.44, mid
  0.04→0.48). Exactly the intended behavior.
- **HIGH**: does NOT auto-separate — the distant baseline's high (0.172) ≈ the
  loud high (0.181), because high frequencies don't carry over distance/noise.
  So the high gate calibrated at baseline also gates the loud highs. This is
  *precisely why the operator planned to tune the highs in phase 2* — their
  instinct matches the physics.

## The one caveat: gain ↔ gate coupling
Input gain is applied pre-FFT, so it scales the band energy the gate sees.
Measured: after calibrating gates at gain ×1, raising gain to ×2 made the
baseline leak (0.04 → ~0.17). So **changing gain a lot AFTER calibrating the
noise floor invalidates it.** Robust order:
1. Set **gain** for the loud (art-car) state first.
2. Calibrate the **noise floor** at the quiet baseline (same gain you'll run).
3. Nudge the **HIGH** gate when a loud source is near.
If gain changes a lot later, re-tap "Calibrate noise floor".

## Change shipped (UI only — no audio-path behavior change)
- MIC TUNE page: a **workflow strip** (①gain → ②noise floor → ③highs) and
  corrected card copy. The old noise-floor hint said "turn the music OFF"; the
  operator's baseline is ambient-with-distant-music, and the calibration already
  works at any level — copy now says "run at your quiet baseline (needn't be
  silent)" and the gain card notes the gain-before-floor coupling.
- `index.html`, `companion_app.css`. Companion suite 73/73; booted headless,
  renders clean (gruvbox), no page errors.

## Optional follow-up (offered, not built)
Gain-relative gates (auto-scale the gates when input gain changes) would make the
order/gain-change irrelevant. Deliberately NOT shipped pre-hardware-test — it's a
behavior change with PATCH-spam/clamp edge cases; the workflow guidance above
makes the assumption hold without it. Build on request.
