# Controller mapping: 3D linkage (pick mode, tints, chain polyline)

- **ID:** 016
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** docs/33_controller_mapping.md (phase 3)
- **Location:** simulation/src/core/interaction.js, simulation/src/core/animate.js, simulation/src/gui/chain_overlay.js (new)
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
Phase 3: the always-on 3D feedback that makes mapping visual. Selection
order → chain order (the existing `selectedFixtureIndices` Set already
iterates in insertion order — no structural change). Pick mode with
hover flash-highlight, mapped/unmapped tint on selection dots, "show me
what's left" isolation of unmapped fixtures, per-port isolation eye
(reuse the Views zero-scaling pass in `animate.js`), chain polyline with
numbered sprites, bidirectional chip↔3D click/hover sync.

## Suggested fix
- Per the "3D feedback" and "two add flows" sections of docs/33.
- Generalize `window.__activePreviewView` to an arbitrary fixture
  predicate, or add a parallel `__activePortPreview` consumed by the
  same pass in `animate.js`.
- Small new `chain_overlay.js` for the polyline + numbered sprites.

## Why it matters
For a daisy chain, the numbered polyline is the difference between
"looks right" and "is right" — the operator can visually walk the cable
path before powering anything.

## Notes
Depends on tasks 014 and 015 (done 2026-06-11).

2026-06-11 — partial work landed with phases 1+2: chip→3D selection,
hover flash-highlight (chips + tray), selected-chip ring, selection-order
capture. Remaining: mapped/unmapped tint, port isolation eye, chain
polyline + numbered sprites, unmapped isolation, shared-universe color
bands (moved here from 015).

