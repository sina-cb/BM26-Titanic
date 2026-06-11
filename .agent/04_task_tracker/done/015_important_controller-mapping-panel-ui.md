# Controller mapping: panel UI (cards, ports, chains, undo)

- **ID:** 015
- **Priority:** IMPORTANT
- **Status:** DONE
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

## Resolution
Implemented 2026-06-11 (branch claude/nice-cerf-bl2jnk).
`controller_map_editor.js` + panel markup/CSS: controller cards, ports
with positioned occupancy bars, address-prefixed chain chips,
drag-reorder + cross-port drag, gap + pinned-effects chips, undo
toasts, danger modals, both add flows (3D selection order + pick mode
with live next-channel hint), group bulk add, filterable unmapped tray,
pointer-guard registration. Verified by real-UI puppeteer smoke
(screenshots inspected). Shared-universe color bands folded into task
016's polish. See `.agent/02_reports/202606/20260611_2_controller_mapping_impl.md`.

2026-06-11 (later): `+ group…` bulk add removed per operator decision 11
(a group spans 6-15 controllers; per-fixture mapping only).
