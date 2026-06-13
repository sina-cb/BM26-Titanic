# Slot 2 — titanic_gap_analysis

- **Branch:** dev/claude/titanic_gap_analysis
- **Parent branch:** claude/nice-cerf-bl2jnk
- **Worktree:** ~/BM26-Titanic-worktrees/titanic_gap_analysis
- **Slot ports:** sim HTTP 31269, save 31270, sACN bridge 31271, sACN out 31272
- **Type:** ANALYSIS — no scene/source changes; this report is the artifact.

## Scope

Operator request 2026-06-12: a comprehensive gap analysis of the `titanic`
scene plus a real-scale stress test of the Controller Mapping (🎛, docs/33)
and Views (👁, docs/27) UI. Four parts: (1) scene inventory, (2) hands-on
mapping of every group through the real UI, (3) coverage/naming/views/model
gap analysis, (4) UI scale audit at the real-rig target (15–20 controllers,
20–25 groups). All UI work was done by driving actual buttons with puppeteer
(xvfb, SwiftShader, 1280×720) against the sim on slot-2 ports; every
screenshot referenced below was visually inspected. Scripts:
`~/tmp/titanic_map_exercise.cjs`, `~/tmp/titanic_views_exercise.cjs`;
raw metrics: `~/tmp/titanic_map_metrics.json`. Evidence PNGs live in the
worktree's `.agent_renders/` (gitignored); the 10 most important are copied
to `~/tmp/titanic_gap_evidence/`.

---

## Part 1 — Scene inventory

Files read: `simulation/scenes/titanic/scene_config.yaml`, `patches.yaml`,
`views.yaml`, `cameras.yaml`. 3D context: `1781298088_{front,side,aerial,
night-walk}.png` and the derived top-down map `coverage_map_topdown.png`.

The model is the broken ship in two tilted halves ("Left" half centered
x≈−22, z≈−1…17; "Right" half rotated ~40°, x≈11…34, z≈−20…2), four large
icebergs at the corners, and two clusters of small bergs at x≈±48.

### DMX fixture groups — 61 fixtures, 10 groups, 3 fixture types

| Group | Count | Type (footprint) | Physical location |
|---|---|---|---|
| Right Front Wall Generator | 5 | ShehdsBar (119 ch) | Right half, man-facing hull wall wash |
| Right Top Chimney Generator | 9 | UkingPar (10 ch) | Right half, ring around the funnel |
| Right Front Deck Generator | 4 | VintageLed (33 ch) | Right half, vintage row on the front deck edge |
| Right Center Auditorium Generator | 6 | UkingPar | Right half, deck row aimed into the auditorium |
| Right Back Wall Generator | 7 | ShehdsBar | Right half, far-side hull wall wash |
| Left Front Wall Generator | 5 | ShehdsBar | Left half, man-facing hull wall wash |
| Left Top Chimney Generator | 9 | UkingPar | Left half, ring around the funnel |
| Left Front Deck Generator | 4 | VintageLed | Left half, vintage row on the front deck edge |
| Left Center Auditorium | 6 | UkingPar | Left half, deck row aimed into the auditorium |
| Left Back Wall | 6 | ShehdsBar | Left half, far-side hull wall wash |

Naming pattern: fixtures are `<group> <N>` (N = 1-based generator index =
cable-order index). All 61 names unique; every fixture has a group; no
single-fixture orphan groups. 8 of 10 groups carry a `Generator` suffix
(tool name leaked into rig semantics); `Left Back Wall` and
`Left Center Auditorium` don't — their generator traces are still named
`… Generator` while emitting a different `groupName` (the only
trace↔group name mismatches in the scene).

### LED strands — 16 (not DMX-patched; separate pipeline)

8 hull-edge strands of 40 LEDs (`Left_Front_Left`, `Left_Back_Left`,
`Left_Back_Right`, `Left_Front_Right`, `Right_Back_Left`,
`Right_Back_Right`, `Right_Front_Right`, `Right_Front_Left`) and 8
small-berg strands of 20 LEDs (`Small_Left_1..4`, `Small_Right_1..4`).
Naming is `Underscore_Case`, a third convention.

### Icebergs — 4 (`Berg Alpha/Beta/Gamma/Delta`)

Scene-level objects (own LEDs + floods), not DMX fixtures.

### Patch state

`patches.yaml` has exactly 61 entries, 1:1 with fixtures, and **every single
one is unpatched** (`controllerIp: ''`, `dmxUniverse: 0`, `dmxAddress: 0`,
`controllerId/sectionId/fixtureId/viewMask: 0`). There is **no
`controllers.yaml`** for titanic — no hardware mapping exists yet. The sim
boots with the "UNPATCHED — SIM-ONLY MODE" badge (see `1781298088_front.png`
header area and `cm_00_boot.png`).

### Views

`views.yaml`: 30 auto group bits (10 fixture groups + 16 individual strands +
4 bergs) consuming bits 0x1…0x20000000, and `custom: []` — **zero custom
views defined**. `cameras.yaml`: 5 generic presets (front/side/aerial/
dramatic/night-walk), none area-specific.

---

## Part 2 — Hands-on mapping exercise (stress test)

Method: real-UI puppeteer run (`~/tmp/titanic_map_exercise.cjs`) on
`?scene=titanic`, slot-2 ports. One controller per group (10 controllers,
named after the groups, IPs 10.1.1.10–10.1.1.19) created through the
`+ Add Controller` modal; every fixture mapped through **pick mode**
(`+ list` → tray filter = group name → click chips one by one). No
`Save Configuration` click at any point. Afterwards `git status` confirmed
**zero scene residue** (autosave only marks dirty; nothing was written —
only my local `config.yaml` port edit existed, reverted before commit).

What happened, with numbers (full log in `titanic_map_metrics.json`):

- **All 61 fixtures mapped, header flipped to `✓ fully patched`**
  (`cm_04_all_groups_mapped.png`). Automated wall time 52 s; per-chip click →
  re-render latency averaged **67–83 ms** across all groups (no degradation
  from group 1 to group 10). Hand-estimate stays within the docs/33
  "10-minute click-through" target (~6–8 min of clicking + ~2–3 min of
  controller creation).
- **ShehdsBar groups force port splits.** 119-ch footprint ⇒ max 4 per
  universe (476/512). All four wall groups (5, 5, 6, 7 bars) hit
  "U\<n\> full at the end (119 ch needed)" on the 5th bar — a loud, correct
  rejection toast — and needed a second port (4 port switches total,
  `cm_02_first_group_mapped.png` shows the first: P1·U2 476/512 full,
  bar 5 landed on P2·U3).
- **Panel growth:** empty panel 75 DOM nodes → 10 controllers: scroll region
  3511 px tall in a 423 px viewport (**8.3 screens**), 849 nodes, 40 ports
  (26 of them empty but fully rendered — the default-4-ports policy
  inflates height ~40% in this exercise), 40 universe bars.
  `cm_05_scrolled_bottom.png` shows the bottom of the list.
- **Universe numbering sprinted to 41.** Each `addController` pre-claims 4
  fresh universes (monotonic, never reused — decision 15). With fixtures on
  only 14 ports, universes 2–41 were allocated. This immediately tripped the
  red full-width **`🚨 UNIVERSE MISMATCH`** banner (`cm_04…png`, top):
  patches now reference U22–U38 while `common.yaml → sacn_universes` is the
  hand-maintained list `1,2,…,20`. Doc-33 phase 5 (derive the listen list
  from the mapping, task 018) is not landed yet, and this exercise proves
  the titanic rig cannot be patched without it (or without hand-typing
  dozens of universes and restarting).
- **Global effects:** clicked `+ effects` on a U1 port — toast
  `No unmapped effect fixtures` (`cm_06_effects_no_fixtures.png`). Correct
  behavior, but it surfaces a **scene gap**: titanic has **no fogger/haze
  fixtures at all** (test_bench and logsville do), despite the canonical
  pin table (`config.yaml → global_effects`) and the auto-pin flow being
  built for them.
- **Violations behave as designed and read well at this scale.**
  Contested-universe (two controllers on U2) produced the precise banner
  naming both controllers and the projection consequence
  (`cm_07_violation_contested_universe.png`); a manual address conflict
  painted both chips' address boxes red, banner `BOTH KEPT; fix one
  address`, header `1 violation(s) ⚠` (`cm_08_manual_address_conflict.png`).
  Both reverted cleanly.
- **Nothing broke, nothing lagged.** No page errors in the whole run; full
  re-render at 20 controllers: 4–8 ms.

Friction points recorded during the run feed Part 4.

---

## Part 3 — Gap analysis

### 3.1 Coverage — the missing-vintage suspicion is CONFIRMED

Vintage fixtures in the scene: **8 total, in exactly 2 groups** — `Left
Front Deck Generator` (4) and `Right Front Deck Generator` (4), both on the
**front (man-facing) deck edge** of their half. Isolating them in the sim
(`vm_05_vintage_isolated_side.png`, `vm_05_vintage_isolated_front.png`)
shows warm pools only along the two front deck rails; every other deck edge
is dark.

Confirmed missing vs. a complete set:

| Suspected missing | Verdict |
|---|---|
| Left-back vintage lights | **MISSING** — the left half's back deck edge (z≈1 side, above `Left Back Wall` bars) has no vintage group |
| Right-back vintage lights | **MISSING** — the right half's back deck edge (above `Right Back Wall Generator`) has no vintage group |
| Balcony vintage lights | **MISSING** — no balcony group of any type exists; the auditorium rows are UkingPars on the deck lip, not balcony vintage |

A port/starboard/balcony-complete vintage set would be 4–5 groups per the
model's symmetry: per half {front deck, back deck} + balcony level(s) —
i.e. **2 of ~5 vintage groups exist (~16 of ~36+ vintage heads)**.

Other coverage observations:

- **Interior/rooms**: only the 2 auditorium rows point inward. The mission's
  "light the rooms" goal has no other fixtures yet.
- **Bow/stern tips and the gap between the halves** have no dedicated
  fixtures (the break faces are what the auditorium rows wash).
- **No global effects** (fog/haze) anywhere in the scene (see Part 2).
- Icebergs are lit by their own non-DMX LEDs/floods — fine, but they're
  uncontrollable from the engine/patterns pipeline.

### 3.2 Naming — three conventions in one scene

In use today:

1. Fixture groups: `Title Case With Spaces`, `Left/Right` for the two
   halves, `Front/Back` relative to the man-facing side, 8/10 polluted with
   the `Generator` tool suffix, inconsistent omission on 2 groups.
2. LED strands: `Underscore_Case`, `<Half>_<Face>_<Side>` triplets plus
   `Small_<Side>_<N>` for the small-berg strands.
3. Bergs: `Berg <Greek letter>`.

No nautical language (bow/stern/port/starboard) anywhere; `Left/Right`
double-duty as both "which half" and (in strand names) "which side of the
face" is the most confusing artifact.

**Proposed unified scheme** (groups and fixtures; do NOT apply yet):

`<Section> <Area> <Role>` for groups, fixtures `<group> <NN>` (zero-padded,
NN = cable order). Section ∈ {Bow, Stern} for the two halves (⚠ needs the
operator to confirm which half is canonically the bow — assumed Left=Bow
below), Area/Role from a small fixed vocabulary: `Front/Back Wall Bars`,
`Stack Pars`, `Auditorium Pars`, `Front/Back Deck Vintage`,
`Balcony Vintage`. `Generator` disappears everywhere.

Rename table (old → new):

| Old group | New group |
|---|---|
| Left Front Wall Generator | Bow Front Wall Bars |
| Left Back Wall | Bow Back Wall Bars |
| Left Top Chimney Generator | Bow Stack Pars |
| Left Front Deck Generator | Bow Front Deck Vintage |
| Left Center Auditorium | Bow Auditorium Pars |
| Right Front Wall Generator | Stern Front Wall Bars |
| Right Back Wall Generator | Stern Back Wall Bars |
| Right Top Chimney Generator | Stern Stack Pars |
| Right Front Deck Generator | Stern Front Deck Vintage |
| Right Center Auditorium Generator | Stern Auditorium Pars |
| *(future)* | Bow Back Deck Vintage · Stern Back Deck Vintage · Balcony Vintage |

Fixtures follow automatically: `Left Top Chimney Generator 7` →
`Bow Stack Pars 07`, etc. Strands and bergs (same vocabulary, consistent
case): `Left_Front_Left` → `Bow Front Edge L`, `Left_Front_Right` →
`Bow Front Edge R`, `Left_Back_Left/Right` → `Bow Back Edge L/R`,
`Right_*` → `Stern …` likewise; `Small_Left_1..4` → `Small Bergs L 1..4`,
`Small_Right_1..4` → `Small Bergs R 1..4`. `Berg Alpha…Delta` can stay
(harmless TE flavor) or become `Berg NW/NE/SW/SE`.

Renaming is safe to do *before* a mapping exists (right now!) — once
`controllers.yaml` chains reference fixture names, renames must go through
the sim's rename hook only. Generator traces' `name`/`groupName` should be
updated in the same pass to kill the two mismatches.

### 3.3 Views — the obvious operational set is missing (and mostly can't be added)

`custom: []` today. The obvious operational views given the groups:

- **Exterior Visibility Critical** (all wall bars + hull strands) — the
  mission-critical "is the ship visible" check.
- **Bow Half / Stern Half** (per-section everything).
- **Front Face / Back Face** (man-side vs. far side).
- **All Vintage**, **All Stacks**, **Auditorium/Interior**, **Icebergs**,
  **Strands only**.

But: the 32-bit `viewMask` has 31 usable bits, and titanic's auto group
bits already consume **30** — the Views panel itself reports
**`CUSTOM VIEWS — 0 · 1 bit(s) free`** (`vm_02_views_bottom.png`). I
created one custom view through the real UI (it took 0x40000000 →
`0 bit(s) free`, `vm_03_custom_view_vintage.png`) and the attempt to add a
second failed with the loud bit-exhaustion error (`vm_04_bit_exhaustion.png`).
**Exactly one custom view is possible in the titanic scene.** Root cause:
every individual strand (16) and berg (4) gets its own auto group bit.
This is the single biggest blocker to the views story (see R1).

Also: auto group rows in the panel are display-only — no isolation eye —
so the only way to visually verify a group is… a custom view, which is
bit-blocked. (Custom-view group membership rides the `groups` list, so
membership itself doesn't need extra bits — only the view's own bit.)

### 3.4 Model/scene mismatches & misc

- All 61 fixtures unpatched + no `controllers.yaml` (the mapper exists;
  the patch session just hasn't happened).
- Generator traces `Left Back Wall Generator` / `Left Center Auditorium
  Generator` emit groups named without the suffix — rename-table fodder,
  and a regen-stability hazard if anyone "fixes" one side only.
- `common.yaml → sacn_universes: 1,2,…,20` (hand list, skips 7–9) is
  guaranteed-stale against any real mapping (proven in Part 2). Doc-33
  phase 5 / task 018 is the fix.
- No fog/haze fixtures despite the canonical pin table and the U1 effects
  machinery (logsville has a `TEFogMachine`, test_bench both).
- LED strands carry vestigial flat patch fields (`controllerId/sectionId/
  fixtureId/viewMask: 0`) inline in `scene_config.yaml` — dead weight from
  the pre-views era, not consumed by the mapper.
- `cameras.yaml` has no per-area presets; on-site patching of (e.g.) the
  stern stack ring would benefit from saved close-up cameras.
- No duplicate names, no group-less fixtures, no single-fixture groups —
  scene hygiene is otherwise good.

---

## Part 4 — UI scale audit (15–20 controllers, 20–25 groups)

Setup: the Part-2 mapping (10 controllers/40 ports/61 fixtures) plus 10
synthetic controllers added through the real modal → **20 controllers,
80 ports, universes allocated to 81**. Screenshots:
`cm_09_twenty_controllers_top.png`, `cm_10_twenty_controllers_bottom.png`,
`cm_11_all_collapsed.png`.

**What holds up (positives first):**

- **Performance is a non-issue.** Full panel re-render at 20 controllers:
  4–8 ms; 1439 DOM nodes; per-mutation latency flat at ~75 ms including
  projection + autosave debounce. The replaceChildren architecture is fine
  at 3–4× the real rig.
- **Loud-failure UX scales.** Rejection toasts, violation chips, the
  positioned universe bars' red conflict segments, and the
  `Unmapped: N ⚠ → ✓ fully patched` header all stayed readable and correct
  through the whole exercise.
- **Collapsed controller summaries** (`4 port(s) · 9 fixture(s) · U6 U7 U8
  U9`) make the collapsed list genuinely navigable
  (`cm_11_all_collapsed.png`).
- **Pick mode + tray filter** is fast and pleasant: filter by group name,
  click in cable order, live `next: ch N` preview. 61 fixtures = 61 clicks,
  no surprises.

**Pain points (severity / evidence / recommendation):**

1. **P0 — Views bitmask exhaustion.** 30/31 bits consumed by auto group
   bits; 1 custom view possible, 0 after that (`vm_02/03/04…png`). At
   20–25 groups + strands the scene won't even boot its auto bits
   (>31 groups = collision at load). *Rec:* stop auto-bitting individual
   strands/bergs (aggregate: `Bow Strands`, `Small Bergs L/R`, `Bergs`) —
   frees ~17 bits immediately; mid-term move `viewMask` to BigInt/64-bit
   in the export pipeline, or make group-only views bitless.
2. **P1 — Panel length / scroll.** 3511 px of controllers in a 423 px
   scroll region at 10 controllers; 5991 px (≈14 screens) at 20
   (`cm_09/10…png`). No collapse-all/expand-all — collapsing 20 controllers
   is 20 clicks. 26 of 40 ports in the realistic mapping were **empty but
   fully rendered** (~40% of the height). *Rec:* add collapse-all /
   expand-all buttons; render controllers collapsed by default when ≥N
   exist; one-line summary row for empty ports (or create controllers with
   1 port + explicit `+port`).
3. **P1 — No global find-a-fixture.** The tray filter only searches
   *unmapped* fixtures; once mapped, finding `Left Top Chimney Generator 7`
   means expanding controllers and scanning chips — and collapsed
   controllers' chips aren't even in the DOM (verified: 0 hits when
   collapsed). 3D-click→chip-flash also can't work collapsed. *Rec:* a
   search box in the panel header that matches mapped+unmapped, auto-expands
   the owning controller/port, scrolls to and flashes the chip; make
   3D-click do the same auto-expand.
4. **P1 — `sacn_universes` is still hand-maintained** (doc-33 phase 5 /
   task 018 unimplemented). Any real mapping instantly trips the red
   UNIVERSE MISMATCH banner (`cm_04…png`) and demands a hand-edit + restart;
   at 15–20 controllers the universe list is 30–80 entries — untypable.
   Compounded by monotonic universe pre-allocation (4 fresh universes per
   controller, never reused). *Rec:* land phase 5 (derive the listen list);
   until then, show the derived list inside the mapping panel for
   copy-paste; consider allocating a port's universe lazily on first
   fixture instead of at controller creation.
5. **P2 — Universe-map bars are too small to read at scale.** The bar is
   ~80 px wide in the fixed 380 px panel; a 10-ch UkingPar segment is
   ~1.6 px (`cm_05_scrolled_bottom.png`). Conflicts (red) are visible but
   identifying *what* occupies a region is per-segment hover archaeology,
   ×80 ports. *Rec:* click a bar → universe inspector popover (full-width
   bar, labeled claims, owners, holes); make the panel resizable.
6. **P2 — Panel overlap at default positions.** At 1280×720 the Engine
   Parameters (pattern editor) panel sits exactly on the mapping panel's
   header/violations area (`cm_01_panel_empty.png`, `cm_07…png`), and the
   Views panel opens *underneath* the mapping panel (`cm_12…png` — it's
   fully hidden behind). *Rec:* cascade default positions; bring-to-front
   on open/click for all floating panels.
7. **P2 — Fixed 380 px width truncates names.** `Right Center Auditorium
   Gene…` in the name input, chips ellipsize mid-name
   (`cm_11_all_collapsed.png`). 20–25 groups with longer unified names make
   this worse. *Rec:* resizable panel (CSS `resize: horizontal` is nearly
   free) + keep tooltips.
8. **P2 — Violations banner is prose-only.** Fine at 1–3 violations; a
   20-violation pile (one bad universe edit can cascade) is a scrolling
   text wall with no navigation. *Rec:* group by violation type with
   counts; click a violation to scroll to/flash the offending port.
9. **P3 — Pick-mode at camera distance.** Hover-flash on a far fixture is
   sub-pixel from the default camera; the scene has `focusOnSelect` but
   pick-clicks don't frame the fixture. *Rec:* optional "focus on pick"
   toggle in the tray during pick mode.
10. **P3 — Views panel at 30+ groups.** 624 px content in a 466 px body is
    fine today, but group rows are unsearchable, unisolatable read-only
    text. At 20–25 fixture groups + aggregated strands this list is the
    operator's mental model of the rig. *Rec:* filter box + per-group
    isolation eye (the isolation machinery already generalizes — the
    mapper's port-eye proves it).

---

## Prioritized recommendations (rig + scene + UI)

1. **(P0, scene)** Add the missing vintage groups — Bow/Stern **Back Deck
   Vintage** and **Balcony Vintage** — the operator's suspicion is
   confirmed; the back faces' upper edges are dark in every render.
2. **(P0, UI/pipeline)** Fix the views bit budget (stop per-strand/berg
   auto bits, then widen the mask) — without it the views story is dead on
   arrival at titanic scale (1 custom view possible today).
3. **(P0, pipeline)** Land doc-33 phase 5: derive `sacn_universes` from the
   mapping — proven blocker for actually patching this scene.
4. **(P1, scene)** Apply the unified rename table (Part 3.2) **before** the
   first real `controllers.yaml` exists; fix the two trace/group name
   mismatches in the same pass; then define the ~8 operational views.
5. **(P1, UI)** Mapping panel scale pack: collapse-all/expand-all,
   collapsed-by-default at ≥N controllers, empty-port summary rows, global
   fixture search with auto-expand, universe inspector popover, panel
   z-order/cascade fix.
6. **(P2, scene)** Add the fog/haze fixtures to the titanic scene so the U1
   effects flow actually has something to pin (mission: TE DNA, fog on
   playa).

## Files changed

- `.agent/02_reports/202606/20260612_2_titanic_gap_analysis.md` (this
  report) — nothing else. `simulation/config.yaml` port edits were local
  to the worktree and reverted before commit; the mapping exercise was
  never saved (no `Save Configuration` click; `git status` verified clean
  scene files after the run).

## Tests run

- Sim smoke: `?scene=titanic` on :31269 boots clean (no page errors across
  three full puppeteer sessions; WebGL OK under SwiftShader).
- Real-UI exercise: 10 controllers + 61 fixtures mapped via actual
  buttons/pick-mode; violations provoked and reverted; 20-controller
  synthetic scale-up; Views panel custom-view create/exhaust/delete cycle —
  all screenshots visually inspected.
- Scene consistency script: 61/61 unique names, patches↔fixtures 1:1, no
  group-less fixtures, groupBits↔groups consistent, custom views empty.
- No unit/HIL tests: analysis-only slice, no engine/sim code touched.

## Known gaps / follow-ups

- Which half is canonically the **bow** needs operator confirmation before
  the rename table is applied (assumed Left=Bow).
- The Views-panel z-order observation (panel opens underneath the mapping
  panel) was seen at 1280×720 with both panels at default positions; worth
  a quick check at iPad resolution.
- Notion follow-up cards (missing vintage groups, views bit budget, rename
  pass, scale-pack UI items) were NOT filed — slot instructions excluded
  Notion access; the instigator should file them from this report.

## Operator action requested

Review Part 3 verdicts (vintage gaps confirmed) and the prioritized list;
approve the rename table + bow/stern decision so the rename pass can be
scheduled before the first real mapping session.

---

## Operator addenda (Sina, 2026-06-12 evening)

1. **View-mask ceiling is a first-class gap**: a scene supports at most
   **31 distinct group/view bits**, and titanic sits at 26/31 (16 eaten
   by per-strand auto-bits; the 4 per-iceberg bits were reclaimed when
   the fixture type was retired). Direction: consolidate strands into
   larger logical groups and/or optimize bit allocation (lazy
   assignment, eventually a wider mask). Tracked: Notion card
   "View-mask capacity: 31-bit ceiling".
2. **LED strands must reach full parity with DMX lights** — controller
   mapping (output mapping, universes, addresses, discovery), views,
   groups, dimmer support, model exports + tests. Today strands are
   invisible to the whole toolchain (`gatherAllConfigs` excludes them).
   Tracked: Notion card "LED strands: first-class parity".
3. **Vintage lights additionally need a VERTICAL-STANDING placement
   option** (not just the horizontal row mounting) — folded into the
   "Titanic Model Finalization" Notion card together with this report's
   missing-groups, naming, views, and patching work.
4. **LED strand grouping decision**: the LEDs on each side should be
   consolidated wholesale — ALL strands on a side become ONE group and
   ONE view in the model ("LEDs Left", "LEDs Right"), so per-strand
   views stop wasting view-mask space. In the operator's words: "that
   would merge four views and then on two sides so we merge eight views
   into two. LEDs left, LEDs right. That's it." Against this report's
   inventory (16 per-strand auto-bits), side-level consolidation
   reclaims 14 bits in one move — the quick win the view-mask capacity
   card should implement first.
