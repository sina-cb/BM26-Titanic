# sACN senders bind UDP :5568 and starve the sim receiver on localhost

- **ID:** 010
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** .agent/02_reports/202606/20260610_1_group_fixed_colors.md
- **Location:** simulation/server/sacn_bridge.js:138-146, marsin_engine/lib/sacn_output.js:36-46
- **Created:** 2026-06-10
- **Updated:** 2026-06-10

## Description
Three parties bind UDP `*:5568` with `reuseAddr: true`: the sim bridge's
sACN Receiver, the sim bridge's outbound relay Senders (one per
`patches.yaml` controllerIp route, recreated on every browser `setScene`),
and the engine's own Senders (the `sacn` npm package binds the send socket
to the port when `reuseAddr` is set). On Linux, inbound unicast to
127.0.0.1:5568 is delivered to only ONE of those sockets — in practice the
last one bound — so on a single-machine full-stack smoke the relay senders
silently steal the engine's frames from the receiver. Symptom: sACN IN
monitor shows `Connected` but FPS/FRAMES stay 0 (or trickle then stall).

## Suggested fix
- Stop binding the *sender* sockets to :5568. Senders don't need a fixed
  source port; bind to an ephemeral port (or only bind when an `iface` is
  actually specified). Applies to both `sacn_bridge.js` relay senders and
  `marsin_engine/lib/sacn_output.js`.
- If a fixed source port turns out to be required for some controller
  firmware, make it configurable and default it to 0 (ephemeral).

## Why it matters
`.agent/01_skills/05_full_stack_smoke.md` is the standard way to prove the
stack, and this makes its engine→sim leg fail nondeterministically on any
Linux box (it cost this session about an hour of triage). On the playa the
op rig validates locally the same way.

## Notes
Workaround used on 2026-06-10: start the engine before the sim so the
receiver binds last, and temporarily set test_bench `patches.yaml`
`controllerIp: 127.0.0.1` (the bridge skips relay routes for localhost).
Both reverted after the smoke.
