# 2026-07-29 — LED Fixtures menu: mapping UX (group rename, LED controller outputs)

Opus implementer session. Operator brief (relayed, live-mapping session):

1. **Generator-style config for LED models** (density, model selection, …) — **DESIGN ONLY**, §4.
2. **"I want to be able to rename the groups we have now"** — **IMPLEMENTED**, §2.
3. **"I want the TE sign to have its own group"** — **VERIFY + REPORT**, §3.

Mid-session the operator added two more, both in the LED controllers UI:

4. **"I want name for the LED controllers too like the DMX ones"** — **VERIFIED, already
   present**, §5.1.
5. **"add a new button to add new output ports … I can remove, but not add one back
   in"** — the button existed; **the bug behind the complaint was real and is fixed**, §5.2.

Everything here is editor plumbing. **Zero writes to `scenes/**` or `models/**`**, no
server started or stopped, no output/sACN control touched, no git operations. All live
verification ran as a triple-save-guarded browser client of the operator's `:6969`, in a
throwaway Chromium closed at the end of every run.

---

## 0. TL;DR

- **The rename control was never missing — it was 51 pixels wide and needed 67.** In the
  docked LED Fixtures pane it rendered as **`— Re…`** next to a `UkingPar (10ch)`
  dropdown (screenshot, §6). That is why "I want to be able to rename the groups"
  reads as a missing feature. The toolbar row now **wraps instead of clipping**, and the
  button measures 262 px, unclipped, with a tooltip.
- **The duplicate-name guard had a hole big enough to fuse two groups.** Group names are
  ONE scene-wide namespace (view-mask bit, 2D Pixel Map selectors, exported model), but
  every rename control policed only its own list: par groups checked par groups, LED
  strand groups checked strand groups, neither checked generator groups. A par group
  could be renamed straight onto a live LED strand group. New pure module
  `group_rename_guard.js` is now the single definition of "taken", wired into **all five**
  name-entry points.
- **The par-group rename had no `pushUndo()` at all** — a mistyped rename was
  unrecoverable. Fixed.
- **A group rename now reports itself**, one line for what was CARRIED (display state),
  one for what was UNTOUCHED (names + addresses — a group rename unmaps nothing), and one
  the system had no way to surface before: **the exported engine model is now STALE.**
  The sim's stale-model banner only watches *pixel count*, which a rename does not change.
- **`+port` on an LED controller could not give back a deleted output.** `addPort` minted
  `max(port) + 1`; on LED a port IS a device output (`derivePerOutputPlan` keys by
  `port.port - 1`), so deleting output 2 of a 4-output board and pressing `+port` produced
  port **4** while output 2 stayed permanently unreachable. LED controllers now **re-fill
  the lowest free slot** and refuse loudly past the device's 16-output ceiling. DMX
  numbering is deliberately unchanged.
- **"TE Sign 2" is not an orphan — it is a second, deliberate sign group, and it carries a
  real defect the operator should decide about**: both groups contain fixtures named
  `TE Sign V3 A` / `TE Sign V3 B`, so the scene now has **duplicate fixture names**, which
  the parity validator already flags as an error and which shows up as four
  indistinguishable chips in the Unmapped tray (§3). **Nothing was deleted or restructured
  — his scene, his call.**
- **Sim suite 980 / 972 / 8** — the same 8 pre-existing failures by name, zero new. My 54
  new tests are inside that 980. Live harness **10/10 PASS**, zero save requests attempted.

---

## 1. What the operator actually saw

The `✏ Rename` button has existed on par-group folders and LED-strand-group folders for a
while. It measured, live, in his docked pane:

```json
{"text":"✏ Rename","w":51,"h":22,"scrollW":67,"clipped":true}
```

Row 2 of the group toolbar is `[✏ Rename] [type-select + +] [✕ Delete]`, three flex
children with `flex:1 1 0; min-width:0`. `min-width:0` is what lets a flex child shrink
below its content — so the ellipsis chain that was *meant* to be a safety net became the
everyday rendering. The before screenshot shows literally:

```text
— Re...   [ UkingPar (10ch) ▾ ]   × Del...
```

Both of the row's text buttons were unreadable. The dropdown, which needs no label to be
understood, was the only legible control. **The feature was there; the affordance was not.**

---

## 2. Item 2 — group rename (IMPLEMENTED)

### 2.1 Readability

`row2` now sets `flex-wrap: wrap`, and the two text buttons take
`flex:0 1 auto; min-width:max-content` (a later declaration in the same inline style, so it
overrides `gBtnStyle`'s `min-width:0`). They can no longer shrink below their own text; the
row wraps instead. Applied to **both** the par-group toolbar and the LED-strand-group
toolbar. Both buttons gained a `title` saying what the control does *and does not* touch.

Measured after: `{"w":262,"scrollW":262,"clipped":false}`.

One thing I tried and **reverted**, with the measurement that killed it: giving the fixture
type `<select>` `min-width:0` so the row would wrap to two lines instead of three. A
`<select>`'s intrinsic minimum is what keeps its value visible — with it zeroed, the type
name vanished entirely and only the green `+` survived. Three legible rows beat two rows
with an unreadable control. The reasoning is now a comment on that line so nobody
"optimises" it back.

### 2.2 The namespace hole — new module `src/dmx/group_rename_guard.js`

Group names key **three** stores that do not care which list a group came from:

| Store | Keyed by | Consequence of a collision |
|---|---|---|
| view registry `groupBits` → `views.yaml` | group name | two distinct groups collapse onto **one** `MASK_*` bit |
| 2D Pixel Map panel selectors (`{group: …}`) | group name | one panel silently addresses both groups |
| exported engine model (`group: '<name>'` per pixel) + viewmasks sidecar | group name | the engine validates the sidecar against the model's group set |

…and the group **master override** lives in *two different maps* (`params.groupOverrides`
for par, `params.ledGroupOverrides` for strands), so a fused name means two masters
fighting over one folder title in one list.

The new module is pure (no DOM / THREE / `window`) and exports:

- `collectSceneGroupNames({parLights, ledStrands, traces})` — the union, trimmed,
  excluding the display-only `Ungrouped` bucket. **Throws** on a malformed scene bag
  rather than returning an empty namespace: under-reporting a collision is worse than not
  running (codex P0).
- `groupRenameError(newName, {currentName, takenNames})` — empty / reserved / collision,
  with a message that explains *why* rather than just refusing.
- `buildGroupRenameReport(...)` / `formatModelStalenessWarning(...)` — the loud half.

Wired into **all five** name-entry points, which previously had **three different**
policies between them:

| Control | Before | After |
|---|---|---|
| par group `✏ Rename` | `groupOrder.includes(nn)` (par only) | scene-wide |
| LED strand group `✏ Rename` | `_ledGroupNameClash` (strands only) | scene-wide |
| LED `➕ Add Group` | `_ledGroupNameClash` (strands only) | scene-wide |
| strand "＋ New group…" (Move dropdown) | `_ledGroupNameClash` (strands only) | scene-wide |
| DMX `➕ Add Group` | **no guard at all** | scene-wide |

That last row was its own small bug: an empty answer created a group literally named `""`,
and a name matching a generator group silently converted the new fixture into a
trace-generated one on the next scene load (`config.js` re-stamps `traceGenerated` on a
`groupName` match).

### 2.3 Undo

The par-group rename **never called `pushUndo()`**. The LED-strand rename always did. Now
both do, and both refuse *before* the undo push, so a rejected rename does not leave a
snapshot behind.

### 2.4 The loud half — what the operator now sees

```text
[Rename] LED strand group "ZZ Probe LED Group" → "ZZ Probe Renamed": 1 member(s) moved.
  👁 CARRIED (display state): group master (⏻ On / Brightness / 🔒 Lock), the group
     view-mask bit, and every 2D Pixel Map selector naming the group.
  ✔ UNTOUCHED (mapping): fixture/strand NAMES and their DMX / sACN addresses — group
     membership is not a mapping key, so nothing was unmapped by this rename.
  ⚠ ENGINE MODEL now STALE: 1 member(s) moved from group "ZZ Probe LED Group" to
     "ZZ Probe Renamed", but the exported model + viewmasks sidecar still name
     "ZZ Probe LED Group". Re-export the model (Save) and reload it in the engine —
     until then, any pattern or view keyed on the group name will not match. The sim's
     stale-model banner does NOT catch this (it only watches the pixel count).
```

Plus a visible toast (verified rendered, opacity 1, on-screen — not merely present in the
DOM):

```text
✏ Group "ZZ Probe LED Group" → "ZZ Probe Renamed" (1 strand(s)) — addresses untouched;
RE-EXPORT the engine model
```

**Why this wording and not `_47`'s "CHECK + INVALIDATE".** A *fixture* rename invalidates
mappings because the fixture NAME is the join key for `patches.yaml`, the chains in
`controllers.yaml` and every model pixel. A **group** rename is not that: group membership
is display state and no fixture name changes, so nothing is unmapped and claiming otherwise
would be the same species of lie as the old `"N deleted fixture(s) unmapped — channels
freed"`. A test asserts the report never says `INVALIDATED` or `channels freed`, and
another asserts neither handler writes `dmxAddress` / `dmxUniverse` / `.name`.

The one consequence that *was* genuinely invisible is the model staleness — that is the new
information here, applied to whichever store actually applies, as the brief asked.

### 2.5 Files touched

| File | Change |
|---|---|
| `simulation/src/dmx/group_rename_guard.js` | **new** — pure scene-wide namespace + guard + report wording |
| `simulation/src/gui/gui_builder.js` | both group renames rewired (scene-wide guard, `pushUndo`, itemised report + toast, tooltips); `_ledGroupNameClash` delegates; DMX `➕ Add Group` guarded; both group toolbars wrap instead of clip |
| `simulation/src/dmx/controller_registry.js` | `LED_MAX_OUTPUTS`, `nextLedOutputPortNumber`, LED branch + ordered insert in `addPort` (§5.2) |
| `simulation/tests/group_rename_guard.test.js` | **new** — 22 behaviour tests |
| `simulation/tests/led_output_port_slots.test.js` | **new** — 12 behaviour tests |
| `simulation/tests/led_fixtures_menu_wiring.test.js` | **new** — 20 wiring-regression tests |
| `simulation/agent_tools/led_fixtures_menu_verify.cjs` | **new** — 10-check live harness |

`simulation/src/gui/controller_map_editor.js` was **NOT touched** — see §5.3.

---

## 3. Item 3 — the TE Sign group (VERIFY + REPORT; nothing changed)

**How the flow works today.** `✨ + TE Sign (A+B)` is a catalog entry
(`led_generator_catalog.js`) with `defaultGroup: 'TE Sign'` and `bornLocked: true`.
Clicking it:

1. builds the union of every existing group name **plus every trace `groupName`**;
2. if `TE Sign` is taken, shows a themed confirm — *"A 'TE Sign' group already exists. Add
   another as its own separate locked group?"*;
3. on confirm, `uniqueGroupName` suffixes → `TE Sign 2`, and the pair is born into its own
   **locked** group with its own `groupOverrides` entry.

So **yes — the TE Sign already has its own group, and a second sign gets its own separate
locked group by design.** Item 3 needs no work. `TE Sign 2` is not an orphan and not an
accident of the machinery; it is what the confirm dialog offers. Whether he *wants* two
signs in the scene is his call, and I changed nothing.

**But there is a real defect riding along, and it is not cosmetic.** `buildTeSign` always
emits the same fixture names, so the second group contains a second `TE Sign V3 A` and a
second `TE Sign V3 B`. The scene now carries **duplicate fixture names**, and fixture names
are the mapping join key. Consequences, all observed:

- `tools/scene_model_parity.cjs` / the suite's parity test already report it:
  > `duplicate_scene_name … name 'TE Sign V3 A' is used by more than one scene entry
  > (DMX fixture and DMX fixture) — fixture names are the join key for patches.yaml, the
  > chains in controllers.yaml and every model pixel, so a duplicate makes the mapping
  > ambiguous. Rename one.`
- The **Unmapped tray shows four chips: `TE Sign V3 A`, `TE Sign V3 B`, `TE Sign V3 A`,
  `TE Sign V3 B`** — visible in the §6 controller screenshot. While live-mapping there is
  no way to tell which chip is which sign.
- `save-server.js` derives `patches.yaml` keyed by name, so two same-named fixtures collapse
  to one record.

**Operator decision needed (I did not act):**

- **(a)** If the second sign is wanted: its two fixtures should be renamed (e.g.
  `TE Sign 2 V3 A/B`). Note that renaming a fixture goes through the `_47` check-and-
  invalidate policy — it will unmap them loudly if they are mapped. Doing this *before*
  mapping them costs nothing.
- **(b)** If it was a double-press: delete the `TE Sign 2` group's two fixtures.
- **(c)** Worth fixing at the source either way: `runLedGeneratorClick` already
  uniquifies the GROUP name but not the fixture names inside it. Making the generator stamp
  `<group> V3 A/B` (or suffix on collision) would stop this recurring. That is a small,
  contained change I did **not** make because it changes what the generator emits and the
  operator is mid-mapping. Filed as a follow-up.

---

## 4. Item 1 — generator-style config for LED models (DESIGN ONLY, not implemented)

### 4.1 What the DMX Group Generator actually is

A "📐 Group Generator" card is one entry in `params.traces`. It is a **persisted, re-runnable
recipe**, which is the thing the LED generator currently is not:

| Field | Meaning |
|---|---|
| `name` / `groupName` | the card's name and the group it stamps on what it emits |
| `shape` | `line` \| `corner` \| `circle` |
| `startX/Y/Z`, `cornerX/Y/Z`, `endX/Y/Z` | world-space path points (line / corner) |
| `radius`, `arc` | circle geometry (local-space, a transformable group) |
| `count` | **authoritative** number of fixtures — `traceLightCount()` is the ONE place it is rounded, so layout, chain gate, and card all agree |
| `pointOffsets[]` | per-position nudges along the path, on top of the even base distribution |
| `aimX/Y/Z` | a draggable aim target |
| `fixtureType` | which definition the emitted fixtures get |
| `chainSplits[]` | the **physical daisy-chain walk** as inclusive `{from,to}` ranges that must cover `1..count` exactly once |
| `generated` | whether the card currently owns live instances |

Emission (`generateGroupFromTrace`) has properties the LED side would want verbatim:

- **Sticky names.** `"<group> N"` is stable per chain index, so a Regenerate re-lands an
  already-mapped group on the SAME addresses; survivors keep their chain entries, a count
  shrink just drops the tail (addresses are absolute, nothing shifts), extras land in the
  Unmapped tray.
- **The sweep is rename-aware.** `sweepGeneratedInstances(parLights, groupName,
  previousGroupName)` removes both names' generated sets, so a rename cannot orphan the old
  one (the `_37` bug).
- **The chain gate refuses before it mutates.** Invalid `chainSplits` → the regenerate is
  refused outright, *before* the undo push, before the sweep. Never a quiet fall back to
  path order — that would renumber a mapped group behind the operator's back.
- **Count is pinned by the splits.** Changing `count` while splits exist is refused and the
  slider reverts; the splits are kept, not stretched or dropped.

The LED side by contrast (`led_generator_catalog.js`) is a **stateless catalog**: one button
per entry, `build(opts) → fixtures`, pushed once into `params.parLights`. There is no card,
no persisted parameters, no regenerate. Design `20260724_26` §2.4 chose that deliberately
("Option A") because the only entry was a fixed-geometry TE Sign.

### 4.2 What "DMX generator style" means for LED models

The operator's words — *"set certain config for the models, density, blah blah blah"* — map
onto a **persisted LED generator card**. Proposed shape, reusing the trace machinery where
that is honest and NOT where it is not:

```yaml
ledGenerators:               # NEW persisted array, mirror of params.traces
  - id: led_strand_run       # catalog entry id (the recipe kind)
    name: Port Hull Run      # card name == groupName (same rename contract as a trace)
    groupName: Port Hull Run
    target: ledStrands       # or parLights, per the catalog entry
    shape: line              # REUSE: line | corner | circle, same path math
    startX: …  endX: …       # REUSE: the same point handles + drag gizmos
    pointOffsets: []         # REUSE
    # ── the LED-specific half ──
    model: te_led_grid_120   # which LED fixture/strand definition to lay down
    layout: density          # density | count   (the "blah blah blah" knob)
    pixelsPerMetre: 60       # when layout=density
    strandCount: 4           # when layout=count
    pixelsPerStrand: 120
    generated: true
```

**Reuse, honestly:**

- **Path + shapes + point handles + `pointOffsets`** — reuse outright. `computeTracePoints`
  and `computeTraceBaseArclengths` are geometry, not DMX; they already emit N evenly-spaced
  points along a line/corner/circle with per-point nudges. A strand generator wants exactly
  that, one point per strand endpoint pair (or per fixture origin).
- **The card grammar** (name control, collapsible sub-folders for the points, a disabled
  "Preview: N …" readout, `⤺ Reset point offsets`, Regenerate) — reuse the layout, not the
  code; it is `lil-gui` wiring against different fields.
- **Sticky `"<group> N"` names + the rename-aware sweep** — reuse the *contract* and the
  pure helpers `sweepGeneratedInstances` / `carryTraceGroupOverride`
  (`src/gui/trace_group_rename.js`) verbatim; they take arrays and names, not DMX.

**Do NOT reuse:**

- **`chainSplits`.** This is the honest answer and it matters. On DMX, a split declares
  which fixtures share a daisy-chain so that fixture NUMBER means chain position. On the LED
  bus that job is already done by a different mechanism: a strand's position in
  `port.chain[]` on its controller output, walked by `projectLedStrandSegments` with the
  controller's stride. Adding a second, parallel wiring declaration would give two sources
  of truth for one physical fact. **The LED equivalent of `chainSplits` is the port chain
  the operator already builds in the Controllers panel** — the generator should emit strands
  in a defined order and stop there. (If ordering ever needs expressing on the card, the
  right shape is a plain `reverse`/`serpentine` flag on the emission order, not a split
  list.)
- **`fixtureType` → footprint arithmetic.** LED strands have `ledCount`, not a DMX
  footprint; density is pixels-per-metre, and the address walk is the stride walker.

**Density semantics (the actual new idea).** `layout: density` makes **pixel pitch**
authoritative and *derives* the count from the path length: `count = round(pathLength ×
pixelsPerMetre)`. This is genuinely different from the trace model, where `count` is
authoritative and the geometry stretches to fit — and it is the mode a physical LED run
wants, because the strip's pitch is fixed by the hardware and the path length is what varies.
The two modes must be **explicit and mutually exclusive** on the card (a `layout` enum, not
a "leave it blank and we'll guess"), and switching mode must show the resulting count
*before* it regenerates.

**Regenerate semantics.** Same three-step contract the trace has, and for the same reason:
(1) **gate first** — refuse on any invalid parameter with zero mutations behind it;
(2) **sweep both names** (current + previous on a rename) so nothing is orphaned;
(3) **re-emit with sticky `"<group> N"` names** so an already-mapped run re-lands on its
addresses. The one new gate LED needs: **a pixel-count change is what makes the engine model
stale** (`/status.modelStale`, runbook `.agent/ops/engine_model_refresh.md`), so a density
edit that changes total pixels must say so loudly — the same class of warning §2.4 now emits
for group renames.

**Sticky-by-name interplay.** A generated LED group inherits the whole rename policy already
built: `_47`'s check-and-invalidate for individual *fixture* renames (generated fixtures are
loudly refused — the name is the contract), and §2's scene-wide guard + itemised report for
*group* renames. Nothing new is needed there, which is a good sign the seam is in the right
place.

### 4.3 Effort and open questions

**Effort estimate** (implementation only, excluding operator iteration):

| Slice | Scope | Estimate |
|---|---|---|
| A | `led_generator_recipe.js` — pure: recipe schema, density↔count derivation, emission, validation. Unit-tested with no browser. | ~0.5 day |
| B | Persist `params.ledGenerators` through `config.js` (`reconstructYAML` / `extractParams`) + round-trip test | ~0.5 day |
| C | The card UI in the `✨ Generators` folder — mirror of the trace card, reusing the point-folder grammar | ~1 day |
| D | 3D point handles + drag for LED recipes (largest unknown — the trace handle code is entangled with `traceObjects`) | ~1–1.5 days |
| E | Regenerate + sweep + stale-pixel-count warning + harness | ~0.5 day |

**~3.5–4 days.** Slices A+B+C alone (numeric-entry card, no 3D handles) are **~2 days** and
would already deliver the operator's ask; D is the polish that makes it feel like the DMX
generator.

**Open questions for Sina:**

1. **Which model(s)?** The catalog has exactly one entry today (TE Sign, fixed geometry —
   *not* a density candidate). A density generator needs a target: LED strand runs
   (`ledStrands`), the `te_led_grid` fixture, or something else on the ship?
2. **Density unit** — pixels/metre (matches strip spec sheets) or spacing in mm (matches
   `screenPixelSize`)? One, not both.
3. **Does the TE Sign generator become a card too**, or stay a stateless button? Making
   everything a card is more consistent; keeping the sign stateless is less churn on a
   fixed-geometry object that has no parameters worth persisting.
4. **Confirm the `chainSplits` ruling above** — that LED wire order is the port chain, and
   the generator will NOT grow a second wiring declaration.
5. **Should a density change that alters pixel count be allowed to auto-regenerate**, or
   should it require an explicit Regenerate press (given it makes the engine model stale)?

**Not implemented. No code was written for item 1.**

---

## 5. Follow-up items — the LED controllers UI

### 5.1 "Name for the LED controllers too, like the DMX ones" — already there

`renderController()` in `controller_map_editor.js` is **shared** by DMX and MarsinLED cards.
There is no type branch on the header: both get the identical two-row layout — row 1
`[▾] [name input] [IP]`, row 2 `[type] [transport] [+port] … [🗑]`. Measured live on a
throwaway MarsinLED card:

```json
{"nameValue":"ZZ Probe LED Controller","nameEditable":true,"nameWidth":308,
 "headRows":2,"headButtons":["▾","MarsinLED","sACN","+port","🗑"],"ledConfig":true}
```

308 px wide, editable, two rows — byte-identical to the DMX card in §6's screenshot. The
two-row rework the Controllers-pane agent shipped landed on both types at once because it is
one function. **No work needed; nothing changed.**

Research finding worth recording: **`controller.name` is not a key for anything.** Grepping
every read of it across `simulation/` — it appears only in undo labels, toasts, thrown-error
text and the `dup_ip` violation message. Identity is `controller.id` (duplicate-checked,
throws) and `controller.ip`; sACN routing and the bridge relay key on `{universe, ip}`;
`patches.yaml` carries `controllerIp` / `dmxUniverse` / `dmxAddress` / `controllerId`, never
a name. `controller.device.deviceName` is a *separate* field (the physical device's own
name) used only as the default suggestion at creation.

So renaming an LED controller needs **no** invalidation machinery — the rename-hygiene rules
correctly do not apply. What is missing is a **duplicate-name guard**: two controllers may
freely share a name, which is confusing mid-mapping. That guard belongs in the shared
`nameInp.onchange` — see §5.3.

### 5.2 "Add a button to add output ports back" — the button existed, the bug was real

`+port` renders on LED cards (shown above). But it could not do what he wanted, and the
reason is precise:

**On an LED controller, a port IS a physical device output.** `derivePerOutputPlan`
(`device_config_mapper.js`) keys the pushed plan by `port.port - 1`, the device's `strands[]`
index. `addPort` computed `max(existing port numbers) + 1`. Therefore:

```text
ports [1,2,3,4]  →  delete output 2  →  [1,3,4]  →  +port  →  [1,3,4,5]
```

Port 5 addresses `strands[4]` — which does not exist on a 4-output board — while output 2
stays unreachable forever. Exactly the operator's *"I can remove, but not add one back in"*.
Worse, the dead port fails **silently**: `derivePerOutputPlan` iterates the device's real
outputs and simply never looks at a port beyond them, so it is dropped from the plan with no
error and no warning.

**Fix (registry-side):**

- `nextLedOutputPortNumber(controller)` — pure; the **lowest free slot in 1…16**.
- `LED_MAX_OUTPUTS = 16` — the device's own `/api/config` validation accepts a `strands`
  array of 1–16 entries (`docs/41_led_controller_onboarding.md` §4.2). Past that it
  **throws** with a message naming the controller, the ceiling and where the ceiling comes
  from. No silent clamp.
- `addPort` branches: LED → fill the gap; **DMX → unchanged** `max + 1` (DMX port numbers
  are chain labels, not hardware output indices, and holes there are harmless by design).
- The new port is **inserted in port order**, not appended, so a refilled output renders as
  `P1 P2 P3`, not `P1 P3 P2`.

Proven live:

```text
[f] LED output slots — seeded: [1,2,3,4] | after remove P2: [1,3,4] | +port gave: 2 | now: [1,2,3,4]
```

A re-added output gets a fresh universe and an **empty** chain — it never inherits the
deleted output's strands.

### 5.3 What I deliberately did NOT touch

`controller_map_editor.js` is the Controllers-pane agent's territory this session (header
rework + hide/show toggle). The entire behaviour change above lives in
`controller_registry.js`, so the shared `+port` button is untouched — a wiring test asserts
it still simply calls `addPort(registry(), controller)`, so the two changes cannot collide.

**Handed to that agent (not done here):**

1. **Duplicate controller-name guard** in the shared `nameInp.onchange` (§5.1). Names are
   display-only, so a loud warning rather than a refusal is the right shape.
2. **`+port` is silent** — `mutate(null, …)`. Now that an LED add can *refuse* (16-output
   ceiling) and can *choose a specific slot*, the button should toast which output it
   created, and surface the throw instead of letting it escape as an unhandled error.
3. **Optionally extend gap-filling to DMX.** Same argument applies to an 8-port DMX node;
   I scoped it to LED because that is what the operator asked about and it is where the
   port number carries hardware meaning.

---

## 6. Verification

### Live harness — `node simulation/agent_tools/led_fixtures_menu_verify.cjs`

Fresh Chromium per run against the operator's already-running `:6969`, `--viewport
1280x720`, browser closed after. `window.__gpuAdapter` recorded:
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`,
`integrated: false`, `detectionFailed: false`. No FPS claimed.

All 10 checks green on the final run (5 runs total; runs 1 caught the two defects below):

| Check | Result |
|---|---|
| `a_named_groups_offer_rename` (and `Ungrouped` correctly does not) | ✅ |
| **`a_rename_button_readable`** (unclipped, ≥40 px, has a tooltip) | ✅ |
| **`b_rename_report_is_loud_and_honest`** (CARRIED / UNTOUCHED / STALE, never "channels freed") | ✅ |
| `b_toast_visible_and_accurate` (opacity 1, on-screen — not just in the DOM) | ✅ |
| **`c_cross_list_collision_refused`** (LED strand group → `"TE Sign"` refused, state unchanged) | ✅ |
| `d_names_and_override_intact` (names byte-identical, master carried incl. `brightness:42` + lock, no orphan) | ✅ |
| `e_led_card_has_name_and_addport` | ✅ |
| **`f_removed_output_slot_comes_back`** | ✅ |
| `restore_zero_residue` (params + controller registry deep-equal to pristine) | ✅ |
| `no_console_errors` | ✅ |

**Two defects the harness caught that reading the code did not:**

1. **The clipped button** (§1). Code review sees a button with an ellipsis style and reads
   it as a safety net; only `getBoundingClientRect().width` vs `scrollWidth` shows it is the
   everyday rendering. This is the whole of item 2.
2. **`min-width:0` on the `<select>` deleted it.** My first attempt at a tidier two-row
   wrap collapsed the fixture-type dropdown to zero width — the type name vanished and only
   the `+` remained. Caught by looking at the PNG, reverted, and the reason is now a comment.

### Screenshots (`.agent_renders/`)

- `ledmenu_1785369907_a_groups_with_rename.png` — **BEFORE**: `TE Sign (2)` toolbar showing
  `— Re...  [UkingPar (10ch)]  × Del...` — both text buttons clipped.
- `ledmenu_1785370358_a_groups_with_rename.png` — **AFTER**: `✏ Rename` full width and
  legible, then the type select + `+`, then `✕ Delete`.
- `ledmenu_1785370373_b_rename_loud_and_toast.png` — the rename toast rendered and readable;
  the renamed group showing its carried master (Brightness 42, 🔒 Locked) and its **unchanged**
  strand name.
- `ledmenu_1785370382_e_led_controller_card_name_and_port.png` — the MarsinLED card with its
  editable name box, IP, and `MarsinLED | sACN | +port | 🗑` row. **Also visible: the four
  indistinguishable `TE Sign V3 A/B` chips in the Unmapped tray** (§3).

### Suite

- **Sim suite 980 / 972 / 8.** The 8 failures are identical **by name** to the pre-change
  baseline (`~/tmp/led_fixtures_menu/suite_baseline_full.txt`, 924/916/8) and are all
  scene↔model staleness in the operator's own files — none in this session's territory.
  My 54 new tests (22 + 12 + 20) are inside that 980.
- The count moved from the brief's stated 903/895/8 because other agents added tests
  concurrently; judged by **which** tests fail, the set is unchanged.
- `git diff --check -- simulation`: clean. Acorn parse of all 6 touched/added source files
  and `node --check` on the harness: clean.

### Zero scene/model writes

Triple guard on every run (`params.autoSave = false` → `window.debounceAutoSave` stubbed →
every `:6970` request aborted at the network layer). **Save-server requests attempted: 0**
on all 5 runs. Pristine deep clones of `params.parLights` / `groupOverrides` / `ledStrands` /
`ledGroupOverrides` **and** the controller registry restored and asserted deep-equal at exit.
Every probe object is a throwaway `ZZ …` name; the operator's own groups were only read.
No server started, stopped or restarted; no output/sACN control touched; no git operations.

`scenes/**` and `models/**` do show uncommitted modifications on the branch — those are the
operator's own live-mapping saves, not this session's; nothing here can write them by
construction.

---

## 7. Follow-ups filed

1. **TE Sign duplicate fixture names** (§3) — operator decision (a)/(b), plus the source fix
   (c): have `runLedGeneratorClick` uniquify the emitted fixture NAMES, not just the group.
2. **Duplicate controller-name guard** + **loud `+port`** in the shared Controllers-pane
   header (§5.3) — belongs to the Controllers-pane agent.
3. **DMX port gap-filling** (§5.3) — same argument as LED, deliberately out of scope here.
4. **LED generator card** (§4) — 5 open questions for Sina before any code.
5. **Both group renames still use native `prompt()`/`alert()`**, which blocks the render
   loop. The G3 convention is the themed inline modal (`showModal`). Pre-existing across
   every group control (`➕ Add Group` too), deliberately not changed mid-mapping — it is a
   coherent one-pass change, not a per-control patch.

## 8. Artifacts

`~/tmp/led_fixtures_menu/` — `probe_led_panel.cjs` + `probe1.json` (the read-only panel
inventory that started this), `probe_controllers.cjs` + `probe2.json`, `verify_run1..5.txt`
(run 1 is the two caught defects, run 5 is the final green), `suite_baseline_full.txt`,
`suite_after.txt`. Screenshots in `.agent_renders/ledmenu_*`. Re-runnable at any time:
`node simulation/agent_tools/led_fixtures_menu_verify.cjs`.

---

# Addendum â€” the mouse wheel must never edit a parameter

Follow-on operator order on this same thread, relayed mid-session:

> "In the simulation GUI, disallow mouse scroll from updating the parameters! I randomly
> accidentally set some values to 0 when I scroll in the menu."

and shortly after: *"fix the scrolls please."*

Implemented and live-verified against the operator's running `:6969` under the same
triple-save-guarded, read-only client discipline as the rest of this report.

## A1. What was already on disk (reconciliation)

A previous agent was working this order and was stopped mid-flight. Its edits were still in
the working tree. They were reviewed rather than reverted, and **kept** â€” the work was
sound and close to complete:

| Path | State found | Disposition |
|---|---|---|
| `simulation/src/gui/wheel_guard.js` | new module, complete | **kept**, extended (Â§A2) |
| `simulation/tests/wheel_guard.test.js` | 19 tests, all passing | **kept**, extended to 21 |
| `simulation/agent_tools/wheel_guard_verify.cjs` | live harness, ran but reported FAIL | **kept**, substantially reworked (Â§A4) |
| `simulation/src/gui/modern_gui/controllers.js` | two wheel handlers + `_normalizeMouseWheel` + `_hasScrollBar` deleted, replaced by comments | **kept** |
| `simulation/main.js` | `installWheelGuard(document)` wired at one site | **kept** |

Nothing was reverted. No unrelated hunk in the ~160-file dirty tree was touched.

**The operator's "the gui scroll isn't working which is good" is explained by this**: his
dev server serves from disk, so the stopped agent's edits were already live in his page.
Measured on his running stack, the reading is the benign one â€” **values are immune AND the
panel still scrolls** (`scrollTop` 427 â†’ 547 with the cursor parked on a fader, Â§A5). The
wheel was not killed wholesale; only wheel-to-value was.

## A2. The guard

Two independent paths could turn a wheel tick into an edit, and killing either alone leaves
the bug alive:

1. **Our own handlers.** `modern_gui/controllers.js` carried lil-gui's wheel-to-value on
   both the fader track and the numeric input. The fader's guard was
   `if (vertical && this._hasScrollBar) return` â€” it yielded to the scroll only while the
   root children container happened to overflow *at that instant*. A short panel, a
   collapsed section or a docked pane sized to fit made it false, and then every vertical
   tick over a fader was a value edit, with `preventDefault()` eating the scroll too.
   **Deleted, not guarded.**
2. **The browser itself.** Every numeric widget in this GUI is a real
   `<input type="number">`. Chrome steps a focused number input on wheel as a **default
   action** â€” no `stopPropagation` can reach it. Given the operator's
   click-a-field-then-scroll-on habit, *this* is the half that zeroed his values.

`src/gui/wheel_guard.js` owns half 2 and belt-and-braces for half 1 in **one
capture-phase listener on `document`** (`main.js`, single install site):

- **stopPropagation** so no descendant handler â€” ours, or one added later by someone who
  did not read the file â€” can turn the tick into an edit.
- **blur** a focused control the *browser* would step, which is what disarms the default
  action. Deliberately **not** `preventDefault()`: preventing the wheel's default is
  precisely what would kill the scroll. The listener is registered `passive: true`, so the
  scroll cannot be blocked *by construction*, and a unit test pins that.

**Extension made this session.** The fader is a `div.slider`, not a native input, so it was
protected only by the current *absence* of a handler. `.slider` is now in
`GUARDED_SELECTORS`, making half 1 structural â€” re-adding a wheel handler to the fader is
now inert. Blur is scoped to a separate `NATIVE_STEPPING_SELECTORS` list, because blurring
the div would be a gratuitous focus loss that breaks keyboard-arrow editing.

Deliberate editing is untouched: drag, click, keyboard arrows and typing all still work.

## A3. Sweep â€” everything else wheel-mutable

The guard is document-level, so coverage is a property of the DOM, not of a widget list.
Verified by source sweep:

- **Every** numeric widget in the sim GUI is `input[type=number]` â€” MarsinGui's `_initInput`,
  the DMX patch U/Addr boxes (`gui_builder.js` x3), the **controller map editor** x6
  (port/universe/gap/addr), the **LED gamma** boxes, and the **pixel-map Adjust panel**'s
  new gap / over / pitch / glyph fields (`modern/pixel_map_panel.js` x4). All covered.
- `select` and `input[type=range]` are covered pre-emptively (Firefox changes a select's
  option on wheel; the sim is not Chrome-only by contract).
- **No `<iframe>` and no `attachShadow` anywhere in `simulation/src/`** â€” so there is no
  second document the guard cannot see. (`composedPath()` is used anyway, so a future
  shadow root would still be found.)
- **Deliberately untouched:** wheel over a `<canvas>`. The 3D view's OrbitControls zoom and
  the 2D Pixel Map's zoom-to-cursor are real wheel *gestures*, and a canvas can never match
  a guarded selector. Live-proved still working (Â§A5(d)).

Only the Lighting Controls panel was exercised *live*; the docked panes are covered by the
same one listener and by the selector sweep above, not by a separate live run.

## A4. Why the first harness reported FAIL â€” and the vacuity trap

The stopped agent's warning was right, and sharper than it knew. Its harness aimed each
tick, then asserted. Both aimed phases were landing **off target**:

- 4 "on-target" fader ticks produced **1** guard engagement;
- the focused-input tick landed on `div#marsin-gui-name-30.name`, a *different row*.

Root cause, measured: **Chrome animates wheel scrolling, and the animation does not start in
the same frame as the tick.** A "settle" that waits for two equal `scrollTop` reads returns
while the scroll has not begun. The witness recorded the input measured at `y=356` and the
tick landing at `y=356` on the row that had scrolled into its place â€” the real input by then
at `y=467`, a clean 120 px = one tick of drift.

This is exactly how a naive wheel test passes **vacuously against a completely unguarded
build**: the tick misses, nothing changes, the assertion "passes" having proved nothing.

Three changes make the harness prove something:

1. **A witness, not an aim.** A **window**-capture wheel listener (fires *before* the
   guard's document-capture listener, so it sees every tick whether or not the guard stops
   it) records each tick's real `composedPath()`, whether it contained the probe's fader /
   number input, whether that input was focused at dispatch, and the scroll/layout state at
   dispatch. **Every assertion is gated on a recorded hit**, and the run throws loudly if no
   tick provably landed.
2. **Pointer calibration as a precondition.** Dispatch a known point, read back the
   delivered `clientX/clientY`, fail loudly on >1 px drift. (This caught a second, real
   problem: puppeteer's `defaultViewport` emulation put CDP input coordinates in a different
   space than CSS pixels. Now `defaultViewport: null`; measured drift `(0,0)`.)
3. **A quiet-window settle** (5 consecutive equal samples) plus a retry loop that keeps
   trying until the witness confirms a hit.

## A5. Live proof

`node simulation/agent_tools/wheel_guard_verify.cjs` â€” real CDP `mouseWheel` events (a
synthetic `WheelEvent` has no default action and would prove nothing about the Chrome half):

```
[calib] viewport 1304x745 dpr=1 | asked (652,373) -> got (652,373) | drift (0,0)
GUARDED_SELECTORS served: ["input[type=number]","input[type=range]","select",".slider"]
[b] witness: {"target":"input[type=number]","at":{"x":1268,"y":356},"aim":{"x":1268,"y":356},
              "inputRectAtDispatch":{"x":1246,"y":347,"w":44,"h":18},
              "onInput":true,"inputFocusedAtDispatch":true,"inputValueAtDispatch":"0.08"}
[b] value before: "0.08" | after: "0.08" | still focused: false | guard swallowed + 1
[c] panel scrollTop values seen: 427 -> 547
[d] camera distance before: 131.94 | after: 102.30
RESULT: PASS (11/11 checks)
```

**The negative control is what makes this a proof.** Same harness, same tick, guard
uninstalled at runtime (`--negative-control`):

```
[NEG] guard UNINSTALLED
[b] witness: onInput:true, inputFocusedAtDispatch:true
[b] value before: "0.08" | after: "-0.92"
RESULT: PASS
```

**One** wheel tick on a focused number input moved `Pixel Size` from `0.08` to `-0.92` â€” a
single tick blowing a value clean past its floor. That is the operator's
"randomly accidentally set some values to 0", reproduced on demand. With the guard
installed, the byte-identical tick leaves it at `0.08`.

## A6. Tests + suite

`simulation/tests/wheel_guard.test.js` â€” **21 tests, all passing**. Behaviour is unit-tested
against a minimal DOM stub (no jsdom in this repo); the deletions in the GUI engine are
pinned by source contract, the tool `rename_hygiene_wiring.test.js` already uses for wiring
facts inside browser-only closures. Notable pins: the guard **never** calls
`preventDefault`; the listener is registered `capture + passive`; a canvas tick is
untouched; the fader is stopped but **not** blurred; exactly one install site in `main.js`.

Full suite: **1080 tests, 1072 pass, 8 fail**. The 8 are the known
stale-titanic-model / scene-model-parity family (`scene_model_parity`,
`section_fixture_id_space`, `pixel_map_layout_expansion` CLI pair, â€¦) â€” **zero new failures
by name**.

## A7. Live-session safety

The operator was live-mapping on hardware throughout. Every run was a read-only client of
his stack: `window.__readonlyMode` installed as an accessor before any page script (getter
always true, setter swallows `main.js`'s `= false`), **the sACN OUT WebSocket (`:6972`)
refused in the `WebSocket` constructor** â€” request interception does not cover WebSockets,
and a probe browser must never become a second writer for a universe â€” `params.autoSave`
off, `debounceAutoSave` stubbed, and every `:6970` request aborted at the network layer.
Sockets refused: 0, save requests aborted: 0. `scene=titanic` matches his session, so the
bridge's client-tag union is unchanged. Short sessions, browser closed on exit. No server
started, stopped or restarted; no git operations.

The negative-control run does mutate `Pixel Size` **in its own throwaway page only** â€” with
autosave off, the save server unreachable and the browser closed at exit, nothing persists.

## A8. Artifacts

`~/tmp/gui_wheel_guard/` â€” `wheelguard_*_guarded_summary.json` (the 11/11 PASS),
`wheelguard_*_negative_control_summary.json` (the `0.08 -> -0.92` proof), plus before/after
screenshots and the two superseded summaries from the aimed-tick harness that showed the
vacuity trap. Re-runnable any time:

```bash
node simulation/agent_tools/wheel_guard_verify.cjs                    # expect 11/11 PASS
node simulation/agent_tools/wheel_guard_verify.cjs --negative-control # expect the value to CHANGE
```

## A9. Follow-up

`gui_builder.js` registers a `snap` baseline handler on
`['pointerdown','focusin','wheel','keydown']` at two sites (par axes, LED strand axes). The
`'wheel'` entry is now **dead** â€” the guard stops the tick before that capture listener, and
nothing edits on wheel any more. Harmless, but a small lie in code. Deliberately not
removed: `gui_builder.js` carries a 1431-line in-flight diff from other agents and a
cosmetic edit there is not worth the conflict risk.
