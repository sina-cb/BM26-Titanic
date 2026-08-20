# _209 — Deck UI restyle design (migration to "the new style")

**Date:** 2026-08-14 · **Agent:** _209 (Fable, design) ·
**Branch:** `feat/bm_readiness` · **Deliverable:** `docs/54_deck_ui_restyle.md`
**Operator brief:** "use fable agent to design the deck UI migration to the
new style as it's not changed when I look at it."

Design only — no code was touched. This report is the handoff summary; the
doc is the contract.

## 1. The canon decision

Studied: Live Touch (`docs/ui/touch_control.html` + the
`touch_control_theme.js` bridge), the approved COLORS prototype
(`docs/ui/color_palette_prototype.html`), the _190 param-row system
(`param_chips.tsx` / `param_row_layout.ts` / report _190), CaptainPad's
tokens (`constants/theme.ts`, `styles/globalStyles.ts`), and
`.agent/os/ui_design.md`.

**The reconciliation was already decided in code**: the Live Touch theme
bridge overwrites Live Touch's CSS variables with CaptainPad's palette when
embedded (`CSS_TOKEN_MAP`). So color authority = `constants/theme.ts` (all
five themes), and "the new style" = those tokens wearing **Live Touch's
grammar**: panel-as-one-object chrome (fill + hairline + inset highlight +
ambient shadow), identity-dot headers, a tokenized radius scale, the _190
chip tone system (frozen), translucent accent-wash on-states, codified
SpaceGrotesk/Inter recipes, and glows reserved for armed/live states. No
second palette is forked; Live Touch's standalone navy stays standalone.

Token additions (all five themes): `borderStrong` + the `warning` amber
family (retiring `#F5A623`/`#f5a623`/`#9a6a12`/`#8a6a1f`/`#1a1a1a`-on-amber
literals). `#00a86b` (6+ sites) maps to existing `tertiary`. New
`constants/identity.ts` documents the deliberate theme-independent identity
hexes (audio bands, MIDI violet, plan cyan). New `Radius`/`Space` scales
(chips stay 4 — pinned by _190 tests). New `globalStyles` recipes: `panel`,
`cardOnPanel`, `panelHeaderRow`, `labelCaps`, `microCaps`,
`accentWash(accent)`, `glowFor(accent)`. `CaptainPad/DESIGN.md` gets
authored in the design.md format per the OS spec.

## 2. Migration shape

Per-component table in the doc (20 rows): **10 pure-style**, **4
style-plus-a-dot** (identity dot added to an existing header row), **5
shared/gesture-adjacent** (fader paint, CPCControls, split divider,
PlaylistPanel, GEM strip — PlaylistPanel and GlobalEffectMacros render on
the Mixer tab too, so those slices need mixer before/afters), **1 no-op**
(GlobalParams — _190 already migrated it; it is the reference point).
Everything behavioral is preserved verbatim: gestures, routes,
optimistic+rollback, plan-lock hermeticity, row heights, column weights,
44pt floors.

The biggest visible change: all workspace windows sit on the same `panel`
surface — today PATTERNS is a pane while PARAMETERS/AUTOPILOT are bare
transparent scroll columns with floating cards.

## 3. Composition with in-flight work

- **_208 (workspace windows, docs/53):** restyle lands AFTER _208 Slice A
  and paints its `DeckWindow`/`deck_workspace` markup; window chrome + rail
  spec'd to wear the new style from day one (identity dots per window;
  COLORS' dot = a live C1/C2 DualSwatch). Docs/53's pixel-parity mandate is
  explicitly superseded once the restyle applies — it guarded the LAYOUT
  migration; the operator has now ordered the look changed. _208's parity
  screenshots become the restyle's "before" baseline.
- **_206 (Events tab, docs/52):** shared-vocabulary table in the doc —
  stage buttons use `accentWash` + `readableInk` with show-data accents,
  `glowFor` for the current stage, the chip tones, and a new big-button
  type scale. Import, never hand-roll.
- **COLORS window:** the approved prototype IS its spec; mapping of its
  purple hairline → `borderStrong`, its orange presets pane → the `warning`
  amber recall-surface treatment.

## 4. Slice plan (Opus)

R0 tokens+recipes (parallel-safe, zero visual change, +token-completeness
and contrast tests) → R1 Deck-only pure reskins (after _208 A) → R2
workspace chrome + rail paint → R3 shared/gesture surfaces one at a time
with deck AND mixer screenshots + manual gesture pass. Full vitest suite
must stay green (param_row_layout, playlist_row_sizing, _208's layout tests
are canon); tsc/eslint clean; screenshot matrix covers light/dark plus
gruvbox/sunset spot-checks, plan lock, PANIC, swap-dim, offline.

## 5. Open operator decisions (doc §6)

1. Window identity colors (proposal: PATTERNS primary / PARAMETERS MIDI
   violet / AUTOPILOT tertiary green / COLORS live DualSwatch).
2. Glow budget (restrained vs Live-Touch-full).
3. NauticalFader / Dimmer Rack look — out of scope here; modernize later or
   keep as TE DNA?
4. Live Touch navy as an optional sixth theme (one palette entry) — or not
   at all.
5. Confirm density stays as-is (the restyle preserves current compactness).

## Files

- `docs/54_deck_ui_restyle.md` (new — the design contract)
- `.agent/reports/202608/20260814_209_deck_restyle_design.md` (this)
- tracker block appended (`## _209 — deck restyle design`)

No source files touched. No git operations. Live stack untouched.
