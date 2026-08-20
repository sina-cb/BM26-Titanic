# 20260725_59 — S2: registry-aware per-output plan gate (the U23 defect)

Implementation of slice **S2** from `20260725_58_push_save_workflow_plan.md`
(§4 defect, §8/S2 spec). Code + unit tests only: **no browser session against
the sim, no scene save, no device HTTP, nothing started or restarted, no git
operations.** The operator was running lit hardware off this stack throughout.

---

## The defect (recap, `_58` §4)

`derivePerOutputPlan` auto-extends every ENABLED device output that has no
mapping port row (or a port left at an invalid universe) onto "the next free
universe". "Free" was measured against a `used` set holding **only this
device's own universes** — the registry's claims were never consulted. Live
consequence, verified on the device: the `.60` controller's third output
(enabled on hardware, no card port row) was auto-assigned **U23**, which
LeftFrontDeck (`10.x.x.11`) already owns for the Left Front Rails DMX chain.
Inert today (relay routes are unicast per (universe, IP), so U23 only ever
reaches `.11`) but armed: the moment anything routes U23 to the `.60`, rails
DMX data paints pixels.

## What changed

### 1. `simulation/src/dmx/led/device_config_mapper.js`

- **New export `collectClaimedUniverses(controller, {dmxUniverseMaps,
  ledClaims, controllers})`** — pure. Builds `Map<universe, ownerLabel>` of
  every universe claimed by a controller **other than** `controller`. The two
  claim sources key their owner differently (docs/33 decision 20), so
  ownership is resolved per source: DMX claims
  (`computeProjection().universeMaps`) carry the owner's **stable
  `controller.id`** plus `controllerName`; LED claims
  (`computeLedUniverseClaims()`) carry the owner's **1-based panel ordinal**,
  resolved against the `controllers` array for the name. Getting this wrong in
  either direction is a self-collision (a card refusing its own universes) or
  a missed claim, so both are covered by tests. A controller that is not in
  the registry array **throws** rather than silently producing an index that
  would collide with itself.
  Labels: `LeftFrontDeck port 1` (DMX) /
  `LeftLeftFront port 2 (LED strand 'Left_Back_Left')` (LED).

- **`derivePerOutputPlan(controller, strandFixtures, deviceSnapshot,
  claimedUniverses)`** — the claim index is a **required** 4th argument
  (anything without `.has()` throws). Defaulting it to "no claims" would
  re-open exactly this defect, so there is no default (codex P0).
  - Auto-extend now skips universes that are used **or claimed**: it picks
    universes free across the WHOLE registry.
  - An **explicit** port universe that lands on another controller's claim is
    recorded in a new third return field **`collisions`** —
    `{outputIndex, port, universe, owner, message}` with
    `message = "output 3 would take U23 — owned by LeftFrontDeck port 1"`.
    Operator-declared state is never silently re-assigned; the plan keeps the
    declared universe and the caller refuses.
  - The exhausted-range warning now says whether candidates were used or
    claimed. Existing warning texts are unchanged.

### 2. `simulation/src/gui/led_discovery_panel.js`

- New private `claimedUniversesFor(ctx, controller)` — pulls the index from
  `ctx.claimedUniverses(controller)` and **throws** if the ctx does not supply
  it or returns something without `.has()`. Never plan blind.
- `startPerOutputPush` (the ⬆ Push path): derives WITH claims; on any
  collision it sets the sync chip to drift and opens a new **blocking refusal
  dialog** (`showPerOutputCollisionRefusal`) naming both sides, plus an error
  toast. The confirm dialog never opens, so the device is not written. **No
  override path** — the operator edits the card's port universes and pushes
  again.
- `pushAllLedControllers`: same gate, per controller, BEFORE the device write
  — a colliding card is `state: 'failed'` with the collision detail and the
  rest of the fleet still pushes.
- `computeSyncState`: derives with the **same** claim index as the push (the
  `_58` §8/S2 risk note) so the chip and the push agree; a colliding plan
  reports `drift` with the collision text rather than a green chip for a plan
  a push would refuse. Now **exported** so the sync path is unit-testable.

### 3. `simulation/src/gui/controller_map_editor.js`

- New `claimedUniversesFor(controller)` (imports `collectClaimedUniverses`)
  computing a **fresh** `computeProjection()` + the existing
  `ledUniverseClaims()` — never the render cache, so a push always gates
  against the current mapping. Threaded into the LED panel via
  `ledCtx().claimedUniverses`.

### 4. Tests

- `simulation/tests/per_output_push.test.js` — **+11 tests** (new "Slice S2"
  section) plus the 4 pre-existing derive cases updated for the new argument:
  claim-index ownership/labelling (incl. the ordinal-vs-id trap and the
  not-in-registry refusal); **the exact live repro** (2-port card, 3 enabled
  device outputs, another controller owning U23 → auto-extend picks U24, no
  collision, warning names U24); explicit-collision blocking case with the
  exact refusal message; auto-extend walking past a run of claimed universes;
  refusal to derive without a claim index; the gate through
  `pushAllLedControllers` asserting **no `push:` call reaches the mocked
  device**; a registry-free card still pushing; and the sync-chip pair —
  same-claims ⇒ `in-sync` (no false drift) while a registry-**blind** ctx on
  the identical device reports the pre-S2 phantom drift `output 2: U24 → U23`,
  and a colliding plan reports drift. All device I/O mocked (`io` bag / stubbed
  `fetch`); no live device.
- `simulation/tests/led_controller_ui_round2.test.js`,
  `simulation/tests/led_discovery_scene_liveness.test.js` — their `ctx`
  factories gained `claimedUniverses: () => new Map()` (single-card rigs,
  nothing else claims a universe); behaviour of those cases is unchanged.

## Test counts

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| before | 1088 | 1080 | 8 |
| after | 1099 | 1091 | 8 |

The 8 failures are the **known pre-existing stale-model family** and are
byte-identical before and after (TE Sign V3 A/B duplicate scene names +
stale `test_bench`/`titanic` model exports): `fixtures are docked beside the
ship…`, `the real titanic scene can accept the block today…`, `view-bit
headroom is REPORTED…`, the two `CLI:` parity cases, and the three
`real scene …` cases. They clear on the operator's one sim-save, per R8.
Not touched.

`node --check` (as an ES module) passes on every file edited.

## Deviations from the S2 spec

1. **`collisions` is a returned field, not a throw.** `derivePerOutputPlan`
   stays pure and non-throwing for a derivable-but-colliding plan so the sync
   chip can render the same finding the push refuses on. The **blocking**
   half lives in the two push callers (single push: refusal dialog; push-all:
   per-controller failure) — behaviourally the spec's "blocking refusal, no
   override path".
2. **The claim index is required, not optional.** The spec says
   "`derivePerOutputPlan` takes a `claimedUniverses` set"; an optional
   parameter with an empty default would let any future caller silently
   restore the defect, so a missing/invalid index throws.
3. **`computeSyncState` is now exported.** Needed to unit-test the "chip and
   push agree" requirement (test (c)); no behaviour change for callers.
4. The refusal is rendered as a modal dialog rather than the confirm
   dialog's note line — the note line is what the plan says must *stop* being
   the surfacing, and a multi-line collision list is unreadable as a toast.
   A toast still fires alongside it.

## Notes for the S1 agent (push completes the loop)

- The gate is **pre-flight** and already sits before the device write in both
  push paths — S1's new persist+notify steps go **after**
  `pushPerOutputVerifyRecord`, so the two do not overlap. `startPerOutputPush`
  now returns early (no confirm dialog) on a collision; S1 must keep that
  early return ahead of any save/notify wiring.
- `ctx` gained a required member: **`claimedUniverses(controller)`**. Any new
  ctx built in an S1 test must supply it (a `new Map()` is enough for a
  single-card rig) or the derive throws.
- `derivePerOutputPlan` returns **three** fields now
  (`universeByOutputIndex`, `warnings`, `collisions`).
- `computeSyncState` is exported from `led_discovery_panel.js` if S1 wants to
  assert chip state after its new steps.

## Untouched / out of scope

- No `simulation/scenes/**`, no `marsin_engine/models/**`, no engine code, no
  server code, no bridge code (S3's file).
- Nothing about the operator item "the `.60`'s output 3": post-S2 a re-push
  would auto-assign it a FREE universe instead of U23, but the device still
  carries U23 until the operator either disables that output or maps it and
  re-pushes (`_58` §9.2).
