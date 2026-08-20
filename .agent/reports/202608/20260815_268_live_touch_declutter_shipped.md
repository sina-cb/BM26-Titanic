# _268 — Live Touch declutter SHIPPED: spatial + color breathe, audio bars minimal and hideable, portrait topbar earns its second row

**Role:** Opus lead on the operator pipeline (three Sonnet implementers, my
validation walk). **Contract:** `docs/65_live_touch_declutter.md` (W0–W5),
design `_262`. **Follows:** `_261` (handoff curtain, confirmed landed before
any implementer started). **Surface:** the sim-served touch panel,
`docs/ui/touch_control.html` + `touch_control_wire.js`.

All six design defaults (D1–D6) shipped as specified. Every acceptance gate
passes. Two real defects were caught by my walk and fixed before landing.

---

## 1. What shipped

| W | Slice | Agent |
|---|---|---|
| W0 | Embedded baseline matrix | me |
| W1 | Audio strip minimal + hideable (`html` + `wire`) | Sonnet A |
| W2 | Spatial pane declutter (`html`) | Sonnet B |
| W3 | Color pane declutter (`html`) | Sonnet C |
| W4 | Portrait topbar (`html`) | Sonnet C |
| W5 | Validation walk + two fix rounds | me |

**File scope, measured against a frozen wave-start snapshot** (not `git diff`,
which also carries other waves' uncommitted work): `touch_control.html` 499
lines, `touch_control_wire.js` 11 lines, and **zero** lines in
`touch_control_theme.js`, `touch_control_pixel_views.{js,json}`,
`touch_control_group_profiles.js`, `touch_control_passcode.js`,
`touch_control_lifecycle.js`.

## 2. Measured before → after (embedded, real gruvbox tokens, both iPad viewports)

Captured through a scratch iframe host that speaks the actual theme bridge, so
these are embedded numbers, not standalone ones (`captainpad-embedded` +
`theme-applied` + a completed `theme-ready → theme-applied` handshake asserted
on every run).

| Surface | Landscape before → after | Portrait before → after |
|---|---|---|
| Audio strip | **134 → 54 px** (−60 %) | **134 → 54 px** |
| — card / trace | 87 → 46 / 42 → 20 | same |
| Color panel wheel | 202×202 → **248×248** | **185×320 ellipse → 320×320 round** |
| — slot column | 168 w × 182 h → chip row | 168 w × **353 h** → chip row |
| — scheme actions | 45 px × 2 rows → **36 px × 1 row** | same |
| sp-controls | 134 → **61** | 148 → **61** |
| drawHelp | 29 → **0** (behind ⓘ) | 43 → **0** |
| **XY pad frame** | **170 px, pad clipped 130 px → 319 px, clip 0** | 327 → 470, clip 0 |
| Topbar | 54 px (**byte-identical**) | 54 → 94 px (two rows) |
| — pattern select | 160 px (unchanged) | **20 px → 438 px** |
| FOLLOW NOTE | 32 px (untouched) | 32 px (untouched) |

Two baseline corrections to `docs/65`: the portrait pattern **select** measures
20 px, not 34 px (34 px was the whole PATTERN group); and the landscape pad was
clipped **in SPATIAL mode too**, not only XY — `sp-controls` held 134 px in
both modes, so the clipping was mode-independent.

## 3. Gate results

**Transport grep gate — PASS 4/4.** `touch_control_theme.js` byte-identical
(md5 `0418472d…`); the `window.parent !== window` + `captainpad_embed=native`
first-paint gate byte-identical; the wire's single `CaptainPadEmbed` touchpoint
byte-identical; occurrence counts for `buildTransport` /
`__captainpadDeliver` / `captainpad_embed` / `CaptainPadEmbed` all unchanged.
The gate compares **text, not line numbers** — unrelated edits legitimately
shift lines, and an early version of the gate red-flagged exactly that.

**Acceptance — 14/14 PASS.** Strip ≤ 56 px (54 measured, both viewports) ·
sub-line gone · wheel round both orientations · pad unclipped and ≥ 300 px in
landscape · portrait select ≥ 300 px (438) · FOLLOW NOTE visible with live
`nf-state` in every state · no console error beyond the baseline harness set.

**Landscape topbar byte-identical — PASS.** `.topbar` and every direct child
box identical to baseline: brand 222×28 @29, ARM 206×32 @263, pattern-pick
376×32 @482, top-actions 467×32 @870. (I re-ran this myself rather than accept
the implementer's argument, which had been made after a raw PNG diff came back
unequal.)

**Axis labels (the §2.4 floor), proven by measurement not eye:** baseline
`Y− STROBE OFF` sat at y 709–724 against a frame bottom of 601 — **outside the
frame**. After: 539–554 inside a frame bottom of 561 — **inside**. Both Y
labels and both X labels on screen at 1366×1024 with everything default.

**Suppression captions are truthful.** XY mode shows
`SIZE · POWER · FADE · STEP · TAKE — SHOWN IN SPATIAL MODE` and collapses
exactly `recRow, sizeRow, powerRow, fadeRow, stepRow`; SPATIAL shows
`Y AXIS · ON TIME — SHOWN IN XY MODE` and collapses exactly `xyRow, dutyRow`.
DRAW/INK side columns stay dim-never-hidden in both. **I corrected the doc's
draft caption during the wave:** `docs/65` §2.1 drafted `DRAW · …` into the XY
caption, but DRAW is a side column that remains on screen — a caption claiming
it left would have been a lie on the operator's panel.

**Hidden state survives.** `#zVal` and `#strobeDuty` still in the DOM holding
values while collapsed; every button inside a collapsed row still `disabled`,
so the keyboard gate the old dimming bought is intact.

**Persistence — 4/4.** No store → strip open, rail `[PRESETS]`. Store without
`meter-strip` → strip open, rail `[PRESETS]`, **byte-identical to the pre-wave
boot**. Store with `meter-strip` → docked (height 0), rail `[PRESETS, AUDIO]`,
survives reload. Corrupt store → open, rail intact, and a loud
`[layout] could not read:` error. `MIN_OPEN` never counts the bar: the strip
docks with exactly one panel open.

**docs/61 narration spot-check** — driven by real gestures, no engine needed
(follow-note narration is panel-local). `off → MASTER · A → COMPLEMENT · E`
after a scheme tap, cyan, in a full-width 32 px bar, identical to baseline in
the decluttered pane.

**VIEW chip pad-stroke collapse** — the one sub-case the implementer could not
exercise, because `installInteractionGate` registers capture-phase
`stopImmediatePropagation` on the pad and blocks all pad pointer events until
static+engine verification. Proven **without** an engine by instrumenting
`addEventListener` at load: the chip's collapse handler is registered
bubble-phase on `#xyPad` (2 capture listeners = the gate; 6 bubble), and
invoking it collapses the toolbar. Chip cycles `VIEW ⌄ → VIEW ▴ → VIEW ⌄`
correctly, hit-tests to itself (nothing overlays it), and expanding it keeps
the frame at 319 px / clip 0 — it costs zero flow height, as designed.

**Tests.** Panel suites 59 pass / 1 fail, unchanged from the pre-wave verdict I
recorded before any implementer started. Broader sim sweep: **2086 pass /
7 fail of 2094**, running the 125 of 140 sim tests that do not bind ports (the
other 15 would have collided with the operator's live stack — deliberately not
run, per batch order).

## 4. Foreign reds (not ours)

All 7 sim failures are pre-existing and belong to the concurrent scene/bench
work; none reference `docs/ui` or `touch_control` (verified by grep):
`touch_control_pixel_views` → "Live display orientation is a pure projection of
authoritative 3D coordinates" (recorded red **before** this wave began), plus
six scene/fixture/patch/CLI tests in `bench_mirror_state` and
`bench_section_sync`.

## 5. Two defects my walk caught, both fixed and re-verified

1. **Dock chevron overlapped the 9th signal card's value.** The absolutely
   positioned chevron sat on top of `.sig-val` on the last card — 9 px overlap
   in both orientations. Fixed by reserving a 34 px right gutter on the strip.
   Re-measured: zero overlap, height held at 54 px.
2. **Dropping `.sig-sub` collapsed the name column.** `.sig-row` is
   `1fr 46px`, and the deleted sub-line — `white-space: nowrap`, no
   `min-width: 0` — had been the thing propping column 1 open. Without it the
   name track fell 48 → 30 px and **all nine names truncated to `mic…` in
   portrait**. Fixed with `minmax(46px,1fr) 34px` and a 4 px gap. Re-measured:
   landscape 9/9 names fit in full (better than baseline, which ellipsized the
   four long ones); portrait's five short names fit, the four long ones
   ellipsize exactly as they did pre-wave. Values up to 5 characters
   (`20000`) fit the narrowed track without wrapping; strip stayed 54 px.

Both were invisible to the height gate — the acceptance number was green
throughout. They were only findable by measuring text fit and hit-testing
overlap, which is the argument for the walk being separate from the build.

## 6. Deviations from `docs/65`

- **AUDIO rail dot is cyan, not meter-orange.** PRESETS already owns orange;
  two identically coloured rail tabs would reinstate the ambiguity this wave
  removes. Documented in-code.
- **VIEW toolbar relocated inside `#xyPad`** for absolute anchoring (ids and
  handlers unchanged, `touch_control_pixel_views.js` untouched). The doc said
  "on the pad frame's top edge"; this is that, implemented as a child.
- **SPATIAL sp-controls is 61–78 px, not the doc's ~44 px estimate** — only 2
  of 8 rows collapse in SPATIAL, so there is less to win there. Pad still
  clears 300 px in that mode (302 px).
- **`!important` on `.draw-row.is-collapsed`** — a pre-existing three-class
  selector was silently out-specifying the collapse.

## 7. Open item for the operator (one-line veto, not a blocker)

**Opening the ⓘ help re-clips the landscape pad by 18 px** (frame 319 → 282).
It is opt-in, transient, and still far better than the pre-wave 130 px clip,
so it ships as is. If the operator wants it gone, the fix is already proven on
this surface: make the help paragraph overlay the pad the way the VIEW toolbar
now does — the chip-expanded state costs **zero** flow height (frame stays
319 px, clip 0). Portrait is unaffected (clip 0 with help open).

## 8. Ledger

- **Live services untouched.** 6966–6972 / 5568 / 6981 / 7175 never restarted,
  rebuilt or bound; `:6969` verified still serving at the end. All capture ran
  on scratch static serves **:17141** (frozen pre-wave snapshot) and **:17142**
  (working tree), both killed and confirmed down. No engine was started — the
  one sub-case that appeared to need one was proven by load-time listener
  instrumentation instead.
- **Scratch:** `~/tmp/live_touch_declutter/` — `baseline/` (frozen wave-start
  copy of every `docs/ui` file), `w5/` (host harness, serve, measure, compare,
  closeup, transport gate, and the before/after JSON + PNG matrix).
- **Tracked writes:** `docs/ui/touch_control.html`,
  `docs/ui/touch_control_wire.js`, this report, the tracker landing block, one
  dossier row. No git operations.
