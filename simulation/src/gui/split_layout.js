/**
 * split_layout.js — Vertical screen split: docked Controller-Mapping pane
 * (LEFT) + 3D sim pane (right), with a draggable divider and
 * maximize-either-side controls.
 *
 * Replaces the floating Controller-Mapping panel with a real screen split.
 * When the mapping panel is open the layout ENGAGES: #controller-map-panel
 * docks flush to the LEFT edge (filling the map pane) and the render canvas
 * shrinks + shifts RIGHT to the sim pane (size via window.__getSimViewport,
 * read by view_presets.onResize; x-offset set here on the canvas). When the
 * panel closes the split disengages and the canvas returns to the full window.
 *
 * Drawer policy (operator ruling 2026-07-24): the map pane owns the LEFT edge,
 * so the left-edge Pattern Editor drawer YIELDS for the session and returns
 * when the map closes. The right-edge Lighting Controls drawer is LEFT ALONE —
 * the operator drives its fixture / DMX-group lists to find lights on a busy
 * unlabeled scene while mapping, so both are usable at once.
 *
 * The split ratio persists per VIEWPORT CLASS (laptop vs wide/27") so a
 * layout dialed in on the show laptop doesn't fight the one on a big monitor.
 *
 * Docking mirrors left_drawer.js: positional inline styles + a data marker +
 * a capture-phase drag guard, never re-parenting the panel. The legacy
 * controller_map_editor keeps every one of its handlers.
 */

import { renderer } from '../core/state.js';
import { setLeftDrawersVisible } from './left_drawer.js';

// ─── Geometry constants ──────────────────────────────────────────────────
const DIVIDER_W = 8;     // draggable seam width (px)
const TOP = 44;          // below the HUD strip (panel_layout TOP_MIN)
const BOTTOM = 8;        // small gap at the bottom edge
const MIN_MAP = 320;     // map pane never narrower than this
const MIN_SIM = 380;     // sim pane never narrower than this
const MAX_MAP_FRAC = 0.6; // map pane never wider than 60% in split mode
const WIDE_MIN = 1920;   // >= this viewport width counts as "wide" (27"+)

// Default map fraction per viewport class: laptop ~62/38, wide ~70/30.
const DEFAULT_RATIO = { laptop: 0.38, wide: 0.30 };

const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

// ─── State ───────────────────────────────────────────────────────────────
let _engaged = false;
let _mode = 'split';        // 'split' | 'simMax' | 'mapMax'
let _ratio = DEFAULT_RATIO.laptop;
let _panel = null;
let _divider = null;
let _tab = null;
let _dragGuarded = false;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const byId = (id) => document.getElementById(id);

function viewportClass() {
  return window.innerWidth >= WIDE_MIN ? 'wide' : 'laptop';
}
function ratioKey() {
  return `bm26.sim.splitRatio.${viewportClass()}`;
}
function readRatio() {
  const cls = viewportClass();
  try {
    const v = parseFloat(localStorage.getItem(ratioKey()));
    if (Number.isFinite(v)) return clamp(v, 0.2, MAX_MAP_FRAC);
  } catch (err) {
    console.error('[Split] read ratio', err);
  }
  return DEFAULT_RATIO[cls];
}
function writeRatio() {
  try {
    localStorage.setItem(ratioKey(), String(_ratio));
  } catch (err) {
    console.error('[Split] persist ratio', err);
  }
}

// ─── Width solver ────────────────────────────────────────────────────────
function computeWidths() {
  const W = window.innerWidth;
  let mapW = Math.round(W * _ratio);
  mapW = clamp(mapW, MIN_MAP, Math.round(W * MAX_MAP_FRAC));
  // Guarantee the sim pane its minimum, even if that means overriding the
  // ratio on a very narrow window.
  if (W - mapW - DIVIDER_W < MIN_SIM) {
    mapW = Math.max(MIN_MAP, W - MIN_SIM - DIVIDER_W);
  }
  const simW = Math.max(1, W - mapW - DIVIDER_W);
  return { W, mapW, simW };
}

/** The size the render canvas should occupy. Read by view_presets.onResize. */
export function getSimViewport() {
  const height = window.innerHeight;
  if (!_engaged || _mode === 'simMax') {
    return { width: window.innerWidth, height };
  }
  if (_mode === 'mapMax') {
    // Canvas is hidden; keep the renderer at a valid (tiny) size.
    return { width: 1, height: 1 };
  }
  return { width: computeWidths().simW, height };
}

function applySimResize() {
  if (typeof window.__applySimResize === 'function') window.__applySimResize();
}

// ─── Canvas placement ─────────────────────────────────────────────────────
// With the map pane on the LEFT the render canvas must SHIFT right to the sim
// pane (the raycaster reads getBoundingClientRect(), so a correct x-offset is
// what keeps picks accurate — pick_accuracy_test guards exactly this). Passing
// leftPx=null returns the canvas to its default full-window flow position.
function placeCanvas(leftPx, visible) {
  const canvas = renderer && renderer.domElement;
  if (!canvas) return;
  canvas.style.display = visible ? '' : 'none';
  if (leftPx === null) {
    canvas.style.position = '';
    canvas.style.left = '';
    canvas.style.top = '';
  } else {
    canvas.style.position = 'fixed';
    canvas.style.top = '0px';
    canvas.style.left = `${leftPx}px`;
  }
}

// ─── Drag guard (stop the panel header from dragging while docked) ────────
function guardDrag() {
  if (_dragGuarded || !_panel) return;
  _dragGuarded = true;
  const header = _panel.querySelector('#cm-drag-handle') || _panel.firstElementChild;
  if (!header) return;
  const swallow = (e) => {
    if (_panel.dataset.splitDocked !== '1') return;
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL' || tag === 'TEXTAREA'
        || e.target.closest('button')) return;
    e.stopPropagation();
  };
  header.addEventListener('mousedown', swallow, true);
  header.addEventListener('pointerdown', swallow, true);
}

// ─── Panel docking ───────────────────────────────────────────────────────
function dockPanel(left, width) {
  _panel.classList.add('cm-split-docked');
  _panel.dataset.splitDocked = '1';
  guardDrag();
  const s = _panel.style;
  s.position = 'fixed';
  s.top = `${TOP}px`;
  s.bottom = `${BOTTOM}px`;
  s.height = 'auto';
  s.left = `${left}px`;
  s.right = 'auto';
  s.width = `${width}px`;
  s.maxWidth = 'none';
  s.maxHeight = 'none';
  s.minWidth = '0';
  s.minHeight = '0';
  s.zIndex = '100';
  s.resize = 'none';
  s.transform = '';
  s.opacity = '';
  s.pointerEvents = '';
}

function slidePanelOff() {
  // Map pane lives on the LEFT — slide it off the LEFT edge.
  const { mapW } = computeWidths();
  dockPanel(0, mapW);
  const s = _panel.style;
  s.transform = `translateX(calc(-100% - ${TOP}px))`;
  s.opacity = '0';
  s.pointerEvents = 'none';
}

// ─── Divider ─────────────────────────────────────────────────────────────
function buildDivider() {
  const d = document.createElement('div');
  d.id = 'sim-split-divider';
  d.title = 'Drag to resize · double-click to reset';
  let startX = 0;
  let startRatio = 0;
  let dragging = false;
  d.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startRatio = _ratio;
    d.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });
  d.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const W = window.innerWidth;
    // Map pane is on the LEFT: the divider is its RIGHT edge, so dragging RIGHT
    // grows the map pane and dragging LEFT shrinks it.
    const dx = e.clientX - startX;
    _ratio = clamp(startRatio + dx / W, 0.2, MAX_MAP_FRAC);
    applyLayout();
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { d.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
    writeRatio();
  };
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);
  d.addEventListener('dblclick', () => {
    _ratio = DEFAULT_RATIO[viewportClass()];
    applyLayout();
    writeRatio();
  });
  document.body.appendChild(d);
  return d;
}

// ─── Restore tab (shown when the sim is maximized) ───────────────────────
function buildTab() {
  const t = document.createElement('button');
  t.id = 'sim-split-restore-tab';
  t.title = 'Restore mapping pane';
  // Tab sits on the LEFT edge now; the chevron points right to pull the pane out.
  t.innerHTML = CHEVRON_RIGHT;
  t.style.display = 'none';
  t.addEventListener('click', () => setMode('split'));
  document.body.appendChild(t);
  return t;
}

// ─── Maximize controls injected into the panel header ────────────────────
function buildHeaderControls() {
  const header = _panel.querySelector('#cm-drag-handle');
  const collapseBtn = _panel.querySelector('#cm-collapse-btn');
  if (!header || header.querySelector('#cm-max-sim')) return;

  const simBtn = document.createElement('button');
  simBtn.id = 'cm-max-sim';
  simBtn.className = 'pe-btn cm-split-btn';
  simBtn.title = 'Maximize 3D view';
  simBtn.innerHTML = CHEVRON_RIGHT;
  simBtn.addEventListener('click', () => setMode(_mode === 'simMax' ? 'split' : 'simMax'));

  const mapBtn = document.createElement('button');
  mapBtn.id = 'cm-max-map';
  mapBtn.className = 'pe-btn cm-split-btn';
  mapBtn.title = 'Maximize mapping pane';
  mapBtn.innerHTML = CHEVRON_LEFT;
  mapBtn.addEventListener('click', () => setMode(_mode === 'mapMax' ? 'split' : 'mapMax'));

  if (collapseBtn) {
    header.insertBefore(simBtn, collapseBtn);
    header.insertBefore(mapBtn, collapseBtn);
  } else {
    header.appendChild(simBtn);
    header.appendChild(mapBtn);
  }
}

function syncHeaderButtons() {
  const simBtn = byId('cm-max-sim');
  const mapBtn = byId('cm-max-map');
  if (simBtn) simBtn.classList.toggle('cm-split-active', _mode === 'simMax');
  if (mapBtn) mapBtn.classList.toggle('cm-split-active', _mode === 'mapMax');
}

// ─── Layout application ──────────────────────────────────────────────────
export function applyLayout() {
  if (!_panel) return;

  // Drawer policy: the LEFT-edge Pattern Editor yields for the session (managed
  // on the engage/disengage transition in setEngaged, not here, so a divider
  // drag doesn't re-show a drawer the operator hid). The RIGHT-edge Lighting
  // Controls drawer is never touched — it stays usable alongside the map pane.

  if (!_engaged) {
    placeCanvas(null, true);
    if (_divider) _divider.style.display = 'none';
    if (_tab) _tab.style.display = 'none';
    applySimResize();
    return;
  }

  buildHeaderControls();

  if (_mode === 'mapMax') {
    placeCanvas(null, false);
    dockPanel(0, window.innerWidth);
    if (_divider) _divider.style.display = 'none';
    if (_tab) _tab.style.display = 'none';
  } else if (_mode === 'simMax') {
    // Sim fills the window; the map pane slides off the LEFT, restore tab shows
    // at the left edge.
    slidePanelOff();
    placeCanvas(null, true);
    if (_divider) _divider.style.display = 'none';
    if (_tab) _tab.style.display = '';
    applySimResize();
  } else {
    // split: map pane LEFT (0..mapW), divider at mapW, sim canvas shifted right.
    const { mapW } = computeWidths();
    dockPanel(0, mapW);
    placeCanvas(mapW + DIVIDER_W, true);
    if (_divider) {
      _divider.style.display = '';
      _divider.style.left = `${mapW}px`;
      _divider.style.top = `${TOP}px`;
      _divider.style.bottom = `${BOTTOM}px`;
    }
    if (_tab) _tab.style.display = 'none';
    applySimResize();
  }
  syncHeaderButtons();
}

// ─── Mode / engagement ───────────────────────────────────────────────────
export function setMode(mode) {
  _mode = mode;
  applyLayout();
}

function setEngaged(on) {
  if (on === _engaged) return;
  _engaged = on;
  if (on) {
    _mode = 'split';               // always reopen in the balanced split
    _ratio = readRatio();          // pick up this viewport class's saved ratio
    setLeftDrawersVisible(false);  // yield the Pattern Editor for the session
  } else {
    setLeftDrawersVisible(true);   // restore the Pattern Editor when the map closes
  }
  applyLayout();
}

// ─── Setup ───────────────────────────────────────────────────────────────
export function setupSplitLayout() {
  _panel = byId('controller-map-panel');
  if (!_panel) {
    console.error('[Split] #controller-map-panel not found — split layout disabled.');
    return;
  }
  _ratio = readRatio();
  _divider = buildDivider();
  _tab = buildTab();

  // Expose the sim-pane size to the resize path and test/automation hooks.
  window.__getSimViewport = getSimViewport;
  window.__splitLayout = {
    setMode,
    setRatio(r) { _ratio = clamp(r, 0.2, MAX_MAP_FRAC); applyLayout(); writeRatio(); },
    getSimViewport,
    applyLayout,
    isEngaged: () => _engaged,
    getState: () => ({ engaged: _engaged, mode: _mode, ratio: _ratio, ...computeWidths() }),
  };

  // Engagement tracks the panel's real visibility (toggle button, H hotkey,
  // any path that flips `.hidden`) rather than only wrapping one entry point.
  setEngaged(!_panel.classList.contains('hidden'));
  new MutationObserver(() => setEngaged(!_panel.classList.contains('hidden')))
    .observe(_panel, { attributes: true, attributeFilter: ['class'] });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      _ratio = readRatio();  // viewport class may have flipped
      applyLayout();
    }, 150);
  });
}
