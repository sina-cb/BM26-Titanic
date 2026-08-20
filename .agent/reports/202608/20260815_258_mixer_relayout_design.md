# _258 — Mixer relayout design: channels as windows, aspect-honest pixels, hideable sections, COLORS citizen (Fable)

**Role:** Fable design agent, operator-ordered. **Deliverable:**
`docs/64_mixer_relayout.md` (W0–W7, sized for Sonnet implementers under an
Opus lead). **Design only** — no code, no git ops, no live-stack writes.
Live stack touched READ-ONLY: GETs of `:6968/status` + `/mixer`, one
headless page per viewport against the prod dist `:6967` (GET + WS reads;
no POST/PATCH, no port binds).

Operator order: *"the mixer UI is a mess … Mixer is fugged up bad!
Especially the 2d pixels … support hiding params and 2d vis PER CHANNEL;
optimize for 2 channels, max 3, in horizontal view."* Mid-flight addendum:
(1) channels become deck-style hideable WINDOWS; (2) the deck's tuned
COLORS picker returns as a hideable component in the mixer.

## 1. Saw it first — the mess, measured

Captures in `~/tmp/mixer_relayout_258/` (live :6967, engine was in
performance mode with 2 channels, 1366×1024 + 1024×1366) plus the `_243`
edit-mode set (`~/tmp/fix_243/`), all visually inspected. The artifact's
top-down view measures **1.91:1** (glyph extent 694×364), and that number
convicts the layout:

- **M1 — the 2D canvases are mostly black void.** Fixed-height slots ignore
  the view aspect and paint the letterbox as stage-black. Master band
  1220×158 → lit ship ~302×158, **~75 % void**; perf channel column
  313×245 → ~33 % void and a stretched slot whose ship is *smaller* than
  the edit band's; edit band 316×112 → ~32 % void. This is the "2d pixels
  fugged" verbatim.
- **M2 — the band crushes the body in edit mode** (`243_01`): playlist
  reduced to ONE visible row, LOCAL PARAMS a ~110 px column with truncated
  labels.
- **M3 — portrait is broken outright** (live capture + `243_09`):
  MUTE/SOLO/BUMP and TRANSITION rows render ON TOP of the playlist text;
  LOCAL PARAMS and the perf pixel view are pushed clean out of the card.
  Defect, not taste — W0.
- **M4 — duplication + caption noise:** thin strip AND band per channel;
  `PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE` printed once PER CHANNEL.
- **M5 — ~37 % of landscape height is chrome** before the first card (and
  the tallest chrome block is the 75 %-void master band).
- **M6 — portrait right third dead** (fixed 320 pt columns at 1024 wide).
- **M7 — `_243`'s 55/45 perf split** (the report's own top veto point) is
  what the operator just vetoed by verdict.

## 2. The design, in five lines

1. **Channels become workspace citizens** — one pure reducer + persisted
   closed/`known` sets over namespaced runtime ids (`ch/<id>`,
   `sec/<id>/params|pixels`, `citizen/masterBand|colors`), chip rail with
   HIDDEN divider, floor of one visible channel; hiding is VIEW-ONLY.
2. **Aspect-honest bands**: canvas sized to the picture
   (`H = clamp(W/aspect …)`, width capped at `aspect×H`) — the black wings
   cease to exist; the master band's reclaimed width HOSTS the chip rail.
3. **Per-channel PARAMS / PIXELS hiding** on the strip (28 px header stubs +
   ⋮ rows), persisted with the same `known`-set discipline; thin 1D strips
   render only when the 2D band is hidden.
4. **2-visible landscape is the optimized case**: card caps re-derived from
   VISIBLE count (2 → ~640 pt cards, ship ~2.5× today's lit area; ≥4 keeps
   scroll); portrait cards go full-width; perf views aspect-fit, never
   stretched; PARAMS-HIDDEN caption printed once on the bar.
5. **COLORS returns as ONE rig-global citizen** (default hidden, ~380 pt
   card in the strip row) mounting the REAL `ColorsWindow` (seam = one
   optional `host` prop) — strictly sequenced AFTER the docs/61 wave, whose
   yield/driving-strip/single-writer rules bind on this mount and whose C5
   (ungated mixer palette writes) this mount closes.

Key policy inversion, argued in docs/64 §2.3: a channel id absent from
`known` defaults **VISIBLE** (channels are operator-created live content
already painting the rig), while new chrome citizens keep the `_225`
default-closed rule. Deleted-channel entries prune only on a layout commit
against a confirmed roster.

## 3. W-items + slicing

W0 portrait-overlap defect (standalone, first) → W1 pure workspace store
(+known-set test matrix) ∥ W2 pure aspect geometry (one new export from
`pixel_view_logic`, band sizing; scheduler/painter/loader untouched) →
W3 workspace bar + wiring → W4 section hiding + strip diet → W5 layout
optimization pass → W6 COLORS citizen (after docs/61 lands) → W7 Opus
validation walk (suites, both-orientation screenshot matrix, persistence +
upgrade round-trips, perf byte-identity, scheduler duty re-measured at the
new canvas sizes). `mixer.tsx` is serialized through W0→W3→W4→W5→W6; W1/W2
parallel. Zero engine changes — no restart, does not ride the gen-7 bounce.

## 4. Decision points (defaults in docs/64 §7)

D1 floor=1 visible · D2 new-channel→visible · D3 groups: de-emphasize by
building nothing (machinery + GROUPS button stay; delete nothing) ·
D4 thin-strip-only-when-band-hidden · D5 caption diet (ratio stays — honesty
pin) · D6 perf column aspect-fit vs full-card · D7 persist band view choice
(recommended YES, folds `_243` §4.5 open item) · D8 COLORS placement ·
D9 muted style on hidden-channel chips · D10 hidden channels stay mounted.

## 5. Overlaps + convergence (for the Opus lead)

- **docs/63 (deck declutter, `_257`, landed mid-flight of this design):**
  same grammar by construction — tiers in one reducer, generalized `known`
  rule ("unknown → shipped default"), chip row + HIDDEN divider. This wave
  avoids all four of its files (mixer bar deliberately NOT in
  `CPCControls`). CONVERGENCE DUTY: whichever wave lands second extracts
  `WindowChip` to `components/ui/workspace_chip.tsx`; the two §2.3 new-id
  tables must read as one rule.
- **docs/61 (colors wave, `_255`):** W6 waits for it; only overlap is the
  optional one-prop touch on `colors_window.tsx` (coordinate with their W2
  owner). Their W4 app-wide COLOR chip can seat at the mixer bar's right
  end — noted to them.
- **`_243` machinery pinned:** 8 ms scheduler, shared painter/PixelSurface
  (`_252` native seam), one artifact fetch, D5 mask, perf derived-overlay
  zero-write contract.

## 6. Verification of this design session

- No writes to :6966-:6972/5568/6981/7175; no engine POSTs (perf-mode was
  already active on the live engine — captured as found). No scratch engine
  needed: live reads + the `_243` archive covered the matrix.
- Screenshots: `~/tmp/mixer_relayout_258/257_live_landscape_1366x1024.png`,
  `257_live_portrait_1024x1366.png` (+ probe JSON in the run log), harness
  `capture_live_mixer.cjs` alongside them.
- Aspect numbers computed from `docs/ui/touch_control_pixel_views.json`
  directly (top-down 1.91, front 1.53/1.20, strands 1.92, te_sign
  0.74/0.60).

**Deliverable:** `docs/64_mixer_relayout.md`. **No code changed, nothing to
restart.**
