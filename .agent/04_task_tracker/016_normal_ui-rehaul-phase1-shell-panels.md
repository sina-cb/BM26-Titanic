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

## Progress 2026-06-12 (session claude/admiring-shannon-4ahh4g)

- [x] `FloatingPanel` component (drag/collapse/hidden classes, legacy ids,
      CSS resize) — `src/gui/modern/floating_panel.js`.
- [x] sACN IN/OUT monitors migrated (`sacn_monitor_panel.js`): signal
      stores, 500 ms stats polling while shown, `window.showSacn*Monitor`
      + `sacnInLog/sacnOutLog/sacnLog` contracts, BLACKOUT button id kept
      for engine_blackout_warning.js. Verified: log push renders, OUT
      starts collapsed+visible, collapse + drag interactions pass.
- [x] View-presets row migrated (`view_presets_row.js`): reuses legacy
      camera/persistence logic; `data-view` attrs + `window.animateCamera`
      kept for agent_render.
- [ ] Remaining: HUD top bar, warning banners/toast service, widget kit
      (ToggleButton/select/modal), 5-theme matrix + side-by-sides for the
      migrated panels, readonly/static-host checklist pass.
