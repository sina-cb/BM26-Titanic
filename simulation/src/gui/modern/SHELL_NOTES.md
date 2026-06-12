# Modern shells for Pattern Editor + Views panels

Phase note for the strangler migration ("modern shell, legacy brain").
New files: `pattern_editor_panel.js`, `view_masks_panel.js`. The legacy
modules (`src/gui/pattern_editor.js`, `src/gui/view_masks_editor.js`)
are untouched and keep all behavior.

## What the shells do

Each `init*Shell()` removes the static panel node from `index.html`'s
DOM, then renders an identical tree with Preact into a host div appended
to `document.body` (`#modern-pattern-editor-host`,
`#modern-view-masks-host`). The components are fully static — no
signals, no state, rendered exactly once — so Preact never re-renders or
diffs the subtrees that legacy code mutates (`#pe-preset-buttons`
children, `#pe-code` value, `#pe-status` innerHTML, `#vm-body` children,
inline `left/top/width/height` from drag/resize).

Both panels are `position: fixed` (style.css), so the host wrapper has
no layout or stacking effect — same situation as the migrated sACN
monitors in `modern_root.js`.

## id / class contract preserved (verbatim from index.html)

### Pattern Editor

| Element | id | classes / notes |
|---|---|---|
| panel root | `pattern-editor-panel` | class `hidden` initially; `collapsed` / `pe-selector-only` toggled by legacy |
| header | `pe-drag-handle` | class `pe-header` |
| title | — | `pe-title`, text `🎆 Pattern Editor` |
| auto-run label | — | inline style incl. `color:var(--secondary)`; contains the checkbox (small-screen code finds it via `header.querySelector('label')`) |
| auto-run checkbox | `pe-autorun` | inline `margin:0;accent-color:var(--primary);` (read by main.js restore) |
| save button | `pe-save-btn` | `pe-btn pe-save` |
| compile button | `pe-compile-btn` | `pe-btn pe-run` |
| collapse button | `pe-collapse-btn` | `pe-btn` |
| presets wrap | `pe-presets` | `pe-presets` (legacy delegates clicks here) |
| preset buttons container | `pe-preset-buttons` | `pe-preset-buttons`, rendered EMPTY — filled by `renderPresetButtons()` |
| add / delete | `pe-add-pattern` / `pe-del-pattern` | `pe-toolbar-btn` (+ `pe-danger`), inside `.pe-preset-toolbar` |
| code wrap | — | `pe-code-wrap` (hidden by small-screen branch) |
| textarea | `pe-code` | `pe-textarea`, spellcheck/autocomplete/autocorrect/autocapitalize off |
| status bar | `pe-status` | `pe-status ok`, initial `✓ Ready` with `.pe-status-icon` span |
| docs | — | `pe-docs` / `pe-docs-title` (hidden by small-screen branch) |

### Views

| Element | id | classes / notes |
|---|---|---|
| panel root | `view-masks-panel` | class `hidden` initially |
| header | `vm-drag-handle` | class `vm-header` |
| title | — | `vm-title`, text `👁 Views` |
| collapse button | `vm-collapse-btn` | `pe-btn` |
| body | `vm-body` | `vm-body`, rendered EMPTY — rebuilt by legacy `render()` |

## Handler ownership: legacy owns EVERYTHING

The shells attach **zero** event handlers and do **not** use
`FloatingPanel`. Reason: `setupPatternEditor()` attaches drag
(mousedown on `#pe-drag-handle`), collapse (`#pe-collapse-btn` click +
header dblclick, with height save/restore that FloatingPanel doesn't
have), and all button/textarea/preset listeners;
`setupViewMasksEditor()` attaches pointer-capture drag on
`#vm-drag-handle` and `#vm-collapse-btn.onclick`. Using FloatingPanel
would double-attach drag and turn collapse into a self-cancelling
double toggle. Rendering the exact legacy tree once is the only
zero-double-handling option.

| Behavior | Owner |
|---|---|
| Initial mount / DOM structure | shell (Preact, once) |
| Drag, collapse, dblclick-collapse | legacy setup functions |
| Compile/save/add/delete/presets/auto-run/keys | legacy `setupPatternEditor()` |
| `#vm-body` content, modals, isolation HUD | legacy `setupViewMasksEditor()` |
| Show/hide (`window.showPatternEditor`, `window.toggleViewMasksPanel`, `window.refreshViewMasksPanel`) | legacy |
| Position/size/collapsed/autoRun restore from `_patternEditor` | main.js (direct DOM, lines ~486-499) — works unchanged: same ids, panel still styleable, checkbox present |

## main.js wiring (integrator)

Inside the modern-UI branch, mount shells BEFORE the legacy setups:

```js
import { initModernPatternEditorShell } from './src/gui/modern/pattern_editor_panel.js';
import { initModernViewMasksShell } from './src/gui/modern/view_masks_panel.js';

if (IS_MODERN_UI) {
  initModernPatternEditorShell();
  initModernViewMasksShell();
}
setupPatternEditor();      // unchanged
setupViewMasksEditor();    // unchanged
```

Required order: `init*Shell()` → `setup*()` → main.js `_patternEditor`
restore block. All three currently sit in the same `!_isReadonly` block
(~line 466), and the restore block runs after — so mounting at the top
of that block satisfies the ordering.

Caveats for the integrator:

- **Readonly mode** (`?readonly=1`): legacy setups are skipped there.
  Either also skip the shell mounts (simplest, matches today: static
  panel exists but stays hidden) or mount them anyway — the readonly CSS
  `display:none !important` on `#pattern-editor-panel` still applies
  since the id is identical. `#view-masks-panel` is not in that CSS
  list today; identical either way.
- Do NOT remove the static markup from index.html in this phase — the
  shells remove it at runtime in modern mode, and legacy mode still
  needs it.
- `agent_render.cjs` UI_PANEL_IDS and edit-mode hide selectors keep
  working (ids unchanged).
