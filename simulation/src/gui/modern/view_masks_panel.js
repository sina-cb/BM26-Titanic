/**
 * view_masks_panel.js — Modern (Preact) shell for the Views editor.
 *
 * "Modern shell, legacy brain": Preact renders the panel chrome and the
 * empty #vm-body container EXACTLY as index.html's static markup, then
 * the untouched legacy module (src/gui/view_masks_editor.js) runs
 * against it — setupViewMasksEditor() attaches every event handler and
 * its internal render() rebuilds #vm-body via direct DOM manipulation.
 *
 * HANDLER-OWNERSHIP DECISION: this shell deliberately does NOT use
 * FloatingPanel and owns NO event handlers. setupViewMasksEditor()
 * already attaches drag (pointerdown/move/up with pointer capture on
 * #vm-drag-handle) and collapse (#vm-collapse-btn.onclick). FloatingPanel
 * would add a second mouse-based drag path and its collapse callback
 * would race the legacy classList.toggle. Rendering the exact legacy
 * tree once and letting legacy drive it is the zero-double-handling
 * option and guarantees functional parity.
 *
 * Fully static component — no signals, no state, rendered exactly once —
 * so Preact never diffs over #vm-body's legacy-built children or the
 * inline left/top set by dragging.
 */

import { render } from 'preact';
import { html } from 'htm/preact';

function ViewMasksPanel() {
  return html`
    <div id="view-masks-panel" class="hidden">
      <div class="vm-header" id="vm-drag-handle">
        <span class="vm-title">👁 Views</span>
        <button class="pe-btn" id="vm-collapse-btn" title="Collapse">─</button>
      </div>
      <div class="vm-body" id="vm-body"></div>
    </div>
  `;
}

/**
 * Replace the static #view-masks-panel with the Preact-rendered shell.
 * Must run BEFORE setupViewMasksEditor(), so the legacy code finds the
 * ids. Mounted once into a host appended to document.body — same
 * stacking context as the static markup (the panel is position:fixed).
 */
export function initModernViewMasksShell() {
  const legacyEl = document.getElementById('view-masks-panel');
  if (legacyEl) legacyEl.remove();
  const host = document.createElement('div');
  host.id = 'modern-view-masks-host';
  document.body.appendChild(host);
  render(html`<${ViewMasksPanel} />`, host);
}
