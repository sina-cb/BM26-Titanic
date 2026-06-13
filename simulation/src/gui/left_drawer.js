/**
 * left_drawer.js — Left-side drawer stack for the active lighting source.
 *
 * Mirrors the right-edge Lighting Controls drawer (control_drawer.js) on the
 * left, but its contents follow the lighting mode (pattern_editor.js's
 * onLightingChange already shows/hides the source panels — this module only
 * docks them and owns the collapse tabs):
 *
 *   pixelblaze : PRIMARY = Pattern Editor,  CHILD = [Engine Params, sACN OUT]
 *   sacn_in    : PRIMARY = sACN IN monitor, CHILD = [sACN OUT]
 *   gradient   : nothing on the left (panels fall back to floating defaults)
 *
 * Two columns: a PRIMARY drawer flush to the left edge and a CHILD column
 * just to its right holding the nested panels. Each column collapses
 * independently — the primary slides off the left edge (tab on the left
 * edge), the child slides out from under the primary (tab on the seam).
 * Collapse state persists per-machine; the global H toggle hides the whole
 * stack via setLeftDrawersVisible.
 *
 * Docking is positional (inline styles), never re-parenting: the sACN
 * monitors are signal-driven Preact components, so moving their nodes is
 * unsafe — repositioning them is not.
 */

import { lightingMode } from '../core/state.js';

const PRIMARY_COLLAPSE_KEY = 'bm26.sim.leftPrimaryCollapsed';
const CHILD_COLLAPSE_KEY = 'bm26.sim.leftChildCollapsed';

const TOP = 44;          // below the HUD strip (panel_layout TOP_MIN)
const BOTTOM = 24;       // bottom-left is clear (the info panel was removed)
const PRIMARY_LEFT = 0;
const PRIMARY_WIDTH = 358;
const SEAM = 28;                 // room for the primary's collapse handle
const CHILD_LEFT = PRIMARY_WIDTH + SEAM;
const CHILD_WIDTH = 286;
const CHILD_RIGHT = CHILD_LEFT + CHILD_WIDTH;
const STACK_GAP = 8;

const LAYOUT = {
  pixelblaze: { primary: 'pattern-editor-panel', child: ['engine-params-panel', 'sacn-out-monitor-panel'] },
  sacn_in: { primary: 'sacn-in-monitor-panel', child: ['sacn-out-monitor-panel'] },
  gradient: { primary: null, child: [] },
};
const ALL_MANAGED = ['pattern-editor-panel', 'engine-params-panel', 'sacn-in-monitor-panel', 'sacn-out-monitor-panel'];

let _mode = 'gradient';
let _primaryCollapsed = false;
let _childCollapsed = false;
let _hidden = false;
let _primaryTab = null;
let _childTab = null;
const _dragGuarded = new WeakSet();

function readBool(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch (err) {
    console.error('[LeftDrawer] Failed to read', key, err);
    return false;
  }
}
function writeBool(key, val) {
  try {
    localStorage.setItem(key, val ? '1' : '0');
  } catch (err) {
    console.error('[LeftDrawer] Failed to persist', key, err);
  }
}

const byId = (id) => document.getElementById(id);

/** Stop the panel's own header drag from moving a docked drawer. Capture
 *  phase so it pre-empts both the legacy mousedown handlers and Preact's
 *  delegated pointer handler. Buttons/inputs in the header still work. */
function guardDrag(el) {
  if (_dragGuarded.has(el)) return;
  _dragGuarded.add(el);
  const header = el.firstElementChild;
  if (!header) return;
  const swallow = (e) => {
    if (el.dataset.leftDocked !== '1') return; // only while docked
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL' || e.target.closest('button')) return;
    e.stopPropagation();
  };
  header.addEventListener('mousedown', swallow, true);
  header.addEventListener('pointerdown', swallow, true);
}

// Docking is applied entirely through inline styles + a data attribute. The
// sACN monitors are live-updating Preact components that re-render on every
// data frame and reset their className, so a CSS class is unreliable for
// them — but Preact never touches inline styles or data-* it doesn't render.
function dock(el, { left, top, width, height, collapsed, collapseLeft }) {
  el.dataset.leftDocked = '1';
  el.classList.add('left-drawer'); // visual treatment for non-Preact panels
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
  // Slide fully off the left edge when collapsed (panel's own left offset +
  // its width + a margin for the shadow).
  s.transform = collapsed ? `translateX(calc(-100% - ${collapseLeft + 16}px))` : '';
  s.opacity = collapsed ? '0' : '';
  s.pointerEvents = collapsed ? 'none' : '';
}

const DOCK_PROPS = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height',
  'maxWidth', 'maxHeight', 'minWidth', 'minHeight', 'zIndex', 'resize',
  'borderTopLeftRadius', 'borderBottomLeftRadius', 'transform', 'opacity', 'pointerEvents'];

function undock(el) {
  if (el.dataset.leftDocked !== '1') return;
  delete el.dataset.leftDocked;
  el.classList.remove('left-drawer');
  for (const prop of DOCK_PROPS) el.style[prop] = '';
}

function applyLayout() {
  const layout = LAYOUT[_mode] || LAYOUT.gradient;
  const present = new Set([layout.primary, ...layout.child].filter(Boolean));

  // Undock anything not part of this mode's stack (lets sACN OUT fall back to
  // its floating default in gradient mode, etc.).
  for (const id of ALL_MANAGED) {
    const el = byId(id);
    if (el && !present.has(id)) undock(el);
  }

  const vh = window.innerHeight;
  const colHeight = Math.max(160, vh - TOP - BOTTOM);

  // PRIMARY column.
  if (layout.primary) {
    const el = byId(layout.primary);
    if (el) {
      dock(el, {
        left: PRIMARY_LEFT, top: TOP, width: PRIMARY_WIDTH, height: colHeight,
        collapsed: _primaryCollapsed, collapseLeft: PRIMARY_LEFT,
      });
    }
  }

  // CHILD column — stack its panels vertically, splitting the height when
  // there is more than one (Engine Params over sACN OUT in pixelblaze).
  const childIds = layout.child.map(byId).filter(Boolean);
  let y = TOP;
  childIds.forEach((el, i) => {
    const remaining = childIds.length - i;
    // Engine Params (first of two) takes the larger share.
    const share = childIds.length === 2 && i === 0 ? 0.58 : 1 / remaining;
    const avail = (TOP + colHeight) - y - STACK_GAP * (remaining - 1);
    const h = Math.round(avail * share);
    dock(el, {
      left: CHILD_LEFT, top: y, width: CHILD_WIDTH, height: h,
      collapsed: _childCollapsed, collapseLeft: CHILD_LEFT,
    });
    y += h + STACK_GAP;
  });

  // Tabs are always-visible toggles (sidebar-style): when the column is open
  // a collapse handle (‹) sits at its outer edge; when collapsed a reopen
  // handle (›) sits at the screen/seam edge.
  setTab(_primaryTab, !_hidden && !!layout.primary,
    _primaryCollapsed ? 0 : PRIMARY_WIDTH, _primaryCollapsed);
  setTab(_childTab, !_hidden && childIds.length > 0,
    _childCollapsed ? (_primaryCollapsed ? 0 : PRIMARY_WIDTH) : CHILD_RIGHT, _childCollapsed);

  if (_hidden) {
    for (const id of present) {
      const el = byId(id);
      if (el) el.style.display = 'none';
    }
  } else {
    // Restore display for managed panels the mode owns (collapse uses
    // transform/opacity, not display, so a previously H-hidden panel comes
    // back). onLightingChange owns mode-driven show/hide otherwise.
    for (const id of present) {
      const el = byId(id);
      if (el && el.style.display === 'none') el.style.display = '';
    }
  }
}

function buildTab(id, title, onClick) {
  const tab = document.createElement('button');
  tab.id = id;
  tab.className = 'left-drawer-tab';
  tab.title = title;
  const chevron = document.createElement('span');
  chevron.className = 'drawer-tab-chevron';
  chevron.textContent = '‹';
  tab.appendChild(chevron);
  tab.addEventListener('click', onClick);
  tab.style.display = 'none';
  document.body.appendChild(tab);
  return tab;
}

function setTab(tab, show, left, collapsed) {
  if (!tab) return;
  tab.style.display = show ? '' : 'none';
  tab.style.left = `${left}px`;
  const chevron = tab.querySelector('.drawer-tab-chevron');
  if (chevron) chevron.textContent = collapsed ? '›' : '‹';
}

export function isLeftPrimaryCollapsed() { return _primaryCollapsed; }

export function toggleLeftPrimary() {
  _primaryCollapsed = !_primaryCollapsed;
  writeBool(PRIMARY_COLLAPSE_KEY, _primaryCollapsed);
  applyLayout();
}

export function toggleLeftChild() {
  _childCollapsed = !_childCollapsed;
  writeBool(CHILD_COLLAPSE_KEY, _childCollapsed);
  applyLayout();
}

/** Show/hide the whole left stack (panels + tabs) for the H toggle. */
export function setLeftDrawersVisible(visible) {
  _hidden = !visible;
  applyLayout();
}

/** Re-dock after a lighting-mode change (pattern_editor.onLightingChange has
 *  already shown/hidden the source panels by then). */
export function refreshLeftDrawers(mode) {
  if (mode) _mode = mode;
  applyLayout();
}

/**
 * Build the tabs, restore collapse state, and start following lighting-mode
 * changes by wrapping window.onLightingChange. Call once on boot, after the
 * source panels exist.
 */
export function setupLeftDrawers() {
  if (_primaryTab) return;
  _primaryCollapsed = readBool(PRIMARY_COLLAPSE_KEY);
  _childCollapsed = readBool(CHILD_COLLAPSE_KEY);
  _primaryTab = buildTab('left-primary-tab', 'Open source panel', () => toggleLeftPrimary());
  _childTab = buildTab('left-child-tab', 'Open nested panel', () => toggleLeftChild());

  // Follow lighting-mode changes. onLightingChange is monkey-patched (it is a
  // window global called from several places) so every mode switch re-docks.
  const orig = window.onLightingChange;
  window.onLightingChange = function patchedOnLightingChange(...args) {
    if (typeof orig === 'function') orig.apply(this, args);
    _mode = lightingMode || _mode;
    applyLayout();
  };
  _mode = lightingMode || _mode;

  // The Engine Params panel is destroyed and recreated asynchronously on
  // pixelblaze (re)entry; ensureGlobalParamsGui() calls this after it
  // registers the new element so the child column re-docks it.
  window.__refreshLeftDrawers = applyLayout;

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyLayout, 150);
  });

  applyLayout();
}
