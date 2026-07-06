# 2026-06-12 — UI rehaul complete: modern UI is the default

**Agent:** developer / simulation expert + two subagents (remote container,
branch `claude/admiring-shannon-4ahh4g`)
**Plan executed:** `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
(tasks 015–018 → `done/`; 019 partially — see below)
**Builds on:** theming work (`20260612_1_new_ui_parity_dev.md`),
checkpoint branch `dev/new_ui_lilgui`.

## What shipped

The sim UI is now a modern, CaptainPad-styled implementation and the
**default** (`?ui=legacy` is the escape hatch, byte-identical to the
checkpoint). Architecture per the plan:

1. **Vendored stack** (offline, no build step): preact 10.29.2, htm 3.1.1,
   @preact/signals 2.9.1/core 1.14.2 in `simulation/vendor/`.
2. **MarsinGui** (`src/gui/modern_gui/`): a lil-gui-API-compatible control
   engine with CaptainPad widgets — fader tracks + `--fader-knob` knobs,
   pill toggles, themed selects, swatch+hex color (incl. hue-rainbow
   sliders), macro buttons, Space Grotesk folder titles, indent guides,
   `gui-card` selection glow. `gui_builder.js` and `pattern_editor.js` run
   **unchanged** against it via the `gui_engine.js` indirection, so the
   Lighting Controls tree and Engine Parameters panel have structural
   functional parity. Semantics ported from vendored lil-gui 0.17.0
   (onChange/onFinishChange propagation, listen() rAF loop, openAnimated
   with synchronous `_closed`, autoPlace, `--width`). Deliberate deltas
   documented in the file header (root class `marsin-gui`, pointerdown
   raycaster guard, no `onOpenClose`, fail-loud `add()`).
3. **Modern panels** (`src/gui/modern/`): sACN IN/OUT monitors and the
   view-presets row as Preact components on signals (all `window.*`
   contracts preserved: `showSacn*Monitor`, `sacnInLog/sacnOutLog/sacnLog`,
   `animateCamera`, BLACKOUT button id). Pattern editor and Views editor
   use the **modern shell, legacy brain** pattern: Preact renders the
   exact id/class DOM contract (table in `modern/SHELL_NOTES.md`); the
   legacy editor logic attaches unchanged.
4. **Schema oracle**: `control_schema.js` + `capture_control_schema.cjs`
   serialize whichever engine is live; used to prove parity (below).

## Evidence (all in `.agent_renders/`, this container)

- **Schema diff**: legacy vs modern on titanic/full — **700 vs 700
  controls, 0 mismatches** across folder titles, control names, types,
  min/max/step, option lists (`schema_legacy.json` / `schema_modern.json`).
- **Interaction smokes** (modern): number setValue + input-event path
  mutate params and set `__sceneDirty`; boolean/option/folder toggles;
  pattern editor loads 72 presets, preset switch + Compile → "✓ Compiled
  OK"; Views panel toggles and renders 35 rows; monitors log/poll; preset
  row drives the camera. **Zero pageerrors** in every run.
- **Theme matrix** (modern default, `--show-ui`): `modern_light.png`,
  `modern_dark.png`, `modern_midnight.png`, `modern_sunset.png`,
  `modern_gruvbox.png` — all readable, no overflow at 330 px panel width.
- **Legacy escape** (`?ui=legacy`): 185 `.lil-gui` nodes, 0 `.marsin-gui`,
  no modern mounts, 700 controls, 72 presets, 0 pageerrors.
- **Auto-checks**: `git diff --check` clean; `node --check` on all new
  files; `npm test` **9/9** (fog regression + theme parity).

## Task 019 status (NOT fully closed)

Cutover default flipped + render tooling updated. Remaining before
closing: one operating-cycle soak on the modern default, then remove the
lil-gui vendor file + legacy-only render paths and update
`.agent/01_skills/00_see_the_world.md` / `UI_PANEL_IDS`.

## Known notes for review

- Warning banners, toasts, HUD bar, scene/theme selects are shared
  vanilla+token implementations used by BOTH modes (they predate the
  framework and are already CaptainPad-styled) — not legacy debt.
- Readonly (`?readonly=1`) and static-host behavior unchanged: modern
  mounts are skipped in readonly exactly like the legacy setups.
- Scene YAML runtime residue from validation boots is intentionally
  uncommitted (known auto-save behavior).
- CaptainPad untouched; palette parity still guarded by
  `tests/theme_parity.test.js`.
