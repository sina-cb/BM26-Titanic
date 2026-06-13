import test from 'node:test';
import assert from 'node:assert/strict';

import { PANEL_VISIBILITY_KEY, nextVisibilityState } from '../src/gui/panel_visibility.js';

// Pins the pure visibility-policy pieces in src/gui/panel_visibility.js.
// Only the pure exports are exercised — toggleAllPanels & co. need a DOM
// and browser globals (window/localStorage). The module's top level must
// not touch those, so this import stays DOM-free.

// ── Storage key contract ─────────────────────────────────────────────────

test('PANEL_VISIBILITY_KEY is the expected localStorage key', () => {
  assert.equal(PANEL_VISIBILITY_KEY, 'bm26.sim.panelVisibility');
});

// ── nextVisibilityState reducer ──────────────────────────────────────────

test('nextVisibilityState flips false → true', () => {
  assert.deepEqual(nextVisibilityState({ hidden: false }), { hidden: true });
});

test('nextVisibilityState flips true → false', () => {
  assert.deepEqual(nextVisibilityState({ hidden: true }), { hidden: false });
});

test('nextVisibilityState round-trips back to the start', () => {
  const start = { hidden: false };
  assert.deepEqual(nextVisibilityState(nextVisibilityState(start)), start);
});

test('nextVisibilityState treats missing/undefined state as not hidden', () => {
  assert.deepEqual(nextVisibilityState(undefined), { hidden: true });
  assert.deepEqual(nextVisibilityState({}), { hidden: true });
});
