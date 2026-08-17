# _262 — Live Touch declutter design: spatial + color breathe, minimal hideable audio bars, portrait topbar (Fable)

**Role:** design agent on the operator's standing pipeline. **Deliverable:**
`docs/65_live_touch_declutter.md` — W-items for Sonnet implementers + Opus
validation. Design only; no product code touched.

## Orders (verbatim intent, live iPad testing)

1. Declutter the spatial XY pane and color "A LOT".
2. Audio signals: "minimal and thinner than even what they are now", and
   hideable via "the deck's new audio-signals hide mechanism" (docs/63).
3. Addendum: topbar "can be 2 rows in vertical; in horizontal it looks
   okay — just make sure to optimize that as well."

## What the screenshots showed (own puppeteer, scratch :17131 static serve, 1366×1024 + 1024×1366)

Captures + measurement JSON in `~/tmp/live_touch_declutter/` (standalone
palette — theme tokens arrive only when embedded; geometry identical).

- **Audio strip: 134 px tall** both orientations — 9 cards of 87 px (10 px
  name/value + 8 px "intensity · out" sub-line + **42 px trace** + padding).
- **Spatial XY (default XY mode): 8 of 11 control elements are inert** —
  dimmed to .38 with disabled buttons — yet keep full height (sp-controls
  134–148 px + drawHelp 29–43 px prose + 26 px VIEW toolbar). Consequence:
  **the pad is CLIPPED in landscape — a 300 px min-height pad in a 170 px
  frame**, bottom 130 px including the Y− axis label cut off.
- **Color:** five-slot palette column 182 px (landscape) / **353 px
  (portrait)** tall for five swatches; two-line scheme buttons 96 px; the
  wheel renders as a **185×320 ellipse in portrait** (not round).
- **Topbar:** landscape one comfortable 54 px row; portrait keeps one row
  only by **crushing the pattern picker to 34 px** — the select is unusable.

## The design (docs/65) in five lines

1. **Spatial:** inert rows collapse instead of dimming, narrated by a static
   micro-caption (deck's `PIXELS_BAR_CAPTION` recipe); drawHelp behind an ⓘ
   toggle (default hidden); VIEW toolbar folds into one `VIEW ⌄` chip on the
   pad frame; DRAW/INK side columns keep today's dim-never-hide. Pad renders
   unclipped in landscape (~170→310 px visible).
2. **Color:** slot column → one 32 px horizontal swatch-chip row (ENGINE/
   LOCAL as corner dots + tooltip); scheme buttons single-line (96→36 px);
   wheel gets the freed column and `aspect-ratio: 1` (round in portrait).
   FOLLOW NOTE + nf-state narration untouched (docs/61 pin).
3. **Audio bars:** drop the sub-line, trace 42→20 px → card ~40 px, **strip
   134→~52 px (−61 %)**; hideable as a second-tier rail citizen — `AUDIO`
   rail tab, no vote in the MIN_OPEN panel floor, additive persistence in
   `bm26_touch_layout_v2` (silent old stores hydrate byte-identical — the
   docs/63 §2.3 rule verbatim). Old "meters ALWAYS ON" comments updated to
   cite the superseding order.
4. **Topbar:** landscape untouched; portrait breakpoint goes two rows —
   ARM keeps center stage, PATTERN owns row 2 at full width (≥300 px back).
5. **Grammar parity with the deck** (docs/63): one show/hide system per
   surface, bars as a tier beside panels, suppression narrated by captions,
   safety surfaces (ARM, status pill, FOLLOW NOTE narration) never hideable.

## W-items

W0 embedded baseline matrix → W1 audio strip (Sonnet A: html + wire) →
W2 spatial (Sonnet B: html only, serial after W1 — same files) ·
W3 color + W4 topbar (Sonnet C: html/CSS only, parallel) → W5 Opus walk:
transport grep gate (`buildTransport` / `__captainpadDeliver` /
`captainpad_embed` byte-identical, theme.js diff empty), before/after
screenshot matrix at both orientations × 7 states, measured heights
(strip ≤56 px, pad unclipped, wheel round, select ≥300 px), persistence
probe matrix, docs/61 narration spot-check.

## Decision points (defaults; one-line vetoes)

D1 audio card two-line ~52 px (vs 36 px trace-behind-text) · D2 rail-tab
hide affordance (vs deck-style chip row) · D3 collapse+caption (vs keep
dimming) · D4 drawHelp hidden behind ⓘ · D5 PATTERN owns portrait row 2 ·
D6 slot tags as corner dots.

## File overlap / sequencing

The concurrent Opus `touch_control_theme.js` repair landed as `_261`
(handoff curtain) mid-design; this wave never touches theme.js, and
implementers confirm `_261` is in before starting. W1/W2 share
`touch_control.html` + `touch_control_wire.js` — serial. The tree's
uncommitted `docs/ui/*` edits are the current truth; docs/65 forbids working
from line numbers.

## Ledger

- Live ports: read-only — nothing touched; captures ran off a scratch static
  server on :17131 (killed after).
- Scratch: `~/tmp/live_touch_declutter/` (capture.cjs, 2 PNGs).
- Tracked writes: `docs/65_live_touch_declutter.md`, this report, tracker
  `_262` block, one dossier row.
