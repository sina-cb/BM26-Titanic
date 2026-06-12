# 018 — UI rehaul Phase 3: Lighting Controls (the bulk)

**Priority:** normal
**Filed:** 2026-06-12 · Plan: `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
**Blocked by:** 015, 016, 017 · **Blocks:** 019

## Scope

Render the Phase-0 control schema with the widget kit, replacing the
lil-gui tree under `?ui=modern`. Migrate section-by-section (Atmosphere
first — simplest; DMX Fixtures last — hairiest), legacy one URL param away
throughout:

- Nested sections with open/close persistence.
- Fader/slider, color swatch + gradient stop editor (live preview during
  drag, debounced save), number field, checkbox, select.
- Fixture / strand / iceberg / trace / generator cards incl. selected-card
  sync with 3D picking — BOTH directions.
- DMX patch editors, metadata (V2) panels, view-membership chips,
  auto-patch toolbar, group visibility toggles, hold-to-delete patterns.
- Save Configuration / Views buttons; undo (`pushUndo`) on every mutation;
  `debounceAutoSave` wiring identical to legacy.
- `window.guiInstance` shim providing `controllersRecursive()/
  updateDisplay()` semantics for external callers.

## Acceptance

- Schema parity test green against modern render.
- Puppeteer smoke per section: control mutate → params + dirty + autosave;
  3D edit → UI refresh.
- Side-by-side screenshots per section; 5-theme matrix; readonly +
  static-host modes.

## COMPLETED 2026-06-12 (session claude/admiring-shannon-4ahh4g)

Delivered and validated — see .agent/02_reports/202606/20260612_3_ui_rehaul_complete.md
for the full evidence (schema diff 700/700, interaction smokes, 5-theme
screenshots, legacy escape regression).
