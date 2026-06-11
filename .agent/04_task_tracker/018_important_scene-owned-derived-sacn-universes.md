# sACN listen universes: derive from mapping, move to scene level

- **ID:** 018
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** docs/33_controller_mapping.md (phase 5)
- **Location:** simulation/server/sacn_bridge.js, simulation/src/gui/gui_builder.js:947, simulation/scenes/common.yaml
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
Sina's call: "do the sacn listening universes automatically and move
the setting to scene instead of common." With a controller mapping, the
scene's listen-universe set is derived (sorted unique universes of all
mapped ports, incl. universe 1 for effects) and the 📡 sACN Settings
field becomes a read-only display. Without a mapping (logsville, dome
until migrated), the bridge uses its existing patch-derived universe
set (`sacn_bridge.js` already computes this as a fallback — it becomes
the defined behavior). Remove the hand-maintained `sacn_universes`
value from `common.yaml`.

## Suggested fix
- Per the "sACN universes: derived, scene-owned (v1)" section of docs/33.
- `sacn_bridge.js`: prefer mapping-derived list, then patch-derived;
  drop the common.yaml hand list.
- `gui_builder.js:947`: read-only derived display instead of the
  editable Listen Universes field.
- Keep `patch_manager.js`'s mismatch check as a belt-and-braces
  assertion (it should never fire again).

## Why it matters
This deletes the task-012 bug class (Logsville universe-7 mismatch →
silent dead fixtures at deployment). Closing this task closes 012.

## Notes
Depends on task 014 for the mapping-derived path; the common.yaml →
scene migration and patch-derived behavior can land independently.
Cross-reference: task 012.
