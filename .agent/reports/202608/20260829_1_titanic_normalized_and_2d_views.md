# 2026-08-29 — titanic_normalized scene + all-dots 2D pixel views

Operator-directed session (Misha). Two deliverables, both landed in the
working tree (NOT committed — commit awaits an explicit operator call).

## 1. `titanic_normalized` scene — export-time coordinate normalization

- New scene duplicated from `titanic` via `POST /scene/duplicate`.
- New module `simulation/src/dmx/model_normalization.js`, hooked into
  `saveModelJS()` (export clones only — the live sim pixel list, in-browser
  pattern engine and 3D view keep as-built geometry). Recipe, operator-signed
  via an interactive prototype:
  1. LEVEL each half in place (frames fitted from the front/back wall
     ShehdsBar pixel LINES — they are collinear, plane fits are degenerate),
     shared heading, per-half ground settle.
  2. Z-ALIGN the right half (and right small stack) into the left half's band.
  3. X-CONDENSE both halves to a configurable inner-edge gap (default 2 m),
     small stacks following their halves. A full-roster Left_/Right_ group
     token vs x-sign audit throws at EXPORT time (the engine's auto_views
     would otherwise refuse the model at load).
- GUI: `Normalize Engine Export` checkbox + `Normalize X Gap (m)` slider under
  📦 Model Transform, persisted per-scene in `scene_config.yaml`.
- The 2D pixel map for the scene lays out on the SAME normalized coords via
  prototype-linked clones in `pixel_map_store.js` (live colors pass through).
- Model validated: walls level (7.6 m sag → 0.03 m), zero sign violations,
  nx dead zone (see memory `titanic_x_axis_dead_zone`) closed, roster/patches
  byte-equal to titanic, `scene_model_parity.cjs` PASS. `models/titanic.js`
  bytes untouched.

## 2. 2D pixel views — every LED, all round dots, no overlaps (both scenes)

- `expandFixturePitch` gained a `{ pitch, layout: 'line', direction? }` form:
  single evenly-pitched LINE (vintage = the 6 pendant heads), direction from
  the fixture's own projected axis, the group run (top view), or pinned
  `vertical` (elevations — pendants hang plumb). Legacy number form (2×3
  vintage grid) unchanged. Unit tests added.
- All `TYPE_STYLES` shapes are now `circle` (operator order: round dots only);
  upwash ellipses retired from the titanic-family views.
- `top_down` carries all 964 px; `front` = front surfaces + TE Sign 2 (sign 1
  is edge-on there — it lives in top_down + te_sign); NEW `back` view carries
  the back surfaces. Strands view line-expanded.
- Overlap status (numerically audited): front L/R, back L/R, te_sign panels
  ZERO overlapping glyph footprints (authored offsets separate the end-on
  auditorium row + small stacks). Irreducible residue, called out: 5 pairs at
  physical strand crossings (strands view) and the top_down strip look (5 cm
  bar LED pitch + edge-on signs cannot separate in a true projection at ship
  scale).
- Live Touch artifact regenerated; exporter + CaptainPad runtime know `back`
  (axis pair nx/ny). Mixer band fix: `computeBandCanvasSize`'s refinement now
  recognizes a BOUND-PINNED box (the Back view's ~4.3 aspect pins the box on
  the 72 px floor) as the settled answer instead of failing after 40
  iterations.

## Gates run

- Parity validator: PASS both scenes. Engine suite 4163/4166 (3 pre-existing
  Mac/env fails, see memory `engine-suite-on-mac-quirks`). Sim suite
  2709/2712 with the dev stack running (3 live-stack collisions: launcher e2e
  ×2 can't bind :6970, sACN double-join test defeated by live receivers —
  verified by isolated reruns). CaptainPad: full vitest 3066 pass / 6 skip,
  tsc clean. Browser geometry regression (operator sidecar, 2 viewports)
  green after pin refresh. Adversarial review workflow (21 agents) ran on the
  normalization change set; all 12 confirmed findings fixed.
- Pinned-contract updates that travel WITH this change: view id order +
  counts (964/470/420/320/148), 24 top_down groups, paint mask 940→866→(sign
  move) 866, upwash retired, measured mixer aspects, geometry totals 2322.

## 3. Live Touch rebound to `titanic_normalized` (late addition, same day)

The operator switched the engine to `titanic_normalized` and ordered the Live
Touch panel onto the normalized visual pixels. The WHOLE chain moved scenes:
`export_touch_control_pixel_views.mjs` (model import + scene paths + source
fields), the runtime's scene/model gates + source URLs
(`touch_control_pixel_views.js`), and the save-server refresh gates (all four
routes) now bind `titanic_normalized`. Display, brush space and the engine's
spatial effects all share the normalized coordinates — no hybrid.

One REAL fix fell out: the normalized model z-aligns both TE signs onto one
nz/ny band, so the te_sign brush would spill into the sibling sign panel.
`affectedPixelIndices` now takes the tapped `panelId` and scopes selection to
that panel (a stroke lives in ONE panel); `screenPointToTarget` exposes the
tapped panel. Pinned in the XS-brush test.

Also: an open titanic sim tab auto-saved its STALE in-memory views container
over `scenes/titanic/pixel_map_views.yaml` mid-session, silently reverting
the new views (caught by the geometry-regression gate). Restored; the
titanic top_down framing was dropped (auto-fit) since the operator framing
predated the all-LEDs content. **Reload any open sim tab after view-YAML
changes, or its next auto-save clobbers them.**

## Notes for the next session

- Section/fixture ids re-mint on every sim boot; a boot-only model export
  drifts from `patches.yaml` until the next full save (the new
  titanic_normalized parity test catches exactly this). Always 💾 save after
  opening the scene.
- Headless saves leak runtime residue (`lightingProfile: 2d_pixels` into the
  SHARED `common.yaml`, `maxSpotlights: 0`, zeroed modelTransform) — check
  those three after any puppeteer-driven save.
- Live Touch on the physical iPad will look different: a fifth "Back" view,
  all-LED Top-Down, round separated dots — intended, re-acceptance needed.
