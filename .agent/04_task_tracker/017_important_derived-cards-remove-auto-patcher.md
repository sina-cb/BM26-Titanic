# Derived patch fields on cards; remove the auto-patcher

- **ID:** 017
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** docs/33_controller_mapping.md (phase 4)
- **Location:** simulation/src/gui/gui_builder.js, simulation/src/dmx/auto_patcher.js (to delete), .agent/00_gol/10_auto_patcher.md
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
Phase 4: make the mapping the single source of truth. Fixture-card
patch fields become read-only when chain-mapped ("Derived from
Controller Mapping — … Edit in the Controllers panel"), unmapped
fixtures get an "open in panel, pre-staged in pick mode" button.
Delete `auto_patcher.js` entirely (Sina's call: "remove auto patching
and instead let's only rely on the controller mapper") —
`getFootprint()` / `isGlobalEffect()` move into `controller_registry.js`;
metadata assignment already moved to the projection pass in task 014.
Remove the legacy GUI buttons that call `autoPatchAll` /
`clearAllPatches`; "Clear all" becomes a danger-modal panel operation.

## Suggested fix
- Per "The auto-patcher is removed" section of docs/33.
- Retire/rewrite `.agent/00_gol/10_auto_patcher.md` to point at docs/33
  — needs Sina's sign-off on the spec change.

## Why it matters
Keeping two patching paths alive is exactly the double-entry bug class
this feature exists to kill; the legacy button writes fields the panel
owns.

## Notes
Depends on tasks 014 and 015.
