/**
 * left_drawer.js — Left-edge drawer for the Pattern Editor.
 *
 * Mirrors the right-edge Lighting Controls drawer (control_drawer.js): in
 * pixelblaze mode the Pattern Editor docks flush to the left edge, slides off
 * when collapsed, and leaves a sidebar-style toggle handle at the edge. The
 * Engine Parameters panel is embedded INSIDE the Pattern Editor (saving the
 * separate floating panel's real estate); the sACN monitors are positioned
 * bottom-left by their own placement logic, not here.
 *
 * Content follows the lighting mode (pattern_editor.js's onLightingChange
 * already shows/hides the Pattern Editor — this module only docks it):
 *   pixelblaze : Pattern Editor (with Engine Params embedded)
 *   otherwise  : nothing on the left
 *
 * Docking is positional (inline styles + a data-left-docked marker), never
 * re-parenting the Pattern Editor itself — only the lil-gui Engine Params
 * panel (legacy DOM, safe to move) is embedded into it.
 */

import { lightingMode } from '../core/state.js';

const COLLAPSE_KEY = 'bm26.sim.leftPrimaryCollapsed';

const TOP = 44;          // below the HUD strip (panel_layout TOP_MIN)
const BOTTOM = 64;       // leave the lower-left corner for the sACN monitors
const LEFT = 0;
const WIDTH = 384;

const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

let _mode = 'gradient';
let _collapsed = false;
let _hidden = false;
let _tab = null;
const _dragGuarded = new WeakSet();

function readBool(key) {
  try { return localStorage.getItem(key) === '1'; } catch (err) {
    console.error('[LeftDrawer] read', key, err); return false;
  }
}
function writeBool(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch (err) {
    console.error('[LeftDrawer] persist', key, err);
  }
}
const byId = (id) => document.getElementById(id);

/** Stop the panel's own header drag from moving the docked drawer. Capture
 *  phase so it pre-empts the legacy mousedown handlers. */
function guardDrag(el) {
  if (_dragGuarded.has(el)) return;
  _dragGuarded.add(el);
  const header = el.firstElementChild;
  if (!header) return;
  const swallow = (e) => {
    if (el.dataset.leftDocked !== '1') return;
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL' || tag === 'TEXTAREA' || e.target.closest('button')) return;
    e.stopPropagation();
  };
  header.addEventListener('mousedown', swallow, true);
  header.addEventListener('pointerdown', swallow, true);
}

const DOCK_PROPS = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height',
  'maxWidth', 'maxHeight', 'minWidth', 'minHeight', 'zIndex', 'resize',
  'borderTopLeftRadius', 'borderBottomLeftRadius', 'transform', 'opacity', 'pointerEvents'];

function dock(el, { left, top, width, height, collapsed }) {
  el.dataset.leftDocked = '1';
  el.classList.add('left-drawer');
  guardDrag(el);
  const s = el.style;
  s.position = 'fixed';
  s.left = `${left}px`;
  s.top = `${top}px`;
  s.right = 'auto';
  s.bottom = 'auto';
  s.width = `${width}px`;
  s.height = `${height}px`;
  s.maxWidth = 'none';
  s.maxHeight = 'none';
  s.minWidth = '0';
  s.minHeight = '0';
  s.zIndex = '100';
  s.resize = 'none';
  s.borderTopLeftRadius = '0';
  s.borderBottomLeftRadius = '0';
  s.transform = collapsed ? `translateX(calc(-100% - ${left + 16}px))` : '';
  s.opacity = collapsed ? '0' : '';
  s.pointerEvents = collapsed ? 'none' : '';
}

function undock(el) {
  if (el.dataset.leftDocked !== '1') return;
  delete el.dataset.leftDocked;
  el.classList.remove('left-drawer');
  for (const prop of DOCK_PROPS) el.style[prop] = '';
}

/** Move the Engine Params lil-gui inside the Pattern Editor (above its Quick
 *  Reference) and let it flow there. Safe to call repeatedly — it is a no-op
 *  once embedded, and re-embeds the freshly recreated panel on mode re-entry. */
function embedEngineParams(pe) {
  const ep = byId('engine-params-panel');
  if (!ep || !pe) return;
  if (ep.parentElement !== pe) {
    const docs = pe.querySelector('.pe-docs');
    if (docs) pe.insertBefore(ep, docs);
    else pe.appendChild(ep);
  }
  ep.classList.add('embedded-in-editor');
  ep.dataset.leftDocked = '1'; // engine-params follow-placement yields to this
  for (const prop of ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'transform']) {
    ep.style[prop] = '';
  }
}

function setTab(show, left, collapsed) {
  if (!_tab) return;
  _tab.style.display = show ? '' : 'none';
  _tab.style.left = `${left}px`;
  const chevron = _tab.querySelector('.drawer-tab-chevron');
  if (chevron) chevron.innerHTML = collapsed ? CHEVRON_RIGHT : CHEVRON_LEFT;
}

function applyLayout() {
  const isPB = _mode === 'pixelblaze';
  const pe = byId('pattern-editor-panel');
  const vh = window.innerHeight;

  if (isPB && pe) {
    dock(pe, { left: LEFT, top: TOP, width: WIDTH, height: Math.max(200, vh - TOP - BOTTOM), collapsed: _collapsed });
    embedEngineParams(pe);
    pe.style.display = _hidden ? 'none' : '';
  } else if (pe) {
    undock(pe);
  }

  setTab(isPB && !_hidden, _collapsed ? 0 : WIDTH, _collapsed);
}

function buildTab() {
  const tab = document.createElement('button');
  tab.id = 'left-primary-tab';
  tab.className = 'left-drawer-tab';
  tab.title = 'Collapse / open the Pattern Editor';
  const chevron = document.createElement('span');
  chevron.className = 'drawer-tab-chevron';
  chevron.innerHTML = CHEVRON_LEFT;
  tab.appendChild(chevron);
  tab.addEventListener('click', toggleLeftPrimary);
  tab.style.display = 'none';
  document.body.appendChild(tab);
  return tab;
}

export function toggleLeftPrimary() {
  _collapsed = !_collapsed;
  writeBool(COLLAPSE_KEY, _collapsed);
  applyLayout();
}

/** Show/hide the left drawer for the global H toggle. */
export function setLeftDrawersVisible(visible) {
  _hidden = !visible;
  applyLayout();
}

/** Re-dock after a lighting-mode change / Engine Params (re)creation. */
export function refreshLeftDrawers(mode) {
  if (mode) _mode = mode;
  applyLayout();
}

export function setupLeftDrawers() {
  if (_tab) return;
  _collapsed = readBool(COLLAPSE_KEY);
  _tab = buildTab();
  _mode = lightingMode || _mode;

  const orig = window.onLightingChange;
  window.onLightingChange = function patchedOnLightingChange(...args) {
    if (typeof orig === 'function') orig.apply(this, args);
    _mode = lightingMode || _mode;
    applyLayout();
  };
  // Engine Params is destroyed/recreated on pixelblaze (re)entry;
  // ensureGlobalParamsGui() calls this after registering the new element.
  window.__refreshLeftDrawers = applyLayout;

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyLayout, 150);
  });

  applyLayout();
}
