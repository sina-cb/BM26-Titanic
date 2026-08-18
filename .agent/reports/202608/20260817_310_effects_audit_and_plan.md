# 20260817_310 — Effects system: audit, gallery, Live Touch review, 30 proposals, Opus plan

**Session:** Effects Art Direction (Fable, operator-requested), report
number `_310` per the thread-tracker reservation.
**Deliverable:** `docs/74_effects_overhaul_plan.md` — the full
review-first plan (audit verdicts, Live Touch colour-effects ruling,
E1–E30 new-effect catalogue, W1–W8 Opus wave plan, D1–D17 decision
list). **Nothing was implemented; zero product code changed.** Sina
reviews docs/74 before any Opus wave starts.
**Scope honoured:** live stack untouched (read-only GETs to :6968 only;
no port bound anywhere — gallery rendered fully offline); no git; no
writes to patterns/baby*, patterns/crisp, CaptainPad, or Live Touch
sources; temp in `C:/Users/TITANI~1/tmp/`.

---

## 1. What this session wrote to the tree

- `docs/74_effects_overhaul_plan.md` (new — the plan, §-numbered and
  per-item vetoable).
- `docs/pattern_gallery/effects/` (new — the CURRENT-effects gallery:
  GIF + MP4 + metrics per pair, own `index.html` + `manifest.json`;
  the combined gallery index `docs/pattern_gallery/index.html` was
  **deliberately not touched** — concurrent writers own it).
- This report; tracker append; dossier row.

## 2. Library census (live-verified)

`GET /global-effect-library` on the running engine: **17 effectIds,
51 effectId|presetId pairs** — matching `lib/global_effect_library.js`
byte-for-byte on ids. Slots 1–8 Deck/VSN1, 9–24 Live Touch (ARM-
provisioned), live snapshot consistent with `_302` §4.

## 3. Audit outcome (docs/74 §4)

**KEEP 29 · OPT 3 · FOLD 15 · KILL 4.**

- **Kills:** `freeze|stutter` (byte-identical params to `freeze|hold`,
  `global_effect_library.js:521`, no special dispatch anywhere — a
  duplicate wearing a lie for a name); `colorWash|ocean_blue`,
  `colorWash|iceberg_cyan`, `colorWash|purple` (fixed paint in a
  palette-driven system, superseded by the palette-fed wash E1).
- **Folds (15):** presets that are knob positions of a sibling —
  strobe ×4 (the Frequency mode wheel already exists), crush ×2,
  feedbackTrails long→soft, beatPump ×2, breath deep→calm,
  movementTrace direction/speed ×4, waterlineSweep beat_wipe →
  rising_tide. Every folded LOOK survives as a mode stop.
- **Systemic findings (docs/74 §5):** F1 presets-as-knob-positions;
  F2 colour frozen where the architecture says palette; F3 the stutter
  corpse; F4 the library has NO one-shot boom/wipe vocabulary (every
  spatial thing loops) — that gap is where most of E1–E30 lives; F5
  audio-dependent pairs look dead in silence with no surface label.

**Reachability (docs/74 §2, full file:line table verified this
session):** every pair is nominally reachable (CaptainPad swap sheet and
Live Touch EDIT dropdowns enumerate the whole library), but **15 pairs
are cold** — on no default layout in any scene and no default tile —
and kickPunch, arguably the library's most interesting instrument, has
never had a button anywhere. Autopilot fires no global effects at all;
special events are hard-allowlisted to 5 effectIds with no presets;
scheduler has zero live tasks on titanic. Live titanic slots 9–13 hold a
stale pre-Live-Touch layout that the next ARM overwrites (consistent
with `_302` §4).

**Measured duplicate proof (gallery overlap matrix):**
`freeze hold↔stutter` RMS **0.00**; all three movementTrace
repeat↔reverse pairs RMS **0.00** over the whole 6 s ON window (at
1 px/beat the ping-pong cannot reach a turn — "reverse" is invisible for
the better part of a minute at show tempo); `beatPump deep↔halftime`
5.98. Genuinely distinct siblings confirmed distinct: cosmic↔ghost 24.6,
dropHits 17–29, washes 42–65 (their kills are architectural — F2 — not
visual duplication).

**New structural findings that changed the plan mid-flight:**

- **F6 — colour effects run FLAT RED off-panel:** controller default
  `colors: [[1,0,0,0,0,0]]`, no preset declares colors, generic
  GEM/VSN1 dispatch sends preset params only — only Live Touch supplies
  the palette. Also: Live Touch's boot scheme is `master` = five copies
  of one colour, so the colour family boots flat on the panel too.
- Live Touch's live palette re-push EXISTS and is good machinery
  (`palettechange` → `pushMovementColours`, PATCH + re-activate on lit
  tiles) — but CaptainPad's two-tone preset writes (`colorPalette1/2`)
  and the panel's palette are two disjoint colour authorities, each
  write-only. The engine-side `colorSource: palette` field (docs/74
  W3/P4) closes all of it at once.
- **F7 rot list:** colorWash `tint`≡`replace` (byte-identical code
  paths); freeze's jog and encoder drive the SAME param; `invert` has
  no `apply` key and `kickPunch.apply` is a predicate (registry-walker
  hazards); `dropHit.curve` unvalidated into `Math.pow`; dead knobs
  `beatPump.curve` / `sparkle.intensity`; `waterlineSweep.speedHz` dead
  when synced (so `beat_wipe`'s value never executes); stale 40-line
  `COLOUR_EFFECTS` comment in `touch_control_wire.js`.
- Family caps / singletons are **panel-only** — engine, CaptainPad and
  VSN1 enforce nothing; two GEM slots of one singleton silently
  overwrite each other's controller state.
- The master gallery index generator **never scans for sibling
  galleries** — a hand-added effects link would be clobbered by the
  next `--index-only` (which every transition-gallery run triggers).
  That is why the effects gallery has its own index and why W2 carries
  the ~15-line master-index fix.

## 4. Gallery

`docs/pattern_gallery/effects/` — **50 of 51 pairs rendered** (fogger
carded as DMX-only; kickPunch rendered as its manual trigger; hihat
correctly inert without audio, labeled). One fixed approved base
(`baby_tease/01_bullseye_tide`, titanic, saved defaults), 12 s timeline
(2 s base → 6 s ON → OFF → tail), 40 fps internal / 20 fps media,
rendered **fully offline** with the transitions-gallery stack (harness +
in-process `GlobalEffectsController` replicating the exact engine.js
chain order); W/A/U composited into RGB with a documented mapping.
Per-pair metrics: RMS delta, changed-pixel fraction, peak-brightness
ratio, release tail, chain ms/frame; plus 12 intra-effect overlap
tables. Verdict pills mirror docs/74 §4 one-for-one (29/15/4/3), driven
by a verdicts JSON so vetoes re-render without touching media.

Cost, measured: worst pair 0.04 ms/frame; ALL 50 simultaneously ≈
1.3 ms against the 25 ms budget — headroom is a measurement now.

Evidence trails: contact sheets (three-row base/ON/tail per pair) at
`C:/Users/TITANI~1/tmp/fx_gallery/sheets/`; I inspected the key rows
myself (5-colour ladder, ghost vs cosmic, shadow_pass, strobe blink via
supplemental 4-frame extract). The combined
`docs/pattern_gallery/index.html` was **not touched** (mtime verified
pre/post). Media weight: 163 MB (138 MB GIFs / 25 MB MP4s) — D18 in
docs/74 carries the shrink decision; regeneration is one offline
command.

## 5. Live Touch (docs/74 §6)

The "5 colour effects" are the movementTrace family — nine presets
occupying nine of sixteen tiles for five actual looks. Ruling: five
tiles (PULSE, WALK 2, TONE 2, LADDER 5, BLOCKS) with direction/speed on
mode wheels — satisfies docs/70 §10 D17's curation clause — freeing
four tiles for the new global-effect grammar (proposed 16-tile bank in
docs/74 §6.3). Colour flow: today the palette is PUSHED at provision
time (`touch_control_wire.js:3338-3347`); after docs/71, the engine-side
`colorSource: palette` field (W3/P4) makes colour-carrying effects
FOLLOW `colorPalette1/2` live — one wheel gesture or two-tone preset
re-themes the whole effects surface. Composes with `_291` (docs/70 §10
remainder): W7 depends on it, extends its grammar, and never races it
in the same files.

## 6. The thirty proposals (docs/74 §7)

E1–E30 across colour transform / fade-envelope / global boom /
swipe-wipe / trail-feedback / strobe-flash / spatial displacement /
composite, each with mechanism sketch, MFT-ordered params (direction
2nd), cost estimate, surfaces, and engine-change flag. Four shared
primitives (P1 spatial index maps, P2 frame ring, P3 one-shot envelope
runner, P4 colorSource resolver) make 23 of 30 pure library additions.
Top five by wow-per-effort: **E11 Depth Charge, E23 A/B Flash, E15
Curtain Wipe, E1 Palette Wash, E22 Lightning** (docs/74 §7.9).

## 7. The wave plan (docs/74 §9)

W1 hygiene (kills/folds + migration shim) → W2 gallery productization
(parallel-safe) → W3 primitives → W4 colour+fades → W5 booms+wipes →
W6 trails/strobe/displacement → W7 Live Touch surface (hard-gated on
`_291`) → W8 deck curation + acceptance. Per-effect gates: distinctness
(RMS floor against every existing pair on the standard base render),
cost, night-visibility floor, region coverage (spatial), photosensitivity
ceiling. Every E lands as an independent, revertible unit.

## 8. Operator review path

docs/74 §11: the score + kills first, then the Live Touch bank, then
E1–E30 headlines against the gallery, then D1–D17. The waves reshape
around whatever is struck.

## 9. Environment notes for the next session

- The generator is scratch, by design (zero product-code rule):
  `C:/Users/TITANI~1/tmp/fx_gallery/generate_effects_gallery.mjs`, run
  from `marsin_engine/` cwd. Index-only rebuild (bakes
  `C:/Users/TITANI~1/tmp/fx_gallery/verdicts.json` into manifest+index
  without re-rendering):
  `cd marsin_engine && node C:/Users/TITANI~1/tmp/fx_gallery/generate_effects_gallery.mjs --index-only`.
  W2 productizes it into `marsin_engine/tools/effects_gallery/` — until
  then a full re-render needs this scratch copy (it wipes gifs/videos/
  sheets on an unfiltered run; `--only` is for iteration, not patching).
- Live stack was UP throughout and untouched: read-only GETs to :6968
  only, no port bound, no ARM mutation, no engine state write, no git.
- Concurrent-writer courtesy held: baby*/crisp/CaptainPad/Live Touch
  sources untouched; the contended combined gallery index untouched.
- Two Opus sub-agents were used (gallery build; reachability/semantics
  sweep), both scoped read-only on the tree except the gallery output
  dir.
