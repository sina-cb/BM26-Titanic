# Controller mapper: cold-review leftovers (m5)

- **ID:** 024
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** Cold code review of branch claude/nice-cerf-bl2jnk (2026-06-12)
- **Location:** simulation/src/gui/controller_map_editor.js, simulation/src/dmx/controller_registry.js
- **Created:** 2026-06-12

## Description
Two review findings deliberately deferred from the 2026-06-12 fix pass
(B1/M1–M3 and the easy minors all landed; see that day's commits):

1. **m5 — production doesn't use the tested mutation API.**
   `appendFixtures()` is exercised by tests but the panel reimplements
   it with the effect-auto-pinning twist in `addNamesToPort()`. The
   rejection logic exists twice and the tests certify the copy that
   doesn't ship. Move the pin-aware append into the registry module
   (e.g. `appendFixtures(registry, port, names, { pins })`) and make
   the panel call it. (Chip-✕ keeps its index-based splice — it must
   remove gaps too, which the name-based `unmapFixture` can't.)

2. ~~**Fixture deletion never prunes chains.**~~ DONE 2026-06-12: a
   deleted fixture's chain entry is replaced with an equal-width gap
   (downstream addresses preserved) via
   `window.controllerMappingFixturesRemoved`, wired into the par/DMX
   remove buttons, trace delete, and generator regeneration (docs/33
   decisions 16–17).

## Why it matters
(1) is a divergence bug waiting to happen — a fix to one append path
won't reach the other.
