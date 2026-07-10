# LED strand: per-strand Pixel Size + Halo Size controls

Date: 2026-07-10
Branch: feat/led_integration
Scope: CODE ONLY. No git ops. Sim not booted (shared stack live on another
project); verified via unit tests only.

## What changed

Added two PER-STRAND visual controls — **Pixel Size** (bulb radius) and **Halo
Size** (halo radius) — to the LED strand editor card, wired to the rendered
geometry so they update live.

### `simulation/src/fixtures/led_strand.js`
- Exported the existing module defaults `LED_BULB_RADIUS` (0.05) and
  `LED_HALO_RADIUS` (0.14) so tests/GUI share one source of truth.
- Added `resolveSize(value, fallback)` — returns the value only when finite and
  positive, else the module default (a defined absent-field default, not a
  codex "fallback behavior").
- `rebuildVisuals()` now reads `this.config.pixelSize` / `this.config.haloSize`
  via `resolveSize(...)` for `bulbScale` / `haloScale`. Halo still multiplies by
  `params.globalHaloScale`; halo opacity behavior unchanged.
- Added public `applyVisualSize()` — a thin, intention-revealing alias for
  `rebuildVisuals()` that the GUI calls to re-render one strand live.

### `simulation/src/gui/gui_builder.js` (`renderStrandGUI`)
- Added two lil-gui number controls right after "LED Count":
  - `Pixel Size` — `.add(strand, 'pixelSize', 0.02, 0.5, 0.01)`
  - `Halo Size`  — `.add(strand, 'haloSize', 0.05, 1.5, 0.01)`
- Both seed the field if absent (`0.05` / `0.14`) and onChange call
  `window.ledStrandFixtures[i].applyVisualSize()` + `debounceAutoSave()` — one
  strand re-renders, no full rebuild.
- New-strand default object now seeds `pixelSize: 0.05, haloSize: 0.14` so new
  strands are explicit.

### Persistence
`pixelSize` / `haloSize` live on the strand config in `scene_config.ledStrands`
(structural, like `ledCount`) — no `patches.yaml` change. Absent field = module
default, so existing scenes without these fields render exactly as before.

## Defaults
- Pixel Size (bulb radius): **0.05** world units (= `LED_BULB_RADIUS`)
- Halo Size (halo radius): **0.14** world units (= `LED_HALO_RADIUS`, then
  ×`params.globalHaloScale`)

## Tests
Extended `simulation/tests/led_strand_visuals.test.js` (+4 tests, 14 total, all
pass via `node --test tests/led_strand_visuals.test.js`):
- explicit pixelSize/haloSize scale the bulb + halo instance geometry to those
  values;
- absent fields fall back to the module defaults;
- invalid values (0, negative, NaN, string, null) fall back to defaults;
- changing the config value + `applyVisualSize()` updates the geometry live.
Instance scale is read by decomposing the InstancedMesh instance matrix.

## Follow-up
Needs an operator SIM-VISUAL CHECK: I could not boot the sim (shared stack is
running the other project). Please open the LED strand card, drag Pixel Size /
Halo Size, and confirm the bulb/halo update live and read well at the chosen
ranges.
