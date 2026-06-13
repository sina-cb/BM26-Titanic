/**
 * controller_map_panel.js — Modern (Preact) shell for the Controller
 * Mapping editor.
 *
 * "Modern shell, legacy brain" (see SHELL_NOTES.md): Preact renders the
 * panel chrome and the empty #cm-body container EXACTLY as index.html's
 * static markup, then the untouched legacy module
 * (src/gui/controller_map_editor.js) runs against it —
 * setupControllerMapEditor() attaches every event handler and its
 * internal render() rebuilds #cm-body via direct DOM manipulation.
 *
 * HANDLER-OWNERSHIP DECISION: this shell deliberately does NOT use
 * FloatingPanel and owns NO event handlers. setupControllerMapEditor()
 * already attaches drag (pointerdown/move/up with pointer capture on
 * #cm-drag-handle) and collapse (#cm-collapse-btn.onclick) — the same
 * situation as the Views shell; FloatingPanel would double-attach drag
 * and race the legacy collapse toggle.
 *
 * Fully static component — no signals, no state, rendered exactly once —
 * so Preact never diffs over #cm-body's legacy-built children or the
 * inline left/top set by dragging.
 */

import { render } from 'preact';
import { html } from 'htm/preact';

function ControllerMapPanel() {
  return html`
    <div id="controller-map-panel" class="hidden">
      <div class="vm-header" id="cm-drag-handle">
        <span class="vm-title">🎛 Controller Mapping</span>
        <span class="cm-header-status" id="cm-header-status"></span>
        <button class="pe-btn" id="cm-collapse-btn" title="Collapse">─</button>
      </div>
      <div class="cm-body" id="cm-body"></div>
    </div>
  `;
}

/**
 * Replace the static #controller-map-panel with the Preact-rendered
 * shell. Must run BEFORE setupControllerMapEditor(), so the legacy code
 * finds the ids. Mounted once into a host appended to document.body —
 * same stacking context as the static markup (the panel is
 * position:fixed).
 */
export function initModernControllerMapShell() {
  const legacyEl = document.getElementById('controller-map-panel');
  if (legacyEl) legacyEl.remove();
  const host = document.createElement('div');
  host.id = 'modern-controller-map-host';
  document.body.appendChild(host);
  render(html`<${ControllerMapPanel} />`, host);
}
