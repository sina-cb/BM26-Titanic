# 017 — UI rehaul Phase 2: pattern editor + views editor

**Priority:** normal
**Filed:** 2026-06-12 · Plan: `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
**Blocked by:** 015, 016 · **Blocks:** 018 (shares widget kit learnings)

## Scope

- Pattern editor on `FloatingPanel`: plain `<textarea>` (CodeMirror 6 is a
  separate post-cutover enhancement decision, NOT parity), preset CRUD
  (+/−, active state), autorun checkbox, compile/run + save buttons,
  status bar (ok/error), quick-reference docs, selector-only mode,
  position/size/collapsed persistence (`_patternEditor`).
- Views editor: view cards, group/member chips, assign/unassign, bit hex
  display, preview + isolation HUD, modals (rename/delete), dirty-save
  pulse, save flow to views.yaml.
- Extend `window.*` shim: `toggleViewMasksPanel`, `refreshViewMasksPanel`.

## Acceptance

- Per-panel side-by-side screenshots + checklist sign-off.
- Puppeteer smoke: edit pattern → compile → status updates; preset CRUD
  persists; view assign/unassign round-trips through save.

## COMPLETED 2026-06-12 (session claude/admiring-shannon-4ahh4g)

Delivered and validated — see .agent/02_reports/202606/20260612_3_ui_rehaul_complete.md
for the full evidence (schema diff 700/700, interaction smokes, 5-theme
screenshots, legacy escape regression).
