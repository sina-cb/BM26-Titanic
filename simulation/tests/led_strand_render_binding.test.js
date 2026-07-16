/**
 * Regression for the LED-strand render binding (operator report 2026-07-10).
 *
 * generatePixelMap() binds each strand pixel's apply() closure to
 * window.ledStrandFixtures[i] AT GENERATION TIME (pixelblaze_model_exporter.js).
 * rebuildLedStrands() (gui_builder.js) DESTROYS every LedStrand and creates new
 * instances on any strand edit (count/color/position/add/delete), but used to
 * leave the batch-render cache untouched — so the cached apply() closures kept
 * writing to the DISPOSED InstancedMeshes and the strand went dark. The fix
 * invalidates the batch cache on rebuild, forcing generatePixelMap() to re-run
 * and REBIND apply() to the live instances.
 *
 * These tests pin the invariant the fix relies on: a freshly generated map
 * always paints the CURRENT fixture instance, and a stale closure paints the
 * OLD one (which is exactly why the rebuild must regenerate). Real production
 * code — generatePixelMap + LedStrand — under THREE math, no DOM/WebGL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { params } from '../src/core/state.js';
import { generatePixelMap } from '../src/dmx/pixelblaze_model_exporter.js';
import { LedStrand } from '../src/fixtures/led_strand.js';

function resetWorld() {
  globalThis.window = globalThis.window || {};
  window._isRebuildingFixtures = false;
  window.parFixtures = [];
  window.dmxSceneFixtures = [];
  window.ledStrandFixtures = [];
  window.__controllerRegistry = null;
  window._missingFixtureWarnCount = 0;
  params.dmxFixtures = [];
  params.parLights = [];
  params.ledStrands = [];
  // Any mappingEnabled profile — the strand apply() early-returns otherwise.
  params.lightingProfile = 'emissive';
}

function makeStrandConfig(overrides = {}) {
  return Object.assign({
    name: 'LED_0',
    startX: -3, startY: 5, startZ: 0,
    endX: 3, endY: 5, endZ: 0,
    color: '#ff8800',
    ledCount: 8,
  }, overrides);
}

function newStrandInstance(config) {
  return new LedStrand(config, 0, new THREE.Scene(), []);
}

// Find the first LED-strand pixel's apply from a freshly generated map.
function firstLedApply() {
  const { pixels } = generatePixelMap();
  const px = pixels.find(p => p.type === 'led');
  assert.ok(px && typeof px.apply === 'function', 'a strand LED pixel with apply() exists');
  return px.apply;
}

function bulbColor(strand, index = 0) {
  const c = new THREE.Color();
  strand.bulbInst.getColorAt(index, c);
  return c;
}

test('a freshly generated map paints the CURRENT strand instance', () => {
  resetWorld();
  const config = makeStrandConfig();
  const a = newStrandInstance(config);
  window.ledStrandFixtures = [a];
  params.ledStrands = [config];

  firstLedApply()(1, 0, 0); // paint pixel 0 red
  const c = bulbColor(a, 0);
  assert.ok(Math.abs(c.r - 1) < 1e-5 && c.g < 1e-5 && c.b < 1e-5,
    'the live strand instance is painted red');
});

test('after an instance swap (rebuildLedStrands), a regenerated map rebinds to the NEW instance', () => {
  resetWorld();
  const config = makeStrandConfig();
  const a = newStrandInstance(config);
  window.ledStrandFixtures = [a];
  params.ledStrands = [config];

  // Capture the closure bound to instance A (the stale-cache scenario). A is
  // kept alive (not destroy()ed) only so the test can still inspect its mesh;
  // in production rebuildLedStrands() disposes it, which turns the stale write
  // into a silent no-op — the exact "strand goes dark" symptom.
  const staleApply = firstLedApply();

  // Simulate the rebuild: create a NEW instance B for the same config and
  // publish it as the current fixture.
  const b = newStrandInstance(config);
  window.ledStrandFixtures = [b];

  // The fix: the cache is invalidated on rebuild → generatePixelMap re-runs.
  // The freshly bound closure must paint B, the live instance.
  firstLedApply()(0, 1, 0); // paint pixel 0 green on the CURRENT instance
  const cb = bulbColor(b, 0);
  assert.ok(cb.g > 0.9 && cb.r < 1e-5,
    'the regenerated map paints the NEW strand instance green');

  // And the STALE closure still targets A, never B — this is precisely why a
  // rebuild MUST regenerate the map (the gui_builder invalidate). Painting
  // through it must not touch the live instance B.
  staleApply(1, 0, 0);
  const cbAfterStale = bulbColor(b, 0);
  assert.ok(cbAfterStale.g > 0.9 && cbAfterStale.r < 1e-5,
    'the stale closure does NOT paint the live instance B (it captured A)');
  const ca = bulbColor(a, 0);
  assert.ok(Math.abs(ca.r - 1) < 1e-5 && ca.g < 1e-5,
    'the stale closure still writes to the old instance A');
});
