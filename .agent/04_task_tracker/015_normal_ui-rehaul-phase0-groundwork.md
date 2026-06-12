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
