/**
 * control_drawer.js — Turns the Lighting Controls panel (#gui-panel) into a
 * right-docked drawer instead of a free-floating window.
 *
 * Behaviour (modelled on an editor side-bar, e.g. Cursor): the panel is
 * pinned to the right edge, slides off-screen when collapsed, and leaves a
 * thin reopen tab at the edge to bring it back. The header button and the
 * `B` hotkey both toggle it; the global `H` "hide all panels" toggle hides
 * the whole drawer (panel + tab) via setDrawerVisible.
 *
 * Collapsed/expanded state persists per-machine in localStorage (same scope
 * as the panel-geometry and theme choices). Visibility (the H toggle) is NOT
 * persisted here — panel_visibility.js owns that.
 */

const COLLAPSE_KEY = 'bm26.sim.controlDrawerCollapsed';

// Inline chevron icons (stroke = currentColor) for a crisper, more deliberate
// look than the raw » / ‹ glyphs.
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';
const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';

let _panel = null;
let _tab = null;
let _collapsed = false;
let _hidden = false;

function readCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    // No stored preference: default collapsed on narrow screens so the
    // drawer doesn't eat a laptop's whole right edge on first load.
    return window.innerWidth < 800;
  } catch (err) {
    console.error('[Drawer] Failed to read collapsed state:', err);
    return false;
  }
}

function persistCollapsed() {
  try {
    localStorage.setItem(COLLAPSE_KEY, _collapsed ? '1' : '0');
  } catch (err) {
    console.error('[Drawer] Failed to persist collapsed state:', err);
  }
}

function applyState() {
  if (!_panel) return;
  _panel.classList.toggle('drawer-collapsed', _collapsed);
  _panel.style.display = _hidden ? 'none' : '';
  // Always-visible edge-tab toggle (mirrors the Pattern Editor's left tab):
  // open → a collapse handle (›) at the drawer's inner edge; collapsed → a
  // reopen handle (‹) at the right screen edge.
  if (_tab) {
    _tab.style.display = _hidden ? 'none' : '';
    const w = _panel.getBoundingClientRect().width || 330;
    _tab.style.right = _collapsed ? '0px' : `${Math.round(w)}px`;
    const chev = _tab.querySelector('.drawer-tab-chevron');
    if (chev) chev.innerHTML = _collapsed ? CHEVRON_LEFT : CHEVRON_RIGHT;
    _tab.title = _collapsed ? 'Open Lighting Controls (B)' : 'Collapse Lighting Controls (B)';
  }
}

function buildTab() {
  const tab = document.createElement('button');
  tab.id = 'control-drawer-tab';
  tab.className = 'left-drawer-tab';  // share the Pattern Editor tab styling
  tab.title = 'Collapse Lighting Controls (B)';
  const chevron = document.createElement('span');
  chevron.className = 'drawer-tab-chevron';
  chevron.innerHTML = CHEVRON_RIGHT;
  tab.appendChild(chevron);
  tab.addEventListener('click', toggleControlDrawer);
  document.body.appendChild(tab);
  return tab;
}

export function isDrawerCollapsed() {
  return _collapsed;
}

export function setDrawerCollapsed(collapsed) {
  if (_collapsed === collapsed) return;
  _collapsed = collapsed;
  persistCollapsed();
  applyState();
}

export function toggleControlDrawer() {
  setDrawerCollapsed(!_collapsed);
}

/** Show/hide the entire drawer system (panel + tab) without touching the
 *  collapsed preference. Called by panel_visibility.js for the H toggle. */
export function setDrawerVisible(visible) {
  _hidden = !visible;
  applyState();
}

/**
 * Convert an already-created #gui-panel element into the docked drawer.
 * Re-purposes the panel's existing header button as the collapse toggle and
 * adds the edge reopen tab. Call once, right after the panel is built.
 *
 * @param {HTMLElement} panelEl  The #gui-panel element.
 */
export function setupControlDrawer(panelEl) {
  if (!panelEl) throw new Error('setupControlDrawer: panel element is required');
  _panel = panelEl;
  _panel.classList.add('control-drawer');

  // The drawer collapses via the always-visible edge tab (consistent with the
  // Pattern Editor), so the legacy header collapse button is removed.
  const headerBtn = _panel.querySelector('.gui-panel-header .pe-btn');
  if (headerBtn) headerBtn.remove();

  _tab = buildTab();
  _collapsed = readCollapsed();
  applyState();
}
