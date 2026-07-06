# 2026-06-12 — UI rehaul plan: modern framework migration with full parity

**Author:** developer / simulation expert (session branch
`claude/admiring-shannon-4ahh4g`, on top of the theming work in
`20260612_1_new_ui_parity_dev.md`)
**Status:** PLAN ONLY — no code changes yet. Operator checkpoint requested
2026-06-12. Execution tracked in tasks 015–019.

## Goal

Replace the sim's widget stack (lil-gui tree + hand-rolled vanilla-DOM
panels) with a modern component framework, keeping **every feature, control,
shortcut, and workflow identical**. Strategy: incremental strangler
migration behind a `?ui=modern|legacy` toggle — never a big-bang rewrite —
so parity is verified panel-by-panel against the live legacy UI.

## Stack decision (recommended)

**Preact + htm + @preact/signals**, vendored as plain ES modules
(~15 KB total) into `simulation/vendor/` and the import map.

| Constraint | Rationale |
|---|---|
| Playa offline rule | Plain ESM files, no CDN, no bundler, no runtime npm — same vendoring pattern as three.js / js-yaml. |
| CaptainPad consistency | Preact is React-API-compatible → one mental model across sim and iPad app. `htm` gives JSX-like templates without a compiler. |
| Sim state reality | `params`/`configTree` are mutated from everywhere (3D interactions, undo, sACN, auto-save). Signals wrap that via one adapter instead of a state-management rewrite. |

Considered and not recommended: Lit (fine, but diverges from CaptainPad
idioms), Svelte / React+bundler (adds a mandatory build step to a sim that
deliberately has none — only with explicit operator sign-off).

The 2026-06-12 theme system is the foundation: components consume
`var(--token)`; the CaptainPad palette parity test keeps values locked.

## Architecture changes

1. **Control schema extraction (load-bearing).** `gui_builder.js` braids
   together (a) the config-tree walk deciding what controls exist, (b)
   lil-gui widget instantiation, (c) the handler/side-effect registry.
   Split (a)+(c) into a UI-agnostic `control_schema.js`. The schema is the
   enumerable parity contract both UIs render from.
2. **`window.*` compatibility shim.** External code calls
   `window.guiInstance.controllersRecursive()…updateDisplay()`,
   `applyAllHandlers()`, `showSacnInMonitor()`, `toggleViewMasksPanel()`,
   `_setSceneDirty()`, `debounceAutoSave()`, `refreshViewMasksPanel()`, …
   The modern UI must export the same surface so `main.js`,
   `interaction.js`, undo, and engine-health code don't care which UI is
   mounted.
3. **Reusable `FloatingPanel` component.** Drag / resize / collapse / hide /
   z-order / position persistence (scene-config `_patternEditor`-style),
   CaptainPad card styling.
4. **Widget kit matching CaptainPad idioms.** Fader (NauticalFader-style),
   ToggleButton, momentary button, select, color swatch + gradient editor,
   number field, chip, toast service, modal — all token-driven.

## Phases (tracker tasks 015–019)

- **Phase 0 — Groundwork (task 015).** Vendor preact/htm/signals; add
  `?ui=modern|legacy` toggle (default **legacy**); extract control schema
  with a node test asserting it enumerates exactly the controls the legacy
  UI builds (count + names); capture full legacy screenshot baseline.
- **Phase 1 — Shell + simple panels (task 016).** HUD top bar, toasts and
  warning banners (blackout, unpatched, spotlight, dirty chip), both sACN
  monitors, view-presets row. Per panel: build → side-by-side screenshots →
  checklist sign-off.
- **Phase 2 — Pattern editor + Views editor (task 017).** Pattern editor
  keeps a plain `<textarea>` first (CodeMirror 6 is a separate enhancement
  decision, not parity); preset CRUD, autorun, compile status,
  selector-only mode, position persistence. Views editor: cards, chips,
  preview/isolation HUD, modals, dirty-save pulse.
- **Phase 3 — Lighting Controls (task 018, ~60% of total effort).** Render
  the schema with the widget kit: nested sections; fixture / strand /
  iceberg / trace cards; card-selection sync with 3D picking (both
  directions); patch editors; metadata panels; auto-patch toolbar; group
  visibility toggles; save/views buttons; open/close persistence; undo on
  every mutation. Migrate section-by-section (Atmosphere first, DMX
  Fixtures last), legacy one URL param away throughout.
- **Phase 4 — Cutover + polish (task 019).** Default flips to modern; one
  full release cycle with legacy as escape hatch; then delete lil-gui
  vendor + legacy rendering code (schema + handlers stay). Only after
  cutover: UX improvements, proposed individually for operator sign-off
  ("parity first, opinions later").

## Parity verification (per panel, every phase)

1. Schema-count test: modern renders exactly the controls legacy builds.
2. Side-by-side `--show-ui` screenshots, legacy vs modern, same scene state.
3. Puppeteer interaction smoke: mutate control → `params` changed + dirty
   chip + auto-save fired; and reverse (3D edit → UI updates).
4. Keyboard shortcuts unchanged (live in `interaction.js`, untouched).
5. Theme matrix re-run (5 themes × migrated panel); palette parity test
   already guards token values.

## Risks

- Two-way binding with mutable globals is the main bug source — mitigate
  with the signals adapter, done once in the schema layer, not per widget.
- Effort is real: multi-session; Phase 3 alone ≈ everything shipped on this
  branch so far. The toggle keeps the show unblocked throughout.
- Color picker + gradient editor have subtle behavior (live preview during
  drag, debounced save) — explicit test cases required.
- Readonly/iPad observer mode and static-host mode go on every panel's
  checklist — easy to forget.
