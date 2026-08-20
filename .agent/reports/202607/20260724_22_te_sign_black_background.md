# 20260724_22 — TE Sign black-background fix (LED fixtures render no opaque shell)

**Author:** Opus implementer · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-24

## Problem (operator, verbatim intent)

> "the TE sign shows a black background that causes some visual conflicts in the vis"
> — the bar should read as "a beautiful TE sign as a LED fixture."

The TE Sign V3 pair (`TeSignV3A40` + `TeSignV3B34`, group "TE Sign", at
`(0, 9, 17)` rotY 180 in `scenes/titanic/scene_config.yaml`) rendered the "TE"
logo LED dots sitting on a hard black rectangular slab that occluded and fought
the rest of the 3D scene.

## Reproduction (before)

Rendered via the puppeteer renderer against the operator's already-running stack
(readonly; never restarted anything), viewport 1280×720:

- `.agent_renders/1784943103_led-grids.png` — camera framing the sign head-on
  (`led-grids` preset, target `0,9,17`). The "TE" dots sit on an obvious black
  box with hard edges cutting into the red-lit scene. **This is the artifact.**
- `.agent_renders/1784943214_front.png` — full-ship context; the slab shows as a
  dark shape in the center gap between the two hull halves.

## Root cause

`simulation/src/fixtures/dmx_fixture_runtime.js` builds a fixture "shell" body
from the fixture-definition `shell` block. The TE Sign YAMLs
(`simulation/dmx/fixtures/te_sign_v3/model_a_120.yaml` /
`model_b_102.yaml`) declare a `shell: { type: box, color: "#0a0a0a", … }` — a
~1.2×1.5 m near-black box. The runtime rendered it as an opaque
`THREE.BoxGeometry` + unlit `MeshBasicMaterial`, i.e. a flat black rectangle
behind the LEDs.

The `shell` concept models a **physical opaque fixture body** — correct for DMX
pars/bars/fog machines, wrong for a **luminous LED sign**, which should read as
its pixels floating in space. The LED strand fixture (`led_strand.js`) and the
other LED-bus panel (`te_led_grid`, `bus: led`, no shell block) already have no
body mesh — the TE Sign was the outlier. (Note: an LED fixture with no shell
block was also hitting the runtime's fallback "can" cylinder — same class of
artifact — so this fix cleans that up for all LED-bus fixtures.)

## Fix

Gate shell construction on `!this._isLed` in the `DmxFixtureRuntime`
constructor. LED-bus fixtures now build **no body mesh at all** (neither the
declared shell box nor the fallback can); DMX fixtures are completely unchanged.

- `this.shellMat` / `this.shell` are left `null` for LED fixtures.
- `setSelected` / `setUnpatchedRed` already guard on `if (this.shellMat)`, so
  they no-op safely; selection feedback still shows via the `TransformControls`
  gizmo that `interaction.js` attaches to the fixture hitbox on select.
- `destroy()` already guards on `if (this.shell)`.

No change to the model YAMLs (the `shell` block is now simply ignored for LED
fixtures, so this is robust to the upcoming pixel-order model regen — nothing
model-order-specific was touched). No change to pixel positions, the A≡B
identical-transform invariant, group/patch behavior, or the InstancedMesh
emitter path.

**File changed:** `simulation/src/fixtures/dmx_fixture_runtime.js` (shell-build
block only).

## Verification (after)

Same renderer, same views:

- `.agent_renders/1784943334_led-grids.png` — the black box is gone; only the
  "TE" logo LED dots remain, floating against the scene.
- `.agent_renders/1784943380_front.png` — center gap is clean; no dark slab.
- `.agent_renders/1784943425_dramatic.png` — sign framed against the ship
  structure from a low angle; dots read as LEDs in space, no backing.

All PNGs visually inspected. (`.agent_renders/` is gitignored — paths are
ephemeral local artifacts.)

**2D pixel map:** the `te_sign` view in the 2D Pixel Map multiview was checked —
`pixel_map_renderer.js` only draws per-pixel shapes on the shared panel
background (plus dim off-bezels); there is no per-fixture shell/backing box in
the 2D path, so the artifact was 3D-only and the 2D view needed no change.

## Tests

`cd simulation && npm test` → **442 pass, 0 fail.** Includes the TE Sign
`buildTeSign` A≡B transform suite and the TE Sign grouping-parity suite — the
invariants and group/patch semantics are intact.
