# LED Fixture Family — Implementation Plan (for Opus)

**Date:** 2026-07-03 · **Author:** planning session with Sina (operator)
**Status:** PLAN — no code written yet. This document is the implementation
brief for a developer agent.

---

## 1. Story & intent (read this first)

Sina is carrying the **"Echoes of a Thousand Words"** DNA into the Titanic
lighting — a dedication to the living souls in Iran and everywhere else.
The end goal is a **TE Sign fixture** whose pixel map Sina is designing now.
Before that lands, we need the *machinery*: a first-class **LED fixture
family** so any LED arrangement — a line, a grid, the TE sign, whatever
comes next — can be authored, placed, patched, and driven like every other
fixture on the ship.

Current addressable-pixel census (counted 2026-07-03 from
`simulation/scenes/titanic/scene_config.yaml` + fixture models):
**970 pixels** (490 DMX: 20×ShehdsBar@18px + 16×VintageLed@6px +
34×UkingPar@1px; 480 rope LED: 8×40 + 8×20). Two 40-px grids bring the
ship to 1050.

## 2. Operator requirements (verbatim constraints)

1. **Two new LED fixtures** will be added to the Titanic scene. Sina places
   them himself — implementation adds them at placeholder positions.
2. First fixture type: **40 LEDs in a grid**.
3. Eventually: the **TE Sign fixture** — driven by a pixel map Sina is
   designing. The system must accept an arbitrary pixel map, not just
   parametric shapes. Ability to add **a line, a TE sign, a grid, …**
4. LED fixtures must be **100% compatible with the sim 3D vis — placement,
   rotation, selection, everything — following the same exact algorithms
   as DMX fixtures, WITHOUT duplicating code.**
5. **The rope LED design must NOT change.** `ledStrands`, the `LedStrand`
   class, and their export path are frozen. Everything here is additive.
6. Hardware topology: DMX fixtures live on DMX controllers (AC power).
   LED fixtures live on **Ango 4 (chroma.tech) pixel controllers**, powered
   by a **110 VAC → 24 VDC adapter**.

## 3. Architecture decision — LED fixture = fixture definition

The existing DMX-fixture pipeline **already does everything requirement 4
asks for**. The SHEHDS bar proves it: a fixture definition YAML declares N
pixels, each with per-pixel `channels` and a physical position in mm
(`dots: [[x, y, z]]`), and `DmxFixtureRuntime` renders them, moves them,
rotates them, applies per-pixel color, and the exporter emits per-pixel
world coordinates through the fixture's `matrixWorld`. A 40-LED grid — or
the TE sign — is *just a fixture definition with 40+ pixels at 2D
coordinates* and 3 channels (RGB) per pixel.

**Therefore: no new runtime class, no new exporter branch, no new GUI
section.** An LED fixture is a new fixture *type* registered in the
existing `fixture_definition_registry`, instantiated in the existing
`parLights` array, rendered by the existing `DmxFixtureRuntime`, exported
by the existing DMX branch of `generatePixelMap()`, patched by the existing
controller registry. The only genuinely new concepts are:

- a **generator tool** that authors LED fixture definition YAMLs from a
  shape spec (line / grid / arbitrary pixel-map file), and
- a **controller `kind`** (`dmx` | `led`) in the controller registry so an
  Ango 4 is distinguishable from a DMX gateway and mis-patching is loud.

The rope path (`LedStrand`, `params.ledStrands`, the `type: 'led'` strand
block in the exporter) is **not touched by any step below**. The exported
pixel `type` for LED fixtures stays `'dmx'` (it means "patched fixture
pixel", and the engine's sACN path keys off it); `fixtureType` +
definition metadata carry the LED identity. Do not overload the strand
`'led'` type.

## 4. Verified pipeline map (file:line, as of this commit)

| Stage | File | Anchor |
|---|---|---|
| Definition YAMLs | `simulation/dmx/fixtures/<name>/model_<ch>.yaml` | mirror `shehds_18_18w_led_bar/model_119.yaml` — `fixture_type`, `pixels[].channels`, `pixels[].dots` (mm), `controls` |
| Definition loading | `simulation/main.js` | fetch list ~`:300-304`, registration list ~`:509-513` — explicit per-file; new type = +1 fetch, +1 entry |
| Registry | `simulation/src/dmx/fixture_definition_registry.js` | keyed by `fixture_type`; `listTypes()` feeds the GUI add-dropdown automatically (`gui_builder.js:1753`) |
| Runtime (place/rotate/render/per-px color) | `simulation/src/fixtures/dmx_fixture_runtime.js` | pixels built from `fixtureDef.pixels` ~`:149-260`; `dots` are mm → ×0.001 local coords; `setPixelColorRGB` |
| Instantiation | `simulation/src/core/fixtures.js` | `rebuildParLights()` / `_buildFixtureAt()` — type-keyed via `getDefinition()` |
| GUI | `simulation/src/gui/gui_builder.js` | fixtureArray section; add-dropdown `:1748-1790` |
| Export | `simulation/src/dmx/pixelblaze_model_exporter.js` | DMX branch `:36-101` — per-pixel `localPos` → world; per-pixel `channels`; `patch` from universe/address |
| Patching | `simulation/src/dmx/controller_registry.js` | controllers → ports → universe → chain, absolute addresses, docs/33 |
| Engine out | `marsin_engine/engine.js` `:1050-1080` + `lib/sacn_output.js` | only pixels with `patch` get universes registered → sACN |

Rope path (frozen): `simulation/src/fixtures/led_strand.js`,
exporter `:204-234`, GUI `buildLedStrandsSection` (`gui_builder.js:4032`).

## 5. Work plan

### Phase A — generator tool: "LED designing"

New file `simulation/tools/gen_led_fixture.js` (Node, snake_case, imports
at top, no fallbacks — bad input crashes with a clear message):

```
node gen_led_fixture.js grid --cols 8 --rows 5 --pitch 50 --name te_led_grid
node gen_led_fixture.js line --count 40 --pitch 50 --name te_led_line
node gen_led_fixture.js map  --file <pixelmap.json> --name te_sign
```

- Output: `simulation/dmx/fixtures/<name>/model_<3N>.yaml`, byte-layout
  mirroring `model_119.yaml`: header comment, `fixture_type` (PascalCase,
  e.g. `TeLedGrid40`), `channel_mode`/footprint `3N`, `pixels[]` with
  `channels: {red: 3i+1, green: 3i+2, blue: 3i+3}` and
  `dots: [[x_mm, y_mm, 0]]` centered on the fixture origin.
- `map` mode input: JSON `{ name, pixels: [{x_mm, y_mm, z_mm?}, …] }` in
  wiring order — **this is the TE Sign entry point**; when Sina finishes
  his pixel map, it drops straight in with zero new code.
- Definition metadata block (new, additive keys the registry passes
  through): `bus: led`, `controller_family: ango_4`,
  `power: 110VAC→24VDC adapter`, `pixel_type: rgb`.

### Phase B — the 40-LED grid type + registration

1. Generate `simulation/dmx/fixtures/te_led_grid/model_120.yaml`
   (8×5 default, pitch 50 mm → 350×200 mm panel; confirm dims with Sina).
2. Register in `simulation/main.js`: add the fetch (~line 304) and the
   `{raw, file}` entry (~line 513). That alone puts `TeLedGrid40` in the
   GUI add-dropdown and the whole pipeline.
3. Runtime check, minimal code: `DmxFixtureRuntime` builds a beam mesh per
   pixel (~`:250`). A bare LED panel must not project 40 beam cones —
   honor a definition flag (e.g. `beam: none`) by skipping beam/spotlight
   creation for that pixel. This is the ONLY runtime edit anticipated;
   everything else (hitbox, gizmo, rotation, per-px color, export) is
   inherited. If beams turn out to be harmless/off by default, skip even
   this.
4. Sim-vis parity test: place one, drag it, rotate all three axes,
   screenshot via `.agent/01_skills/00_see_the_world.md`, confirm the 40
   dots track the body exactly like a ShehdsBar's 18 do.

### Phase C — Ango 4 controller kind

1. `controller_registry.js`: add optional `kind: 'dmx' | 'led'` per
   controller (absent → `'dmx'`, so every existing `controllers.yaml`
   loads byte-identically). Persist through save/load.
2. Validation as a `computeProjection()` violation (loud-but-recoverable,
   matching existing style): a fixture whose definition says `bus: led`
   chained on a `dmx` controller port — or vice versa — flags
   `bus_mismatch`. No silent fallback.
3. Controller panel UI: show the kind (e.g. `⚡ DMX` / `💡 LED (Ango 4)`)
   and a `kind` selector on add. Power notes (`AC` vs `110VAC→24VDC`) can
   ride the controller `name`/notes — do not build a BOM system now.
4. Capacity math is unchanged: Ango 4 speaks sACN; an RGB pixel = 3 ch,
   40-px grid = 120 ch, fits one universe (170 px max). 4 ports on the
   unit. **Open item:** if the TE Sign exceeds 170 px it cannot fit one
   universe/one chain entry — resolve when Sina's pixel map lands
   (options: split the sign into per-universe fixture segments, or add
   multi-universe footprint support; decide then, not now).

### Phase D — two Titanic instances

Add to `simulation/scenes/titanic/scene_config.yaml` `parLights`: two
`TeLedGrid40` fixtures, group `TE LED Grids`, placeholder positions on the
superstructure (Sina will re-place them in the sim). Add one Ango 4
controller (`kind: led`) in `controllers.yaml` and chain both grids on
port 1. Re-export the titanic model so `marsin_engine/models/titanic.js`
carries the 80 new pixels (patched → engine actually sACNs them).
Ship census after this: **1050 pixels**.

### Phase E — verification (before claiming merge-ready)

- Sim auto-checks: `.agent/00_gol/04_*` spec; engine: `05_*` spec.
- Screenshot passes per `00_see_the_world.md` (headless: `xvfb-run -a`,
  `--viewport 1280x720`), visually inspect the grid pixels.
- Pixel fidelity: `.agent/01_skills/06_engine_sim_pixel_fidelity.md` —
  run a pattern through the engine, confirm the 80 grid pixels animate in
  the sim via sACN, not just in pixelblaze-local mode.
- Full-stack smoke per `05_full_stack_smoke.md`.
- Regression: rope LEDs (`ledStrands`) render and animate exactly as
  before — zero diff expected in strand code paths.
- `python scripts/security_check.py --staged` before every commit
  (public repo).

## 6. Must-NOT-touch list

- `simulation/src/fixtures/led_strand.js` — frozen.
- `ledStrands` schema in any `scene_config.yaml` — frozen.
- Exporter strand block (`pixelblaze_model_exporter.js:204-234`) — frozen.
- Existing DMX fixture definitions and their YAMLs.
- `.agent/00_gol/00_codex.md` (operator-only, always).

## 7. Open questions for Sina

1. Grid geometry: 8×5 vs 5×8? Pitch (50 mm assumed)? Mounting plane?
2. Are BOTH new fixtures 40-px grids, or is the second one reserved for
   the TE Sign once its pixel map is ready?
3. TE Sign pixel count (determines the >170-px universe question in
   Phase C.4) and wiring order convention for the pixel-map JSON.
4. Fixture type naming: `TeLedGrid40` proposed — better name welcome.
5. Pixel hardware (WS2815/WS2811 at 24 V?) — only affects real-world Ango
   port config, not this codebase, but worth recording in the definition
   metadata.
