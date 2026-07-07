# Design — Model-independent FIXTURE TYPE metadata for patterns

**Date:** 2026-06-18
**Author:** designer/investigator agent (requested by Sina)
**Type:** Investigation + design (NO production code changed; no git ops)
**Scope studied:** `simulation/` scene→model exporter, `marsin_engine/`
model load + WASM meta injection + VM globals, `27_swipe.js` as the
worked example, the named-mask / view-mask machinery, and the
cross-model breakage.

---

## 0. TL;DR

`fixtureType` (e.g. `UkingPar`, `ShehdsBar`, `VintageLed`) is **already
authored per-fixture in the scene** and **already written into every
engine model pixel as a string** — but it is **silently dropped at the
engine→WASM boundary**. Patterns at runtime only receive four integers:
`controllerId, sectionId, fixtureId, viewMask`. Everything a pattern
uses to know "which pixels are which" (`fixtureId`, group bits / view
masks) is **model-specific** and reshuffles when you switch models,
which is exactly why `27_swipe.js` works on `test_bench` and renders the
whole rig **black** on `titanic`.

The fix is to carry the *fixture type* — the one already-stable,
already-shared property — through to the VM as a **per-pixel interned
integer type-id** plus an **injected `FIX_*` constant table** (the exact
same mechanism already proven for view masks in
`view_mask_constants.js`). Patterns then say `if (fixtureType ==
FIX_PAR)` instead of `if (fixtureId >= 1 && fixtureId <= 4)`, and the
same pattern runs unchanged across every model.

---

## 1. Current pipeline map (file:line)

### 1.1 Source of truth — the scene (simulation)

Per-fixture `fixtureType` is authored in the scene config and survives
all the way into the model:

- `simulation/scenes/test_bench/scene_config.yaml` — every fixture entry
  carries `fixtureType:` (e.g. `fixtureType: UkingPar`,
  `fixtureType: VintageLed`, `fixtureType: ShehdsBar`,
  `fixtureType: ChauvetHaze4D`, `fixtureType: TEFogMachine`).
- `simulation/src/dmx/fixture_definition_registry.js:25-66` — the
  registry keyed **by `fixture_type`** (`getDefinition(fixtureType)`,
  `listTypes()`); this is the canonical enumeration of fixture types in
  the sim, loaded from fixture model YAMLs at startup.
- The per-fixture identity that *is* model-specific lives in
  `simulation/scenes/<scene>/patches.yaml`: `fixtureId`, `sectionId`,
  `controllerId`, `viewMask` (all per-named-fixture, all assigned
  per-model). E.g. `test_bench/patches.yaml` → Par 1 `fixtureId: 1` …
  Bar Right `fixtureId: 8`.
- Named view masks (group/preset bitfields) live in
  `simulation/scenes/<scene>/views.yaml` (`groupBits` + `custom` views),
  authored via the Views panel
  (`simulation/src/gui/view_masks_editor.js`) and the scene-owned
  registry `simulation/src/dmx/view_registry.js`. See report
  `202606/20260610_3_sim_owned_views_and_save_hardening.md`.

### 1.2 Export — scene → engine model (the exporter)

`simulation/src/dmx/pixelblaze_model_exporter.js` writes the engine
model. **`fixtureType` is already emitted per pixel:**

- `:77-88` and `:127-138` build each pixel record with
  `fixtureType: light.type || light.fixtureType || 'UkingPar'`
  alongside `cId/sId/fId/vMask`.
- `:214-224` the raw LED-strand branch emits `type: 'led'` (and
  `fixtureType: ''` — strands have no DMX fixture type today).
- `:278` the serializer line — the model pixel literal — already
  includes `fixtureType: '${p.fixtureType || ''}'`:

  ```
  { i: 0, type: 'dmx', fixtureType: 'UkingPar', name: 'Par 1 - rgbwau_1',
    group: 'ParLights', ..., cId: 1, sId: 1, fId: 1, vMask: 0, patch: {...}, channels: {...} }
  ```

So `marsin_engine/models/test_bench.js:13+` and
`marsin_engine/models/titanic.js` **already contain `fixtureType` on
every pixel.** It is present and correct in the artifact today.

### 1.3 Load + inject — engine → WASM VM (where the type is LOST)

- `marsin_engine/engine.js:971-977` builds the per-pixel meta array on
  model load — and it only copies FOUR fields:

  ```js
  const metaArray = model.pixels.map(px => ({
    controllerId: px.cId || 0,
    sectionId:    px.sId || 0,
    fixtureId:    px.fId || 0,
    viewMask:     px.vMask || 0,
  }));
  wasmHost.setPixelMeta(metaArray);
  ```

  `px.fixtureType` is **not read here.** Same omission on hot-reload at
  `engine.js:1192-1196`.
- `marsin_engine/lib/wasm_host.js:224-247` `setPixelMeta()` packs each
  pixel into a **fixed 4×Int32 struct** in WASM heap:
  `[controllerId, sectionId, fixtureId, viewMask]`
  (`metaBufSize = pixelCount * 4 * 4`, `:235`). There is **no fifth
  slot** for a type-id.
- `marsin_engine/lib/marsin_wasm_runtime.js:134-152` — the alternate
  runtime path, identical 4-int packing.
- The WASM VM (`marsin_pb/wasm/marsin-engine.{wasm,cjs}`) is a
  **compiled binary**; the C source is NOT in the repo. The VM exposes
  these four ints to patterns as the documented per-pixel globals
  (`docs/MARSIN_ENGINE_PATTERNS.md:159-166`): `controllerId`,
  `sectionId`, `fixtureId`, `viewMask`. **This 4-int struct is the hard
  ABI boundary** any new per-pixel field must cross.

### 1.4 View-mask name → integer injection (the pattern we will copy)

The "named selection" problem was already solved for view masks WITHOUT
touching the VM, by compile-time constant injection:

- `marsin_engine/lib/view_mask_constants.js` — `buildMaskConstants()`
  (`:40-58`) turns the model's `groupBits` + `viewMasks` into a
  `{MASK_NAME: bit}` table; `injectMaskConstants()` (`:92-113`) prepends
  `var MASK_X = <bit>;` for every `MASK_*` the pattern source references,
  and **throws loudly** on an unknown reference (codex P0, no silent
  zero).
- `marsin_engine/lib/wasm_host.js:74-94` — every compile funnels through
  `compile()` which calls `injectMaskConstants()`, so resolution is
  uniform across boot/mixer/live-edit/blends.
- Sidecars: `marsin_engine/models/<model>.viewmasks.js` export
  `groupBits` + `viewMasks`; the engine validates them against the
  loaded model and fails on drift (per the sidecar header + docs/13).
- Pattern usage example:
  `marsin_engine/patterns/summer_camp/70_forest_canopy_reveal.js:32-33,
  163-166`:

  ```js
  var MASK_REDWOOD_PARS = 64;
  ...
  var isRedwoodByMask = (viewMask & MASK_REDWOOD_PARS) != 0;
  ```

**This is the template for the whole fixture-type design.** Fixture
types are just "named masks that are stable across models," resolved the
same way.

### 1.5 The worked example — `27_swipe.js`

`marsin_engine/patterns/27_swipe.js` (the pattern Sina pointed to) is the
canonical "optimized-per-fixture-type" pattern, and it is the canonical
victim of the cross-model break:

- `:163-171` self-filters and picks a per-fixture-type lane using
  **hardcoded `fixtureId` ranges**:

  ```js
  if      (fixtureId >= 1 && fixtureId <= 4) { nPix = 4;  ord = 4 - fixtureId; }      // pars  — X
  else if (fixtureId >= 5 && fixtureId <= 6) { nPix = 6;  ord = (fixtureId==5?9:15)-index; } // vintage — Y
  else if (fixtureId >= 7 && fixtureId <= 8) { nPix = 36; ord = (fixtureId==7?33:69)-index; } // bars — X
  else { rgb(0,0,0); return; }                                                          // P0 self-filter
  ```

  Everything it relies on — the fId→type mapping, the per-type pixel
  counts, the per-type ordinal lanes — is **`test_bench`-specific
  numerology** baked into the pattern. The comment header even documents
  it as "fId4 left … fId1 right," "bars fId 7..8," etc.

### 1.6 Where it BREAKS across models (the pain point, proven)

Comparing `test_bench` vs `titanic` model artifacts:

| Property | test_bench | titanic | Stable? |
|---|---|---|---|
| `fId` per pixel | 1..8 (per fixture) | **0 on every pixel** | NO |
| `groupBits` | `ParLights=1, VintageLights=2, BarLights=4` | 26 generator/hull groups, totally different names+bits (`titanic.viewmasks.js:9-35`) | NO |
| `viewMasks` (presets) | `pars`, `bars`, `vintages`, … | **empty `[]`** (`titanic.viewmasks.js:38`) | NO |
| `sId` | 1=Pars,2=Vintage,3=Bars | not the same partitioning | NO |
| **`fixtureType`** | `UkingPar/VintageLed/ShehdsBar` | `UkingPar/VintageLed/ShehdsBar` (+ `''` for 480 raw LED strands) | **YES** |

So on `titanic`, `27_swipe.js`'s `fixtureId>=1` test is false for *every*
pixel → the whole rig renders black. `MASK_PARS` doesn't exist on
titanic either. The ONLY thing that survived the model switch with stable
semantics is `fixtureType`. Across all four shipped models the entire
fixture-type vocabulary is just six tokens:

```
''(raw LED strand) ChauvetHaze4D ShehdsBar TEFogMachine UkingPar VintageLed
```

(`grep` over `marsin_engine/models/*.js`: 480× `''`, 792× ShehdsBar,
180× VintageLed, 54× UkingPar, 2× ChauvetHaze4D, 2× TEFogMachine.)

---

## 2. Proposed design — fixture type as a stable, model-independent property

### 2.1 Principle

Promote `fixtureType` to a **first-class per-pixel runtime property**,
carried as an **interned integer type-id** (not a string in the VM), and
exposed to patterns both as:

1. a per-pixel global **`fixtureType`** (integer id), and
2. injected **`FIX_*` named constants** (`FIX_PAR`, `FIX_BAR`,
   `FIX_VINTAGE`, `FIX_RAW_LED`, …) resolved at compile time — the exact
   `view_mask_constants.js` mechanism.

Pattern code becomes model-independent:

```js
// before (test_bench-only):
if (fixtureId >= 1 && fixtureId <= 4) { ... pars ... }
// after (every model):
if (fixtureType == FIX_PAR) { ... pars ... }
```

The type id is **stable** because it derives from the
`fixture_definition_registry` vocabulary, which is shared across all
scenes — not from per-model fId/group/bit assignment.

### 2.2 Data model + the stable id mapping

- **Source of truth:** the scene's per-fixture `fixtureType` string
  (already authored) + the canonical type list from
  `simulation/src/dmx/fixture_definition_registry.js`.
- **Canonical type registry** (NEW, shared file, e.g.
  `marsin_engine/lib/fixture_type_constants.js` mirroring
  `view_mask_constants.js`): a single canonical
  `{typeName: id}` map that is **global and append-only** — ids are
  assigned once, never renumbered, never per-model. Suggested seed:

  ```
  0 = UNKNOWN / untyped
  1 = RawLed        (the type:'led' strands; '' today → must be named)
  2 = UkingPar      (→ FIX_PAR alias)
  3 = VintageLed    (→ FIX_VINTAGE alias)
  4 = ShehdsBar     (→ FIX_BAR alias)
  5 = ChauvetHaze4D (effects-only)
  6 = TEFogMachine  (effects-only)
  ```

  Plus a **semantic-alias layer** so patterns target a *role* not a SKU:
  `FIX_PAR → {UkingPar}`, `FIX_BAR → {ShehdsBar}`,
  `FIX_VINTAGE → {VintageLed}`, `FIX_RAW_LED → {RawLed}`. Aliases let a
  future "different brand of par" join `FIX_PAR` without touching
  patterns. (Mirrors how a view mask can union multiple groups.)

- **Carried through compile→bytecode→runtime** by extending the per-pixel
  meta struct from 4 ints to **5 ints**:
  `[controllerId, sectionId, fixtureId, viewMask, fixtureTypeId]`.

### 2.3 How a pattern reads it

- Per-pixel global **`fixtureType`** (integer) available in `render3D`,
  exactly like `fixtureId`/`viewMask` today.
- Compile-time **`FIX_*`** constants injected by a new
  `injectFixtureConstants()` (clone of `injectMaskConstants`), wired into
  `wasm_host.compile()` right next to the mask injection
  (`wasm_host.js:82-94`). Unknown `FIX_*` → loud compile error listing
  known types (codex P0, no silent zero).

`27_swipe.js` rewritten target form (still self-filters, but portably):

```js
if      (fixtureType == FIX_PAR)     { ... X lane ... }
else if (fixtureType == FIX_VINTAGE) { ... Y lane ... }
else if (fixtureType == FIX_BAR)     { ... X lane ... }
else { rgb(0,0,0); return; }
```

(The intra-type ordinal/lane numerology — pixel counts, head order —
still needs *a* per-type geometry source; see Open Question Q3. The
type-targeting half is fully solved by this design; the
"per-type-optimized geometry" half is partially solved and flagged.)

### 2.4 "Typed views" — all par lights, any model

A **typed view** is a named mask whose membership is computed FROM the
fixture type rather than from manual per-fixture bit assignment:

- The sim auto-derives a view per fixture type at export
  (`pars`/`bars`/`vintages` already exist as `custom` views in
  `test_bench/views.yaml`, but they're tied to model-specific *groups*).
  Re-key them so the membership predicate is `pixel.fixtureType == T`,
  and emit them in `<model>.viewmasks.js` for EVERY model
  automatically (titanic's `viewMasks: []` would gain `pars/bars/
  vintages` for free, derived from its already-correct per-pixel
  `fixtureType`).
- Two consumption paths, both already exist and stay compatible:
  - **bit path** (existing): typed view → a `MASK_*` bit; patterns do
    `viewMask & MASK_PARS`. Works today's way, now populated on all
    models.
  - **direct path** (new, cleaner): `fixtureType == FIX_PAR`. No bit
    budget consumed, no per-model bit assignment, immune to the 32-bit
    view-mask ceiling.

The direct path is the real fix for "views/groups change when I switch
models": fixture-type targeting **never depends on a per-model bit at
all.**

### 2.5 The ABI hurdle (must read)

The VM is a prebuilt WASM binary (`marsin_pb/wasm/marsin-engine.wasm`);
its C source is not in this repo. Exposing a **new** per-pixel global
(`fixtureType` as the 5th meta int) requires the VM to read a 5-int
stride and bind a new global — i.e. **a WASM rebuild**, which is owned
outside this tree (`marsin_pb`). Two implementation tiers:

- **Tier A (no VM rebuild) — ship now.** Do NOT add a 5th global.
  Instead repurpose the **existing** injection + existing globals:
  1. Generate `FIX_*` constants as **bitmask** contributions into the
     per-pixel `viewMask` (reserve a high, conventionally-fixed bit
     block for fixture types, assigned identically on every model). Then
     `fixtureType == FIX_PAR` is expressed as `viewMask & MASK_PAR != 0`,
     where `MASK_PAR` is a **model-independent fixed bit** (unlike
     today's per-model group bits). Patterns get model-independence
     immediately; the only cost is reserving a fixed slice of the 32-bit
     viewMask for type bits.
  2. This needs only: exporter to OR a fixed type-bit into `vMask`, and
     `view_mask_constants` to register the fixed `FIX_*`/`MASK_*` type
     bits. **Zero VM change.** This is the recommended first delivery.
- **Tier B (VM rebuild) — clean end state.** Extend the meta struct to 5
  ints and expose `fixtureType` as a true per-pixel integer global +
  `FIX_*` constants via `injectFixtureConstants`. Cleaner, no viewMask
  bit budget pressure, integer equality instead of bit math. Schedule
  when a `marsin_pb` WASM rebuild is on the table.

Both tiers present the SAME authoring surface to pattern writers
(`FIX_PAR` etc.), so patterns written against Tier A keep working under
Tier B.

### 2.6 Migration / back-compat

- **Existing models:** `fixtureType` is already in every pixel literal —
  no model regeneration needed for the data, only for the new
  derived `viewmasks` entries / type bits (a sim re-export per scene,
  same flow as `202606/20260610_3`).
- **Existing patterns:** untouched. `fixtureId`, `sectionId`, `viewMask`,
  `MASK_*` all keep working. `27_swipe.js` keeps running on `test_bench`
  exactly as today until someone opts it into `FIX_*`. The new globals/
  constants are purely additive.
- **Raw LED strands (`fixtureType: ''`, 480 px on titanic):** must be
  given a real type name (`RawLed`) so they're targetable. Exporter:
  map `type:'led'` → `fixtureType: 'RawLed'` instead of `''`. This is the
  one data change to existing behavior; it is additive (empty string was
  never targetable anyway).
- **No fallbacks:** unknown/missing fixture type must resolve to an
  explicit `UNKNOWN`(0) id and unknown `FIX_*` references must **throw at
  compile** — never silently match nothing (codex P0).

---

## 3. Cross-task dependency analysis (Tasks 2 & 3)

This task is **adjacent to and must not diverge from**:

- **Task 2 — "named masks":** typed views ARE named masks whose key is a
  fixture type instead of a hand-assigned group. They MUST share one
  injection mechanism. Concretely: `view_mask_constants.js`'s
  `buildMaskConstants` / `injectMaskConstants` is the substrate. Fixture
  types should be registered into the *same* constant table and the
  *same* `wasm_host.compile()` injection pass, so a pattern can freely
  mix `MASK_*` (manual named masks) and `FIX_*` (typed). If Task 2 is
  rebuilding/renaming this machinery, fixture-type constants must land
  inside that refactor, not a parallel copy. **Hard alignment point:
  one constant registry, one injector, one validation pass.**

- **Task 3 — "MarsinScript strings":** Fixture types are *named*, and the
  obvious authoring sugar is `if (fixtureType == "UkingPar")`. **My
  design deliberately does NOT depend on VM string support.** It uses
  **interned integer ids + compile-time-injected `FIX_*` constants**,
  identical to how view masks avoid strings today. This means:
  - **Needs strings:** NOTHING in the core design. (Optional nicety: if
    Task 3 lands real string comparison in the VM, a future ergonomic
    layer could allow `fixtureType == "UkingPar"` resolved to the id —
    but that is sugar, not a requirement.)
  - **Uses interned ids/enums:** the entire core design — the type id,
    the meta struct field (Tier B), and the `FIX_*` constant injection
    (both tiers).

  **Recommendation:** keep fixture-type targeting string-free so it can
  ship independently of Task 3. Let Task 3 add optional string sugar on
  top later; do not block on it.

### Recommended implementation ORDER

1. **Task 2 (named masks) substrate first**, OR confirm
   `view_mask_constants.js` is the agreed single injection point.
   Fixture-type constants live in that substrate — building it twice is
   the divergence risk.
2. **Fixture-type Tier A** (this design, no VM rebuild): canonical type
   registry + `RawLed` naming + fixed type bits in `viewMask` + `FIX_*`
   constants in the shared injector + auto-derived typed views on every
   model. Ship the portable `27_swipe.js` rewrite as proof.
3. **Fixture-type Tier B** (true 5th per-pixel global) — only when a
   `marsin_pb` WASM rebuild is scheduled. Same `FIX_*` surface, so
   patterns from step 2 are unaffected.
4. **Task 3 (strings)** — independent; optionally adds `"UkingPar"`
   sugar afterward. Never a blocker for steps 1-3.

---

## 4. Files that would change + risks

**Tier A (recommended first):**
- `simulation/src/dmx/pixelblaze_model_exporter.js` — name raw strands
  `RawLed` (`:214-224`); OR a fixed per-type bit into `vMask` (`:88,138,
  224`).
- `simulation/src/dmx/view_registry.js` / `view_masks_editor.js` —
  auto-derive `pars/bars/vintages` typed views from `fixtureType` for
  every scene (so titanic stops shipping `viewMasks: []`).
- `marsin_engine/lib/view_mask_constants.js` (or the Task-2 successor) —
  register fixed `FIX_*`/type-`MASK_*` constants; keep loud-unknown
  behavior.
- `marsin_engine/models/*.viewmasks.js` — regenerated (sim re-export).
- `marsin_engine/patterns/27_swipe.js` — opt into `FIX_*` (proof).
- `docs/MARSIN_ENGINE_PATTERNS.md:159-166` — document `fixtureType` /
  `FIX_*`.

**Tier B (adds, when WASM rebuild available):**
- `marsin_pb` C source + `marsin-engine.wasm` rebuild — 5-int meta
  stride + `fixtureType` global. **Out of this repo tree.**
- `marsin_engine/lib/wasm_host.js:224-247` and
  `marsin_engine/lib/marsin_wasm_runtime.js:134-152` — pack the 5th int
  (`metaBufSize` 4→5, write `m.fixtureTypeId`).
- `marsin_engine/engine.js:971-977, 1192-1196` — map
  `fixtureTypeId: typeIdOf(px.fixtureType)`.
- `marsin_engine/lib/fixture_type_constants.js` (NEW) —
  `injectFixtureConstants`, wired into `wasm_host.compile()`.

**Risks:**
1. **VM ABI is a prebuilt binary** — any true new per-pixel global (Tier
   B) needs an out-of-tree WASM rebuild + the auto-check engine suites
   re-run. Tier A sidesteps this; recommend shipping Tier A first.
2. **viewMask bit budget (Tier A)** — reserving a fixed high slice of the
   32 bits for fixture types reduces bits available for manual named
   masks. Titanic already uses 26 group bits (`0x02000000`); a fixed type
   block must be coordinated with Task 2's bit allocator to avoid
   collisions. **This is the sharpest coordination point with Task 2.**
3. **Canonical id stability** — the `{typeName: id}` map must be
   append-only and global; renumbering would silently re-target every
   pattern. Needs a single owned file + a test that ids never move.
4. **Raw-LED typing** — `''→RawLed` is a (benign, additive) behavior
   change to the exporter; verify nothing keys off the empty string
   (checked: `global_effects_controller.js` keys off `Fog/Horn/Fire`
   substrings and `VintageLed`, not on empty string).
5. **Intra-type geometry still unsolved** — `FIX_*` solves *targeting*,
   not the per-type ordinal lanes `27_swipe` needs (pixel counts, head
   order). Without a per-type geometry source the swipe still can't lay
   out a *new* model's bars correctly even once it targets them (Q3).

---

## 5. Open questions for Sina

- **Q1 — Tier A vs Tier B sequencing.** Ship the no-VM-rebuild Tier A
  (fixed type bits in `viewMask`, `FIX_*` constants) now, with the clean
  5th-global Tier B later when a `marsin_pb` WASM rebuild is scheduled?
  Or hold for the clean version?
- **Q2 — type vs role granularity.** Should patterns target the SKU
  (`UkingPar`) or the role (`FIX_PAR`, which could later include other
  par brands)? I recommend role aliases over SKU ids; confirm.
- **Q3 — intra-type geometry.** `27_swipe` needs per-type pixel ordering
  (par row order, bar pixel count, vintage head order). Fixture type
  alone doesn't carry that. Do you want a companion **per-type geometry
  descriptor** (ordinal/axis hints) carried in the model so swipes lay
  out correctly on *any* model — or is targeting-only enough for now and
  geometry stays normalized-coord (`nx/ny`) based?
- **Q4 — bit budget coordination.** How many of the 32 viewMask bits may
  fixture types reserve under Tier A, and who owns the allocator shared
  with Task 2's named masks?
- **Q5 — raw LED strands.** OK to rename `fixtureType: ''` → `'RawLed'`
  in the exporter so strands become targetable (`FIX_RAW_LED`)? Any
  finer raw-LED subtypes (e.g. strip vs dot) you want named now?
- **Q6 — canonical registry location.** New shared file
  `marsin_engine/lib/fixture_type_constants.js` mirroring
  `view_mask_constants.js`, or fold fixture types directly into the
  Task-2 named-mask registry so there is exactly one table?

---

## 6. References

- Pipeline: `pixelblaze_model_exporter.js:77-138,214-224,278`,
  `fixture_definition_registry.js`, `engine.js:971-977,1192-1196`,
  `wasm_host.js:74-94,224-247`, `marsin_wasm_runtime.js:134-152`,
  `view_mask_constants.js`, `docs/MARSIN_ENGINE_PATTERNS.md:159-166`.
- Worked example: `marsin_engine/patterns/27_swipe.js:163-171`.
- Named-mask precedent:
  `marsin_engine/patterns/summer_camp/70_forest_canopy_reveal.js:32-33,163-166`.
- Cross-model proof: `marsin_engine/models/test_bench.viewmasks.js`
  vs `titanic.viewmasks.js`, and `fId: 0` everywhere in `titanic.js`.
- Prior art: `202606/20260610_3_sim_owned_views_and_save_hardening.md`,
  `202606/20260618_0_bar_swipe_handoff.md` (the "two views" note),
  `202605/20260525_4_view_mask_options.md`.
