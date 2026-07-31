# 20260725_60 — S3: bridge runtime universe subscription

Implementation of slice **S3** from the push/save workflow plan
(`20260725_58_push_save_workflow_plan.md` §7.1 / §8-S3). Sim-side only; no
engine code, no scene writes, no browser sessions, no device contact, no
server restarted.

---

## The defect this closes

The `sacn` package's `Receiver` filters inbound packets against its own
`universes` array and **drops non-members with no event at all**
(`node_modules/sacn/dist/receiver.js:22`). The bridge built that array **once
at boot** — from the all-scenes patches scan, or from the persisted
`colorWave.sacn_universes` override — and never called the package's
`addUniverse()`, which exists.

Meanwhile `recomputeRoutes()` re-reads `patches.yaml` on every save-triggered
`setScene` and happily mints a relay sender for whatever universe it finds. A
universe patched **after** boot therefore produced a route that logged
"Route created", showed up in the monitor panel, held an open sender — and
carried nothing, because no frame for that universe ever reached the packet
handler.

The operator was saved this session only by luck: his persisted override list
was `1..24`, which happened to cover the U21/U22 he mapped. The registry's
`nextUniverse` is already **27** — the first controller mapped past U24
reproduces the dark-LEDs day with a worse signature (every layer says
healthy).

Compounding it, the bridge's own "universe exceeds subscription range" warn
was **dead code for this case** — the packet is dropped inside the package,
one layer below, so the guard could never fire.

## What changed

### `simulation/lib/bridge_routing.cjs` (pure + injectable half)

- **`computeUniverseSubscriptionDiff({ subscribed, wanted })`** — pure. Diffs
  the receiver's current accept-list against every universe the bridge must be
  able to receive, with provenance strings merged and de-duplicated per
  universe. Returns `{ additions, invalid }`; `invalid` carries claims outside
  the E1.31 range (1–63999) so the caller can shout instead of dropping them
  (a fixture patched to universe 70000 is an authoring bug that must not
  vanish).
- **`applyUniverseSubscriptions({ receiver, wanted, reason, onLog, onError })`**
  — the small imperative half, with the receiver and both loggers **injected**
  so a fake `Receiver` can exercise the add path in a unit test. Returns
  `{ added, failed, invalid }`.
- New exports: `SACN_UNIVERSE_MIN`, `SACN_UNIVERSE_MAX`.

**Per-universe error isolation (not a fallback).** `socket.addMembership`
throws on some interfaces, and the package does *not* catch it inside
`addUniverse` — one bad universe would otherwise abort the whole
subscription. Each join is wrapped, the failure is logged loudly and names
exactly what was lost, and the loop continues. On failure the universe is
still pushed into the receiver's accept-list — which is **precisely what a
boot-time universe with a failing join does** (the package catches the
constructor-time throw and leaves the universe in `universes`), and it keeps
**unicast** sources working (the engine's loopback frames, the sim's own
prio-150 writer). What is genuinely lost is multicast reception on that
universe, and the log says so in those words.

### `simulation/server/sacn_bridge.js`

- `readSceneRoutePairs()` now returns `{ routes, universes }` instead of a bare
  array — `universes` is every universe the scene patches at all, including
  fixtures with no controller IP (they still have to reach the browsers).
  Returns `null` for a missing/unreadable file exactly as before.
- **`recomputeRoutes()` subscribes before it builds senders.** The wanted set
  is: the effective relay routes ∪ the engine-owned pairs the bridge
  deliberately does *not* relay (they still must reach the browsers) ∪ every
  universe the **active** scenes patch. Subscription happens *before* the
  sender diff so there is no window where a route is live and the receiver is
  still deaf.
- **Each runtime subscription logs once**, to console and to the monitor
  panel, with provenance and trigger:
  `runtime-subscribed U27 (scene 'titanic' patch; relay route → …) — client scene 'titanic'`.
  Repeat recomputes are silent no-ops (the diff sees the universe is already
  subscribed). Subscription **errors** are de-duplicated by message via
  `_warnedSubscriptionErrors` so a permanently-broken interface does not spam.
- **Never unsubscribes.** Dropping multicast memberships to chase the exact
  set would churn IGMP for no benefit; a stale subscription costs nothing.
- **The `MAX_UNIVERSE` drop guard is RETIRED**, per the plan. It could never
  fire (the package drops unsubscribed universes one layer below), and with
  runtime subscription it turned actively *harmful*: `MAX_UNIVERSE` was frozen
  at the boot list's largest entry, so the first frame on a newly subscribed
  U27 would have been dropped by the very guard meant to explain drops. It is
  replaced by the positive signal — a one-time
  `✅ First frame on U27 … — runtime-subscribed after boot` when a universe
  boot did not know about starts delivering. The boot set is snapshotted into
  `BOOT_UNIVERSES` **before** any runtime subscription, because the package
  keeps and mutates the very array handed to its constructor
  (`sacnOpts.universes` *is* `receiver.universes` after construction — a sharp
  edge worth knowing).
- Startup banner now labels the universe list `(boot)` and adds
  `Runtime Subscribe : ON`.

### `simulation/tests/bridge_routing.test.js`

Extended with 9 tests (file total 15 → 24, all passing):

- diff proposes only what the receiver lacks, ascending;
- **the U27 trap** — boot list `1..24`, routes on 21/22/27 ⇒ exactly `[27]`;
- provenance merged and de-duplicated per universe;
- unpatched / non-numeric universes are not claims;
- out-of-range universes land in `invalid`, never in `additions` (63999 edge
  still admitted);
- fake-Receiver add path: subscribes, mutates `universes`, logs **once** —
  a second apply is a silent no-op;
- throwing `addMembership`: loud, non-fatal, the *other* universe still joins,
  and the failed one stays accepted for unicast (boot parity);
- an out-of-range claim is shouted about, naming the fixture, and nothing is
  added.

## Test counts (honest)

`cd simulation && npm test`: **1088 tests, 1071 pass, 17 fail.**

- **8 fails = the known pre-existing stale-model family** (fixtures-docked,
  titanic block acceptance, view-bit headroom, the two CLI parity cases, the
  three real-scene model-freshness cases). Untouched, as instructed — they
  clear when the operator re-exports titanic and restarts the engine.
- **9 fails = another slice in flight, not this one**: 5 in
  `per_output_push.test.js` (R5 ×2, G7, G8 ×2) and 4 in
  `device_config_mapper.test.js` (`derivePerOutputPlan` ×4).
  `src/dmx/led/device_config_mapper.js` and `src/gui/led_discovery_panel.js`
  were being written *during* this run (mtimes minutes after mine) — that is
  the **S2** registry-aware-plan-gate work mid-edit. Neither file is touched
  by S3, and no test imports `sacn_bridge.js`.
- **This slice's own file: 24/24 pass**, up from 15/15 (+9, no regressions).
- `node --check` clean on all three touched files.

## ⚠ Restart required — OPERATOR-GATED

**This change does nothing on the show box until the sACN bridge process is
restarted, and the bridge was deliberately NOT restarted.** The operator is
live-mapping real hardware off this sim right now; any bridge restart briefly
drops the relay feeding his lit LEDs. Nothing was started, stopped, saved,
opened in a browser, or sent to a device during this work.

Until that restart, the boot-frozen subscription is still in force and the
U24 ceiling still applies. This is plan item §9.4 (operator-gated bridge
restart) and it is now **ready to collect** whenever a relay blip is
acceptable.

Post-restart, the expected evidence in the bridge log is a
`runtime-subscribed U…` line at boot for anything the active scene patches
beyond the boot list, and — the real proof — a
`✅ First frame on U… — runtime-subscribed after boot` the moment the engine
starts emitting on a newly mapped universe.

## Deviations from the spec

None material. Two judgement calls worth naming:

1. **Retired** the `MAX_UNIVERSE` guard rather than recomputing it (the plan
   allowed either). Recomputing would have preserved a check that is
   structurally unreachable; the replacement first-frame log gives the
   operator something the old guard never could — positive confirmation that
   a runtime subscription is delivering.
2. On a failed multicast join the universe is still admitted to the accept
   list. This is boot parity, not a silent fallback: the failure is logged at
   warn level, states that multicast on that universe will not be received,
   and is asserted in a test.

## Files

- `simulation/lib/bridge_routing.cjs` — pure diff + injectable apply, +2 constants
- `simulation/server/sacn_bridge.js` — subscribe on every recompute; guard retired
- `simulation/tests/bridge_routing.test.js` — +9 tests
