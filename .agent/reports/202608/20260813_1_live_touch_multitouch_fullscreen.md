# Live Touch multitouch + Spatial fullscreen

Date: 2026-08-13
Worktree: `live_touch_bm_readiness_rebase`
Git operations: none

## Outcome

- Spatial mode accepts up to ten simultaneous touch pointers.
- Each pointer carries its own previous/target world coordinate, so the engine
  never draws a synthetic bridge between fingers.
- All active pointers are sent in one bounded, latest-value draw request and
  applied in one pixel traversal with one trail-decay pass.
- Lifting/cancelling one pointer retires only that stroke; other pointers remain
  active. The final point is stamped before the ordered retirement update.
- XY mode remains intentionally single-pointer because it controls one master
  and one rhythm scalar.
- A `FULL` control appears only in Spatial mode. It fills the Live Touch
  viewport, exits via `EXIT`, Escape, or switching back to XY, and does not
  change the normal two-row panel layout.

## Main files

- `docs/ui/touch_control.html`
- `docs/ui/touch_control_wire.js`
- `marsin_engine/effects/spatial_paint.js`
- `marsin_engine/lib/global_effects_controller.js`
- `marsin_engine/tests/effects/spatial_paint_order.test.js`
- `marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js`
- `simulation/agent_tools/live_touch_brush_perf_test.cjs`
- `docs/44_touch_control.md`
- `docs/45_touch_control_white_paper.md`

## Proof

- Spatial + client contracts: 47/47 pass.
- Existing revert/session isolation suite: 5/5 pass.
- Browser brush/UI gate: pass at 640/768/1024/1366 widths.
- Browser multitouch gate: two simultaneous handles; lifting one leaves one.
- Fullscreen geometry: exact 1024x768 panel at a 1024x768 viewport.
- 1,200-sample brush run: 599 preview composites, 240 retained ink stamps,
  zero static rebuilds/reprojections/canvas resizes, zero long tasks, and no
  trail or animation-frame residue after the maximum 1.5 s fade.
- Visual capture: `.agent_renders/live_touch_spatial_fullscreen_live.png`.

## Running stack

- CaptainPad `:6967`
- Engine `:6968` (restarted on the new code, model `titanic`)
- Sim/static `:6969`, save `:6970`, sACN bridges `:6971/:6972`

The engine shutdown used its confirmed in-band `/shutdown` path. The sim
launcher was restarted after its child services exited with the prior launcher.
