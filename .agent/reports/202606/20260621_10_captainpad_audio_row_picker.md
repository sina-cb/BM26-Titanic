# 20260621_10 — CaptainPad: customizable AUDIO row (Deck + Mixer)

**Branch:** `feat/audio_analysis_2` (PR #39)
**Date:** 2026-06-21

## Ask (part 1 of 2)
Make the audio-signals row on the Deck and Mixer customizable — add/remove which
signal plots show, persisted as state, so the operator sees the ones they care
about. (Part 2 — the Audio Companion OSC page showing all signals — is a separate
architectural change, see below.)

## Shipped
`CPCControls.tsx` (the shared Deck/Mixer audio row) is now customizable:
- A `useAudioPlotSelection(screen)` hook persists the chosen signal keys per
  screen to `@CaptainPad:audioPlots:<deck|mixer>` (the established AsyncStorage
  best-effort pattern). Deck and Mixer remember different picks.
- A new **slider icon** on the AUDIO row opens `AudioPlotPicker` — a modal listing
  every live audio signal with a checkbox; tapping adds/removes a plot and
  persists immediately. "Reset to default" clears the pick.
- `DynamicAudioRow` shows the operator's selection (in their order, only those
  still live); with no pick it falls back to the curated default
  (`curateDeckSignals`). The row's cell cap + "+N on AUDIO tab" hint still apply.
- Wiring: Deck `<CPCControls />` (default `screen='deck'`), Mixer
  `<CPCControls screen="mixer" … />`.

## Validation
- `npx tsc --noEmit` → **0 errors**. `expo lint` → 0 errors (only pre-existing
  exhaustive-deps warnings elsewhere; CPCControls.tsx not flagged).
- Runtime (Expo) verification pending on the operator's device — the logic
  follows the existing audio-tab persistence + picker patterns.

## Part 2 — OSC page completeness (separate, mission-critical — NOT done here)
Investigated deeply. The companion COMPUTES ~30 derived signals (party, note,
genre, climax, drop, onsets…) but only SENDS the raw bands + a few derived over
OSC. With `audio.enabled:false` in the engine (the operator's setup), the engine
does NOT run its own DerivedSignals/detector, so most derived signals are DEAD.
The engine's `audio/postproc/audio_signals.js` registry has OSC inbound bindings
for only ~5 derived keys; the other ~20 are marked "engine-internal (no OSC)".

Plan to make the OSC tab show/flow all (additive, safe in both engine modes):
1. Add `osc: '/marsin/audio/<x>'` bindings for the ~20 unbound derived keys in
   `audio_signals.js` (engine accepts them inbound; dormant unless OSC arrives).
2. Companion emits every derived key at its canonical address each hop (share the
   registry; register as built-in OSC outputs so the accounting/table shows them).
3. Decision needed: whether to ALSO remove the engine's own DerivedSignals/
   detector (the `audio.enabled:true` self-contained fallback). Recommend KEEPING
   it (mission-critical robustness) and letting the companion be the primary
   source — not ripping out the fallback.
This needs engine↔companion OSC integration testing on the running setup before
landing on the mission-critical audio→light path.
