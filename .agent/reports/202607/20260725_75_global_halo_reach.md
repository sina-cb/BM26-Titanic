# 20260725_75 — Global Halo Size is now one knob for every bus

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (3D render path + GUI wiring)
**Order (operator, 2026-07-30):**
*"The halo size parameter only affects the TE sign lights, no LED strands, none
of the DMX lights."* → *"please make sure that's a global for-all-fixtures
parameter."*

## TL;DR

Two independent defects, one per bus, both measured live in his running sim
before and after. Neither was a wiring typo — each class failed for its own
reason, and the TE sign happened to be the one class immune to both.

| class | before | after |
|---|---|---|
| LED strand | **0.196 → 0.196** (completely dead) | 0.014 → 0.700 |
| Vintage LED | 0.0608 → 0.101 (**pinned from haloScale 1.0 up**) | 0.0608 → 0.281 |
| Shehds bar | 0.0178 → 0.0297 (**pinned from haloScale 1.0 up**) | 0.0178 → 0.0825 |
| UKing par | 0.240 → 1.112 (already fine) | unchanged |
| TE Sign V3 A/B | 0.014 → 0.700 (already fine) | unchanged |

(Drawn halo radius, world units, dragging Global Halo Size 0.1 → 5 at his own
Global Pixel Size 1.9. His working point is **Global Halo Size 1.4**.)

**Defect 1 — reach (LED strands).** The `globalHaloScale` GUI handler iterated
`parFixtures` + `dmxSceneFixtures` and stopped there. LED strands are a separate
list (`ledStrandFixtures`) with a separate re-render entry point
(`applyVisualSize()`), and they were never called. Their halo radius *is*
`ledHaloSize × globalHaloScale`, so it was **frozen at whatever the slider read
when the strand was built** — the knob genuinely did nothing until a reload.

**Defect 2 — ceiling (every multi-pixel DMX fixture).** A DMX halo was bounded
by the **opaque bulb's** pitch ceiling. `_53`'s bulb ceiling is `0.3 × pitch`,
and a multi-pixel fixture's bulb sits exactly *at* it for any normal Global Pixel
Size — so the halo collapsed to `bulbCeiling × HALO_RIM_FACTOR` and stopped
answering the knob **from haloScale 1.0 upward**. He is at 1.4, i.e. already past
the stall. The single-pixel par escaped (`_minPixelPitch === 0` ⇒ no ceiling),
which is why "none of the DMX lights" was true of the rails and bars he was
looking at but not literally of every DMX fixture.

**Why only the TE sign responded:** it is LED-bus, so its halo is the *absolute*
`ledHaloRadius()` — no rim arithmetic, no pitch ceiling — and it is not a strand,
so the missing-handler bug missed it too. It is the one class both defects
skipped. It also has by far the loudest response (halo/bulb 0.37 → 18.4 across
the slider, against the DMX rim's 1.08 → 5.0), which is why it read as "the only
one that does anything".

## Measurement (live, readonly-guarded)

`simulation/agent_tools/halo_reach_probe.cjs` (new) reads the drawn bulb and
halo radii straight out of the live instance matrices for one fixture of each
class, then replays the **exact bodies** of the two GUI handlers and re-reads.
Guards are the `vintage_sizing_capture` set: `__readonlyMode` forced true as an
accessor before any page script, the sACN-OUT socket (`:6972`) refused at the
`WebSocket` constructor, every save-server request counted with a loud failure on
any non-GET, and **no GUI controller ever touched** (that is the only path to
`debounceAutoSave`) — the handler bodies are replayed by hand and every param is
restored. Both runs reported **0 sACN-OUT enables, 0 save-server requests,
params restored**.

His live settings, read from the same pass: `globalPixelScale 1.9`,
`globalHaloScale 1.4`, `ledPixelSize 0.08`, `ledHaloSize 0.14`.

## There are two halo controls, and only one of them is global

| control | param | range | what it is |
|---|---|---|---|
| **Global Halo Size** (Lighting Controls) | `globalHaloScale` | 0.1–5 | **the global knob.** Multiplies the LED-bus/strand absolute radius AND drives the DMX rim multiple. This is the one that must reach everything, and now does. |
| **Halo Size** (LED strand folder) | `ledHaloSize` | 0.05–0.25 | the LED-bus **base** radius that Global Halo Size multiplies. DMX fixtures do not read it and are not supposed to — their halo is a rim around their own real bulb (`_73`). |

If the operator was dragging **Halo Size**, "none of the DMX lights" is correct
and by design; if he was dragging **Global Halo Size**, it was the two defects
above. Either way the requirement — one knob that moves everything — is now
satisfied by **Global Halo Size**. `Halo Size` is left as the LED base radius;
renaming or merging the two is a UI decision, not something to do silently.

## The fix

**`simulation/src/fixtures/led_halo.js`** — the halo gets its own, looser pitch
ceiling: `MAX_HALO_PITCH_MULTIPLE = 1.5` plus `clampHaloRadiusToPitch()`.

The two ceilings bound different things. `MAX_BULB_PITCH_FRACTION` protects
**opaque** cores — two solid spheres that touch destroy the "six distinct Edison
heads" read, and that is a real defect worth a hard bound. A halo is **additive
and transparent**; neighbouring halos merging is not a defect, it is how a run of
lights reads at night. Every LED-bus fixture already merges on purpose (a sign's
halos are *meant* to be one luminous sheet), and the LED strands the operator
points to as **correct** run a halo ~0.7× their own pitch — overlapping by 40 %.
The DMX halo was held to 0.54× pitch, tighter than the look he likes.

**1.5 is derived, not taste.** A multi-pixel fixture's bulb sits at `0.3 × pitch`;
its halo is that bulb × `dmxHaloRimMultiple`, which tops out at 5.0 at the slider
maximum. The smallest ceiling that lets the knob reach its top end at all is
therefore `0.3 × 5.0 = 1.5 × pitch`. Anything tighter pins the rim the moment the
bulb hits its own cap — which is precisely the bug. There is an explicit test
asserting this inequality, so the ceiling can never be tightened back into a
stall without a failure.

**`simulation/src/fixtures/dmx_fixture_runtime.js`** — the DMX halo now clamps
with `clampHaloRadiusToPitch(dmxHalo, this._minPixelPitch)` instead of borrowing
the bulb's clamp. The bulb's own ceiling is untouched (`_53` intact), and the
halo is still strictly outside its bulb at every setting (`_73` intact).

**`simulation/src/gui/gui_builder.js`** — the `globalHaloScale` handler now also
pushes `applyVisualSize()` to every LED strand. `applyVisualSize()` re-reads both
LED sizes; the strand **bulb** radius is `ledPixelSize` and does not consult
`globalPixelScale`, so this cannot disturb strand pixel size — readiness decision
item 11 ("Global Pixel Size can't reach LED strands") is deliberately left
exactly as it was, and there is a test asserting the halo knob leaves the strand
bulb alone.

## Caps, stated rather than silent

Nothing is capped anywhere below the slider maximum. At **haloScale 5** exactly,
two classes touch their ceiling:

- Vintage LED: 0.28125 = `0.1875 pitch × 1.5`
- Shehds bar: 0.0825 = `0.055 pitch × 1.5`

Both track the knob linearly across the entire range and only meet the bound at
the very top. The UKing par is single-pixel — no neighbour, no ceiling, linear
everywhere. LED-bus and strand halos have never had a pitch ceiling (their
merging is the intended look) and still do not.

At his working point (1.4) every DMX class now reports the same halo/bulb ratio
**2.12** = `dmxHaloRimMultiple(1.4)`, i.e. no class is being quietly held back.

## Profile dependence (from `_74`)

A halo only exists where the profile builds per-fixture emitters:

| profile | halos? | the knob |
|---|---|---|
| `full`, `emissive` | yes, every class | **live, global** — this is where he is (he can see TE sign halos) |
| `pixel_mapping` | **none, any class** (`emitterMode: 'none'`) | correctly inert — the only emitter is the scene-wide dot mesh |
| `edit`, `2d_pixels` | none | inert |

That is stated rather than fixed: a halo in `pixel_mapping` would mean building
the emitter meshes that profile exists to avoid.

**Coordinator's suspect 4 checked and cleared:** the scene-wide instanced-dot
layer from `_74` has no halo-ish visual of its own — it is a single opaque
`MeshBasicMaterial` sphere per pixel, answering Global *Pixel* Size only. It is
not a second halo path and it does not need the halo knob.

## Reload vs live

- **Strands, before the fix:** the knob did nothing live, but a page reload
  rebuilt them at the current value — so the setting was never lost, it just
  never applied until a reload. That intermittency is gone; it is live now.
- **Vintage / bars, before the fix:** a reload did **not** help. The ceiling is
  deterministic, so above haloScale 1.0 the halo was pinned at the same value
  no matter how the fixture was built. Only the code change fixes it.
- **After the fix:** every class updates on the drag. **No reload required** —
  though this session's earlier `_74` change does need one (readiness item 23),
  and one reload covers both.

## Tests

New `simulation/tests/global_halo_reach.test.js` (**+5**), the per-bus liveness
pin the coordinator asked for:

- **GLOBAL** — one fixture of every registered class plus a strand; the knob is
  driven through the real update path and every class's halo must grow across
  0.1 → 5 **and** at the midpoint, so a stall anywhere in the range fails (that
  is what would have caught this: the old bug was a stall in the *upper half*);
- **REACH** — a strand tracks the knob and lands exactly on the shared
  `ledHaloRadius()`, and the halo knob provably leaves the strand **bulb** alone;
- **CEILING** — the vintage light, at his own pixel size with its bulb sitting at
  the bulb ceiling, must exceed the old pin `bulbCeiling × HALO_RIM_FACTOR` at
  1.4 / 2.5 / 5, stay under its own ceiling, and stay strictly outside its bulb;
- the **derivation** as an assertion: `MAX_HALO_PITCH_MULTIPLE ≥
  MAX_BULB_PITCH_FRACTION × dmxHaloRimMultiple(5)`, plus the clamp's
  pass-through, zero-pitch and loud-throw behaviour;
- the single-pixel par is uncapped and exactly the rim multiple at every setting.

Updated `simulation/tests/dmx_halo_visibility.test.js` — the "dense DMX fixture
cannot smear" test now asserts the **halo's** ceiling instead of the bulb's. That
is a deliberate rule change under this operator order, documented in the test
body; the bound still exists and is still tested, it is just no longer the one
that stalled the knob. Every other assertion in that file (`_73`'s rim
guarantees, the LED-bus parity check) passes unmodified.

**Suite: 1237 / 1229 / 8** (was 1232 / 1224 / 8). +5 tests, **zero new
failures** — the same 8 known stale-model / scene-parity failures.
`node --check` clean on every touched file.

## What the operator should see

Drag **Global Halo Size** (Lighting Controls) in the `full` or `emissive`
profile. Every fixture should now respond as you move it — LED strands, the
vintage rail runs, the Shehds bars, the pars and the TE sign — with no reload and
no stall in the upper half of the slider. At your current 1.4 the vintage and bar
halos are already ~18 % larger than before (they were pinned); everything else is
unchanged at that value and simply keeps growing now when you drag up.

The LED strand folder's **Halo Size** remains what it was: the LED-bus base
radius that Global Halo Size multiplies. It does not and should not move DMX
fixtures.

## Files

- `simulation/src/fixtures/led_halo.js`
- `simulation/src/fixtures/dmx_fixture_runtime.js`
- `simulation/src/gui/gui_builder.js`
- `simulation/tests/global_halo_reach.test.js` (new)
- `simulation/tests/dmx_halo_visibility.test.js` (ceiling rule updated)
- `simulation/agent_tools/halo_reach_probe.cjs` (new)
