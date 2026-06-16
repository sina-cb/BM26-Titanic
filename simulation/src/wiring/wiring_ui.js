/**
 * wiring_ui.js — floating "Wiring Layers" control panel for the 3D overlay.
 *
 * Self-contained DOM (built only when ?wiring=1), independent of the main GUI
 * framework. Checkboxes drive the shared visibility logic in wiring_layers.js.
 * Element IDs are stable (`wiring-toggle-*`) so the integration test can click
 * them and assert geometry visibility changes.
 */
import { applyWiringVisibility, buildDefaultLayerState } from './wiring_layers.js';

const FAMILY_LABELS = { power: 'Power', ethernet: 'Ethernet', dmx: 'DMX' };

function row(parent, id, labelText, checked, onChange, indent = false) {
  const label = document.createElement('label');
  label.style.cssText = `display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;`
    + `${indent ? 'margin-left:16px;' : ''}`;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = id;
  cb.checked = checked;
  cb.style.cssText = 'width:14px;height:14px;cursor:pointer;accent-color:#39e0ff;';
  cb.addEventListener('change', () => onChange(cb.checked));
  const span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(cb);
  label.appendChild(span);
  parent.appendChild(label);
  return cb;
}

function heading(parent, text) {
  const h = document.createElement('div');
  h.textContent = text;
  h.style.cssText = 'margin:8px 0 2px;font-size:10px;letter-spacing:1px;color:#7f8aa0;text-transform:uppercase;';
  parent.appendChild(h);
}

/**
 * Build the panel and bind it to the wiring group. Returns the controller
 * { state, apply } (also exposed on window.__wiringLayers for tests).
 */
export function createWiringPanel(model, group) {
  const state = buildDefaultLayerState(model);
  const apply = () => applyWiringVisibility(group, state);

  const panel = document.createElement('div');
  panel.id = 'wiring-layers-panel';
  panel.style.cssText = [
    'position:fixed', 'top:84px', 'left:12px', 'width:208px', 'z-index:99998',
    'background:rgba(16,20,28,0.93)', 'color:#e6e9f0', 'border:1px solid #2a3242',
    'border-radius:8px', 'padding:10px 12px', 'box-shadow:0 6px 22px rgba(0,0,0,0.45)',
    "font-family:Inter,system-ui,sans-serif", 'font-size:12px', 'user-select:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = '🔌 Wiring Layers';
  title.style.cssText = 'font-weight:700;margin-bottom:6px;font-size:13px;';
  panel.appendChild(title);

  // Master
  row(panel, 'wiring-toggle-master', 'All wiring', state.master, (v) => { state.master = v; apply(); });

  heading(panel, 'Show');
  row(panel, 'wiring-toggle-labels', 'Labels', state.labels, (v) => { state.labels = v; apply(); });
  row(panel, 'wiring-toggle-markers', 'Components & anchors', state.markers, (v) => { state.markers = v; apply(); });

  // Families present in the model
  const families = Object.keys(state.families);
  if (families.length) {
    heading(panel, 'Cable families');
    for (const fam of families) {
      row(panel, `wiring-toggle-family-${fam}`, FAMILY_LABELS[fam] || fam, state.families[fam],
        (v) => { state.families[fam] = v; apply(); }, true);
    }
  }

  // Per route
  heading(panel, 'Routes');
  for (const r of model.routes) {
    row(panel, `wiring-toggle-route-${r.id}`, r.name, state.routes[r.id],
      (v) => { state.routes[r.id] = v; apply(); }, true);
  }

  document.body.appendChild(panel);
  apply();
  return { state, apply, panel };
}
