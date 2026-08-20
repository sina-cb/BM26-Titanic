# 2026-07-24 — 2D vis multiview: S2 view model (implementer report)

Slice **S2 (view model)** of the 2D-vis multiview wave (project
`bm_readiness_mapping`, branch `feat/bm_readiness`). Built in parallel with
S1 (geometry/frame core) and S3 (pane shell) in the shared tree, against the
§5 API contracts in the design doc `20260724_9_2d_vis_multiview_design.md`.
No git ops, no commits. Other agents' uncommitted work left untouched.

## What landed (my owned files only)

- **NEW `simulation/src/gui/pixel_map/pixel_map_views.js`** — the
  "views-are-data" engine (pure logic; no DOM/canvas/signals):
  - Vocabulary locked as fail-loud constants: `SELECTOR_KEYS`
    (kind/fixtureType/group/name/view), `KINDS` (dmx/led), `LAYOUTS`
    (spatial/radial/planar/lanes), `PROJECTIONS` (top/front/side).
  - Schema validation (`validateSelector` / `validatePanelDef` /
    `validateViewDef`) that **throws** on unknown selector keys, unknown
    layout/projection, bad `kind`, empty/missing `select`, missing view id,
    empty `panels`, duplicate panel ids, and malformed placements.
  - Selector resolution: `kind`/`fixtureType` exact, `group`/`name` glob
    (`*`/`?`, else exact), `view:` via the Views-Rehaul `view_registry`
    (base group → itself, custom view → its member groups). Union across
    the `select` array, AND within one selector object, optional `exclude`,
    empty `{}` = match-all.
  - `resolveView(viewDef, clusters, list, ctx) → { id, label, panels: [{ def,
    clusters, placements:Map, styles, error? }] }` — a zero-match or
    unknown-registry-view panel gets a loud `error` string + empty clusters
    (renderable, never a silent blank — codex P0), and a bad panel does not
    kill its siblings.
  - Container lifecycle: `createViewsContainer` / `addView` / `addBlankView`
    / `removeView` / `duplicateView` (deep clone, auto-unique id) /
    `findView`, all validating and normalizing.
  - Persistence: `toParams` ↔ `createViewsContainer` round-trips the
    `params.pixelMapViews` shape (`{ version, views[] }`);
    `migrateLegacyPixelMap2d` folds a legacy `params.pixelMap2d` layout into
    an `all_fixtures` view preserving placements/styles.
- **NEW `simulation/src/gui/pixel_map/pixel_map_view_defaults.js`** — the 4
  shipped views as data + `buildDefaultViews()` / `seedDefaultViews()`.
- **NEW `simulation/tests/pixel_map_views.test.js`** — 47 unit tests.

## Chimney-groups default I shipped (design §slice S2 note / §8 Q2)

The `top_down` view's `stacks` panel defaults to **BOTH** chimney par
groups, laid out as **two radial rings** — NOT the operator's remembered "8
pars in a circle". Verified against `scenes/titanic/scene_config.yaml`: the
scene has two groups, **`Left Top Chimney Generator`** and **`Right Top
Chimney Generator`**, **UkingPar ×10 each** (also confirmed in
`scenes/titanic/views.yaml`). Exact names exported as `CHIMNEY_GROUPS` and
used by the `stacks` selectors, so the panel resolves to 20 clusters. It is
fully data-editable: to focus a single stack, edit the panel's `select`.
This still needs an operator ruling (design §8 Q2) — flagging, not blocking.

## Contract adherence / deviations

- §5 `resolveView` implemented exactly; **one additive, backward-compatible
  extension**: an optional 4th arg `ctx = {}`. `ctx.viewRegistry` (a
  `createViewRegistry` result) is required **only** when a panel uses a
  `view:` selector; a `view:` selector with no registry throws (wiring bug).
  Three-arg callers that never use `view:` are unaffected. No other
  deviations.
- `list` (batch render list) is accepted for contract symmetry but not read:
  selection matches on the cluster fields (`kind`/`fixtureType`/`group`/
  `fixKey`) alone, per design §2.2.
- Consumes the §5 Cluster shape `{ fixIndex, fixKey, fixtureType, kind, group,
  pixels }`. **`kind` is added to clusters by S1** (`buildClusters` today does
  not stamp it) — my tests build clusters to the contract shape directly, so
  they are independent of S1 landing. Once S1 lands, S4 wiring feeds real
  clustered data through unchanged.

## Verification

- `node --check` on all three new files: pass.
- New suite `pixel_map_views.test.js`: **47/47 pass**.
- Full sim suite `node --test tests/*.test.js`: **340 pass / 0 fail**
  (293 baseline + 47 mine).
- `git diff --check` clean; new files whitespace-clean (verified via
  intent-to-add, then reset — no git state left behind).
- Test coverage: realistic titanic-like 100-cluster set (24 ShehdsBar / 20
  VintageLed / 38 UkingPar incl. 2×10 chimney / 2 TeLedGrid40 / 16 LED
  strands); every selector type + union/AND/exclude/match-all;
  view_registry base+custom resolution; zero-match & unknown-view loud
  errors; sibling-panel isolation; full add/remove/duplicate lifecycle;
  fail-loud validation (10 cases); persistence round-trip; legacy migration;
  all 4 defaults instantiate and resolve cleanly.

## Gaps / notes for S4 (integration) and S1

- `view:` custom-view membership resolves by **group** only. The Views-Rehaul
  registry also supports per-fixture `viewMask` bits, but clusters don't
  carry `viewMask`; group-based custom views resolve fully, per-fixture-only
  views won't. Flag if a default/operator view needs per-fixture membership.
- Per-view placements are stored as plain objects in the container
  (serializable) and handed to the layout as a `Map` at `resolveView` time —
  matches the existing `seedLayout`/`clusterPixelPositions` Map convention.
- S4 owns first-open seeding (`seedDefaultViews`) + legacy migration wiring
  + the `params.pixelMapViews` persistence bridge (`toParams`); this slice
  provides the pure functions, no store/param writes.

## Files

- `simulation/src/gui/pixel_map/pixel_map_views.js` (new)
- `simulation/src/gui/pixel_map/pixel_map_view_defaults.js` (new)
- `simulation/tests/pixel_map_views.test.js` (new)
