# 2026-07-29 — 2D Pixel Map: operator's three view orders (front / top-down / TE sign) — `_48`

Operator-ordered batch, relayed by the coordinator from three screenshots Sina
reviewed of the **titanic** scene's 2D Pixel Map. Opus implementer. **Zero
writes to `scenes/**` or `models/**`** — every live check was a triple-guarded
browser client of his already-running `:6969`; his stack was never restarted and
no port was bound by me.

---

## 0. TL;DR

| Order | What shipped |
|---|---|
| **Front view: only the front lights + the front smoke-stack ropes, and make the pixels readable** | Membership cut from "all bars + all vintage" (41 clusters, front AND back of the ship) to the **8 front groups** (22 clusters): the front bars, the front vintage lights, and **the four front smoke-stack ropes, two per side** (revised — see §9). Split into **one panel per side of the ship**, which is what fixes the framing: content fill went from **93 % × 24 %** of the panel to **74 % × 88 %** (port) and **57 % × 88 %** (starboard), and the design scale from **13.9 → 37.0 / 36.4 design units per world unit (~2.7×)**. |
| **Top view: room for the pars, pars individually, add the two small smoke stacks** | (a) strand dots shrunk **7 → 4** on this view only, so a strand is a thin line instead of a 7-wide ribbon; (b) new **paint order** in the projection — many-pixel runs first, single-pixel fixtures last — so a par sitting on a strand in the top-down projection is no longer swallowed by it; (c) **both small smoke stacks added**, each a 4-par ring that reads as a small circle. Plus the 12 orphan duplicates excluded. No restructuring — it is still one true top-down projection. |
| **TE sign: rotate 90° CCW** | New per-panel `rotate` (0/90/180/270, CCW) on TRUE projections. `te_sign` carries `rotate: 90`. The shape's extreme point moved from bearing **−177° (pointing left)** to **−87° (pointing down)**, and its width/height from **1.37 → 0.73** — a clean quarter turn, measured, not eyeballed. |

**Suite: 903 tests / 895 pass / 8 fail — the SAME 8 known failures as the
baseline, zero new.** Parity CLI verdicts byte-unchanged (titanic
`192 error / 0 warning / 9 info`, test_bench `4 / 0 / 1`). Newest `scenes/**`
mtime is **13:46**, the operator's own save — an hour older than this session,
and unchanged across every browser run.

---

## 1. Group classification — how "front" was decided

Not from the names. Read live off the running sim (`store.list` → the real batch
render list) and cross-checked read-only against `scenes/titanic/scene_config.yaml`.

The titanic's two halves are not axis-aligned with each other, so "front" is a
**+z** relation within each side:

| | port / left | z | starboard / right | z |
|---|---|---|---|---|
| **front bars** (ShehdsBar ×5) | `Left Front Wall` | +16.1 | `Right Front Wall` | −6.0 … +1.9 |
| back bars | `Left Back Wall Generator` | +1.1 | `Right Back Wall Generator` | −17.9 … −9.9 |
| **front vintage** (VintageLed ×4) | `Left Front Deck Generator` | +13.5 … +13.8 | `Right Front Rails` | −7.6 … −2.0 |
| back vintage | `Left Back Deck Generator` | +3.4 | `Right Back Deck Generator` | −15.3 … −9.4 |
| **front LED string** | `Left_Front_Left` | +10.0 … +13.5 | `Right_Front_Right` | −11.3 … −10.6 |

**The strand choice is the one real judgment call — and the operator corrected
it (see §9).** Each side has TWO strands named "Front"; I originally read
"2 lines … on each side" as one per side and shipped only the hull drops. He
meant **two per side, four in total — the front smoke-stack ropes**. The pair
per side is told apart by vertical span, and BOTH are now included:

| strand | y span | what it is |
|---|---|---|
| `Left_Front_Left` | 2.5 → 12.5 (**10.0**) | drops down the front hull face — a LINE in a front elevation |
| `Left_Front_Right` | 12.6 → 14.8 (2.2) | runs flat along the deck top — a top-down feature, invisible edge-on |
| `Right_Front_Right` | 2.1 → 12.6 (**10.5**) | hull drop |
| `Right_Front_Left` | 12.4 → 14.6 (2.2) | deck run |

Both members of each pair are smoke-stack ropes and both read as lines in a
front elevation — the drop as a steep line down the hull face, the deck rope as
a long shallow line from the stack top to the deck edge. §9 records how the
four are now re-derived from the geometry.

LED strands carry no `group` in the scene YAML; their effective group key is the
strand NAME (`led_metadata.groupKeyForStrand`), which is what the batch list and
`views.yaml` groupBits both use — so `{ group: 'Left_Front_Left' }` is the exact,
robust selector.

**Orphans, confirmed independently.** `Left Back Wall` (5 ShehdsBar) and
`Left Center Auditorium` (7 UkingPar) — the 12 the coordinator flagged — sit at
coordinates *identical* to `Left Back Wall Generator` and `Left Auditorium`, and
they are the only two groups in the scene with **no generator trace** backing
them (`parLights.traces` lists all 14 others). They are excluded from `top_down`
and cannot reach the new `front` panels (which name their groups explicitly).
**They are not deleted from the scene — that is Sina's call**; a test asserts
they are still orphans, so if he removes them the excludes can go too.

---

## 2. Front view — why two panels

The single-panel front elevation was not "badly framed", it was **geometrically
impossible to frame**: the two halves stand ~50 world units apart with nothing
drawn between them and are only ~10 units tall, so the projected cloud is
60 × 9. `spatial` fits aspect-preserving on purpose (it must not distort), so it
pinned the whole rig into a band **93 % wide × 24 % tall** with three quarters of
the pane empty — exactly Sina's screenshot.

Per side the aspect is sane: port 18.0 × 12.3 (0.68) and starboard 14.1 × 12.5
(0.89), against the design canvas' own 900 × 520 (0.58). One panel per side
therefore fills its half of the pane, and the measured design scale goes
**13.9 → 37.0** (port) / **36.4** (starboard) design units per world unit —
**~2.7×**. On screen, including the pane's own letterboxing of two half-width
sub-rects, the port cluster went from ~310 px wide to ~630 px with the whole
vertical band now in use.

Each panel is still a TRUE, undistorted front elevation of its own side. What is
given up is the two sides' relative left/right offset — and there was never
anything drawn in that gap to lose.

Rejected alternatives: dropping aspect preservation (a distortion lie, and it
would hit every spatial view); a `lanes` layout (throws away the elevation the
operator asked for); leaving one panel and only cutting membership (removing the
back-of-ship fixtures barely moves the x span — the two halves are what set it).

---

## 3. Top-down view — three surgical changes, no restructuring

He said it "looks good", so the panel, the projection and the composition are
untouched. Measured on the live scene, before → after:

| | before | after |
|---|---|---|
| clusters | 49 (25 bars incl. 5 orphans + 8 strands + 16 chimney pars) | 52 (20 bars + 8 strands + 16 chimney pars + **8 small-stack pars**) |
| par ⟷ nearest other pixel | 1.1 design units | 0.8 |
| par ⟷ nearest par | 24.4 | 13.0 (the small stacks' own ring — tangent at Ø13, not overlapping) |
| orphan duplicates drawn | yes | no |
| design scale | 12.8 / world unit | 9.2 / world unit |

**(a) "make some room for the par lights to fit nicely in the middle of the LED
strands."** The strands' pixels are ~1 design unit apart at this scale, so the
shipped 7-unit dot drew each strand as a solid 7-wide ribbon that filled the
space the rings sit in. Per-VIEW `typeStyles.LedStrand` is now `4` — still a
continuous line (spacing 1.1 ≪ 4), just a much thinner one. **Nothing moved.**
Every other view keeps the 7-unit strand dot.

**(b) "make the par light LEDs show individually and not overlap much."** Each
UkingPar is a SINGLE pixel, and the ring pars are ~20 design units apart at Ø13
— they were never overlapping *each other*. The real defect was **occlusion**:
the chimney pars physically sit inside the strand fan that hangs off the same
stack (some within **0.05 world units** of a strand pixel in plan — they are
metres apart in Y, only the top-down projection stacks them), and in batch order
the 40-pixel strand ribbon painted LAST and swallowed them. His ring of eight
read as three or four dots. `pixel_map_layout.js` now sorts a projected panel's
clusters by **descending pixel count (stable)** before emitting, so many-pixel
runs paint first and sparse fixtures paint last. Occlusion only — every pixel
keeps its true projected position, and equal counts keep their batch order.

**(c) "add the two small smoke stacks … each as a small circle."**
`Left Small SmokeStack` / `Right Small SmokeStack`, 4 pars each on a ~1-unit
world ring. At the resulting scale their four Ø13 discs land 13.0 apart —
tangent, so each stack reads as one small circle of dots, which is exactly what
he asked for.

**Honest cost, stated plainly:** the small stacks stand well outboard (left
x ≈ −46, right x ≈ +42, against a hull spanning −31…+34), so including them in
the same TRUE projection widens it from 65 to 90 world units and **shrinks
everything else by ~28 %** (scale 12.8 → 9.2). The alternative — a side panel
for them — is precisely the lie report `_40` removed for the chimney rings, so
it was not taken. The thinner strands more than pay the legibility back; if Sina
would rather have the scale, the fix is his call (drop them, or accept a second
panel that misplaces them).

---

## 4. TE sign — the quarter turn, and the mechanism

The sign hangs on a **vertical plane** at x ≈ −15.5, so its two widest world axes
are **Y (2.16)** and **Z (1.59)**. `planar` picks the widest axis first, which put
**world-up along screen-X** — i.e. the logo was drawn lying on its side. That is
why it read "rotated wrong".

New optional panel key **`rotate`** (`0 | 90 | 180 | 270`, degrees
COUNTER-CLOCKWISE), applied inside the TRUE projection:

```js
// screen X grows with u, screen Y grows as v shrinks → a CCW turn is
(u, v) → (−v, u)          // rotateProjected(), pixel_map_layout.js
```

The fit box is recomputed on the rotated coordinates, so the panel still fills
the canvas with the new aspect. Schema-validated in `pixel_map_views.js`:
non-quarter-turns throw, and `rotate` on `radial`/`lanes` throws (those place
fixtures from per-fixture anchors — a whole-panel orientation is meaningless
there, so it fails loud rather than being silently ignored). It round-trips
through `toParams`, so an operator edit persists.

Measured on the live sign: extreme-point bearing **−177° → −87°** and
width/height **1.37 → 0.73**. In the screenshots the shape's tip moves from
pointing LEFT to pointing DOWN — a 90° counter-clockwise turn, as ordered.

---

## 5. Files

Source (all agent-owned, `simulation/src/gui/pixel_map/`):

- `pixel_map_view_defaults.js` — rewritten defaults + six new exported group
  constants (`SMALL_SMOKESTACK_GROUPS`, `FRONT_BAR_GROUPS`,
  `FRONT_VINTAGE_GROUPS`, `FRONT_STRAND_GROUPS`, `ORPHAN_GROUPS`, alongside the
  existing `CHIMNEY_GROUPS`) so every hardcoded name is one asserted constant.
- `pixel_map_layout.js` — `rotateProjected()` + `PANEL_ROTATIONS`, the
  `byPaintOrder()` paint-order rule, both threaded through
  `projectedPanelPixels` / `expandPanel`.
- `pixel_map_views.js` — `rotate` in the panel schema (`ROTATIONS`,
  `ROTATABLE_LAYOUTS`), validation, normalization, persistence.

Tests:

- `tests/pixel_map_view_defaults.test.js` — 6 new (small stacks exist and are
  4 pars; every Front group exists; the front classification really is the
  front, by z; each front string is the hull drop, by y-span; the 12 orphans are
  still orphans and still excluded; the Front view names exactly six groups, one
  panel per side).
- `tests/pixel_map_views.test.js` — a second synthetic rig (`DCL`) built from
  the exported constants and speaking the REAL titanic group vocabulary; the
  top_down / front / strands / te_sign default tests re-pointed at it; `rotate`
  validation + persistence round-trip.
- `tests/pixel_map_layout_expansion.test.js` — 4 new (90° CCW is rigid: every
  pairwise distance preserved up to one uniform re-fit factor, and +x really
  runs UP not DOWN; 0/180/270 compose and junk throws; sparse fixtures paint
  after dense runs; paint order is stable for equal counts).

Harness:

- `agent_tools/pixel_map_view_tuning_verify.cjs` (NEW) — screenshots all three
  views, dumps the resolved-view facts (membership, fill fractions, par spacing,
  orphan/small-stack presence, TE-sign bearing) to JSON, and has a
  `--legacy-views` mode that re-injects the PRE-TUNING view definitions **as
  data** so before/after captures are framed identically.

---

## 6. Verification

**Suite** (`cd simulation && npm run check`): **903 / 895 / 8**. The 8 are the
known set from `_46` §1 — the operator's stale `models/titanic.js` export plus
the one owed test_bench sim-save — and none of them imports a module this work
touches:

```
fixtures are docked beside the ship, not left inside the hull
the real titanic scene can accept the block today (no collisions)
view-bit headroom is REPORTED — titanic is close to the 31-bit ceiling
CLI: default emit against the real scenes exits 0 and reports parity=absent
CLI: --require-applied fails (exit 3) while Phase B has not applied the block
real scene test_bench: the model is a faithful export of the scene
real scene test_bench: every remaining error is a known open mapping defect
real scene titanic: the model is fresh and complete, and 0% electrically mapped
```

**Sim auto-checks** (`.agent/ops/sim_auto_checks.md`): `git diff --check --
simulation` clean; `node --check` on every changed/added JS file passes;
`npm run check` as above; parity CLI byte-unchanged on both scenes (no scene or
model file was changed, so the gate is informational here).

**Scene-write gate**: the harness runs with `params.autoSave = false`,
`window.debounceAutoSave` stubbed, and every `:6970` request aborted at the
network layer — **0 save requests were even attempted** on any run. The newest
`scenes/**` / `models/**` mtime is `13:46` (the operator's own save), unchanged
across all four browser runs.

**GPU adapter**, recorded next to every observation per `_39`:
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`,
`integrated: false`, `detectionFailed: false`. Software GL — no FPS number is
claimed here; these are layout observations only.

**Screenshots** (`~/tmp/pixel_map_views/`), all inspected by me:

| Path | What it shows |
|---|---|
| `before_clean_front.png` | the operator's complaint exactly — two small distant clusters in a thin band, most of the canvas empty, back-of-ship fixtures included |
| `after_front.png` | two panels, one per side; front bars + vintage + one dotted LED string each; content filling both halves |
| `before_clean_top_down.png` | fat strand ribbons swallowing the par rings (only ~4 of 8 dots visible per ring), no small stacks, orphan bars doubled |
| `after_top_down.png` | thin strand lines, all 8 pars visible per ring, both small smoke stacks as small 4-dot circles at their true outboard positions |
| `before_clean_te_sign.png` | the logo lying on its side, tip pointing LEFT |
| `after_te_sign.png` | the same logo turned 90° CCW, tip pointing DOWN |
| `before_front.png`, `before_top_down.png`, `before_te_sign.png` | the very first captures, taken against pristine code with the operator's own live banners visible (`UNSAVED CHANGES`, `ENGINE MODEL STALE`, Lighting Controls) — kept as the unaltered baseline |
| `before_facts.json`, `after_facts.json` | the measured numbers quoted throughout this report |

---

## 7. Honesty notes

- The `before_clean_*` captures revert the view **data** only; the layout
  module's new paint order is still in effect in them. The `before_*` captures
  (first run, pristine code, chrome visible) are the fully unaltered baseline.
- Adding the small smoke stacks shrinks the rest of the Top-Down view by ~28 %.
  That is a real, unavoidable cost of drawing them where they actually are, and
  it is Sina's to accept or reverse — see §3.
- A par can still land within a design unit of a strand pixel in plan (0.8 after
  the change). That is the true projection; the fix makes it *legible* (thin
  line over a Ø13 disc, disc painted last), it does not and should not move
  anything apart.
- Individual pixels **within** a bar are still not separable on the Front view:
  a bar's 18 LEDs occupy 0.8 world units, so at whole-side scale they are ~2
  design units apart. Separating them would need distortion. What the two-panel
  split buys is that a bar now reads as an elongated bar rather than a blob.
- Zero Notion cards filed — no Notion MCP tools in this session, same gap as
  `_43`/`_44`/`_46`.
- **The Front view is now titanic-only, on purpose, and says so out loud.** It
  names the titanic's six front groups (that IS the operator's spec — the front
  lights, not "every bar"), so on `test_bench` — whose whole DMX rig is
  `BarLights`/`ParLights`/`VintageLights`/`TE Sign` — both panels match nothing
  and the pane paints two red banners naming the selectors that resolved to
  zero. Previously it selected by fixtureType and showed test_bench's 2 bars +
  2 vintage. This is a real, deliberate trade: a loud error beats drawing the
  stern on the Front view of the ship that matters. Pinned by a test
  (`the Front view fails LOUDLY`) so it is a decision, not a surprise, and the
  Top-Down view is explicitly asserted to STILL resolve on a bench-shaped rig
  (its bar/strand selectors are type/kind based). test_bench was **not opened**
  in the sim to check this — opening it re-exports `models/test_bench.js`
  (report `_40` §6) and that is exactly the drift the owed sim-save is about.
- The `stacks`-panel mock in `agent_tools/pixel_map_capture.cjs` still names a
  two-panel `top_down`; it is a synthetic shell-capture harness with its own
  fake views and does not read the defaults, so it was left alone.

## 8. Operator action

**Reload the 2D Pixel Map** (the sim serves `src/` from disk — a browser reload
picks all three changes up, no server restart). Then two calls are yours:

1. Keep the two small smoke stacks in the Top-Down view at the cost of ~28 %
   scale, or drop them?
2. ~~The 12 orphaned fixtures (`Left Back Wall 1-5`, `Left Center Auditorium
   1-7`) are duplicates with no generator trace.~~ **HALF RESOLVED 2026-07-30 —
   see addendum 3.** You had the 5 `Left Back Wall` ghosts deleted and your real
   generator renamed onto that name; `ORPHAN_GROUPS` has been updated so your
   real back wall is drawn again. `Left Center Auditorium 1-7` are still in the
   scene, still untraced, still excluded from the views — deleting those is
   still yours.
3. **Re-export `models/titanic.js` and restart the engine.** The scene fix moved
   the scene out from under the export, so the parity validator now reports
   337 errors instead of 192. Nothing in the sim caused that and nothing but a
   re-export clears it.

---

## 9. Addendum (same day) — operator correction: FOUR front ropes, not two

**What he said.** My first pass read "2 lines for the LED strings in the front,
one on each side" as *one line per side*. The correction, relayed by the
coordinator: he means **2 per side = 4 total — the front smoke-stack ropes**.

**The four, and how they were picked.** Not by the word "Front" in a strand's
name. The titanic's two halves are rotated relative to each other, so there is
no single world axis meaning "forward": the left walls run along x at a constant
z, the right walls run diagonally. Each side's forward direction is taken from
the scene itself — **(that side's front-wall centroid − its back-wall centroid)
in the x/z plane** — and every strand's midpoint is projected onto it:

| side | forward axis (x, z) | ranked forward → |
|---|---|---|
| left | (−0.018, +1.000) | **Left_Front_Left 12.31** · **Left_Front_Right 12.10** ‖ Left_Back_Left 6.28 · Left_Back_Right 5.80 |
| right | (+0.615, +0.789) | **Right_Front_Left 10.63** · **Right_Front_Right 10.48** ‖ Right_Back_Right 4.50 · Right_Back_Left 4.31 |

The front pair separates from the back pair by **≥ 5.8 units on both sides** —
no ambiguity, and it agrees with the names without relying on them.

**The pair is not two of a kind, and both belong.** Per side one rope is the
**hull drop** (y 2.1 → 12.6, hanging down the front face) and one is the **deck
rope** (y 12.4 → 14.8, running 7–12 world units inboard from the stack top to the
deck edge). My original judgment call kept only the drops on the grounds that a
2.2-unit y span "isn't a line in a front elevation" — **that was wrong**: the
deck rope's length lives in *x*, so in an x/y elevation it draws as a long
shallow line, clearly visible in the recaptured screenshot. Both are ropes to the
smoke stack, and he wants both.

**Code.** `FRONT_STRAND_GROUPS` is now a per-side pair
(`[['Left_Front_Left','Left_Front_Right'], ['Right_Front_Right','Right_Front_Left']]`,
indexed to match `FRONT_BAR_GROUPS` / `FRONT_VINTAGE_GROUPS`), and each Front
panel selects 4 groups instead of 3.

**Effect on framing.** Adding the deck ropes widens each side and, more
importantly, raises the top (they sit at y ≈ 14.8, above the bars' y ≈ 10.4), so
both panels become height-limited: port 18.0 × 12.3, starboard 14.1 × 12.5.
Design scale **45.5 / 43.3 → 37.0 / 36.4** per world unit, i.e. the improvement
over the single-panel original is **~2.7×** rather than 3.3×. Fill: port
**74 % × 88 %**, starboard **57 % × 88 %**. Still the whole point of the split —
the original was 93 % × 24 %.

**Tests.** The old `each front LED string is the HULL drop, not the deck run`
pin is **replaced** — it encoded the wrong ruling — by two stronger ones:

- `the four front ropes are re-derived from each side's own forward axis` —
  recomputes the entire classification from `scene_config.yaml` (wall centroids
  → per-side forward axis → strand-midpoint projection → rank) and asserts the
  top two per side are exactly what the view selects, **plus a > 3-unit margin**
  so a small geometry nudge cannot flip it silently.
- `each side's rope pair is one hull drop + one deck rope` — asserts each pair
  really is one of each (y span > 5 and < 5), so dropping one kind is a red test.
- `the Front view carries FOUR smoke-stack ropes, two per side` — pins the shape
  of the constant itself.
- `the Front default view names exactly the eight front groups…` (was six), and
  the synthetic-rig resolution test now expects **11 clusters per panel / 22
  total, 4 LED ropes**, and asserts none of the four BACK ropes can appear.

**Verification.** Suite **903 / 895 / 8** — the same 8 stale-model failures,
zero new (was 901/893/8 before this change; +2 tests). Parity CLI byte-unchanged
(titanic `192 / 0 / 9`, test_bench `4 / 0 / 1`). Newest `scenes/**` mtime still
**13:46**, the operator's own save; 0 save requests attempted on the recapture
run. GPU adapter unchanged (SwiftShader, `integrated: false`).

**Screenshot.** `~/tmp/pixel_map_views/after_front.png` — recaptured at the same
1440 × 900 framing, inspected. Each panel now shows **two dotted rope lines**: a
steep hull drop on the outboard edge and a long shallow deck rope across the top
running toward the stack, plus the 5 front bars and 4 front vintage lights.
`before_clean_front.png` is unchanged and still the correct baseline.

---

## 10. Addendum 2 (same day, 16:50) — his rename batch broke the defaults again (recurrence #3)

Triggered by the Left-Back-Wall debug session (`20260725_51` §6). Between 16:25
and 16:38:58 the operator renamed **13 of his 14 generators** and added a second
TE sign. Read-only re-audit of every hardcoded name in the pixel-map defaults
against the `16:38:58` save (the newest on disk when this started):

| Constant | was | live @16:38:58 | action |
|---|---|---|---|
| `CHIMNEY_GROUPS[0]` | `Left Top Chimney Generator` | **gone** → `Left SmokeStack` | **re-pointed** |
| `CHIMNEY_GROUPS[1]` | `Right SmokeStacks` | ok | — |
| `FRONT_VINTAGE_GROUPS[0]` | `Left Front Deck Generator` | **gone** → `Left Front Rails` | **re-pointed** |
| `FRONT_VINTAGE_GROUPS[1]` | `Right Front Rails` | ok | — |
| `FRONT_BAR_GROUPS` | `Left/Right Front Wall` | ok | — |
| `FRONT_STRAND_GROUPS` (4) | strand names | ok — strands were not renamed | — |
| `SMALL_SMOKESTACK_GROUPS` | `Left/Right Small SmokeStack` | ok | — |
| `ORPHAN_GROUPS` | `Left Back Wall`, `Left Center Auditorium` | present | **untouched — gated** on his orphan decision (Open Decisions 11/12) |

Live effect before the fix: the **left chimney par ring** and the **left front
vintage lights** resolved to 0 clusters and were missing from the Top-Down and
Front views. Both are back.

**Re-verified against his NEXT save.** He saved again at **16:54:30** while this
work was in flight (not me — the harness aborts every `:6970` request at the
network layer and reported **0 attempted** on both runs; all four
`scenes/titanic/*.yaml` carry that one identical timestamp, which is what a
single operator save looks like). Every one of the **16** hardcoded names the
pixel-map defaults now carry — 2 chimney, 2 small stacks, 2 front bar, 2 front
vintage, 4 front ropes, 2 TE sign, 2 orphan — was re-audited against that newer
save: **0 stale**. `Left Back Wall Generator` is still present, so `ORPHAN_GROUPS`
remains correct and stays untouched. The suite reads the scene at runtime, so the
final 980/972/8 run already validated against `16:54:30`, not `16:38:58`.

### A second breakage the audit turned up: `TE Sign 2`

The same save added a full second sign (`TE Sign 2`, a `TeSignV3A40`+`B34` pair
at x ~ +17.9, z ~ -4.3). The `te_sign` view selected purely by **fixtureType**,
so it silently swallowed both signs into ONE `planar` panel — and `planar` scales
by true world **cell** size, never fit-to-canvas (that is what makes a single logo
render at honest size). Two signs 34 world units apart therefore blew the panel
to **2.69x the canvas width and 11.07x its height**: the view was rendering
almost entirely off-screen. Measured, then fixed with **one panel per sign**
(`sign_1` / `sign_2`, each `planar` + `rotate: 90`, selecting group AND
fixtureType), which restores honest per-sign scale while keeping each sign's
interlocking A/B halves in the shared frame `planar` exists for:

| | before | after |
|---|---|---|
| panels | 1 (both signs) | 2 (one each) |
| fill | **2.687 x 11.073** | 0.170 x 0.401 and 0.171 x 0.490 |
| rotation | — | bearing -87 deg and -88 deg (both quarter-turned) |

`top_down` and `strands` exclude by fixtureType, so they were right about the
second sign from day one — verified, not assumed.

### Tests: kept, re-pointed, and taken off the treadmill

The by-name tripwires did their job (they are what went red), so they are kept
and re-pointed. Three further changes so this file stops being collateral damage:

- **The tests' own back-of-ship reference points are no longer literals.** They
  used to name `Right Back Wall Generator` / `Left|Right Back Deck Generator` —
  all three went stale in that one batch. The forward-axis and front/back checks
  now find each counterpart **structurally**: trace-backed groups of the same
  fixture type, on the same side (sign of mean world x). Only the constants
  actually under test are still spelled out, which is the point.
- **`the front classification really is the FRONT of the ship` was replaced** by
  `the front bars and the front vintage lights agree on which end is forward` —
  it measures the forward direction twice per side (once from the bar pair, once
  from the vintage pair) and requires the two to agree, so it is a real
  non-circular check that needs no back-of-ship name at all.
- **New pins**: `both chimney rings name the CURRENT operator groups, not retired
  ones` (which also asserts no default view anywhere still reaches for any of the
  four retired names), and `every TE sign group exists, and each gets its own
  planar panel` (which also fails if a sign exists in a group the view never
  names — so a *third* sign is a red test, not another off-canvas surprise).

Correction to `_51` follow-up #2: the orphan tripwire's `scene.parLights.traces`
read is **not** dead. `scene.traces` and `scene.parLights.traces` are the same
list — a YAML anchor (`&ref_0`) and its alias — so the assertion did resolve and
does fire. It is now read defensively (`scene.traces || scene.parLights.traces`,
key `groupName || name`) so a future anchor move cannot make it vacuous, and it
asserts loudly if the trace list ever reads empty.

### Durable options for name drift — DESIGN ONLY, the operator decides

Three reports have now chased this same class (`_46` right ring, `_48` left ring
+ left vintage, and the `_51` diagnosis). **The specific reason all three went
unnoticed for hours is narrower than "hardcoded names", and worth naming:**
`resolvePanel` only raises its loud error when a panel matches **ZERO** clusters.
Top-Down also selects all bars and all strands, so when the chimney selector went
stale the panel still matched 40-odd clusters and **nothing fired at all** — no
banner, no console line. A *partially* stale panel is completely silent today.

| # | Option | What it does | Effort | Verdict |
|---|---|---|---|---|
| 1 | **Live-derived defaults** (`_44` §5 Q2, deferred) | Stop naming groups; classify them from live geometry + the trace list (side by sign of x, counterpart by type, ring vs stack by extent) | **Large — ~1-2 days**, plus a new classifier per view | Eliminates the class, but trades a LOUD failure for a SILENT one: a heuristic that picks the wrong group draws a plausible-looking wrong picture and no test can tell. Also costs the reviewable data literal. **Not recommended as the first move** |
| 2 | **Alias / redirect layer** — `{retired name -> current name}` applied at resolve time | Old constants keep working | Small — ~1 h | **Rejected.** This is exactly the silent auto-migration the house rule forbids, it cannot know about a rename nobody told it about, and the map grows forever |
| 3 | **Per-SELECTOR zero-match, surfaced loudly** (recommended) | `resolvePanel` already evaluates each selector; have it record which selectors matched **0** clusters even when the panel as a whole matched something, and sweep every view once at pixel-map open, painting the EXISTING loud banner plus one consolidated line: *"2D view defaults name 2 groups that no longer exist: 'Left Top Chimney Generator', 'Left Front Deck Generator' — live groups: ..."* | **Small — ~2-4 h** incl. tests | **RECOMMENDED.** It closes the actual hole (silent partial staleness), reuses machinery that already exists, changes no behaviour, migrates nothing, and turns a multi-hour invisible breakage into a named on-screen message the moment he opens the map |
| 3b | Same check at **rename time** | When a rename targets a group named by a shipped default, say so in the existing rename report: *"'Left Top Chimney Generator' is named by the Top-Down 2D default view — that view needs a source change"* | +~1 h on top of 3 | Good companion: it tells him at the exact moment he causes it |

**Recommendation: 3 (+3b if cheap), and keep option 1 on the table only if he
gets tired of the tactical re-points.** 3 does not remove the hardcoded names —
it removes the *silence*, which is what actually cost the time. None of this is
built; it is his call.

### Verification

- **Suite 980 / 972 / 8** — the 4 reds from his rename batch are **green**, the
  stale-model 8 are unchanged, **zero new**. (The baseline moved twice under me,
  903 → 924 → 980, as other agents landed halo and rename-hygiene work in
  parallel; judge by WHICH tests fail, not the count.) One further red appeared
  and was fixed here: `default views keep TE sign membership to spec after
  reclassification` in `tests/pixel_map_te_led_classification.test.js` still
  expected the single-panel te_sign view, so it was re-pointed at the per-sign
  panels and its rig gained the second sign.
- Parity CLI unchanged in kind (titanic still `FAIL`, driven by his live mapping
  and the stale export — no scene or model file was touched here).
- **Zero scene writes.** Newest `scenes/**` mtime is his own `16:38:58` save;
  0 save-server requests attempted across both browser runs.
- **NEW — GUARD 4, no sACN output.** He is live-mapping real hardware, so the
  harness now installs `window.__readonlyMode` as an accessor before any page
  script runs: the getter returns `true` (so `animate.js` never enables the sACN
  output client and this probe can never transmit alongside him), the setter
  swallows `main.js`'s assignment (a frozen value would throw in its strict-mode
  module and break boot), and `main.js` reads the URL param directly for panel
  wiring so the Pixel Map still mounts. `?readonly=1` was NOT usable — it skips
  `initPixelMapPanel()`, the very panel being captured. Proven per run:
  `__readonlyMode=true`, `'[sACN Out] Enabling'` console lines: **0**.
- **Recaptured** (same 1440 x 900 framing, inspected): `after_top_down.png` —
  the left chimney ring is back, all 8 dots, alongside the right ring, both small
  stacks and both bar rows; `after_te_sign.png` — both signs, one per panel,
  each on-canvas and tip-down; `after_front.png` — left front vintage lights
  restored. WARNING: these three are **much darker** than the earlier captures —
  his live rig is nearly all unlit right now (one strand lit), so most pixels
  draw only their dark bezel. The geometry is fully legible from the bezels; it
  is his output state, not a rendering regression. Header now reads
  `100 fix - 1061 px` (was `98 - 987`) — his second TE sign.

---

## 11. Addendum 3 (2026-07-30) — the orphan trap fired for real; `ORPHAN_GROUPS` drops `Left Back Wall`

The gate on Open Decisions 11/12 resolved: the operator ordered the manual scene
fix and the coordinator applied it on disk (base = his own `09:03:24` save). Disk
state re-verified read-only by me before touching anything:

| | before | after (verified @09:09-09:10) |
|---|---|---|
| `Left Back Wall` | 5 GHOST bars, **no trace** | 5 REAL bars, **trace-backed** |
| `Left Back Wall Generator` | the real group | **gone** (renamed away) |
| `Left Center Auditorium` | 7 ghosts, no trace | **unchanged** — 7 ghosts, still no trace |
| `views.yaml` | two keys | single key `Left Back Wall: 0x10` |
| trace `groupName`s | 14, one ending "Generator" | 14, **none** ending "Generator" |

**So the trap `_51` §4 predicted fired exactly as written**: `ORPHAN_GROUPS`
is keyed on the NAME, not on orphan-ness, so the moment his real generator took
the name `Left Back Wall`, the Top-Down exclude started hiding **his real back
wall** — 5 bars, 90 px. Entry dropped.

```js
export const ORPHAN_GROUPS = ['Left Center Auditorium'];   // was ['Left Back Wall', 'Left Center Auditorium']
```

Dropped in **both** places `_51` §8 flagged: the module and its CommonJS mirror
in `agent_tools/pixel_map_view_tuning_verify.cjs` (the harness cannot import the
ESM module, so the mirror is annotated as one and the harness now asserts the
de-orphaned group is DRAWN). `Left Center Auditorium` stays excluded — still 7
untraced coordinate-duplicates of `Left Auditorium`, and the operator has not
ruled on them.

### The tripwire that mattered, and the one that now closes the class

The old pin (`the 12 orphaned fixtures are still orphans, and still excluded`,
asserting counts `[5, 7]` + untraced) **did its job**: it goes red the instant
the scene changes underneath it, which is what a name-keyed exclusion needs. It
is replaced by three sharper ones:

- **`every excluded orphan group is STILL an orphan (untraced) in the scene`** —
  the same guarantee, re-expressed so it fails with the actionable sentence
  ("`'X'` now has a generator trace — it is a REAL group, and excluding it hides
  the operator's fixtures. Drop it from ORPHAN_GROUPS.").
- **`NO default view excludes a group that a generator trace owns`** — the
  general form, and the one that actually closes the class. It walks every
  default view's `exclude` list and fails by name if any of them names a
  trace-backed group, whatever that group is called and whichever view holds it.
  This would have caught today's trap automatically, with no foreknowledge.
- **`the de-orphaned Left Back Wall is drawn by Top-Down again`** — pins the
  specific repair.

`fixtureType` excludes (the TE sign halves) are deliberately exempt from the
general rule: those are a real, permanent membership decision, not a ghost list.

The synthetic rig in `pixel_map_views.test.js` was updated to match the new scene
shape (back bars are now `Left Back Wall` / `Right Back Wall`; the only ghost
group left is the 7 auditorium pars), and the Top-Down membership test gained a
direct assertion that the real back wall's 5 bars are IN the panel. Cluster count
is unchanged at 52 — 20 bars either way, since the 5 that were dropped as ghosts
are now the 5 that are drawn as real.

### Verification

- **Suite 982 / 974 / 8** — the **same 8** named stale-model failures, **zero
  new** (980 → 982 = the two tests added here). Every pixel-map test green: 80/80
  across `pixel_map_view_defaults`, `pixel_map_views`,
  `pixel_map_te_led_classification`, `pixel_map_layout_expansion`.
- **Parity CLI changed shape exactly as the coordinator predicted**, because the
  scene moved on disk while the model export did not: titanic
  **192 → 337 errors** (0 warning, 9 → 7 info). Not a regression and not mine —
  no model or scene file was touched here; it is the export going staler. It
  clears when the operator re-exports `models/titanic.js` and restarts the
  engine, which he already owes for the earlier drift. test_bench unchanged at
  `4 / 0 / 1`.
- **Zero scene writes.** The coordinator's edit is the only change; all my reads
  were read-only, and the harness still aborts every `:6970` request (GUARD 3)
  and suppresses sACN output entirely (GUARD 4).
- **Live proof, and how it was captured.** The operator's stack was **down** for
  this verification (ports 6969-6972 all refusing — he had stopped it to reload
  the fixed scene). I did **not** bring it back up on the standard ports: that
  would collide with his own restart and would bind the sACN bridges while he has
  hardware attached. Instead the harness gained an `--origin` flag and the capture
  ran against a **read-only static file server on :7969** (`python -m http.server`,
  repo root) — plain file serving, so there is **no save server and no sACN
  bridge in that process at all**, on top of GUARD 3 and GUARD 4. It was stopped
  immediately after; nothing is listening on 6969-6972 or 7969 now. The pixel map
  is pure client-side over the same scene files on disk, so this is exactly as
  representative as his stack would have been.

  Verdict line from the run:

  ```
  [ORPHAN FIX] Top-Down draws 'Left Back Wall': 5 clusters; remaining ghosts excluded: true  => PASS
  [GUARD 4]    sACN output suppressed: YES ('[sACN Out] Enabling' lines: 0)
  ```

  Top-Down resolves 52 clusters over the groups `Left Back Wall, Left Front Wall,
  Left Small SmokeStack, Left SmokeStack, Right Back Wall, Right Front Wall,
  Right Small SmokeStack, Right SmokeStacks` + all 8 strands — **his real back
  wall is in the list**, the auditorium ghosts are not.

- **Screenshots** (inspected): `after_top_down.png` and the 2x close-up
  `after_top_down_left_back_wall_crop.png`, which show the left cluster's **two**
  bar rows — the lit `Left Front Wall` row on top and the `Left Back Wall` row
  below it. That lower row draws its dark off-bezels rather than lit colour
  because the rig is largely unlit right now; before this fix it was **absent
  entirely**, bezels and all, which is the difference the shot is evidence for.
  Independent corroboration of the scene edit in the panel header: **`95 fix ·
  971 px`**, down from `100 fix · 1061 px` — exactly the 5 deleted ghost fixtures
  and their 90 pixels.

---

## 12. Addendum 4 (2026-07-30) — operator-ordered DEPARTURES from the true projection

Four orders in one batch, from annotated screenshots. **Two of them change the
semantics of a view**, which is why this section is prominent: until now every
`spatial`/`planar` panel was a strictly TRUE projection, and reports `_40` and
`_48` both rejected proposals that would have faked a position. Sina has now
explicitly licensed two narrow, named departures. **Both are scoped to the view
he asked about, both are declared as data on the panel, both are tested, and
both announce themselves in the console — nothing here moves silently.**

### 12.1 Top-Down: "bring the 2 sides closer so they are seen easier together"

**The problem, measured on his scene:** along the Top-Down horizontal axis the
drawn content spans 90.5 world units, of which **48.3 (53 %) is empty** — 26.5
between the ship's two halves, 13.8 out to the left small smoke stack, 8.1 out
to the right one. An aspect-preserving fit charges for that emptiness by
shrinking every fixture, which is what made the halves small and far apart.

**The mechanism — `panel.compress = { minWorldGap, gapWorld }`.** Every maximal
empty band along the projected horizontal axis wider than `minWorldGap` collapses
to exactly `gapWorld`. It is a **piecewise translation**: every point on one side
of a band shifts by the same amount, so *within* a side every distance, angle and
ordering is bit-for-bit what it was, and the per-side scale is untouched. Only
the inter-side spacing changes — exactly the licence he gave, and nothing more.
Shipped on Top-Down as `{ minWorldGap: 5, gapWorld: 4 }`.

**Why a threshold rather than hand-written per-side offsets.** The coordinator
asked for "a named per-side offset/gap parameter, not a heuristic that silently
moves things". A literal offset table would have to name sides or groups — and
this session has now repaired *that* failure mode three times (addendum 2): any
table of names goes stale the moment he renames or moves something. The
threshold reads the geometry, so it cannot go stale. It is made non-silent by
three things: `minWorldGap`/`gapWorld` are declared constants on the panel, the
function returns the exact band list, and the layout prints one console line per
distinct outcome naming every band it collapsed and by how much.

**Headroom, and a test that guards it.** On the live scene the bands it collapses
are 26.5 / 13.8 / 8.1 world units; the largest gap it must NOT touch (inside the
left half) is **1.5**. A threshold of 5 sits with >3× margin on both sides. A
test recomputes both numbers from `scene_config.yaml` and fails if the smallest
collapsed band drops under 1.5 × the threshold or the largest kept gap rises
above ⅔ of it — so a fixture move that could tear a side in half is a red test,
not a silently mangled view.

**Result:** vertical canvas fill **0.714 → 0.881** (the view is now
height-limited rather than wasting half its width), i.e. **~23 % more design
units per world unit**, and the dead middle drops from ~240 design units to ~45.

### 12.2 Top-Down: distinct bars, slightly heavier strands

He circled each bar in the top and bottom rows individually and asked for
separate boxes "like the front view has". A bar's 18 LEDs span only 0.82 world
units, so a bar draws as one blob of (0.82 × scale) plus the glyph's end-caps;
neighbours are 3.0 world units apart. Per-view `typeStyles`:

- **`ShehdsBar` 17 → 14** (square, so the diagonal right-hand rows read the
  same). Trimming the glyph shortens the end-caps; with §12.1's extra zoom the
  edge-to-edge gap between adjacent bars goes from ~3 design units to ~13 —
  they now read as five separate boxes, which the screenshot confirms. **This
  partially walks back his earlier "make the bar segments a bit wider" ruling
  (`_40`) on this view only** — 14 is still clearly beefier than the 13 they
  were before that ruling, and the Front view keeps the full 17. Flagged
  explicitly so he can say "no, keep 17 and live with tighter gaps".
- **`LedStrand` 4 → 5** — "keep, maybe slightly more prominent". Their pixels
  are ~1.3 design units apart here, so 5 is still a solid continuous line.
- Chimney ring and small stacks: untouched, as he asked. Both read better anyway
  from the extra zoom — the small stacks' own par-to-par spacing goes 13.0 → 16.1
  design units against a 13-unit disc, so each now reads as a ring of four
  *separated* dots rather than four touching ones.

### 12.3 Front: "resize the vintage pixels to 6 circles that are a bit bigger"

**Six is real, not a magic number.** `dmx/fixtures/vintage_led_stage_light/model_33.yaml`
declares `model.pixels` = **6**, and every VintageLed cluster in the live batch
list carries exactly 6 pixels. So "6 circles" is one circle per LED. A test
reads that YAML and fails if the fixture definition ever stops saying 6, rather
than hardcoding it.

**Why glyph sizing alone could not do it.** Those 6 LEDs sit inside a ~0.38-unit
diagonal — a pitch of **0.075 world units**, i.e. **2.8 design units** at the
Front view's scale. Six 15-unit discs therefore fuse into the capsule he circled,
and to separate them by size alone each disc would have to be ~2 design units:
invisible, and the exact opposite of "a bit bigger".

**The mechanism — `panel.expandPitch = { <fixtureType>: <world units> }`.** For
the declared types only, a cluster's pixels are re-laid along **its own projected
axis** (first LED → last LED) at exactly that pitch, centred on the cluster's
**true projected centroid**. The fixture stays where it physically is, keeps its
real orientation and its real LED order; only the spacing between its own LEDs is
stretched. Declared per fixtureType on purpose — applied to `ShehdsBar` (18 px at
the same sub-pitch) it would draw a bar eighteen pitches long and wreck the view,
and a test pins that no default view ever stretches a bar.

Shipped as `VintageLed: 0.6` world units → ~22 design units on both Front panels,
with the glyph at **16** (a touch larger than the shipped 15, and ~0.72 of the
pitch, so they read as six circles with a clear gap rather than a new sausage —
the pitch-fraction lesson from `_53`, applied in 2D). 0.6 was chosen so the
stretched fixtures stay **inside** the panels' existing bounds on both sides, so
the fit box — and therefore every other fixture's size and position on the Front
view — is completely unchanged. Verified: both Front panels' fill fractions are
byte-identical to before (0.74 × 0.875 and 0.57 × 0.875).

### 12.4 TE Sign: "also add both TE signs side by side" — already true

**No change was needed, and none was made.** Addendum 2 already split the view
into one `planar` panel per sign, and the multiview lays a view's panels out
**left→right** (`panelSubRects`), so the TE Sign view has been showing both signs
side by side since that change. Confirmed live and screenshotted: `sign_1`
('TE Sign') and `sign_2` ('TE Sign 2'), each 2 clusters / 74 px, each at its own
honest cell scale (fill 0.170 × 0.401 and 0.171 × 0.490) and each tip-down
(bearing −87° / −88°).

He is almost certainly looking at a **stale page** — these are source constants,
so his browser needs a reload to pick addendum 2 up. **Operator action: reload
the sim.** If both signs still do not appear after a reload, that is a new bug
and I should be told, because the data plane says they are there.

### 12.5 Verification

- **Suite 1017 / 1009 / 8** — the same 8 named stale-model failures, **zero
  new**. 15 tests added (5 compression, 3 pitch-expansion, 3 schema/persistence,
  4 default-view + model-truth pins).
- **All 16 hardcoded group names re-audited** against his newest save
  (`09:36:02`, patches regenerated): **0 stale**, and every one still
  trace-backed except the two TE-sign groups and the remaining ghost, exactly as
  expected.
- **Zero scene writes**; GUARD 3 (0 save requests attempted) and GUARD 4 (0
  `[sACN Out] Enabling` lines) both held on a live capture against his running
  `:6969`. GPU adapter recorded, `integrated: false`.
- The `[ORPHAN FIX]` assertion from addendum 3 still passes: Top-Down draws his
  real `Left Back Wall` (5 clusters) and still excludes the ghosts.

**Screenshots** (`~/tmp/pixel_map_views/`, all inspected):

| Path | Shows |
|---|---|
| `after_top_down.png` | the two halves close together, both small stacks pulled in, everything ~23 % larger |
| `after_top_down_bars_crop.png` | 2× crop: **five distinct bar boxes with clear gaps** in each row, the 8-dot chimney ring clean in the middle of the strand fan, the small stack's 4-dot circle at left |
| `after_front.png` | Front view unchanged in framing, vintage fixtures now legible |
| `after_front_vintage_crop.png` | 2× crop: each vintage fixture as **6 distinct circles** on its own diagonal — the operator's sketch |
| `after_te_sign.png` | both signs **side by side**, each on-canvas and tip-down |

Note the captures are dim: his rig is largely unlit while he maps, so most
pixels draw only their dark bezel. Geometry is fully legible from the bezels.
