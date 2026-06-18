# Named + expanded view-mask system — investigation & design

**Date:** 2026-06-18
**Author:** agent (designer/investigator, requested by Sina)
**Scope:** investigation only — no source changed, no git ops. Design
proposal for lifting the view-mask count cap and adding human-named
masks, aligned with Task 1 (fixture-type metadata) and Task 3
(MarsinScript strings).
**Status:** DESIGN / RFC — needs Sina's sign-off before implementation.

---

## TL;DR

- **Today a model supports at most 31 view masks**, total, shared
  between base group bits AND named composite presets. Root cause: every
  mask is **one bit in a single per-pixel `Int32` (`viewMask`/`vMask`)**
  that crosses into the WASM VM as `metaView[i*4+3]`
  (`lib/marsin_wasm_runtime.js:144-151`). 31 usable bits (bit 30 /
  `0x40000000` is the highest safe signed-Int32 bit).
- Masks are **already referenceable by name** in two places — but only as
  a *compile-time / mixer-time* convenience that resolves the name back to
  one of those 31 bits. The bit budget is the wall.
- **Proposed:** keep the fast 31-bit `viewMask` as a hot cache for the
  most-used masks, but make the **named-mask registry the real source of
  truth** with an *unbounded* set of named masks backed by **per-pixel
  membership stored host-side** (a compact per-mask `Uint8Array`/bitset
  the mixer already builds in `compileViewSelectionMask`). Names are
  interned to stable integer **mask-ids** at model-load. Patterns that
  need in-VM access keep using the existing `MASK_*` bit injection but now
  draw bits from an **LRU/declared working set** rather than a fixed
  global pool.
- This registry is the **shared substrate** Task 1's "typed views"
  (a named mask keyed by fixture type) and Task 3's string authoring sit
  on top of. Recommended order: **this (named-mask registry + id
  interning) → Task 1 (typed views as registry entries) → Task 3 (string
  authoring sugar), with Task 3 optional/parallel** because compile-time
  interned ids cover the runtime need without language strings.

---

## 1. Current mask system map (file:line)

### 1.1 Data model — what a mask IS

A view mask is a single power-of-two **bit**. Every pixel carries a
32-bit `viewMask` field that is the OR of all the masks it belongs to.

- **Sim (authoring / source of truth):**
  `simulation/src/dmx/view_registry.js`
  - `MAX_BIT = 0x40000000` (`:27`), `isPowerOfTwoBit()` (`:41-43`).
  - Registry shape (`:12-13`): `groupBits: { '<group>': bit }` +
    `custom: [ { name, bit, groups:[...] } ]`.
  - `usedBitmask()` (`:82-86`) ORs every group bit and custom-view bit.
  - `nextFreeBit()` (`:90-95`) walks `1 → MAX_BIT`, **returns 0 when all
    31 are taken**. Consumed at `:131` and `:228` (new group / new custom
    view). A `0` return is the silent-ish cliff (see §2.3).
  - Per-scene persistence: `scenes/<scene>/views.yaml`
    (`groupBits` + `custom`); per-fixture membership for custom views is
    stored in the fixtures' `viewMask` bitfield in `patches.yaml`. See
    report `20260610_3_sim_owned_views_and_save_hardening.md`.
- **Authoring UI:** `simulation/src/gui/view_masks_editor.js`
  (Views panel: create/rename/delete views, group chips, assign selected
  fixtures, validates power-of-two + collision-free bits).
- **Export → engine:** `saveModelJS()` emits `<scene>.viewmasks.js`
  sidecars (group→bit + named presets). Example
  `marsin_engine/models/test_bench.viewmasks.js`:
  - `groupBits` (`:9-13`) — 3 base groups.
  - `viewMasks` (`:15-21`) — 5 named composites
    (`ParsBars 0x08`, `pars 0x20`, …).

### 1.2 Engine load — bit assignment & validation

`marsin_engine/engine.js` `loadModel()`:
- Reads the sidecar (`:235-249`), validates `viewMasks` entries
  (`:255-291`): name required, unique, exactly one of `groups` /
  `pixelIndices`, explicit `bit` must be positive power-of-two
  `≤ 0x40000000`, no bit reuse.
- Comment at `:276-282` states the cap rationale verbatim: *"vMask is
  Int32 across the WASM … 0x80000000 passes the power-of-two check via
  Int32 coercion but …"* → bit 30 is the ceiling.
- Group→bit table (`:320-362`): sidecar `groupBits` is authoritative when
  present (strict two-way coverage vs. model groups, `:337-348`),
  otherwise derived first-appearance lowest-free-bit. **Out of bits ⇒
  throws** (`:355-357`, *"a model supports at most 31 distinct
  group/preset bits"*).
- Presets resolved & OR-merged into pixels (`:382-426`): group-based →
  OR of group bits; explicit-bit → tag pixels of named groups;
  `pixelIndices` → tag arbitrary pixels.
- Builds `maskConstants` (`:440`) and returns `{viewMasks, groupBits,
  maskConstants}` (`:443`). Hot-reload re-validates and re-pushes
  (`:1142-1207`).

### 1.3 Runtime — how the bit reaches the VM and patterns

- **The hard boundary:** `lib/marsin_wasm_runtime.js` `setPixelMeta()`
  (`:134-152`). Per-pixel meta is **4 Int32s** packed into `HEAP32`:
  `[controllerId, sectionId, fixtureId, viewMask]` (`:147-150`). The VM
  reads this struct in `_renderAllWithMeta` and exposes `controllerId`,
  `sectionId`, `fixtureId`, `viewMask` as pattern globals.
- **In-pattern access (per-pixel, inside VM):** patterns do
  `(viewMask & MASK_NAME) != 0`. Examples:
  `patterns/summer_camp/85_redwood_starry_canopy.js:184-185`,
  `patterns/summer_camp/70_forest_canopy_reveal.js:163-166`.
  `27_swipe.js` does NOT use viewMask — it self-filters on `fixtureId`
  ranges (`render3D` `:163-171`), which is the *other* selection style
  and a hint that fixture-id/type selection wants first-class support
  (Task 1).
- **Name→bit injection (compile time):** `lib/view_mask_constants.js`.
  `buildMaskConstants()` (`:40-58`) turns `groupBits` + `viewMasks` into
  `MASK_<SANITIZED_NAME> → bit`. `injectMaskConstants()` (`:92-113`)
  prepends `var MASK_X = <bit>;` only for referenced names; unknown name
  ⇒ loud compile error. **Names are resolved to integer literals before
  the compiler runs — the VM/language never sees a string.** This is the
  existing, working "named mask at author time, fast int at runtime"
  pattern and the template for the expanded design.
- **Channel/mixer selection (host-side, per-channel):**
  `lib/pattern_mixer.js` `compileViewSelectionMask()` (`:30-94`).
  Resolves `viewSelection.target` by name against the model's `viewMasks`
  (`:47-55`) into a bit, then builds a **per-pixel `Uint8Array(pixelCount)`
  membership mask** (`:34`, `:62-92`) used to overlay one channel onto a
  region (`commitBlendedLayerWithMask` `:115-125`). **Key insight: this
  path already keeps an arbitrary per-pixel membership array host-side —
  it does not strictly need a bit.** It uses a bit today only because
  membership is stored in `px.vMask`.

### 1.4 Count today

`grep -c name:` on sidecars: dome 2, logsville 2, test_bench 5,
titanic 0 composite presets (30 base groups, no composites yet —
`titanic.viewmasks.js`). Titanic alone will want far more than 31
named regions (decks, port/starboard, bow/stern, smokestacks, sails,
windows-by-deck, …), which is exactly the operator's complaint.

---

## 2. The hard limit and its root cause

### 2.1 The number: 31

One pixel = one `Int32 viewMask`. Signed 32-bit, bit 31 unsafe across the
JS↔WASM Int32 coercion, so **bits 0..30 ⇒ 31 masks total**. Enforced
identically in three independent layers:

1. Sim `view_registry.js` `MAX_BIT = 0x40000000` (`:27`).
2. Engine `loadModel` power-of-two `≤ 0x40000000` checks
   (`engine.js:327-330`, `:355-357`).
3. Runtime: the field is literally one `Int32` (`marsin_wasm_runtime.js:150`).

### 2.2 Why it's ONE pool shared by groups AND named masks

Base group bits and named composite presets are **not separate budgets** —
both consume bits from the same 31. `usedBitmask()` ORs both
(`view_registry.js:82-86`); the engine reserves explicit preset bits
*before* assigning group bits (`engine.js:325`, `reservedMask`). So on
titanic, **30 groups already burn 30 of the 31 bits**, leaving room for
exactly **one** named composite. That is the operator's wall, concretely.

### 2.3 Why masks can't be freely named/multiplied today

- The name is *cosmetic*: `MASK_*` and the mixer's `viewMasks.find(name)`
  both resolve to one of the 31 bits. Add a 32nd distinct mask and there
  is no bit to resolve to.
- The membership representation is a **bitfield**, so the count ceiling is
  the integer width, not memory or perf.
- `nextFreeBit()` returning `0` (`view_registry.js:91`) is a soft cliff:
  the sim then has no bit to assign; the engine path throws loudly
  (codex-correct), but the sim UI needs an explicit "out of bits" failure
  too (verify before shipping any expansion).

**Root cause in one line:** *mask membership is encoded as a bit in a
single fixed-width per-pixel integer, so "how many masks" == "how many
bits in an Int32" == 31, and naming is only an alias onto those bits.*

---

## 3. Proposed design — named, unbounded mask registry

### 3.1 Principles

1. **Names are first-class; bits are an optimization.** The registry maps
   `name → {id, members}` for an *unbounded* number of masks. The 31-bit
   `viewMask` becomes a **hot cache** for the masks that need in-VM
   per-pixel access, not the storage of record.
2. **Resolve names to stable integer ids at model-load (interning).** No
   string lookups on the hot path; ids are dense small ints assignable as
   array indices.
3. **Two membership representations, picked by access pattern:**
   - **Host-side selection** (mixer channel masking) already uses a
     per-pixel `Uint8Array` and needs **no bit at all** — lift it off
     `viewMask` entirely. This alone removes the 31-cap for the
     most common operator use (per-channel "play X on region Y").
   - **In-VM per-pixel** (pattern reads `viewMask & MASK_X`) still needs a
     bit. Keep 31 bits but allocate them from a **declared/working set**
     instead of statically to every mask (§3.3).

### 3.2 The registry (shared substrate)

A model-level `MaskRegistry`, built at `loadModel`, owned in one place and
consumed by mixer, compiler, and (later) Task 1 typed views:

```
MaskRegistry {
  byName: Map<string, MaskId>          // interned at load, stable per model load
  byId:   MaskEntry[]                   // dense, id == array index
}
MaskEntry {
  id:        int                        // dense small int (intern id)
  name:      string                     // human-readable, authored
  kind:      'group' | 'composite' | 'fixtureType' | 'pixelSet'
  members:   Uint8Array(pixelCount)     // per-pixel membership (the truth)
  vmBit:     int | 0                    // 0 = not resident in the 31-bit cache
  source:    'sidecar' | 'derived'      // provenance for drift checks
}
```

- `members` is the canonical membership (~1 byte/pixel/mask; titanic is a
  few thousand pixels ⇒ a few KB per mask, trivial). Optionally pack to a
  bitset (`pixelCount/8` bytes) if mask count grows large.
- `vmBit` is only populated for masks in the in-VM working set (§3.3).
- `byName` interning: at load we assign `id = byId.length++`. Patterns and
  channel configs reference masks **by name at author time**; the
  loader/compiler resolves to `id` (or to `vmBit` for in-VM use). This is
  exactly the `view_mask_constants.js` pattern, generalized.

Back-compat: the existing `viewMasks` array and `groupBits` map become
*derived views* of the registry. `compileViewSelectionMask` switches from
`px.vMask & bit` to `registry.byId[id].members[i]` — same `Uint8Array`
output it already returns, so `commitBlendedLayerWithMask` is unchanged.

### 3.3 Lifting the count limit without blowing the VM budget

Three tiers, by how a mask is consumed:

- **Tier A — host-side only (UNBOUNDED, default).** Channel/mixer view
  selection, CaptainPad region selection, isolation/PFL preview. These
  never enter the VM; they use `members[]`. **No bit consumed.** Removing
  the bit requirement here is the single biggest win and covers the
  operator's "many more masks" ask for live operation.

- **Tier B — in-VM working set (≤ 31 at a time, dynamic).** A pattern that
  literally does `viewMask & MASK_X` needs the bit present in the per-pixel
  `Int32`. Instead of statically burning a bit per mask forever, allocate
  the 31 bits to the **set of masks actually referenced by the currently
  loaded/active patterns** (resolved at compile time from `MASK_*`
  references, which we already scan in `injectMaskConstants`). Build a
  per-load `viewMask` field by OR-ing only the resident masks' members.
  - If the active patterns reference ≤ 31 masks (overwhelmingly the case —
    a pattern references a handful), everything fits. The *catalog* of
    named masks is unbounded; only the *simultaneously-VM-resident* set is
    capped at 31, and that cap is now per-active-pattern-set, not global.
  - `MASK_X` injection resolves to the assigned resident bit. Compile
    fails loudly if a single channel's active patterns reference > 31
    distinct in-VM masks (a real, explainable limit, not a silent one).

- **Tier C — wide in-VM (FUTURE, only if Tier B's 31 ever bites).** Widen
  the per-pixel meta. Options, in cost order:
  1. **Second Int32** (`viewMaskHi`) ⇒ 62 bits. Add `metaView[i*4+...]`
     (grow stride to 5) + a `viewMaskHi` VM global. Touches the WASM ABI
     (`_renderAllWithMeta` signature/struct) — biggest blast radius, needs
     the C++/WASM rebuild. Defer unless required.
  2. **Per-mask membership texture/array indexed by mask-id** read by an
     intrinsic `inView(id)` — the clean long-term answer but a real VM
     feature. Out of scope for a first cut.

  Recommendation: **ship Tiers A+B; do NOT widen the VM word now.** Tier B
  makes the 31-bit limit per-active-set rather than global, which together
  with Tier A almost certainly retires the operator's complaint without an
  ABI change.

### 3.4 Authoring & persistence

- Authoring stays sim-side in the Views panel
  (`view_masks_editor.js`) and `views.yaml`, but the schema generalizes:
  - `groupBits` stays (base groups; still want stable contracts).
  - `custom`/`viewMasks` entries **drop the requirement of a unique
    power-of-two `bit`**. A `bit` becomes *optional* — present only for
    masks pinned into the in-VM cache for back-compat with patterns that
    hardcode a literal (Logsville `0x40/0x80`). Bit-less entries are
    Tier-A/host-only by default and Tier-B-promotable on demand.
  - Membership can be `groups: [...]`, `pixelIndices: [...]`, **or
    `fixtureType: '<type>'`** (Task 1 — see §4).
  - The sim must surface an explicit "in-VM cache full (31)" error if more
    than 31 masks are pinned with bits (the old `nextFreeBit()==0` cliff),
    but creating bit-less named masks is unlimited.
- Sidecar export (`<scene>.viewmasks.js`) gains: optional `bit`, optional
  `fixtureType`, and a stable `id` is assigned at load (not persisted —
  interning is per-load and deterministic from declaration order, same
  discipline as today's first-appearance group bits).

### 3.5 Back-compat

- Existing sidecars with explicit bits keep working: those masks load as
  Tier-B residents with `vmBit = <declared bit>` (reserved first, exactly
  like `reservedMask` today, `engine.js:325`).
- Existing patterns (`viewMask & MASK_X`, fixtureId self-filter) unchanged
  — `MASK_*` injection still resolves, now to the resident bit.
- `compileViewSelectionMask` output type (`Uint8Array | null`) unchanged;
  only its internal source flips from bit-test to `members[]`.
- Titanic's 30 group bits no longer eat the whole budget the moment you
  want composites: groups can be Tier-A host-side unless a pattern needs
  them in-VM.

---

## 4. Cross-task dependency & alignment

### 4.1 Task 1 — model-independent fixture-type metadata ("typed views")

A "typed view" (all pixels of fixture type `par`, `strip`, `window`, …) is
**exactly a named mask whose membership predicate is `fixtureType == T`**.
Design them to share this registry:

- Task 1 registers one `MaskEntry { kind:'fixtureType', name:'@par',
  members: pixels where fixtureType==='par' }` per type, computed at load
  from the model's per-pixel `fixtureType` (the field already flows
  through the exporter — `fixtureType` appears in
  `simulation/src/dmx/pixelblaze_model_exporter.js`, `sacn_mapper.js`,
  `controller_registry.js`).
- Same interning, same `members[]`, same `MASK_*`/id resolution. A pattern
  could do `viewMask & MASK_PAR` (Tier B) or a channel could select
  `viewSelection {type:'viewMask', target:'@par'}` (Tier A) with zero new
  machinery.
- **Action for alignment:** build this registry as the substrate FIRST so
  Task 1 adds entries rather than inventing a parallel typed-view store.
  Reserve a naming convention (e.g. `@type` prefix) so typed views and
  authored masks share one namespace without collision. `fixtureId`
  self-filtering patterns like `27_swipe.js` are the prime customers for
  typed views.

### 4.2 Task 3 — MarsinScript string support

What actually needs strings vs. what does not:

- **Does NOT need language strings (do now):**
  - Author-time references in **pattern source** (`MASK_REDWOOD_PARS`) —
    already compile-time identifiers resolved to int literals by injection
    (`view_mask_constants.js`). Named masks ride this unchanged.
  - **Channel/mixer `viewSelection.target`** — that string lives in JS/JSON
    config (CaptainPad → engine), resolved host-side in `pattern_mixer.js`.
    Host JS already has strings.
  - Registry interning name→id is host-side JS.
- **WOULD benefit from strings (optional, later):** a MarsinScript
  intrinsic like `inView("Bow")` or `viewBit("Bow")` *inside* a pattern,
  letting authors name a mask in code without the `MASK_` identifier
  convention. This is sugar; the `MASK_*`-identifier route already gives
  named-mask authoring **without** strings.
- **If strings aren't ready:** proceed fully. Named masks work end-to-end
  via (a) compile-time `MASK_*` identifier injection for in-VM use and
  (b) host-side string targets for channel selection. Strings only add the
  in-pattern `inView("name")` ergonomic later. (Note: the codex "no
  fallback" rule means a string intrinsic, once added, must hard-error on
  an unknown name, not return 0 — mirror `injectMaskConstants`'s loud
  unknown-name error and tighten the mixer's current `→0` resolve, §6.)

### 4.3 Recommended implementation order

1. **This task — MaskRegistry + id interning + Tier A lift** (move
   mixer/host selection off `viewMask` onto `members[]`; make named masks
   unbounded for host-side selection). Self-contained, biggest payoff, no
   ABI/language change.
2. **Tier B dynamic bit allocation** (resident working set from referenced
   `MASK_*`), so in-VM patterns also escape the global 31-cap. Same task or
   immediate follow-up.
3. **Task 1 typed views** as registry entries (depends on 1; trivial once
   the substrate exists).
4. **Task 3 strings** — independent; only needed for the optional
   `inView("name")` intrinsic. Can run in parallel; not a blocker.
5. **Tier C VM-word widening** — only if a single channel genuinely needs
   > 31 in-VM masks at once. Defer.

---

## 5. Files that would change (estimate) & risks

**Engine:**
- `marsin_engine/engine.js` `loadModel` — build `MaskRegistry`, intern
  ids, compute `members[]`, dynamic Tier-B bit allocation, keep strict
  drift/dup/collision throws. (Largest change.)
- `marsin_engine/lib/pattern_mixer.js` `compileViewSelectionMask` —
  resolve `target` to a registry id, read `members[]` instead of
  `px.vMask & bit`. Tighten unknown-name to a loud error (§6).
- `marsin_engine/lib/view_mask_constants.js` — feed `MASK_*` from registry;
  resolve only resident (Tier-B) masks to bits, loud error if a referenced
  in-VM mask can't be made resident.
- `marsin_engine/lib/wasm_host.js` — wire registry into the compile choke
  point.
- `marsin_engine/lib/api_server.js` — `/model/view-selection-options`
  returns the full named-mask catalog + per-mask kind/resident flag.
- `marsin_engine/lib/marsin_wasm_runtime.js` — **only if Tier C** (struct
  stride / second viewMask word). Avoid in v1.

**Sim:**
- `simulation/src/dmx/view_registry.js` — optional `bit`, `fixtureType`
  membership, explicit "in-VM cache full" error, keep power-of-two checks
  only for pinned bits.
- `simulation/src/gui/view_masks_editor.js` — author bit-less named masks;
  show kind (host/in-VM/typed); typed-view chips (with Task 1).
- `simulation/src/dmx/pixelblaze_model_exporter.js` — emit generalized
  sidecar (optional bit, fixtureType).

**Tests:** `tests/view_mask_constants.test.js`,
`tests/pattern_mixer_masking.test.js`,
`tests/hil/hil_view_selection_test.mjs` — extend for unbounded host masks,
dynamic bit allocation, typed views.

**Risks:**
- **Pattern back-compat:** patterns hardcoding literal bits (Logsville
  `0x40/0x80`) must stay resident with their pinned bit — Tier-B reservation
  must honor explicit bits first (mirror today's `reservedMask`).
- **Hot-reload drift:** registry must rebuild and re-validate on sidecar
  edit (engine.js:1142-1207 path) without renumbering ids under live
  channels. Re-derive deterministically from declaration order.
- **Perf:** Tier A adds per-mask `Uint8Array` (KB-scale) — negligible.
  Building `members[]` is O(pixels × activeMasks) at load, not per-frame.
  The 40 Hz hot path is unchanged (still a `Uint8Array` mask copy).
- **Two sources of truth for membership** (`members[]` vs `viewMask` cache)
  must be derived from one place at load to avoid divergence — make
  `viewMask` strictly `OR of resident masks' members`, never hand-set.
- **Codex P0 (no fallbacks):** the mixer's current "unknown name → 0,
  warn" (`pattern_mixer.js:51-55`) is a soft fallback; the expansion
  should make unknown-name a hard error consistent with
  `injectMaskConstants`. Confirm with Sina (it changes current lenient
  behavior).

---

## 6. Open questions for Sina

1. **Hard-fail unknown mask name in the mixer?** Today it warns and
   resolves to 0 (`pattern_mixer.js:51-55`) — a soft fallback that smells
   wrong under codex P0. OK to make it throw like the compile path?
2. **Namespace for typed views (Task 1):** reserve a prefix (`@par`,
   `type:par`, …) so authored masks and fixture-type masks never collide?
   Your call on the spelling.
3. **Is any pattern expected to read > 31 distinct masks in a single
   channel's active set?** If never, we can skip Tier C (VM-word widening)
   entirely and avoid the WASM ABI change. (I believe the answer is no.)
4. **Persisted ids vs. deterministic re-derivation:** keep interning
   purely load-time/deterministic (like today's group bits), or persist a
   stable `id` per mask in `views.yaml` for cross-session stability? I lean
   deterministic to avoid a new staleness class.
5. **Sequencing vs. Task 1/3:** confirm the order in §4.3 — land the shared
   registry here first, Task 1 builds typed views on it, Task 3 (strings)
   runs in parallel and only adds the optional `inView("name")` intrinsic.
6. **Do you want bit-less (host-only) masks creatable in the Views panel
   now**, or keep every authored mask bit-backed until Tier B lands?
   (Bit-less-first unlocks "many more masks" for live operation immediately.)
