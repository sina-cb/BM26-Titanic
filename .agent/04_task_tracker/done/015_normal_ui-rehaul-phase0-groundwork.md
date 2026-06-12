# 015 — UI rehaul Phase 0: groundwork

**Priority:** normal
**Filed:** 2026-06-12 · Plan: `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
**Blocked by:** — (first phase) · **Blocks:** 016, 017, 018, 019

## Scope

- Vendor `preact`, `htm`, `@preact/signals` as plain ES modules into
  `simulation/vendor/` + import map (offline rule; no build step).
- Add `?ui=modern|legacy` toggle, default **legacy**. Modern mounts an
  empty shell; legacy path byte-identical to today.
- Extract `control_schema.js` from `gui_builder.js`: the UI-agnostic walk
  of `configTree` → sections/controls/metadata/handler bindings.
- Node test: schema enumerates exactly the controls the legacy lil-gui
  build produces (count + names) — this is the parity contract.
- Capture full legacy `--show-ui` screenshot baseline for later
  side-by-side comparisons.

## Acceptance

- `?ui=legacy` (and default) behavior unchanged; sim auto-checks green.
- Schema parity test wired into `npm test`.

## Progress 2026-06-12 (session claude/admiring-shannon-4ahh4g)

- [x] Vendored preact@10.29.2, htm@3.1.1, @preact/signals@2.9.1,
      @preact/signals-core@1.14.2 → `simulation/vendor/{preact,htm,preact_signals}/`
      + import-map entries.
- [x] `src/gui/ui_mode.js` — `?ui=modern|legacy` toggle, default legacy;
      legacy path verified byte-identical in behavior (no modern host
      mounted, monitors/presets behave as before).
- [x] Schema oracle: `src/gui/control_schema.js`
      (`window.__captureControlSchema()`, 700 controls on titanic/full) +
      `agent_tools/capture_control_schema.cjs` dump tool.
- [ ] Outstanding: tracked baseline workflow doc for Phase-3 diffing
      (capture legacy + modern on same scene, diff JSON).

## COMPLETED 2026-06-12 (session claude/admiring-shannon-4ahh4g)

Delivered and validated — see .agent/02_reports/202606/20260612_3_ui_rehaul_complete.md
for the full evidence (schema diff 700/700, interaction smokes, 5-theme
screenshots, legacy escape regression).
