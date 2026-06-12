# 019 — UI rehaul Phase 4: cutover + legacy removal

**Priority:** low (until 015–018 land)
**Filed:** 2026-06-12 · Plan: `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
**Blocked by:** 015, 016, 017, 018

## Scope

- Flip default to `?ui=modern`; keep `?ui=legacy` as escape hatch for one
  full release/operating cycle.
- After the soak: remove lil-gui vendor file + legacy rendering code from
  `gui_builder.js` (control schema + handler registry stay).
- Update skills/docs that reference UI panel IDs (`agent_render.cjs`
  `UI_PANEL_IDS`, `.agent/01_skills/00_see_the_world.md`).
- Only AFTER cutover: UX improvement proposals, individually signed off by
  the operator ("parity first, opinions later").

## Acceptance

- Operator sign-off on cutover; full auto-checks + 5-theme matrix on the
  default path; agent renders work unchanged.

## Progress 2026-06-12 — cutover FLIPPED (session claude/admiring-shannon-4ahh4g)

- [x] Default flipped to modern (`ui_mode.js`); `?ui=legacy` escape hatch kept.
- [x] agent_render hides `.marsin-gui` alongside `.lil-gui`.
- [ ] Remaining (do NOT close): one operating-cycle soak on `?ui=modern`
      default, then remove lil-gui vendor + legacy render paths and update
      skill docs (UI_PANEL_IDS, 00_see_the_world.md).
