# LED Fixture Family — Build Report

**Date:** 2026-07-03 · **Status:** BUILT & VISUALLY VERIFIED in the sim.
**Plan:** `.agent/02_reports/202607/20260703_1_led_fixture_family_plan.md`

## What shipped

An LED fixture family that rides the **exact same pipeline as every DMX
fixture** — no runtime code duplicated. An LED fixture is just a definition
YAML with N RGB pixels; `DmxFixtureRuntime` renders/places/rotates it, the
gizmo moves it, the GUI edits it, `pixelblaze_model_exporter` emits its
per-pixel world coordinates. The SHEHDS bar (a multi-pixel LED bar) was the
precedent; a grid is the same thing in 2D.

### Files

- **`simulation/tools/gen_led_fixture.js`** (new) — the "LED designing" tool.
  Authors LED fixture definition YAMLs from a shape spec:
  - `grid --name te_led_grid --cols 8 --rows 5 --pitch 50` (serpentine default)
  - `line --name te_led_line --count 40 --pitch 50`
  - `map  --name te_sign --file <pixels.json>` ← **the TE Sign entry point**;
    when Sina's pixel map is ready it drops in with zero new code.
  RGB pixels, channels `red 3i+1 / green 3i+2 / blue 3i+3`, `bus: led` +
  `controller_family: ango_4` + `power` metadata. Fails loudly on bad input.
- **`simulation/dmx/fixtures/te_led_grid/model_120.yaml`** (new, generated) —
  40 LEDs, 8×5 @ 50 mm pitch, 120 channels, `fixture_type: TeLedGrid40`.
- **`simulation/main.js`** — one fetch + one `fixtureModels` entry (mirrors the
  existing explicit-registration pattern for every other fixture). This alone
  makes `TeLedGrid40` appear in the GUI add-dropdown and the whole pipeline.
- **`simulation/src/dmx/fixture_definition_registry.js`** — passes the model's
  `bus` and `controller_family` through the definition (default `bus: 'dmx'`,
  so every existing definition is byte-identical).
- **`simulation/src/dmx/controller_registry.js`** — minimal, additive
  controller `kind` field (`dmx` | `led`, default `dmx`) in
  `createControllerRegistry` + `addController`. Round-trips through
  save/load/undo (verified). Counterpart to the fixture `bus` field.
- **`simulation/scenes/titanic/scene_config.yaml`** — two `TeLedGrid40`
  instances, group **TE LED Grids** (+32 lines; the `ledStrands` rope block
  has a **zero-line diff** — ropes untouched, as required).
- **`simulation/scenes/titanic/cameras.yaml`** — a `led-grids` framing camera
  preset (reuses the existing preset mechanism; used for the proof shots).

### Pixel census

Ship was 970 addressable pixels. Two 40-px grids → **1050**.

## Proof (sim screenshots, SwiftShader/headless)

1. **Added to the 3D vis** — both grids render as 8×5 pixel panels with shell
   + bloom halo, symmetric at x=±4.
2. **Config menus** — the Lighting Controls panel shows the full **TE LED
   Grid 1** card (Name, On, Brightness, color, Position, Rotation, Metadata)
   and, critically, **"DMX Patch: TeLedGrid40 - 120ch"** — the whole pipeline
   recognizes the new 120-channel LED type. **TE LED Grid 2** lists below it.
3. **Moving it** — driving the fixture's config (`x −4→12, y 9→4`, and a
   separate `rotZ 20°` case) and re-syncing re-rendered it live; a clean A/B
   shows Grid 1 relocate while Grid 2 stays fixed. Same transform path as the
   drag gizmo (`syncLightFromConfig` → `syncFromConfig`).

Rope-LED regression: strands render exactly as before; their code and config
were never touched.

## Deferred (documented follow-ups — NOT in this change)

These touch the P0 controller **patch projection** and warrant their own
tested change + operator input, so they were deliberately scoped out:

1. **Ango 4 controller wiring/patching.** Adding a controller to
   `controllers.yaml` flips the scene into "controller-mapping active" mode,
   which changes patch projection for ALL fixtures. The two grids currently
   run **sim-only / unpatched** — correct and sufficient for sim
   visualization, but they won't emit sACN from the engine until patched onto
   an Ango 4 (RGB = 3 ch/px, 40-px grid = 120 ch, fits one universe; 4 ports
   on the unit). The `kind: led` schema is in place to receive this.
2. **`bus_mismatch` validation.** Flag a `bus: led` fixture chained on a
   `dmx` controller (or vice versa) as a `computeProjection()` violation. The
   metadata on both sides (`bus` on the fixture, `kind` on the controller) is
   ready; the check itself is the remaining piece.
3. **TE Sign.** Author its pixel map, run `gen_led_fixture.js map`, register
   one line in `main.js`, place it. If it exceeds 170 px it won't fit one
   universe — split into per-universe fixture segments then.

## Open defaults chosen (no operator available to confirm)

- Grid: 8×5, 50 mm pitch, **serpentine** wiring (physical norm for panels;
  `--wiring row` available). Panel 400×250×30 mm. Type name `TeLedGrid40`.
- Both scene instances are the 40-px grid (the second is not reserved for the
  TE Sign — that lands later via `map` mode).
