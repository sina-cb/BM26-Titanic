# 016 — UI rehaul Phase 1: shell + simple panels

**Priority:** normal
**Filed:** 2026-06-12 · Plan: `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
**Blocked by:** 015 · **Blocks:** 017, 018

## Scope

- `FloatingPanel` component: drag / resize / collapse / hide / z-order /
  position persistence (scene-config style), CaptainPad card styling.
- Widget kit v1 (token-driven): ToggleButton, momentary button, select,
  chip, toast service, modal.
- Migrate under `?ui=modern`: HUD top bar (scene/theme selects, FPS chip,
  status), warning banners (blackout, unpatched, spotlight, dirty chip),
  toast service, sACN IN + OUT monitors, view-presets row.
- `window.*` compatibility shim for the migrated surfaces
  (`showSacnInMonitor/OutMonitor`, toast entry points, …).

## Acceptance (per panel)

- Side-by-side screenshots legacy vs modern, same scene state.
- Capability checklist signed off; readonly + static-host modes verified.
- Theme matrix (5 themes) re-captured for migrated panels.
