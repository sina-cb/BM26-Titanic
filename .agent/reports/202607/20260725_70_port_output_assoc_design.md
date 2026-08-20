# 20260725_70 — port → physical-output association: design

Design-only session (read-only against every source file; the `_69` agent was
concurrently rewriting the push timeout flow in `marsinled_client.js` +
`led_discovery_panel.js`). **No code, no scene writes, no device HTTP, no
browser session, no git ops.** Deliverable = this design + the ordered
implementation brief for `_71`.

Operator order (2026-07-30), as given:

1. *"Allow me to update the port→output-on-physical-controller settings in the
   UI for the LED controllers too."*
2. *(original)* *"Make sure the outputs are correspondingly enabled/disabled on
   the board when we push."*
3. *"Make sure we don't have repeating port→output associations."*
4. *"Make sure the push to LED enables and disables the outputs as needed and
   correctly — have an agent verify this whole workflow."*

**Order 2/4 were REVISED by the operator mid-design** (see §0). The design below
implements the revised semantics.

---

## 0. The mid-design revision — PARK, don't disable

Operator, mid-design: *"if it's easier — use port 4 only, by adding port 3 and
not using the universe at all. I think the controller can have all 4 ports
enabled at all times, and we just direct data to the port we need, right?"*

He is right, and it is the better design:

- **The push never turns an output OFF.** Nothing the sim does can dark a strand
  somebody wired outside the sim. The "confirm-dialog enable/disable transition
  list" from the original brief is therefore **not needed in that form** — there
  are no disable transitions to declare. What the dialog declares instead is the
  universe map (assigned + parked) and the one asymmetric write that remains
  (§2.3, enable-only).
- **"Off" means "no data routed here", not "output disabled".** An output with no
  card port is **PARKED** on a universe that the registry-wide claims gate
  (`_59`) proves nobody else owns. No patch record points at it, so no engine
  frame and no bridge relay route ever carries it; relay routes are unicast per
  `(universe, controllerIp)`, so the output sits enabled, subscribed, and
  **receives zero packets** — dark, with the device's own `dmx.timeoutMs: 3000`
  blackout holding it there.
- **No reboot churn.** Every per-output push reboots the device (docs/41 §4.3).
  Enable-toggling on every mapping edit would multiply reboots; parking is a
  universe-number change inside the same single push.

### The semantic change this supersedes (flag)

`_59` (slice S2) made `derivePerOutputPlan` **auto-extend** any enabled device
output with no card port row onto "the next free universe", registry-claim-aware.
That was a *repair* for a case the model could not express.

**This design replaces auto-extend with explicit PARKING** — same mechanism
(claims-gated free universe), but now a first-class, named, **persisted,
sticky** concept with its own UI surface and its own warning class, instead of an
anonymous per-push guess reported as a note in the confirm dialog. Concretely,
`_59` §"What changed" item 1's second bullet (auto-extend) is superseded; the
`collisions` gate, the claim index and the blocking refusal are **kept verbatim**
and get *more* to check (§4).

The `.60` U23 landmine (`_58` §4, `_59`) retires like this: output 3 (device
index 2) is enabled with no card port → it becomes a **parked** output, and the
next push re-parks it from U23 (owned by LeftFrontDeck) onto a claims-approved
free universe. No disable, no operator device-UI trip, no landmine.

---

## 1. Data model — an explicit per-port `output`

### 1.1 Today's implicit rule

`port.port - 1` **is** the device output index, in five places:

| file:line | use |
|---|---|
| `simulation/src/dmx/led/device_config_mapper.js:186` | `portByOutput.set(port.port - 1, port)` — the pushed plan's key |
| `simulation/src/dmx/led/device_config_mapper.js:272` | `autoAssignPerOutputUniverses` seed map |
| `simulation/src/dmx/led/led_patch_projection.js:189` | `outputIndex` stamped on every strand patch record |
| `simulation/src/gui/led_discovery_panel.js:171` | `deriveLayoutPreview` map key |
| `simulation/src/gui/controller_map_editor.js:1420` | port-row preview lookup |

plus `controller_registry.js:1038 nextLedOutputPortNumber` (the `+port`
lowest-free-slot rule, which exists ONLY because port number = output index) and
one downstream check, `simulation/lib/bench_section.cjs:277-280`
(`SRC_OUTPUT_INDEX_UNEXPECTED` warns when `patch.outputIndex !== port.port - 1`).

### 1.2 Decision D1 — persist `output` (1-based) on the LED port row

```yaml
ports:
  - port: 1
    output: 4          # ← NEW: the physical board output this row drives
    universe: 21
    startAddress: 1
    chain: [Left_Front_Left]
```

- **Name + base:** the field is `output`, **1-based**, to match the `port:` key
  next to it and every operator-facing string in the codebase (`output 3`,
  `⌁ output 2: …`). The device's 0-based `strands[]` index stays **derived**, at
  the device boundary only: `outputIndex = port.output - 1` — exactly where
  `port.port - 1` sits today. A 0-based field in YAML next to a 1-based `port:`
  is a mis-read waiting to happen on a playa night.
- **LED controllers only.** DMX port numbers are chain labels, not hardware
  indices; the field must not appear on DMX cards (a loader that stamps it there
  would invent meaning that does not exist).
- **Serialization is free**: `save-server.js:309-318` dumps the live registry
  object wholesale into `controllers.yaml`, so a new port field round-trips with
  no serializer change. The **loader** is the work: `createControllerRegistry`
  (`controller_registry.js:441-519`) rebuilds each port as
  `{port, universe, startAddress, chain}` and **drops unknown keys** — an
  unparsed `output` would be silently deleted on the first save.

### 1.3 Decision D2 — migration = identity, materialized at load

`output` absent on an LED port → **`output = port.port`** (identity: the exact
rule in force today, so nothing moves on load), materialized into the in-memory
port object and therefore written out on the next save. One `console.log` per
LED controller (not per port) naming the ports that took the default. This is the
same class as the existing `type`/`protocol`/`startAddress` load-time schema
defaults, not a runtime fallback: it happens once, loudly, and the file becomes
explicit afterwards.

Validation at load (`_71` step 1):

| condition | behaviour | why |
|---|---|---|
| `output` absent | identity default + one log line | schema migration |
| not an integer, or outside `1…LED_MAX_OUTPUTS` (16) | **THROW** (halt boot) | structural corruption; same treatment as a malformed `port:` |
| two ports on one controller share an `output` | **LOAD IT**, flag as an operational violation + block the push (§4) | a hand-edited duplicate must be fixable in the UI, not brick the sim. Precedent: `controller_registry.js:456-459` — range problems are operational because "treating them as corruption would brick the boot off a panel typo". A duplicate `port:` throws because it makes the row's *identity* ambiguous; a duplicate `output` leaves identity intact and only makes the *mapping* invalid. |

### 1.4 Registry / patches / downstream implications

- **`patches.yaml` DOES carry `outputIndex`** — per strand, via
  `main.js:567/590` → `__globalPatchTree` → `save-server.js:252-253` (verified:
  `scenes/titanic/patches.yaml:688,702`). Its meaning **stays "the physical
  device output"**, now derived from `port.output - 1`. Under a crossed mapping
  the value changes; that is the field doing its job.
- **`computeLedStrandPatches` must ALSO record `portNum: port.port`.**
  `led_patch_projection.js:310` currently derives the operator-facing port label
  from `rec.outputIndex + 1` — under a crossed mapping that names the **wrong
  card port** in every LED claim label, including the `_59` collision refusal
  text ("owned by X port 2"). Add `portNum` to the record and read it there.
- **`simulation/lib/bench_section.cjs:277-280`** must compare `patch.outputIndex`
  against the port's **declared** output (`port.output - 1`), not `port.port - 1`
  — otherwise every crossed mapping raises a spurious
  `SRC_OUTPUT_INDEX_UNEXPECTED` in the bench-parity tool.
- **`scene_model_parity.cjs` / the model exporter / the engine: no change.** The
  engine and the sACN mapper address by `(universe, channel)` only — which
  physical pin listens on that universe is device-side truth. Grepped: no
  `outputIndex` consumer in `simulation/lib/scene_model_parity.cjs`,
  `marsin_engine/**`, or the exporters.
- **`nextLedOutputPortNumber` / `+port` stays**, with its comment corrected: the
  "lowest free slot 1…16" rule now governs the **port row number** (keeps rows
  tidy and stable), while the physical output is the selector. A new port's
  `output` defaults to **the lowest output not already claimed by another port on
  this card** (identical to today's behaviour on a fresh card). The 16 ceiling
  stays — a MarsinLED addresses at most 16 outputs (docs/41 §4.2), so 17 rows
  could never all be driven.

### 1.5 The operator's "use port 4 only" pain — answered

With the selector, **one card port row can target output 4 directly**. He adds
one port (it lands as `P1`, default `output 1`), sets its output selector to
`4`, gives it his universe, maps the strand — done. No filler rows 1–3, no
"adding port 3 and not using the universe". Outputs 1–3, if enabled on the board,
become **parked** (§2.2): each carries a claims-approved universe nobody routes
to. `+port`'s lowest-free-*port*-slot behaviour composes cleanly because the port
number is now just a stable row identity.

---

## 2. Push semantics

### 2.1 The plan

`derivePerOutputPlan(controller, strandFixtures, deviceSnapshot,
claimedUniverses)` keeps its signature and returns a widened result:

```js
{
  universeByOutputIndex,   // EVERY output that will be enabled after the push → universe
  assignments: [{ outputIndex, portNum, universe }],
  parked:      [{ outputIndex, universe, reused: boolean }],
  enableOutputIndices: [], // outputs a port targets that are DISABLED on the device today
  warnings: [],            // loud, non-blocking notes
  collisions: [],          // BLOCKING (kept from _59, widened by §4)
}
```

Derivation, per device output slot `i` in `0 … deviceSnapshot.strands.length-1`:

1. **A card port targets `i`** (`port.output - 1 === i`) → `universeByOutputIndex[i] = port.universe`;
   record an `assignment`. If the device has `strands[i].enabled !== true`, add `i`
   to `enableOutputIndices` (§2.3). A port whose universe is invalid (≤0) keeps
   today's repair: `ensurePortUniverses` runs first, and any survivor is
   auto-assigned the next claims-free universe with a warning.
2. **No card port targets `i`, and the device has it ENABLED** → **park** it
   (§2.2): `universeByOutputIndex[i] = parkedUniverse`, record a `parked` entry.
3. **No card port targets `i`, and the device has it disabled** → untouched. No
   universe, no enable, not in the plan.
4. **Zero enabled outputs after all that** → blocking refusal ("a MarsinLED
   requires at least one enabled output — map a strand to a port first"). The
   firmware rule already exists in `validatePerOutputPlan`; catching it in the
   derive gives a better sentence.

### 2.2 Parking (decision D3: STICKY)

**A parked universe is persisted on the card and reused across pushes.**

```yaml
  - id: 4
    name: LeftLeftRopes
    type: LED
    ports: [...]
    parkedOutputs:              # ← NEW, LED cards only, 1-based `output`
      - output: 3
        universe: 27
```

**Why sticky and not re-derived per push:** a re-derived park moves whenever any
other controller takes a universe, and the sync chip compares device ≡ plan — so
a freshly-derived park that disagrees with the device's stored one reports
**drift** on a card nobody touched, and a push "fixes" it by rebooting the
device for a number change nobody asked for. That is exactly the phantom-drift
class `_59` was careful to close (its sync-chip test pair). Sticky parking makes
the chip quiet and the diffs meaningful.

Allocation rules (pure, testable):

- A parked universe is allocated **once**, through the registry's monotonic
  high-water mark (`nextFreeUniverse` + `noteUniverseUsed`, inside a `mutate`),
  so it is never handed out to real gear later.
- It must be **free across the whole registry** (the `_59` claim index) and must
  not equal any of this card's own port universes.
- It must fit the **≤16-universe window** (`validatePerOutputPlan` SPAN rule)
  measured across this controller's assigned **and** parked universes. The
  allocator therefore prefers the lowest free universe **at or above
  `min(assigned universes)`** that keeps the span ≤ 16; if no such universe
  exists it **refuses loudly** ("no free universe in the window U21–U36 for
  output 3 — free one up, or unpark by mapping a port to it"). Silently parking
  outside the window would earn a device 400 or a client-side throw with a
  cryptic message.
- **Re-park** happens only when the stored parked universe stops being valid:
  another controller has claimed it, or it collides with one of this card's port
  universes, or it falls outside the span window. Each re-park emits a warning
  line naming the old and new universe.
- Parked universes are **registry claims**: `collectClaimedUniverses` must
  include OTHER controllers' parked universes (and their strandless LED port
  universes — same hole, see §4) so no other card's push can take one.

### 2.3 The one asymmetric write: enable-only, never disable

If a card port targets an output the board currently has **disabled**, the push
**enables it** (`strands[i].enabled = true`). It never writes `enabled: false`,
ever, for any output.

- This is what makes his "drive output 4 from one row" work end-to-end: the
  `.60`'s fourth output is disabled today, and `validatePerOutputPlan` refuses a
  universe on a non-enabled output — without this rule the sim would have to send
  him to the device's own web UI.
- It is **add-only by construction**, so it cannot dark anything he wired outside
  the sim. That was the whole risk the original brief asked to mitigate.
- It is **declared in the confirm dialog**, per output:
  `output 4: DISABLED on the device → will be ENABLED (port 1 drives it, 40 px, U28)`,
  under its own heading. Nothing happens silently.
- Rejected alternative: **refuse** and tell the operator to enable it in the
  device UI. Honest, but it moves a routine sim action off-platform for no safety
  gain (enabling is not destructive), and he explicitly wants the outputs
  "enabled at all times".
- Also rejected: **auto-enable every output** on every push, to literally realize
  "all 4 enabled at all times". That is the sim deciding to drive hardware nobody
  mapped. Left as an operator decision (§7-3).

**Pixel count on enable.** `validatePerOutputPlan` requires `count ≥ 1` on every
enabled output. For an output being **newly enabled**, the sim writes
`count = the port's mapped pixel count` (sum of its chain's `ledCount`s) —
declared in the dialog on the same line. For an **already-enabled** output the
push **never touches `count`**: the physical strand length is hardware truth and
the sim's model is a belief (the open 20-vs-40 px question, tracker `_25`). A
mismatch there is reported as a warning line
(`output 1: device count 40 px, this card maps 20 px — count NOT changed`), never
a write. Rationale: enabling an unused output overwrites nothing; re-counting a
live output could.

### 2.4 Payload + verify

- `applyPerOutputUniverses(strands, universeByOutputIndex)` becomes
  **`applyPerOutputPlan(strands, plan)`** (one function, no dual path): sets
  `enabled: true` + `count` on `enableOutputIndices`, sets
  `dmxUniverse` + `dmxStartAddress: 1` on every key of `universeByOutputIndex`,
  copies everything else through untouched.
- **Validate the applied array, not the device's**:
  `const next = applyPerOutputPlan(config.strands, plan); validatePerOutputPlan(next, plan.universeByOutputIndex);`
  With that ordering, `validatePerOutputPlan`'s "enabled" notion is the
  **intended post-push** state and its ALL-OR-NONE / only-enabled-carry-a-universe
  / span / no-overlap rules need **no signature change**. (Today it validates the
  pre-push array, which cannot express an enable.)
- `pushPerOutputUniverses(ip, { plan, opts })` — the plan object replaces the bare
  `universeByOutputIndex`, and is **required** (no default that would restore
  today's "leave enable state alone" behaviour by accident; same reasoning as
  `_59`'s required claim index).
- **Verify covers the whole map.** After the reboot, `diffPerOutput` asserts, for
  every output in `universeByOutputIndex`: reported `universe` matches,
  `startAddress === 1`, `enabled === true` — which now covers the parked outputs
  and the newly-enabled ones as well as the assigned ones. Outputs outside the
  plan are **not** asserted (the push made no claim about them).
- **Compose with `_69`, do not duplicate it.** `_69` lands per-phase
  reboot-aware budgets and a timeout-then-read-back-confirms path. `_71` must
  extend `_69`'s read-back helper in place so the confirmation path checks the
  same widened map; a second parallel verify would drift.

---

## 3. Ordering vs the S1/S2 wave

Unchanged and load-bearing:

```
derive (S2 claims gate + §4 new gates)  →  BLOCKING refusal, no device write
  →  confirm dialog (declares: universe map, parked list, enable transitions, the scene save)
  →  device write + reboot + verify (_69's budgets)
  →  scene save (S1)  →  bridge notify (S1)
```

`startPerOutputPush`'s early return on collisions must stay **ahead of**
everything (`_59` note to S1); the new gates join the same `collisions` array so
they inherit that placement for free.

---

## 4. Uniqueness + range enforcement

Three new blocking conditions, all reported through the existing `collisions`
channel and the existing refusal dialog (`showPerOutputCollisionRefusal`) so
there is ONE refusal surface:

| kind | condition | message |
|---|---|---|
| `duplicate_output` | two ports on one card declare the same `output` | `ports 1 and 3 both drive output 2 — one physical output cannot take two universes; give each port its own output` |
| `output_out_of_range` | `port.output > deviceSnapshot.strands.length` | `port 1 drives output 5, but the device reports only 4 outputs` |
| `parked_span` / `parked_exhausted` | no claims-free universe fits the ≤16 window | §2.2 |

Kept verbatim from `_59`: `universe owned by another controller` (blocking) and
the claim-index-required throw.

**Two enforcement layers, as ordered:**

1. **UI, immediate.** The output selector renders options already taken by
   another port on the same card as **disabled**, suffixed `— taken by P2`, and
   `onchange` refuses + reverts with a toast if one is somehow chosen. The UI
   cannot express a duplicate.
2. **Push gate, blocking.** Because hand-edited YAML can (§1.3) and because the
   gate must not depend on the UI having been the author.

Plus a **loud non-blocking chip** on both offending port rows
(`validateLedManualUniverses` is the right home: a new `led_output_duplicate`
code alongside `led_universe_duplicate`), so a hand-edited file shows red in the
pane before anyone presses Push.

**Claim-index hole to close while here** (`_71` step 4): `collectClaimedUniverses`
builds its index from *strand patch* projections only, so an LED card's
**strandless port universe** and (now) its **parked universe** are invisible to
other cards' pushes. Both are universes the device actually subscribes to. Fix by
walking the `controllers` array that function already receives:
other controllers' LED ports → `"<name> port 2 → output 3"`, other controllers'
`parkedOutputs` → `"<name> output 3 (parked)"`. Ownership is trivial (skip
`c === controller`), so the ordinal-vs-id trap `_59` documented does not apply to
the new sources.

---

## 5. UI

### 5.1 The port row selector (`renderLedPort`, `controller_map_editor.js:1269`)

The row head is currently `[▾] [P1 · U] [universe#] [· N strand(s)] [🗑]`. After
`_50` the CARD header is two rows and can collapse; the port head is still one
line and must stay compact at `MIN_MAP` 320 px.

```
▾  P1 → out[4▾]  U[21]  · 1 strand(s)   🗑
```

- A `<select class="cm-input cm-num cm-led-output">` immediately after the port
  label; options `1…N` where **N = the device's reported output count** when a
  device snapshot is cached, else `1…16` (§5.2).
- Option labels carry the device's state when known: `3 — enabled, 40 px, U23`,
  `4 — disabled (push will enable it)`, `2 — taken by P2` (disabled option).
- `title`: *"Physical output on the board this port drives. Two ports may not
  drive the same output. The device's strands[] index is this number − 1."*
- **Non-identity marker:** when `port.output !== port.port`, the label renders
  `P1 →` in the accent style used for `cm-warn-chip`-adjacent hints and the
  collapsed card summary gains `· P1→O4` — a crossed mapping must be visible
  without expanding anything.
- `onchange` → `mutate('Port 1 → output 4 on <card>', …)` so it rides undo and
  marks the scene dirty like every other port edit.
- The derived-layout line below the chain becomes
  `⌁ P1 → output 4: U21 ch 1–160 · 40px` (it says `output ${port.port}` today,
  which would be a lie under a crossed mapping).

### 5.2 Card-level "device outputs" line

Under the device binding section, rendered only when a device snapshot is cached:

```
Board outputs: 1←P1(U21)  2←P2(U22)  3 parked U27  4 disabled
```

with a `title` explaining parked = *"enabled on the board, no data routed here —
it stays dark"*, and a small `↻ re-park` button that re-allocates a parked
universe (for the span/claim cases in §2.2). This is where the old U23 landmine
becomes visible **before** anyone opens the push dialog.

**Where the device snapshot comes from:** a new memory-only
`deviceOutputsCache` in `led_discovery_panel.js`, keyed `scene::controllerId`
exactly like `liveMacCache`/`syncCache`, populated from every `getConfig`/
`getStatus` the panel already performs (discover, bind, push, sync-chip refresh).
**Never persisted** — a stale on-disk output count would silently constrain the
selector on a machine that has not talked to the board. When the cache is empty
the selector offers 1…16 and its title says the range is unverified until the
device is read.

### 5.3 Confirm dialog

Sections, in order: (1) the existing reboot + "this also saves the scene"
declarations; (2) **Per-output mapping** — one line per output,
`output 4  ←  port 1  ·  U21  ·  start 1  ·  40 px`; (3) **Parked outputs** —
`output 3  ·  U27  ·  no port maps it — enabled on the board, nothing routes
here`; (4) **Outputs this push will ENABLE** (only when non-empty, styled as the
warning block); (5) warnings; (6) the JSON payload preview (already there).

### 5.4 Sync chip

`computeSyncState` must compare the **full map**, not just the assigned outputs:

- every output in `universeByOutputIndex` (assigned **and parked**): universe,
  `startAddress`, `enabled` — a device that re-parked itself or lost a parked
  universe reads as drift;
- every output in `enableOutputIndices`: reported as a pending change
  (`output 4: disabled → will be enabled`);
- a plan `collision` still forces drift with the collision text (`_59`).

Expected immediate consequence to warn the operator about: **the `.60` card will
show `▲ Drift` as soon as this lands**, because its output 3 sits on U23 while
the plan parks it elsewhere. That is the landmine finally becoming visible; one
push clears it.

The chip meaning string (`SYNC_CHIP_MEANING`, slice S5) gains "…the per-output
plan this page would push (which outputs are enabled, and the universe on each)"
— it now measures more than universes.

---

## 6. Verification plan (order 4: "have an agent verify this whole workflow")

### 6.1 Unit matrix — the exact tests `_71` must write

**`simulation/tests/controller_registry.test.js`** (data model)
1. LED port with no `output` loads as `output === port.port` (identity) and
   survives a round-trip; DMX ports gain **no** `output` field.
2. `output: 0`, `output: 17`, `output: "2"` each THROW at load with the field
   named.
3. Two ports with `output: 2` **LOAD** (no throw) — the duplicate is operational.
4. `addPort` on an LED card sets `output` = lowest output not claimed by another
   port; on a card whose ports already claim 1–3, a new port takes 4.
5. `parkedOutputs` round-trips; a malformed entry throws; a parked `output` equal
   to a port's `output` is rejected at load-validation level as operational (flag,
   not throw) and reported by §4's checker.

**`simulation/tests/per_output_push.test.js`** (derive + push, extend the S1/S2
sections)
6. **Identity mapping** (P1→out1, P2→out2) — plan identical to today's, byte for
   byte, no parked entries when the device has exactly those two enabled.
7. **Cross mapping** P1→out2, P2→out1 — `universeByOutputIndex` is `{0: U(P2), 1: U(P1)}`;
   assignments name the right port; the plan is NOT symmetric to the identity
   case (a test that fails against the pre-change module).
8. **Single row driving output 4** (the operator's case): one port, `output: 4`,
   device 4 outputs with 0/1/2 enabled and 3 disabled → out 3 (index) is in
   `enableOutputIndices` with `count` from the strand; outputs 0–2 are **parked**;
   **no output is disabled by the plan** (assert `applyPerOutputPlan` writes
   `enabled: false` **nowhere**).
9. **Portless enabled output is PARKED, not disabled** — the live `.60` repro
   (2-port card, 3 enabled device outputs, another controller owning U23): output
   index 2 gets a claims-free universe ≠ 23, appears in `parked`, and the payload
   keeps `enabled: true`.
10. **Sticky park** — a second derive with a stored `parkedOutputs` entry reuses
    the same universe (`reused: true`) and emits no warning.
11. **Re-park** — when another controller claims the stored parked universe, the
    plan moves it, `reused: false`, and a warning names old → new.
12. **Park respects the ≤16 window** — ports at U21/U22 with `nextUniverse` at
    U60 park within U21–U36; a rig where the window is full REFUSES with the
    span message (blocking, no device write).
13. **Uniqueness refusal** — two ports → output 2 produces a `duplicate_output`
    collision, the refusal dialog path returns before any `io.push*` call
    (assert the mocked device saw **zero** writes), and `pushAllLedControllers`
    marks only that card `failed` while the rest of the fleet pushes.
14. **Out-of-range refusal** — `output: 5` against a 4-strand snapshot →
    `output_out_of_range`, zero device writes.
15. **Claims index widened** — a card's strandless port universe and another
    card's parked universe both appear in `collectClaimedUniverses` with correct
    owner labels; a controller's OWN parked universe is excluded.
16. **Validation order** — `validatePerOutputPlan` runs on the APPLIED array: a
    plan enabling a previously-disabled output passes (it would throw
    "not an enabled strand" under the old ordering).
17. **`count` policy** — newly-enabled output gets `count` = mapped pixels;
    already-enabled output with a mismatching count keeps the device's `count`
    and produces a warning string.
18. **Verify covers parked + enabled** — a read-back where the parked output
    reports the old universe is a mismatch; where it reports the planned one and
    every assigned output matches, the push completes.
19. **`_69` composition** — a push whose write times out but whose read-back
    confirms the full map (assigned + parked + enable transition) reports
    success through `_69`'s path; a read-back missing the enable transition
    reports failure naming the device step, and the S1 save/notify never runs.
20. **S1/S2 regressions intact** — the persist→notify ordering test, the
    collision refusal, and the sync-chip agreement pair all still pass.

**`simulation/tests/led_controller_ui_round2.test.js`** (chip + UI logic)
21. `computeSyncState` reports **drift** when the device has a portless enabled
    output on a universe ≠ the parked one; **in-sync** once it matches.
22. `computeSyncState` reports drift naming the pending enable when a port
    targets a disabled output.
23. The selector's option model (pure helper — extract
    `outputSelectorOptions(controller, port, deviceSnapshot)` so it is testable
    without a DOM): taken options are disabled and labelled with the owning port;
    the device's output count bounds the range; with no snapshot the range is
    1…16 and flagged unverified.

**`simulation/tests/led_patch_projection.test.js`**
24. A crossed mapping stamps `outputIndex = port.output - 1` on the strand patch
    record while the LED claim label names the CARD port (`portNum = port.port`).

**`simulation/lib` / bench tool**
25. `bench_section.cjs` raises **no** `SRC_OUTPUT_INDEX_UNEXPECTED` for a legal
    crossed mapping, and still raises it when the patch record disagrees with the
    port's declared output.

Suite baseline to hold: **1161 / 1153 / 8** (the 8 known stale-model failures,
tracker `_68`). Zero new failures; every new test must be shown to fail against
the pre-change module where the brief says "falsified".

### 6.2 Live checklist (operator-gated — no agent runs this)

Under the standing lockdown, `_71` writes this checklist into its report and
**does not execute it**:

1. Open the Controllers pane on the `.60` card. Expect: `▲ Drift`, and the new
   `Board outputs:` line showing output 3 parked (§5.4's expected drift).
2. Set P1's output selector to `2` and P2's to `1` (a deliberate cross). Expect:
   both rows update, no duplicate offered, the derived lines read `P1 → output 2`.
3. Set both back to identity. Press **⬆ Push to controller**. Expect the dialog
   to list two assigned outputs, one parked output, zero enable transitions;
   after confirm: device✓ (through `_69`'s budgets) / scene saved✓ / bridge
   notified✓, LEDs unchanged and still lit, chip green.
4. Verify on the device (GET only): output 3's universe is the parked one, NOT
   U23; outputs 1–2 unchanged; **no output changed `enabled`**.
5. The output-4 case: add a port, set its output to `4`, map a strand, push.
   Expect the dialog's ENABLE block to name output 4 with its pixel count; after
   the push the strand lights from that physical output.
6. Duplicate check: try to set two ports to the same output — expect the option
   to be un-selectable, and (if forced via a hand-edited YAML) the push to refuse
   with the duplicate message and write nothing.

Each push costs one ~10 s device reboot; schedule with him.

---

## 7. Implementation brief for `_71` (single agent, ordered)

**Read first:** this report, `_69`'s report (per-phase timeout + read-back
contract — extend it, never fork it), `_59`, `_61`, docs/41 §3–§4.
**Constraints:** no git ops; no device HTTP; no scene writes; browser work only
under the `_50` guard pattern (blocked sACN-out WS, short session) and only if
the operator is not mid-session — otherwise defer visual proof to §6.2.

1. **Registry** — `simulation/src/dmx/controller_registry.js`
   - loader (`~:441-519`): parse/validate/default `output` on LED ports (§1.3);
     parse/validate `parkedOutputs`; one migration log per controller.
   - `addPort` (`:1051`): set `output` = lowest free output on LED cards; correct
     the `nextLedOutputPortNumber` comment (port number ≠ output index now).
   - new pure export `ledOutputIndexForPort(port)` (throws on a port with no
     integer `output`) — the ONE place `- 1` happens.
   - new pure helpers for parking: `parkedUniverseFor(controller, outputIndex)`,
     `setParkedUniverse(...)`, `clearParkedUniverse(...)`.
2. **Projection** — `simulation/src/dmx/led/led_patch_projection.js`
   - `computeLedStrandPatches` (`:189`): `outputIndex` from
     `ledOutputIndexForPort(port)`; add `portNum: port.port` to the record.
   - `computeLedUniverseClaims` (`:310`): label from `rec.portNum`.
   - `validateLedManualUniverses` (`:366`): add `led_output_duplicate` (two ports
     → one output) and `led_output_out_of_card_range` chips.
3. **Mapper** — `simulation/src/dmx/led/device_config_mapper.js`
   - `derivePerOutputPlan` (`:166`): the §2.1 rules; delete the portless
     auto-extend branch (`:221-240`) and replace it with parking (§2.2); widen the
     return; add the §4 collision kinds. Keep the claim-index requirement.
   - `collectClaimedUniverses` (`:72`): add other controllers' LED port universes
     and parked universes (§4).
   - `autoAssignPerOutputUniverses` (`:257`): key by `ledOutputIndexForPort`.
4. **Client** — `simulation/src/dmx/led/marsinled_client.js` *(shares files with
   `_69` — rebase on its landed result first)*
   - `applyPerOutputUniverses` → `applyPerOutputPlan(strands, plan)` (§2.4); no
     old export left behind.
   - `pushPerOutputUniverses(ip, { plan, opts })`: apply → validate the APPLIED
     array → POST. Plan required.
5. **Panel** — `simulation/src/gui/led_discovery_panel.js` *(shares files with
   `_69`)*
   - `deriveLayoutPreview` (`:165`): key by port number, label by output.
   - `diffPerOutput` / `perOutputChanges` / `computeSyncState`: full-map compare
     (§5.4), extending `_69`'s read-back helper.
   - `deviceOutputsCache` (§5.2) + exported pure `outputSelectorOptions(...)`.
   - confirm-dialog sections (§5.3); refusal dialog gains the new collision kinds.
6. **Editor** — `simulation/src/gui/controller_map_editor.js`
   - `renderLedPort` (`:1269`): the selector, the non-identity marker, the
     corrected derived line; card-level `Board outputs:` line + `↻ re-park`;
     collapsed summary marker.
7. **Bench tool** — `simulation/lib/bench_section.cjs:277-280`: compare against
   the declared output.
8. **Tests** — §6.1, all five files.
9. **Docs** — `docs/41_led_controller_onboarding.md` §3.2/§3.5/§4.1: a port is
   the output it DECLARES; parking replaces auto-extend; enable-only, never
   disable; `count` written only on an enable transition. (Doc-inconsistency
   standing order.)
10. **Report** `_71` with the §6.2 checklist verbatim, the suite delta, and any
    firmware-behaviour assumption that stayed unverified (notably: what
    `sacn.perOutput` reports for a parked-but-enabled output — the verify asserts
    the planned universe there and must say so).

---

## 8. Operator decisions surfaced

1. **Sticky parking is persisted** in `controllers.yaml` as `parkedOutputs` —
   new state in his scene file. Recommended; alternative is per-push re-derive
   with the phantom-drift cost (§2.2).
2. **Enable-only asymmetry** (§2.3): the push may switch an output ON, never OFF.
   Recommended as the safe reading of "all outputs enabled at all times".
3. **Auto-enable ALL outputs on push** — not built. Say the word if "the
   controller can have all 4 ports enabled at all times" means the sim should
   make that true rather than merely never undo it.
4. **`count` on an already-enabled output is never written** (§2.3) — this leaves
   the standing 20-vs-40 px question (tracker `_25`) exactly where it is, as a
   reported warning.
5. Live acceptance (§6.2) costs one device reboot per push and one scene save.
