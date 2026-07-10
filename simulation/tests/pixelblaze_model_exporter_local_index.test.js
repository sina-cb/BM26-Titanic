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
import { createControllerRegistry, CONTROLLER_TYPE_LED } from '../src/dmx/controller_registry.js';
import { projectLedStrandPixels } from '../src/dmx/led/led_patch_projection.js';

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

// ── LED strand patch addressing: device-linear vs generic per-port ────
//
// The exporter's per-pixel {universe, addr, footprint} must agree BYTE-FOR-
// BYTE with computeLedStrandPatches (patches.yaml) and the firmware's
// contiguous linear layout for controllers carrying a `device:` binding, and
// must keep the generic per-port projection for UNBOUND controllers. See
// docs/41 §3 and .agent/reports/202607/20260710_1_exporter_linear_led.md.

const LED_DEVICE = { vendor: 'marsinled', controllerId: 'titanic_201', boardId: 'angio4-old' };

// A 40px RGBW line laid along +z, named to match its controller chain entry.
function ledLine(name, atX) {
  return { name, ledCount: 40, startX: atX, startY: 0, startZ: 0, endX: atX, endY: 0, endZ: 4 };
}

// One LED controller with 4 RGBW outputs on base universe 3. `device` present
// = device-bound (firmware contiguous layout); `device: null` = unbound
// (generic per-port). `ports` is [{ port, universe, chain }] (chain = strand
// names / gaps), mirroring led_patch_projection.test.js.
function ledRegistry(ports, { device = LED_DEVICE, baseUniverse = 3 } = {}) {
  return createControllerRegistry({
    controllers: [{
      id: 1, name: 'T201', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse, startAddr: 1 },
      device,
      ports,
    }],
  });
}

const port = (n, universe, ...chain) => ({ port: n, universe, chain });

// The exporter's per-pixel patch spans for a named strand, in emit order.
function strandPatches(pixels, name) {
  return pixels.filter(p => p.type === 'led' && p.group === name).map(p => p.patch);
}

test('device-bound: two 40px RGBW outputs → contiguous U3 ch1–160 / ch161–320', () => {
  resetWorld();
  window.__controllerRegistry = ledRegistry([
    port(1, 3, 'lineA'), port(2, 4, 'lineB'), port(3, 5), port(4, 6),
  ]);
  params.ledStrands = [ledLine('lineA', -1), ledLine('lineB', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const a = strandPatches(pixels, 'lineA');
  const b = strandPatches(pixels, 'lineB');
  assert.equal(a.length, 40);
  assert.equal(b.length, 40);

  // Line A: U3, ch 1,5,…,157 (40 px × stride 4 = ch 1–160). Line B CONTINUES
  // the contiguous stream at ch 161,165,…,317 (ch 161–320) — NOT restarted at
  // ch 1, which is the old per-port defect this fix closes.
  assert.deepEqual(a[0], { universe: 3, addr: 1, footprint: 4, led: true });
  assert.deepEqual(a[39], { universe: 3, addr: 157, footprint: 4, led: true });
  assert.deepEqual(b[0], { universe: 3, addr: 161, footprint: 4, led: true });
  assert.deepEqual(b[39], { universe: 3, addr: 317, footprint: 4, led: true });

  // Footprint is the RGBW stride (4) on every pixel; channels carry the order.
  assert.ok(a.every(p => p.footprint === 4 && p.led === true));
  const chans = pixels.find(p => p.group === 'lineA').channels;
  assert.deepEqual(chans, { r: 1, g: 2, b: 3, w: 4 });
});

test('device-bound: a disabled/unassigned middle output is skipped; cursor stays contiguous', () => {
  resetWorld();
  // Output 2 (port index 1) carries no strands (disabled). lineC on output 3
  // must still follow lineA's 160 channels — U3 ch161 — exactly like the
  // firmware, which contributes 0 pixels for a disabled output.
  window.__controllerRegistry = ledRegistry([
    port(1, 3, 'lineA'), port(2, 4), port(3, 5, 'lineC'), port(4, 6),
  ]);
  params.ledStrands = [ledLine('lineA', -1), ledLine('lineC', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const c = strandPatches(pixels, 'lineC');
  assert.equal(c.length, 40);
  assert.deepEqual(c[0], { universe: 3, addr: 161, footprint: 4, led: true });
  assert.deepEqual(c[39], { universe: 3, addr: 317, footprint: 4, led: true });
});

test('device-bound: a strand assigned to NO controller output exports UNPATCHED, loudly', () => {
  resetWorld();
  // 'lineA' is chained; 'ghost' exists as a sim strand but is on no output.
  window.__controllerRegistry = ledRegistry([port(1, 3, 'lineA'), port(2, 4), port(3, 5), port(4, 6)]);
  params.ledStrands = [ledLine('lineA', -1), ledLine('ghost', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const ghost = pixels.filter(p => p.group === 'ghost');
  assert.equal(ghost.length, 40);
  // Unassigned = LOUD unpatched marker (patch:null + unpatched:true), never a
  // silent skip or a guessed address (codex P0).
  assert.ok(ghost.every(p => p.patch === null && p.unpatched === true));
  // The patched sibling is unaffected and device-linear.
  assert.deepEqual(strandPatches(pixels, 'lineA')[0], { universe: 3, addr: 1, footprint: 4, led: true });
});

test('UNBOUND LED controller is UNCHANGED: generic per-port keeps both strands at U3 ch1', () => {
  resetWorld();
  // Same rig, but NO device binding. The generic per-port projection resets
  // each port to the controller's base lane, so BOTH lines start at U3 ch1 —
  // the pre-existing behavior, which must NOT change for unbound controllers.
  window.__controllerRegistry = ledRegistry(
    [port(1, 3, 'lineA'), port(2, 4, 'lineB'), port(3, 5), port(4, 6)],
    { device: null });
  params.ledStrands = [ledLine('lineA', -1), ledLine('lineB', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const a = strandPatches(pixels, 'lineA');
  const b = strandPatches(pixels, 'lineB');
  assert.deepEqual(a[0], { universe: 3, addr: 1, footprint: 4, led: true });
  // Unbound: lineB RESTARTS at ch1 (generic per-port), does NOT continue at 161.
  assert.deepEqual(b[0], { universe: 3, addr: 1, footprint: 4, led: true });
});

// ── G3: UNBOUND per-pixel addressing routes through the SAME walker ────
//
// The old unbound branch computed each pixel with a dense-byte formula
// (uniSpan = floor(startByte/512)) that ignored the tail bytes skipped at each
// no-straddle universe wrap. It agreed with the walker ONLY when
// (startAddr − 1) % stride == 0. The fix routes the unbound path through
// projectLedStrandPixels — the same walker the device-bound path and
// patches.yaml use — so both paths share ONE source of truth.

// A one-strand UNBOUND LED controller: base universe `baseUniverse`, start
// channel `startAddr`, a single RGBW strand of `ledCount` pixels on port 1.
function unboundStrandRegistry(baseUniverse, startAddr, ledCount) {
  return createControllerRegistry({
    controllers: [{
      id: 1, name: 'Tunbound', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse, startAddr },
      device: null,
      ports: [
        { port: 1, universe: baseUniverse, chain: ['strand'] },
        { port: 2, universe: baseUniverse + 1, chain: [] },
      ],
    }],
  });
}

function ledStrandN(name, ledCount) {
  return { name, ledCount, startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 4 };
}

test('G3 UNBOUND misaligned start: pixel 128 matches the walker (ch5), not the old formula (ch3)', () => {
  resetWorld();
  // stride 4, startAddr 3, 130 px. The plan's worked example: pixel 127 wraps
  // to U4 ch1 in BOTH models, but pixel 128 lands at U4 ch5 per the walker vs
  // U4 ch3 per the discarded dense-byte formula. (startAddr − 1) % 4 = 2 ≠ 0.
  window.__controllerRegistry = unboundStrandRegistry(3, 3, 130);
  params.ledStrands = [ledStrandN('strand', 130)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const patches = strandPatches(pixels, 'strand');
  assert.equal(patches.length, 130);

  // The exact divergence the fix closes.
  assert.deepEqual(patches[127], { universe: 4, addr: 1, footprint: 4, led: true });
  assert.deepEqual(patches[128], { universe: 4, addr: 5, footprint: 4, led: true });

  // And EVERY pixel equals the canonical walker byte-for-byte.
  const walk = projectLedStrandPixels(3, 3, 4, 130).pixels;
  assert.deepEqual(
    patches.map(p => ({ universe: p.universe, addr: p.addr })),
    walk.map(w => ({ universe: w.universe, addr: w.addr })));
});

test('G3 UNBOUND stride-aligned start (startAddr 1) is UNCHANGED and spills whole to U4', () => {
  resetWorld();
  // 200 px @ U3 ch1, stride 4: pixels 0–127 fill U3 (ch1–512, no straddle),
  // pixel 128 spills whole to U4 ch1. (startAddr − 1) % 4 = 0 → the old formula
  // and the walker already agreed here, so this is the byte-identical case.
  window.__controllerRegistry = unboundStrandRegistry(3, 1, 200);
  params.ledStrands = [ledStrandN('strand', 200)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const patches = strandPatches(pixels, 'strand');
  assert.equal(patches.length, 200);

  assert.deepEqual(patches[0], { universe: 3, addr: 1, footprint: 4, led: true });
  assert.deepEqual(patches[127], { universe: 3, addr: 509, footprint: 4, led: true });
  // No pixel straddles: pixel 128 jumps whole to U4 ch1 (nothing at U3 ch513+).
  assert.deepEqual(patches[128], { universe: 4, addr: 1, footprint: 4, led: true });
  assert.deepEqual(patches[199], { universe: 4, addr: 285, footprint: 4, led: true });

  const walk = projectLedStrandPixels(3, 1, 4, 200).pixels;
  assert.deepEqual(
    patches.map(p => ({ universe: p.universe, addr: p.addr })),
    walk.map(w => ({ universe: w.universe, addr: w.addr })));
});

// ── LED group tags (Req C1): pixel.group = groupKeyForStrand(strand) ──
//
// The exporter stamps every LED pixel with the strand's EFFECTIVE group
// (strand.group || strand.name). Grouped strands share one group → downstream
// (reconcileGroupBits / views.yaml / section numbering) treats them as one
// unit. Ungrouped strands keep group === strand.name (bit-for-bit unchanged).

// A short line along +z with an explicit group.
function ledLineGrouped(name, group, atX, count = 4) {
  return { name, group, ledCount: count, startX: atX, startY: 0, startZ: 0,
    endX: atX, endY: 0, endZ: 3 };
}

test('LED group tag: a strand with group "bench" exports every pixel with group "bench"', () => {
  resetWorld();
  params.ledStrands = [ledLineGrouped('LED_0', 'bench', 0, 5)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const leds = pixels.filter(p => p.type === 'led');
  assert.equal(leds.length, 5);
  assert.ok(leds.every(p => p.group === 'bench'),
    'every LED pixel carries the named group, not the strand name');
});

test('LED group tag: two strands sharing a group export ONE distinct group', () => {
  resetWorld();
  params.ledStrands = [
    ledLineGrouped('stackL_1', 'left smokestacks', -1, 3),
    ledLineGrouped('stackL_2', 'left smokestacks', 1, 2),
  ];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const groups = new Set(pixels.filter(p => p.type === 'led').map(p => p.group));
  assert.deepEqual([...groups], ['left smokestacks'],
    'grouped strands collapse to a single distinct group (share one bit/section)');
});

test('LED group tag: an ungrouped strand still exports group === strand.name (regression)', () => {
  resetWorld();
  params.ledStrands = [
    { name: 'Hull', ledCount: 4, startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 3 },
    { name: 'Deck', group: '', ledCount: 2, startX: 2, startY: 0, startZ: 0, endX: 2, endY: 0, endZ: 1 },
  ];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const groups = new Set(pixels.filter(p => p.type === 'led').map(p => p.group));
  // No group (undefined) and empty-string group both fall back to the name.
  assert.deepEqual([...groups].sort(), ['Deck', 'Hull']);
});

// ── resolveSectionId ReferenceError fix (Req B): the single-light DMX branch ──
//
// pixelblaze_model_exporter.js:155 previously called `resolveSectionId(light)`,
// a symbol defined nowhere — the `fixture.light` (simple single-pixel) branch
// would throw ReferenceError if taken. It is now `light.sectionId || 0`.

test('simple single-light DMX fixture (fixture.light branch) exports sId without ReferenceError', () => {
  resetWorld();
  const light = { name: 'Simple', type: 'Generic', group: 'simples',
    sectionId: 7, fixtureId: 3, dmxUniverse: 2, dmxAddress: 1 };
  params.dmxFixtures = [light];
  window.parFixtures = [{
    config: light,
    light: {},              // truthy, no `pixels` → the simple-fixture branch
    group: makeGroup(),
    fixtureDef: { footprint: 3, channels: { red: 1, green: 2, blue: 3 } },
    setPixelColorRGB() {},
  }];

  const { pixels } = generatePixelMap();
  const px = pixels.find(p => p.name === 'Simple');
  assert.ok(px, 'the simple single-light fixture exported a pixel (no throw)');
  assert.equal(px.sId, 7); // sId = light.sectionId || 0 (the resolveSectionId fix)
  assert.equal(px.fId, 3);
});
