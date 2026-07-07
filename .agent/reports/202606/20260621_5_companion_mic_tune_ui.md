# 20260621_5 — Audio Companion MIC TUNE page (on-playa mic tuning UI)

**Branch:** `feat/audio_analysis_2` (continues Audio Round 2; PR #39)
**Date:** 2026-06-21

## Why

Follow-up to `20260621_4` (per-band noise gates). The gates were live-tunable
over REST but had no operator surface. Operator asked for a **comprehensive,
intuitive, as-automatic-as-possible** UI in the Audio Companion to tune /
threshold / filter the mic for the loud, dusty, windy playa.

## What shipped — a new **MIC TUNE** page

Third top-bar page (`DESIGN · MIC TUNE · OSC OUT`). Automatic-first:

1. **One-tap noise-floor auto-calibration** (the headline). "Calibrate noise
   floor" → listens to the ambient room for ~4 s with the music off, measures
   each band's p90, and recommends `low/mid/high` gates. "✓ Apply these gates"
   sets all three in one tap. This is the most automatic path — the operator
   never types a number.
2. **One-tap gain calibration** — reuses the existing record→measure→recommend
   loop, surfaced here with a clear "play music loud" instruction.
3. **Live per-band meters** — low/mid/high level bars with a red **gate line**;
   a bar turns accent-coloured when it's **above** its gate (passing) and grey
   when **below** (gated to silence). The operator literally sees what the gate
   is doing in real time.
4. **Per-band gate sliders** + a ⟲ clear button (revert a band to the global
   gate). Global **noise gate** + **input gain** sliders below.
5. **Presets** — Indoor/quiet · Quiet night · Loud day · Windy · Neighbor bleed.
   One tap loads a sensible gate bundle as a starting point.

Two-way + graceful: every change writes through to the engine
(`PATCH /audio/config`, single source of truth) and reflects engine/CaptainPad
changes back. When the engine is offline the page shows "○ local only" and
still tunes the companion's own analyzer (codex P0 — fail loud, never silent).

## Implementation

- **Server** (`companion_server.js`): gate state (global + per-band), `applyGates`
  / `applyNoiseGate` / `applyBandGate`, a noise-floor calibration accumulator
  (per-band p90 → `noiseCalResult`), message handlers (`setNoiseGate`,
  `setBandGate`, `startNoiseCal`, `applyNoiseGates`), live band levels added to
  the frame, gate state in `hello`, and gate reconciliation in
  `applyEngineSharedTuning` (engine echoes). All write-throughs reuse the
  existing `writeThroughShared` (optimistic local + engine PATCH + loud failure).
- **Client** (`companion_app.js`, `index.html`, `companion_app.css`): the page,
  meters, controls, presets, calibration result handling, per-frame meter
  update, full theme parity (light/dark/midnight/sunset/gruvbox via the existing
  CSS vars).

## Validation

- Companion suite **72/72**; audio config + analyzer **66/66**.
- Server + client syntax-checked; booted on :6966, driven headless (puppeteer +
  Chrome) on the synthetic Test source.
- **Screenshots** (`~/tmp/mic_shots/`, gitignored): default (live meters), the
  recommended-gates result, applied (gate lines move right, bars drop to grey =
  noise rejection visible + "engine offline, local only" flash), Windy preset,
  and light-theme parity. Visually inspected — all render correctly.

## Known gaps

- No new automated UI test (the companion has no DOM-test harness; covered by
  syntax check + headless smoke + screenshots). A `companion_dynamic_signals`-
  style assertion on the new server messages is a reasonable follow-up.
- Recommended gates are p90 of the captured ambient — the operator runs the
  capture during genuine silence for it to mean "the bed". Live-mic verification
  still pending real hardware.
