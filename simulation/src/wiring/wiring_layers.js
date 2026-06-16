/**
 * wiring_layers.js — show/hide logic for the 3D wiring layer.
 *
 * The wiring group's children are tagged (wiring_render.js) with
 * `userData.wiring = { kind, family?, route?, sub? }`. This module turns a
 * toggle-state object into per-object `.visible` flags, so the UI panel
 * (wiring_ui.js) and tests can drive the same source of truth.
 */

export function buildDefaultLayerState(model) {
  const families = {};
  for (const ct of model.cableTypes.values()) families[ct.family] = true;
  const routes = {};
  for (const r of model.routes) routes[r.id] = true;
  return { master: true, labels: true, markers: true, families, routes };
}

export function applyWiringVisibility(group, state) {
  for (const child of group.children) {
    const w = child.userData && child.userData.wiring;
    if (!w) continue;
    let vis = state.master;
    if (w.kind === 'cable' || w.kind === 'halo') {
      vis = vis && !!state.families[w.family] && !!state.routes[w.route];
    } else if (w.kind === 'marker') {
      vis = vis && state.markers;
    } else if (w.kind === 'label') {
      if (w.sub === 'route') vis = vis && state.labels && !!state.routes[w.route];
      else vis = vis && state.labels && state.markers;
    }
    child.visible = vis;
  }
}

/** Visible-object counts by kind — used by the integration test for assertions. */
export function wiringVisibleSummary(group) {
  const s = { cable: 0, halo: 0, marker: 0, label: 0 };
  for (const child of group.children) {
    const w = child.userData && child.userData.wiring;
    if (w && child.visible) s[w.kind] = (s[w.kind] || 0) + 1;
  }
  return s;
}
