# `_307` — Fable review: `docs/TITANIC_MODEL.md`

**Date:** 2026-08-17 · **Role:** reviewer (Fable) · **Scope:** read-only review
of `docs/TITANIC_MODEL.md` (456 lines, untracked, mtime 2026-08-17 15:39)
against the model sources of record. No source or doc edits; no services
started. The `_305` baby-wave churn in `marsin_engine/patterns/baby/**` and
playlists was observed and ignored as expected.

**Verification method:** an independent census script (scratchpad, not in
tree) loaded `marsin_engine/models/titanic.js` (generated 2026-08-14T22:38Z)
and recomputed every numeric claim: pixel totals, raw bounds, normalization
spans, all 24 per-region rows (pixels/fixtures/type/nx/ny/nz/localIndex/
sectionId), side-split thresholds, TE-sign index ranges and half ordering,
and both side-local forward vectors from wall centroids.

---

## Lens 1 — TRUTH

### 1.1 Verified exact (the doc is numerically outstanding)

Every one of the following matched the generated model to the last digit:

| Claim | Doc | Source | Result |
|---|---|---|---|
| Total pixels 964 | `TITANIC_MODEL.md:53` | `marsin_engine/models/titanic.js:13` (`pixelCount = 964`, array length 964) | exact |
| Raw bounds all six values (`-50.318..45.454`, `0.250..14.900`, `-26.379..16.156`) | `:57-59` | recomputed from all 964 pixels | exact |
| Normalization denominators `95.772 / 14.650 / 42.535` | `:71-73` | recomputed spans | exact; stored `n*` within 5e-5 of formula (4-decimal rounding as stated) |
| All 24 rows of the §3.2 region census (pixels, fixture counts, export types, nx/ny/nz ranges, local-index ranges, section ids) | `:151-176` | recomputed per-group census | **all 24 rows exact**, including single-value oddities (Left Auditorium `ny 0.8362`, Left Small SmokeStack `ny 0.0171`) |
| Side split `port < ~0.386`, `starboard > ~0.657` | `:81-83` | actual left-group max nx `0.3861`, right-group min nx `0.6575` | exact |
| Side-local forward vectors `(-0.017985,+0.999838)` and `(+0.614702,+0.788759)` | `:95-96` | wall-centroid recomputation; also `marsin_engine/tools/titanic_model/regions.mjs:54-57` | match to 6 decimals |
| TE Sign at global `0..73`, TE Sign 2 at `74..147`, each ordered A40 → B34 | `:343-344` | model indices + fixtureType sequence | exact |
| Role census: 360 bar / 320 strand / 96 vintage / 40 par / 148 sign = 964 | `:132-138` | fixtureType census (ShehdsBar 360/20 fids, `''` 320/8, VintageLed 96/16, UkingPar 40/40, TeSignV3A40+B34 148/4) | exact |
| Strand pixels intern to `FIX_RAW_LED` despite empty `fixtureType` string | `:135` (implicit) | `marsin_engine/lib/fixture_type_constants.js:52,69` (alias `''` → `FIX_RAW_LED`, deliberate) | correct |
| §8 gate thresholds (20% region floor, 80% wall floor, 8–90% occupancy band, 0.20 balance delta) | `:399-410` | `marsin_engine/tests/patterns/titanic_model_coverage.test.mjs:17-18,50-71,92` | exact |
| Composite/derived view names | `:208-211` | `marsin_engine/models/titanic.viewmasks.js:36-44`; `marsin_engine/lib/auto_views.js:67-68,225,238`; `strand_views.js:110-111` | all present |

I found **zero false numeric claims**. For a 456-line doc making on the order
of 150 falsifiable numeric statements, that is rare and worth saying plainly.

### 1.2 D1 — the port/starboard contradiction (the one real truth problem)

The doc asserts:

- `docs/TITANIC_MODEL.md:57` — `X` "negative is port/left and positive is
  starboard/right".
- `docs/TITANIC_MODEL.md:107-108` — "left = port, right = starboard".

The shipped Live Touch spatial pad — the operator surface, whose label code
carries the comment *"Labels are part of the safety contract: they must
describe the same projection sent to the engine"* — asserts the exact
inverse:

- `docs/ui/touch_control_wire.js:2662-2663` —
  `lft.innerHTML = '<b>X−</b>STARBOARD'; rgt.innerHTML = '<b>X+</b>PORT'`.

These cannot both be right. Supporting facts:

- The scene sources contain **no nautical naming at all** — groups are
  `Left */Right *` only (`simulation/scenes/titanic/*.yaml`; confirmed by the
  gap analysis `.agent/reports/202606/20260612_2_titanic_gap_analysis.md:192`
  "No nautical language (bow/stern/port/starboard) anywhere; `Left/Right`").
  So "left = port" is an editorial equation with no scene-source backing.
- Nautical self-consistency favors the pad: the doc itself establishes
  ship-forward ≈ world `+Z` (port-half forward `(-0.018, +0.9998)`,
  `TITANIC_MODEL.md:95`), and the pad labels `Z+ SHIP FORWARD`
  (`touch_control_wire.js:2656`). In a right-handed frame with `+Y` up and
  forward `+Z`, the ship's left (port) side is `+X` — i.e. the `Right *`
  named groups. Under standard nautical convention the doc's mapping is the
  inverted one.
- `docs/MARSIN_ENGINE_PATTERNS.md:692-693` sides with TITANIC_MODEL.md
  (`LEFT` = X<0 = "the whole port half"), so the contradiction is
  doc-family vs operator-surface, not a one-line typo.
- The pad's `Z+ SHIP FORWARD` label is pinned by a contract test
  (`marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js:295`);
  the STARBOARD/PORT labels are not test-pinned, so either side can be fixed
  cheaply once the build truth is known.

**Quantified:** doc says port = X<0 (`TITANIC_MODEL.md:57,107`); shipped
operator surface says port = X+ (`touch_control_wire.js:2663`). One physical
half of the ship is mislabeled by one of the two. Which one is wrong is a
build/art fact the repo does not contain — it needs an operator ruling.

### 1.3 Minor truth notes

- §9 claims the four walls "reach and animate 100% of their pixels for all
  six keepers" (`:441-442`). The executable gate only enforces ≥80%
  (`titanic_model_coverage.test.mjs:18`), so this is a point-in-time report
  claim living inside a reference doc; it will rot silently. Not false today
  (unverifiable statically), but misplaced.
- §8 says "For every Crisp keeper" — accurate, and that scoping is itself the
  problem (see Lens 2).

## Lens 2 — COMPLETENESS for the work we do

Would this doc have prevented tonight's `ink_drops` defect (missed wall,
`.agent/reports/202608/20260817_300_baby_tease_rebuild_implementation.md`)?

**Conceptually yes, mechanically no.**

- Yes: §6.1 and failure mode §7.1/§7.4 describe exactly that class (a
  world-space shape that never intersects a wall), and the §8 whole-wall gate
  (≥80% of each wall lights and changes) would have caught it outright.
- No: the executable contract is **crisp-only**. `coverage.mjs` and
  `titanic_model_coverage.test.mjs:43` iterate `CRISP_KEEPERS`; nothing runs
  these gates for `baby_tease`/`baby_boy`/`baby_girl` or curated playlists —
  the very playlists where the defect happened tonight. The doc reads as if
  the ship now has a coverage safety net; it has one for six patterns.
- The `_300` wave meanwhile built a **parallel measurement vocabulary**
  (L2 `shipLong`/`shipWide`, perceived balance, per-second handoff —
  `_300` §7.2) that does not share `regions.mjs`, the forward axes, or the
  gate thresholds. Two same-day stacks measuring the same ship differently is
  exactly the rediscovery cost this doc exists to eliminate.

Concrete gaps a pattern author still has to rediscover by measurement:

1. **Intra-fixture walk directions.** §3.3 admits "each 40-pixel fixture has
   its own physical walk" but documents none of them. Where does
   `pixelLocalIndex 0` sit on each strand/bar (top/bottom, fore/aft)? Which
   way do the 5 bars in a wall stack? Any sweep or comet author needs this
   table; today they must render and squint.
2. **The empty middle band.** No pixels exist in normalized
   `x ∈ (0.3861, 0.6575)` — 27% of the x-axis is guaranteed dark. The doc
   implies it via the split thresholds but never states "this band contains
   zero pixels"; a center-anchored composition wastes its energy there.
3. **Aspect-correction constants.** §6.4 orders "aspect-correct normalized
   axes" but never gives the numbers. They are one line: raw spans
   `x:z:y = 95.772 : 42.535 : 14.650` ≈ `6.54 : 2.90 : 1.00`.
4. **Live Touch pad conventions missing from §2.4.** The view catalog covers
   Pixel Map Top/Front/Side, TE Sign view, and the Crisp gallery, but not
   the operator's Live Touch spatial pad (`docs/44_touch_control.md:141`,
   `(nx,nz)`, `Z+` ship-forward/down-screen) — the one surface where the D1
   contradiction is visible to a human during a show.
5. **test_bench groups undocumented.** The gates run on `test_bench` too, but
   the doc says nothing about that model's groups, so authors can't reason
   about the portable-role gate before running it.
6. **No per-region raw extents.** Only normalized ranges are tabulated;
   physical sizes (meters) per wall/region would ground density-aware
   brightness (§6.5) in something measurable.

## Lens 3 — FRESHNESS

- The doc, `marsin_engine/tools/titanic_model/{regions,coverage}.mjs`,
  `tests/patterns/titanic_model_coverage.test.mjs`, and
  `tools/titanic_model_census.mjs` are **all untracked** working-tree files
  created today (2026-08-17 15:26–15:39). Nothing protects them; no CI or
  auto-check runs the census test.
- The generated model it describes (`titanic.js`, export stamp
  2026-08-14T22:38Z) is the current one in HEAD. The Aug-16 commit
  `413d799d` changed `patches.yaml` sectionIds/fixtureIds (e.g. Right Front
  Wall `542→556`, `2890→2966`) and the model already carries the new ids
  (`sId: 556` etc.) — consistent, not stale. The other `413d799d`
  scene_config change (`maxSpotlights 200→100`) is non-geometric.
- In-flight playlist churn (`baby_*`, crisp playlists, `_305` wave) does not
  touch geometry. **The doc is fresh as of this hour** — but its freshness is
  entirely manual until the census test is landed and wired into a gate.

## Lens 4 — JUDGMENT

This is the best-verified geometry doc in the repo: every falsifiable number
checked out, the source-chain preamble (§1) is the correct epistemology, the
failure-mode catalog (§7) is written from real scars, and §5's four balance
words give reviews a shared vocabulary. It is absolutely pulling its weight —
**except** that it hard-codes a port/starboard mapping that the shipped
operator surface contradicts, and it advertises an acceptance-gate regime
that only six patterns actually live under.

The structural critique: the doc **duplicates by hand what
`regions.mjs` already owns**. The §3.2 table is 24 rows of numbers that
`buildTitanicModelCensus()` computes; prose and registry will drift the first
time someone re-exports and updates only one. The right shape is: registry
(machine-readable) → generated table → doc embeds or links it.

### Recommendations (prioritized)

| # | Recommendation | Effort |
|---|---|---|
| R1 | **Resolve D1 repo-wide.** Get the build-truth ruling from the operator (which physical half is port), then fix the losing side in one commit: either `TITANIC_MODEL.md:57,107` + `MARSIN_ENGINE_PATTERNS.md:692-693`, or `touch_control_wire.js:2662-2663` (+ add a label contract-test pin either way, alongside the existing `Z+ SHIP FORWARD` pin at `touch_control_wire_layers_contract.test.js:295`). Until then the doc should at minimum flag the conflict instead of asserting the mapping. | S (code) + operator decision |
| R2 | **Extend the §8 gates beyond crisp.** Parametrize `coverage.mjs` over a playlist manifest (patterns + their intent registries) so `baby_*` and curated keepers run the same census/wall gates; retire or fold `_300`'s parallel L2/balance tooling into the same library (`regions.mjs` already exports the forward axes it re-derived). This is what actually prevents the next `ink_drops`. | M |
| R3 | **Land the artifact set.** Commit doc + `tools/titanic_model/` + census test together and wire `node --test tests/patterns/titanic_model_coverage.test.mjs` (census test at minimum; the 160-frame keeper test where runtime budget allows) into the marsin_engine auto-check spec so drift fails loudly. Untracked canonical docs are one `clean -fd` from gone. | S |
| R4 | **Invert the census table's ownership.** Emit `regions.json` (or extend `titanic_model_census.mjs --out`) as the machine artifact and generate the §3.2 markdown table from it; the doc keeps prose, the numbers get one owner. Gates, gallery tooling, and CaptainPad could all consume the same JSON. | M |
| R5 | **Add the missing authoring data:** per-fixture walk-direction table (localIndex 0 → end, all 8 strands + wall bar stacking), an explicit "zero pixels in `x ∈ (0.386, 0.657)`" dead-band statement, the aspect constants `6.54 : 2.90 : 1.00`, Live Touch pad conventions in §2.4, and a short test_bench group appendix. | M |
| R6 | **Move the §9 "100% of pixels" runtime claim** into a dated report (or restate as "gated at ≥80%, measured 100% on 2026-08-17"); reference docs should not carry unre-verified point-in-time measurements. | XS |

### Verdict

Trust the numbers, question the words "port" and "starboard". The doc is
numerically flawless against the current export and structurally strong; its
one dangerous statement is the side-naming equation, which — if the pad is
right — points every "port" design at the physical starboard half. Fix D1
first, then make the gates playlist-wide (R2); everything else is polish on a
genuinely authoritative foundation.
