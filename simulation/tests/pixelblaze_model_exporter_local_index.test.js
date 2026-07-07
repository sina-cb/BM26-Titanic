/**
 * Tests that the Pixelblaze model exporter emits a TRUE 0-based per-fixture
 * `localIndex` on every pixel — DMX fixtures numbered per-fixture, LED strands
 * numbered per-strand — straight from the real fixture membership the exporter
 * owns. The engine prefers this over its (group,fId) heuristic so a sweep keyed
 * on it runs ALONG a bar/strand in true pixel order.
 *
 * `generatePixelMap` reads browser-ish globals (`window`, `params`). We mock
 * the minimum it needs; no real DOM/WebGL — THREE math + plain objects only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { params } from '../src/core/state.js';
import { generatePixelMap } from '../src/dmx/pixelblaze_model_exporter.js';

// A THREE.Group whose matrixWorld is identity so px.localPos passes through.
function makeGroup() {
  const g = new THREE.Group();
  g.updateMatrixWorld(true);
  return g;
}

// Reset the shared singletons between tests so cases don't leak into each other.
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
}

// ── DMX multi-pixel fixtures: localIndex is 0..N-1 within each fixture ─

test('DMX fixtures: each fixture numbers its own pixels 0..N-1', () => {
  resetWorld();

  // Two multi-pixel bars. Bar A has 3 pixels, Bar B has 2. They share a
  // coarse `group` but are distinct physical fixtures (distinct fixtureId) —
  // so a correct localIndex must restart at 0 for Bar B.
  const barA = { name: 'Bar A', type: 'ShehdsBar', group: 'Bars', fixtureId: 1,
    dmxUniverse: 1, dmxAddress: 1 };
  const barB = { name: 'Bar B', type: 'ShehdsBar', group: 'Bars', fixtureId: 2,
    dmxUniverse: 1, dmxAddress: 50 };
  params.dmxFixtures = [barA, barB];

  const mkFixture = (config, nPixels) => {
    const group = makeGroup();
    return {
      config,
      group,
      fixtureDef: { footprint: 18, channels: { red: 1, green: 2, blue: 3 } },
      pixels: Array.from({ length: nPixels }, (_, k) => ({
        localPos: new THREE.Vector3(k, 0, 0),
        model: { id: `pixel_${k + 1}`, channels: { red: 1, green: 2, blue: 3 }, size: 14 },
      })),
      setPixelColorRGB() {},
    };
  };
  window.parFixtures = [mkFixture(barA, 3), mkFixture(barB, 2)];

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 5);

  // Bar A pixels: localIndex 0,1,2 ; Bar B pixels: localIndex 0,1
  assert.deepEqual(pixels.map(p => p.localIndex), [0, 1, 2, 0, 1]);
  // And they are tagged to the right fixtures (sanity that runs didn't blur).
  assert.deepEqual(pixels.map(p => p.fId), [1, 1, 1, 2, 2]);
});

// ── LED strands: localIndex is 0..count-1 within each strand ──────────

test('LED strands: each strand numbers its own pixels 0..count-1', () => {
  resetWorld();

  // No controller registry → strands export UNPATCHED but STILL carry a true
  // per-strand localIndex (the field is independent of patching).
  const strandLeft = { name: 'Left_Front', ledCount: 4,
    startX: -10, startY: 0, startZ: 0, endX: -10, endY: 0, endZ: 3 };
  const strandRight = { name: 'Right_Front', ledCount: 3,
    startX: 10, startY: 0, startZ: 0, endX: 10, endY: 0, endZ: 2 };
  params.ledStrands = [strandLeft, strandRight];
  window.ledStrandFixtures = [
    { setLedColorRGB() {} },
    { setLedColorRGB() {} },
  ];

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 7);

  // Left strand 0..3, Right strand 0..2 — each restarts at 0.
  assert.deepEqual(pixels.map(p => p.localIndex), [0, 1, 2, 3, 0, 1, 2]);
  assert.deepEqual(pixels.map(p => p.group),
    ['Left_Front', 'Left_Front', 'Left_Front', 'Left_Front',
     'Right_Front', 'Right_Front', 'Right_Front']);
});

test('LED strand localIndex tracks physical position head→tail (sweepable)', () => {
  resetWorld();

  // A single 5-pixel strand laid out along +z. localIndex must increase WITH
  // physical position so a sweep keyed on it runs ALONG the strand.
  const strand = { name: 'Hull', ledCount: 5,
    startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 4 };
  params.ledStrands = [strand];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 5);

  let prevZ = -Infinity;
  for (let li = 0; li < 5; li++) {
    const px = pixels.find(p => p.localIndex === li);
    assert.ok(px, `must have a pixel with localIndex ${li}`);
    assert.ok(px.z > prevZ, `localIndex ${li} must advance ALONG the strand`);
    prevZ = px.z;
  }
});
