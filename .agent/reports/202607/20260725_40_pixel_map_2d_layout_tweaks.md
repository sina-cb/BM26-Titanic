# 20260725_40 — 2D Pixel Map: chimney par rings moved onto their cluster, beefier bar segments

**Scope:** two operator-requested visual fixes in the simulation's 2D Pixel Map
(`simulation/src/gui/pixel_map/`), verified live against the titanic scene and
regression-checked against test_bench.

**Operator request (annotated screenshots):**

1. In the Top-Down view, the fixtures drawn as **rings of ~10 small round dots**
   sit far off to the **right** of the two LED clusters. Each ring was circled
   and joined by a line to the hub of its cluster: *the rings belong at the
   centre of the cluster they crown.*
2. In the close-up of a dashed bar row, an arrow at a single segment: *make the
   LED bar segments a bit wider* — beefier rectangles, modestly.

---

## 1. What the two "rings" actually were

Reproduced exactly at `?scene=titanic&profile=2d_pixels` (before shot below).
The rings are the **two 10-par chimney groups**, `Left Top Chimney Generator`
and `Right Top Chimney Generator` (`UkingPar` ×10 each). They were rendered by a
**separate `stacks` panel** in the shipped `top_down` default view — a
`weight: 1` `radial` panel that got the right quarter of the pane, next to the
`weight: 3` `main` "Bars + Strands" panel.

The clusters the operator circled are the smoke stacks themselves: four LED
strands fanning out from each stack, flanked by two `ShehdsBar` rows.

Live world geometry (probed from the running sim's `_batchRenderList`):

| | world x | world z |
|---|---|---|
| Left chimney par ring | −24.88 … −19.69 | 5.79 … 11.52 |
| Left strand fan | −31.5 … −13.5 | 3.8 … 13.5 |
| Right chimney par ring | 20.53 … 25.97 | −11.64 … −6.14 |
| Right strand fan | 13.5 … 33.6 | −18.1 … 0.4 |

**Each par ring is already, physically, dead inside its strand fan.** The
operator's request is not a request to fake a position — it is a request to stop
faking one. The `radial` panel re-normalised the pars' world coordinates into
its own little box, which is what threw them out to the right.

## 2. Mechanism chosen — and why not the alternatives

**Chosen: put the chimney pars into the SAME `spatial` panel as everything
else, and delete the `stacks` panel.**

`expandPanel` treats `spatial` as a **whole-panel TRUE world projection**
(`projectedPanelPixels(..., 'fit')`): every pixel is placed at its real
projected world position, scaled once for the whole panel. So the moment the
pars join that panel they land at their real top-down position — a ring centred
on its cluster — with nothing to keep in sync and nothing that can drift.

Two properties made this safe rather than merely convenient:

- The pars' world extents are **strictly inside** the strands' extents, so the
  panel's aspect-preserving fit box is unchanged. Nothing else on the view moves.
- With the second panel gone the single remaining panel gets the whole pane, so
  the whole map also reads larger.

Alternatives considered and rejected:

- **A per-fixture 2D placement override** (`view.placements`, which does persist
  and is scene-scoped). Rejected: for a `spatial` panel `expandPanel` ignores
  `placements` entirely — placements only drive the `radial`/`lanes` anchor+line
  model. Forcing it would have meant demoting the panel to an editable layout
  and hand-placing 20 pars, i.e. hard-coding a copy of a truth the projection
  already computes, which then rots the first time a stack moves in the scene.
- **A "centre this fixture type on its group" rule** in the layout math. Rejected
  as a special case that lies about 3D in the general case — and unnecessary,
  since the honest projection already produces the requested picture.

**Persistence / scoping.** The change is to the shipped default view definition
(`DEFAULT_VIEWS`), which is re-seeded deterministically on every open of a scene
that has no persisted `pixelMapViews`. No scene in the repo has one, so it
applies everywhere immediately and survives reload. Views stay fully editable
data — an operator edit still wins and still persists per scene via
`params.pixelMapViews`.

**One tuning knob was needed.** At whole-ship scale a 10-par ring is only ~68
design units across, so the shipped 24-unit `UkingPar` disc fused the ring into
a solid donut. That is handled with the existing **per-view `typeStyles`**
affordance — `top_down` carries `UkingPar: { sizeX: 13, sizeY: 13 }`, so the
par disc shrinks **on this view only**; every other view keeps the full-size par
(verified on the `front` view, which is untouched).

## 3. Bar segments

`TYPE_STYLES.ShehdsBar` `sizeX`/`sizeY` **13 → 17** (+31 % linear) in
`pixel_map_layout.js`. Uniform, so bar pixels stay square and a bar reads
thicker at **any** rotation; the size is in design units, so it scales with zoom
instead of being a fixed screen weight. In `spatial`/`planar` layouts a bar's
*length* comes from world coordinates, so this is a thickness change with only
~4 design units of extra end-cap. No other glyph type was touched — strand dots
(7), TE-sign dots (7), vintage (15) and the par disc are all unchanged.

## 4. Files changed

| File | Change |
|---|---|
| `simulation/src/gui/pixel_map/pixel_map_view_defaults.js` | `top_down` is now ONE `spatial` panel selecting bars + strands + both chimney groups; `stacks` panel removed; per-view `typeStyles` for `UkingPar` |
| `simulation/src/gui/pixel_map/pixel_map_layout.js` | `ShehdsBar` `sizeX`/`sizeY` 13 → 17 |
| `simulation/tests/pixel_map_views.test.js` | the test that pinned the two-panel `top_down` now pins the one-panel spec (panel ids, layout/projection, 24+16+20 clusters, both rings present, deck pars NOT dragged in by the group selectors, the per-view par style) |

## 5. Visual verification

Captured through the puppeteer renderer per `.agent/skills/see_the_world.md` —
a **fresh browser per run, closed at the end**, as a browser client of the
operator's live `:6969` only; his stack was never restarted. Adapter recorded on
every run: `ANGLE (NVIDIA GeForce RTX 4090 Laptop GPU, D3D11)`,
`integrated: false`, `detectionFailed: false`.

Screenshots in `~/tmp/pixel_map_2d_tweaks/` (`_full` = whole pane, `_leftcluster`
/ `_rightcluster` = 2× close-ups):

| | Before | After |
|---|---|---|
| titanic Top-Down | `before_titanic_top_down_1785341286_*.png` | `after_titanic_top_down_1785341448_*.png` |
| test_bench Top-Down | `before_test_bench_top_down_1785341552_*.png` | `after_test_bench_top_down_1785341506_*.png` |
| titanic Front (sanity) | — | `after_titanic_front_1785341751_*.png` |

Inspected, and they show:

- **titanic, before** — the operator's picture exactly: two clusters on the
  left/centre, two rings of small dots stranded at the far right of the pane.
- **titanic, after** — each ring now sits as a clean ring of ten separated dots
  at the hub of its own cluster; bar segments visibly chunkier; strand dots
  unchanged; the map fills the pane.
- **test_bench, before** — the `stacks` panel had nothing to select there, so a
  quarter of the pane was a red error banner: *"Smoke Stacks: Panel 'stacks': no
  fixtures match its selectors (group=Left Top Chimney Generat…)"*.
- **test_bench, after** — banner gone, single full-width panel, two bars beefier,
  16 strand dots per row unchanged. Strictly better; the chimney group selectors
  simply match nothing there and the panel still resolves on bars + strands.
- **titanic Front** — renders normally, no par rings (correctly not selected),
  par disc unaffected by the top_down-scoped `typeStyles`.

## 6. Tests

`cd simulation && npm test` → **721 / 721, 0 fail** immediately after the code
change — the stated baseline, held exactly.

### Pre-existing defect surfaced afterwards (NOT from this change) — needs the operator

A later re-run showed **719 / 2**. The two failures are in
`tests/scene_model_parity.test.js` and are unrelated to the pixel map (that test
imports none of it). Cause: **opening the `test_bench` scene in the sim
re-exports `marsin_engine/models/test_bench.js`**, and my verification run did
exactly that. The re-export surfaced a **sId/fId collision in the current
uncommitted test_bench scene**:

```
drift/metadata_drift — fixture 'TE Sign V3 A'
       model metadata ≠ patches.yaml: sId 7 ≠ 5; fId 13 ≠ 11
drift/metadata_drift — fixture 'TE Sign V3 B'
       model metadata ≠ patches.yaml: sId 7 ≠ 5; fId 14 ≠ 12
```

The working-tree `scenes/test_bench/scene_config.yaml` gives the two LED strands
`sectionId 5/6, fixtureId 11/12` — the very ids `patches.yaml` still assigns to
TE Sign V3 A/B. The exporter therefore renumbers the sign to sId 7 / fId 13,14,
and the validator correctly calls the drift. This is the R8 slice-1 territory
(`20260725_34`).

**Not repaired here, deliberately.** Which ids should win is an operator mapping
decision, `marsin_engine/models/test_bench.js` also carries uncommitted operator
work (so `git checkout` would destroy it), and the codex forbids hiding a test
side effect. Reported instead. Repair is: settle the id assignment in
`scene_config.yaml` / `patches.yaml`, re-save the scene, then
`node simulation/tools/scene_model_parity.cjs test_bench` until green.

## 7. Operator action

**Reload the 2D Pixel Map view** (the sim serves `src/` from disk, so a browser
reload picks both fixes up — no server restart). Nothing else.
