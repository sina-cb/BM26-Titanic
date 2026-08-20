# Live Touch ARM artifact repair

**Date:** 2026-08-14  
**Worktree:** `live_touch_bm_readiness_rebase`  
**Scope:** Live Touch ARM readiness only; the running operator launcher was never stopped, restarted, or mutated.

## Finding

The live engine was healthy: Performance Mode was active, the Mixer was the
active layer, and Live Touch was safely unarmed. Live Touch did not fail in
the Performance Mode guard, effect catalog, WebSocket connection, or arm-lease
acknowledgement. It refused before sending an ARM request because
`TouchPixelViews.canArm()` detected chart drift:

```text
chart: pixel-view artifact is stale against pixel_map_views.yaml
```

`docs/ui/touch_control_pixel_views.json` still described the former Top-Down
framing and source fingerprint, while
`simulation/scenes/titanic/pixel_map_views.yaml` had the authored current
framing. This fail-closed behavior correctly prevented a stale control chart
from acquiring a Live Touch lease.

## Repair

- Regenerated `docs/ui/touch_control_pixel_views.json` with
  `npm run pixel-views:export`.
- Updated `simulation/tests/touch_control_pixel_views.test.js` to assert that
  the resolved Top-Down framing is the current authored framing, instead of a
  stale hard-coded default.
- Added `simulation/agent_tools/live_touch_arm_lifecycle_test.cjs` and the
  `simulation` package command `test:live-touch-arm`. It starts an isolated,
  auth-required Performance Mode engine on high ports, routes all sACN to the
  loopback black hole, uses the real browser panel, proves ARM reaches the
  canonical Live Touch layer, then proves clean disarm returns to Deck without
  changing the global Performance lock.

## Verification

- `npm run pixel-views:check` — pass.
- `node --test tests/touch_control_pixel_views.test.js` — 16 pass.
- `npm run test:live-touch-arm` — pass (authentication required and
  Performance Mode active).
- `node --test tests/effects/live_touch_arm_latency_api.test.js` — pass.
- The running simulation served the regenerated artifact (HTTP 200; SHA-256
  exactly matched the checked-in file).

## Operator handoff

No launcher or engine restart is needed. The already-open Live Touch iframe
must use its **Reload** control (or the browser page can be refreshed) so it
fetches the repaired chart artifact; then ARM should be available normally.
