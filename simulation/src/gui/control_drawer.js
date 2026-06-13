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
let _toggleBtn = null;
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
  // The reopen tab is only meaningful when the drawer is tucked away and the
  // operator hasn't stashed the whole HUD with H.
  if (_tab) _tab.style.display = (!_hidden && _collapsed) ? '' : 'none';
  if (_toggleBtn) _toggleBtn.title = _collapsed ? 'Open Lighting Controls' : 'Collapse to edge';
}

function buildTab() {
  const tab = document.createElement('button');
  tab.id = 'control-drawer-tab';
  tab.title = 'Open Lighting Controls (B)';
  const chevron = document.createElement('span');
  chevron.className = 'drawer-tab-chevron';
  chevron.innerHTML = CHEVRON_LEFT;
  const icon = document.createElement('span');
  icon.className = 'drawer-tab-icon';
  icon.textContent = '🔦';
  tab.appendChild(chevron);
  tab.appendChild(icon);
  tab.addEventListener('click', () => setDrawerCollapsed(false));
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

  _toggleBtn = _panel.querySelector('.gui-panel-header .pe-btn');
  if (_toggleBtn) {
    const fresh = _toggleBtn.cloneNode(false); // drop the legacy collapse handler + old glyph
    fresh.classList.add('drawer-collapse-btn');
    fresh.innerHTML = CHEVRON_RIGHT;
    _toggleBtn.replaceWith(fresh);
    _toggleBtn = fresh;
    _toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleControlDrawer(); });
  }

  _tab = buildTab();
  _collapsed = readCollapsed();
  applyState();
}
