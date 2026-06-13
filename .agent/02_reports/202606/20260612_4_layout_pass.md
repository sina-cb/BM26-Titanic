# 2026-06-12 — Panel layout pass: exclusion strip, z-banding, localStorage geometry

**Agent:** developer / simulation expert + three subagents (layout auditor,
test writer, cold reviewer) + browser validator
**Trigger:** operator-reported UI conflicts (visible in the rehaul
screenshots); audit in this report's §"What was wrong".

## What was wrong (audited, hit-tested)

- Lighting Controls (top:10, z100) covered the HUD bar's exit ✕ / LIVE
  chip — permanently unclickable.
- sACN IN monitor default (14,60, z200) buried the pattern editor 100%
  with no click-to-front anywhere.
- sACN OUT used a stale magic `top:600` ("perfectly under the editor"
  for a geometry that no longer existed): sat on the info panel at 720p,
  expanded off-screen.
- Engine Parameters had z9999 (safety-warning band) and a 50 ms polling
  follower; collided with the Views panel at 720p.
- Pattern editor geometry was persisted into `scenes/common.yaml`
  (shared across scenes, committed to git, no viewport clamping).

## What changed

- **`src/gui/panel_layout.js` (new)** — the layout policy module:
  - `TOP_MIN = 44` exclusion strip (defaults, drags, restores all clamp).
  - Z band 100–150 with click-to-front; warnings stay 9000+; engine
    params demoted out of the warning band. Re-registration adopts
    recreated elements (engine params is destroyed/recreated on lighting
    mode switches) and tears down stale observers.
  - `findFreeSlot` cascade (+24,+24) for occupied slots.
  - Geometry persistence per machine in localStorage
    (`bm26.sim.panelLayout`), saved only after the operator touches a
    panel AND its geometry actually changed; restores viewport-clamped.
    `_patternEditor` removed from `common.yaml`, its write removed from
    `gui_builder`, autoRun migrated once from old YAML state
    (`bm26.sim.peAutoRun`).
- **Defaults:** Lighting Controls top:44; pattern editor (14,52), boots
  **collapsed below 1366 px** (operator decision); sACN IN+OUT default
  **collapsed** (operator decision), OUT bottom-anchored (`bottom:180`),
  IN placed under the live editor rect via the cascade at show-time;
  Views panel top:84, right edge computed from the live Lighting
  Controls width (+30 gap); isolation HUD top:44/right:350.
- **Engine params follower:** ResizeObserver + MutationObserver on the
  editor AND the Views panel + window resize (rAF-coalesced) — no
  polling; flips below the editor when the right side is occupied.
- Collapse state derives from the `collapsed` class (editor handler
  refactored; restores drive each panel's real collapse button), fixing
  the dead-first-click desync.

## Validation (browser, 1280x720 + 1920x1080, fresh + everything-open)

- Zero pageerrors in all sessions; **no panel-over-panel overlaps** in
  any default state; ✕/LIVE/theme/scene hit-tests pass.
- Collapse defaults + first-click behavior verified post-fix at 1280.
- Params↔Views reflow verified (overlap 0 after fix; was 9555 px²).
- Click-to-front raises buried panels (z within band).
- Persistence: drag → store → reload restores exactly; bogus 5000px
  stored position clamps on-screen; autoRun survives reload.
- `window.exportConfig()` writes common.yaml WITHOUT `_patternEditor`.
- Legacy (`?ui=legacy`) regression clean (panels registered, no errors).
- `npm test` 20/20 (11 new `panel_layout` unit tests).
- Screenshots: `.agent_renders/layout_final_default_1920.png`,
  `layout_final_open_1280.png`, `layout_final_open_1920.png`, plus the
  validator's `layout_fixed_*.png` set.

## Known nits (accepted)

- Expanding the editor from the sub-1366 boot-collapsed state opens at
  min-height (200 px) rather than the 520 px CSS default (no saved
  height exists yet); drag-resize once and the height persists.
- A viewport-clamped restore can leave a 100 px sliver (MIN_VISIBLE
  policy) — reachable, drag to taste.
- Placement/follow are rAF-deferred: instant on real GPUs, visibly lagged
  only on rAF-starved software-GL environments.
- Legacy-mode small-screen auto-collapse keeps its private-state handler
  (legacy is a temporary escape hatch; modern paths are class-derived).
