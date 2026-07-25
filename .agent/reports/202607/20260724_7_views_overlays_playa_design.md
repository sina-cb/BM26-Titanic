# 2026-07-24 — Views & overlays: playa usage design + engine overlay plan

Designer session (Fable) for project **bm_readiness_mapping** (branch
`feat/bm_readiness`). **DOC-ONLY slice — zero source edits, zero git ops.**
Mission (operator's words): *"figure out views and envision how we'd use them
on playa and have the engine overlays also set up and tuned."*

Foundation: report `20260724_0_mapping_readiness_review.md` (§1.4, §5).
Grounding: the Views Rehaul (PR #36, commit `1a428d4c`) code + its design
reports (`202606/20260618_1/_2`, `20260619_4/_5`), the engine overlay stack
(`marsin_engine/lib/pattern_mixer.js`, `global_effects_controller.js`,
`timeline/`), and the CaptainPad/VSN1/autopilot surfaces (sub-audit, folded
in below with file:line anchors). All reads verified on this branch today.

---

## 0. TL;DR for the operator

- **The views machinery is genuinely done and strong** — three tiers
  (unbounded Tier-A auto-views, 62 in-VM Tier-C bits, `inView("Name")` with
  on-demand bit promotion), fail-loud everywhere. On a regenerated titanic
  model we get **~30 useful views for free** (PORT/STARBOARD, WALLS/DECKS/
  CHIMNEYS, @PAR/@BAR/@VINTAGE/@RAW, BAND_LOW/MID/HIGH, per-strand, `_BOTH`
  pairs, and CTRL_&lt;n&gt; once patched).
- **Headline gap #1: the operator can't see most of them.** CaptainPad's view
  picker reads only `groups` + bit-backed `viewMasks` from
  `/model/view-selection-options` and **ignores the `namedViews` array
  entirely** (`CaptainPad/utils/api.ts:1236-1257`) — so PORT/STARBOARD, the
  typed views, the bands, `_BOTH`, and CTRL_* are selectable over raw REST
  but **invisible on the iPad**. One ~1-day slice fixes this.
- **Headline gap #2: nothing can automate a view change.** Timeline cues,
  autopilot, and every physical controller (VSN1/APC/MFT) can NOT set a
  channel's view or configure a deck overlay — views are touch-only in two
  CaptainPad modals. For playa nights we want timeline `look`s to carry
  view-scoped mixer scenes (or snapshot recall, which already serializes
  `viewSelection`).
- **Headline gap #3 (data): the titanic model is stale and two group names
  regressed.** Engine model = 1,147 px (12 strands era); current scene ≈
  1,790 px (28 strands). And 12 fixtures in `scene_config.yaml` still carry
  the pre-normalization groups `Left Back Wall` / `Left Center Auditorium`
  (no "Generator"), which on the next export will break two `views.yaml`
  groupBits keys and two `_BOTH` pairings. Fix names → regen → verify counts
  **before authoring anything**.
- Engine overlay compositing (mixer overlays, deck overlays, global-effect
  chain) is **already correct and never-dark-safe**; the "tuning" work is
  small and concrete: expose the hardcoded `viewFaderRampPerSec`, pick
  per-scenario overlay/effect assignments, and (optionally) view-scope
  global effects. The real blocker for any of it mattering is **patching +
  the G10 hot-reload universe fix** (other slices).

---

## 1. What exists today (grounded)

### 1.1 The three view tiers (engine)

| Tier | What | Cost | Where |
|---|---|---|---|
| **A — named masks** | per-pixel `members[]` `Uint8Array` interned by name in `MaskRegistry`; host-side selection only | **zero bits, unbounded count** | `lib/mask_registry.js:35-138`; resolved by `compileViewSelectionMask` fast path `lib/pattern_mixer.js:49-61` (unknown name **throws**, listing known views) |
| **A — auto-views** | derived at every `loadModel` from metadata the model already carries (groups, fixtureType, world x/y/z, cId) — **can never go stale vs pixels** | zero bits | `lib/auto_views.js:115-298`, wired at `engine.js:527-530`; families: strand, spatial (PORT/STARBOARD/FORE/AFT with x/z-sign cross-check that **throws** on contradiction), structural (WALLS/DECKS/CHIMNEYS/AUDITORIUM), typed (@PAR/@BAR/@VINTAGE/@RAW), band (BAND_LOW/MID/HIGH by model-relative Y thirds), paired (`<base>_BOTH`), controller (CTRL_&lt;cId&gt;, only when patched) |
| **B/C — in-VM bits** | 62 slots across `viewMask`+`viewMaskHi` for **in-pattern** membership tests; base groups fill word 0 first | 1 bit/view | `lib/view_word.js` (allocator, throws past 62), sim `view_registry.js:36` (`MAX_VIEW_SLOTS 62`); patterns use `inView("Name")` which compile-time-folds to the bit test and **auto-promotes a bit-free Tier-A view into a free slot on demand** (`lib/in_view_intrinsic.js:1-34`) |

Selection API: per-channel `viewSelection {type: all|group|section|fixture|
viewMask, target, invert}` compiled once into `compiledPixelMask`
(`pattern_mixer.js:35-119`); enumeration via `GET
/model/view-selection-options` which returns `groups`, bit-backed
`viewMasks`, **and the full Tier-A `namedViews` list with kind +
memberCount** (`lib/api_server.js:5909-5975`).

**Budget math for titanic:** 28 group bits in word 0 (`views.yaml`) → 3 free
word-0 + 31 word-1 = **34 free in-VM slots**, plus unlimited Tier-A. Authoring
~10 named views is nowhere near any ceiling.

### 1.2 Operator surfaces — where views can (and cannot) be driven

Verified by sub-audit (file:line anchors):

- **CaptainPad mixer strip** — per-channel picker modal, three fixed
  sections ALL / GROUPS / VIEW MASKS, no search
  (`CaptainPad/app/(tabs)/mixer.tsx:1083-1163`, PATCH at :2402-2410).
  **Reads only `groups` + `viewMasks`; the response type in
  `utils/api.ts:1236-1257` has no `namedViews` field at all** — Tier-A
  auto-views and pixelSet views never appear. (Strand and generator groups
  do appear, via `groups`.)
- **CaptainPad deck-overlay stack** — add-overlay sheet: pick view (required,
  `all` excluded) → pick playlist (`components/DeckOverlayStack.tsx:562-620`,
  same GROUPS/VIEW MASKS picker :77-136, same `namedViews` blindness).
  Shared autopilot header AUTO(ALL)/SHUFFLE/cadence → `POST
  /deck/overlays/autopilot` (:499-527).
- **VSN1** — the side-button "VIEW" (`sb_1`) toggles the **LCD render style**
  (grid vs readout, `utils/midi/manager.ts:1555-1595`,
  `vsn1_view_mode.ts:17-23`) — it has nothing to do with pixel views.
  **No physical controller (VSN1/APC/MFT) can select a pixel view**; the
  MIDI action `viewToggle` is the deck⇄mixer output switch
  (`utils/midi/profile.ts:389-390`), another naming collision.
- **Autopilot** — picks playlist entries only (`lib/autopilot_pick.js:51-110`,
  both profiles); never touches `viewSelection` or overlays.
- **Timeline** — cue actions are `playlist | look | scene | globals | tasks |
  effect` with `clock/sun/phase/mood/manual` triggers incl. sunrise offsets
  (`lib/timeline/show_plan.js:423-527`, :321-360, built-in sunrise cue
  :952-960). A `look` bundles playlist/autopilot/palette/globals/tasks
  (:291-307) — **no viewSelection, no overlay config**; the only overlay
  lever is a blanket `overlays: enable|disable` on deck playlist actions
  (`timeline_service.js:636`, :450-458). **Nothing anywhere can schedule a
  view change.**
- **Snapshots** — DO serialize per-channel `viewSelection`
  (`lib/snapshot_manager.js:10`) → snapshot recall/morph is today's only
  mechanism to restore a whole view-scoped mixer scene in one gesture.

### 1.3 The engine overlay/compositing stack (what "overlays" means here)

Four distinct layers, composited in this order every frame
(`pattern_mixer.js renderAll6ch`):

1. **Deck channel** → `deckBuffer` (the live show side when `viewFader`→0).
2. **Deck overlays** (max 4, `DECK_OVERLAY_MAX` `pattern_mixer.js:223`) —
   view-scoped `PatternChannel`s composited bottom→top INTO `deckBuffer`
   (:2851-2916). **Structurally never-dark**: a whole-rig/empty view is
   refused (:1083-1092), unselected pixels stay exactly at deck value; one
   overlay per view (409, :1037-1039); shared unison auto-advance clock
   (:276-288); blend modes `blend_screen|add|over` only; per-overlay hue,
   fader, faderMax, accent color. Docs: `docs/39` §6.o.
3. **Mixer channel stack** — base seeds `mixerBuffer`, each overlay channel
   blends then commits **only at its `compiledPixelMask` pixels**
   (background-preserving, `docs/27` §2); solo/group/follow gates apply.
4. **deck↔mixer crossfade** — `lerp(deck, mixer, viewFader)`; ramp
   `viewFaderRampPerSec = 1.0` is **hardcoded** (`pattern_mixer.js:410`,
   tick :2744-2762) — no API exposes it.
5. **Global effects (GEM)** — post-mixer chain over the final buffer:
   preWash(freeze) → colorWash → waterlineSweep → trails →
   postTrails(sparkle) → dropHit → strobe/invert/crush → pump/breath
   (`lib/global_effects_controller.js:418-447`). **Whole-rig only — no view
   scoping anywhere** (grep-verified: no viewSelection/mask in the GEM
   path). Spatiality exists only via pixel coords (waterlineSweep axis
   bands, `effects/e2_waterline_sweep.js`) and via channel choice
   (frost sparkle + vintageWhite/blastWhite write W only — safe under hue/
   invert, and W reads correctly on both DMX pars and RGBW strands thanks
   to the LED↔DMX parity work, report `20260618_6`).

**Hot-reload behavior (matters for playa re-patching):** a sim save →
`setModelViewMasks` rebuilds the MaskRegistry and **recompiles every
channel + deck-overlay mask** (`engine.js:1621` → `pattern_mixer.js:821-847`);
a channel whose view vanished keeps its previous mask and logs loudly
(show keeps rendering). A pixelCount change refuses hot-reload (restart
required), and **G10** (`output_dispatch.js:203`, foundation §G10) means a
freshly patched universe transmits nothing until engine restart — fixed in
slice 20260724_3 (verify merged before playa).

### 1.4 Titanic scene/model state (the data the views stand on)

- `views.yaml`: 28 groupBits — 12 DMX generator groups + 16 strand groups
  (8 large `Left_/Right_*` + 8 `Small_*`); **`custom: []`** — zero authored
  views. (Foundation §1.3 said "one per LED strand" — it's actually mixed
  DMX+LED, and 28 strands share the 16 strand groups.)
- **Engine model STALE**: `models/titanic.js` = 1,147 px (480 LED = 12
  strands era; 450 ShehdsBar / 96 VintageLed / 41 UkingPar / 80 TeLedGrid40).
  Current scene: 84 DMX fixtures (38 UkingPar, 24 ShehdsBar, 20 VintageLed,
  2 TeLedGrid40) + **28 strands × 40 px = 1,120** → ≈ 1,790 px on next
  export. Every auto-view count in report `20260619_5` is out of date.
- **Group-name normalization REGRESSED**: the Jun-19 rehaul renamed the two
  asymmetric groups to `…Generator`, but only in the trace `groupName:`,
  `views.yaml`, and the generated model files. The 12 per-fixture `group:`
  fields in `scene_config.yaml` still read `Left Center Auditorium` (7 px,
  :501-597) and `Left Back Wall` (5 px, :613-677) — and the exporter takes
  `light.group` (per-fixture) as truth (`pixelblaze_model_exporter.js:89`).
  Next export: those two `views.yaml` bits (16, 512) match zero pixels, the
  two `_BOTH` composites un-pair, and `reconcileGroupBits` will mint two new
  drifted group names. **Must fix before regen** (the sim group-rename tool
  at `gui_builder.js:1743-1755` does it cleanly, or a YAML edit).
- 0% patched (foundation §1.3) → CTRL_* auto-views dormant; engine
  `config.yaml` declares only `Titanic-202` sACN U10/U12 — nowhere near the
  full rig's universe map.

---

## 2. Playa usage scenarios — how we'd actually drive views at night

Framing: BM26 nights run roughly dusk→sunrise; the codex mission ranks
**exterior visibility at night as mission-critical**, then rooms, then
party/fun. The operator surfaces are: **timeline** (zero-touch), **autopilot**
(pattern churn), **CaptainPad** (touch: mixer strips, deck overlays, decks),
**VSN1** (global effects), **APC mini** (channel focus, blackout).

### S1 — Sailing ambient (default night, most hours, zero-touch)

- **Look:** whole-ship slow washes; strands trace the hull silhouette; pars
  give fill + throw. No view masking needed on the base — the deck/base runs
  `type:'all'`.
- **Views:** optionally ONE deck overlay on `CHIMNEYS` (or
  `Top Chimney Generator_BOTH`) with a slow accent playlist — the smokestacks
  are the ship's signature and deck overlays are structurally never-dark.
- **Overlays/effects:** `breath` calm-8s always-on; `sparkle` fizz for ice
  texture. Both are W/luma-safe.
- **Surface:** timeline `sun dusk` cue → ambient `look` + autopilot active;
  operator touches nothing. **Gap:** the overlay itself can't be
  cue-scheduled (only enable/disable-all) — it must be configured once and
  left enabled, which the persistence in `deck_state.yaml` supports.

### S2 — Party mode (Titanic parties, operator present)

- **Look:** high-energy patterns on the party zones, exterior stays lit.
- **Views:** mixer base = `all` wash (never-dark floor); overlay CH →
  `DECKS` with party_high playlist; overlay CH → `AUDITORIUM` (the dance
  space) with the peak playlist; optional CH → `WALLS` kept on a calmer
  high-visibility wash so the ship reads from the playa even mid-rave.
  Strand-group deck overlays (`Small_*`, `Left_Front_*`…) for hull chases.
- **Overlays/effects:** the whole GEM arsenal (strobe, dropHit, kickPunch,
  beatPump, crush) — whole-rig is *correct* here.
- **Surface:** CaptainPad mixer + VSN1 grid + APC (track focus,
  clip_stop autopilot, stop_all blackout). This is the scenario the current
  tooling already serves best — **once the picker shows the structural
  views**.

### S3 — Deep-playa visibility / beacon (mission-critical, all night)

- **Look:** slow, high-contrast, W-heavy — white reads farthest and the
  parity work means W lands on pars AND strands.
- **Views:** `BAND_HIGH` (top third: chimneys + upper superstructure —
  visible over dust and art cars) driven brighter/steadier than the rest;
  `CHIMNEYS`; proposed authored `EXTERIOR` (see §3) as the guaranteed-lit
  set. `@VINTAGE` (the marquee-style fixtures) as a constant twinkle.
- **Overlays/effects:** `vintageWhite`, `blastWhite` for punctuation;
  `waterlineSweep` on axis y — the "rising tide" up the hull is a
  recognizable-from-2-miles gesture that needs **no view at all** (pure
  geometry).
- **Surface:** this should be *policy*, not a hand-driven mode: the ambient
  playlist's patterns should themselves respect exterior emphasis (patterns
  can use `inView("BAND_HIGH")` etc. — the intrinsic auto-promotes bits),
  and the timeline's night phases keep it active. **Gap:** nothing enforces
  "exterior minimum brightness" today; see §4 proposal T5.

### S4 — Room lighting (passengers must have light)

- **Views:** `AUDITORIUM` exists; everything else interior needs the
  operator to say **which fixtures count as "rooms"** — likely a new
  authored `INTERIOR` view (and possibly per-room groups when the interior
  build settles). Interior fixtures on a mixer channel masked `INTERIOR`,
  warm static/slow patterns, independent fader so a party never strobes the
  chill room.
- **Surface:** set once per night via CaptainPad; a timeline `look` should
  eventually own it (gap W4).

### S5 — Sunrise (the payoff moment)

- **Views:** none required — whole-ship; optionally `PORT`/`STARBOARD`
  split for a two-tone dawn gradient (both exist free).
- **Overlays/effects:** `breath` sunrise-20s preset; colorAutopilot palette
  drift to warms — both already timeline-schedulable (`sun sunrise
  offsetMin:-15` cue exists, `show_plan.js:952-960`).
- **Surface:** timeline, zero-touch. This scenario is basically READY today.

### S6 — Emergency / blackout / misbehaving hardware

- **Blackout:** APC `stop_all` → engine blackout (whole rig) — exists.
- **Isolate a bad controller:** once patched, `CTRL_<n>` auto-views give
  exactly this: mask a channel to `CTRL_5` to see what it drives, or set the
  base's view to `CTRL_5` + `invert:true` to keep the show alive everywhere
  EXCEPT the flapping controller. Zero authoring needed — **but blocked on
  patching, and invisible until CaptainPad reads `namedViews`.**
- **Never-dark:** deck overlays are structurally incapable of blacking the
  exterior (`pattern_mixer.js:1083-1092` + docs/39 never-dark rule) — good.

### S7 — Strike (< 2 h, codex requirement)

- **Views:** `CTRL_<n>` as work-lights — a "strike look" that steps through
  controllers full-white so crews can see what's still powered and find each
  box's fixtures; `@PAR` / `@BAR` / `@VINTAGE` / `@RAW` as family checklists
  ("all bars dark? bars are packed").
- **Surface:** CaptainPad; worth a canned playlist (`strike.yaml`) of static
  whites per CTRL view so it's one tap at 8am. Cheap to author once patched.

**Cross-cutting observation:** S1/S3/S5 (the zero-touch, mission-critical
nights) are exactly the scenarios that need **timeline/looks to carry views
and overlays** — today only S2 (operator-present party) is fully drivable.

---

## 3. View taxonomy proposal (concrete)

### 3.1 Ships for free after regen (auto-views — do NOT author these)

PORT, STARBOARD, FORE, AFT · WALLS, DECKS, CHIMNEYS, AUDITORIUM ·
@PAR, @BAR, @VINTAGE, @RAW · BAND_LOW, BAND_MID, BAND_HIGH ·
LEFT, RIGHT (LED-only) · 16 per-strand groups · ~14 `<base>_BOTH` pairs ·
CTRL_&lt;n&gt; per controller (after patching). Plus the 28 base groups.

Expected total ≈ **60+ named views, zero authoring, zero bits** — they
regenerate on every model load and cannot go stale. The taxonomy strategy is
therefore: **author only what the geometry can't derive.**

### 3.2 Authored Tier-C views to ship in `views.yaml custom:` (proposal)

| Name | Membership (proposed) | Why it can't be auto | Used by |
|---|---|---|---|
| `EXTERIOR` | union: WALLS + DECKS + CHIMNEYS groups + all 28 strands + @VINTAGE | "exterior vs interior" is a *policy* boundary, not a geometric one | S3 beacon, never-dark policy, patterns via `inView` |
| `INTERIOR` | complement set the operator designates (auditorium interior + future room fixtures) | operator decision D2 | S4 rooms |
| `HULL` | the 8 large `Left_/Right_*` strand groups | "hull outline" is semantic (Small_* are not hull) | S1/S3 silhouette patterns |
| `SMOKESTACK_TIPS` | top segment of chimney fixtures (if distinguishable) or = CHIMNEYS | finer than the group token | S3 beacon, docs/03 smokestack rings DNA |
| `WATERLINE` | bottom-most strand/fixture run along the hull | BAND_LOW includes non-hull low fixtures | waterline gags, e2 sweep anchor |
| `BOW`, `STERN` | fore/aft *extremes* (tighter than FORE/AFT halves) | FORE/AFT are halves, not tips | party chases, "iceberg ahead" bits |
| `SAFETY_MIN` | the minimal set that must NEVER go dark (operator picks; likely chimneys + one wall band + perimeter) | pure policy | T5 exterior-minimum guard, emergency |

7-ish authored views ≪ 34 free in-VM slots; most can even stay Tier-A
(`bit:0`) unless a pattern `inView()`s them — the intrinsic promotes on
demand. Naming: keep the established conventions (UPPER for whole-ship
semantics, `@` reserved for typed, `CTRL_` reserved for controllers).

**Authoring mechanics:** sim Views panel → `views.yaml custom:` →
save/export → sidecar `titanic.viewmasks.js`. Known limitation: the sim
editor can't author **per-fixture (pixelIndices) word-1** views yet
(Tier-C report `20260619_4` §9.2) — group-composed customs (everything in
the table above) are fine.

### 3.3 Prerequisites (order matters)

1. **Fix the 12 regressed `group:` fields** (`Left Back Wall` →
   `Left Back Wall Generator`, `Left Center Auditorium` →
   `Left Center Auditorium Generator`) — sim rename tool or YAML edit.
2. **Regenerate the model** (manual GUI save today; the model-staleness CI
   guard is foundation slice P-D) and verify auto-view counts partition
   (~1,790 px: PORT∪STARBOARD, BAND thirds, typed union).
3. Then author §3.2, then patch (CTRL_* appear), in any order.

---

## 4. Engine overlays plan — setup + tuning

The compositing engine needs **no structural work** — the gaps are
reachability, automation, and knobs:

- **T1 — Surface `namedViews` in CaptainPad (the unlock).** Parse
  `namedViews` in `fetchViewSelectionOptions` (`utils/api.ts:1236`), render
  the picker grouped by family with a filter box (60+ rows won't fit the
  current 420px flat list — `mixer.tsx:1110`), reuse in
  `DeckOverlayStack`'s `ViewPickerModal`. Engine assist: include each
  auto-view's `family` in the `/model/view-selection-options` payload
  (engine currently logs families but doesn't expose them —
  `engine.js:527-530`, `api_server.js:5949-5958`).
- **T2 — Timeline looks carry views/overlays.** Extend `look` validation
  (`show_plan.js:291-307`) with either (a) `snapshot: <id>` recall (snapshots
  already serialize `viewSelection`, `snapshot_manager.js:10` — least new
  surface, morph included) or (b) explicit `channels:` viewSelection maps +
  a `deckOverlays:` set. Recommend (a) first: "capture the party look as a
  snapshot, let the 02:00 cue recall it."
- **T3 — Expose `viewFaderRampPerSec`** (hardcoded 1.0,
  `pattern_mixer.js:410`) via config/API so the deck⇄mixer switch reads as
  a graceful 2-4 s dissolve from deep playa rather than a 1 s cut. Same
  pass: decide default deck-overlay `blend_*` + fader defaults per scenario
  (party = screen, ambient = over at ~0.6).
- **T4 — (Optional, decide-later) view-scoped global effects.** GEM effects
  are whole-rig (`global_effects_controller.js:418-447`). Before building
  masking into the chain, note the cheap outs: waterlineSweep is already
  spatial; sparkle/vintageWhite/blastWhite are already channel-scoped (W);
  and anything needing a view can run as a deck overlay or masked mixer
  channel instead. Only build this if show design demands e.g.
  "strobe DECKS only" as a *global* effect. **Operator decision D5.**
- **T5 — Exterior-minimum guard (mission).** A small engine check (or
  autopilot/timeline policy) that warns loudly when `SAFETY_MIN` pixels sit
  below a luminance floor for > N seconds while in a night phase. Cheap
  telemetry version first (log + CaptainPad badge), never an auto-brighten
  fallback (codex P0).
- **T6 — Verify hot-reload + routing under re-patching** (ties to G10 fix,
  slice 20260724_3): patch → regen → confirm masks rebake
  (`engine.js:1621`) AND new universes transmit; add the titanic-scale
  round-trip test from the foundation matrix.
- **Naming hygiene (cosmetic, with T1):** rename the VSN1 `sb_1` label and
  the MIDI `viewToggle` action away from "VIEW" — after T1, "view" should
  mean pixel views everywhere an operator reads it.

---

## 5. Work breakdown

| # | Slice | Est. | Blocked on |
|---|---|---|---|
| W1 | **T1 CaptainPad namedViews picker** (+ engine `family` field, filter UI, both modals) | ~1 d | nothing — build now |
| W2 | **Group-name drift fix + model regen + auto-view count verification** (§3.3) | ~0.5 d | nothing — build now (sim save is manual; do it in one sitting) |
| W3 | **Author §3.2 custom views** in views.yaml + sidecar regen | ~0.5-1 d | W2; operator decisions D1-D3 |
| W4 | **T2 timeline snapshot-look recall** (+ tests) | ~1-2 d | nothing technically; show design (D4) shapes the cue list |
| W5 | **T3 ramp/blend tuning knobs** + per-scenario defaults doc | ~0.5 d | nothing — build now |
| W6 | **Scenario playlists/looks** (ambient-night, party_high/low, strike, sunrise) — note party playlists still don't exist (now.md 2026-07-10) | ~1-2 d | D4 show design; W3 for view-scoped entries |
| W7 | **T5 exterior-minimum telemetry** | ~0.5-1 d | W3 (`SAFETY_MIN`), D3 |
| W8 | **T4 view-scoped global effects** | ~1-2 d | **decision D5 — recommend defer** |
| W9 | CTRL_* strike look + playlist | ~0.5 d | patching (foundation P-A/P-B/P-C) + G10 fix verified |

**Build-now set (no operator input needed): W1, W2, W5** — together they
make every existing view reachable and the switches tuned. W4 next. W3/W6/W7
land as soon as the decisions below arrive; W9 after patching.

## 6. Operator decisions needed (explicit)

1. **D1 — Confirm the group-name fix direction**: normalize the 12 fixtures
   to `…Generator` (keeps views.yaml/bits/model continuity) rather than
   renaming the other 10 groups down. (Recommended: yes, normalize up.)
2. **D2 — What counts as INTERIOR/rooms**: which fixtures (today and
   planned) belong to `INTERIOR` — and should rooms get per-room groups?
3. **D3 — `SAFETY_MIN` membership**: the minimal never-dark exterior set
   (proposal: chimneys + upper wall bands + at least one hull strand run
   per side).
4. **D4 — Show design for the night arc**: named looks per phase
   (dusk-ambient / party / late-night beacon / sunrise) so W4/W6 encode
   them; also whether the two TeLedGrid40 panels ("TE LED Grids" group) get
   a dedicated authored view (marquee/logo duty?).
5. **D5 — View-scoped global effects: needed or not?** (Recommend: defer;
   deck overlays + masked channels cover the known cases.)
6. **D6 — BAND thirds vs authored heights**: BAND_LOW/MID/HIGH are
   model-relative thirds; if show design wants a true `WATERLINE`/
   `SUPERSTRUCTURE` split at specific heights, that's an authored view
   (already in §3.2) — confirm which the looks should use.

---

## Coverage gaps / honesty notes

- **No live probes were run** — the sim/engine were not booted in this
  session (shared stack running; doc-only slice). All behavior claims are
  code-read + prior-report grounded; the auto-view counts for the CURRENT
  scene (~1,790 px estimate) are computed from scene YAML, not from an
  actual export.
- The exact pixel-per-fixture counts (ShehdsBar 18/19 px etc.) were
  inferred from the stale model's ratios; the ~1,790 total is ±small.
- `timeline` `look`/`scene` runtime application was read at validation +
  dispatch level (`show_plan.js`, `timeline_service.js:636-670`), not
  exercised.
- The claim "CaptainPad never reads `namedViews`" was verified in
  `utils/api.ts` (type + parse) and by repo-wide grep (zero TS hits); a
  dynamic `data` passthrough exists (`return { ok:true, data }`) but no
  consumer references the field.
- Whether `sections`/`fixtures` pickers should ALSO surface (currently
  deliberately hidden, `mixer.tsx:1076-1082`) was left out of scope — the
  named-view families cover the operator vocabulary better.
