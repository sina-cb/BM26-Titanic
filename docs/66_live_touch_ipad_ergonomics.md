# 66 — Live Touch iPad ergonomics: touch targets, finger spacing, and the 11-inch reality

Operator order (verbatim intent): "design for proper touch controls and
optimize for iPad — decluttering some of the views and panes and making them
more iPad friendly is a TOP PRIORITY."

Design status: contract for the standing pipeline (Sonnet implementers, Opus
validation walk). **This builds ON the docs/65 declutter that just shipped
(report `_268`) — nothing that wave landed is redesigned here.** Surface:
the sim-served touch panel (`CaptainPad/live_touch/touch_control.html` + siblings), hosted
by CaptainPad in an iframe (web) / webview (native). Scope is **geometry,
spacing, and affordance only** — every tuned gesture behavior (wheel, brush,
spatial pad pointer code, wire semantics, ARM chains) is frozen, exactly as
docs/65 §6 froze them.

---

## 1. Measured post-_268 baseline at the 11-inch viewports

docs/65/_268 measured and validated at 12.9-inch viewports (1366×1024,
1024×1366). The operator's priority is a *real iPad*, so this pass measured
the post-_268 panel at the **11-inch** logical sizes — 1194×834 landscape,
834×1194 portrait (standalone serve, puppeteer, DPR 2; 1 CSS px = 1 pt).
Every visible interactive control was measured from its live
`getBoundingClientRect`, not read out of CSS: 151 controls per orientation.

**Headline: 150 of 151 measured controls are under the 44 pt touch floor;
137 (landscape) / 141 (portrait) are under 32 pt.** The only element ≥44 pt
is the PRESETS rail tab (30 px wide but full-height).

### 1.1 Key controls (w×h in CSS px ≈ pt)

| Control | Landscape 11" | Portrait 11" | Live-show role |
|---|---|---|---|
| **ARM toggle** | 206×**32** | 206×**32** | safety — pinned ≥44, currently below it |
| TAP (bpmSync) | 56×**24** | 56×**24** | tapped rhythmically mid-show |
| BPM − / + | **24×24** | 24×24 | performance |
| Pattern select | 71×**24** (crushed) | 240×24 | performance |
| ON TIME pills 10/25/50/75/90 | 28×**17**, 3 px gaps | **10×17** — sliver | performance (XY mode row) |
| SPEED pills ¼×…2× | ~30×**17** | ~14×17 | performance |
| XY/SPATIAL mode | ~110×28 | ~90×30 | performance |
| DRAW column (POOL/TRAIL/ERASE/IGNITE) | 56×**40** | 52×**31** | performance (SPATIAL) |
| INK column (ONE/MASTER/HUE/COMP/CLASH) | 48×**31** | 48×**24** | performance (SPATIAL) |
| Scheme actions (MASTER/HUE/…) | ~120×**36** | ~100×36 | performance |
| Palette slot rows (`[data-slot]`) | 85×**46** ✓ | 48×**46** ✓ | performance — the one PASS |
| FOLLOW NOTE bar | 538×32 | 354×32 | pinned surface (docs/61) — visible, fine |
| Colour wheel | **153×153** | **124×124** | performance — small for precise hue picks |
| XY pad | 414×300 | 230×300 | the point of the panel |
| VIEW ⌄ chip | 49×**26** | 49×26 | setup (docs/65 §2.3) |
| ⓘ help toggle | **16×10** | 16×10 | setup |
| Panel lock / collapse (🔓 ▾) | 26×**26** / **16×16** | same | setup |
| Effect pickers (`.fx-pick`) ×16 | ~130×**18** | ~110×18 | performance-adjacent |
| Effect audio route (`.aud-pick`/LVL) ×32 | ~×**21** | same | setup |
| Group ON buttons | ~90×28 | ~100×28 | performance |
| Group LOCK / fader LOCK | 60×**30** | 60×30 | performance-adjacent |

### 1.2 Eleven-inch-only layout defects (12.9 numbers do NOT transfer)

- **P1 — portrait meter strip balloons to 420 px.** At 834 px width the page
  layout stretches `#meterStrip` to 420 px of mostly empty panel background
  while its only child `.meter-bars` stays 46 px (measured: strip 420,
  child 46). Roughly a third of the portrait screen is dead space above
  COLOR. The _268 "54 px both viewports" result holds only at ≥1024 width.
  Additionally the nine cards crush to ~85 px and their name/value labels
  collide ("0.10micMid" run-ons, screenshot in the landing report).
- **P1 — groups pane clips mid-column in portrait** with no scroll
  affordance: the sixth column's ON/LOCK are half-drawn at the pane edge;
  nothing indicates 18 more groups exist to the right.
- **P2 — landscape wheel is 153 px** (not the 248 px _268 measured at
  1366×1024) and portrait is 124 px — precise hue picking with a finger
  under show pressure needs ~200 px minimum.
- **P2 — portrait ON TIME / SPEED pills collapse to 10–14 px wide** —
  they are decorative at that size, not controls.

## 2. Design principles for the pass

1. **Hit target ≠ visual size.** The 44 pt floor applies to the *hit
   region*. Small-looking chrome may keep its visual weight and grow its
   touch slop (padding, or an `::after` overlay expanding the target) —
   the proven recipe already on this surface: the palette slot rows draw a
   32 px swatch inside a 46 px `[data-slot]` row and PASS. Visual redesign
   is NOT required to fix a hit target.
2. **Hit-priority tiers.** Performance-tier controls (used mid-show, dark
   playa, maybe gloves) get true 44 pt visual+hit and first claim on space:
   ARM, TAP, mode toggles, ON TIME, SPEED, DRAW/INK columns, scheme actions,
   slot chips, group ON, effect pickers. Setup-tier controls (VIEW chip, ⓘ,
   locks, collapse chevrons, aud-pick routing) may stay visually small but
   must still reach 44 pt hit regions and 8 px of separation from
   performance controls so a miss is inert, not destructive.
3. **Finger slop between neighbours ≥ 8 px** wherever two adjacent controls
   have different consequences (ON TIME pills currently sit 3 px apart).
4. **The 11-inch viewports are the acceptance viewports.** 1194×834 and
   834×1194 join 1366×1024/1024×1366 in every measured gate; a number that
   only holds at 12.9 inches is a miss (that is exactly how §1.2 happened).
5. **Restraint stands.** docs/65 pins carry forward verbatim: `_252` embed
   transport untouchable; docs/61 narration (FOLLOW NOTE bar, `nf-state`,
   status pill) never hidden or shrunk; safety surfaces (ARM, status pill,
   FOLLOW NOTE) never hideable — and per this order, **never under 44 pt**,
   which ARM currently is (32 pt): raising it is a P1 W-item, not a debate.

## 3. Per-pane prescriptions

### 3.1 Topbar

- ARM row grows so the ARM toggle (label + switch capsule) is ≥44 pt tall in
  both orientations; landscape topbar may grow 54→~64 px to buy it — the
  operator's "horizontal looks okay" predates the 44 pt order and _268's
  byte-identical-landscape gate is explicitly superseded here for this one
  row (document it in the landing report).
- TAP becomes a ≥44×44 pill (it is drummed on); BPM −/+ get 44 pt hit
  regions (visual ± glyphs may stay); the pattern select gets ≥32 pt of
  height with the 44 pt hit region on its full row. Landscape select width
  (71 px at 11") needs the same flex treatment portrait got in docs/65 §5.
- The portrait two-row grid from docs/65 stays; no third row.

### 3.2 Spatial / XY pane

- ON TIME and SPEED become full-width segmented rows: 44 pt row height,
  segments flex-1, ≥8 px separation. Cost ≈ +54 px over the current 17 px
  micro-pills; paid for in XY mode by the space docs/65 already freed (pad
  frame 319 px vs 300 px floor) and, where needed, by the §3.5 strip fix.
  Acceptance keeps the docs/65 floor: pad unclipped, both axis labels
  visible, at **1194×834** with rows at 44 pt.
- DRAW and INK side columns: 44 pt row height in both orientations
  (portrait INK is 24 pt today). The columns stay flanking the pad
  (operator-placed, docs/65 §2.1); they may narrow visually but the hit
  region spans the full column width.
- VIEW chip and ⓘ keep their size and gain 44 pt hit overlays; ⓘ (16×10
  today) is the worst offender on the panel.
- The pad itself: no behavior change. Portrait 11" gives it 230 px width —
  see §3.6 pane stacking, which is where that is won back.

### 3.3 Color pane

- Slot rows already pass (46 pt) — pin them so they never regress.
- Scheme action row 36→44 pt.
- The wheel gets a `min(280px, available)` size target at 11" landscape and
  portrait; combined with §3.6 stacking, expected ≥240 px in both
  orientations (vs 153/124 today). Gesture code reads the element box —
  size-only, behavior-frozen.
- FOLLOW NOTE bar: untouched at 32 px full-width per docs/61 — it is a
  narration surface, not a repeatedly-struck control; its hit region already
  spans the panel width and exceeds 44 pt in area. If the validation walk
  disagrees on tap comfort, growing it is a one-line height change that must
  never pass through a disclosure.

### 3.4 Effects pane

- Effect picker rows (18 pt) and LVL/route selects (21 pt): 44 pt hit rows,
  two-column grid at 11" portrait instead of four crushed columns. Card
  count and picker semantics unchanged.

### 3.5 Audio meter strip (P1 defect first)

- Fix the container stretch: `#meterStrip` is being sized by its parent row
  at ≤~900 px width — cap the strip's layout row to content height at every
  width. Acceptance: strip ≤56 px at **834×1194** (the docs/65 gate, now at
  the 11" viewport).
- Cards get a `min-width` that keeps name/value legible (~110 px) with the
  strip scrolling horizontally instead of crushing — overflow is scrollable,
  labels never overlap. The 34 px dock-chevron gutter from _268 stays.

### 3.6 Pane layout at 11 inches (the space that pays for 44 pt)

Portrait 834 px cannot honestly hold two panel columns: it is the direct
cause of the 124 px wheel, 230 px-wide pad, and sliver pills. Below a
~900 px viewport width the panel rows go **one-up** (each panel full-width,
stacked), restoring ~400 px of width to every pane; the dock rail, MIN_OPEN
floor, and `bm26_touch_layout_v2` store are unchanged (this is a render
breakpoint, not a new layout system). Landscape 1194 keeps two-up.

### 3.7 Groups pane

- Group ON 28→44 pt, LOCK hit region to 44 pt (visual may stay 30 px).
- Horizontal overflow becomes an explicit affordance: scroll-snap per
  column block, plus a right-edge fade + "N more ▸" count so 24 groups
  never silently truncate at 5½.
- MASTER fader: hit slop to ≥44 pt width (thumb travel is vertical; width
  is the miss axis).

## 4. App-wide observations (noted, not scoped here)

- The same 44 pt audit (one puppeteer evaluate, ~20 lines) should run on the
  deck, mixer, and dimmer rack CaptainPad tabs — the mixer's nine pixel-view
  bands and the deck chip rows were built to the same density instincts.
  The audit harness from this pass is reusable as-is.
- 1194×834 / 834×1194 should join every future UI wave's standard viewport
  matrix next to the 12.9 sizes — two waves in a row validated only on 12.9.

## 5. Operator decision points (defaults chosen; one-line vetoes)

- **D1 — landscape topbar grows for a 44 pt ARM.** Default: yes (~64 px
  topbar). Veto keeps 54 px and ARM at 32 pt, recorded as an accepted pin
  violation.
- **D2 — one-up pane stacking below ~900 px width (§3.6).** Default: yes.
  Alternative: keep two-up and accept 124 px wheel / sliver pills.
- **D3 — ON TIME/SPEED as 44 pt segmented rows.** Default: yes (+~54 px in
  the sp-controls block). Alternative: 36 pt compromise rows (still 2× the
  current 17 px, under the floor — not recommended).
- **D4 — meter cards scroll horizontally at min-width** instead of crushing.
  Default: yes. Alternative: drop to fewer visible cards at 11" (hides
  signals — not recommended).
- **D5 — groups "N more ▸" affordance.** Default: fade + count chip.
  Alternative: wrap to two shorter rows of columns.

## 6. W-items

**W0 — embedded 11" baseline (any Sonnet, first).** Re-measure §1 embedded
(CaptainPad web dist, real theme tokens, operator's Metro rules) at 1194×834
and 834×1194. Confirms the standalone numbers and the two P1 defects hold
embedded. No product code.

**W1 — P1 defects (Sonnet A).** §3.5 strip stretch + card crush;
§3.7 groups overflow affordance. Files: `touch_control.html` (+
`touch_control_wire.js` only if card markup needs the min-width hook).
Acceptance: strip ≤56 px and zero label overlap at 834 px; groups pane shows
the overflow affordance; 1366/1024 numbers from _268 unchanged.

**W2 — pane stacking breakpoint (Sonnet A, after W1).** §3.6 one-up below
~900 px. Acceptance: wheel ≥240 px and pad ≥300 px wide in portrait 11";
dock/persistence probes from docs/65 W1 all green; 12.9 both orientations
unchanged.

**W3 — performance-tier 44 pt (Sonnet B).** §3.1 topbar (ARM/TAP/BPM/
pattern), §3.2 ON TIME/SPEED/DRAW/INK, §3.3 scheme row. Acceptance: every
control named in those sections measures ≥44 pt hit height at both 11"
viewports; pad unclipped landscape; D1/D3 defaults unless vetoed.

**W4 — setup-tier hit overlays (Sonnet B, after W3).** §3.2 VIEW/ⓘ, panel
locks/chevrons, §3.4 effects rows, §3.7 ON/LOCK/fader slop. Acceptance:
re-run the audit — **zero interactive controls with a hit region under
44 pt in either orientation** (visual sizes may be smaller by design;
audit measures the hit region incl. overlay/padding).

**W5 — validation walk (Opus, last, no product files).** Transport grep gate
(docs/65 W5 verbatim); full audit table before/after at all four viewports;
screenshot matrix; docs/61 narration spot-check in every new state
(stacked panes, scrolled strip, expanded groups); persistence probes;
_268's acceptance table re-run to prove nothing regressed at 12.9.

Sizing: W1 ≈ half a day, W2 ≈ half a day, W3 ≈ a day, W4 ≈ half a day, W5
last. W1/W2 serial (same file regions); W3/W4 serial with each other,
parallel with W1/W2 only if touching disjoint regions is confirmed at
assignment time.

## 7. Evidence

- Captures: `.agent_renders/live_touch_verified_pane.png` (1194×834),
  `live_touch_verified_portrait.png` (834×1194 — shows the 420 px strip and
  the groups clip), taken on the scratch serve from the artifact-freshness
  proof (never the live stack).
- Raw measurements: 151-control audit JSON per orientation, scratch
  `~/tmp/live_touch_freshness_proof/control_audit.json`; §1.2 strip
  diagnosis numbers from a live computed-style probe on the same serve.
