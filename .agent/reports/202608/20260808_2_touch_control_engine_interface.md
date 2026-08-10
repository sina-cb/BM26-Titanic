# Touch Control panel ↔ engine interface — handoff

**Scope:** the operator touch panel (`docs/ui/`) and how it talks to the
marsin engine. Nothing else was in scope; the VSN1 `serialport` error that
surfaced during the session was deliberately left alone (see "Out of scope").

---

## What the panel is now

A single-page operator surface served by the sim at `docs/ui/touch_control.html`
with its engine wiring in `docs/ui/touch_control_wire.js`, embedded in
CaptainPad's **Touch Control** tab (now the FIRST tab). Four panels — COLOR,
SPATIAL, EFFECTS, GROUPS — under a full-width live audio strip.

**ARM is the contract.** Nothing writes to the engine until armed. Arming
asserts the whole visible state onto the rig; disarming gives it back.

---

## New engine code (all additive, three new files)

| File | What it is |
|---|---|
| `marsin_engine/lib/pixel_group_index.js` | Per-pixel ordinal **within its group**, plus a group number. Needed because the existing `localIndex` is per FIXTURE and 16 of the 24 titanic groups hold several fixtures — on `Right SmokeStacks` (8 single-pixel pars) every pixel has `localIndex 0`, so anything keyed on it cannot move. |
| `marsin_engine/effects/movement_trace.js` | The MOVEMENT family: travelling patterns keyed on that group ordinal. Places the operator's palette; never invents colour. |
| `marsin_engine/lib/audio_bindings.js` | Binds an audio signal to an effect slot or a group. Two modes — `level` (follows) and `hit` (fires on a threshold, then decays). Multiple sources combine by MAX. |

Wired into `global_effects_controller.js` (chain step 0.5), registered in
`global_effect_library.js`, dispatched via `global_effect_slot_manager.js`,
evaluated per frame in `engine.js`, and exposed over REST in `api_server.js`
(`/audio-sources`, `/audio-bindings`, `PUT /audio-bindings/<scope>/<id>`,
`POST /audio-bindings/clear`).

---

## Verified working (with the evidence)

**Movement effects.** Nine presets. Measured on the real 964-pixel model:
`one_per_color` lays RED GRN BLU YEL CYN and shifts exactly one pixel per beat
at 120 BPM, two at 240 — tempo really drives it. `every_other` walks two
colours through the palette. `whole_group` marches one colour per group.
Each group wraps at its OWN length off one shared clock (n=8, 24, 40).
`Pulse — Burst then Long Fade`: full for 200 ms, then a cubic fall
(0.957 → 0.541 → 0.195 → 0.062) to a 0.04 floor at 5 s, then re-pulses.

**Transitions.** Biggest single-frame colour change, where 2.00 is an instant
swap: step-to-step 2.00 → **0.30**; pattern-to-pattern 2.00 → **0.03**;
palette change 2.00 → **0.05**; and 0.033 when a fade is interrupted mid-way
(it continues from what is rendered, not from the config). Fade bar at zero
still jumps, as asked.

**Running effects follow the wheel.** Patching a slot only updates its STORED
params — the controller reads them on dispatch, which is why turning a button
off and on "fixed" the colour. The panel now PATCHes **then** activates.
Measured live: start 259° → wheel left 270° → up 0° → right 90° → CONTRAST
90/162/234/306/18, effect never turning off.

**Audio.** `/audio-sources` lists the Companion's nine signals plus a synthetic
`bpmPulse` derived from the arbitrated tempo (the one source that works with no
audio at all). A group bound to `micLow` tracked the live value on **10/10**
samples. Gains reach the pixels exactly (1.00/0.75/0.40/0.00 → group averages
1.000/0.750/0.400/0.000) and ride ON TOP of a painted colour rather than
replacing it.

**Audio bindings are part of being armed.** Cleared on disarm (24g/10e → 0/0)
and on tab close while armed, via a keepalive handler. A disarmed panel can no
longer leave the groups pulsing.

**Arming no longer switches the audio feed off.** It used to take a GLOBAL
param-center source lock to `api`, which rejects every write from any other
source — and the Companion writes over OSC. Proven by revision counter:
open 725226→731562 (advancing), locked 731994→731994 (frozen), released
733495→740647 (resumed). Now leases only the six params the panel writes.

**Master fader drives the ship's master** (`PATCH /mixer {master}`): dragged
50% → 0.5, 15% → 0.15, 98% → 0.98.

**Contrast.** 13 text styles from 6–16 px, each measured against its own
alpha-composited background: 13/13 pass AA (4.5:1).

---

## Known broken / unresolved

**1. `takeControl()` can fail to settle.** Its promise was observed never
resolving, and every arm assertion hung off it — so the panel said ARMED and
sent almost nothing, silently. **Mitigated, not fixed:** arming now races an
8-second deadline, then asserts the panel state anyway and REPORTS the timeout.
Verified: master 0.3 → 1.0 with `arm setup did not finish in 8s`.
The stall itself is unexplained. Disproven along the way: not a rejection
(two catches, silent), not `state.armed`, not scope, not CORS (OPTIONS 204,
POST 200 by curl), not concurrency (serialising every `Promise.all` changed
nothing).

**2. The latency that muddied all of the above is probably the test harness.**
From headless Chrome every request takes ~4.5 s — *including to the sim server*
— while node reaches both in 1–19 ms. Not the proxy (`--no-proxy-server`, same).
**Next step: arm from a real browser / the iPad before touching arm code again.**

**3. Group audio bindings do not assert on arm** (effects do). They work when a
dropdown is touched.

**4. A second armed panel has been present throughout.** Slots nobody pressed
kept coming up active, and it repaints group colours. It contaminated several
live readings. A single-owner guard (newest arm wins, older panels stand down)
is proposed but NOT built.

**5. Bindings are in-memory** — they do not survive an engine restart.

**6. Per-effect audio gain is wired into `movementTrace` only.** The hook
(`audioGainForSlot`) is generic; strobe, beat pump, breath, sparkle, trails,
crush and the sweep each need the same one-line multiply.

**7. OWN + FX cannot both apply.** `group_fixed_color.js` overwrites a painted
group AFTER the effect chain, so a group either holds its own colour or shows
an effect. The panel holds OWN and says so in the groups header. A real fix
needs a blend amount or a per-group effect mask in the engine.

---

## Not verified at all

- **Never run on a real iPad.** Touch targets, `100vh`, native select popups.
- **Rendered LED colour was never measured** from sim captures — ground bounce
  dominated every attempt.
- **Collapsible panels** for the iPad were requested and not started.
- Two `[wire-diag]` console lines are still in the arm path on purpose — they
  are how the next session sees whether that chain advances.

## Out of scope

`Cannot find module 'serialport'` from the VSN1 layout deploy. Nothing was
changed. For the record: `serialport` is neither declared in
`marsin_engine/package.json` nor installed anywhere in the clone, and
`grid_serial.cjs` requires it at the top level — it has never been installed
here. The engine treats the failed deploy as a warning and continues.

## Rig state at handoff

Source lock open, effects disabled, audio bindings cleared, master 1.0.
