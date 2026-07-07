# audio_reactive — bug fixes + BM/art-car tuning

- **Branch:** `dev/audio_reactive_tuning` → merged to `feat/autopilot_deck_improvement`
- **Scope:** fix the `audio_reactive` profile bugs a Fable review found, add
  robustness to transient external audio (passing art cars), tune for Burning
  Man, and prove it with fake-audio tests.

## What was broken (before)

- **F1 (HIGH) — energy→speed was INVERTED.** The arc sagged the `bpmSpeedMax`
  *window*, which (since speed = (bpm−min)/(max−min)) made a **calm run FASTER**.
  Quiet moments would have strobed at max speed on the playa.
- **Missed-build bug** — the pickup used an instantaneous EMA slope threshold
  that was only met while energy was still below the arm floor, and got wiped by
  re-arming every tick, so a real build **never switched**. (The agent's "0
  switches during a flyby" was this bug accidentally suppressing everything.)
- **Colour recoloured on transients** — the descriptor keyed on the instantaneous
  note + a short hold, so a passing car's foreign pitch/energy could recolour.

## Fixes + tuning

- **F1:** speed arc now drives a **multiplicative scale [floor,1] on the bpm-sync
  output** (`bpm_speed_sync.js` `setSpeedScale`, applied `speed *= scale`). Calm →
  low `energySlow` → scale sags → **slower**; the `bpmSpeedMin/Max` window never
  moves. Proven end-to-end: real `speed` **0.615 → 0.360** on a sustained calm.
- **Pickup detector rewritten** to pure **sustained elevation**: arm on a calm
  (`pickupArmBelow`), fire only when energy climbs above `pickupSustainAbove` and
  **holds there continuously for `switchConfirmMs` (15 s)**. No slope test, no
  drop-pulse trigger (F6 gone). A passing car peaks then fades before 15 s →
  rejected; our build plateaus → fires.
- **Colour** now triggers on a **sustained mood descriptor** (coarse `energySlow`
  band + regime), held past `colorHoldMs` (15 s), silence-gated, seeded on arm
  (no recolour on arm — F3). The instantaneous note only *picks* the palette, it
  no longer *triggers* a recolour. `energySlowTau` raised to 25 s so a flyby can't
  move the band.
- Kept the agent's F2 (paused autopilot ⇒ no audio coupling), F4/F5 hygiene, and
  the F8 `/deck/playlist/secondary` `tryLoad` route-hang fix.
- BM-heavy defaults: `minIntervalMs` 12 s, `switchConfirmMs` 15 s, `colorHoldMs`
  15 s, `energySlowTau` 25 s. All tunable + documented — `docs/41_audio_reactive_tuning.md`.

## Proof (fake audio)

- **Unit (82 pass / 0 fail)** incl. the new BM regression tests: F1 speed
  direction; **sustained build → switch**; **art-car flyby (brief swell) → NO
  switch AND NO recolour**; sustained mood → recolour (nearest-hue); silence gate.
- **HIL (real engine, 11/11)**: `speed` sags on a calm (0.615→0.360) with the
  window fixed at 160; held descriptor recolours while a transient doesn't;
  sustained build advances; silence suppresses; detach restores `bpmSpeedSync`.
- Regression: autopilot HIL 16/16, deck-slots HIL 27/27, `npm run check` PASS,
  `git status` clean but for the intended diff.

## Honest limits / follow-ups

- A car **parked adjacent** blasting continuously > `switchConfirmMs` causes at
  most ONE (rate-limited) switch, and a genuinely sustained loud passage drifts
  the colour — unavoidable from a single mic; the confirm/hold windows are the
  lever (documented).
- Predictive pre-arm (riser/dropCountdown) still not wired — reactive-only, as
  the operator allowed. Genre-subset colour narrowing still scaffolded-not-wired.
- Snappy musical switches still come from the source `audioSwitchPattern` cue
  (beat-quantized, min-dwelled) — the energy-pickup path is the conservative
  backstop.
