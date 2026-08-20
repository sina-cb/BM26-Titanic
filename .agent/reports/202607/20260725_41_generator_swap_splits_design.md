# 20260725_41 — Generator swap start/end + splits: design + implementation plan

**Author:** designer/investigator (Fable) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-29
**Operator intent (verbatim shape):** (1) a **swap start/end** button on DMX-light
generators, because reversed physical wiring vs generated order "will be a big
problem mapping fully"; (2) a **"split"** option: subsections over a generator's
fixtures WITHOUT changing the count, each split with a start and an end index
(start may equal end; start>end = reversed), e.g. Left Front Wall Generator:
split 1 = 4→5, split 2 = 3→2, split 3 = 1→1 — to "set the direction of the
lights" and "optimize the data flow easily" during mapping (addressing/chain
order, not physical positions); (3) if per-split machinery is heavy, a simple
swap is acceptable — but design splits properly first and say honestly which
serves mapping better.

Read-only investigation (one Explore sub-agent traced the trace/generator
subsystem; the DMX-chain side was read directly). No source edits, no stack
touches, no git ops. Composes with `_33` (mapping plan, Phase B authoring),
`_34` (sId/fId union fix), `_35` (parity validator), `_37` slice (bench sync),
`20260724_32` (circle station-chains design — see §1.6, a naming hazard),
`20260724_37` (generator rename fix).

---

## 0. TL;DR

Design **splits as a renumbering rule applied at generation time**: a
`chainSplits` list on the trace permutes **which path position gets which
fixture number**, so that fixture numbering = physical daisy-chain order.
Because the controller registry's allocation model is *sticky absolute
addresses keyed by fixture NAME* (docs/33 decision 19) and regeneration keeps
names stable, this one permutation fixes mapping **retroactively** (an
already-mapped generator re-lands its existing addresses on the correct
physical lights with zero chain surgery) **and prospectively** (adding
fixtures in plain numeric order IS wire order). The swap button is the same
mechanism — the single full-reverse split — not a second code path.

**Nothing else changes.** No registry, panel, projection, patches.yaml,
exporter, engine, or CaptainPad surgery: chains stay ordinary
`{fixture, at}` entries, so the `_35` validator's drift check reads splits'
*effect* natively; splits themselves live in `scene_config.yaml` (which the
validator already loads) and get one new well-formedness check. Every index
must be covered exactly once across splits or the generator refuses to
(re)generate, loudly; a count change that invalidates splits is refused, never
silently reconciled.

**Recommendation (the one decision): build splits.** Under this design they
are NOT heavy — one pure module + card UI + a ~15-line emission permutation +
one validator check. A swap-only feature is strictly a subset and would leave
the segment-wiring case (his 4→5 / 3→2 / 1→1 example) unsolved at titanic
scale. Splits serve mapping better; swap rides along for free.

Plan: **12 numbered steps** (§6), ~9 core + 3 optional/operator-gated.

---

## 1. Findings

### 1.1 How a generator makes fixtures (gui_builder.js)

- `buildTraceObject` (:2629–2881) builds only the 3D preview (path wireframe,
  spacing-gradient dots, green start / red end / yellow aim handles). Fixture
  generation is `generateGroupFromTrace(traceIndex, skipUndo, previousGroupName)`
  (:3344–3572).
- Points come from `computeTracePoints` (:2544): even arclength layout along
  `buildTracePath` (line start→end; corner start→corner→end; circle CCW),
  plus clamped per-point `pointOffsets` (order can never invert). Fixtures are
  emitted in a single forward loop `pts.forEach((pt, i) …)` (:3377) and named
  `` `${groupName} ${i + 1}` `` (:3532) — **fixture number = path position**,
  today. The "Generator" in "Left Front Deck Generator 1" is just the
  operator's chosen groupName.
- Per-fixture fields written: group, name, fixtureType, color/intensity/angle,
  penumbra (hard 0.5), x/y/z, rotX/Y/Z (aim math), `traceGenerated: true`,
  controllerIp. **No DMX patch fields, no metadata** — those are projected by
  the controller registry (:3562–3565) or defaulted by the card.
- **Regen = delete-and-recreate** (`sweepGeneratedInstances`, :3360). The
  explicit contract (:3353–3358, comment at :3988–3991): *names are stable per
  index; under an active registry, patches are PROJECTED, so survivors
  re-derive the same addresses by name*. Count shrink → casualties flow
  through `window.controllerMappingFixturesRemoved` (chain entries drop;
  addresses are absolute, nothing shifts).
- **Boot regenerates every `generated` trace from scratch** (:4057–4061) — the
  generated fixture rows in scene YAML are derived data. Anything a splits
  feature bakes into fixture rows must be reproducible from the trace alone.
- Aim math hazard: `direction` mode derives fixture local-X from
  `pts[0] → pts[last]` (:3392–3425) and the `*_locked` modes latch deltas on
  `i === 0` (:3373–3375, :3495, :3512). Any reordering must therefore permute
  the **assignment**, not the path walk (§3.4).
- Rename (`20260724_37`): remove-old-first + regenerate; renaming a *mapped*
  generator drops its chain entries as casualties. Pre-existing behavior, out
  of scope here; splits never change the name set, so they never touch it.

### 1.2 How order flows into DMX patching (controller_registry.js, panel)

- **Allocation model (docs/33 decision 19, header :15–21):** every chain entry
  stores its ABSOLUTE address — `{fixture, at}` — assigned ONCE at add time
  from the end of the universe's occupancy map, **sticky thereafter. Chain
  order never influences addresses** ("ports are pure cable topology,
  exactly like the physical rig"). Bare-string entries are legacy and project
  loudly unpatched (`unallocated`, :1497–1505).
- The panel add flow (`controller_map_editor.js`): `addNamesToPort`
  (:1731–1835) allocates `at = allocate(footprint)` **in the order the names
  arrive** (:1791–1815). Names arrive from "+ sel" (*3D selection, in
  selection order*, :1661–1664) or "+ list" pick mode (*one per click, in
  chain order*, :1670–1672). Panel hint (:753–756) states the model verbatim.
- **There is deliberately NO group-level add** (:1726–1729, operator decision
  2026-06-11: a real-rig group spans 6–15 controllers; groups are a tray
  filter only). So today, mapping a 15-light generator in wiring order = 15
  clicks in exactly the right sequence — the pain the operator is naming.
- `projectOntoConfigs` (:1738+) writes projected patch fields onto configs by
  NAME and mints metadata: `sectionId` sticky per **group**, `fixtureId`
  monotonic + sticky, floors over the DMX ∪ LED union (`_34`). **Neither
  depends on chain order nor on path position** — reordering/renumbering a
  generator cannot shift section identity or collide ids.
- `moveChainEntry` (:1087) exists (cosmetic chain reorder; addresses stick).
  `renameFixtureInChains` (:1100) has no production caller.
- **Scope boundary:** LED chains are the opposite world — strand order IS
  load-bearing (cumulative `cursorByte`, `computeLedProjection` :1256–1286;
  docs/41 §3 linear mapping). This feature applies to **DMX trace
  generators only** (traces generate `parLights`); LED strand chains are
  untouched.

### 1.2b Prior art: the operator already does this by hand

`scenes/studiodj/controllers.yaml` (:83–139) carries exactly the requested
semantics, hand-authored: generator group `LeftSmokeStack` split across two
ports with reversed segments — port 1 U6 chain `6@1, 7@11, 8@21, 1@31`;
port 2 U7 chain `5@1, 4@11, 3@21, 2@31` (same for `RightSmokeStack`,
`Front`, `Line 3` reversed `3/2/1`). Chains reference generator fixtures by
their `<group> N` names in real scenes today; this feature formalizes the
existing practice and removes the click-in-exact-order burden.

### 1.3 What the `_35` validator reads (scene_model_parity.cjs)

- Loads all four scene YAMLs **including `scene_config.yaml`** (tools CLI
  :147/:162) + the three model files; re-states every rule independently of
  `src/` (its design decision (a)).
- Drift check re-derives `patches.yaml` from `controllers.yaml` chains — since
  splits materialize as ordinary `{fixture, at}` entries, the validator reads
  their effect natively, no schema teaching required. The only NEW invariant
  is splits well-formedness (§5), one small added check against the
  `sceneConfig.traces` it already has in hand.

### 1.4 Persistence + undo

- Trace objects are serialized **verbatim** (`config.js:255–258`) — a new
  `chainSplits` field persists with zero schema work, rides `:6970/save`,
  and `captureSnapshot` (undo.js:25–42) already deep-clones `traces`, so
  undo/redo is free for lil-gui-driven edits. Raw DOM buttons must call
  `pushUndo()` explicitly (the delete button at :4021 is the template).

### 1.5 Engine / CaptainPad impact: none beyond what any regen already does

- Splits emit fixtures in **name order 1..N** (only positions permute), so
  they add NOTHING to model-order churn. But note the pre-existing regen
  behavior they ride on: every regen sweeps the group and re-pushes it at the
  **end** of `params.parLights` (:3360, :3530), shifting downstream model
  pixel indices and `.viewmasks.js` `pixelIndices` — coherent because the
  exporter re-emits model + sidecars in ONE pass on save
  (`pixelblaze_model_exporter.js` saveModelJS), and the `_35` coverage check
  compares against the saved scene. Regen also re-mints `fixtureId`s (per-
  fixture metadata is lost on delete-and-recreate; projection mints fresh
  monotonic ids). Both are pre-existing, split-independent, and already
  survived by every consumer (engine/CaptainPad re-derive from the model).
- Patterns consume normalized coordinates; par fixtures are single-pixel
  (`localIndex 0`). CaptainPad Dimmer Rack keys on `sectionId`
  (group-sticky, §1.2). No consumer re-derives anything from path-position
  order.

### 1.6 Naming hazard: `splits` is already a reserved trace field

`simulation/src/dmx/trace_chains.js` (design `20260724_32` §3, slice S1 done,
S2 unwired, **zero importers in src/**) reserves `trace.splits` as an **int
(1–4)** for the circle station-chains feature (mirror/sequential chain
GROUPS with per-chain count — a geometry/naming feature, orthogonal to this
one). This feature therefore uses a distinct field name, **`chainSplits`**
(array), and the two must never be conflated. Reconciliation of the two
operator-facing vocabularies is a flagged follow-up (§7).

---

## 2. The design decision: renumbering, not add-order sugar

Two candidate semantics for splits were weighed:

- **(a) Enumeration-only:** names keep path positions; splits merely reorder
  the list of names handed to the panel's add flow. Prospective only — for an
  ALREADY-mapped generator whose wiring turns out reversed, sticky addresses
  mean re-chaining by hand (unmap + re-add), and plain numeric order stays
  wrong forever.
- **(b) Renumbering (CHOSEN):** splits permute the index→position assignment
  at generation time — fixture **number j** is placed at **path position
  order[j]**, where `order` is the split expansion. Fixture numbering =
  position in the physical daisy chain (which is also the DMX-tech
  convention). Consequences, both directions:
  - **Retroactive:** a mapped generator + splits + Regenerate → survivors
    keep their sticky addresses BY NAME, and the names now sit at the
    wiring-correct positions. The reversed-wiring discovery costs one button,
    zero chain surgery, zero address churn (§4 walks it).
  - **Prospective:** adding fixtures in plain numeric order (or any sorted
    add) IS wire order; each split is a contiguous **number** range, so
    per-split port targeting ("split 2 goes on port 3") is just "add G 3..G 4
    to port 3".

(b) is strictly stronger, costs the same, and changes no downstream schema.
A third option — teaching chains a `{generator, split}` entry kind — was
rejected outright: it would ripple through projection, the panel, the `_35`
validator, the `_37`-slice bench sync, and the exporter, for no capability
(a) + (b) don't already deliver.

---

## 3. The data model + semantics

### 3.1 YAML schema (scene_config.yaml, per trace)

```yaml
traces:
  - name: Left Front Wall Generator
    shape: line
    count: 5
    # NEW — optional. Absent = identity order (1..count), byte-identical
    # output to today. Empty array = INVALID (loud), never "same as absent".
    chainSplits:
      - { from: 4, to: 5 }   # split 1: positions 4→5 (forward)
      - { from: 3, to: 2 }   # split 2: positions 3→2 (reversed)
      - { from: 1, to: 1 }   # split 3: position 1 alone
    …existing fields unchanged…
```

`from`/`to` are 1-based **path positions** (the geometric order along the
trace, start→end — the numbers the operator reads off the preview today).
`from > to` walks backwards. `from == to` is a single light.

### 3.2 The one derived object

`order = expandChainOrder(chainSplits, count)` — concatenation of each
split's inclusive walk. For the example: `[4, 5, 3, 2, 1]`. Then generation
emits, for j = 0..count−1: fixture named `${groupName} ${j+1}` at the
path-position data `order[j]`. Absent `chainSplits` → `order = [1..count]`
→ **byte-identical emission to today** (pinned by test).

### 3.3 Validity (checked in ONE pure function, used everywhere)

`chainSplitsError(chainSplits, count)` returns `null` or a message naming the
exact defect. Invalid iff any of:

| Rule | Example message |
|---|---|
| non-integer / < 1 / > count endpoint | `split 2: to=7 outside 1..5` |
| index covered twice (within or across splits) | `position 3 covered twice (splits 1 and 2)` |
| index never covered | `positions {1,2} not covered by any split` |
| empty array | `chainSplits: [] — declare full coverage or remove the field` |

Exact cover of 1..count, no exceptions, no auto-repair (codex P0).

### 3.4 Emission rule (the only generation change)

Inside `generateGroupFromTrace`: compute per-point data (worldPt + aim
rotations) **in path order exactly as today** — the aim math's `pts[0]`,
`pts[last]`, `i === 0` latches and `pointOffsets` all stay keyed by path
position, so a fixture at position p aims identically whatever its number —
then emit fixtures through `order`. Everything else (sweep, survivors,
casualties, reprojection, autosave) is untouched because the NAME SET is
unchanged.

### 3.5 Loud invalidation (count changes, hand-edits)

- **Interactive count change** (`Lights` slider) on a trace with
  `chainSplits`: if the new count invalidates them → `alert` naming the gap
  (`chainSplits cover 1..5 but count is now 7 — fix or clear the splits
  first`), revert the slider, NO regen. Splits are never silently dropped or
  stretched.
- **Any (re)generate call** with invalid splits (incl. hand-edited YAML):
  interactive → alert + refuse; **boot** regen loop (:4057) → `console.error`
  + red badge on the trace card + skip that trace's regen, leaving the
  YAML-loaded fixture rows exactly as saved (nothing invented — the loaded
  scene still renders; the generator is marked broken until fixed).
- **Validator backstop** (§5) catches the same condition offline/CI.

### 3.6 Swap = the same mechanism

`⇄ Swap start/end` toggles `chainSplits` between absent and the single
full-reverse split `[{from: count, to: 1}]` (and recognizes+clears exactly
that shape). No separate `reversed` flag — one source of truth, one code
path, and the card's status row reads `5→1 (reversed)`.

### 3.7 Interaction with mapped groups (the confirm)

Applying a splits/swap change to a trace that is `generated` AND has mapped
fixtures pops one loud confirm before regenerating:
`"5 mapped fixture(s) keep their DMX addresses (sticky by name) but renumber
to the new chain order — physical positions of each address will change.
Continue?"` — mirroring the existing custom-patch confirm (:3987–4007), which
stays as-is for the no-registry case.

---

## 4. The operator's example, end-to-end

Left Front Wall Generator, `count: 5`, positions p1..p5 along the wall
(path order), UkingPar footprint 10ch. `chainSplits` as §3.1 →
`order = [4, 5, 3, 2, 1]`.

**Generation** (names → positions):

| Fixture name | Path position | Meaning |
|---|---|---|
| … Generator 1 | p4 | wire enters here |
| … Generator 2 | p5 | forward to wall end |
| … Generator 3 | p3 | jump back, reversed run |
| … Generator 4 | p2 | |
| … Generator 5 | p1 | last, alone |

**Mapping** (panel, add G1..G5 in numeric order to controller `Wall-1`
port 2 = U3, empty universe; allocation from end of occupancy):

```yaml
# controllers.yaml (written by the panel — ordinary entries, no new schema)
- port: 2
  universe: 3
  chain:
    - { fixture: Left Front Wall Generator 1, at: 1 }
    - { fixture: Left Front Wall Generator 2, at: 11 }
    - { fixture: Left Front Wall Generator 3, at: 21 }
    - { fixture: Left Front Wall Generator 4, at: 31 }
    - { fixture: Left Front Wall Generator 5, at: 41 }
```

**Projection → patches.yaml → model:** G1 U3:1 @p4 · G2 U3:11 @p5 ·
G3 U3:21 @p3 · G4 U3:31 @p2 · G5 U3:41 @p1. On the wall, the tech dials
1, 11, 21, 31, 41 **in cable order** — data flow optimized, direction per
segment exactly as wired. The `_35` validator sees ordinary chains, patches,
model: drift/patch-truth/coverage all green with zero new teaching.

**Retroactive variant:** the group was already mapped 1..5 = U3:1..41 back
when numbering was path order, then the wiring is discovered as above.
Setting the same splits + Regenerate keeps every address (sticky by name) and
moves the names to the wiring-true positions — identical end state, no
unmap/re-add, no address holes.

---

## 5. Validator + failure modes

**New check (small), in `simulation/lib/scene_model_parity.cjs`:** family
`generator_splits` — for every `sceneConfig.traces[]` entry carrying
`chainSplits`: re-state §3.3 independently (pure arithmetic, no import from
`src/`, per the validator's own design rule) and emit
`generator_splits/invalid_cover` (ERROR, both modes) naming trace + defect.
Absent field → no finding. This is the "representable in what the validator
reads" requirement: the *intent* is validated in scene_config.yaml, the
*effect* is already validated by the existing chain/patch/model families.

*Deliberately NOT added:* an order-vs-addresses conformance check. Manual
address pins are legal operator overrides (decision 18/19) and a mapped-order
warning would fight them; if wanted later it belongs as a default-severity
`warning` (§7 follow-up).

*Bench-parity interplay:* `checkBenchParity` compares chain strings
**literally** (`scene_model_parity.cjs:1463–1465` — name@at joined). If a
test_bench generator ever gets splits + remapping, the derived `TB ` block
must be re-derived via `bench_section_sync.cjs` or `bench_controller_drift`
fires — which is the correct loud behavior, no change needed.

**Failure-mode table:**

| Mode | Behavior |
|---|---|
| Overlap / gap / out-of-range / empty splits | §3.3 error: card status row red + alert on apply; generate refuses; validator ERROR |
| Count change invalidating splits | Refused + reverted, splits kept (never dropped) — §3.5 |
| Boot with stale/hand-edited splits | console.error + red card badge + that trace's regen skipped; saved fixture rows left untouched |
| Splits on a mapped group | One loud confirm (§3.7), then sticky-address renumbering |
| Trace locked | New controls disabled like every other card control (DOM buttons explicitly, like `genBtn` :4012) |
| Rename | Name set unchanged by splits; rename behaves exactly as `20260724_37` |
| Field collision with `trace.splits` (int, `20260724_32`) | Avoided by name (`chainSplits`); documented in both places |
| Undo | lil-gui edits covered by the global snapshot hooks; DOM buttons call `pushUndo()` explicitly |

---

## 6. UI (matches the existing card vocabulary)

New collapsed sub-folder on the trace card (after `Lights`/`Preview`, before
`Aim Mode` — it is an ordering concern, like count):

```
▸ ⛓ Chain Order (wiring)
    Order        4→5, 3→2, 1 · covers 1–5 ✓        ← read-only status row
    ▸ Split 1     From [4]   To [5]                 ← lil-gui int ctrls, 1..count, step 1
    ▸ Split 2     From [3]   To [2]
    ▸ Split 3     From [1]   To [1]
    [+ Add split]   [− Remove last]                 ← DOM buttons, aBtnStyle row
    [⇄ Swap start/end]                              ← full-width DOM button
                                                      (⤺ Reset-offsets template)
    ⚠ 5 mapped fixtures keep addresses, renumber on Regenerate   ← note row, only when mapped
```

- Status row = the `Preview` pattern (`tFolder.add(info,'…').disable()` +
  `updateDisplay()`); red via a CSS class when `chainSplitsError` ≠ null.
- Steppers = `folder.add(split,'from',1,count,1)`; every change re-renders
  the status row and, when the trace is generated AND splits are valid,
  offers apply-on-`onFinishChange` through the §3.7 confirm.
- `⇄ Swap` toggles the full-reverse split (§3.6); label flips to
  `⇄ Restore path order` when active.
- Absent splits → folder shows only the status row (`1..5 (path order)`),
  `[+ Add split]`, and `[⇄ Swap start/end]` — the zero-clutter default.
- All DOM handlers: `e.stopPropagation()`, `pushUndo()`, `debounceAutoSave()`,
  `btn.blur()`; disabled under `trace.locked`.

---

## 7. The numbered plan (for the Opus implementer, `_42`)

Baseline: sim suite **721/0**. Operator's live stack (:6966–:6972, 5568)
untouched; browser work against :6969 only; no git ops; scratch in `~/tmp/`.

1. **Pure module** `simulation/src/dmx/generator_chain_order.js` (snake_case;
   sits beside `trace_chains.js` with a header cross-referencing §1.6):
   exports `chainSplitsError(splits, count)`, `expandChainOrder(splits,
   count)` (throws on invalid — never called blind), `describeChainOrder
   (splits, count)` (status-row string), `fullReverseSplits(count)`,
   `isFullReverse(splits, count)`. All imports at top; fail-loud messages per
   §3.3's table.
2. **Tests for 1**: `simulation/tests/generator_chain_order.test.js` — exact
   cover accepted (incl. single-split identity + full reverse + the operator's
   4→5/3→2/1→1), every §3.3 defect named, expansion values pinned, empty-array
   invalid, `from==to` single.
3. **Emission permutation** in `generateGroupFromTrace` (gui_builder.js
   ~:3377–3545): build `pointData[]` in path order (worldPt + rotX/Y/Z, aim
   math byte-identical), then emit via `order`. Guard at function top: invalid
   splits → interactive `alert` + return (no sweep, no mutation); boot path
   (`window._isAppBooting`) → `console.error` + card badge flag + return.
4. **Count-change guard** in the `Lights` onChange (:3873): invalid-under-new-
   count → alert + revert slider value + `updateDisplay()`, no regen.
5. **Card UI** (§6) in `renderGeneratorGUI` (~:3866, after the count block):
   status row, split sub-rows, add/remove/swap buttons, mapped-note row,
   §3.7 confirm, lock handling, explicit `pushUndo()` in every DOM handler.
6. **Boot-stale badge**: minimal — a red `⚠ CHAIN SPLITS INVALID` line in the
   card (same DOM row style as the mapped-note) driven by
   `chainSplitsError`, so the §3.5 boot skip is visible in the UI, not only
   the console.
7. **Validator check** (§5) in `simulation/lib/scene_model_parity.cjs` +
   CLI surfacing + tests in `simulation/tests/scene_model_parity.test.js`:
   one mutation per defect class (overlap / gap / range / empty), plus
   valid-splits scene stays clean. (Arithmetic re-stated, no `src/` import.)
8. **Generation tests** (extend the existing generator/trace test homes):
   (a) absent splits → byte-identical `parLights` output vs pre-change module
   (falsify against a pre-fix copy, `_34`-style); (b) example permutation:
   names→positions exactly §4's table; (c) rotations identical per PATH
   POSITION with and without splits (aim invariance); (d) pointOffsets follow
   path position, not number; (e) regen with splits keeps name set → survivor
   contract intact; (f) count-shrink casualties unchanged; (g) undo restores
   prior splits + fixture positions (captureSnapshot already clones traces —
   assert it round-trips `chainSplits`).
9. **YAML round-trip**: save-tree test that `chainSplits` survives
   `reconstructYAML` verbatim (config.js:255–258) and absent stays absent
   (no empty-array injection).
10. **Visual verification** (`.agent/skills/see_the_world.md`): fresh
    browser, **record `window.__gpuAdapter.renderer` next to every FPS/number
    per the `_39` ops rule**; on a scratch/test scene: create a 5-light line
    generator → generate → capture; apply the §4 splits → Regenerate →
    capture; `⇄ Swap` → capture; verify via fixture-card names + 3D selection
    that number↔position matches §4's table; inspect PNGs before claiming
    success (`.agent_renders/`, `--viewport 1280x720` on software-GL).
    Browser client of :6969 only; close probe browsers.
11. **Optional / operator-gated (separate decisions, NOT in the core wave):**
    (a) a "+ gen (numeric order)" bulk-add for generator groups in the
    Controllers panel — touches the 2026-06-11 "no group-level add" ruling,
    needs Sina's explicit yes; (b) chain-number sprite labels on preview
    dots (toggle); (c) the order-vs-addresses `warning` check (§5); (d) a
    "⟲ Remap group in chain order" panel tool (address-hole caveat under
    decision 19 — likely unnecessary given retroactivity).
12. **Close the loop**: report `_42`, master doc R8 row + Log, tracker entry,
    Notion follow-up cards for 11(a)–(d) and the §1.6 vocabulary
    reconciliation with `20260724_32` S2; run the touched auto-check specs
    (`ops/sim_auto_checks.md`, incl. the parity gate) before any merge-ready
    claim.

Dependencies: 1→2 first (pure, fast); 3–6 in one slice (all gui_builder);
7 independent; 8–10 after 3–6; 11 gated; 12 last. Estimated honest scope:
one Opus session.

---

## 8. Honesty notes

- I did not run the sim or any browser; findings are file-level (line numbers
  on the ~150-file dirty `feat/bm_readiness` tree — they drift).
- Two Explore sub-agents fed this report (trace/generator subsystem;
  DMX-chain flow). The chain agent's sweep confirmed §1.2 from source and
  added §1.2b (studiodj prior art), the §1.5 regen-order/fId-churn notes,
  the bench-parity literal-chain check, and the LED scope boundary. The
  retroactive path (§2b) is designed from the documented sticky-name
  contract, not observed live — step 8(e) proves it in tests; step 10 in
  the UI.
- `docs/41` §3/§5 (via the chain agent): LED linear mapping is why the LED
  side is explicitly out of scope; DMX chain reordering has no doc-41
  bearing.
- Renumbering changes what a fixture NUMBER means in the 3D scene (chain
  order, not path order). I judged this correct (it matches DMX-tech
  convention and the operator's own framing "the generated order") — but it
  is a semantic the operator should consciously ratify when he reviews this
  design; if he wants path-order numbering preserved, option (a) of §2 is
  the fallback design at the same UI cost, minus retroactivity.
- The boot-stale behavior (skip regen, keep saved rows) is the least-invented
  state I could find that still fails loudly; a hard boot throw would brick
  scene load over a YAML typo, which felt disproportionate — flagged for
  review rather than silently decided.
