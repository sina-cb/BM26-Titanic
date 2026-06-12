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

import {
  SacnInMonitor, SacnOutMonitor, registerSacnGlobals,
} from './sacn_monitor_panel.js';
import { ViewPresetsRow } from './view_presets_row.js';

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
  registerSacnGlobals();
}

/** Render the preset row into the existing #view-presets container. */
export function initModernViewPresets() {
  const container = document.getElementById('view-presets');
  if (!container) return;
  container.innerHTML = '';
  render(html`<${ViewPresetsRow} />`, container);
}
