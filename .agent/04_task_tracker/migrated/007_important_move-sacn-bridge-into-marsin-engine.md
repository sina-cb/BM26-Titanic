# Move sACN bridge into marsin_engine so I/O survives browser-tab backgrounding

- **ID:** 007
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** Operator field report (2026-05-28) — "when I move to a different
  tab and the sim is no longer active, it causes issues for the sACN input,
  and sim stops or does something"
- **Location (current bridge architecture):**
  - `simulation/server/sacn_bridge.js` — standalone Node process, port 6971
    (sACN UDP IN → WS frames to browser)
  - `simulation/server/sacn_output_bridge.js` — standalone Node process, port
    6972 (WS frames from browser → sACN UDP OUT)
  - `simulation/src/dmx/sacn_input_source.js:55-60,240-268` — browser-side
    WS client to bridge 6971 (subscribes to sACN IN)
  - `simulation/src/dmx/sacn_output_client.js:1-200` — browser-side WS
    client to bridge 6972 (publishes DMX frames computed in the browser)
  - `simulation/src/core/animate.js:11` — browser render loop importing the
    output client; pixel work is computed in the browser frame loop
  - `marsin_engine/lib/sacn_output.js` — engine-side sACN Sender already
    exists; engine already knows how to talk sACN UDP directly, just not the
    INPUT half nor the WS hand-off to the browser
- **Created:** 2026-05-28
- **Updated:** 2026-05-28

## Description

Today the simulation web app is on the hot path for live sACN I/O. Two
standalone Node bridges (6971 IN, 6972 OUT) sit between the real sACN
network and the browser, and the browser is the entity computing DMX frames
and forwarding them. When the operator switches Chrome tabs (or the laptop
sleeps, or the screensaver triggers, or DevTools is opened in another
window), the browser throttles `requestAnimationFrame` and WebSocket
processing — DMX frames stop flowing to `sacn_output_bridge`, real
fixtures lose their feed, and the sACN input source can also stall on the
return path. Inevitable mid-show failure mode for a human operator who
will *certainly* tab away.

The marsin_engine Node service already runs continuously and already has
its own sACN output (`marsin_engine/lib/sacn_output.js` line 19 — uses the
`sacn` npm Sender directly). It also has its own WASM pattern runtime
(`marsin_engine/lib/marsin_wasm_runtime.js`) — i.e. it can compute DMX
frames server-side identically to the browser. The two "engines" duplicate
work today; the live-show path should be the engine, not the browser.

## Suggested fix

Phased migration (don't bundle):

**Phase 1 — Move sACN INPUT into marsin_engine.**
- Fold `simulation/server/sacn_bridge.js` into a `marsin_engine/lib/sacn_input.js`
  module. Same packages (`sacn` Receiver), same packet → frame fan-out, but
  living inside the engine process loop.
- Expose the received DMX frames as a new WS topic (e.g. `/ws/sacn-in`) on
  the existing api_server, mirroring the binary protocol the browser already
  speaks.
- `simulation/src/dmx/sacn_input_source.js` flips its `wsUrl` from the
  standalone bridge port 6971 to the engine's api_server port 6968. The
  binary protocol stays identical so the client doesn't need rewriting.
- Delete `simulation/server/sacn_bridge.js` once the engine path is live.

**Phase 2 — Move sACN OUTPUT into marsin_engine.**
- The engine already has `sacn_output.js`. Wire the engine's render loop
  to call `sendFrame()` per universe each tick.
- The browser stops being the renderer; `sacn_output_client.js` becomes
  read-only or is deleted. The visualization tab pulls DMX state from a
  WS topic (e.g. `/ws/viz`) for display only — if it backgrounds, the show
  is unaffected.
- Delete `simulation/server/sacn_output_bridge.js` once the engine path is
  live.

**Phase 3 — Browser becomes pure visualizer / control surface.**
- Remove the per-frame render loop in `simulation/src/core/animate.js`
  for live mode; replace with a viewer subscribed to engine state. Keep
  the browser's own renderer alive only for offline / demo mode (no
  sACN attached).
- Verify with a tab-switch test: open the visualizer, switch to a
  different tab for 60 s, return — fixtures should have stayed lit
  throughout, no DMX dropouts, no engine restart.

**Risk fences:**
- Phase 1 alone solves the OPERATOR-REPORTED symptom (sACN INPUT
  stalls). Land that first; Phases 2-3 are correctness improvements that
  can wait until after the event.
- Don't break the offline / static-host visualizer path
  (`simulation/src/core/static_host.js` shorts out the bridge connection
  on GitHub Pages — preserve that behaviour).
- Engine's existing sACN OUTPUT priority is 100 (line 22 of
  `sacn_output.js`); the bridge currently sends from the browser at the
  same priority. If both fire simultaneously during the migration window,
  whichever connects last wins per E1.31 spec — sequence the cutover
  carefully so the operator never sees two sources fighting.

## Why it matters

Live event reliability. Browser tab throttling is invisible to the operator
until fixtures go dark or freeze. The current architecture hands a
mission-critical pipeline (DMX output to physical fixtures, sACN ingest
from external consoles) to a process Chrome is free to deprioritize at any
moment for any reason — battery saver, alt-tab, screensaver, system load.
The engine is the right home for I/O; the browser should be UI only.

## Notes

- Two separate bridges today (`sacn_bridge.js` IN, `sacn_output_bridge.js`
  OUT) means two extra process supervision points for the operator. Folding
  into the engine eliminates both.
- The engine's existing `sacn_output.js` was written for direct-to-fixture
  send and `marsin_engine/states/.../deck_state.yaml`-style configuration —
  re-using it for the migration is straightforward, no new dependency.
- Tab-throttling reproducer: open the deployed sim, attach DevTools, switch
  to a different tab for 30s, watch the `[sACN Bridge]` frame rate counter
  drop from ~44 fps to single-digit. Frames don't "queue and replay" on
  return — they're dropped.
- Coordinator note: this task pairs naturally with task 001 (engine auth)
  since both touch `api_server.js` topic plumbing. Don't bundle commits,
  but the agent who does one will already be in the file for the other.
