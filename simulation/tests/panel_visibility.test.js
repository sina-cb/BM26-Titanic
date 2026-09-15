import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PANEL_VISIBILITY_KEY,
  VISIBILITY_MODES,
  HIDE_ALL_ONLY_SELECTORS,
  normalizeMode,
  nextVisibilityMode,
} from '../src/gui/panel_visibility.js';

// Pins the pure visibility-policy pieces in src/gui/panel_visibility.js.
// Only the pure exports are exercised — cyclePanelVisibility & co. need a
// DOM and browser globals (window/localStorage). The module's top level
// must not touch those, so this import stays DOM-free.

// ── Storage key contract ─────────────────────────────────────────────────

test('PANEL_VISIBILITY_KEY is the expected localStorage key', () => {
  assert.equal(PANEL_VISIBILITY_KEY, 'bm26.sim.panelVisibility');
});

test('VISIBILITY_MODES is the 3-step cycle in order', () => {
  assert.deepEqual(VISIBILITY_MODES, ['show_all', 'hide_noncritical', 'hide_all']);
});

// ── nextVisibilityMode reducer ───────────────────────────────────────────

test('nextVisibilityMode advances through the cycle', () => {
  assert.equal(nextVisibilityMode('show_all'), 'hide_noncritical');
  assert.equal(nextVisibilityMode('hide_noncritical'), 'hide_all');
  assert.equal(nextVisibilityMode('hide_all'), 'show_all');
});

test('nextVisibilityMode round-trips after three steps', () => {
  let m = 'show_all';
  for (let i = 0; i < 3; i++) m = nextVisibilityMode(m);
  assert.equal(m, 'show_all');
});

test('nextVisibilityMode treats unknown/undefined as show_all (advances to hide_noncritical)', () => {
  assert.equal(nextVisibilityMode(undefined), 'hide_noncritical');
  assert.equal(nextVisibilityMode('bogus'), 'hide_noncritical');
});

// ── normalizeMode (incl. legacy {hidden} migration) ──────────────────────

test('normalizeMode passes valid modes through', () => {
  for (const m of VISIBILITY_MODES) assert.equal(normalizeMode(m), m);
});

test('normalizeMode migrates the legacy {hidden:true} store to hide_all', () => {
  assert.equal(normalizeMode({ hidden: true }), 'hide_all');
});

test('normalizeMode maps legacy {hidden:false} and junk to show_all', () => {
  assert.equal(normalizeMode({ hidden: false }), 'show_all');
  assert.equal(normalizeMode(undefined), 'show_all');
  assert.equal(normalizeMode('bogus'), 'show_all');
  assert.equal(normalizeMode({}), 'show_all');
});

// ── hide_all covers every persistent banner + toast (operator ruling 2026-09-14) ──

test('HIDE_ALL_ONLY_SELECTORS lists every persistent warning banner and toast', () => {
  const required = [
    '#engine-blackout-warning', '#unpatched-warning', '#spotlight-warning',
    '#gpu-adapter-warning', '#multi-client-warning', '#bench-mirror-banner',
    '#universe-mismatch-warning', '#controller-ip-warning',
    '#spotlight-cap-toast', '#overlap-toast', '#save-toast', '#auto-patch-toast',
    '#pm-manager-toast', '#cm-toast',
  ];
  for (const sel of required) {
    assert.ok(HIDE_ALL_ONLY_SELECTORS.includes(sel), `${sel} must be hidden by hide_all`);
  }
});

test('hide_all keeps the H-key feedback toast and the fatal boot screen visible', () => {
  assert.ok(!HIDE_ALL_ONLY_SELECTORS.includes('#panel-visibility-toast'));
  assert.ok(!HIDE_ALL_ONLY_SELECTORS.includes('#fatal-boot-error'));
});
