/**
 * panel_visibility.js — Global show/hide for the sim's floating panels.
 *
 * The HUD can get crowded; operators want a single key to stash every
 * floating panel (Lighting Controls, view masks, controller map, …) out of
 * the way and bring them all back on-screen. This module owns that toggle
 * and its persistence.
 *
 * Hiding is CSS-independent on purpose: there is no reliable generic
 * `.hidden` rule for every panel (notably `#gui-panel`), so we hide by
 * remembering each panel's inline `display` and forcing `display:none`,
 * then restore the remembered value on show. Re-showing routes through
 * `showPanelClamped` from panel_layout.js so nothing returns off-screen.
 *
 * State is persisted per-machine in localStorage (same scope as the layout
 * geometry), so a hidden HUD survives a reload.
 */

import { getRegisteredPanels, showPanelClamped } from './panel_layout.js';
import { setDrawerVisible } from './control_drawer.js';
import { setLeftDrawersVisible } from './left_drawer.js';

export const PANEL_VISIBILITY_KEY = 'bm26.sim.panelVisibility';

// id → the inline `display` string the panel had before we hid it. Lets a
// panel that set an explicit inline display (rare) come back to that value
// rather than always ''. Designed to extend to per-panel visibility later.
const _rememberedDisplay = new Map();
let _allHidden = false;

// ── Pure reducer (unit-tested in tests/panel_visibility.test.js) ─────────

/**
 * Compute the next global visibility state from the current one. Pure:
 * no DOM, no storage — flips the `hidden` flag.
 *
 * @param {{ hidden: boolean }} current
 * @returns {{ hidden: boolean }}
 */
export function nextVisibilityState(current) {
  return { hidden: !(current && current.hidden) };
}

// ── Persistence ──────────────────────────────────────────────────────────

function readPersistedState() {
  try {
    const raw = localStorage.getItem(PANEL_VISIBILITY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      return { hidden: parsed.hidden === true };
    }
    return { hidden: false };
  } catch (err) {
    console.error('[Visibility] Failed to read panel visibility store:', err);
    return { hidden: false };
  }
}

function writePersistedState(state) {
  try {
    localStorage.setItem(PANEL_VISIBILITY_KEY, JSON.stringify({ hidden: state.hidden }));
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
  const remembered = _rememberedDisplay.has(id) ? _rememberedDisplay.get(id) : '';
  el.style.display = remembered;
  _rememberedDisplay.delete(id);
  // Re-clamp so a panel hidden near an edge (or restored from a different
  // viewport) never reappears off-screen.
  showPanelClamped(el);
}

/**
 * Idempotent setter for the global hidden state. Hides or shows every
 * currently registered panel and records the new state in memory. Does NOT
 * persist — callers that should persist (toggle) do so explicitly.
 *
 * @param {boolean} hidden
 */
export function setAllPanelsHidden(hidden) {
  _allHidden = hidden;
  for (const { id, el } of getRegisteredPanels()) {
    if (hidden) hideOnePanel(id, el);
    else showOnePanel(id, el);
  }
  // The Lighting Controls drawer and the left source-drawer stack are not
  // registered floating panels; clear them too so H fully clears the HUD.
  setDrawerVisible(!hidden);
  setLeftDrawersVisible(!hidden);
}

// ── Public toggle ────────────────────────────────────────────────────────

/**
 * Flip the global hidden state, apply it to every registered panel, and
 * persist the result.
 */
export function toggleAllPanels() {
  const next = nextVisibilityState({ hidden: _allHidden });
  setAllPanelsHidden(next.hidden);
  writePersistedState(next);
}

// ── Boot ─────────────────────────────────────────────────────────────────

// Re-apply the hidden state a bounded number of frames after init, so a
// panel that registers asynchronously (e.g. #gui-panel appears after the
// 3D model loads) still gets hidden. Bounded — no infinite polling.
const _REAPPLY_FRAMES = 60; // ~1s at 60fps

function scheduleHiddenReapply(framesLeft) {
  if (framesLeft <= 0) return;
  requestAnimationFrame(() => {
    if (!_allHidden) return; // operator already revealed panels — stop
    setAllPanelsHidden(true);
    scheduleHiddenReapply(framesLeft - 1);
  });
}

/**
 * Read the persisted visibility state and apply it once on boot. Safe to
 * call a single time after panels register. If the persisted state is
 * "hidden", late-arriving panels are caught by a short bounded re-apply.
 */
export function initPanelVisibility() {
  const state = readPersistedState();
  setAllPanelsHidden(state.hidden);
  if (state.hidden) scheduleHiddenReapply(_REAPPLY_FRAMES);
}
