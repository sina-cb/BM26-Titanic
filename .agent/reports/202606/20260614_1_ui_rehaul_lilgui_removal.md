# 2026-06-14 — UI rehaul cutover finished: lil-gui + legacy paths removed

**Agent:** developer / simulation expert (branch `claude/stoic-johnson-zvvr54`)
**Closes the remainder of:** Notion "UI rehaul cutover remainder: soak, then
remove lil-gui + legacy paths" (task 019 tail). Soak signed off by the
operator (modern UI default since the 2026-06-12 PR #14 cutover; "the new
UI looks good").
**Builds on:** `20260612_3_ui_rehaul_complete.md`.

## What changed

The modern UI is now the **only** UI. The `?ui=legacy|modern` toggle, the
lil-gui vendor build, and every legacy-only render path are gone; the
control schema oracle and the handler registry stay (as the plan required).

### Removed
- `simulation/src/gui/ui_mode.js` — the `?ui=` toggle module.
- `simulation/src/gui/sacn_monitor.js` — legacy vanilla-DOM sACN monitors
  (modern Preact monitors in `modern/sacn_monitor_panel.js` own every
  `window.*` contract: `showSacnIn/OutMonitor`, `sacnInLog/sacnOutLog`,
  `sacnLog`, BLACKOUT button, 500 ms poll).
- `simulation/vendor/three/examples/jsm/libs/lil-gui.module.min.js` — the
  vendored lil-gui 0.17 build (no remaining importers).
- `view_presets.js`: `setupViewPresets()` + `renderViewPresetsUI()` (the
  Preact `<ViewPresetsRow>` is the only preset row). Camera math / HUD /
  `saveCameraPresets` / `animateCamera` stay.
- Static sACN IN/OUT panel HTML in `index.html` (modern mounts rebuild
  both panels with the same ids at runtime).
- Legacy `.lil-gui` CSS in `style.css` (theming, gui-card styling, nested
  indent guides, mobile width, in-drawer override). MarsinGui styling lives
  in `marsin_gui.css`, scoped to `.marsin-gui`.

### Collapsed to the single (modern) path
- `gui_engine.js`: `export const GUI = MarsinGui;` (no lil-gui import, no
  conditional). The engine seam is kept so the builders never name the
  implementation.
- `main.js`: dropped the `IS_MODERN_UI` import and every `if (IS_MODERN_UI)`
  / `if (!IS_MODERN_UI)` branch — modern view presets, modern shells,
  modern sACN monitors are now unconditional; the legacy panel-registration
  block is gone.
- `modern_root.js`: `registerSacnGlobals()` runs unconditionally.
- `interaction.js`, `agent_render.cjs`, `test_ui_e2e.js`: raycaster guards
  and UI-hide selectors narrowed from `.lil-gui, .marsin-gui` to
  `.marsin-gui`.

### Comments/docs refreshed (no behavior change)
`gui_engine.js`, `marsin_gui.js`, `marsin_gui.css`, `control_schema.js`
(+ const rename `LIL_GUI_TYPE_CLASSES` → `CONTROL_TYPE_CLASSES`),
`capture_control_schema.cjs`, `gui_builder.js`, `left_drawer.js`,
`modern/*` headers, `simulation/README.md`. The remaining `lil-gui`
mentions are accurate API-port documentation (MarsinGui faithfully mirrors
the lil-gui 0.17 controller API).

### Deliberately NOT changed
- `.agent/01_skills/00_see_the_world.md` — it never referenced lil-gui or
  `?ui=`. `UI_PANEL_IDS` in `agent_render.cjs` is unchanged: every panel id
  still exists (the modern monitors reuse `sacn-in/out-monitor-panel`).

## Verification (this container)
- `git diff --check -- simulation`: clean.
- `node --check` on all 14 changed JS/CJS files: pass.
- `npm test`: **74/74** pass (after `npm install` provides the declared
  `three` devDependency; the 3 initial failures were the missing package,
  not the change).
- Browser smoke (`xvfb-run` + puppeteer, titanic/full, gruvbox default):
  **0 `.lil-gui` nodes, 184 `.marsin-gui` nodes**, `guiInstance` present,
  698 controls built, modern sACN OUT panel mounted, `showSacnInMonitor` /
  `sacnLog` registered, 5 view-preset buttons, **0 pageerrors**. The only
  console errors are expected `ERR_CONNECTION_REFUSED` to the engine
  (`:6968`) and sACN bridges, which aren't running here.
- `--show-ui` front capture inspected: Lighting Controls drawer, Pattern
  Editor, sACN OUT monitor, view-preset row, HUD all render correctly.

## Follow-ups
- UX improvements are now unblocked but gated on individual operator
  sign-off ("parity first, opinions later").
- Mark the Notion ticket Done once this PR merges.
