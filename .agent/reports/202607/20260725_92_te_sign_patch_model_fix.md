# 20260725_92 — TE sign: four patch defects closed + the sign model rebuilt from CAD

**Author:** developer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-31
**Operator order (urgent, "immediately now"):** make the titanic scene FULLY
PATCHED by fixing four reported defects, and rebuild the TE sign pixel model
from fresh CAD exports. Titanic-scene writes authorized by that order and
scoped to these fixes.

Per `security_privacy.md` every real controller address here is redacted as
`10.x.x.NN`; `0.0.0.0` is the repo's own placeholder **sentinel**, not an
address. **Zero device HTTP pushes, zero sACN output enables, zero flashes.**

---

## 0. TL;DR

| | |
|---|---|
| **Defects** | 4 reported, **4 confirmed from the repo, 4 fixed** |
| **Parity gate** | `scene_model_parity titanic`: **21 errors → 0. RESULT PASS** |
| **Sim suite** | 1482 tests, fail **10 → 8**. **Zero new failures**; the 2 titanic scene-drift pins legitimately went green |
| **Engine suite** | 2391 tests, 8 fail — the documented environmental set (audio device, `osc_listener` EACCES, …), unchanged |
| **Model rebuild** | new generator `simulation/tools/gen_te_sign_fixture.js` → both fixture YAMLs regenerated from the CAD CSVs in `wire_order` |
| **Normalization** | ONE shared factor `1/2165.1 mm` over side A ∪ side B (never per-side) |
| **Re-export** | done through the sim's own save path (browser + `window.exportConfig`), **no interactive operator step left** |
| **Operator steps left** | 2, both hardware-truth items (§7) — neither blocks the sim |

---

## 1. Defect 1 — both TE signs (148 px) were UNPATCHED

**Verified.** `simulation/scenes/titanic/patches.yaml:2-17` (as committed) held
the only two sign records, both zeroed:

```yaml
  TE Sign V3 A:
    controllerIp: ''
    dmxUniverse: 0
    dmxAddress: 0
```

and every one of the 148 sign pixels in `marsin_engine/models/titanic.js`
carried `patch: null, cId: 0` — `titanic.js:15` (`TE Sign V3 A - pixel_1`,
group `TE Sign`) through `titanic.js:162` (group `TE Sign 2`). The parity gate
named it four times: `address_hygiene/unmapped_fixture` for both halves of both
signs — "not chained on any controller in controllers.yaml".

**Root cause:** no controller in `scenes/titanic/controllers.yaml` carried the
signs at all. The signs were the last unmapped family in the mapping campaign;
plan `20260725_33` §O5 already prescribed the remedy — *"TE sign wiring (still
being assembled; footprint known: A=120ch + B=102ch = 222ch, fits one universe)
→ patch to a placeholder DMX controller (own universe)"*.

**Fix** — `simulation/scenes/titanic/controllers.yaml:422-439`, one new
controller appended (so no existing panel ordinal moves):

```yaml
  - id: 23
    name: TeSigns-PLACEHOLDER
    ip: 0.0.0.0
    type: DMX
    protocol: sACN
    ports:
      - port: 1          # universe 38 — sign 1
        chain: [TE Sign V3 A @1, TE Sign V3 B @121]
      - port: 2          # universe 39 — sign 2
        chain: [TE Sign 2 V3 A @1, TE Sign 2 V3 B @121]
```

- **One controller, two ports** — the placeholder convention is `ip: 0.0.0.0`
  **plus** a `PLACEHOLDER` marker in the name, and two controllers on the same
  sentinel IP would trip `controller_duplicate_ip`. One universe per sign is
  the honest reservation: 120 + 102 = 222 ch fits inside 512 with room to spare.
- Universes **38 / 39** were free (DMX holds 2–27, LED ropes 30–37).
- `nextControllerId` 23 → 24.
- `scenes/common.yaml:192` — the `📡 Subscribed Universes` field gained
  `38, 39`. Without it the sACN-IN bridge silently drops those packets and the
  signs stay dark with every surface green (report `_58` §7.1 layer 6). This is
  the field's own save-time gate; the change is ADD-only, per that module's
  "never remove" rule.

**Proof** — `patches.yaml` after the re-export:

```yaml
  TE Sign V3 A:    { controllerIp: 0.0.0.0, dmxUniverse: 38, dmxAddress: 1,   controllerId: 17 }
  TE Sign V3 B:    { controllerIp: 0.0.0.0, dmxUniverse: 38, dmxAddress: 121, controllerId: 17 }
  TE Sign 2 V3 A:  { controllerIp: 0.0.0.0, dmxUniverse: 39, dmxAddress: 1,   controllerId: 17 }
  TE Sign 2 V3 B:  { controllerIp: 0.0.0.0, dmxUniverse: 39, dmxAddress: 121, controllerId: 17 }
```

and all 148 model pixels now carry a real patch (`U38:1+120`, `U38:121+102`,
`U39:1+120`, `U39:121+102`). Gate: **0 `unmapped_fixture`.**

---

## 2. Defect 2 — the A/B module names were DUPLICATED across the two signs

**Verified.** `scene_config.yaml` carried FOUR fixtures but only TWO distinct
names: `TE Sign V3 A` / `TE Sign V3 B` appeared under group `TE Sign` (lines
83-85, 107-109) **and again** under group `TE Sign 2` (lines 131-133, 155-157).
The parity gate: `coverage/duplicate_scene_name` ×2 — *"fixture names are the
join key for patches.yaml, the chains in controllers.yaml and every model
pixel, so a duplicate makes the mapping ambiguous."*

The 2D pixel map had already been forced to paper over it: `pixel_map_layout.js:123`
mints a `~N` suffix for a duplicate `fixKey`, and
`scenes/titanic/pixel_map_views.yaml` was storing per-fixture offsets under the
invented keys `TE Sign V3 A~2` / `TE Sign V3 B~2`.

**Fix** — the second sign's halves renamed to `TE Sign 2 V3 A` / `TE Sign 2 V3 B`
(`scene_config.yaml:132`, `:156`), matching their group. The `~2` offset keys in
`pixel_map_views.yaml:335-340` were rewritten to the real names, so the dedupe
path is no longer exercised at all.

**Proof:** gate reports 0 `duplicate_scene_name`; the 2D `te_sign` view resolves
`sign_1 'TE Sign' 2 clusters / 74px` and `sign_2 'TE Sign 2' 2 clusters / 74px`
(§6), and the layout logs no duplicate-key warning.

---

## 3. Defect 3 — both signs shared sectionId 3 and COLLIDED on fixture ids

**Verified.** All four sign fixtures carried `sId: 3` and only two fixture ids
between them: `fId: 13` (both A halves) and `fId: 14` (both B halves) —
`titanic.js:15` vs `titanic.js:89`, and `titanic.js:55` vs `titanic.js:146`.
Gate: `metadata/section_id_spans_groups` (sectionId 3 shared by groups
`TE Sign` + `TE Sign 2`) and `metadata/fixture_id_collision` ×2 (fixtureId 13
carried by 41 distinct entries, 14 by 35).

**Root cause — defect 2.** `controller_registry.js:2083` builds
`configsByName`, a Map **keyed by fixture name**. With both signs using the same
two names the second sign's config never entered the map, so it never got its
own metadata; both signs then read the same two `patches.yaml` records back at
load. Defect 3 was a *symptom* of defect 2, not an independent bug — which is
why fixing the names fixes the ids with no id-space surgery.

**Fix:** none beyond the rename. The projection's own numbering
(`controller_registry.js:2185-2205` — sectionId per GROUP, fixtureId monotonic,
floored over the DMX ∪ LED union) minted the second sign fresh ids on the next
boot.

**Proof** (from the regenerated model):

| group | fixture | sId | fId |
|---|---|---|---|
| `TE Sign` | TE Sign V3 A / B | **3** | **13 / 14** |
| `TE Sign 2` | TE Sign 2 V3 A / B | **415** | **2204 / 2205** |

415 continues the DMX group series (3, 401–414) and sits clear of the LED
strand sections (18–25); 2204/2205 continue the fixture series past 2203. Gate:
**0 `section_id_spans_groups`, 0 `fixture_id_collision`.**

> **Pre-existing side effect, called out honestly:** a full sim boot + save
> re-mints section/fixture ids for every **generated** fixture (they are rebuilt
> from their trace generators and lose their stored metadata). This save moved
> the DMX groups 401–414 → 416–429 and fixture ids 2128–2203 → 2206–2281. That
> is the sim's existing behavior on ANY save, not something this change
> introduced (the committed 401/2128 numbers are themselves the product of
> earlier re-mints), but anything keyed on a raw section number — a saved
> per-section state, a hand-written section mask — should be re-checked.

---

## 4. Defect 4 — six LED strands disagreed between `patches.yaml` and the model

**Verified.** `patches.yaml` (as committed) held strand records for exactly
**two** of the eight ropes — `Left_Front_Left` (U30) and `Left_Back_Left` (U31)
— while `titanic.js` carried live sACN addresses for **all eight**. The six that
disagreed, named:

| strand | model said | `patches.yaml` said | controller |
|---|---|---|---|
| `Left_Front_Right` | U32:1 → U32:157 | *(no record)* | `LeftRightRopes` |
| `Left_Back_Right` | U33:1 → U33:157 | *(no record)* | `LeftRightRopes` |
| `Right_Front_Left` | U34:1 → U34:157 | *(no record)* | `RightLeftRopes` |
| `Right_Back_Left` | U35:1 → U35:157 | *(no record)* | `RightLeftRopes` |
| `Right_Front_Right` | U36:1 → U36:157 | *(no record)* | `RightRightRopes` |
| `Right_Back_Right` | U37:1 → U37:157 | *(no record)* | `RightRightRopes` |

Gate: `patch_truth/strand_model_patched_without_record` ×6 **and**
`patch_truth/strand_missing_unpatched_marker` ×6 — 12 of the 21 errors.

**Root cause — two projections, one file each.**

- `simulation/main.js:558-604` (`projectLedStrandPatches`) writes the strand
  records from `computeLedStrandPatches` **alone**. That function returns early
  for any LED controller with no `device:` binding
  (`led_patch_projection.js:169`, gated on
  `controller_registry.js:794 isBoundLedController`). So an unbound
  controller's strands get **no record** — and `save-server.js:246` emits a
  record only when `dmxUniverse > 0`.
- `simulation/src/dmx/pixelblaze_model_exporter.js:327` (before this change)
  seeded the exporter's lane table from `computeLedProjection` — the sim's
  GENERIC per-port model, which covers **every** LED controller — and only
  overrode the bound ones. So unbound strands got an address in the model.

`LeftLeftRopes` carries a `device:` block; `LeftRightRopes`, `RightLeftRopes`
and `RightRightRopes` do not. Two-of-eight vs eight-of-eight, exactly.

**Why that is the dangerous direction.** The sACN bridge builds its relay table
from `patches.yaml`. A strand with no record is routed nowhere — so the engine
was rendering pixels onto U32–U37, the bridge forwarded none of them, and six
ropes were dark with every surface green. That is the silent-dark shape codex P0
exists to ban, and it is what the parity gate calls "the model is stale relative
to the scene".

**Fix — patches.yaml wins, per the operator's ruling.**
`pixelblaze_model_exporter.js:319-352`: the lane table is now built from the
DEVICE-bound projection only; the generic lane supplies solely the firmware
semantics (order, stride, whiteMode, wire). A strand on an unbound controller
exports `patch: null` + `unpatched: true`, and the exporter's existing loud
per-strand console line fires. The model now says exactly what `patches.yaml`
says.

**Why not the other direction:** making `patches.yaml` carry the generic
addresses would have created bridge relay routes to three real rope controllers
(`10.x.x.NN` ×3) and started forwarding live engine frames to them — device
traffic this order forbids — while *asserting* a byte layout for hardware
nobody has bound yet. Binding the three controllers for real needs discovery
HTTP against the devices, which is likewise forbidden here. This direction is
the honest, no-traffic one; it also makes the darkness LOUD instead of silent.

**Blast radius: exactly these six strands.** Every LED controller in every other
scene (`studio`, `studiodj`, `test_bench`) is device-bound, so no other model
export changes by a single byte:

```
titanic   LeftLeftRopes    bound=True    RightLeftRopes   bound=False
titanic   LeftRightRopes   bound=False   RightRightRopes  bound=False
studio / studiodj / test_bench                            bound=True (all)
```

**Proof:** gate reports 0 `strand_model_patched_without_record`, 0
`strand_missing_unpatched_marker`; the six now appear as 6 × INFO
`placeholder/unpatched_marker` (40 px each), promoted to errors by `--strict`.

---

## 5. The model rebuild

### 5.1 What the "TE sign model in Pixelblaze format" actually is

Searched `marsin_pb/` (WASM only), `marsin_engine/models/`, `docs/`, `states/`,
`archived/` and every `TeSignV3` reference. There is exactly ONE place the
sign's pixel geometry lives:

- `simulation/dmx/fixtures/te_sign_v3/model_a_120.yaml` — `TeSignV3A40`, 40 px / 120 ch
- `simulation/dmx/fixtures/te_sign_v3/model_b_102.yaml` — `TeSignV3B34`, 34 px / 102 ch

Everything Pixelblaze-shaped is DERIVED from them: `DmxFixtureRuntime` draws the
pucks from `dots`, and `pixelblaze_model_exporter` emits one
`marsin_engine/models/titanic.js` pixel per `dots` entry (with the scene-wide
`nx/ny/nz`). `te_sign_generator.js` names these two files as the drop-in point.

**Conventions preserved.** `dots` are **millimetres**, origin at the FULL-SIGN
bbox centre (`986.31, 1254.76` — half of 1972.6 × 2509.5). **Y is NOT inverted**
versus the CAD CSV: both are Y-up, the only transform is the translation to the
shared centre (`dmx_fixture_runtime.js:325` multiplies each dot by 0.001 to get
metres and negates only Z, which is 0 for every sign pixel). Per-side
`shell`/`dimensions` blocks, channel map (R=3i+1, G=3i+2, B=3i+3), pixel size
and the `controls` block are carried through unchanged.

### 5.2 The generator

`simulation/tools/gen_te_sign_fixture.js` (new, snake_case, ESM, imports at top,
no fallbacks — a missing flag, a malformed row, a `wire_order` gap, a duplicate
point, a wrong pixel count or a panel appearing on both sides all crash loudly):

```bash
node tools/gen_te_sign_fixture.js \
  --side-a ".../TE_Sign_v3_led_string_points_side_A.csv" \
  --side-b ".../TE_Sign_v3_led_string_points_side_B.csv"
```

`--dry-run` prints the normalization without writing. The next CAD export is a
re-run, not a hand edit. `gen_led_fixture.js map` was deliberately NOT reused:
it centres on the single file it is handed, i.e. it normalizes each side to its
own bounding box — the exact failure this sign cannot survive.

### 5.3 The normalization math (operator-explicit: ONE shared scale)

Computed over the **union** of side A and side B, anchored at the union's
lower-left corner, with a **single** factor for x and y (aspect preserved):

```
union extent   x 166.7 … 1750.0 mm   (span 1583.3)
               y 144.3 … 2309.4 mm   (span 2165.1)

shared factor  k = 1 / max(1583.3, 2165.1) = 1 / 2165.1 mm = 4.618724e-4 / mm

u = (x_mm − 166.7) · k          v = (y_mm − 144.3) · k
```

Resulting extents per side — note they are NOT each 0…1, which is the point:

| side | u | v |
|---|---|---|
| **A** (40 px) | 0.0000 … 0.5388 | 0.3333 … 1.0000 |
| **B** (34 px) | 0.2694 … 0.7313 | 0.0000 … 0.8000 |

A owns the upper-left half, B the lower-right half, and they interlock along the
diagonal seam. Had each side been normalized to its own bbox, both would read
0…1 and the two halves would have been re-centred on top of each other. The
0–1 pair is emitted per pixel as `norm (u, v)` in the YAML provenance comment
and printed in the run summary; the authoritative `dots` stay in the shared-mm
frame because that is what the runtime consumes and what the replaced files
carried.

### 5.4 What actually changed in the data

The point SETS are **identical** old vs new, on both sides (verified
point-by-point). The delta is **wire order only** — which is precisely a change
of which LED gets which DMX channel:

| | old chain order | new chain order |
|---|---|---|
| Side A | P1 → P2 → P3 → P4 → P9 → P10 → P11 | **P9 → P10 → P1 → P2 → P3 → P4 → P11** |
| Side B | P5 → P6 → P7 → P8 | **P8 → P7 → P6 → P5** |

Side A `pixel_1` moves from sign mm (250.0, 1587.7) to (666.7, 866.0); side B
`pixel_1` from (1416.7, 1876.4) to (916.7, 144.3) — the bottom tip. Both new
start points are visible as the white markers in §6's lit renders, which is the
end-to-end proof that the exported channel order matches the CSV.

---

## 6. Verification

### 6.1 Gates

| gate | before | after |
|---|---|---|
| `node tools/scene_model_parity.cjs titanic` | **FAIL — 21 errors** | **PASS — 0 errors**, 0 warnings, 8 info |
| `simulation` suite (`npm test`) | 1482 tests, **10 fail** | 1482 tests, **8 fail** |
| `marsin_engine` suite | 8 environmental fails | 8 environmental fails (unchanged) |
| `python scripts/security_check.py` | — | PASS |

The 8 remaining INFO are honest recorded state: 1 × "no bench block", 1 ×
`placeholder_controller` (the sign controller's real IP is still unknown), 6 ×
`unpatched_marker` (the unbound ropes). `--strict`, the hardware gate, promotes
all 7 of those to errors — as it must.

### 6.2 Every suite delta explained — zero new failures

**Went green (2), both the "operator-scene-drift pins" from the baseline:**

- `real scene titanic: --strict is stricter than the default gate` — untouched
  test. It failed while EVERY finding was already an error, so `--strict` could
  not be stricter. With the default gate at 0 errors and `--strict` at 7, it
  passes on its own.
- `real scene titanic: the model is fresh and complete, and 0% electrically
  mapped` — **rewritten** (`tests/scene_model_parity.test.js:742`) to
  `…and fully mapped`. The old pin asserted `unmapped_fixture ==
  sceneFixtures`, `unmapped_strand == sceneStrands` and `result.ok === false`
  — a deliberate snapshot of the campaign's open state, which this work closes.
  The replacement is *stronger*, not weaker: coverage/patch-truth/views/drift
  still clean, plus 0 unmapped fixtures, 0 unmapped strands, `errors === 0`,
  `ok === true`, and the exact policy-finding set (1 placeholder + 6 unpatched
  markers) pinned by code.

**Updated to the new exporter contract (3), net zero:** in
`tests/pixelblaze_model_exporter_local_index.test.js`, three tests pinned "an
UNBOUND LED controller keeps its generic per-port addresses in the model" —
the behavior §4 deliberately reverses. They were rewritten, not deleted, and the
file is 13/13 green:

- `UNBOUND LED controller is UNCHANGED…` → `UNBOUND LED controller exports
  UNPATCHED — patches.yaml is the patch truth` (asserts all 40 px of both
  strands carry `patch === null` + `unpatched === true`).
- `G3 UNBOUND misaligned start…` → `G3 an UNBOUND spilling strand exports no
  address at all…`. The misaligned-start arithmetic it guarded is now
  *unreachable through the exporter* (only bound controllers export addresses,
  and every per-output cursor starts at channel 1), and it remains pinned
  directly on the walker at `tests/led_patch_projection.test.js:251`
  (`L1 misaligned start`). **No coverage was lost.**
- `G3 UNBOUND stride-aligned start…` → `G3 BOUND stride-aligned start (ch1)
  spills whole to U4 and equals the walker` — same 200 px / stride 4 / no-straddle
  assertions, driven through the reachable bound path, still compared
  byte-for-byte against `projectLedStrandPixels`.

**Still failing (8) — all pre-existing, none touched by this work:**

| test | why it is pre-existing |
|---|---|
| `bench_section_sync`: fixtures are docked beside the ship | ship/bench geometry; no fixture was moved |
| `bench_section_sync`: the real titanic scene can accept the block today | refuses on `TGT_UNIVERSE_RESERVED` for U10 (`Left Back Wall 3/4`) and U12 (`Left SmokeStack 1–4`) — those universes were already occupied in the committed `patches.yaml` before this work |
| `bench_section_sync`: view-bit headroom (`31/31`, expected `30/31`) | `views.yaml` is **byte-unchanged** by this work (`git diff` empty), so the bit count cannot have moved |
| `bench_section_sync`: CLI default emit / CLI `--require-applied` (exit 4) | both follow from the refusals above |
| `pixel_map_view_defaults`: compression threshold headroom (5.20 vs 5) | reads fixture X positions; none changed |
| `scene_model_parity`: test_bench faithful export / known open defects | `test_bench`'s own 4 errors (2 × `unmapped_fixture`, 2 × `metadata_drift` on ITS TE Sign fixtures). No `scenes/test_bench/**` file and no `models/test_bench.js` was written this session |

That is the documented baseline exactly: 10 = 8 stale-model family + 2 titanic
pins; the 8 remain, the 2 are green.

### 6.3 Eyes on it (see_the_world skill, renderer-only)

All captures connect to the ALREADY-RUNNING stack on :6969 and paint
**in memory only**; the 2D tool aborts every :6970 request at the network layer
and reported `sACN output suppressed: YES ✅ (__readonlyMode=true, '[sACN Out]
Enabling' lines: 0)`.

- **2D pixel map, `te_sign` view** (`~/tmp/pixel_map_views/sign_patch_after_te_sign.png`):
  two independent panels resolve — `te_sign/sign_1 'TE Sign' [planar rot90] 2
  clusters / 74px` and `te_sign/sign_2 'TE Sign 2' [planar rot90] 2 clusters /
  74px`. Both signs present, one panel each, selected by **group AND type** —
  the `_48` addendum-2 regression (a fixtureType-only selector swallowing sign 2
  into one panel) is NOT reintroduced. Inspected the PNG: both 74-px figures
  render complete and identical in shape.
- **3D, sign 1 lit** (`.agent_renders/1785522633_sign1_lit.png`) and
  **sign 2 lit** (`.agent_renders/1785522655_sign2_lit.png`): 148 px painted
  with a wire-order chase (white = pixel 1, then red → green → blue). Inspected
  both: the two halves assemble into ONE coherent diamond logo with no tear at
  the seam and correct relative scale between A and B; the white start markers
  land on the new CSV wire-1 points (side B at the bottom tip, side A mid-panel).
  The Lighting Controls tree shows `TE Sign (2)` and `TE Sign 2 (2)` as separate
  2-fixture groups.
- A geometric cross-check plotting all 148 CAD points on a grid shows A
  occupying the upper-left and B the lower-right of one diamond, interlocking
  along the diagonal with no overlap — the shared-scale invariant, visible.
- Both renders carry the intended loud banner: `⚠ 4 patched fixture(s) missing
  Controller IP: TE Sign V3 A, TE Sign V3 B, TE Sign 2 V3 A, TE Sign 2 V3 B` —
  the placeholder sentinel being honest in the UI.

---

## 7. Operator steps remaining

The re-export needed **no** interactive step — it ran through the sim's own save
path (`window.exportConfig({ interactive: false })`) against the running stack,
which regenerated `patches.yaml`, `views.yaml`, `controllers.yaml`,
`scene_config.yaml`, `models/titanic.js` and both sidecars. `pixelCount` is
unchanged at 964, so the engine hot-reloaded on its own — `/status` reports
`activeModel: titanic, modelStale: false, renderHealth.ok: true`. **No engine
restart required.**

Two items are hardware truth only you can supply. Neither blocks the sim, and
both are already loud (`--strict` refuses each):

1. **The TE sign controller's real IP.** `TeSigns-PLACEHOLDER` sits on the
   `0.0.0.0` sentinel with U38 (sign 1) and U39 (sign 2). When the sign wiring
   is assembled: set the real address and drop the `PLACEHOLDER` marker in the
   Controller Mapping panel. If the two signs land on two physical boxes, split
   it into two controllers then — one per real IP.
2. **Bind the three rope controllers.** `LeftRightRopes`, `RightLeftRopes` and
   `RightRightRopes` (`10.x.x.NN` ×3) carry no `device:` block, so their six
   strands are honestly unpatched and receive no sACN. Bind each in the LED
   discovery panel (that is a device HTTP conversation, which this order
   forbade me) and re-save — the six records and their model addresses appear
   together, by construction.

**Also worth a glance:** the section/fixture re-mint described at the end of §3
(DMX groups 401–414 → 416–429). Pre-existing save behavior, but if you have a
saved per-section state or a hand-written section mask, re-check it.

---

## 8. Files touched

| file | what |
|---|---|
| `simulation/tools/gen_te_sign_fixture.js` | **new** — the reusable CAD → fixture-YAML generator |
| `simulation/dmx/fixtures/te_sign_v3/model_a_120.yaml` | regenerated (wire order) |
| `simulation/dmx/fixtures/te_sign_v3/model_b_102.yaml` | regenerated (wire order) |
| `simulation/scenes/titanic/scene_config.yaml` | sign-2 halves renamed (+ save float noise) |
| `simulation/scenes/titanic/controllers.yaml` | placeholder sign controller, `nextControllerId` |
| `simulation/scenes/titanic/patches.yaml` | re-projected by the save |
| `simulation/scenes/titanic/pixel_map_views.yaml` | `~2` offset keys → real names |
| `simulation/scenes/common.yaml` | subscribed universes + 38, 39 (`_camera` restored to its committed value after the save round-tripped it) |
| `simulation/src/dmx/pixelblaze_model_exporter.js` | unbound LED strands export unpatched |
| `simulation/tests/pixelblaze_model_exporter_local_index.test.js` | 3 tests to the new contract |
| `simulation/tests/scene_model_parity.test.js` | titanic pin: 0% mapped → fully mapped |
| `marsin_engine/models/titanic{,.effects,.viewmasks}.js` | re-exported (sidecars: timestamp only) |

No git operations were performed.

---

# ADDENDUM — operator correction: the TE signs are LED, not DMX

**Same day (2026-07-31), same branch.** Operator, verbatim: *"big issue, the TE
signs must be associated with MarsinLED controllers in the controller mapping
pane, please remove all TE sign controllers you added (I saw DMX ones, that's
wrong!) and then make sure the TE sign shows up for the MarsinLED fixtures
please. Also, make sure the TE sign fixtures are clearly of type LED not DMX to
avoid confusion later on in the cycle of this system."*

He is right, and §1 above was the wrong shape: I parked the signs on a **DMX**
placeholder gateway because that was the only thing the mapping chain would let
a `parLights` fixture attach to. The signs are Ango 4 / MarsinLED pixel
fixtures — their own definition YAMLs have said `bus: led` since they landed.
The DMX association is gone and the LED-ness is now real end-to-end.

## A1. What was REMOVED

| removed | where |
|---|---|
| the whole `TeSigns-PLACEHOLDER` DMX controller (id 23, `0.0.0.0`, U38 + U39, all four signs chained on it) | `scenes/titanic/controllers.yaml` — `nextControllerId` back to 23, controller count **17 → 16** |
| all four sign patch records (`U38:1`, `U38:121`, `U39:1`, `U39:121`) | `scenes/titanic/patches.yaml` — **0** `TE Sign` records remain |
| universes **38, 39** from the `Subscribed Universes` field | `scenes/common.yaml` — they existed only for that controller |
| the DMX whole-fixture patch on all 148 sign pixels | `models/titanic.js` — now `patch: null` + `unpatched: true` |

Live proof from the running sim: `dmxPlaceholders: []`, `signChainedAnywhere: []`,
`controllerCount: 16`. The bridge log from the boot BEFORE the removal is a
useful epitaph — it refused the placeholder anyway: *"RELAY ROUTE REFUSED …
U38 → '0.0.0.0' [sentinel] … No sender created; nothing is sent to this
address."*

## A2. The new classification — an **LED PIXEL FIXTURE**

The scene now has two kinds of LED-bus thing, and the whole chain treats both
as LED:

| | LED **strand** | LED **pixel fixture** (new) |
|---|---|---|
| lives in | `params.ledStrands[]` | `params.parLights[]` |
| geometry | interpolated along a start→end line | **baked per-pixel `dots`** (the logo) |
| classified by | being in `ledStrands` | its DEFINITION's `bus: led` |
| wiring | one MarsinLED output, cursor at (port universe, ch 1), stride B/px, no straddle | **identical** |
| patch record | strand shape, only when patched | **identical** |
| model pixel | `type: 'led'` | **`type: 'led'`** |

The classification is **DATA, not a name list** — `bus` off the fixture
definition (`fixture_definition_registry.js`, `bus: model.bus || 'dmx'`). Any
future LED-bus fixture type is LED everywhere the moment its YAML says so; there
is no hardcoded `fixtureType` table to go stale. **The `fixtureType` strings are
UNCHANGED** (`TeSignV3A40` / `TeSignV3B34`) — see A5.

New pure module **`simulation/src/dmx/led/led_fixture_kind.js`**: the predicate,
the pixel count, and `ledMappableCounts()` — the *union* of strands and LED
fixtures. Both LED projections (`computeLedProjection`,
`computeLedStrandPatches`) already key purely off that name to count map, so
**feeding them the union reclassified the signs with no change to either
projection.** That is why this lands as a small diff in each consumer instead of
a new addressing path.

Threaded through, one call site each:

| file | change |
|---|---|
| `src/dmx/led/led_fixture_kind.js` | **new** — the predicate + the union count map |
| `main.js` `projectLedStrandPatches` | projects onto strands **and** LED fixtures; stamps the derived `bus: 'led'` marker for the save-server |
| `main.js` `projectControllerMappings` | passes `ledBusNames` so the DMX pass skips them |
| `src/dmx/controller_registry.js` `projectOntoConfigs` | new optional `ledBusNames` — LED-bus fixtures are **numbered** (they keep their place in the section/fixture id space) but their ADDRESS fields are left to the LED projection, so the two passes cannot fight and log drift every boot |
| `src/dmx/pixelblaze_model_exporter.js` | LED lane table hoisted to one `computeLedLaneFields()`; the DMX-transport loop grew an LED-bus branch: `type: 'led'`, per-pixel walk patch, controller order map, `whiteMode` / `ledWire` / `unpatched` / `displayGroup` |
| `src/gui/controller_map_editor.js` | LED-bus fixtures move from the DMX tray to the **LED** tray; `nameKind()` reports them LED-mappable, so `controllerAcceptsKind` accepts them on an LED card and REFUSES them on a DMX one |
| `server/save-server.js` | LED-bus fixtures take the **strand record shape**, written only when patched |
| `lib/scene_model_parity.cjs` | roster `type: 'led'`; patch truth via the LED walk; LED-mappable on LED controllers only; no `missing_patch_record`; identity checked against `scene_config.yaml` |

### Two bugs this turned up, both fixed here

1. **Identity would have been lost on unmap.** An LED thing gets a patch record
   only while it is patched. Parking `sectionId`/`fixtureId` there meant an
   unmapped sign lost its identity and re-minted different ids on the next boot
   — the model would drift every time. Fixed by following the strand contract
   exactly: identity stays on the **structural** `scene_config.yaml` entry.
   Seeded with the ids the signs already carry, so nothing renumbered:
   `TE Sign V3 A/B` → sId **3**, fId **13/14**; `TE Sign 2 V3 A/B` → sId **415**,
   fId **2204/2205**. Verified stable across a full save round-trip.
2. **A split output gate.** A `type: 'led'` pixel is scaled by the LED
   last-layer gate (`animate.js _applyLedOutputGate`), which keys on
   `displayGroup`. The signs already render in the **LED Fixtures** panel
   (`gui_builder` lists every `bus: led` fixture there — "TE Sign (2)",
   "TE Sign 2 (2)"), so without that key the panel's On/Brightness would have
   moved the fixture's own meshes while the raw entry, the 2D map tap and the
   sACN map stayed bright — the exact split report `20260724_40` closed for DMX.
   `displayGroup` is now stamped on every LED-bus pixel (runtime-only, not
   serialized).

## A3. They now SHOW UP as mappable LED fixtures — live proof

Captured against the running sim (read-only: `debounceAutoSave` stubbed, every
`:6970` request aborted at the network layer — `save-server requests aborted: 2`;
no device HTTP, no sACN output enable):

- `.agent_renders/…_map_pane_te_sign_filtered.png` — **CONTROLLERS (16)**,
  **DMX CONTROLLERS (12)**, no `PLACEHOLDER` anywhere, and the unmapped tray
  reading **"UNMAPPED — 0 FIXTURE(S), 4 STRAND(S)"** with the four chips
  **TE Sign V3 A · TE Sign V3 B · TE Sign 2 V3 A · TE Sign 2 V3 B**, each
  carrying the LED bulb icon. Zero unmapped DMX fixtures — the signs are the
  *only* unmapped things in the ship, and they sit in the LED half.
- `.agent_renders/…_map_pane_led_signs.png` — the same pane unfiltered.
- DOM read-back: `TRAY TITLE: Unmapped — 0 fixture(s), 4 strand(s)`, and the four
  sign names as the only tray chips.
- Per-fixture read-back: all four carry `bus: "led"`, `u: 0, a: 0, cId: 0,
  outputIndex: -1` — present, LED, and honestly unmapped.
- `.agent_renders/…_sign1_lit.png` / `…_sign2_lit.png` — both signs still render
  and light correctly after the reclassification (wire-order chase, halves
  interlocking, no seam tear). The *"4 patched fixture(s) missing Controller IP"*
  banner is gone.

**No replacement controller was created** — per the brief. The operator attaches
them himself; `_96`'s provisional (typed-IP) binding grade landed in parallel and
is what lets him do it with the boards still boxed.

## A4. Parity + suite

| gate | state |
|---|---|
| `scene_model_parity titanic` | **FAIL — 4 error(s), 0 warnings, 11 info** |
| sim suite | 1571 tests, **8 fail** — the documented baseline 8, **zero new** (+12 new tests) |
| security check | PASS |

**The gate is RED on purpose, and this is the one place I did not meet the
brief's letter.** The four errors are exactly `unmapped_fixture` × the four sign
halves. Removing the controller without creating a replacement *necessarily*
re-opens them: an unmapped fixture is an ERROR by design, and softening that to
INFO would blind the gate to a genuinely dark fixture — the failure mode this
whole validator family exists to catch. Everything else is spotless: coverage,
patch truth, drift and views all clean, and the `0.0.0.0` placeholder finding is
gone. **One operator action closes it** — chain the four halves on a MarsinLED
output in the Controller Mapping pane and save; the gate returns to PASS with
the signs carrying real LED addresses.

The titanic pin test was rewritten to assert exactly that state (the four names,
`errors === 4`, zero `unmapped_strand`, zero `placeholder_controller`), plus a
new test pinning the reclassification mechanically: 148 sign pixels, all
`type: 'led'`, all `patch: null` + `unpatched: true`, `fixtureType` strings
unchanged, and no `TE Sign` record in `patches.yaml`.

New coverage: `tests/led_fixture_kind.test.js` (9 — the predicate is data-driven,
a pixel-less `bus: led` definition throws, a strand/fixture name collision is
fatal) and 3 exporter tests (bound LED-bus fixture → `type: 'led'` + the stride-4
per-pixel walk + the controller's order map + geometry untouched; unbound → loud
unpatched; a DMX fixture is byte-identical to before).

`test_bench` still fails its 2 baseline parity tests: its own TE Sign halves now
read as LED too, and its sign identity is still parked in `patches.yaml` under
the old DMX contract. It needs the same one-command re-save — **left alone
deliberately** (that scene is `_89`'s active area, and those 2 failures are the
documented baseline either way). Handoff item, not a regression.

## A5. The `_48` addendum-2 guarantee is intact — and no selector moved

**The `fixtureType` strings did not change.** `TeSignV3A40` / `TeSignV3B34` are
still exactly that, so every selector that names them still resolves:
`pixel_map_view_defaults.js` `TE_SIGN_TYPES` / `TE_SIGN_EXCLUDE`, the scene's
`pixel_map_views.yaml` `te_sign` panels (group **AND** type, one panel per sign),
and `pixel_map_layout.js` `LED_CLASS_FIXTURE_TYPES`.

Worth stating plainly: the 2D layer **already** classified the signs as
`kind: 'led'` — `LED_CLASS_FIXTURE_TYPES` was an explicit operator ruling from
2026-07-24 that hard-coded the two type names precisely because the transport
said DMX. That workaround is now redundant (the pixels report `type: 'led'` on
their own) but is **left in place**: it still correctly classifies any model
exported before today. Deleting it is a follow-up, not a drive-by.

## A6. `_96` file boundary — not crossed

`led_discovery_panel.js`, `marsinled_client.js` and `device_config_mapper.js`
were **not touched**. The reclassification did not need them: the LED tray lives
in `controller_map_editor.js`, and the projections key off the count map. No
handoff item.

## A7. Scene files touched, and what the operator's reload picks up

Found exactly as I left them at 11:18 (he saved nothing over them). Re-read
immediately before each write.

| file | change |
|---|---|
| `scenes/titanic/controllers.yaml` | placeholder controller removed; `nextControllerId` 24 → 23 |
| `scenes/titanic/patches.yaml` | all four sign records gone (re-projected by the save) |
| `scenes/titanic/scene_config.yaml` | the four sign fixtures gained structural `sectionId` / `fixtureId` / `viewMask` |
| `scenes/common.yaml` | universes 38, 39 removed. **Net zero otherwise** — the save round-tripped `_camera` and flipped `lightingMode` to `pixelblaze` (my session ran with no engine); both restored to their committed values |
| `marsin_engine/models/titanic{,.effects,.viewmasks}.js` | re-exported — 148 sign pixels `type: 'dmx'` → `'led'`, `patch: null`, `unpatched: true` |

**A hard reload of the sim picks up:** the TE signs in the LED half of the
unmapped tray (bulb-icon chips, attachable to any MarsinLED output), the
placeholder DMX controller gone from the Controller Mapping list, and the signs
no longer claiming U38/U39. `pixelCount` is unchanged at 964, so the engine
hot-reloads the model with **no restart**.

**Stack state:** I brought up the SIM SERVERS ONLY (`cd simulation && npm start`)
— never the engine — so nothing generated a single sACN frame toward the rig
while I worked, and I stopped them again (`node tools/kill-ports.js`) at the end.
Something else is listening on `:6968`; I left it alone. Bring the show stack
back your usual way: `node launcher.js prod --scene titanic`. (Note for the log:
the sACN **input** bridge crashes on this box at boot with
`addMembership EINVAL` from the `sacn` package — a multicast-join/NIC condition,
unrelated to this work, but it will bite the next person who starts the stack.)

## A8. Operator steps remaining

1. **Attach the four sign halves to a MarsinLED output** in the Controller
   Mapping pane (they are waiting in the LED tray) and save. That is the single
   action that turns the parity gate green and gives the signs real addresses.
   Sizing: side A = 40 px, side B = 34 px; on an RGB output that is 120 ch + 102
   ch, so both halves of one sign fit one universe with room to spare.
   ~~**Set the output's channel order to RGB**~~ ⛔ **WRONG — RETRACTED. See
   "CORRECTION (2026-07-31) — the sign pucks are RGBW, not RGB" at the end of
   this report: the pucks are RGBW, the same lights as the ropes, so the output
   runs RGBW / stride 4.** (The stride does come from the controller's
   `led.order`, and the parity gate cross-checks it — that part stands.)
2. **Bind the three rope controllers** (`LeftRightRopes`, `RightLeftRopes`,
   `RightRightRopes`) so their six strands stop exporting unpatched. With
   `_96`'s provisional grade this no longer needs the hardware powered on.
3. **`test_bench` re-save** — its TE Sign halves need the same identity move
   (see A4). One save of that scene.

---

# CORRECTION (2026-07-31) — the sign pucks are **RGBW**, not RGB

**Operator, verbatim:** *"sign is also RGBW, same lights as the ropes."*

**A8 step 1 above told you to set the MarsinLED output's channel order to RGB.
That instruction was WRONG — do not follow it.** The corrected instruction is at
the bottom of this section. The rest of A8 stands.

## C1. What actually assumed RGB — and what did not

| place | assumed RGB? | effect |
|---|---|---|
| `dmx/fixtures/te_sign_v3/model_*.yaml` — `channel_mode: 120`/`102`, `type: "rgb"`, `channels: {red,green,blue}` | **YES** | declarative: wrong `channel_mode`, wrong per-pixel map, wrong count in the FILE NAME |
| `tools/gen_te_sign_fixture.js` — `footprint = rows.length * 3`, `red: 3i+1 …` | **YES** | the next CAD re-run would have re-emitted the wrong declaration |
| my A8 text + the board / Log / tracker rows | **YES** | the dangerous one — it would have mis-ordered a real output |
| `docs`-side: `20260725_13` pattern-catalog table row `TeSignV3A40 / TeSignV3B34 → rgb` | **YES** | misleading for pattern authoring (no `w` lane) |
| `led_fixture_kind.js` (`ledBusPixelCount` returns a PIXEL count, never bytes) | no | — |
| the exporter's LED-bus branch (`footprint: ledProj.stride`, `channels` = controller order map) | no | — |
| `computeLedProjection` / `computeLedStrandPatches` (stride from `controller.led.order`) | no | — |
| the parity validator (stride read off the model patch, cross-checked against `ledStride(controller)`) | no | — |

**So there was no byte-level bug.** For an LED-bus fixture the stride and the
channel map come from the owning MarsinLED output — for a sign exactly as for a
rope strand — which is precisely the property the reclassification bought. Had
the signs been mapped onto an RGBW output with the definitions still saying RGB,
the wire would already have been correct. What was wrong was every number a
HUMAN reads: `channel_mode`, the file name, the pattern-catalog row, and my
mapping instruction.

## C2. What changed

- **`tools/gen_te_sign_fixture.js`** — one new pair of constants,
  `BYTES_PER_PIXEL = 4` / `PIXEL_FORMAT = 'rgbw'`, threaded through the
  footprint, the per-pixel channel quad, the `controls` block and the summary
  line. The emitted header now states the format AND that the run-time authority
  is the controller's `led.order`, so the next reader is not misled again.
- **Definitions regenerated and RENAMED** so the name stops lying about the
  channel count:
  - `model_a_120.yaml` → **`model_a_160.yaml`** (`te_sign_v3_a_160`, 40 px × 4 = **160 ch**)
  - `model_b_102.yaml` → **`model_b_136.yaml`** (`te_sign_v3_b_136`, 34 px × 4 = **136 ch**)
  - per pixel: `type: "rgbw"`, `channels: { red: 4i+1, green: 4i+2, blue: 4i+3, white: 4i+4 }`
  - **geometry is byte-identical** — same 148 points, same wire order, same
    shared 0-1 normalisation (`k = 1/2165.1 mm`, side A `u 0…0.5388 / v
    0.3333…1`, side B `u 0.2694…0.7313 / v 0…0.8`).
- **`main.js`** — the 4 registration references repointed. Sequenced
  new-files → repoint → delete-old, so there was no instant where a page load
  could fetch a missing definition (the operator was testing at his desk).
- **`docs`** — the `20260725_13` catalog row corrected to `rgbw`.
- **Two regression tests** (`tests/scene_model_parity.test.js`): the sign
  definitions declare RGBW at 4 bytes/px with an RGBW quad on every pixel, and
  that stride equals the stride every titanic LED controller runs. The
  generator cannot quietly fall back to 3 bytes again.

## C3. The universe arithmetic, corrected

| | RGB (wrong) | **RGBW (real)** |
|---|---|---|
| side A, 40 px | 120 ch | **160 ch** |
| side B, 34 px | 102 ch | **136 ch** |
| one whole sign | 222 ch | **296 ch** |
| fits one universe? | yes | **yes** (296 of 512) |

The "fits one universe" conclusion survives — with 216 channels of headroom
instead of 290. (§1's `222 ch` and A8's `120 ch + 102 ch` are the RGB-era
numbers; they described the DMX placeholder that no longer exists.)

## C4. Gates

| gate | state |
|---|---|
| `scene_model_parity titanic` | **4 error(s), 11 info — UNCHANGED**, still exactly the four `unmapped_fixture` awaiting mapping |
| sim suite | 1590 tests, **8 fail = the documented baseline 8, zero new** (+2 RGBW pins) |

No server was started, stopped or reloaded; no scene file was written; zero
device HTTP. The definitions are fetched at page load, so the operator's
CURRENTLY OPEN tab keeps the old ones in memory — **his next hard reload picks
up the RGBW definitions**, and nothing else changes (the exported model is
unaffected, because the LED path never read the definition's channel map).

## C5. The corrected mapping instruction

> Chain the four sign halves on a **MarsinLED output running RGBW / stride 4 —
> the same setting the rope outputs already use** — and save. Side A is 160 ch
> and side B 136 ch, so one whole sign is 296 channels and both halves fit on
> one output inside a single universe.
