# Live Touch one-panel grid collapse

**Date:** 2026-08-14  
**Worktree:** `live_touch_bm_readiness_rebase`  
**Scope:** Live Touch internal panel layout and pixel-view readiness only. The
running stack was not restarted or stopped.

## Finding and repair

The dock manager had an explicit `MIN_OPEN = 2` floor. The existing layout
already removes an empty `.prow` and gives its sibling `flex: 1`; therefore the
two-panel floor was the only thing preventing the final panel from using the
complete available workspace.

`docs/ui/touch_control.html` now permits one open panel. When the operator
docks Color, Effects, and Groups, Spatial is the sole expanded panel, its
empty bottom row is `display: none`, and it fills the full content width and
height beneath the permanent meter strip. The individual rail restores and
Spatial true-fullscreen takeover retain their existing behavior.

The pixel-view source changed again during the validation window, making the
generated JSON stale a second time. `docs/ui/touch_control_pixel_views.json`
was regenerated; it is current and the running :6969 server serves the same
bytes.

## Regression and visual proof

- Added `simulation/agent_tools/live_touch_grid_collapse_test.cjs` and
  `npm run test:live-touch-grid`. The private-browser DOM/layout contract
  verifies a sole Spatial panel fills 1308 x 676 px of the 1308 px grid width,
  that the other row has `display: none`, that all individual rail restores
  work, and that Spatial fullscreen enters and exits cleanly.
- `npm run pixel-views:check` — pass.
- `node --test tests/touch_control_pixel_views.test.js` — 16 pass.
- CaptainPad visual proof on `http://127.0.0.1:6967/touch_control` — pass:
  the sole Spatial panel filled the available workspace, no stale-chart error
  occurred, and the pixel chart loaded. Evidence:
  `~/tmp/live_touch_grid_live_proof/captainpad_one_panel_full_workspace.png`.
- The live proof did not ARM Live Touch or write a lighting control. The
  engine was Mixer + disarmed before and after, with no owner lease.
