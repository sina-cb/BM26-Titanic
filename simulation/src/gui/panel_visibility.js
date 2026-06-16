/**
 * panel_visibility.js — Global show/hide for the sim's floating panels.
 *
 * The HUD can get crowded; operators want one key to clear it. `H` steps
 * through three modes:
 *   show_all → hide_noncritical → hide_all → show_all …
 *
 * Panels split into two categories:
 *   - non-critical: editing/browsing chrome (Lighting Controls drawer, the
 *     left source/scene drawers, pattern editor, view masks, controller
 *     map). Hidden from `hide_noncritical` onward.
 *   - critical: live link-health surfaces and alert banners (sACN in/out
 *     monitors, engine-blackout / unpatched / spotlight warnings, the
 *     unsaved-changes chip). Kept visible until `hide_all`.
 *
 * Registered floating panels are hidden CSS-independently (remember each
 * panel's inline `display`, force `display:none`, restore on show) because
 * there is no reliable generic `.hidden` rule for every panel (notably
 * `#gui-panel`). Re-showing routes through `showPanelClamped` so nothing
 * returns off-screen. The alert banners are not registered panels, so they
 * are hidden via a body-class CSS rule that also catches lazily-created
 * ones. State persists per-machine in localStorage.
 */

import { getRegisteredPanels, showPanelClamped } from './panel_layout.js';
import { setDrawerVisible } from './control_drawer.js';
import { setLeftDrawersVisible } from './left_drawer.js';

export const PANEL_VISIBILITY_KEY = 'bm26.sim.panelVisibility';

export const VISIBILITY_MODES = ['show_all', 'hide_noncritical', 'hide_all'];

// Critical registered panels — kept visible in `hide_noncritical`, hidden
// only in `hide_all`. Everything else registered is non-critical chrome.
const CRITICAL_PANEL_IDS = new Set([
  'sacn-in-monitor-panel',
  'sacn-out-monitor-panel',
]);

// Overlays that are not registered floating panels, hidden only in
// `hide_all` (via a body class, so lazily-created ones are covered too) for
// a genuinely clean canvas. Two groups, same timing:
//   - critical alert banners (kept visible through hide_noncritical)
//   - persistent navigation/status chrome (HUD frame, view-preset row, the
//     Shortcuts hint) — kept through hide_noncritical so you can still
//     navigate and read status, gone only at hide_all.
const HIDE_ALL_ONLY_SELECTORS = [
  '#engine-blackout-warning',
  '#unpatched-warning',
  '#spotlight-warning',
  '#spotlight-cap-toast',
  '#dirty-indicator',
  '#hud-frame',
  '#view-presets',
  '#help-hint',
];

const HIDE_ALL_BODY_CLASS = 'sim-panels-hide-all';

const MODE_LABELS = {
  show_all: 'UI: everything visible',
  hide_noncritical: 'UI: editing chrome hidden (monitors + warnings stay)',
  hide_all: 'UI: everything hidden',
};

// id → the inline `display` string the panel had before we hid it. Lets a
// panel that set an explicit inline display (rare) come back to that value
// rather than always ''.
const _rememberedDisplay = new Map();
let _mode = 'show_all';

// ── Pure reducer (unit-tested in tests/panel_visibility.test.js) ─────────

/**
 * Normalize any persisted/legacy value to a valid mode. The pre-cycle
 * store used `{ hidden: boolean }`; map that forward so old state still
 * loads.
 *
 * @param {string|{hidden:boolean}|undefined} value
 * @returns {string} one of VISIBILITY_MODES
 */
export function normalizeMode(value) {
  if (typeof value === 'string' && VISIBILITY_MODES.includes(value)) return value;
  if (value && typeof value === 'object' && value.hidden === true) return 'hide_all';
  return 'show_all';
}

/**
 * Compute the next mode in the cycle. Pure: no DOM, no storage.
 *
 * @param {string} mode
 * @returns {string}
 */
export function nextVisibilityMode(mode) {
  const current = normalizeMode(mode);
  return VISIBILITY_MODES[(VISIBILITY_MODES.indexOf(current) + 1) % VISIBILITY_MODES.length];
}

// ── Persistence ──────────────────────────────────────────────────────────

function readPersistedState() {
  try {
    const raw = localStorage.getItem(PANEL_VISIBILITY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeMode(parsed && (parsed.mode !== undefined ? parsed.mode : parsed));
  } catch (err) {
    console.error('[Visibility] Failed to read panel visibility store:', err);
    return 'show_all';
  }
}

function writePersistedState(mode) {
  try {
    localStorage.setItem(PANEL_VISIBILITY_KEY, JSON.stringify({ mode }));
  } catch (err) {
    console.error('[Visibility] Failed to persist panel visibility:', err);
  }
}

// ── DOM apply ────────────────────────────────────────────────────────────

function hideOnePanel(id, el) {
  if (el.style.display === 'none') return; // already hidden — keep first memory
  _rememberedDisplay.set(id, el.style.display);
  el.style.display = 'none';
}

function showOnePanel(id, el) {
  if (!_rememberedDisplay.has(id)) return; // we never hid it — leave its own state
  el.style.display = _rememberedDisplay.get(id);
  _rememberedDisplay.delete(id);
  // Re-clamp so a panel hidden near an edge (or restored from a different
  // viewport) never reappears off-screen.
  showPanelClamped(el);
}

function panelHiddenInMode(id, mode) {
  if (mode === 'hide_all') return true;
  if (mode === 'hide_noncritical') return !CRITICAL_PANEL_IDS.has(id);
  return false;
}

/**
 * Idempotent setter for the global visibility mode. Applies the mode to
 * every registered panel, the drawers, and the alert banners. Does NOT
 * persist — callers that should persist (cycle) do so explicitly.
 *
 * @param {string} mode  one of VISIBILITY_MODES
 */
export function setVisibilityMode(mode) {
  _mode = normalizeMode(mode);

  for (const { id, el } of getRegisteredPanels()) {
    if (panelHiddenInMode(id, _mode)) hideOnePanel(id, el);
    else showOnePanel(id, el);
  }

  // Lighting Controls drawer + the left source/scene drawer stack are
  // non-critical chrome and not registered panels — clear them from
  // hide_noncritical onward.
  const drawersVisible = _mode === 'show_all';
  setDrawerVisible(drawersVisible);
  setLeftDrawersVisible(drawersVisible);

  // Non-panel overlays (alert banners + nav/status chrome): hidden only in
  // hide_all, via a body class so lazily-created ones are covered too.
  if (document.body) document.body.classList.toggle(HIDE_ALL_BODY_CLASS, _mode === 'hide_all');
}

// ── Public cycle ──────────────────────────────────────────────────────────

/**
 * Advance to the next visibility mode, apply it, persist, and toast.
 */
export function cyclePanelVisibility() {
  const next = nextVisibilityMode(_mode);
  setVisibilityMode(next);
  writePersistedState(next);
  showModeToast(MODE_LABELS[next]);
}

// ── Mode toast ─────────────────────────────────────────────────────────────

function showModeToast(label) {
  let toast = document.getElementById('panel-visibility-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'panel-visibility-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,24,30,0.92);border:1px solid rgba(120,160,220,0.4);color:#cfe0ff;padding:8px 20px;border-radius:8px;font-family:Inter,sans-serif;font-size:13px;pointer-events:none;z-index:10000;opacity:0;transition:opacity 0.25s;';
    document.body.appendChild(toast);
  }
  toast.textContent = `${label} — [H] to cycle`;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ── Boot ─────────────────────────────────────────────────────────────────

// Inject the banner-hiding CSS once. Keeping it in the module (not style.css)
// keeps the selector list co-located with the category definition above.
function injectBannerStyles() {
  if (document.getElementById('panel-visibility-styles')) return;
  const style = document.createElement('style');
  style.id = 'panel-visibility-styles';
  const sel = HIDE_ALL_ONLY_SELECTORS.map((s) => `body.${HIDE_ALL_BODY_CLASS} ${s}`).join(',\n');
  style.textContent = `${sel} { display: none !important; }`;
  document.head.appendChild(style);
}

// Re-apply a hide mode a bounded number of frames after init, so a panel
// that registers asynchronously (e.g. #gui-panel appears after the 3D model
// loads) still gets hidden. Bounded — no infinite polling.
const _REAPPLY_FRAMES = 60; // ~1s at 60fps

function scheduleReapply(framesLeft) {
  if (framesLeft <= 0) return;
  requestAnimationFrame(() => {
    if (_mode === 'show_all') return; // operator already revealed panels — stop
    setVisibilityMode(_mode);
    scheduleReapply(framesLeft - 1);
  });
}

/**
 * Read the persisted mode and apply it once on boot. Safe to call a single
 * time after panels register. If the mode hides anything, late-arriving
 * panels are caught by a short bounded re-apply.
 */
export function initPanelVisibility() {
  injectBannerStyles();
  const mode = readPersistedState();
  setVisibilityMode(mode);
  if (mode !== 'show_all') scheduleReapply(_REAPPLY_FRAMES);
}
