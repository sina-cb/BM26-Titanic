# Controller mapping: panel UI (cards, ports, chains, undo)

- **ID:** 015
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** docs/33_controller_mapping.md (phase 2)
- **Location:** simulation/src/gui/controller_map_editor.js (new), simulation/src/core/interaction.js, simulation/src/gui/gui_builder.js
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
Phase 2: the 🎛 Controller Mapping panel, modeled on
`view_masks_editor.js` but explicitly nicer (operator challenge from
Sina). Controller cards (name + IP with inline validation), port rows
(universe + startAddress click-to-edit, positioned occupancy bars,
shared-universe color bands, effects-pin rows), chain chips with
computed addresses, drag-to-reorder and drag-across-ports, gap chips,
unmapped tray with filter, undo toasts for small destructive ops,
danger modals only for controller/port delete, `[+ group]` bulk add.

## Suggested fix
- `simulation/src/gui/controller_map_editor.js` (new), per the UI Design
  section of docs/33 — one screen, no modes, append-based flows.
- Add `#controller-map-panel` to the pointer-down guard list at
  `simulation/src/core/interaction.js:263` (the Views-panel lesson).
- 🎛 Controllers button next to 👁 Views in `gui_builder.js`.
- Single-step undo toast (10 s) for unmap / reorder / gap edits;
  `Delete` unmaps focused chip; `Esc` backs out of transient state.

## Why it matters
This is the panel an exhausted operator uses at 2am in the dust;
phases 1+2 together already beat today's per-field hand-typing.

## Notes
Depends on task 014.
