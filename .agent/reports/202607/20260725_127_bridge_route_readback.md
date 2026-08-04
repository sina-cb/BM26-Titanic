# `_127` — The push's third check is now a MEASUREMENT: bridge route read-back

Developer thread, branch `feat/bm_readiness`. Subsystem: `simulation/` LED
controller push (docs/41 §4.5) + sACN bridge. **No git operations.**

Follows `_124` (device write read-back discipline). Operator order: the LED
chain works physically — now make the status line's third check as honest as
the first.

---

## 1. The gap

The per-output push reported three checks:

| Check | What it measured |
|---|---|
| `✓ device written + verified` | REAL — `/api/status` read back from the device |
| `✓ scene saved (patches projected)` | REAL — the save server's 200 over a disk write |
| `✓ bridge notified — routes follow` | **NOTHING** — the WS `setScene` send resolved; whether the bridge actually rebuilt its relay routes was taken on faith |

A bridge running old code, a recompute that refused the route (placeholder IP),
a bench mirror owning the destination, a parked output some stale patch still
routes — all rendered the same green "routes follow".

## 2. What ships

### The bridge grew a read-only introspection surface (same port, same socket)

The bridge has **no HTTP surface** — its surface IS the WS on `:6971`, the same
socket the `setScene` notify travels. So the introspection lives there:

- `{type:'getRoutes', reqId}` → `{type:'routes', reqId, routes[], engineOwned[],
  mirrorOwned[], activeScenes[]}` — answered from the bridge's **live sender
  maps** (`_routeEntries` / `_mirrorEntries`), not from what a recompute
  intended. Read-only; no state is touched.
- The wire shape is built by the pure `buildRouteTableSnapshot` in
  `lib/bridge_routing.cjs` (unit-tested), so the server's answer and the
  client's parser are pinned to one contract.
- **Same-socket FIFO is the ordering proof**: `recomputeRoutes` runs
  synchronously inside the `setScene` handler, so a `getRoutes` sent after the
  notify on the same socket is always answered from the post-save table. The
  bounded poll below is grace for a bridge mid-boot (boot gate held), never a
  wait-and-hope.

### The push reads the routes back (step 3 of the completion)

`persistAndNotifyAfterPush(io, routeExpectations)` → `{save, notify, confirm}`:

- The **expectation is stated BEFORE the device write**
  (`buildRouteExpectation`, new `src/dmx/led/bridge_route_confirm.js`): every
  universe an enabled output's strand walk occupies — **spill segments
  included**, via the same `projectLedStrandSegments` the patches projection
  uses — plus enable transitions; and every PARKED universe as a
  **must-be-ABSENT** claim scoped to this controller's IP.
- After a successful notify, `confirmBridgeRoutes` polls
  `SacnInputSource.queryRoutes()` (new; reqId-correlated, 2 s timeout,
  rejected on disconnect) — bounded: **5 reads × 400 ms ≈ 1.6 s max**. A broken
  transport (WS down, timeout, malformed/old-bridge reply) fails IMMEDIATELY;
  only an unmet expectation retries.
- Omitting the expectation is a confirm **failure**, not a skip — no caller
  gets an unmeasured ✓ by forgetting. `[]` is the one explicit skip (push-all
  where nothing pushed) and renders as "nothing was pushed, no routes to
  confirm".

### Semantics (memory/sacn-route-ownership, `_102` merge rules)

| Read-back shows | Verdict |
|---|---|
| pair in the RELAY table | confirmed |
| pair in `engineOwned` (engine delivers it directly; relay suppressed) | confirmed, tagged `[engine-direct]` — the one-writer arbitration working |
| pair the BENCH MIRROR owns | **error** — another writer composes that destination; the push's patch never reaches it |
| expected pair absent everywhere | **error** — named: `missing U31→10.x.x.60` |
| parked universe routed to this IP (any writer) | **error** — `parked U42→… IS routed (a parked output must stay dark)` |
| parked universe routed to a DIFFERENT IP | fine — the claim is scoped to this controller |

### The status line (one line, operator budget)

- Success: `✓ device written + verified · ✓ scene saved (patches projected) ·
  ✓ bridge routes confirmed (U30,U31→10.x.x.60)`
- Failure: `✋ bridge routes NOT confirmed: missing U31→10.x.x.60 — bridge
  relays 1 route(s) after 5 read(s); check the sACN bridge log` + the standing
  device-note tail, reworded for this step ("the sACN feed is NOT CONFIRMED",
  not "NOT updated" — the save and notify DID land).
- **Push all**: one read-back over the union of every pushed controller's
  expectation (each `pushed` result now carries its expectation).

## 3. Files

| File | Change |
|---|---|
| `simulation/src/dmx/led/bridge_route_confirm.js` | **NEW** — expectation builder, snapshot normalizer, assessment, sentences, bounded confirm poll (all pure / injected I/O) |
| `simulation/lib/bridge_routing.cjs` | `buildRouteTableSnapshot` (pure wire shape) |
| `simulation/server/sacn_bridge.js` | `getRoutes` WS handler (read-only), `_lastExcluded`/`_lastActiveScenes` kept for the reply, loud warn if the reply send fails |
| `simulation/src/dmx/sacn_input_source.js` | `queryRoutes(timeoutMs)`, `routes` message dispatch, in-flight queries rejected on socket teardown |
| `simulation/src/gui/led_discovery_panel.js` | io bag `confirmBridgeRoutes`, `persistAndNotifyAfterPush` step 3, `describePushCompletion` third-check rendering, expectation built pre-write in `runPerOutputPush` / `pushAllLedControllers`, dialog copy |
| `docs/41_led_controller_onboarding.md` | §4.5 — step 3 + the new sentences |
| `simulation/tests/bridge_route_readback.test.js` | **NEW** — 18 cases incl. a stub-bridge INTEGRATION over a real WebSocket (the stub answers with the REAL `buildRouteTableSnapshot`) |
| `simulation/tests/per_output_push.test.js` | S1/_69/_71 flows updated to the measured third check + `_127` confirm-step cases |
| `simulation/tests/led_controller_ui_round2.test.js` | fleet completion: union expectation, explicit empty-skip, expectations riding pushed results |

## 4. Test evidence

- `node --test tests/bridge_route_readback.test.js tests/per_output_push.test.js
  tests/led_controller_ui_round2.test.js tests/bridge_routing.test.js` →
  **169 pass / 0 fail**.
- Full sim `npm test` → **1736 tests, 1728 pass, 8 fail** — the identical
  pre-existing scene-content baseline `_124` recorded (strand drift, view-bit
  headroom, scene-block CLI, test_bench model parity), none in the push/bridge
  path. **No NEW failures**; +40 tests over the 1696 baseline are this wave's.
- No live probing: the operator's stack on :6969–:6972 was only read for
  context, never restarted or queried by a browser. The integration test runs
  its own stub bridge on an ephemeral port.

## 5. Notes / follow-ups

- The bridge process on the show machine must be **restarted** (launcher) to
  answer `getRoutes`; until then the third check fails loudly with "is it
  running current code? Restart the launcher." — which is the correct claim.
- The engine-direct tag surfaces when `marsin_engine/config.yaml` declares the
  controller; if the operator ever wants that to be a warning instead of a
  tagged ✓, it is one branch in `assessRouteReadback`.
- The sim-side monitor panel could render the same `getRoutes` snapshot as a
  live route table (operator visibility beyond the push moment) — not done
  here, UI-noise budget.
