# 65 — Live Touch declutter: spatial + color breathe, audio bars go minimal and hideable, topbar earns portrait

Operator orders (verbatim intent, live iPad testing):

1. "In the Live Touch view, declutter the UI in the spatial XY pane and
   color — A LOT."
2. "The audio signals in that view are taking a lot of the screen on the
   iPad — make them minimal and thinner than even what they are now, and use
   the deck's new audio-signals hide mechanism to make them hideable in Live
   Touch too."
3. (Addendum) "the touch control UI status bar at the top can be 2 rows in
   vertical [portrait]; in horizontal it looks okay — just make sure to
   optimize that as well."

Design status: contract for 2–3 Sonnet implementers + an Opus validation
walk. Surface: the sim-served touch panel — `CaptainPad/live_touch/touch_control.html` +
siblings — hosted by CaptainPad in an iframe (web) / react-native-webview
(native, report `_252`). This is the operator's tuned surface: **restraint,
not a redesign.** Layout only; every control behavior (wheel, brush, spatial
pad gestures, wire semantics) is frozen.

---

## 1. Measured baseline (standalone serve, puppeteer, both iPad viewports)

Captured at 1366×1024 (landscape) and 1024×1366 (portrait). The standalone
blue palette differs from the embedded gruvbox theme (tokens arrive by
postMessage) but geometry is identical.

| Surface | Landscape | Portrait | Verdict |
|---|---|---|---|
| Topbar | 54 px, 1 row, comfortable | 54 px, 1 row — **pattern picker crushed to 34 px** ("PAT" label, zero-width select: unusable) | horizontal fine; portrait broken |
| Meter strip | **134 px** tall, 9 cards | 134 px, 9 cards | operator: too much |
| — per card | 87 px = name/value 10 px + "intensity · out" sub 8 px + **42 px trace** + padding | same, 100 px wide | sub-line is pure repetition |
| Color panel | 650×396 | 479×567 | |
| — wheel | 202 px round | **185×320 ellipse** (stretched, not round) | portrait defect |
| — palette slots | 168 px-wide column, 182 px tall, five 36 px circles + ENGINE/LOCAL text tags | same column, **353 px tall** | a whole column for 5 swatches |
| — scheme actions | 96 px (two-line buttons, 2 rows) | 96 px | subtitles eat a row |
| — FOLLOW NOTE | 32 px full-width | 32 px | fine — keep (docs/61) |
| Spatial panel | 650×396 | 479×567 | |
| — sp-controls | 134 px (8 rows × 2 cols) | 148 px | most rows inert in either mode |
| — drawHelp | 29 px paragraph | 43 px | prose, always on |
| — VIEW toolbar | 26 px (select+PAN+−/100%/+/FIT) | 26 px | setup controls, once per show |
| — XY pad | **CLIPPED: 300 px pad in a 170 px frame** — bottom 130 px including the Y− label cut off | 329×327, unclipped | the pad is the point and it's the casualty |

The mode-inert map (touch_control.html ~3195): in **XY mode** (the default)
`drawRow, sizeRow, powerRow, inkRow, recRow, drawHelp, fadeRow, stepRow` are
all inert — dimmed to .38, buttons disabled — yet each keeps its full height.
Eight of eleven control elements are dead weight on the default screen. In
**SPATIAL mode** only `xyRow` + `dutyRow` are inert.

## 2. Spatial / XY pane (order 1)

### 2.1 Mode-scoped rows replace dimmed rows

An inert row stops occupying space. The rows already carry a per-mode inert
verdict (the `sync()` gate above); the change is `is-inert` → collapsed
(`display:none` on the row), plus **one static micro-caption** where the
hidden set went — the same narration recipe as the deck's suppression caption
(docs/63 §2.4, `PIXELS_BAR_CAPTION`):

- XY mode shows: `Y AXIS` · `ON TIME` · `SPEED`, then the caption
  `DRAW · SIZE · POWER · FADE · STEP · TAKE — SHOWN IN SPATIAL MODE`.
- SPATIAL mode shows: `TAKE` · `SIZE` · `POWER` · `FADE` · `STEP` · `SPEED`,
  then `Y AXIS · ON TIME — SHOWN IN XY MODE`.

The codebase's old rationale ("a control that vanishes reads as a bug")
predates the caption idea: the disappearance is caused by the operator's own
mode tap, and the caption names exactly what left and how to get it back —
the deck contract's answer to the same problem. The DRAW / INK **side
columns** flanking the pad keep today's behavior (dim in XY, never hidden):
they are operator-placed ("beside the hand") and they carry the pad's X-axis
labels, which must stay truthful in both modes.

Element ids, `data-*` hooks, readout elements, and the disabled-button
keyboard gate all survive unchanged — presets and the wire read them
(`#zVal`, `#strobeDuty` etc. are value sources; `display:none` keeps them in
the DOM).

### 2.2 drawHelp goes behind an ⓘ toggle

The four-sentence DRAW_HELP paragraph becomes opt-in: an `ⓘ` chip at the
right end of the sp-controls block toggles it; default hidden. The text,
`paintDrawHelp()`, and the per-mode inert gate are untouched — only its
default visibility changes. Session-local state, no persistence (help is a
learning aid, not a layout preference). While hidden it costs 0 px; SPATIAL
mode with help open behaves exactly as today.

### 2.3 The VIEW toolbar collapses to one chip

`VIEW · PAN · − · 100% · + · FIT` are calibration/setup controls used about
once per show. They fold into a single `VIEW ⌄` chip on the pad frame's top
edge (right-aligned, over the pad's top-right corner, 26 px); tapping expands
the full toolbar row in place, tapping again (or starting a pad stroke)
collapses it. `#spatialFullscreen` (FULL, embed-only) stays beside the chip,
always visible when unhidden — it is a layout escape hatch, not a setup
control. All toolbar element ids and handlers unchanged.

### 2.4 What the pad gets back

Landscape XY mode: sp-controls 134→~44 px (two rows), drawHelp 29→0,
toolbar 31→0 in-flow (chip overlays the frame edge). The `.xy-pad`
`min-height: 300px` floor finally fits: **the pad renders unclipped**,
frame ≈ 310 px (was 170 visible). Acceptance floor: pad fully visible —
both axis labels on screen — at 1366×1024 with everything else default.

## 3. Color pane (order 1)

### 3.1 Palette slots: column → chip row

The five-slot vertical column (168 px wide, up to 353 px tall) becomes one
horizontal row of five 32 px swatch chips directly under the wheel: swatch,
slot number, selection ring. The ENGINE/LOCAL text tags shrink to a 6 px
corner dot on the swatch (cyan = engine, neutral = local) with the full word
in the `title` tooltip; the `slots-head` "Palette" heading is deleted (the
panel is called Color; the sub already says "Slot N selected"). All
`data-slot` hooks, selection logic, and tap targets (≥44 pt row height via
padding) unchanged.

### 3.2 Scheme actions: two-line → single-line

`MASTER / HUE / COMPLEMENT / CONTRAST` drop their subtitle spans into
`title` tooltips: one 36 px row of four segmented buttons (96→36 px). Labels
stay full words. `data-act` hooks unchanged.

### 3.3 FOLLOW NOTE: untouched

docs/61 binds here: the follow-note bar with its `nf-state` narration (which
scheme it is driving, refusal sentences) is the visible cause for
palette writes and **must not be hidden, shrunk below its 32 px, or folded
into a disclosure** by any part of this wave. Same for the status pill —
driving/refusal narration survives every declutter state.

### 3.4 The wheel gets the freed space — and gets round

With the slot column gone the wheel column widens; pin `aspect-ratio: 1` so
the wheel is a circle at every viewport (fixes the measured 185×320 portrait
ellipse — a layout fix, not a behavior change; gesture code already maps
polar coordinates off the element box). Expected: wheel ~260 px landscape,
~300 px portrait (was 202 / 185-wide ellipse). FADE slider column stays as
is beside the wheel.

Net color-panel chrome saved: ~60 px vertical (actions) + the full slot
column width; portrait saves ~250 px of column height.

## 4. Audio signal bars (order 2)

### 4.1 Minimal rendering — thinner than now

The 9 cards keep the companion's visual identity (left accent, name, value,
trace) and lose the repetition:

- Drop the `.sig-sub` type line ("intensity · out") — the trace shape and the
  accent color already say it; the full description moves to `title`.
- Trace canvas 42→**20 px**.
- Card padding 5/6/5/8 → 3/6/3/8; name/value line stays 10 px.
- Card: 87→**~40 px**. Strip (6 px padding + card): **134→~52 px** target,
  a 61 % cut, both orientations. `meter-state` ("waiting for audio…")
  unchanged — it is the strip's failure narration.

Acceptance: measured strip height ≤ 56 px at both viewports, trace still
animating, DOM1/DOM2 log-scale rendering intact.

### 4.2 Hideable — the panel's own grammar, the deck's contract

The deck's mechanism (docs/63) is: surfaces join the ONE existing show/hide
system as a second tier — bars — with chips in the one existing control row,
derived suppression narrated by captions, safety surfaces never hideable.
Live Touch's one existing system is the **dock rail** (`bm26_touch_layout_v2`,
rail tabs, `panelKey`). So the meter strip becomes a rail citizen of a
second tier, mirroring the deck bar tier point for point:

| Deck contract (docs/63) | Live Touch equivalent |
|---|---|
| `DeckBarId` tier beside windows | `meter-strip` joins the dockable set but NOT `allPanels()`'s row logic — it is a full-width bar above the rows, never a `.prow` column, no vote in `MAX_PER_ROW` |
| AUDIO chip in the workspace bar | `AUDIO` tab on the panel rail (same `rail-tab` recipe, meter accent dot) |
| Bars don't count toward window floors | docking the strip never counts toward `MIN_OPEN` (the floor stays "≥1 *panel*") |
| Default open; silent stores hydrate to the author's screen | additive persistence: the docked list gains `'meter-strip'` only when the operator docks it. Key stays `bm26_touch_layout_v2` — a v2 store that never heard of the strip leaves it open, byte-identical boot (docs/63 §2.3's rule verbatim) |
| Never-hideable safety chips | ARM, the status pill, FOLLOW NOTE narration, PANIC-adjacent group controls — none are touched by any hide mechanism |
| Hidden bar may unmount | the strip gets `display:none` via the existing `is-docked` class; `paintMeter`'s rAF already no-ops sensibly, and the wire additionally skips `drawMeterTraces` while docked (zero canvas work hidden) |

The old in-code operator ruling "the meters are ALWAYS ON" (comment at
`#meterStrip` and in the dock script) is **superseded by this order** —
implementers update both comments to cite it, so the file stops contradicting
the behavior.

**Embed-transport hook (note only, NOT built now):** if the pad should later
drive this, the `_252` transport (`buildTransport()`,
`window.__captainpadDeliver`, theme.js) already delivers typed messages; a
future `layout` message could toggle the strip. Panel-local localStorage
stays the single authority; no cross-surface store is invented.

## 5. Topbar (order 3 — addendum)

Horizontal (≥ ~1120 px): unchanged — operator says it looks okay.

Portrait: today the single 54 px row survives only by crushing the pattern
picker to 34 px (measured; the select is invisible). New rule at the
portrait breakpoint (`max-width: 1120px` — 1024 must catch it, 1194+
landscape must not): the topbar grid becomes **two rows**, `--header-h`
doubles to auto (~96 px):

```
row 1:  ⚓ TOUCH CONTROL #44   |   ARM (centered, loud as ever)   |  STATUS · ? · ⚙ · ⟳
row 2:  PATTERN [select, flex-1 — full usable width]  ·  caps note  |  SYNC · 120 BPM · −/+  ·  NOTE
```

Nothing is dropped; ARM keeps its center-stage column and never shrinks; the
pattern select gets ≥ 300 px back. The 2-row cost (~42 px) is the operator's
own call. Implementation is grid-template-areas at the breakpoint — no DOM
reorder, so no wire or focus-order changes.

## 6. Must-not-change pins

1. **The `_252` embed transport** — `buildTransport()` /
   `window.__captainpadDeliver` (touch_control_theme.js:96/339), the
   `window.parent !== window` + `captainpad_embed=native` first-paint gate
   (touch_control.html head), and the wire's embed touchpoint: **zero edits**.
   The Opus validation walk greps these names unchanged.
2. **`touch_control_theme.js` is not edited by this wave at all** — an Opus
   fix agent is editing it concurrently (stuck handoff overlay on native).
   See §8 sequencing.
3. **docs/61 color rules**: single writer, driving strip, follow-note yield.
   `nf-state` narration and the status pill's refusal sentences visible in
   every declutter state; no color control that narrates "who is driving"
   goes behind a disclosure.
4. **Behavior freeze**: wheel gestures, brush/spatial pad pointer code, wire
   send paths, ARM/disarm chains, preset semantics — untouched. Every id,
   `data-*` hook, and hidden readout element stays in the DOM.
5. **Dock system invariants**: `MIN_OPEN` floor of one *panel*, two per row,
   least-recently-opened displacement, `bm26_touch_layout_v2` back-compat
   (no version bump; additive only).
6. **Offline readiness**: no new assets, fonts, or dependencies.
7. **Pattern caps line, ARM prominence, pixel-view safety labels**
   (axis relabeling per view) — unchanged.

## 7. Operator decision points (defaults chosen; one-line vetoes)

- **D1 — audio card variant.** Default: two-line compact, strip ≈ 52 px
  (§4.1). Alternative: single-line with the trace behind the text, ≈ 36 px —
  thinner, but the trace becomes decoration; only if 52 px still reads big.
- **D2 — hide affordance.** Default: `AUDIO` rail tab (the panel's one
  grammar). Alternative: a deck-style chip row — rejected as a second
  mechanism on one surface.
- **D3 — inert rows.** Default: collapse + caption (§2.1). Alternative:
  status quo dimming (keeps height, fails "A LOT").
- **D4 — drawHelp.** Default: hidden behind `ⓘ`, session-local.
  Alternative: permanent one-line summary.
- **D5 — portrait topbar split.** Default: PATTERN owns row 2 with BPM
  (§5). Alternative: pattern in row 1, chips in row 2 — crushes the select
  again, not recommended.
- **D6 — slot tags.** Default: corner dot + tooltip. Alternative: keep
  ENGINE/LOCAL text (costs the column).

## 8. Sequencing and file overlap — read before assigning

- **`touch_control_theme.js` was under concurrent Opus repair** (native
  handoff curtain) while this was designed; that fix reports landed as
  `_261`. This wave does not touch that file regardless, and the working
  tree carries uncommitted edits to `touch_control.html`,
  `touch_control_wire.js`, and `touch_control_pixel_views.*`. **Implementers
  confirm `_261` is landed before starting and work from the then-current
  files, never from this doc's line numbers.**
- W1 (audio) and W2 (spatial) both edit `touch_control.html` +
  `touch_control_wire.js`; W3 (color) and W4 (topbar) are HTML/CSS-only.
  Run W1→W2 serially (same files), W3/W4 parallel with either.

## 9. W-items

**W0 — embedded baseline (any Sonnet, first).** Re-capture the §1 matrix
*embedded* (CaptainPad web dist, gruvbox tokens, per the operator's Metro
rules) at 1366×1024 and 1024×1366; confirm the standalone numbers hold and
record the table in the landing report. No product code.

**W1 — audio strip minimal + hideable (Sonnet A).** Files:
`CaptainPad/live_touch/touch_control.html` (meter CSS §4.1, dock-script: meter-strip as a
no-floor bar citizen §4.2, comment updates), `CaptainPad/live_touch/touch_control_wire.js`
(`buildMeter` card markup: drop `.sig-sub` to `title`, trace 20 px; skip
`drawMeterTraces` while docked). Persistence probes: v2 store without
`meter-strip` → open; with → docked; corrupt store → open + rail intact.

**W2 — spatial pane declutter (Sonnet B, after W1).** Files:
`touch_control.html` only (the `sync()` gate → collapse + captions §2.1,
`ⓘ` help toggle §2.2, VIEW chip §2.3 — the toolbar handlers live in
`touch_control_pixel_views.js` and are NOT edited; the chip only toggles the
toolbar's visibility class). Verify pad unclipped landscape (§2.4), presets
and wire still read every hidden readout, keyboard gate (disabled buttons)
still holds for collapsed rows.

**W3 — color pane declutter (Sonnet C).** Files: `touch_control.html`
(slot chip row §3.1, single-line actions §3.2, wheel `aspect-ratio: 1`
§3.4). FOLLOW NOTE and status pill untouched (§3.3). Tap targets ≥ 44 pt.

**W4 — portrait topbar (Sonnet C, after W3).** File: `touch_control.html`
(breakpoint grid §5). Landscape byte-identical (screenshot diff).

**W5 — validation walk (Opus). No product files.**
- Grep gate: `buildTransport`, `__captainpadDeliver`, `captainpad_embed`,
  first-paint gate — all byte-identical to the pre-wave file; theme.js diff
  empty for this wave.
- Before/after screenshot matrix, both orientations ×
  {default · AUDIO docked · XY mode · SPATIAL mode · help open · VIEW chip
  expanded · portrait topbar}, embedded with real theme tokens.
- Measured table: audio strip ≤ 56 px; pad unclipped at 1366×1024 (both
  axis labels visible); wheel circular both orientations; portrait pattern
  select ≥ 300 px; FOLLOW NOTE + nf-state visible in every state.
- Persistence: the W1 probe matrix on the running panel; dock/undock AUDIO
  survives reload; MIN_OPEN floor never counts the strip.
- docs/61 spot-check: follow-note running → scheme tap → refusal/driving
  narration readable in the decluttered pane.

Sizing: W1 ≈ half a day, W2 ≈ a day, W3+W4 ≈ a day combined, W5 last.
