/**
 * Regression for the LED-strand "dark in the patched local pixelblaze engine"
 * bug (operator report 2026-07-10). animate.js used to gate the direct visual
 * paint on `!window._patchesActive` alone, so with any DMX fixture patched it
 * skipped entry.apply() for EVERY entry — fine for DMX fixtures (the DMX router
 * repaints them from the universe buffer via applyDmxFrame), but LED strands
 * have NO such read-back, so they never painted and froze at their construction
 * color. `entryPaintsDirect` encodes the corrected rule: an LED entry paints
 * directly every frame; a DMX entry only when unpatched.
 *
 * Pure logic — no THREE, no DOM, no WebGL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entryPaintsDirect } from '../src/core/render_paint_rule.js';

test('unpatched: EVERY entry paints directly (DMX and LED)', () => {
  assert.equal(entryPaintsDirect({ type: 'dmx' }, false), true);
  assert.equal(entryPaintsDirect({ type: 'led' }, false), true);
});

test('patched: LED strands STILL paint directly (they have no wire read-back)', () => {
  // This is the bug fix: before, a patched LED entry returned false → frozen.
  assert.equal(entryPaintsDirect({ type: 'led' }, true), true);
});

test('patched: DMX entries do NOT paint directly (the DMX router repaints them)', () => {
  assert.equal(entryPaintsDirect({ type: 'dmx' }, true), false);
});

test('a missing/odd entry never throws and defaults to the DMX rule', () => {
  assert.equal(entryPaintsDirect(null, true), false);
  assert.equal(entryPaintsDirect(undefined, false), true);
  assert.equal(entryPaintsDirect({}, true), false);
});
