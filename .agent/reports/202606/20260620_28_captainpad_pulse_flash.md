# 2026-06-20 — CaptainPad: render PULSE signals as flashes, not dull bars (Adv-D P2-A)

Branch `dev/f3_captainpad_flash` (parent `feat/audio_analysis_2`),
worktree slot 2. CaptainPad-only; `marsin_engine/` untouched.

## Problem

The AUDIO tab's signal grid (`app/(tabs)/audio.tsx` → `SignalColumn`) renders
every non-genre/non-Hz/non-bpm key as a `[0,1]` intensity BAR + scrolling
trace. But a growing class of Companion CPC keys are **30 Hz one-frame
PULSES** that snap to 1 for a single analyser hop on an event and sit at 0
otherwise. A one-hop spike almost always lands BETWEEN the CaptainPad ~20 Hz
param polls, so the bar reads as a **dead, flatlined meter that imperceptibly
twitches** — the Adv-D P2-A finding.

The Audio Companion desktop UI already solved this with an
arm-on-rising-edge / decay envelope (`companion_app.js`: `armPulse` /
`tickFlash` / `tickLit`): a fire snaps a flash to 1, then a per-frame decay
multiplier (0.7–0.9) fades it over ~150–250 ms so the operator actually sees
the cue. This change mirrors that posture on the iPad. (Companion NOT edited.)

## What changed

1. **`utils/audioSignals.ts`** — new single source of truth for the pulse
   class: `PULSE_KEY_TOKENS` + `isPulseKey(key)`. Strips camelCase/underscore
   separators to a joined lower key and tests for a contiguous pulse-token
   run, so `mic*` and `audio*` prefixes both resolve. Continuous keys
   (bands/dom/energy/climax + the genre/Hz/bpm specials) are NOT pulses.

2. **`components/audio/PulseFlash.tsx`** (new) — a self-animating flashing DOT.
   Owns an rAF loop (decoupled from the WS cadence, pauses on tab blur via
   `active` — congestion/cpu guard, no new subscription). Arms the envelope to
   1 on the rising edge past 0.5 (armPulse semantics), then decays
   frame-rate-normalised (`0.86^(dt·60)`) toward a 0.02 floor — a full flash
   stays "lit" (> 0.4) for ~150 ms and fully fades by ~430 ms. Themed entirely
   from caller-supplied palette tokens (accent / `ghostBorder` /
   `surfaceContainerLowest`) — no hardcoded hex.

3. **`app/(tabs)/audio.tsx`** — `SignalSlot` gains `isPulse`
   (`kind === 'intensity' && isPulseKey(key)` in `toSignalSlot`). `SignalColumn`
   branches: a pulse slot renders the label + `<PulseFlash>` (sized to the
   bar+trace block's height so grid rows stay aligned) instead of the
   bar/trace/RAW-footnote. Continuous keys are completely unchanged.

## Pulse keys handled (10)

`micOnsetLow`, `micOnsetMid`, `micOnsetHigh`, `audioChestHit`,
`audioDropCountdown`, `audioBeat`, `audioPhraseBoundary`, `audioTrackChange`,
`audioSwitchColor`, `audioSwitchPattern`.

## What the operator sees

- **Before:** these cells were a thin `[0,1]` bar pinned near empty that, at
  best, flickered one stepped pixel for a single frame on a fire — visually
  dead.
- **After:** a dim resting dot inside a faint ring that **snaps to full
  brightness + a glowing accent ring** the instant the pulse fires, then eases
  back to dim over ~150–250 ms. Caption flips `idle` → `PULSE` while lit. A
  one-hop onset/beat/boundary is now unmistakable. Continuous bands/energies
  keep their bar + scrolling trace exactly as before.

## Proof

- `npx tsc --noEmit` → **exit 0**.
- `npm run lint` → **exit 0** (12 pre-existing warnings in config/mixer/monitor/
  studio/etc.; **0 in the new/changed files**).
- `npm run web:build` → **exit 0**, `dist` exported (the `/audio` route built).
- Scripted classification assertion (`~/tmp/pulse_assert.mjs`, mirrors the TS
  impl): **PASS — 10 pulse keys flash, 14 continuous keys keep bars** (verified
  the 4 mic bands, kick, dom1/dom2, energy, climax, slow, build, party, genre,
  genreConf, bpm are all NOT misclassified as pulses).

## Notes / boundaries

- No `marsin_engine/` edits; companion untouched.
- No fallback: a missing palette token would crash at render (PulseFlash reads
  tokens passed by the caller from the active palette).
- `CaptainPad/dist/` is gitignored (build residue, not committed).
