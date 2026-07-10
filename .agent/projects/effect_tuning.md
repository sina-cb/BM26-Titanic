---
name: effect_tuning
status: active
owner: Sina (hands-on at the Studio) + subsystem experts
created: 2026-07-10
updated: 2026-07-10
---

# Effect Tuning — the party-8 and beyond

## Goal

Tune the global-effects library so every effect on the VSN1 party page (and
the wider 32-slot layout later) looks intentional on the REAL rig — right
colors, right intensities, right envelopes, right beat behavior. Sina does
the aesthetic passes hands-on at the Studio; agents prepare candidates,
expose the right knobs, and keep the state files + library presets in sync.

## Current state

The Effects v2 stack is DONE and live (2026-07-10): 8 effects arranged on
test_bench page 0, auto-deployed to the VSN1 (drum behavior, color-only grid
with active-state dimming, sb map MODE/VIEW/empty/LOGO). Sina: "this version
is good." The CURRENT party-8 (slots 1–8, `marsin_engine/states/test_bench/
global_effect_slots.yaml`):

| Slot | Label | effectId / preset | Notes |
|---|---|---|---|
| 1 | Ocean Blue | colorWash / ocean_blue | modes tint/replace/multiply/max |
| 2 | Strobe | strobe / sync_4hz | freq wheel 2/4/5/10/20 Hz (mode cycle) |
| 3 | Ghost Ship | feedbackTrails / ghost_ship | |
| 4 | Deep Pump | beatPump / deep | BPM-locked duck |
| 5 | Blast White | blastWhite / default | legacy |
| 6 | Iceberg | dropHit / iceberg_flash | TRIGGER (hand-drummed) |
| 7 | Blizzard | sparkle / blizzard | |
| 8 | UV Blast | uvBlast / default | legacy |

**Sina's verdict: several of these need changing — he will do that HANDS-ON
AT THE STUDIO** (aesthetics are operator calls, not agent calls). Agents:
don't re-arrange the party-8 without him.

Library source of truth: `marsin_engine/lib/global_effect_library.js`
(presets + params + safety tiers + primaryMode wheels); per-effect modules in
`marsin_engine/effects/`. Slot state persists per scene in
`marsin_engine/states/<scene>/global_effect_slots.yaml`; any slot change
auto-flashes the VSN1.

## How to tune (the loop)

1. Bring up the stack: `node launcher.js dev --scene test_bench` (or the
   studio scene). ONE CaptainPad tab.
2. Change presets/params: either live via
   `PATCH /global-effect-slots/:id { effectId, presetId, paramsOverride }`
   (persists + auto-flashes the VSN1) or durably by editing the preset in
   `global_effect_library.js` (restart engine).
3. Judge on the sim/rig; iterate. The VSN1 jog = intensity, mode wheel =
   the effect's primaryMode (e.g. strobe Hz, wash blend).
4. When a preset is BLESSED, land it in `global_effect_library.js` (not just
   the state file) so every scene inherits it, and note it in the decisions
   log below.

## Candidate work list (from the 2026-07-10 sessions)

- [ ] Sina's Studio pass over the party-8 (swap/retune the weak ones).
- [ ] dropHit envelope feel (attack/hold/release) on the real fixtures.
- [ ] colorWash amounts per mode — `replace` at 0.9 may crush patterns.
- [ ] beatPump depth/curve vs. real BPM detection on playa audio.
- [ ] sparkle density/decay on the physical LED density (sim lies about it).
- [ ] strobe duty + safety-tier review on real fixtures (5/10/20 Hz tiers).
- [ ] Page 1+ layout: decide the second-8 (kickPunch, waterlineSweep, freeze,
      crush, breath, invert are unslotted today).
- [ ] LED CONTROLS INTEGRATION (Sina, 2026-07-10: "after this") — bring the
      MarsinLED channels under the same effects/tuning umbrella; see
      docs/41 + the MarsinLED onboarding memory.

## Links

- **Reports:** `../reports/202607/20260710_11_vsn1_freeze_hunt_and_redesign.md`
  (the VSN1 stack this rides on)
- **Branches:** `feat/party_integration_20260711`
- **Docs:** `docs/42_vsn1_controller.md` (controller), `docs/39` (effects)
- **Notion:** file follow-up cards on the Titanic Lighting task tracker
  (Backlog) once studio sessions are scheduled.

## Decisions log

- **2026-07-10** — party-8 v1 arranged (table above); Sina approves the
  CONTROLLER UX but flags several effects for replacement at the Studio.
  Aesthetic tuning is operator-owned; agents keep presets/state/deploy sync.

## Next steps

- [ ] Sina: Studio tuning session over the party-8 (before/at the party).
- [ ] Agent: after each blessed preset, migrate it from paramsOverride /
      state into `global_effect_library.js` and re-run the engine tests.
- [ ] Agent: propose the page-1 second-8 layout for Sina to review.
- [ ] Then: LED controls integration (next project phase, after merge).
