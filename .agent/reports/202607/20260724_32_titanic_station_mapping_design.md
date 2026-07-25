# 20260724_32 — Titanic station mapping: 4 wall + 4 top-deck stations, smokestack chains, second TE Sign (DESIGN)

**Author:** Fable design agent (architect, DESIGN ONLY — nothing implemented, no
scene writes, no git ops).
**Branch:** `feat/bm_readiness` · **Date:** 2026-07-24
**Inputs:** operator spec (verbatim below), reports `20260724_26` (LED generator
design), `_29` (catalog S1), `_28` (flattened drawer), `_27` (blackout), `_24`
(group lock + `applyTeSignPlacement`), `_14` (TE Sign V3), `_23` (grouping
parity); code study of `simulation/src/gui/gui_builder.js` (trace machinery:
`buildTracePath` ~L2481, `computeTracePoints` ~L2541, `generateGroupFromTrace`
~L3341, trace cards ~L3580+, LED ✨ Generators ~L4318+),
`simulation/src/fixtures/te_sign_generator.js`,
`simulation/src/core/group_lock.js`, `simulation/src/core/config.js` (L142–150
re-stamp), `simulation/src/dmx/view_registry.js` (custom views),
`simulation/scenes/titanic/{scene_config,patches,controllers,views}.yaml`.
Current tree: `cd simulation && npm test` → **484 pass / 0 fail**.

> **THE OPERATOR IS OFFLINE.** Everything ambiguous in the spec is resolved to a
> sensible default **and** flagged in §8 ("Defaults chosen while operator
> offline"). Nothing was silently guessed.

## Operator spec (verbatim, typos his)

> "set up the lights for me to have 4 stations on the exterior walls,
> LeftFrontWall, LeftBack, RightFront, RightBack.. and 4 top deck stations with
> 4 vintage lights, and 4 par lights. the pars light are going to replace the
> par lights we have in the titanic scene now. the smoestack pars which we have
> 2 gorup, will have each 2x4 pars starting indexes from the closes point of the
> smokestack in 2 chains going left and right to have the 360 around the
> circular smokestacks-> Update the smokestacks pars too from the current
> scene. The LED strings are needed, and we need 2 TE fixtures, one on the
> other side. each te sign have 2 components, which 2 controllers each with 1
> output. fix the scene, maybe addd missing features (circular path generator
> for DMX with parameters to sewt the starting of the chain, and number of
> sploits, or stuff like that to allow the chains I need. each chain will be 1
> group. Each 5 pars 1 group. each 4 vintage 1 group. smokestacks left/right
> all togeher 1 gorup. top deck pars, each 4 2 group, each group will be
> focused on one side of the ship"

## 0. Where the scene stands today (evidence base)

`simulation/scenes/titanic/scene_config.yaml` — 84 `parLights` fixtures in 15
groups, 12 traces, 8 LED strands (all `group: ''` → Ungrouped):

| Group (current) | Count | Type | Source |
|---|---|---|---|
| Left Front Wall Generator | 5 | ShehdsBar | line trace |
| Left Back Wall Generator | 5 | ShehdsBar | line trace |
| Right Front Wall Generator | 5 | ShehdsBar | line trace |
| Right Back Wall Generator | 5 | ShehdsBar | line trace |
| Left Front Deck Generator | 4 | VintageLed | line trace (⚠ brightness-0 override) |
| Left Back Deck Generator | 4 | VintageLed | line trace |
| Right Front Deck Generator | 4 | VintageLed | line trace |
| Right Back Deck Generator | 4 | VintageLed | line trace |
| Left Top Chimney Generator | 10 | UkingPar | **circle** trace r=3, arc 360 |
| Right Top Chimney Generator | 10 | UkingPar | **circle** trace r=3, arc 360 |
| Left Center Auditorium Generator | 7 | UkingPar | line trace |
| Right Center Auditorium Generator | 7 | UkingPar | line trace |
| **Left Center Auditorium** (no trace) | 7 | UkingPar | **ORPHAN DUPLICATE** |
| **Left Back Wall** (no trace) | 5 | ShehdsBar | **ORPHAN DUPLICATE** |
| TE Sign | 2 | TeSignV3A40/B34 | generator, locked, x −15.5 / rotY −90 |

Key observations:

- **Orphan duplicates.** `Left Center Auditorium` (7) and `Left Back Wall` (5)
  sit at *byte-identical coordinates* to their `… Generator` twins. Root cause:
  the trace-rename handler (`gui_builder.js` ~L3743) sets
  `trace.groupName = trace.name` **then** regenerates — the regen sweep only
  removes fixtures matching the NEW group name, so the old-named set is
  orphaned forever. These 12 fixtures are stale residue and burn 2 view bits
  (`views.yaml` 262144 / 524288).
- **Every patch is empty.** `patches.yaml`: all fixtures have
  `controllerIp: ''`, universe 0, address 0; `controllers.yaml` has zero
  controllers. **The restructure is patch-free — renaming/replacing groups
  right now loses no mapping.** This window closes the moment real patching
  starts; do the restructure first.
- Smokestack circle traces have **no start-angle and no split concept** — the
  chain always starts at local angle 0 (+X) and runs one direction
  (`buildTracePath`, gui_builder.js ~L2482: `angle = (s/length)*arcRad`).
- The LED-generator work from design _26 is **fully present in the working
  tree** (see §6 S0): catalog (`led_generator_catalog.js` + 23 tests),
  ✨ Generators folder, LED Fixture Instances wrapper, second-sign confirm
  modal + `uniqueGroupName` suffixing, ordering helper wired into both render
  tails. Only its **report was never written** (a code comment references a
  nonexistent `20260724_30_led_generator_s2_s3.md`) and its S3 live proof was
  not documented. `led_generator_verify.cjs` exists untracked.

## 1. Target scene layout (after restructure)

**64 `parLights` fixtures · 16 groups · 12 traces · 8 LED strands (unchanged)
· 1 custom view.**

### 1.1 Exterior-wall stations (4 groups × 5 fixtures = 20)

The four wall stations map 1:1 onto the four existing wall line-traces — same
geometry, same fixture type, **renamed** to station names:

| Station group (new) | From | Count | Type |
|---|---|---|---|
| `Left Front Wall`  | Left Front Wall Generator  | 5 | ShehdsBar |
| `Left Back Wall`   | Left Back Wall Generator   | 5 | ShehdsBar |
| `Right Front Wall` | Right Front Wall Generator | 5 | ShehdsBar |
| `Right Back Wall`  | Right Back Wall Generator  | 5 | ShehdsBar |

⚑ Naming normalized: the operator wrote `LeftFrontWall, LeftBack, RightFront,
RightBack` — the last three without "Wall". All four are read as wall stations
(they are listed as "stations on the exterior walls") and named with the
repo's spaced convention. See §8-D1.
⚑ Fixture type kept as ShehdsBar (bars, not pars) — "Each 5 pars 1 group" is
read as these 5-count wall stations, with "pars" used loosely. See §8-D2.

### 1.2 Top-deck stations (4 vintage groups × 4 + 2 par groups × 4 = 24)

**Reading (evidence-based):** "4 top deck stations with 4 vintage lights, and 4
par lights" is resolved as: each of the 4 top-deck stations hosts **4 vintage
lights** (his rule "each 4 vintage 1 group" ⇒ 4 groups of 4 = 16 vintage —
exactly the existing 4×4 VintageLed deck groups), while the top-deck **pars
total 8 in 2 groups of 4** (his rule "top deck pars, each 4 2 group, each
group will be focused on one side of the ship" — 2 groups of 4 cannot be 4
groups or 16 pars). The alternative reading (4 pars *per station* = 16 pars)
contradicts "2 group" and is rejected. ⚑ Flagged §8-D3 — the single highest-
leverage question for his return.

| Station group (new) | From | Count | Type |
|---|---|---|---|
| `Left Front Deck`  | Left Front Deck Generator  | 4 | VintageLed |
| `Left Back Deck`   | Left Back Deck Generator   | 4 | VintageLed |
| `Right Front Deck` | Right Front Deck Generator | 4 | VintageLed |
| `Right Back Deck`  | Right Back Deck Generator  | 4 | VintageLed |
| `Top Deck Pars Left`  | **replaces** Left Center Auditorium Generator (7→4) | 4 | UkingPar |
| `Top Deck Pars Right` | **replaces** Right Center Auditorium Generator (7→4) | 4 | UkingPar |

- The two new par groups are **line traces** reusing the current Center
  Auditorium trace endpoints (port and starboard top-deck edges), `count: 4`.
- "focused on one side of the ship": default = the port group washes the port
  side, starboard washes starboard (aim outward/down along its own side).
  ⚑ §8-D4 — "focused on one side" could also mean cross-aimed; aim targets are
  a 10-second trace-card edit either way.
- "the pars light are going to replace the par lights we have in the titanic
  scene now": the UkingPar *auditorium* groups are the pars being replaced
  here (smokestack pars are handled by their own sentence, §1.3). The two
  orphan duplicate groups are deleted outright.

### 1.3 Smokestack chains (4 chain groups × 4 = 16) + umbrella

Each smokestack keeps its existing circle-trace center/radius/tilt but is
regenerated with the **new circular-chain parameters** (§3): `splits: 2`,
`countPerChain: 4`, `startAngle` at the point closest to the feed, chains
fanning left (CCW) and right (CW) to cover 360°:

| Chain group (new) | From | Count | Placement |
|---|---|---|---|
| `Left Smokestack L`  | Left Top Chimney Generator (10) | 4 | start+22.5° … +157.5° |
| `Left Smokestack R`  | 〃 | 4 | start−22.5° … −157.5° |
| `Right Smokestack L` | Right Top Chimney Generator (10) | 4 | start+22.5° … +157.5° |
| `Right Smokestack R` | 〃 | 4 | start−22.5° … −157.5° |

- **Index 1 is the fixture nearest the chain start** in each chain — matching
  "starting indexes from the closest point … 2 chains going left and right".
- Union of both chains = one fixture every 45°, true 360° coverage, no fixture
  doubled at the seam or the far side (half-step ±22.5° offset — ⚑ §8-D6).
- ⚑ "closest point of the smokestack" — closest to WHAT is unstated. Default:
  the **inboard point** (nearest the ship's centerline, where deck cabling
  arrives). The `startAngle` slider (§3) makes correcting this a 5-second live
  tweak with preview dots. §8-D5.
- **"smokestacks left/right all togeher 1 gorup"** vs "each chain will be 1
  group": the group model is FLAT (one `group` string per fixture — no
  nesting). Resolution: the 4 chain groups are the real groups (locks, masters,
  patching), and the umbrella is a **custom view** `Smokestacks` = union of
  the 4 chain groups (`views.custom: [{ name, bit, groups: […] }]` —
  first-class in `view_registry.js`, selectable as a named mask everywhere,
  incl. engine viewmasks + CaptainPad). ⚠ A custom view gives selection /
  masking / pattern targeting — **not** a single power master; blacking out
  all smokestacks = 4 group masters (or a pattern/mask blackout). If he wants
  one master knob over the union, that's a new "group-of-groups master"
  feature — NOT designed here. §8-D7.

### 1.4 TE Signs (2 groups × 2 = 4)

- `TE Sign` (existing): untouched — A+B at x −15.5 / rotY −90, locked, A≡B.
- `TE Sign 2` (**new**, "one on the other side"): created through the existing
  ✨ Generators → `+ TE Sign (A+B)` flow, which on the second click confirms
  via the themed modal and creates the unique-suffixed group **`TE Sign 2`**,
  born locked (`groupOverrides['TE Sign 2'] = {enabled, brightness, locked}`),
  its own rigid unit (gui_builder.js ~L4345–4370). `isTeSignConfigs`
  (`group_lock.js` L86) routes each group's rigid moves through
  `applyTeSignPlacement` **per group** — two signs never co-locate because
  they are separate locked groups.
- Initial pose (⚑ §8-D8): mirrored estimate on the starboard auditorium wall —
  approx `x +17, y 9.015, z −5.5, rotY +90` — then fine-placed with renders
  (the ship sits diagonally in world coords; exact placement is a
  render-and-nudge task, exactly how sign 1 was placed).
- **Patching/controller implications** ("each te sign have 2 components, which
  2 controllers each with 1 output"): 4 controllers total, 1 output each,
  1 component per output. Channel footprints per sign: A = 120 ch, B = 102 ch
  — each fits a single universe. Proposed mapping-session plan (controllers
  don't exist yet; `controllers.yaml` is empty, `nextUniverse: 2`):

  | Controller | Output | Fixture | Universe (proposed) | Ch |
  |---|---|---|---|---|
  | sign1-a | 1 | TE Sign V3 A | U10 @ addr 1 | 120 |
  | sign1-b | 1 | TE Sign V3 B | U11 @ addr 1 | 102 |
  | sign2-a | 1 | TE Sign 2 V3 A | U12 @ addr 1 | 120 |
  | sign2-b | 1 | TE Sign 2 V3 B | U13 @ addr 1 | 102 |

  Actual IPs/universes are set live in the Controller Mapping panel when the
  hardware is on the bench — ⚑ §8-D9 (IPs unknown, operator offline). Nothing
  in this design pre-writes patch data.
- **Model YAMLs untouched** (`dmx/fixtures/te_sign_v3/model_a_120.yaml`,
  `model_b_102.yaml` — read-only dot data). Sign 2 reuses the same two
  `fixture_type` strings, so the incoming **pixel-ORDER update** (YAML
  replacement) automatically covers both signs; nothing here reads pixel order.

### 1.5 LED strings

**Kept exactly as-is:** the 8 strands (`Left_Front_Left` … `Right_Front_Left`),
all Ungrouped — the operator pruned this census himself; do not restore or
regroup anything ("The LED strings are needed" = keep, nothing more).

### 1.6 What gets deleted

| Deleted | Why |
|---|---|
| `Left Center Auditorium` ×7 + `Left Back Wall` ×5 (orphans) | stale rename duplicates (§0) |
| `Left/Right Center Auditorium Generator` ×7 each (+ their 2 traces) | replaced by the 2 top-deck par groups (traces **replaced**, not appended) |
| 12 smokestack pars (2×10 → 2×8) | regenerated as 2×(2×4) chains |
| stale `views.yaml` bits for removed/renamed groups | auto-reconciled by `reconcileGroupBits` on save |

`patches.yaml` entries for deleted names drop out on the next save
(regenerated from `gatherAllConfigs`); all are empty, so nothing is lost.

## 2. Group plan (exactly per his rules)

| His rule | Realization | # |
|---|---|---|
| "Each 5 pars 1 group" | 4 wall stations, 5 fixtures each | 4 |
| "each 4 vintage 1 group" | 4 deck stations, 4 VintageLed each | 4 |
| "top deck pars, each 4 2 group, each … one side" | `Top Deck Pars Left` / `Right`, 4 each, side-aimed | 2 |
| "each chain will be 1 group" | 4 smokestack chain groups, 4 each | 4 |
| "smokestacks left/right all togeher 1 gorup" | custom view `Smokestacks` (union mask — §1.3 caveat) | (1 view) |
| TE signs | `TE Sign`, `TE Sign 2` — locked, A≡B each | 2 |
| **Total parLights groups** | | **16** |

Every group automatically gets: one power-of-two view bit (exporter →
`reconcileGroupBits`), a named mask + auto view, a drawer folder with the full
toolbar (Select All / ● On / ✏ Rename / 🔒 Lock / ⏻ Group On / Brightness %),
`groupOverrides` master honored by `applyFixtureOutputOverrides` (blackout
_27 parity), and lock-rigid moves (_24). No new plumbing needed for any of
that — it is all keyed by the flat group name.

## 3. Missing feature: circular-chain DMX generator ("starting of the chain" + "number of sploits")

Philosophy fit: this is **not** a new generator kind — it is two backward-
compatible parameters on the existing **circle trace**, reusing 100 % of the
placement math (`buildTracePath` arclength curve, aim modes, regeneration
contract). Generators stay "cards in 📐 Group Generator whose output lands in
Light Instances" — unchanged mental model.

### 3.1 New trace fields (circle shape only; absent ⇒ today's behavior, byte-compatible)

```yaml
startAngle: 0        # deg, 0–360. Rotates the chain origin around the ring.
                     #   0 = local +X (today's implicit start). "the starting
                     #   of the chain".
splits: 1            # int 1–4. Number of chains. 1 = today's single group.
splitLayout: mirror  # 'mirror' (splits=2: chains fan CCW ("L") and CW ("R")
                     #   from startAngle, arc/2 each) | 'sequential' (chains
                     #   head-to-tail around the arc, same direction).
                     #   Only meaningful when splits > 1.
```

`count` keeps its name but with `splits > 1` it means **per chain**
(smokestack: `splits: 2, count: 4` → 8 fixtures). ⚑ §8-D6.

### 3.2 Placement math (reuses the arclength curve)

- `buildTracePath` circle branch: `angle = startRad + (s/length)*arcRad`
  (tangent likewise). One-line change; lines/corners untouched. The 64-segment
  preview ring (~L2805) and the point-drag nearest-arclength projection
  (~L3205) pick up the same offset — they all call `path.at()`.
- For `splits > 1`, per-point angles come from a **new pure helper module**
  (mirror of `led_generator_catalog.js` discipline — no DOM/THREE, fail-loud,
  unit-tested): `simulation/src/dmx/trace_chains.js`:

  ```js
  // chainPlan(trace) -> [{ suffix:'L', groupName, angles:[deg…] }, …]
  //   splits=1  -> [{ suffix:null, groupName: trace.groupName, angles: today's even layout }]
  //   mirror/2  -> L: start + (i+0.5)*step ; R: start − (i+0.5)*step,
  //                step = arc/(2*count)  (360°,4 ⇒ ±22.5,67.5,112.5,157.5)
  //   sequential-> chain k spans [start + k*arc/splits, …), count evenly inside
  // chainGroupNames(trace) -> ['<g> L', '<g> R']  (or ['<g> Chain 1'…])
  //   splits=1 -> [trace.groupName]   — used by BOTH gui_builder and config.js
  ```

  Index 1 of every chain is the fixture nearest `startAngle`, per the spec.
- `generateGroupFromTrace` changes:
  - the pre-sweep removes fixtures whose group is in the **union** of
    `chainGroupNames(trace)` **plus** the legacy `trace.groupName` (so
    regenerating a converted trace cleans up its old single group);
  - fixtures are emitted chain-major, `group = chainGroupName`,
    `name = '<chainGroup> <i+1>'` (stable-name regeneration contract with the
    controller mapping is preserved per chain — survivors keep addresses);
  - the casualties hook (`controllerMappingFixturesRemoved`) gets the same
    union treatment; aim modes run per point exactly as today (`lookAt` and
    `*_locked` are position-based and split-agnostic; `direction` mode uses
    the per-chain first/last points).
- `config.js` L146 re-stamp: `traceGroupNames` set becomes the union of
  `chainGroupNames(t)` over generated traces (import the pure helper) — chain
  groups stay `traceGenerated` across load, and `uniqueGroupName`'s trace-
  collision dodge (report _29) keeps working because callers already pass
  trace group names; S2 must pass the **chain** names into that union too.
- **Scope cut:** with `splits > 1`, per-point drag offsets (`pointOffsets`)
  are ignored and the preview dots are not draggable — a split ring is an
  even-coverage primitive. splits=1 keeps offsets exactly as today. ⚑ §8-D10.

### 3.3 UI (circle trace card, ~L3765)

- `Start Angle °` slider (0–360, step 1) → `updateTracePreview` (live dots).
- `Chains` int slider (1–4) + `Layout` dropdown (mirror/sequential, shown when
  Chains > 1) → preview + (if generated) regenerate-on-change like
  radius/arc already do.
- Generated-group folders: nothing new — each chain group is an ordinary
  Light Instances group (the "🔧 Generated" chip already keys off
  `traceGenerated`).
- Nice-to-have (NOT required): tint the two chain-start dots in the preview.

### 3.4 Other features the spec forces — smallest set

1. **Circular-chain params** (above) — the only hard blocker.
2. **Custom view `Smokestacks`** — mechanism already exists
   (`view_registry.createCustomView` / View Masks editor); this is scene
   content, not code.
3. **Trace-rename orphan fix** (optional but cheap and directly caused today's
   mess): remember the pre-rename `chainGroupNames`, sweep them on the rename
   regenerate. Recommended fold-in to S2; flag if skipped.
4. **Nothing else.** No per-station template entity: "stations" are realized
   as naming + grouping conventions (wall/deck stations are plain line
   traces). The TE Sign 2 flow, lock, blackout, unique-naming, custom views,
   and patching panel all exist.

## 4. Implementation slice plan (for Opus agents)

**Territory law:** `gui_builder.js` is single-owner at any instant. Scene
YAMLs are owned exclusively by S3. `config.js` is S2's. Pure new modules are
parallel-safe.

### S0 — Reconcile the cancelled S2/S3 LED-generator slice (small, first, blocking nothing)
**Finding:** design _26's S2 wiring is COMPLETE in the working tree (TE Sign
button removed from the DMX toolbar ~L1344; ✨ Generators + catalog click flow
~L4318–4405 incl. second-sign modal + `uniqueGroupName`; `LED Fixture
Instances` wrapper + `_orderLedFixtureInstances` wired at ~L2338 and ~L4947),
S1 files + `led_generator_verify.cjs` exist untracked, tests are green
(484/484) — but the report the code cites (`20260724_30_led_generator_s2_s3.md`)
**does not exist** and no live S3 proof is on record.
- **Work:** run `agent_tools/led_generator_verify.cjs` read-only against the
  running stack (own browser, autosave stubbed, CLOSE it); write the missing
  `_30` report (or fold its content into this campaign's S4 report and fix the
  code comment); fix anything the verify turns up.
- **Files:** report only (plus `gui_builder.js` comment if renumbering).
- **Verify:** verify-tool PASS, screenshots inspected, `npm test` still green.

### S1 — `trace_chains.js` pure module (parallel-safe, new files only)
- **Files:** `simulation/src/dmx/trace_chains.js`,
  `simulation/tests/trace_chains.test.js` (new).
- **Work:** `chainPlan` / `chainGroupNames` per §3.2, fail-loud validation
  (splits int 1–4, startAngle finite, mirror requires splits=2, count ≥1).
- **Must NOT touch:** `gui_builder.js`, `config.js`, scene YAML.
- **Verify:** `node --check`; `npm test` (484 baseline + new). Cases: splits=1
  passthrough equals today's even layout (incl. closed-360 no-seam rule);
  mirror-2 angle sets (±22.5…157.5 for 360/4); sequential-N; group names;
  legacy-name union; validation throws.

### S2 — gui_builder + config wiring (sequential, after S1; single-owner window on gui_builder.js)
- **Files:** `simulation/src/gui/gui_builder.js`, `simulation/src/core/config.js`.
- **Work:** §3.2 `buildTracePath` startAngle; `generateGroupFromTrace` chain
  loop + union sweep + casualties union; §3.3 card controls; config.js
  re-stamp via `chainGroupNames`; disable point-drag for splits>1; (optional
  fold-in) rename-orphan sweep. No LED-section edits — S0's territory is
  disjoint but serialize with S0 anyway (same file).
- **Verify:** `node --check`; full `npm test`; read-only puppeteer probe
  (OWN throwaway browser, `params.autoSave=false` + :6970 aborted, CLOSE it):
  params-only in-page split of a synthetic circle trace produces 2 groups of
  4 at the expected angles with index 1 nearest startAngle, regenerate is
  idempotent, undo restores; drawer screenshot showing the two new sliders —
  visually inspected. **No scene write.**

### S3 — Scene restructure (sequential, after S2; owns scene YAMLs; drives the LIVE stack)
The operator's stack autosaves `scene_config.yaml` from his open browser, so
disk edits under a live page risk clobber. **Do the restructure through the
running app's real UI** (the same machinery the operator would use — also the
honest end-to-end test of S2), with autosave ON deliberately.
- **Pre:** copy `simulation/scenes/titanic/*.yaml` to `~/tmp/` (timestamped)
  and record `git diff` of the scene files. Never restart the stack.
- **Steps (each followed by a render check):**
  1. Delete orphan groups `Left Center Auditorium`, `Left Back Wall`.
  2. Rename the 4 wall traces → `Left/Right Front/Back Wall`; regenerate
     (5× ShehdsBar each, geometry unchanged).
  3. Rename the 4 deck vintage traces → `Left/Right Front/Back Deck`;
     regenerate (4× VintageLed each). Carry the Left-Front-Deck brightness-0
     override to the renamed key (⚑ §8-D11).
  4. Replace the 2 Center Auditorium traces with `Top Deck Pars Left/Right`
     (rename + count 7→4 + re-aim per §1.2), regenerate.
  5. Convert both smokestack traces: rename → `Left/Right Smokestack`,
     `splits: 2`, `count: 4`, `startAngle` = inboard point (eyeball via
     preview dots + render), regenerate → 4 chain groups.
  6. ✨ Generators → `+ TE Sign (A+B)` → confirm modal → `TE Sign 2`;
     rigid-place at the §1.4 estimate via the locked-group numeric inputs
     (routes through `applyTeSignPlacement`); render-and-nudge.
  7. Create custom view `Smokestacks` over the 4 chain groups (View Masks
     editor).
- **Verify (live, read-only probes after each mutation batch):** group census
  = §2 table (16 groups, counts 5/4/4/4/2); per-sign A≡B byte-identical
  transforms; `TE Sign 2` locked; blackout sweep — for each new group toggle
  ⏻ Group On off → fixtures dark in render, DMX bytes zeroed
  (`applyFixtureOutputOverrides` path), back on; lock sweep — one member +Δx
  moves the whole group; `views.yaml` bit census (no dupes, orphan bits gone);
  scene reload round-trip (fresh probe page loads the saved YAML cleanly —
  the mid-restructure scene must load at every step since autosave persists
  continuously). Screenshots of every station, visually inspected.

### S4 — Model re-export + full-stack parity + report (sequential, final)
Scene changes invalidate `marsin_engine/models/titanic.{js,effects.js,viewmasks.js}`.
- **Work:** re-export the engine model via the exporter flow; verify pixel
  census (2×74 sign px + par/DMX px + 320 strand px), per-group sections /
  view bits incl. the `Smokestacks` custom mask in viewmasks; engine loads the
  model (hot-reload path per report `20260724_3`; do NOT restart the
  operator's engine unless the runbook says reload is insufficient — then
  flag, don't act); CaptainPad views list sanity via its API. Write the
  campaign report; note the expected `marsin_engine/states/` residue rule.
- Also the drop point for the **incoming pixel-ORDER YAML update** if it
  arrives mid-campaign: replace the two model YAMLs, re-export again — no
  other slice interacts with pixel order.

**Dependency graph:** `S0 → S1 → S2 → S3 → S4` with only S1 parallel to S0
(different files). S0/S2 serialize on `gui_builder.js`; S3 owns scene YAMLs;
S4 owns the export artifacts.

## 5. Migration / safety

- **Loads cleanly mid-restructure:** every S3 step is an ordinary UI operation
  the scene format already round-trips (rename+regen, count change, generator
  click, override write). No schema change; a YAML saved after any step opens
  in current code. S2's new trace keys are optional-with-defaults — old
  scenes (test_bench included) parse and behave byte-identically
  (`splits`/`startAngle` absent ⇒ legacy path).
- **TE Sign V3 model YAMLs:** read-only throughout; sign 2 references the same
  `fixture_type` strings; pixel-ORDER update remains a pure YAML swap.
- **A≡B per sign:** enforced per locked group by `isTeSignConfigs` →
  `applyTeSignPlacement` (gizmo + numeric paths, report _24). Two groups = two
  independent rigid units; S3 verifies byte-identical transforms per sign.
- **Blackout (_27):** DMX-side groups (all 16) are gated by
  `groupOverrides` → `applyFixtureOutputOverrides` (universe bytes zeroed) —
  new groups inherit by name, zero code. LED-strand gating
  (`ledOutputScale`) is untouched (strand census unchanged). S3's per-group
  off sweep is the proof.
- **Lock (_24):** `locked` rides `groupOverrides[name]`;
  `pruneGroupOverrides` persists it; renamed groups must carry their override
  bag — the par-side ✏ Rename already does this (report _28), and
  trace-rename-driven regeneration writes fresh groups (overrides for deleted
  names are pruned). The only override that must be hand-carried is the
  Left-Front-Deck brightness-0 (§8-D11).
- **Patching:** zero mapped fixtures today ⇒ zero mapping migration. After S3,
  names are final — the mapping session (bench, with real controller IPs)
  patches against stable names; regeneration keeps `<group> N` names stable
  per chain thereafter.
- **Rollback:** `~/tmp` scene snapshot + git working-tree diff recorded before
  S3; restoring = copying the snapshot back and reloading (operator-gated if
  his browser is open).

## 6. Explicit non-goals

- No group-of-groups power master (umbrella is a view/mask — §1.3).
- No LED-strand regrouping/restoration; no strand generator.
- No changes to `te_sign_generator.js`, `group_lock.js` logic, model YAMLs,
  exporter code (S4 only *runs* it), engine code.
- No pre-written patch data / controller entries (bench session with hardware).
- No corner/line trace changes beyond none; no splits on non-circle shapes.

## 7. Slice plan summary (one line each)

| Slice | Owner files | Mode |
|---|---|---|
| S0 reconcile cancelled LED-gen S2/S3 (verify + missing report) | report (+`gui_builder.js` comment) | first; ∥ S1 |
| S1 `trace_chains.js` pure math + tests | new files | ∥ S0 |
| S2 circle-chain wiring (startAngle/splits UI+gen+re-stamp) | `gui_builder.js`, `config.js` | after S0+S1 |
| S3 scene restructure via live UI + per-step renders/checks | scene YAMLs (via app) | after S2 |
| S4 engine model re-export + parity + campaign report | model artifacts | last |

## 8. Defaults chosen while operator offline (⚑ CONFIRM ON RETURN)

| # | Default chosen | Alternative he might have meant |
|---|---|---|
| D1 | All 4 exterior stations are WALL stations, named `Left Front Wall / Left Back Wall / Right Front Wall / Right Back Wall` (he wrote 3 of 4 without "Wall") | "LeftBack" etc. as non-wall stations |
| D2 | Wall stations keep **ShehdsBar** ×5 (his "each 5 pars 1 group" read as these; "pars" loose) | swap walls to real par type (one dropdown per trace + regen) |
| D3 | **Top-deck composition:** 4 stations × 4 vintage (16, 4 groups) + **8 pars total in 2 side groups of 4** — from "each 4 vintage 1 group" + "top deck pars, each 4 2 group" | 4 pars per station (16 pars — contradicts "2 group") |
| D4 | Top-deck par groups aim **outward along their own side** (port washes port) | cross-aimed / down-deck focus |
| D5 | Chain start = **inboard point** of each smokestack (closest to ship centerline, assumed cable drop); `startAngle` slider makes it trivially adjustable | closest to bow / to the station box / to the other stack |
| D6 | `count` = per chain; chains offset ±half-step (±22.5°) ⇒ perfectly even 45° coverage, no fixture exactly at the start point | first fixture exactly AT the start point (uneven seam/far side) |
| D7 | "smokestacks all together 1 group" = **custom view `Smokestacks`** (selection/mask umbrella; groups don't nest). NOT a single power master | wants one master knob ⇒ new group-of-groups feature (not designed) |
| D8 | TE Sign 2 initial pose = mirrored estimate (`x +17, y 9.015, z −5.5, rotY +90`), then render-guided nudge | he places it himself; or a different wall entirely |
| D9 | Sign controller patching deferred to a bench session (no IPs; proposed U10–13 plan in §1.4) | pre-seed controllers.yaml now |
| D10 | Per-point drag offsets disabled when `splits > 1` (even ring primitive) | draggable per-chain points (bigger slice) |
| D11 | Carry the Left-Front-Deck `brightness: 0` override across the rename **as-is** | reset it to 100 (it looks like a parked test value) |
| D12 | Old `… Generator` group names dropped now while every patch is empty (free rename window) | keep legacy names |
| D13 | Orphan duplicate groups (`Left Center Auditorium` ×7, `Left Back Wall` ×5) deleted | he wanted the duplicates (very unlikely — identical coords) |
| D14 | S3 executes through the LIVE app UI with autosave on (+ `~/tmp` backup), never restarting his stack | stack-down offline YAML edit session |

## 9. Open questions for the operator

1. §8-D3 above all: **4+4 per station, or 16 vintage + 8 pars total?** (Design
   assumes the latter; if you truly want 16 top-deck pars, the group rule
   "each 4 → 2 group" needs restating and the par traces double.)
2. Wall fixture type: keep the ShehdsBar bars, or literal pars? (D2)
3. What is the smokestack chains' physical feed point (defines `startAngle`)? (D5)
4. Is the smokestacks umbrella a *view/mask* (designed) or do you want one
   master brightness/on-off over all 4 chains? (D7)
5. TE Sign 2: confirm the target wall/pose after seeing the S3 renders. (D8)
6. Reset the Left Front Deck brightness-0 override? (D11)
7. The old-generator naming is gone after S3 (`Left Front Wall` etc.) — any
   muscle-memory objection before patching starts? (D12)
