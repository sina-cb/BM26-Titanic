# 20260725_49 — LED halo parity: every LED fixture abides by the halo settings

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (3D render path only)
**Order (operator, relayed):** *"make sure the TE sign has halos too like the other
LEDs — all LED fixtures need to abide by the halo settings we have."*

## TL;DR

The TE Sign had **no halo at all**. Its render path (LED-bus fixtures inside
`DmxFixtureRuntime`) deliberately **skipped** the instanced halo and substituted
per-pixel diffusion Sprites that were gated on the per-fixture `diffusion`
toggle and sized from the pixel's **physical** size. Fixed by making the halo a
property of *being an LED fixture*, not of which class renders it: one shared
recipe (`src/fixtures/led_halo.js`) used by **both** LED render paths, sized
from `params.ledHaloSize × params.globalHaloScale` — the same settings LED
strands obey. A second, latent instance of the same gap was found and closed
(legacy `ModelFixture`). Nine new tests lock the rule down for every fixture
type shipped in `dmx/fixtures/`, present and future.

## Root cause

Two render paths owned two different "halos":

| Path | Halo | Radius | Gate |
|---|---|---|---|
| `led_strand.js` (LED strands) | instanced additive BackSide sphere | `params.ledHaloSize` (0.14) × `params.globalHaloScale` (3.6) = **0.504** world units | always on |
| `dmx_fixture_runtime.js`, `bus: led` (TE Sign A/B, TE LED Grid) | **no rim halo** — only per-pixel diffusion `Sprite`s | `bulbSize × LED_GLOW_SPAN` from the model YAML's `size: 12` (mm) ⇒ **0.028** × global × `diffusionAmount` ≈ **0.075** effective | only when `config.diffusion === true` |
| `dmx_fixture_runtime.js`, DMX bus (pars/bars) | instanced additive BackSide sphere | `bulbSize × 1.8 × globalHaloScale` (physical) | always on |

`dmx_fixture_runtime.js:341` was an explicit `if (this._isLed) { …sprites… }
else { …haloInst… }` — the LED branch **replaced** the halo instead of adding to
it. So an LED-bus fixture got a halo roughly **7× smaller** than the strand
beside it when diffusion was on, and **zero** halo when it was off. The TE Sign
in `scenes/titanic` runs `diffusion: true, diffusionAmount: 1.5`, i.e. the "7×
too small" case — visually indistinguishable from bare dots (see
`01_before_wide.png` / `02_before_close.png`).

Second: nothing pushed the **"Halo Size" / "Pixel Size"** sliders to LED-bus
fixtures at all. `applyLedSizeToAll` in `gui_builder.js` iterated
`window.ledStrandFixtures` only — the TE Sign lives in `window.parFixtures`, so
even a correctly-sized halo would not have tracked the setting.

## Fixture-type audit — every LED render path

| # | Path / class | LED? | Halo before | Action |
|---|---|---|---|---|
| 1 | `LedStrand` (`params.ledStrands`) | yes | correct | re-pointed at the shared recipe (behaviour unchanged) |
| 2 | `DmxFixtureRuntime`, `bus: led` — `TeSignV3A40`, `TeSignV3B34`, `TeLedGrid40` | yes | **MISSING** | **fixed** — instanced halo built, sized from the LED halo settings |
| 3 | `DmxFixtureRuntime`, `bus: dmx` — `UkingPar`, `ShehdsBar`, `VintageLed` | no | correct (physical rule) | unchanged, now via the shared material |
| 4 | `ModelFixture` (legacy, `params.dmxFixtures`) | any type | **MISSING** — per-pixel dot `Mesh`es, no halo, no `updateScales` | **fixed by routing**: an LED-bus model can no longer reach this class |
| 5 | `FogMachine` (`TEFogMachine`, `ChauvetHaze4D`) | no | n/a (fog volume) | untouched |
| 6 | `animate.js` `_pixelInstancedMesh` | mapping overlay | n/a (2D pixel-map dots) | untouched |

**#4 was a real, reachable gap, not dead code.** The "🔌 DMX Light Fixtures"
GUI section builds its type dropdown from *every* registered model
(`gui_builder.js` ~L5236), so an operator can add a **TE Sign** there; it lands
in `params.dmxFixtures`, and `fixtures.js` sent anything with a loaded
`fixtureModel` to `ModelFixture` — per-pixel meshes, no halo. It only looked
harmless because `params.dmxFixtures` is empty in every shipped scene today.

## Changes

All in simulation **source** — no scene file, model file, or
`src/gui/pixel_map/*` was touched.

- **NEW `simulation/src/fixtures/led_halo.js`** — the ONE halo recipe:
  `LED_HALO_RADIUS` / `LED_HALO_OPACITY`, `resolveLedSize()`,
  `ledHaloRadius([globalScale])` (reads `params.ledHaloSize ×
  params.globalHaloScale` fresh on every call), `createLedHaloMaterial()`, and
  `isLedBusFixture(def)` — the LED test is the **bus**, never a type name, so a
  future LED product gets the halo for free by declaring `bus: led`.
- **`src/fixtures/led_strand.js`** — uses the shared material + radius; keeps
  re-exporting `LED_HALO_RADIUS` for existing importers. No behaviour change.
- **`src/fixtures/dmx_fixture_runtime.js`** — the halo `InstancedMesh` is now
  built for **every** fixture; the LED diffusion Sprites became an *extra layer
  on top* rather than a replacement. `_rebuildBulbHaloMatrices` sizes an LED-bus
  fixture's halo from `ledHaloRadius(haloScale)` and a DMX fixture's from its
  physical pixel size (unchanged).
- **`src/gui/gui_builder.js`** — `applyLedSizeToAll` now also pushes
  `updateScales()` to LED-bus fixtures in `parFixtures` / `dmxSceneFixtures`, so
  the "Halo Size" and "Pixel Size" sliders move the sign live.
- **`src/core/fixtures.js`** — LED-bus models never take the legacy
  `ModelFixture` path; they fall through to `DmxFixtureRuntime`.
- **`src/gui/view_presets.js` + `agent_tools/agent_render.cjs`** — new
  `animateCameraToPose()` and `--camera x,y,z --target x,y,z [--label slug]`, so
  an agent can frame a detail without writing a throwaway preset into the
  operator-owned `scenes/*/cameras.yaml`. Documented in
  `.agent/skills/see_the_world.md`.

**Perf (memory `sim_perf_per_object_explosion`):** the fix adds **zero** objects
per pixel. The TE Sign's 74 pixels gained exactly **one** `InstancedMesh` per
half — the halo is one draw call regardless of pixel count, and a test asserts
there is exactly one BackSide instanced batch per fixture (never per-pixel halo
meshes). Fix #4 strictly *reduces* object count on that path.

## Tests

`simulation/tests/led_halo_parity.test.js` — 9 tests, all passing. It loads
**every** shipped model YAML from `dmx/fixtures/` into the real registry and
sweeps them, so a new fixture type is covered the moment it lands:

1. registry actually loaded (guards a silently empty sweep)
2. every fixture type builds exactly **one** halo `InstancedMesh`, count ==
   pixel count, never per-pixel halo objects
3. the halo material is the one shared additive/BackSide/no-depth-write recipe
4. every LED-bus fixture's halo radius **equals an LED strand's**, per pixel
5. the halo tracks `ledHaloSize × globalHaloScale` live through `updateScales()`
6. absent settings fall back to `LED_HALO_RADIUS`
7. the halo is independent of the `diffusion` toggle (the exact regression)
8. a driven pixel colors the halo instance, not just the bulb
9. diffusion sprites are an extra layer, not a replacement

## Auto-checks (`.agent/ops/sim_auto_checks.md`)

- `git diff --check -- simulation` — **PASS**
- `node --check` on every changed JS/CJS file — **PASS**
- `cd simulation && npm run check` — **900 tests, 892 pass, 8 fail**. The 8 are
  the known pre-existing set from the operator's stale titanic model export
  (`scene_model_parity` real-scene checks, view-bit headroom, fixture docking,
  the emit CLI pair). None are render/LED/halo tests; all halo + LED-strand
  visual tests pass.
- Scene ↔ model parity gate — **not applicable**: no scene YAML and no generated
  model changed.
- Browser smoke — the sim was driven live at `:6969` (`?scene=titanic&
  profile=full&renderer=webgl`) through `agent_render.cjs` for the captures
  below; page loaded, no uncaught page errors, fixtures render.
- GPU adapter — **no FPS number is reported here**; captures ran under
  SwiftShader (software GL, `--viewport 1280x720`) per the skill, which is valid
  for layout/regression checks and invalid for perf claims.

## Evidence

`~/tmp/te_sign_halo/` (also in `.agent_renders/`), same camera before/after:

| File | What it shows |
|---|---|
| `01_before_wide.png` | TE Sign as a sparse grid of hard dots, no glow |
| `02_before_close.png` | close-up: 74 bare red dots on the sign panel — zero halo |
| `03_after_close.png` | same camera: the sign reads as a continuous backlit glow |
| `04_after_wide.png` | same camera as 01: the sign now glows like the strand pixels in the same frame |
| `05_after_parity_sign_and_strands.png` | wide — sign glow and hull strand halos in one frame, same character |
| `06_after_strand_halos_reference.png` | strand halos close up, the look the sign now matches |

The operator-state banners in the captures ("ENGINE MODEL STALE", "N sim windows
connected", "UNSAVED CHANGES") come from the live stack, not from this change.

## Notes / follow-ups

- The sign's pixel pitch (~0.25 world units) is close to the strand pitch, so at
  the current settings (`ledHaloSize 0.14 × globalHaloScale 3.6 = 0.504`) the
  sign's halos merge into one luminous sheet — which is what a backlit sign
  should look like, and it now tracks the sliders if the operator wants it
  tighter.
- `ModelFixture` still renders its pixels as **per-pixel `Mesh`es with no halo**
  for DMX-bus types. No shipped scene uses `params.dmxFixtures`, so nothing
  renders through it today, but it is reachable from the DMX Fixtures GUI. Worth
  either deleting the class or folding it into `DmxFixtureRuntime` — filed as a
  follow-up, out of scope for this halo order.
