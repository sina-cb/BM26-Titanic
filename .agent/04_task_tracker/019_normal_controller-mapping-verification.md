# Controller mapping: real-UI verification suite + titanic dry run

- **ID:** 019
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** docs/33_controller_mapping.md (phase 6)
- **Location:** n/a (~/tmp scripts; report in .agent/02_reports/)
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
Phase 6: prove the whole feature with the Views-panel test methodology
— puppeteer driving actual buttons, never APIs. Cover: create
controllers/ports, both add flows (3D selection + pick mode), bulk
group add, drag reorder + cross-port drag, undo toasts, effects-pin
enforcement (Chauvet @U1:511, TE Fog @U1:512), shared-universe split
ports, overflow/overlap/orphan invalid-state projection (fixtures go
unpatched, never out-of-range), save→load→save round-trip identity,
and a full titanic 61-fixture mapping dry run.

## Suggested fix
- Scripts in `~/tmp/` (gitignored), screenshots via
  `.agent/01_skills/00_see_the_world.md` (xvfb-run, --viewport 1280x720
  on software-GL), visual inspection of every PNG before claiming
  success.
- Conclude with a dated report in `.agent/02_reports/`.

## Why it matters
The mapping is the last line between the operator and silent dead
fixtures on playa; "drive the real UI" is the only test methodology
that has caught the panel-guard class of bug before.

## Notes
Depends on tasks 014–018.
