# Slot 0 — controller_cross_universe

- **Branch:** dev/claude/controller_cross_universe
- **Parent branch:** claude/intelligent-knuth-j6cba1
- **Worktree:** ~/BM26-Titanic-worktrees/controller_cross_universe
- **Slot ports:** sim HTTP 31069, save 31070, sACN 31071/31072 (none started — pure-logic change, no server needed)

## Scope

Allow the SAME universe number to be carried by two different controllers.
Previously the controller-mapping projection treated a universe shared
across controllers as a hard conflict: it raised a `dup_universe`
violation and marked the higher-id controller's port as a `contestedPort`,
projecting every fixture on that port UNPATCHED. Per operator decision
2026-06-15, controllers are independent sACN unicast targets, so a shared
universe number is not a conflict. The only real hazard — two claims
landing on overlapping CHANNELS within a universe — must still be flagged.

## Changes

`simulation/src/dmx/controller_registry.js` — `computeProjection()`:

- Removed the "one universe never spans two controllers" sweep
  (`universeOwner` map, `contestedPorts` set, and the `dup_universe`
  violation). The port-iteration setup that built `allPortsSorted` is
  retained (stable id order, deterministic claim ordering).
- Removed `contestedPorts.has(port)` from the `portDead` predicate, so a
  port sharing a universe is no longer pre-unpatched. `portDead` now means
  only bad/duplicate controller IP or an out-of-range universe.
- Updated the two doc comments that listed "contested universe" among the
  hard-unpatch reasons.

The legitimate safety net is UNCHANGED and now does the cross-controller
work it always could: the per-universe overlap sweep (the `overlap`
violation, ~lines 823-860) aggregates occupancy across ALL controllers
into one `occupancy` map keyed by universe. With contestedPorts no longer
pre-unpatching, both controllers' valid claims now reach that map, so two
controllers on the same universe with overlapping channels still produce
an `overlap` violation and paint BOTH claims red — without unpatching
either (explicit addresses stand, decision 19). Verified by a new test.

No GUI changes were needed: `simulation/src/gui/controller_map_editor.js`
renders violations generically by `v.message` (filtered per controller/port
by `violationsFor`) and never special-cased `dup_universe`;
`simulation/src/gui/modern/controller_map_panel.js` does not reference
violation codes at all. A repo-wide grep for `dup_universe` / `contestedPort`
now returns zero hits in source (one descriptive word in a test comment).

## Files changed

`git diff --name-status HEAD`:

```
M	simulation/src/dmx/controller_registry.js
M	simulation/tests/controller_registry.test.js
```

Test changes:
- Replaced `a universe spanning two controllers unpatches the higher-id
  controller port` with `two controllers may carry the SAME universe with
  non-overlapping channels` (asserts 0 violations, both fixtures patched,
  and the aggregated universe map lists both claims).
- Added `a shared universe with OVERLAPPING channels still flags overlap
  (cross-controller)` (asserts an `overlap` violation, both addresses
  kept, both layout items marked `conflict`).
- Rewrote `effects pins survive a contested-universe port; normal pins die
  with it` into `a shared universe across controllers patches both;
  effects pins stay independent` (the normal fixture on the 2nd controller
  now patches; the effects pin remains independent of the port universe).

## Tests run

- Unit: `node --test tests/controller_registry.test.js` → 38 pass / 0 fail.
- Universe-adjacent: `node --test tests/sacn_mapper.test.js` → 6 pass / 0 fail.
- Full sim suite: `node --test tests/*.test.js` → 68 pass / 3 fail. The 3
  failures (`tests/fog_regression.test.js` TEFogMachine / ChauvetHaze4D
  fixtureDef tests, and `tests/panel_visibility.test.js`) are PRE-EXISTING
  on the parent branch — confirmed by stashing this change and re-running:
  same 3 fail. Unrelated to this slice.
- Sim auto-checks (`.agent/00_gol/04_sim_auto_checks.md`):
  `git diff --check -- simulation` → clean; `node --check` on both changed
  files → pass.
- Sim browser smoke: NOT run. This is a pure-logic projection change with
  no rendering/scene/GUI edits; the projection contract is fully exercised
  by the unit tests above.

## Known gaps / follow-ups

- **docs/33_controller_mapping.md contradicts the new decision** and was
  NOT edited (per task instruction: note, don't rewrite). Stale lines:
  - L98-100: "a universe **belongs to exactly one controller**" (the
    intro now only ever meant multiple ports on the SAME controller).
  - L462: violation table row "A universe belongs to exactly one
    controller (one IP) | red chip on both ports".
  - L541: "One universe never spans two controllers."
  Recommend the operator update these to reflect operator decision
  2026-06-15 (same universe across controllers is allowed; only
  overlapping channels within a universe are flagged). The docs/33
  "decision" log should gain decision 21 for this.

## Operator action requested

Ready for review and merge. Please also decide whether to fold the docs/33
terminology fix (above) into this branch or handle it separately.
