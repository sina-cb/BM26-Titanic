# _210 — Deck restyle slice R0: tokens, recipes, DESIGN.md

**Date:** 2026-08-14 · **Agent:** _210 (Opus, implementation) ·
**Branch:** `feat/bm_readiness` ·
**Contract:** `docs/54_deck_ui_restyle.md` §1.1 + §5 (slice R0) and
`.agent/reports/202608/20260814_209_deck_restyle_design.md`.

R0 is the foundation slice: **tokens and recipes only, zero visual delta**.
Nothing in the app consumes the new tokens yet — R1 starts the call-site
swaps. No git operations. The coordinator's live stack (6966–6972) was never
touched; validation was build-only.

## What landed

| File | Change |
|---|---|
| `CaptainPad/constants/theme.ts` | +`borderStrong`, +`warning`/`warningContainer`/`warningContainerBorder` on the `Palette` type and on **all five** palettes; +`Radius`, +`Space`, +`Type` scales beside `Fonts`. |
| `CaptainPad/constants/identity.ts` | NEW — the closed list of theme-independent identity hexes. |
| `CaptainPad/styles/design_recipes.ts` | NEW — the pure half of the recipes (`accentWash`, `accentFill`, `glowFor`, `identityDot`, `withAlpha`, `flattenOver`, `isLightSurface`) plus `shadow()`, relocated verbatim. |
| `CaptainPad/styles/globalStyles.ts` | Re-exports the recipes (so every existing `import { shadow } from '…/globalStyles'` is untouched) and adds the `panel` / `cardOnPanel` / `panelHeaderRow` / `labelCaps` / `microCaps` / `valueText` style entries. |
| `CaptainPad/DESIGN.md` | NEW — the design.md-format source of truth (`.agent/os/ui_design.md`). |
| `CaptainPad/components/design_tokens.test.ts` | NEW — 30 tests: completeness, contrast, identity drift, scales, recipe primitives. |

### Why a second module (`design_recipes.ts`)

docs/54 puts the recipes in `globalStyles.ts`. Most are StyleSheet entries and
went there. The pure FUNCTIONS could not: `globalStyles.ts` imports `react`
and `react-native`, and the CaptainPad vitest suite runs in plain node with no
RN stubs — the design's own R0 test spec ("`accentWash` contrast table over
all five themes, pure function, vitest") is unrunnable from that file. So the
pure layer sits in `styles/design_recipes.ts` and `globalStyles.ts`
re-exports it. **No call site changed**; from a component's point of view the
recipes still come from globalStyles. The WCAG primitives
(`relativeLuminance` / `contrastRatio` / `readableInk`) are imported from
`components/param_row_layout.ts` rather than re-implemented — one copy, and
_190 already owns and tests them.

## Tokens added, per theme

The warning amber is per-theme rather than one hex because the historical
`#f5a623` measures ~2:1 on white — it is unreadable on the daytime palette.
All figures are WCAG contrast ratios, measured by the new test file.

| Theme | `warning` | as text on the 6 surfaces | on its own container | filled (derived ink) | `borderStrong` | (`ghostBorder`) |
|---|---|---|---|---|---|---|
| light | `#6f4d00` | 5.48–7.67 | ≥ 4.92 | white 7.67 | 3.52–4.52 | 1.08–1.23 |
| dark | `#f5a623` | 7.57–9.57 | ≥ 5.56 | near-black 9.51 | 3.58–3.93 | 1.43–1.50 |
| midnight | `#f5a623` | 8.09–10.01 | ≥ 6.01 | near-black 9.51 | 3.75–4.09 | 1.30–1.40 |
| sunset | `#ffd166` | 10.91–13.70 | ≥ 7.27 | near-black 13.36 | 3.53–3.99 | 1.28–1.35 |
| gruvbox | `#ffb04d` | 6.39–9.03 | ≥ 4.60 | near-black 10.61 | 3.45–4.66 | 1.46–1.54 |

Bars: **4.5:1** for the warning family (chip labels are 8–10 pt bold caps —
small text, so AA body is the honest bar) and **3:1** for `borderStrong`
(WCAG 1.4.11: a selection border is a UI-component boundary). `ghostBorder`
is listed to show the pair is a two-strength system, not a duplicate — the
test asserts `borderStrong` beats it on every surface of every theme.

Two per-theme judgement calls, both recorded in the token comments:

- **sunset** shifts yellow-gold because its `primary` is already amber
  (`#ffb84a`) and its `error` is salmon — an orange warning would be
  indistinguishable from both.
- **gruvbox** does NOT use the canonical bright orange `#fe8019`: that hex
  tops out at 4.59:1 against `bg1` (`#3c3836`) and falls to 3.6:1 once it
  sits on its own 16 % wash, so it cannot clear AA as chip text at any alpha.
  The lifted orange keeps the warm gruvbox read and stays clear of both the
  yellow `primary` and the red `error`.

Container alphas mirror the shipped error pair (light 0.08/0.30, dark bases
0.16/0.45), and the test pins that both share `warning`'s rgb — the family
can never drift into a third hue.

`#00a86b` (the "live/connected/ALL" green — ~24 occurrences across 12 files:
index, mixer, timeline, DeckTopBar, MidiStatusChip, MidiConfigSection,
Modulation, PlaylistPanel, GlobalParams, AllModulationsPanel, EventSheet,
ZoomBanner) maps to the
existing **`tertiary`** — already defined as the auto-driven/synced green. R0
adds no token for it and touches no site; the mapping is recorded in
DESIGN.md's semantic-roles table so R1 has one answer, not fifteen.

## `constants/identity.ts`

The module states the THREE-part test a colour must pass to be an identity
rather than a token (identifies something outside the theme · flipping it
would break recognition · anything that fills with it derives ink via
`readableInk()`), then declares the closed list:

- **audio bands** — `AUDIO_BAND_ACCENT` / `AUDIO_BAND_FALLBACK` are
  **re-exported** from `utils/audioSignals.ts`, not copied. They mirror the
  Audio Companion's `SOURCE_ACCENT`; two declarations would be two things to
  drift, so identity.ts documents them and audioSignals keeps owning them.
- **`MIDI_ACCENT = '#7c5cff'`** — the physical-control violet.
- **`PLAN_ACCENT = '#22c1d6'`** — the timeline/plan subsystem accent.
- **`PANIC_AMBER = '#f5a623'`** — docs/54 §1 lists panic amber as an identity
  colour while §1.1 lists only three families; the resolution is written into
  the module. `warning` is the theme-aware *chrome* amber (caution chips,
  takeover chips, the PLAN banner); `PANIC_AMBER` is the single frozen hex
  row 17 protects ("this button must read identically forever"). Without the
  split, PANIC would turn deep-gold on the light theme the moment R1 tokenised
  it — which row 17 forbids.

MIDI violet and plan cyan are still *declared* in their `.tsx` components
(a `.tsx` cannot be imported by the node-env suite). R1 flips those files to
re-export the identity module; until then a source-text guard in the test
proves they have not drifted — and the guard passes in BOTH states, so it
will not break when R1 migrates them.

## Recipes + scales

- `Radius` chip 4 / control 8 / card 12 / panel 16 / shell 24 — 4-based
  because chip radius 4 is shipped and pinned by _190. Live Touch's
  10/14/18/22 is deliberately not imported.
- `Space` 4/8/12/16/24.
- `Type` — the font-only half of each text recipe (`headline`, `labelCaps`
  10/1.2, `microCaps` 9/1.5, `valueText`, `body`, plus docs/54 §4's
  `bigButton` 16 and `ceremonial` 20 for the Events tab). Colour is applied
  in `globalStyles` (`labelCaps`/`microCaps`/`valueText`), so the scale stays
  theme-free and testable.
- `panel` — `surfaceContainerLow`, `Radius.panel`, `ghostBorder`, ambient
  shadow, and an inset top highlight **on dark bases only** (`isLightSurface`
  decides; a white inset line is invisible on light, and a dark-tuned ambient
  is a smudge there, so the ambient flips too).
- `accentWash(accent)` 14 % fill / 45 % border / accent ink — the ONE way an
  on-state paints. `accentFill(accent)` is the loud variant with
  `readableInk()`. `glowFor(accent)` is `0 0 18px @30 %`, armed/live/selected
  only.

## Contrast tests (30, all green)

`components/design_tokens.test.ts` — it lives in `components/` because
vitest's include globs never reach `constants/`; the header says so.

1. **Completeness** — registry ⇄ palette map agree; every theme carries
   exactly the light theme's key set; every token is a non-empty, parseable
   colour; the four new keys exist on all five.
2. **Warning family** — direct text ≥ 4.5 on all 6 surfaces × 5 themes;
   text on its own container (composited over each surface) ≥ 4.5; filled +
   derived ink ≥ 4.5; container/border share `warning`'s rgb with border
   alpha > fill alpha; `warning` is not a restatement of `primary`/`error`.
3. **borderStrong** — ≥ 3:1 on every surface, and strictly stronger than
   `ghostBorder` on every surface.
4. **accentWash/accentFill table** — documented alphas (`24`/`73`); loud
   failure on a non-`#rrggbb` accent; **every fill-eligible accent** (palette
   primary/tertiary/error/warning + plan + panic + all 12 audio bands) clears
   4.5 filled on **all five themes**; and the wash never drops an
   AA-clearing accent below the 3:1 floor.
5. **Identity** — bands are the same object as `COMPANION_ACCENT` (proving
   re-export, not copy); source-text drift guards for violet/cyan/amber.
6. **Scales** — chip radius still 4; both scales strictly ascending and
   4-based; the type recipes pinned value-for-value; no third font family.
7. **Primitives** — `flattenOver` composites correctly and refuses a
   translucent backdrop or an unparseable colour (no fallbacks); light/dark
   base detection; identity dot geometry.

### Finding: MIDI violet cannot be a fill

`#7c5cff` sits in the band where **neither** near-black nor white reaches
4.5:1 — its best derived ink is **4.43:1**. The _190 system only ever paints
it QUIET (outlined KNOB / ⊞ chips), so this is not a live regression, and the
test now pins violet as quiet-only so a future filled violet chip fails in CI
instead of on the playa. **One live exception:** `components/MidiMap.tsx`
line ~328, the filled-violet SAVE button. Out of R0's scope (and outside the
Deck), but it should be re-toned in a later slice.

Also recorded in DESIGN.md: quiet washes of the fixed identity hexes on the
LIGHT theme are weak (an audio band as wash text on white is ~1.3–1.9:1) —
which is exactly why _190 paints bands loud. Neither gap was introduced here.

## Zero-visual-delta proof

- **Nothing consumes the new tokens.** The palette gained keys; no existing
  key changed value. `globalStyles` gained six style entries that no
  component references, and the added recipe functions have no call sites.
- **No literal→token swap was performed.** docs/54's R0 scope says "nothing
  consumes them yet", so no consumer file was touched — not `index.tsx`
  (_208's), not `special_events`/`_layout.tsx` (_206's), not the `#00a86b` or
  amber sites.
- **The one relocation is byte-identical.** `shadow()` moved from
  `globalStyles.ts` to `design_recipes.ts` with its body and signature
  unchanged and is re-exported from its old home, so all 17 importers resolve
  to the same function.
- `npx tsc --noEmit` — **clean** (was clean before; note that _206 reported 3
  mid-flight `theme.ts` errors while this slice had added the tokens to
  `light`+`dark` only — all five palettes are complete and that transient is
  closed).
- `npx vitest run` — **70 files / 1254 pass / 6 skip / 0 fail**. Baseline
  before this slice was 69/1224/6/0: exactly +1 file and +30 tests, all mine.
  **No pre-existing test changed result.**
- `npx eslint` on the five touched/added files — 0 errors, 0 warnings.
- `npm run web:build` — exports `dist` (all 12 routes).

## Ready for R1

The vocabulary R1–R3 need is in place and importable:
`Colors[theme].warning|warningContainer|warningContainerBorder|borderStrong`,
`Radius`, `Space`, `Type`, `constants/identity.ts`, and from `globalStyles`:
`gs.panel`, `gs.cardOnPanel`, `gs.panelHeaderRow`, `gs.labelCaps`,
`gs.microCaps`, `gs.valueText`, `accentWash`, `accentFill`, `glowFor`,
`identityDot`, `readableInk`, `withAlpha`, `shadow`.

R1 (Deck-only pure reskins, after _208 slice A) should start with the sites
this slice mapped: `#00a86b` → `tertiary`, the amber literals → the warning
family (with PANIC keeping `PANIC_AMBER`), `PlanLockBanner`'s ten `#1a1a1a`
→ `readableInk()`, `OfflineBanner` → the error container pair, and the ad-hoc
radii → the scale.

Open operator decisions from docs/54 §6 (window identity colours, glow
budget, Dimmer Rack, a sixth navy theme, density) are untouched by R0 — none
of them blocks R1's pure reskins.

## Files

- `CaptainPad/constants/theme.ts`, `CaptainPad/constants/identity.ts` (new)
- `CaptainPad/styles/design_recipes.ts` (new), `CaptainPad/styles/globalStyles.ts`
- `CaptainPad/DESIGN.md` (new), `CaptainPad/components/design_tokens.test.ts` (new)
- this report + a tracker block (`## _210 — restyle R0 tokens`)
