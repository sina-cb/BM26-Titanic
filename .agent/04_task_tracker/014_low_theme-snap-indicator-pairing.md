# 014 — Theme the snap-mode indicator + 3D cursor pair

**Priority:** low
**Filed:** 2026-06-12 (new-UI theming pass)

## Problem

`simulation/src/core/interaction.js` (`setSnapStep`) colors the snap-mode
DOM chip cyan (`#00ccff`, step 1) / amber (`#ffaa00`, step 2) and sets the
SAME colors on the in-scene 3D cursor ring/arrow materials
(`snapRingMat.color.setHex`, `snapArrow.setColor`). The 2026-06-12 theming
pass deliberately left these untouched: CSS custom properties can't drive
three.js material colors, and theming only the DOM half would break the
visual pairing between chip and cursor.

## Options

1. Leave fixed (current state) — in-scene signaling, arguably like the
   `--caution` safety-amber decision.
2. Read the resolved palette from `src/gui/theme.js` (export a getter) and
   set both the chip CSS and the material hexes from the same token pair
   (e.g. `tint` / `caution`), re-applied on theme change.

## Acceptance

- Operator decision recorded; if (2), chip and 3D cursor stay color-matched
  in all five themes and after live theme switches while snap mode is armed.
