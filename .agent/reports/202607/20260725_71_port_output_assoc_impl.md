# 20260725_71 — port → physical-output association: implementation + verification

Implementation of `20260725_70_port_output_assoc_design.md`, rebased on `_69`
(reboot-aware push) and composing with `_59` (claims gate) / `_61` (per-step
dialog). **Code + unit tests only: no browser session against the sim, no scene
save, no device HTTP (not even a GET), nothing started or restarted, no git
operations.** The operator was running lit hardware off this stack throughout;
the live acceptance checklist (§6) is operator-gated and was NOT executed.

Headline: an LED card port now **declares** the physical board output it drives
(`output:`, 1-based). The push **never disables an output** — an enabled output
no port drives is **parked** on a claims-free universe (subscribed, unrouted,
dark), and the one write that can change an enable flag turns an output **ON**.

---

## 1. What landed, per design step

### Step 1 — registry (`simulation/src/dmx/controller_registry.js`)

- **Loader parses `output` on LED ports** (the real work: the loader rebuilds
  each port as `{port, universe, startAddress, chain}` and drops unknown keys, so
  an unparsed field would be deleted on the first save). Absent ⇒ **identity**
  (`output = port`), materialized into the in-memory port. Not an integer, or
  outside `1…LED_MAX_OUTPUTS` ⇒ **THROW**, naming the controller, the port and
  the value. A **duplicate** output loads (identity intact, only the mapping is
  invalid) and is caught by the chips + the push gate.
- **DMX ports gain no `output`** — a DMX port number is a chain label, not a
  hardware index.
- Migration surfaced as non-enumerable `registry._ledOutputMigrations`
  (`id → {name, ports[]}`), logged by `main.js` as **one line per card**, in the
  same shape as `_untypedControllers` / `_unprotocolledControllers`.
- **`parkedOutputs:` parsed** on LED cards (`[{output, universe}]`): type/range
  errors, duplicate entries, and a park on a DMX card all THROW; a park on an
  output a port drives **loads** and is flagged (operational). Parked universes
  now move the registry's **monotonic universe high-water mark**, so a later
  `addPort` can never hand a parked number to real gear.
- New pure exports: **`ledOutputIndexForPort(port)`** — the ONE place `- 1`
  happens, throwing on a port with no integer `output`; `nextLedOutputNumber`;
  `parkedUniverseFor` / `setParkedUniverse` / `clearParkedUniverse`.
- `addPort` stamps `output` = the lowest output no other row on the card claims
  (identical to the old behaviour on a fresh card). `nextLedOutputPortNumber`'s
  comment corrected: the lowest-free rule now governs the **row identity**.
- **Not in the design, required for correctness:** `setControllerType` DMX→LED
  materializes `output` on every existing port (otherwise the first render of a
  flipped card throws in `ledOutputIndexForPort`); LED→DMX strips `output` and
  `parkedOutputs` (the loader refuses them on a DMX card, so leaving them would
  brick the next boot). Two tests cover both directions.

### Step 2 — projection (`simulation/src/dmx/led/led_patch_projection.js`)

- `computeLedStrandPatches` takes `outputIndex` from `ledOutputIndexForPort(port)`
  and records **`portNum: port.port`** on every strand record.
- `computeLedUniverseClaims` labels from `rec.portNum` — closing the design's
  `:310` hole, where a crossed mapping named the **wrong card port** in every LED
  claim label, including `_59`'s collision refusal text.
- `validateLedManualUniverses` gains three chips:
  `led_output_duplicate` (two rows on one output — red in the pane before anyone
  presses Push), `led_output_out_of_card_range`, `led_parked_output_conflict`.

### Step 3 — mapper (`simulation/src/dmx/led/device_config_mapper.js`)

`derivePerOutputPlan` returns the widened plan
(`universeByOutputIndex`, `assignments`, `parked`, `enableOutputIndices`,
`enables`, `warnings`, `collisions`) and implements §2.1/§2.2 verbatim, with the
portless auto-extend branch replaced by **parking**:

- a stored park is **reused** (`reused: true`, no warning) unless it stops being
  valid — claimed by another controller, colliding with one of this card's port
  universes, already handed to another output, or outside the ≤16 window — in
  which case it is **re-parked** with a warning naming old → new;
- allocation picks the **lowest universe free across the whole registry at or
  above the plan's anchor** that keeps the span ≤ 16; an exhausted window is a
  **blocking `parked_span` refusal**, never a park outside the window;
- new blocking kinds join the existing `collisions` channel (so they inherit
  `startPerOutputPush`'s early return for free): `duplicate_output`,
  `output_out_of_range`, `parked_span`, `no_enabled_output`. `universe_owned` is
  kept verbatim from `_59`, message and all.
- `collectClaimedUniverses` now also indexes **other controllers' LED port
  universes** (`"<name> port 2 → output 3"`) and their **parked universes**
  (`"<name> output 3 (parked)"`) — the strandless-port hole the design found,
  plus the new park source. Own claims are still excluded by reference.
- `autoAssignPerOutputUniverses` keys by `ledOutputIndexForPort`.

### Step 4 — client (`simulation/src/dmx/led/marsinled_client.js`)

- `applyPerOutputUniverses` → **`applyPerOutputPlan(strands, plan)`**; no old
  export left behind. It sets `enabled: true` + `count` on `plan.enables`,
  `dmxUniverse` + `dmxStartAddress: 1` on every key of `universeByOutputIndex`
  (assigned **and** parked), and copies everything else through. It never writes
  `enabled: false`.
- `pushPerOutputUniverses(ip, { plan, opts })` — the plan is **required** (a bare
  universe map is refused with a message saying why), and the order is now
  **apply → validate the APPLIED array → POST**, so `validatePerOutputPlan`'s
  "enabled" notion is the intended post-push state and its signature is
  unchanged. `_69`'s `{readTimeoutMs, writeTimeoutMs}` contract, the flat-timeout
  refusal and the `writeResponseLost` classification are untouched.

### Step 5 — panel (`simulation/src/gui/led_discovery_panel.js`)

- `deriveLayoutPreview` is **keyed by port number, labelled by output**, and each
  entry carries `portNum` / `output` / `outputIndex`.
- **`_69`'s read-back helper `diffPerOutput` was EXTENDED in place**, not forked:
  it now asserts over the full `plan.universeByOutputIndex` (assigned + parked +
  newly enabled), and names a missing enable specifically
  (`output N: this push should have ENABLED it, device reports enabled=false`).
  The lost-reply arbitration path calls the same helper, so the ambiguous-write
  verdict covers the whole map.
- `perOutputChanges` / `computeSyncState` compare the same full map with the same
  claims and the same derive as the push. A pending enable reads as
  `output N: disabled → enabled · U22` rather than a universe diff against an
  output that is off.
- New memory-only **`deviceOutputsCache`** (`scene::controllerId`, exactly like
  `liveMacCache`/`syncCache`), populated from every `getConfig`/`getStatus` the
  panel already performs, plus exported pure **`outputSelectorOptions(controller,
  port, deviceOutputs)`**.
- Confirm dialog sections per §5.3: reboot + saves-scene declarations →
  **Per-output mapping** (`output 4 ← port 1 · U21 · start 1 · 40 px`) →
  **Parked outputs** → **Outputs this push will ENABLE** (its own warning block,
  only when non-empty) → warnings → payload preview.
- On a verified push the plan's parks are **persisted** (`setParkedUniverse` +
  `noteUniverseUsed`) and any park on a now-driven output is dropped, inside the
  same `ctx.mutate` that records provenance.
- One shared `describeCollisions()` builds the refusal sentence for the chip, the
  dialog toast and the fleet detail, so the three can never disagree.

### Step 6 — editor (`simulation/src/gui/controller_map_editor.js`)

Port row head is now `▾ P1 → out[4▾] U[21] · 1 strand(s) 🗑`. The selector's
options come from `outputSelectorOptions` (taken options **disabled** and
labelled `3 — taken by P2`; free options carry the board's state,
`2 — enabled, 40 px, U24` / `4 — disabled (push will enable it)`); `onchange`
refuses + reverts with a toast if a duplicate is somehow chosen, and rides
`mutate` (undo + dirty). A crossed row renders `P1 →` in the warning accent, the
derived line reads `⌁ P1 → output 4: U21 ch 1–160 · 40px`, and the collapsed card
summary gains `· P1→O4`. Card-level `Board outputs: 1←P1(U21) 2←P2(U22)
3 parked U27 4 disabled` renders only when the device has actually been read,
with a `↻ re-park` button.

### Step 7 — bench tool (`simulation/lib/bench_section.cjs`)

`SRC_OUTPUT_INDEX_UNEXPECTED` compares against the port's **declared** output
(`port.output - 1`), falling back to the port number when the field is absent —
the same identity migration the loader applies, so a pre-selector
`controllers.yaml` reads unchanged. `output` and `parkedOutputs` were added to
the derived-block key order (`orderKeys` drops undefined values, so absent fields
emit exactly what they did before and the block digest is unaffected).

### Steps 8–9 — tests + docs

25-case matrix below; `docs/41_led_controller_onboarding.md` §3.2 rewritten
("a controller port DECLARES the output it drives"), new §3.2.1 on parking and
the enable-only asymmetry, §3.4 worked example extended with the output-4 case,
§3.5 updated for applied-array validation, the widened claim index and the three
new blocking findings.

---

## 2. The operator's four asks — explicit verdicts

**1. "Allow me to update the port→output settings in the UI for the LED
controllers too." — MET (unit-proven; visual confirmation is operator-gated).**
Every LED port row carries a `<select>` of the board's outputs, wired through
`mutate` so it rides undo and marks the scene dirty. The option range is the
device's reported output count when the board has been read, else 1…16 with the
title saying the range is unverified. `outputSelectorOptions` is a pure exported
helper and is unit-tested; the DOM wiring itself is the one part only §6 can
confirm, because the lockdown forbids a browser session.

**2. "Make sure the outputs are correspondingly enabled/disabled on the board
when we push" → revised to "all 4 ports enabled at all times, direct data to the
port we need". — MET, per the REVISED semantics (which are authoritative).**
Note the slip in the phrasing quoted to me ("p1→out2 enables output 2 with port
1's universe"): that is exactly what the design specifies and what shipped —
`port 1 { output: 2, universe: 21 }` ⇒ board output 2 (device `strands[1]`)
carries **U21**, port 1's universe, and is enabled if the board had it off.
Verified by `_71 (7)`: `universeByOutputIndex === {0: 22, 1: 21}` for the crossed
pair, with `assignments` naming the right port on each. The push writes
`enabled: false` **nowhere** — asserted directly in `_71 (8)`, which pushes a
single row onto output 4 and checks the applied array is `[true, true, true,
true]`.

**3. "Make sure we don't have repeating port→output associations." — MET, in two
independent layers.** The UI cannot express a duplicate (the option is rendered
`disabled` and labelled with the owning port; `onchange` refuses and reverts).
The push gate blocks it regardless of who authored the file — a hand-edited
`controllers.yaml` loads (so it is fixable in the pane) and then refuses with
*"ports 1 and 3 both drive output 2 — one physical output cannot take two
universes; give each port its own output"*, with **zero** writes reaching the
device (`_71 (13)` asserts the mocked device saw no `push:` call while the rest
of the fleet still pushes). A `led_output_duplicate` chip turns the row red
before anyone opens the dialog.

**4. "Make sure the push enables and disables the outputs as needed and
correctly — have an agent verify this whole workflow." — MET in unit space;
hardware acceptance is §6 and is operator-gated.** The push handles all four
output classes: driven (universe written), driven-but-off (enabled, with the
mapped pixel count), enabled-but-unmapped (**parked** on a claims-free universe,
never disabled), disabled-and-unmapped (untouched, absent from the plan). The
read-back verifies the whole map, so a parked output reporting a stale universe
or an enable that did not take is a loud failure that saves and notifies nothing
(`_71 (18)`, `_71 (19)`). Nothing here has touched hardware.

---

## 3. Test counts

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| `_69` baseline | 1174 | 1166 | 8 |
| before `_71` (with the concurrent `_68`-addendum work already in the tree) | 1184 | 1176 | 8 |
| after `_71` | **1224** | **1216** | **8** |

**+40 tests from `_71`, zero new failures.** The 8 are the known pre-existing
stale-model family, byte-identical before and after (`fixtures are docked beside
the ship…`, `the real titanic scene can accept the block today…`, `view-bit
headroom is REPORTED…`, the two `CLI:` parity cases, and the three `real scene …`
cases). They clear on the operator's one sim-save. Not touched.

`node --check` (copied to `.mjs` for the ES modules) passes on every file edited.

### The 25-case matrix, as placed

| # | Case | File |
|---|---|---|
| 1 | identity default + round-trip; DMX ports gain none | `controller_registry.test.js` |
| 2 | `output` 0 / 17 / `"2"` / 2.5 / −1 THROW, field named | `controller_registry.test.js` |
| 3 | two ports on one output LOAD (operational) | `controller_registry.test.js` |
| 4 | `addPort` takes the lowest free output; hole refilled; 16-ceiling refusal | `controller_registry.test.js` |
| 5 | `parkedOutputs` round-trip; malformed throws; park-on-driven-output loads; set/clear helpers | `controller_registry.test.js` |
| 6 | identity mapping — plan identical to today's, no parks | `per_output_push.test.js` |
| 7 | crossed P1→out2 / P2→out1; NOT symmetric with identity; patch records + claim labels | `per_output_push.test.js` |
| 8 | one row on output 4: enable + count, outputs 1–3 parked, `enabled:false` nowhere | `per_output_push.test.js` |
| 9 | the live `.60` repro — portless enabled output parked off U23, stays enabled | `per_output_push.test.js` |
| 10 | sticky park reused (`reused: true`), no warning, idempotent re-derive | `per_output_push.test.js` |
| 11 | re-park on a claimed park, and on a park colliding with this card's port | `per_output_push.test.js` |
| 12 | park lands inside the ≤16 window even at a high water mark; full window REFUSES | `per_output_push.test.js` |
| 13 | `duplicate_output` refusal + chip + fleet failure with zero device writes | `per_output_push.test.js` |
| 14 | `output_out_of_range` refusal, zero device writes | `per_output_push.test.js` |
| 15 | claims index sees a strandless port universe + another card's park; own excluded | `per_output_push.test.js` |
| 16 | validation runs on the APPLIED array (old order threw on a legal enable) | `per_output_push.test.js` |
| 17 | `count` written on enable, never on a live output; empty row enables nothing | `per_output_push.test.js` |
| 18 | read-back covers parked (stale ⇒ fail, match ⇒ complete) and PERSISTS the park | `per_output_push.test.js` |
| 19 | `_69` composition: lost reply verified over the full map; missing enable = failure, no save/notify | `per_output_push.test.js` |
| 20 | S1/S2 regressions intact (persist→notify order, collision refusal, chip pair) | `per_output_push.test.js` |
| 21 | chip drifts on a portless enabled output at the wrong universe, quiet once matched | `led_controller_ui_round2.test.js` |
| 22 | chip drifts naming the pending ENABLE | `led_controller_ui_round2.test.js` |
| 23 | `outputSelectorOptions`: taken/disabled/labelled, device-bounded, unverified 1…16 | `led_controller_ui_round2.test.js` |
| 24 | crossed mapping stamps the declared output while claims name the CARD port | `led_patch_projection.test.js` |
| 25 | bench: no `SRC_OUTPUT_INDEX_UNEXPECTED` on a legal cross; still raised on real disagreement; absent field reads as identity | `bench_section_sync.test.js` |

Nothing sleeps a real budget: `awaitReboot` is mocked in every io bag, and the
`ctx` factories all supply `claimedUniverses`.

---

## 4. Deviations from `_70`, and why

1. **An EMPTY port row pointed at a DISABLED output enables nothing.** §2.1 rule
   1 as written would add every such output to `enableOutputIndices`, and §2.3
   then requires `count ≥ 1` — which the everyday 4-row card driving two strands
   cannot supply, so a routine push would have refused. The output is now left
   exactly as the board has it (design case 3: untouched, absent from the plan).
   Enabling it would also be the sim deciding to drive hardware nobody mapped,
   which §2.3 explicitly rejects. A row that DOES carry chain entries the sim has
   no pixel count for gets a warning and is likewise left alone. Covered by
   `_71 (17)`.
2. **`setControllerType` materializes / strips the field** (see step 1). Not in
   the brief; without it a DMX→LED flip throws on the next render and an LED→DMX
   flip writes a `controllers.yaml` the loader refuses.
3. **The refusal lead sentence is conditional.** A pure ownership clash keeps
   `_59`'s exact `universe collision — …` lead; the new kinds lead with
   `push REFUSED — …`, because calling a duplicate output a "universe collision"
   sends the operator hunting the wrong field. One helper, three surfaces.
4. **`output` / `parkedOutputs` added to `bench_section.cjs`'s key order.** The
   brief only named the `:277-280` check, but the derived `TB ` block would
   otherwise silently drop a crossed mapping. `orderKeys` skips undefined, so
   nothing changes for a scene without the fields.
5. **`enable_without_pixels` collision kind designed then removed**, superseded by
   deviation 1 — it was unreachable once the empty-row case stopped enabling.

### Firmware assumption that stayed UNVERIFIED

`sacn.perOutput` for a **parked-but-enabled** output is assumed to report
`{universe: <parked>, startAddress: 1, enabled: true}` like any other enabled
output. The verify asserts exactly that for every key of the plan, so if the
firmware instead omits parked outputs or reports them differently, the first live
push will fail loudly at the read-back step (not silently) — see §6 step 4.

---

## 5. Untouched / out of scope

- No `simulation/scenes/**`, no `marsin_engine/**`, no server/bridge code, no
  `simulation/src/fixtures/**` (the concurrent `_68`-addendum agent's area).
- The engine and the sACN mapper address by `(universe, channel)` only, so the
  exporters, `scene_model_parity.cjs` and the engine needed no change (re-grepped:
  no `outputIndex` consumer in any of them).
- `derivedUniverses` deliberately does NOT include parked universes — nothing
  routes to them, which is the entire point.
- Operator decision still open (`_70` §8-3): **auto-enabling ALL board outputs on
  every push** is not built. The push only ever switches ON an output a mapped
  port drives; say the word if "all 4 enabled at all times" should mean the sim
  makes that true rather than merely never undoing it.

---

## 6. Live checklist (operator-gated — no agent runs this)

Under the standing lockdown this was written, not executed. Each push costs one
~11 s device reboot and one scene save; schedule them.

1. Open the Controllers pane on the `.60` card. **Expect `▲ Drift`** and the new
   `Board outputs:` line showing output 3 parked. That is the U23 landmine
   finally becoming visible, not a new fault.
2. Set P1's output selector to `2` and P2's to `1` (a deliberate cross). Expect:
   both rows update, the taken option is not offerable, the derived lines read
   `⌁ P1 → output 2: …`, and the card head shows the crossed accent.
3. Set both back to identity. Press **⬆ Push to controller**. Expect the dialog
   to list two assigned outputs, one parked output, zero enable transitions; then
   the three `_69` phases (`up to 12s to answer the write` → `device rebooting —
   waiting up to 45s …` → `reading confirmed mapping…`) and a **green** three-step
   line ending `✓ scene saved (patches projected) · ✓ bridge notified — routes
   follow`. A lead of *"the write reply was LOST … the read-back confirms the
   mapping applied"* is **also a success**. LEDs unchanged and still lit; chip
   green.
4. Verify on the device (**GET only**): output 3's universe is the parked one,
   **not U23**; outputs 1–2 unchanged; **no output changed `enabled`**. If the
   push instead failed at the read-back naming output 3, that is the unverified
   firmware assumption in §4 — report it rather than retrying.
5. The output-4 case: add a port, set its output to `4`, map a strand, push.
   Expect the dialog's ENABLE block to name output 4 with its pixel count; after
   the push the strand lights from that physical output.
6. Duplicate check: try to set two ports to the same output — expect the option
   to be un-selectable; and (if forced via a hand-edited `controllers.yaml`) the
   push to refuse with the duplicate message and write nothing.
