/**
 * modern_root.js — Mount points for the modern (Preact) UI surfaces.
 *
 * Only the migrated surfaces are mounted here; everything else stays
 * legacy in BOTH modes until its phase lands (see
 * .agent/02_reports/202606/20260612_2_ui_rehaul_plan.md, tasks 015–019).
 *
 * Migrated so far: sACN IN/OUT monitors, camera view-preset row.
 */

import { render } from 'preact';
import { html } from 'htm/preact';

import { IS_MODERN_UI } from '../ui_mode.js';
import { registerPanel } from '../panel_layout.js';
import {
  SacnInMonitor, SacnOutMonitor, registerSacnGlobals,
  sacnInStore, sacnOutStore,
} from './sacn_monitor_panel.js';
import { ViewPresetsRow } from './view_presets_row.js';

// Register the modern log/visibility globals at module-eval time (this
// module evaluates after sacn_monitor.js in main.js's import graph, so
// the override wins immediately). Doing it here instead of at mount time
// closes the window where an early caller's sacnInLog/sacnOutLog lines
// would land in the static panels that the mount then deletes.
if (IS_MODERN_UI) registerSacnGlobals();

/** Replace the legacy static sACN panels with the modern components.
 *  Removing the static nodes first keeps element ids unique. */
export function initModernSacnMonitors() {
  for (const id of ['sacn-in-monitor-panel', 'sacn-out-monitor-panel']) {
    const legacyEl = document.getElementById(id);
    if (legacyEl) legacyEl.remove();
  }
  const host = document.createElement('div');
  host.id = 'modern-sacn-monitors';
  document.body.appendChild(host);
  render(html`<${SacnInMonitor} /><${SacnOutMonitor} />`, host);

  // Layout registration with store adapters: collapse state is owned by
  // the Preact signal (the class attribute is derived from it), so a
  // restored `collapsed` must flow through the store, not the classList.
  const inEl = document.getElementById('sacn-in-monitor-panel');
  if (inEl) {
    registerPanel(inEl, {
      applyCollapsed: (c) => { sacnInStore.collapsed.value = c; },
    });
  }
  const outEl = document.getElementById('sacn-out-monitor-panel');
  if (outEl) {
    registerPanel(outEl, {
      applyCollapsed: (c) => { sacnOutStore.collapsed.value = c; },
    });
  }
}

/** Render the preset row into the existing #view-presets container. */
export function initModernViewPresets() {
  const container = document.getElementById('view-presets');
  if (!container) return;
  container.innerHTML = '';
  render(html`<${ViewPresetsRow} />`, container);
}
