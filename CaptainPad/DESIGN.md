---
version: alpha
name: CaptainPad
description: >-
  The operator control surface for the Titanic's lighting rig. CaptainPad's
  palette tokens wearing Live Touch's instrument grammar. Five themes, one
  vocabulary. Machine source of truth: CaptainPad/constants/theme.ts — the
  values below are the LIGHT (default) theme; the other four carry the same
  key set.
colors:
  text: "#191c1d"
  background: "#f8f9fa"
  surface: "#f8f9fa"
  surface-container-low: "#f3f4f5"
  surface-container-lowest: "#ffffff"
  surface-container-high: "#e7e8e9"
  surface-dim: "#d9dadb"
  primary: "#006875"
  on-primary: "#ffffff"
  primary-container: "#00e5ff"
  secondary: "#466270"
  secondary-container: "#c6e4f4"
  tertiary: "#1b9e77"
  error: "#ba1a1a"
  error-container: "rgba(186, 26, 26, 0.08)"
  error-container-border: "rgba(186, 26, 26, 0.3)"
  warning: "#6f4d00"
  warning-container: "rgba(111, 77, 0, 0.08)"
  warning-container-border: "rgba(111, 77, 0, 0.3)"
  ghost-border: "rgba(186, 201, 204, 0.4)"
  border-strong: "rgba(70, 98, 112, 0.85)"
  ambient-shadow: "rgba(25, 28, 29, 0.05)"
  identity-midi: "#7c5cff"
  identity-plan: "#22c1d6"
  identity-panic: "#f5a623"
typography:
  headline:
    fontFamily: SpaceGrotesk_700Bold
    fontSize: 20px
    letterSpacing: 1px
  label-caps:
    fontFamily: SpaceGrotesk_700Bold
    fontSize: 10px
    letterSpacing: 1.2px
  micro-caps:
    fontFamily: SpaceGrotesk_700Bold
    fontSize: 9px
    letterSpacing: 1.5px
  big-button:
    fontFamily: SpaceGrotesk_700Bold
    fontSize: 16px
    letterSpacing: 1px
  ceremonial:
    fontFamily: SpaceGrotesk_700Bold
    fontSize: 20px
    letterSpacing: 1.2px
  value:
    fontFamily: Inter_600SemiBold
    fontSize: 12px
  body:
    fontFamily: Inter_400Regular
    fontSize: 14px
rounded:
  chip: 4px
  control: 8px
  card: 12px
  panel: 16px
  shell: 24px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  panel:
    backgroundColor: "{colors.surface-container-low}"
    rounded: "{rounded.panel}"
    padding: 12px
  panel-header:
    typography: "{typography.label-caps}"
    textColor: "{colors.secondary}"
    padding: 8px
  card-on-panel:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.card}"
    padding: 16px
  chip-quiet:
    textColor: "{colors.primary}"
    rounded: "{rounded.chip}"
    height: 16px
  chip-loud:
    textColor: "{colors.on-primary}"
    rounded: "{rounded.chip}"
    height: 16px
  chip-ghost:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.chip}"
    height: 16px
  control-off:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.control}"
    height: 44px
  control-on:
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    height: 44px
  control-warning:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.warning}"
    rounded: "{rounded.control}"
    height: 44px
  control-danger:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.error}"
    rounded: "{rounded.control}"
    height: 44px
  restore-rail-chip:
    backgroundColor: "{colors.surface-container-lowest}"
    typography: "{typography.micro-caps}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.control}"
    height: 44px
---

# CaptainPad design system

The contract is `docs/54_deck_ui_restyle.md`; this file is its token form.
The **machine source of truth is `constants/theme.ts`** (five palettes,
identical key sets) plus `constants/identity.ts` and
`styles/design_recipes.ts`. The YAML above is the same system in the
`design.md` format (`.agent/os/ui_design.md`) so an agent can read the whole
vocabulary in one place; where they could ever disagree, the TypeScript
wins, and `components/design_tokens.test.ts` is what keeps them honest.

Lint is ad hoc only (`npx @google/design.md lint`), never in CI, never a
build dependency.

## Overview

CaptainPad is an instrument, operated at night, on a dusty playa, by someone
who is also doing five other things. Two consequences run through every rule
below:

1. **Density is a feature.** Row heights, the 244 px parameter column, the
   GEM strip — compactness is deliberate. "Roomier" is a different project.
2. **Colour is never the only carrier.** Every state also says what it is in
   text, and every abbreviated label carries a spelled-out accessibility
   label. The palette flips five ways; the words do not.

The look is **CaptainPad's tokens wearing Live Touch's grammar**: a panel is
one object, headers are chrome-thin and carry an identity dot, on-states are
translucent accent washes, and glow is rationed. Live Touch's standalone navy
is NOT imported — the theme bridge (`docs/ui/touch_control_theme.js`) already
makes Live Touch wear CaptainPad's palette when embedded, so colour authority
runs one direction only.

## Colors

Five themes: `light` (default, "never break"), `dark`, `midnight`, `sunset`,
`gruvbox`. **Every theme carries every key** — a missing key crashes at paint
time by design (Codex P0: no fallbacks), and the completeness test pins it.

### Semantic roles

| Token | Role |
|---|---|
| `primary` | The app's accent. Selection, the active thing you chose. |
| `tertiary` | "Auto-driven / synced / connected" green — BPM sync, autopilot, engine-is-driving. Retires the scattered `#00a86b` literal (6+ sites). |
| `error` | FAILURE, and BLACKOUT. Never merely "careful". |
| `warning` | Caution: something ELSE is driving (plan takeover, the PLAN banner), or this control is dangerous. |
| `ghostBorder` | Decorative hairline. ~1.1–1.5:1 — it separates, it does not signal. |
| `borderStrong` | Selected / focused / hovered chrome. ≥ 3:1 on every surface. |
| `surfaceContainerLow` | Panel bodies. |
| `surfaceContainerLowest` | Cards ON a panel, and quiet-chip grounds. |

### The warning family (added by docs/54 R0)

Amber is per-theme, not one hex, because a hex that reads as "caution" on a
dark stage is illegible on the daytime palette — the historical `#f5a623` is
~2:1 on white. Measured (`components/design_tokens.test.ts`):

| Theme | `warning` | as text on surfaces | on its own container | filled, with derived ink |
|---|---|---|---|---|
| light | `#6f4d00` | 5.48–7.67 | ≥ 4.92 | white, 7.67 |
| dark | `#f5a623` | 7.57–9.57 | ≥ 5.56 | near-black, 9.51 |
| midnight | `#f5a623` | 8.09–10.01 | ≥ 6.01 | near-black, 9.51 |
| sunset | `#ffd166` | 10.91–13.70 | ≥ 7.27 | near-black, 13.36 |
| gruvbox | `#ffb04d` | 6.39–9.03 | ≥ 4.60 | near-black, 10.61 |

Two per-theme judgements worth knowing: **sunset** shifts yellow-gold because
its `primary` is already amber, and **gruvbox** uses a lifted orange rather
than the canonical `#fe8019`, which tops out at 4.59:1 on `bg1` and cannot
clear AA once it sits on its own wash.

`borderStrong` measures 3.45–4.66 across all five themes, against
`ghostBorder`'s 1.08–1.54 — the two are the same hue family at two strengths.

### Identity colours (`constants/identity.ts`)

A closed list of theme-INDEPENDENT hexes: audio band accents (mirroring the
Audio Companion), `MIDI_ACCENT` violet, `PLAN_ACCENT` cyan, `PANIC_AMBER`.
They identify things that exist outside the theme, so they must not flip with
it. Every surface that FILLS with one derives its ink through `readableInk()`.
If a colour does not meet that bar, it is a token, not an identity.

### Known contrast gaps (measured, pre-existing, not introduced by R0)

- **MIDI violet `#7c5cff` cannot carry small text as a fill** — its best
  derived ink is 4.43:1. It is a QUIET-tone accent only (outlined KNOB / ⊞
  chips). `MidiMap.tsx`'s filled violet SAVE button is the one live
  exception; a future slice should re-tone it.
- **Quiet washes on the LIGHT theme are weak for the fixed identity hexes**
  (an audio band as wash text on white is ~1.3–1.9:1). The _190 system
  already paints bands LOUD (filled + derived ink) for exactly this reason —
  never wash a band colour on a light ground.

## Typography

Two families, no third: **SpaceGrotesk_700Bold** for caps labels and
headlines, **Inter** for body and numeric readouts. Recipes live in
`Type` (`constants/theme.ts`); coloured versions in `globalStyles`.

| Recipe | Use |
|---|---|
| `headline` 20 / 1.0 caps | Page and modal titles. |
| `labelCaps` 10 / 1.2 caps | The dominant label — panel headers, section labels, control captions. |
| `microCaps` 9 / 1.5 caps | One step down: restore-rail chips, countdowns, timestamps. |
| `valueText` Inter 600 / 12 | Numeric readouts beside a control. |
| `body` Inter 400 / 14 | Prose and hints. |
| `bigButton` 16 / `ceremonial` 20 | Events-tab stage buttons (≥ 88 pt tall) and ceremonial reveals (≥ 160 pt). |

The param row is its OWN scale (7–10 pt), computed by
`paramRowMetrics()` from measured width. It is canon: do not fold it into
these recipes, and do not hand-tune a chip's font at a call site.

## Layout

`Space` = 4 / 8 / 12 / 16 / 24. Gaps and padding come from it.

- Interactive targets are **≥ 44 pt**, using `hitSlop` where the visual box
  is smaller (chips are 13–16 pt tall and stay that way).
- A restore rail costs its 44 pt only when something is closed.
- Panel headers are chrome-thin: every pixel spent on a header is a pixel off
  the pad. A restyle repaints a header; it never thickens one.
- Row heights pinned by `playlist_row_sizing.ts` and column weights ruled by
  the operator are layout canon — paint changes must not move them.

## Elevation & Depth

Three levels, and no more:

1. **Ground** — the page (`background`).
2. **Panel** — `surfaceContainerLow`, 1 px `ghostBorder`, an inset top
   highlight on dark bases only (a white inset line is invisible on light),
   and one ambient shadow. This is what makes a window read as an object.
3. **Card on panel** — `surfaceContainerLowest`, no shadow. Depth comes from
   the surface step, not from stacking shadows.

**Glow is not elevation.** `glowFor(accent)` (0 0 18 px at 30 %) marks
ARMED / LIVE / SELECTED and the current show stage — nothing at rest, ever.
A screen where everything glows tells the operator nothing.

## Shapes

`Radius` = chip 4 · control 8 · card 12 · panel 16 · shell 24. Four-based,
because the chip radius is already shipped and pinned by the _190 tests.
Live Touch's 10/14/18/22 scale is deliberately not imported. No call site
invents a sixth radius.

## Components

**Panel** (`gs.panel`) — surface + hairline + inset highlight + ambient
shadow, `Radius.panel`. Every workspace window and modal sits on it, so the
Deck reads as a set of instruments rather than one pane and two loose stacks.

**Panel header** (`gs.panelHeaderRow` + `identityDot(color)`) — an 8 px round
identity dot, the title in `labelCaps`, right-aligned controls. The dot's
colour is the window's identity and is reused by its restore chip, so
closed → open reads as the same object moving.

**Chips** — the _190 tone system, FROZEN (`paramChipColors`):

| Tone | Paint | Means |
|---|---|---|
| `loud` | filled identity colour + `readableInk` | something about the MUSIC (♪ band) |
| `live` | filled green | the engine is driving this |
| `quiet` | 8 % wash, 40 % border, accent text | reference (which encoder, which CC) |
| `ghost` | palette neutrals | inert / not mapped |

**On-states** (`accentWash(accent)`) — 14 % accent fill, 45 % accent border,
accent text. This is the ONE way a control paints "on", on every surface. A
flat opaque repaint is the thing this replaces. Use `accentFill(accent)` when
a state must be LOUD; it derives ink, so a fixed identity hex stays readable.

**PANIC** — `PANIC_AMBER`, loud, unmistakable, and frozen. The operator finds
it by colour in the dark. It never shares its paint with anything else.

**BLACKOUT** — the error family, for the same reason.

## Do's and Don'ts

**Do**

- Add a colour to `constants/theme.ts` (all five palettes) before using it.
- Derive an on-state from `accentWash` / `accentFill`, never by hand.
- Derive ink on any filled accent with `readableInk()`.
- Keep behaviour, gestures, engine routes and row heights untouched when
  restyling — a reskin that changes a test result is a defect.

**Don't**

- Don't put a hex literal in a component. The only exceptions are the closed
  identity list, and DATA colours the engine or a show file supplies.
- Don't fork a second palette, and don't import Live Touch's navy.
- Don't glow resting chrome.
- Don't invent a font size, a radius, or a spacing step that is not in the
  scales above.
- Don't let colour be the only carrier of a state.
