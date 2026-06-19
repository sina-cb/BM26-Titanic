# Titanic model audit — patching, fixtures, views, and view-generation

**Date:** 2026-06-19
**Author:** investigator/audit agent (requested by Sina)
**Branch:** `dev/claude/views_rehaul`
**Scope:** INVESTIGATION ONLY — read-only. No source changed, no git ops,
nothing implemented. Audits the titanic model across `marsin_engine/` +
`simulation/`, compared against `test_bench` as the "complete model"
reference, and proposes view-generation improvements.

---

## TL;DR

- **Patching: 0% patched.** All **970** titanic pixels are unpatched
  (`patch: null`, `cId/sId/fId = 0`, `vMask = 0`). `controllers.yaml` is
  **empty** (`controllers: []`). The rig cannot output a single DMX or
  sACN frame today. Compare test_bench, where every pixel carries a real
  `patch:{universe,addr,footprint}` and non-zero `cId/sId/fId`.
- **Fixtures: 490 DMX + 480 LED = 970 px** across **86 fixtures**
  (70 DMX fixtures + 16 LED strands) in **28 groups** (12 DMX, 16 LED).
  Fixture types: `ShehdsBar 360`, `VintageLed 96`, `UkingPar 34`,
  `'' (RawLed/strand) 480`. Naming is clean and symmetric (Left/Right,
  Front/Back, Small_*). No fog/haze/horn/fire fixtures exist → the empty
  `titanic.effects.js` is CORRECT, not a gap.
- **Views: 28 group bits of a 31-bit ceiling are spent — only 3 free
  bits left** (`0x10000000`, `0x20000000`, `0x40000000`). `viewMasks`
  (composite presets) is **empty**. At load the engine adds `LEFT` and
  `RIGHT` as Tier-A host masks (zero bit cost) via `strand_views.js`;
  the 16 per-strand views are skipped because each strand group already
  owns a base-group bit. So today titanic has **28 group views + LEFT +
  RIGHT** and nothing else.
- **View generation TODAY** is essentially "one bit per pixel-group,
  auto-assigned" + the two LED-parity composites. There is **no spatial,
  per-fixture-type, per-deck, or symmetric-pairing auto-view generation**.
  The MaskRegistry (unbounded, bit-free, report `20260618_2`) is built and
  surfaced but on titanic only carries the 28 groups + LEFT/RIGHT.
- **The single blocking deliverability gap is patching** (controllers +
  bindings). Everything else (geometry, groups, types, cameras, views) is
  present and well-formed; the rig is "modeled but not wired."

---

## 1. PATCHING completeness — the blocking gap

### 1.1 Pixels: 0 patched / 970 unpatched

Measured directly from `marsin_engine/models/titanic.js`
(`pixelCount = 970`):

| metric | value |
|---|---:|
| total pixels | 970 |
| `patch` non-null (DMX or LED) | **0** |
| pixels with a `channels` map | 490 (all DMX) |
| distinct `cId` | `{0}` |
| distinct `sId` | `{0}` |
| distinct `fId` | `{0}` |
| pixels with `vMask != 0` | **0** |

Every pixel looks like
`titanic.js:13` — `{ i:0, type:'dmx', fixtureType:'ShehdsBar', …, cId:0,
sId:0, fId:0, vMask:0, patch:null, channels:{…} }`. Contrast
`test_bench.js:13` — `{ …, cId:1, sId:1, fId:1, vMask:0,
patch:{universe:2, addr:1, footprint:10}, … }`.

The DMX pixels carry a `channels` map (RGBWAU lane offsets) but **no
`patch`**, so there is no universe/address to emit to. The 480 LED pixels
carry neither `patch` nor `channels` (`unpatched:true` path, report
`20260618_10` §1).

### 1.2 Controllers: none exist

- `simulation/scenes/titanic/controllers.yaml` is 3 lines:
  `nextControllerId: 1`, `nextUniverse: 2`, **`controllers: []`**.
- `simulation/scenes/titanic/patches.yaml` has **70** fixture entries
  (the DMX fixtures only — the 16 LED strands are not in patches.yaml).
  **Every** entry is zeroed: `controllerIp: ''`, `dmxUniverse: 0`,
  `dmxAddress: 0`, `controllerId: 0`, `sectionId: 0`, `fixtureId: 0`,
  `viewMask: 0` (`patches.yaml:2-9` and uniformly throughout; a grep for
  any non-zero `controllerId|viewMask|dmxUniverse|controllerIp` returns
  nothing).
- LED strands in `scene_config.yaml` (`:1504-1718`) each carry
  `controllerId: 0, sectionId: 0, viewMask: 0` — also fully unbound
  (`:1515-1518`).

Reference: `test_bench/controllers.yaml` defines controller `id:1` with 4
ports, real IPs, and `chain` bindings mapping fixtures → DMX addresses
(`:3-40`).

### 1.3 What's missing for the rig to output / visualize

1. **At least one DMX controller** in `controllers.yaml` with ports +
   `chain` entries binding all 70 DMX fixtures to universes/addresses.
   490 DMX pixels stay dark on hardware until this exists.
2. **At least one LED-type controller** (`type: LED`, the parity feature
   from report `20260618_10` §1) binding the 16 strands; until then the
   engine prints the LOUD `✋ 480 LED-strand pixel(s) across 16 strand(s)
   are UNPATCHED` warning (`engine.js:474-478`) and emits zero sACN for
   them.
3. **Re-export** so `patch`, `cId/sId/fId`, and LED `channels` are
   stamped into `titanic.js`. The machinery to do all this already exists
   (Controller Mapping panel, DMX + LED projection); it has simply never
   been run for titanic. Report `20260618_10` §3.5 explicitly notes "Did
   NOT add an LED controller to titanic's committed scene" — real
   IPs/topology are operator config.

**This is the one P0 deliverability blocker.** The mission-critical goal
("Titanic exterior highly visible at night") cannot be met by a model
that emits no DMX/sACN.

---

## 2. FIXTURE TYPES + groups

### 2.1 fixtureType distribution (per pixel)

| fixtureType | pixels | FIX_* id (lib/fixture_type_constants.js) |
|---|---:|---:|
| `ShehdsBar` | 360 | `FIX_BAR_18` = 4 |
| `VintageLed` | 96 | `FIX_VINTAGE_6` = 3 |
| `UkingPar` | 34 | `FIX_PAR` = 2 |
| `''` (RawLed strand) | 480 | `FIX_RAW_LED` = 1 |
| **total** | **970** | |

All four present types map to canonical FIX_* ids, so Tier-A/Tier-B
fixture-type targeting (`FIX_BAR_18`, `FIX_PAR`, …) works on titanic today
(report `20260618_10` §"Tier-A status of titanic"). No `ChauvetHaze4D`,
`TEFogMachine`, horn, or fire fixtures exist (grep over `scene_config.yaml`
for `horn|fire|fog|haze` → 0 hits), so the empty `titanic.effects.js`
(`specialEffects: []`) is correct.

### 2.2 Groups: 28 total, symmetric, complete

12 DMX groups + 16 LED-strand groups:

- **DMX (12):** `{Left,Right} {Front,Back} Wall {Generator}`,
  `{Left,Right} Top Chimney Generator`, `{Left,Right} {Front,Back} Deck
  Generator`, `{Left,Right} Center Auditorium {Generator}`.
- **LED strands (16):** `{Left,Right}_{Front,Back}_{Left,Right}` (8 ×40px)
  + `Small_{Left,Right}_{1..4}` (8 ×20px). 8×40 + 8×20 = 480.

Counts per group range 7 (Center Auditorium) to 90 (Wall Generators).
Naming is **consistent and L/R-symmetric**, which is exactly what
auto-view generation wants (see §5). One cosmetic asymmetry: some DMX
groups carry a trailing "Generator"/"Wall" suffix on only one side
(`Left Back Wall` vs `Right Back Wall Generator`, `Left Center
Auditorium` vs `Right Center Auditorium Generator`) — harmless for bits,
but it means a naive "strip side prefix to pair L/R" heuristic would not
match those two pairs. Worth normalizing if symmetric pairing is
auto-generated.

---

## 3. VIEWS — what exists and how they're generated

### 3.1 What views exist today

- **`views.yaml`** (`scenes/titanic/views.yaml`): `groupBits` with **28**
  entries (bits `0x1 … 0x8000000`), `custom: []` (no composites).
- **`titanic.viewmasks.js`** (the engine sidecar): same 28 `groupBits`,
  `viewMasks: []` (empty — `:40-41`).
- **Auto-registered at engine load** (`engine.js:439-459` via
  `lib/strand_views.js`): for titanic this yields **`LEFT` + `RIGHT`**
  only. The 16 per-strand views are **skipped** because each strand group
  (`Left_Front_Left`, `Small_Right_1`, …) already owns a base-group bit,
  so the base group provides that view (report `20260618_10` §3.3,
  `strand_views.js:85-89`). LEFT/RIGHT are Tier-A host masks
  (`bit:0`, pixelIndices) — zero viewMask-bit cost.

**Net selectable views on titanic: 28 group views + LEFT + RIGHT = 30.**
All surface through `/model/view-selection-options` — the 28 groups +
LEFT/RIGHT appear in `namedViews` from the MaskRegistry
(`api_server.js:2497-2507`); the bit-backed subset also appears in
`viewMasks` (`:2481-2488`).

### 3.2 Bit-budget situation (the wall)

The view mask is one bit in a per-pixel signed Int32, so **31 masks
max** (bits 0..30; bit 31 unsafe across the JS↔WASM coercion — report
`20260618_2` §2.1). Measured for titanic:

| | |
|---|---:|
| group bits used | **28** |
| highest bit | `0x8000000` |
| used mask | `0x0FFFFFFF` |
| **free bits remaining (of 31)** | **3** (`0x10000000`, `0x20000000`, `0x40000000`) |

So titanic can add **at most 3 more bit-backed (in-VM) masks** before
`reconcileGroupBits`/`addCustomView` throw `[Views] Out of view-mask
bits` (`view_registry.js:132-134`, `:229-231`). Any further views must be
**Tier-A host-only** (bit-free MaskRegistry entries), which is unbounded
but only usable for host-side/mixer/CaptainPad region selection — NOT for
in-pattern `viewMask & MASK_X` reads.

### 3.3 The view-generation code path (where views come from)

1. **Sim authoring / source of truth — `simulation/src/dmx/view_registry.js`.**
   - `listPixelGroups(pixels)` (`:107-113`) — distinct non-empty pixel
     groups, first-appearance order.
   - `reconcileGroupBits(registry, groups)` (`:122-144`) — the actual
     "auto-view generator": assigns the lowest free power-of-two bit to
     each new group via `nextFreeBit` (`:91-97`), keeps existing
     assignments stable, drops departed groups. **This is automatic but
     1:1 with pixel groups** — there is no notion of composite, spatial,
     or typed views here.
   - `addCustomView` (`:224-235`) — operator-driven single custom view,
     lowest free bit, throws on exhaustion. Manual, one at a time.
   - `buildViewmasksSidecarJS` (`:277-325`) — renders the
     `<scene>.viewmasks.js` sidecar from the registry.
2. **Sim UI — `simulation/src/gui/view_masks_editor.js`** (652 lines):
   the Views panel (create/rename/delete custom views, group chips,
   assign selected fixtures). Also manual.
3. **Sim UI — `gui_builder.js` "📐 Group Generator"** (`:2172-2177`): this
   is the *trace/PAR group geometry generator* (placing fixtures along
   traces), NOT a view generator — easy to confuse by name. It produces
   fixture **groups**, which then become views 1:1 via `reconcileGroupBits`.
4. **Engine load — `marsin_engine/engine.js loadModel`** (`:430-509`):
   validates the sidecar `groupBits` against the model, OR-merges presets
   into pixel `vMask`, then **derives strand views**
   (`deriveStrandViews`, `:451`) and **builds fixture-type ids**
   (`buildFixtureTypeIds`, `:492`). The MaskRegistry itself is built in
   the mixer (`mixer.maskRegistry`, surfaced at `api_server.js:2497`) via
   `lib/mask_registry.js buildMaskRegistry` (groups + presets →
   per-pixel `members[]`).
5. **`lib/strand_views.js deriveStrandViews`** (`:43-108`): the only
   piece that *generates* views beyond 1:1 groups — per-strand (skipped
   when a base group owns the name) + LEFT/RIGHT from the
   `Left_/Right_/Small_*` group-name prefix, with an x-sign fallback that
   logs loudly.

**So the entire "auto" view set on titanic = `reconcileGroupBits`
(groups→bits, 1:1) + `deriveStrandViews` (LEFT/RIGHT).** No spatial,
deck-band, type, or fore/aft generation exists.

### 3.4 Gaps / overlaps

- **No overlaps** — every group bit is distinct; LEFT∩RIGHT = ∅ was
  proven in the parity harness (report `20260618_10` §2c).
- **Gaps:** no composite presets at all (`viewMasks: []`), so the
  operator cannot select "all Wall Generators", "all decks", "all PARs",
  "bow", "stern", "port", "starboard", "smokestacks", "everything that
  faces the road", etc. without picking groups one by one. The LED-side
  LEFT/RIGHT exist but there is **no DMX-side / whole-ship LEFT/RIGHT,
  FORE/AFT, or per-deck composite** — a clear asymmetry (LED strands got
  parity views, DMX fixtures did not get analogous composites).

---

## 4. Anything else MISSING for a deployable titanic model

| Item | Status | Evidence |
|---|---|---|
| **DMX patch (universes/addresses)** | **MISSING (blocking)** | §1; `controllers.yaml: []`, all `patch:null` |
| **LED-strand patch** | **MISSING (blocking)** | §1; 480 px `unpatched`, no LED controller |
| **`cId/sId/fId` assignment** | MISSING (consequence of unpatched) | all 0 in `titanic.js` / `patches.yaml` |
| Geometry / world positions | **present & complete** | bbox x[-49.4,45.4] y[-0.1,14.9] z[-26.5,16.2]; nx/ny/nz on every px |
| Normals (nx/ny/nz) | present | every pixel |
| Groups | present, symmetric, complete | §2.2 (28 groups) |
| Fixture types | present, all map to FIX_* | §2.1 |
| RGBW / white config (DMX) | present (channels incl. `w`) | `channels:{…,"w":…}` on DMX px |
| LED white (RGBW order/whiteMode) | **MISSING** (set by the LED controller, which doesn't exist) | LED px have no `channels`/`whiteMode` until bound (report `20260618_10` §1) |
| Cameras | **present** (7 presets) | `cameras.yaml` Front/Side/Aerial/Dramatic/Night Walk/Top Right/Top Left (test_bench has 5) |
| Effects (fog/haze/horn/fire) | N/A — none designed | empty `effects.js` is correct |
| Composite/spatial/typed views | **MISSING** (opportunity, not a blocker) | §3.4 |
| Orphan/unbound fixtures | all 86 fixtures unbound | §1 |
| Symmetry issues | minor naming asymmetry only | §2.2 ("Generator" suffix on one side of 2 pairs) |

Net: the model is **geometrically and structurally complete and
well-formed**; the only hard blocker is that **nothing is patched** —
no controllers, so no DMX/sACN output. Cameras are richer than the
reference. The chief *enhancement* opportunity is view generation (§5).

---

## 5. SUGGESTIONS — better / more automatic view generation for titanic

Goal: turn the rich, symmetric group + type + spatial metadata that
**already exists** on every pixel into a far larger, operator-useful view
catalog — without blowing the 3-bit in-VM budget. The substrate to do
this (the unbounded, bit-free **MaskRegistry**, report `20260618_2` §3) is
**already built and surfaced** (`mask_registry.js`, `api_server.js:2497`);
today it only carries 1:1 groups + LEFT/RIGHT. The suggestions below add
*derived* `MaskEntry`s (Tier-A, `bit:0`) at load, mirroring exactly how
`deriveStrandViews` already injects LEFT/RIGHT.

**Bit-budget discipline (applies to all of the below):** generate these as
**Tier-A host-only masks** (`bit:0`, members-array) so they cost zero of
the 3 remaining in-VM bits. Reserve the 3 free bits only for views a
*pattern* must read via `viewMask & MASK_X`. Live operation (mixer /
CaptainPad region selection / isolation) reads `members[]` and needs no
bit — this is the single biggest lever and it already works end-to-end.

### 5.1 Generalize `deriveStrandViews` → `deriveAutoViews` (whole-ship)

Today LEFT/RIGHT are LED-strand-only and skip DMX fixtures
(`strand_views.js:22-24`, `isStrandPixel`). Drop the `type==='led'`
restriction (or add a parallel pass over all pixels) so the **whole ship**
gets:

- **PORT / STARBOARD** (= LEFT / RIGHT over *all* 970 px, DMX + LED), from
  the `Left_/Right_` / `Left /Right ` group-name prefix already parsed by
  `sideFromGroupName` (`:27-32`). This is the obvious missing DMX-side
  counterpart to the existing LED LEFT/RIGHT.
- **FORE / AFT (bow/stern)** from the `Front`/`Back` token already in every
  group name (`… Front Wall …`, `*_Back_*`). Same prefix-token approach,
  zero new metadata.
- **DECK bands** from the deck/wall/chimney/auditorium token in the group
  name (`Wall`, `Deck`, `Top Chimney`, `Center Auditorium`) → views like
  `WALLS`, `DECKS`, `CHIMNEYS`, `AUDITORIUM`.

All derivable purely from the **existing group names** — no model change,
no exporter change. New code: one generalization of the existing strand
file. This directly fills the §3.4 gap.

### 5.2 Per-fixture-type views (ride the FIX_* metadata)

`buildFixtureTypeIds` already runs at load (`engine.js:492`) and every
pixel carries `fixtureType`. Register one Tier-A `MaskEntry { kind:
'fixtureType', name:'@BAR'|'@PAR'|'@VINTAGE'|'@RAW' }` per present type
(membership = pixels of that type). This is exactly the "typed view"
design in report `20260618_2` §4.1 — the registry was built to host it,
nothing does yet. Lets the operator instantly select "all 360 bar pixels"
or "all 34 PARs" for a wash, with zero bit cost. Reserve a `@` prefix so
typed views never collide with authored names.

### 5.3 Spatial / Z-band views from world coords (x/y/z already present)

Every pixel has world `x,y,z` (bbox in §4) AND normalized `nx,ny,nz`. Use
them to auto-derive bands the group names don't capture:

- **Height bands** (`ny` quantized): `LOW_HULL` / `MID` / `UPPER_DECK` /
  `MASTS` — useful for "light the waterline" vs "light the masts".
- **Fore/aft by `z`** and **port/starboard by `x` sign** as a *spatial
  cross-check* against the name-prefix views (§5.1) — and to catch the two
  groups whose suffix breaks the naive pairing (§2.2). The x-sign fallback
  already exists in `deriveStrandViews` (`:67-74`); promote it to a
  first-class spatial generator rather than a logged last resort.

These are the genuinely *new* capability (name-only views can't express
"bottom third of the ship"). Quantization thresholds become 3-4 constants.

### 5.4 Symmetric L/R pairing as composite views

Because the rig is L/R-symmetric (§2.2), auto-generate **paired** views:
for each base name that appears with both `Left` and `Right` (e.g.
`* Front Wall Generator`, `*_Front_Left`), emit a `<base>_BOTH` composite
(union of the two side groups). First normalize the trailing-"Generator"
asymmetry (§2.2) so `Left Back Wall` pairs with `Right Back Wall
Generator`. Gives "both front walls", "both forward strands", etc. — all
Tier-A.

### 5.5 Per-controller views (once patched — ties to §1)

After §1 patching lands, `cId` becomes meaningful. Auto-register one
Tier-A view per controller (`members` = pixels with that `cId`) so the
operator can isolate "everything on the bow controller" for strike/debug.
Zero bit cost; depends on patching existing first.

### 5.6 Combine the axes (the richest set)

The real payoff is the **cross-product**: `side × fore/aft × type × band`.
e.g. `PORT_FORE_BARS`, `STARBOARD_MASTS`, `UPPER_PARS`. Because Tier-A
masks are unbounded (`mask_registry.js` interns any number, `members[]`
is the truth — report `20260618_2` §3.3 "Tier A — UNBOUNDED"), titanic can
carry **hundreds** of these with no bit pressure; only the handful a
pattern reads in-VM need one of the 3 free bits. Implement as a small
declarative table of axis→predicate (group-token / fixtureType / coord
band) feeding `buildMaskRegistry`-style `members[]` computation at load.

### Tie to what exists vs. what's new

| Suggestion | Reuses | New work |
|---|---|---|
| 5.1 PORT/STARBOARD/FORE/AFT/DECK | `strand_views.js` prefix parse, MaskRegistry | drop `type==='led'` gate; add token→view rules |
| 5.2 typed views (`@BAR`…) | `buildFixtureTypeIds`, MaskRegistry, report `_2` §4.1 design | register type entries (designed, never built) |
| 5.3 spatial Z/x/y bands | per-pixel `x,y,z,nx,ny,nz` (present) | quantize-into-members generator |
| 5.4 L/R `_BOTH` composites | symmetric group naming | pairing rule + suffix normalization |
| 5.5 per-controller views | `cId` field | needs §1 patching first |
| 5.6 cross-product | unbounded Tier-A registry | declarative axis table |

None of 5.1-5.4/5.6 require an exporter, WASM, or ABI change — they are
load-time derivations over metadata the model already carries, emitted as
bit-free `MaskEntry`s exactly like the shipped LEFT/RIGHT. They should be
generated **in the engine at load** (so they can't go stale vs. the
pixels) and surfaced through the existing `namedViews` array
(`api_server.js:2498-2507`) that CaptainPad already consumes.

---

## 6. Prioritized missing-items list

**P0 (blocks deployment — rig emits nothing):**
1. Add a DMX controller + bind all 70 DMX fixtures (`controllers.yaml`),
   re-export so `patch`/`cId`/`sId`/`fId` are stamped (§1).
2. Add an LED-type controller + bind all 16 strands (clears the 480-px
   `unpatched` warning, gives LED `channels`/`whiteMode`) (§1, §4).

**P1 (operator usefulness — present machinery, unused):**
3. Generate whole-ship composite views (PORT/STARBOARD/FORE/AFT/DECKS,
   typed `@BAR/@PAR/…`) as Tier-A masks — §5.1, §5.2. Big UX win, zero bit
   cost, mostly reuses shipped code.

**P2 (polish):**
4. Normalize the trailing-"Generator"/"Wall" naming asymmetry on the two
   mismatched L/R pairs (§2.2) for robust pairing.
5. Spatial Z/x/y band views (§5.3) and per-controller views (§5.5, after P0).

**Non-issues (verified, do NOT "fix"):**
- Empty `titanic.effects.js` — correct (no effects fixtures designed).
- 28/31 group bits — by design; expand via Tier-A, not more bits.

---

## 7. Evidence index (file:line)

- `marsin_engine/models/titanic.js:10` pixelCount 970; `:13` unpatched
  pixel shape (`patch:null, cId/sId/fId:0`).
- `marsin_engine/models/test_bench.js:13` reference patched pixel.
- `marsin_engine/models/titanic.viewmasks.js:9-38` 28 groupBits; `:40-41`
  empty viewMasks.
- `marsin_engine/models/titanic.effects.js:4-5` empty specialEffects.
- `simulation/scenes/titanic/controllers.yaml:3` `controllers: []`.
- `simulation/scenes/titanic/patches.yaml:1-9` zeroed patch entries (×70).
- `simulation/scenes/titanic/views.yaml:2-31` 28 groupBits, `custom: []`.
- `simulation/scenes/titanic/cameras.yaml` 7 presets.
- `simulation/scenes/titanic/scene_config.yaml:1496-1718` LED strands,
  all `controllerId/sectionId/viewMask:0`.
- `simulation/src/dmx/view_registry.js:91-144` nextFreeBit /
  reconcileGroupBits (the group→bit auto-generator); `:224-235`
  addCustomView; `:277-325` sidecar export.
- `simulation/src/gui/view_masks_editor.js` Views panel (manual).
- `simulation/src/gui/gui_builder.js:2172-2177` "Group Generator" (trace
  geometry, NOT views).
- `marsin_engine/engine.js:439-459` strand-view derivation; `:461-479`
  loud unpatched warning; `:481-497` fixture-type ids.
- `marsin_engine/lib/strand_views.js:22-108` deriveStrandViews
  (the only >1:1 view generator).
- `marsin_engine/lib/mask_registry.js:88-138` buildMaskRegistry
  (unbounded Tier-A substrate).
- `marsin_engine/lib/api_server.js:2458-2524` /model/view-selection-options
  (groups, viewMasks, namedViews surfacing).
