# 20260724_14 — LED grouping parity + TE Sign generator + TE Sign V3 install

**Slice:** N=14 (LED-grouping + TE-sign-generator) on `feat/bm_readiness`.
**Author:** implementer sub-agent. **Status:** code + tests landed
(uncommitted); **live verification COMPLETE** (S4 registered main.js + pixel-map
seams; go-signal received) — see "Live verification" at the end. No git ops
performed.

Folds in the mid-task operator drop: the placeholder `TeLedGrid40` grids are
replaced by the **real TE Sign V3** fixtures, and the generator's between-halves
offset is dropped — **Side A and Side B always share one identical transform**.

## What landed (files)

**New:**
- `simulation/dmx/fixtures/te_sign_v3/model_a_120.yaml` — Side A, `TeSignV3A40`,
  40 px / 120 ch.
- `simulation/dmx/fixtures/te_sign_v3/model_b_102.yaml` — Side B, `TeSignV3B34`,
  34 px / 102 ch.
  (Both copied from the operator-supplied models with **all external provenance
  scrubbed** — file headers rewritten native, source-repo/script/JSON paths and
  the "GT" frame term removed; a fail-loud token scan confirmed zero residue.
  Per-pixel `dots`/channels are byte-identical to the source; only comments
  changed.)
- `simulation/src/fixtures/te_sign_generator.js` — the generator (pure module).
- `simulation/tests/te_sign_generator.test.js` — 12 tests.
- `simulation/tests/te_sign_grouping_parity.test.js` — 4 tests.

**Modified:**
- `simulation/scenes/titanic/scene_config.yaml` — replaced `TE LED Grid 1/2`
  (`TeLedGrid40`, group `TE LED Grids`) with `TE Sign V3 A`/`TE Sign V3 B`
  (`TeSignV3A40`/`TeSignV3B34`, group **`TE Sign`**), both at the identical
  centered pose `x:0 'y':9 z:17 rotY:180`. `'y'` quoting preserved; the
  `traces: &ref_0 / *ref_0` anchor left untouched (verified same-ref after
  parse); `ledStrands` + `groupOverrides` zero-diff.
- `simulation/src/gui/gui_builder.js` — import `buildTeSign`; added a
  **`✨ + TE Sign (A+B)`** button to the DMX Fixtures ("Light Instances")
  toolbar that instantiates the pair via the generator.

## How grouping parity works

LED-strand grouping already shipped in the Views Rehaul (#36): strands carry a
`group` field, `groupKeyForStrand` (`group || name`), section-id-per-group
(`led_metadata.js`), and the exporter emits `pixel.group` for them. The TE Sign
halves are **LED-type fixtures that ride the DMX-transport path** (they live in
`parLights`, rendered by `DmxFixtureRuntime`), so they inherit DMX grouping
end-to-end with no new plumbing:

- **Lighting Controls list** — `parLights` are folder-grouped by `config.group`
  (`gui_builder.js` `renderParGUI`); both halves share group `TE Sign` ⇒ one
  group folder with group On/Brightness + per-fixture cards.
- **Selection / masks / auto-views** — the exporter emits each par pixel's
  group as `light.group || ''` (`pixelblaze_model_exporter.js:89,152`);
  `listPixelGroups` → `reconcileGroupBits` assigns **one** view bit per distinct
  group. Two halves under `TE Sign` ⇒ one shared bit ⇒ one named mask / auto
  view. This is type-agnostic, so LED-type and DMX fixtures group identically.

The generator assigns both halves to group `TE Sign`, so the acceptance case
(“group the two sides of the TE sign as one group”) holds by construction.
`te_sign_grouping_parity.test.js` proves it at the `view_registry` contract
level (one group ⇒ one power-of-two bit; DMX + LED-type groups get distinct
bits; ungrouped ⇒ no bit).

## Generator: params + the pixel-map drop-in point

`te_sign_generator.js` (pure, fail-loud, no fallbacks):
- `buildTeSign(opts)` → `[sideA, sideB]` fixture configs ready to push into
  `parLights`. Only `name` + `fixtureType` differ; **transform is copied
  verbatim into both** (HARD INVARIANT — A ≡ B position/rotation/scale, always).
- `applyTeSignPlacement(fixtures, placement)` → rigidly re-places an existing
  pair (adjustable-after-instantiation) keeping both halves locked together.
- Params (all validated finite / non-empty; scales > 0): `name`, `group`,
  `x`, `y`, `z` (**whole-sign** placement — NOT a per-half offset, per the
  operator ruling), `rotX/Y/Z`, `scaleX/Y/Z`, `color`, `intensity`, `angle`,
  `penumbra`, `brightness`, `diffusion(+Amount)`, `typeA`, `typeB`. Defaults
  reuse the shipped centered pose.

**Pixel-map drop-in point (data-driven):** the generator bakes **no** geometry —
it only names the two `fixture_type`s. Each half's pixel layout is data in its
model YAML (`dmx/fixtures/te_sign_v3/model_a_120.yaml`, `…/model_b_102.yaml`;
per-pixel `dots` in mm, R=3i+1/G=3i+2/B=3i+3). To swap in a revised map, replace
those YAMLs (e.g. via `tools/gen_led_fixture.js map --file <pixels.json>`) and
keep the two `fixture_type` strings — no generator/logic change. The current
V3 map **is** the operator's real map, so it is now the default.

## Test totals

`cd simulation; npm test` → **426 pass / 0 fail** (410 pre-existing baseline
incl. other slices' tests + **16 new** here). `git diff --check -- simulation`
clean (only pre-existing LF/CRLF advisories on other agents' files). All new/
edited JS `node --check` clean. Scene YAML re-parses; anchor intact; A≡B
transform verified.

## main.js registration (RESOLVED by S4)

main.js was fenced (S4 owns it). **S4 applied the registration itself** — console
confirms `[FixtureRegistry] Loaded 8 fixture type(s): … TeSignV3A40, TeSignV3B34`
with no `[FixtureModels]` errors — so I made **no** main.js edit. Live
verification is now COMPLETE (see the "Live verification" section below). The
patch that S4 applied, for the record:

### Exact main.js patch (apply when free, mirrors the te_led_grid precedent)

1. In the `Promise.all([...])` fetch list, right after the te_led_grid fetch
   (~line 315), add TWO fetches:
   ```js
     fetch("dmx/fixtures/te_sign_v3/model_a_120.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
     fetch("dmx/fixtures/te_sign_v3/model_b_102.yaml?t=" + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
   ```
2. In the `.then(async ([...]) =>` destructure (~line 317), insert two names
   between `teLedGridModelYaml` and `rootConfigYaml`:
   `…, teLedGridModelYaml, teSignV3AModelYaml, teSignV3BModelYaml, rootConfigYaml]`
3. In the "Load fixture models" list (~line 621), add a comma after the
   te_led_grid entry and add TWO entries:
   ```js
       { raw: teLedGridModelYaml, file: 'te_led_grid/model_120.yaml' },
       { raw: teSignV3AModelYaml, file: 'te_sign_v3/model_a_120.yaml' },
       { raw: teSignV3BModelYaml, file: 'te_sign_v3/model_b_102.yaml' }
   ```
After a hard reload, check console for `[FixtureModels]` errors (empty fetch =
404 → generic-par fallback).

## ⚠️ S4 SEAM — pixel_map LED-class classification (must NOT edit; recorded)

Replacing `TeLedGrid40` orphaned hardcoded references in **S4-owned**
`src/gui/pixel_map/**` (forbidden to me). Without these the new sign renders as
`kind:'dmx'` in the 2D-vis and the `te_sign` auto-view selects nothing — the
operator's "TE Sign classifies as LED type" ruling breaks for V3. Required S4
edits:
- `pixel_map_layout.js:41` `LED_CLASS_FIXTURE_TYPES` — add `'TeSignV3A40'`,
  `'TeSignV3B34'` (TeLedGrid40 may be dropped; no scene uses it now).
- `pixel_map_layout.js:30` `TYPE_STYLES` — add style entries for the two new
  types (optional — they fall to `_default` square with an info log otherwise;
  note they are irregular logo halves with real per-pixel dots, NOT `planar`-
  expanded grids, so no grid expansion hint).
- `pixel_map_view_defaults.js` — the `te_sign` view `select: [{ fixtureType:
  'TeLedGrid40' }]` (~line 109) and the `top_down`/`strands` `exclude:
  [{ fixtureType: 'TeLedGrid40' }]` (~lines 49,95) must reference the two new
  types instead.
- The associated `tests/pixel_map_*.test.js` fixtures (still using TeLedGrid40)
  will need updating alongside S4's change; they pass today because they build
  TeLedGrid40 pixels inline (independent of the scene).

## Live verification (post-registration — go-signal received)

S4 landed: main.js registers `TeSignV3A40`/`TeSignV3B34` and the pixel-map seams
are updated. I ran the deferred live verification renderer-only against the
running :6969 stack (never restarted it). Tooling:
`agent_tools/tesign_verify.cjs` + `tesign_verify2.cjs` (browser) and a pure-node
`tesign_geometry_check.js` (deterministic, from the installed YAMLs).

| # | Check | Result |
|---|---|---|
| 1a | Console: no `[FixtureModels]`/`[FixtureRegistry]` errors | **PASS** — registry loaded `TeSignV3A40`/`TeSignV3B34` @ 120/102 ch; **0** fixture/registry/TeSign errors. (1 unrelated generic resource `404` present — NOT a model file: both YAMLs loaded, else an empty-response `[FixtureModels]` error would have fired. Pre-existing, not introduced by this slice.) |
| 1b | Patch labels `TeSignV3A40 …120ch` / `TeSignV3B34 …102ch` | **PASS** — read from Lighting Controls DOM: `TeSignV3A40 · 120ch`, `TeSignV3B34 · 102ch`. |
| 2 | 74 rendered pixels; cloud ≈1.58 m × 2.17 m | **PASS** — runtime: fixtures i12 `TeSignV3A40` (40 px) + i13 `TeSignV3B34` (34 px) = **74**, world bbox **1.58 m W × 2.17 m H**. Deterministic YAML check agrees (40+34, footprints 120/102). |
| 3 | Chase order per side, not mirrored | **PASS (deterministic)** — fixture-local chain landmarks: Side A starts mid-LEFT (x −736), climbs to topmost at idx18 (y 1055), ends lower-middle (idx39); Side B starts upper-RIGHT (430, 622), bottom-tip is a LATE index (idx19), tail sweeps up to idx33 — matches intent. Mirror: scene `rotY 180` maps local +X→viewer-left when facing the lit front, so A reads mid-left as intended → **rotY is correct, no YAML/scene change needed**. (3D beauty shot too small to eyeball under SwiftShader; deterministic order is authoritative.) |
| 4 | Halves interlock along the diagonal seam, ≥~80 mm | **PASS (deterministic)** — all 40 A pixels on one side of the seam GT(627.7,674.5)→(1422.4,2035.5), all 34 B on the other (clean disjoint split); nearest A↔B = **166.6 mm** (≥ 80). |
| 5 | `TE Sign` group selects both halves as one | **PASS** — Lighting Controls shows one `TE Sign (2)` group folder; its group **Select All** selected exactly **2/2** sign fixtures, **0** others. |
| — | 2D `te_sign` multiview eyeball (S4 ask) | **DEFERRED** — the `2d_pixels` profile would not load under SwiftShader in the render harness (nav/capture timeout at ~1 FPS). S4 already verified the 2D seams (per go-signal); the deterministic geometry above covers the geometry sanity. Re-check on a real GPU if a screenshot is wanted. |

**Screenshots** (`.agent_renders/`, prefix `tesign_*`): `*_3d_sign_chase.png`
(sign lit in ship context, `TE Sign (2)` group + `✨ + TE Sign (A+B)` button
visible), `*_group_selected.png` (transform gizmo attached to the group after
Select All), `*_lc_labels2.png` (`TE Sign (2)` expanded → `TE Sign V3 A` card).
Note: the full profile ran ~1 FPS under SwiftShader (software GL), so 3D shots
are ship-wide/small; the runtime + deterministic probes carry the geometry
proof. A freeze-debug engine restart on :6968 did not affect these checks (sign
is sim-only / unpatched).

**Net: all operator checks PASS** (2D-view screenshot deferred to a GPU host /
S4's own pass). No mirror fix needed; scene `rotY 180` is correct.

## Notes / non-goals

- `dmx/fixtures/te_led_grid/model_120.yaml` and its registration are **kept**
  (removing them is out of scope; harmless — simply unused by titanic now).
- Engine model regen (`marsin_engine/models/titanic.*`) happens on export; not
  touched here.
