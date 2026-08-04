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
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';

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
  // The fixture-definition registry is a module singleton and the exporter now
  // reads the LED-bus flag off it — clear it so a case that registers an
  // `bus: led` definition can never leak into a later one.
  initRegistry({});
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

// ── LED strand patch addressing: device per-output vs generic per-port ────
//
// The exporter's per-pixel {universe, addr, footprint} must agree BYTE-FOR-
// BYTE with computeLedStrandPatches (patches.yaml) and the firmware's
// PER-OUTPUT layout for controllers carrying a `device:` binding — each output
// is an independent receiver on its OWN (port.universe, ch 1) — and must keep
// the generic per-port projection for UNBOUND controllers. See docs/41 §3 and
// the per-output-only ruling (2026-07-10/11).

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

test('device-bound: two 40px RGBW outputs → per-port U3 ch1–160 / U4 ch1–160', () => {
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

  // Line A: U3, ch 1,5,…,157 (40 px × stride 4 = ch 1–160). Line B is an
  // INDEPENDENT per-output receiver on its OWN port universe (U4) channel 1,
  // ch 1,5,…,157 — NOT a continuation of A's stream at ch 161.
  assert.deepEqual(a[0], { universe: 3, addr: 1, footprint: 4, led: true });
  assert.deepEqual(a[39], { universe: 3, addr: 157, footprint: 4, led: true });
  assert.deepEqual(b[0], { universe: 4, addr: 1, footprint: 4, led: true });
  assert.deepEqual(b[39], { universe: 4, addr: 157, footprint: 4, led: true });

  // Footprint is the RGBW stride (4) on every pixel; channels carry the order.
  assert.ok(a.every(p => p.footprint === 4 && p.led === true));
  const chans = pixels.find(p => p.group === 'lineA').channels;
  assert.deepEqual(chans, { r: 1, g: 2, b: 3, w: 4 });
});

test('device-bound: a disabled/empty middle output contributes nothing; other ports unshifted', () => {
  resetWorld();
  // Output 2 (port index 1) carries no strands (disabled). Per-output, lineC on
  // output 3 lands at its OWN port universe (U5) channel 1 — the empty middle
  // port neither consumes channels nor shifts lineC off its declared universe.
  window.__controllerRegistry = ledRegistry([
    port(1, 3, 'lineA'), port(2, 4), port(3, 5, 'lineC'), port(4, 6),
  ]);
  params.ledStrands = [ledLine('lineA', -1), ledLine('lineC', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const c = strandPatches(pixels, 'lineC');
  assert.equal(c.length, 40);
  assert.deepEqual(c[0], { universe: 5, addr: 1, footprint: 4, led: true });
  assert.deepEqual(c[39], { universe: 5, addr: 157, footprint: 4, led: true });
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

test('UNBOUND LED controller exports PATCHED — chaining is the patch (ruling 2026-08-03)', () => {
  resetWorld();
  // Same rig, but NO device binding. Operator ruling 2026-08-03 (report
  // 20260725_123): *"unbound should not cause the lights to go off or unpatched
  // red."* Chaining a strand onto a port IS the patch; the typed IP is only the
  // sACN destination. So the model exports the SAME device-linear addresses
  // patches.yaml records and the bridge relays — the binding grade never enters
  // the byte layout. (Binding still governs hardware CLAIMS: first-contact
  // reconcile, push receipts.)
  window.__controllerRegistry = ledRegistry(
    [port(1, 3, 'lineA'), port(2, 4, 'lineB'), port(3, 5), port(4, 6)],
    { device: null });
  params.ledStrands = [ledLine('lineA', -1), ledLine('lineB', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  for (const name of ['lineA', 'lineB']) {
    const px = pixels.filter((p) => p.group === name);
    assert.equal(px.length, 40, `${name} still exports all its pixels`);
    assert.ok(px.every((p) => p.patch !== null && p.unpatched !== true),
      `${name} carries a real patch and NO unpatched marker`);
  }
  // Per-output firmware layout, identical to the bound case above.
  assert.deepEqual(strandPatches(pixels, 'lineA')[0],
    { universe: 3, addr: 1, footprint: 4, led: true });
  assert.deepEqual(strandPatches(pixels, 'lineB')[0],
    { universe: 4, addr: 1, footprint: 4, led: true });
});

test('a strand chained NOWHERE still exports UNPATCHED (the only dark state left)', () => {
  resetWorld();
  // The honest unpatched marker survives — it just means what it says now: this
  // strand is on no controller port at all.
  window.__controllerRegistry = ledRegistry(
    [port(1, 3, 'lineA'), port(2, 4), port(3, 5), port(4, 6)], { device: null });
  params.ledStrands = [ledLine('lineA', -1), ledLine('orphan', 1)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const orphan = pixels.filter((p) => p.group === 'orphan');
  assert.equal(orphan.length, 40);
  assert.ok(orphan.every((p) => p.patch === null && p.unpatched === true));
  assert.deepEqual(strandPatches(pixels, 'lineA')[0],
    { universe: 3, addr: 1, footprint: 4, led: true });
});

// ── G3: per-pixel addressing routes through the SAME walker ───────────
//
// An older exporter branch computed each pixel with a dense-byte formula
// (uniSpan = floor(startByte/512)) that ignored the tail bytes skipped at each
// no-straddle universe wrap. Every exported pixel now comes from
// projectLedStrandPixels — the same walker patches.yaml is written from — so
// the model, the record and the firmware share ONE source of truth. The case
// below is the spill: 200 px × stride 4 fills U3 to ch512 and rolls WHOLE to
// U4 ch1.
//
// (The misaligned-start arithmetic that motivated G3 — startAddr ≢ 1 (mod
// stride) — is no longer reachable THROUGH the exporter: only device-bound
// controllers export addresses, and every per-output cursor starts at channel
// 1. It stays pinned directly on the walker in
// tests/led_patch_projection.test.js, 'L1 misaligned start'.)

// A one-strand device-BOUND LED controller: `baseUniverse` on output 1, a
// single RGBW strand of `ledCount` pixels. Per-output firmware always starts a
// port at channel 1 (docs/41 §3).
function boundStrandRegistry(baseUniverse) {
  return createControllerRegistry({
    controllers: [{
      id: 1, name: 'Tbound', ip: '10.1.1.201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse, startAddr: 1 },
      device: { vendor: 'marsinled', controllerId: 'walker-fixture' },
      ports: [
        { port: 1, universe: baseUniverse, chain: ['strand'], output: 1 },
        { port: 2, universe: baseUniverse + 1, chain: [], output: 2 },
      ],
    }],
  });
}

function ledStrandN(name, ledCount) {
  return { name, ledCount, startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 4 };
}

test('G3 an UNBOUND spilling strand walks the SAME spill as the bound one', () => {
  resetWorld();
  // The same 200 px rig with NO device binding. Ruling 2026-08-03: the binding
  // grade is not part of the byte layout, so this must be byte-identical to the
  // bound case below — same walker, same universe roll at ch512.
  const reg = boundStrandRegistry(3);
  reg.controllers[0].device = null;
  window.__controllerRegistry = reg;
  params.ledStrands = [ledStrandN('strand', 200)];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const px = pixels.filter((p) => p.group === 'strand');
  assert.equal(px.length, 200);
  assert.ok(px.every((p) => p.patch !== null && p.unpatched !== true));
  const patches = strandPatches(pixels, 'strand');
  assert.deepEqual(patches[127], { universe: 3, addr: 509, footprint: 4, led: true });
  assert.deepEqual(patches[128], { universe: 4, addr: 1, footprint: 4, led: true });
  const walk = projectLedStrandPixels(3, 1, 4, 200).pixels;
  assert.deepEqual(patches.map((p) => ({ universe: p.universe, addr: p.addr })),
    walk.map((w) => ({ universe: w.universe, addr: w.addr })));
});

test('G3 BOUND stride-aligned start (ch1) spills whole to U4 and equals the walker', () => {
  resetWorld();
  // 200 px @ U3 ch1, stride 4: pixels 0–127 fill U3 (ch1–512, no straddle),
  // pixel 128 spills whole to U4 ch1 — the per-output firmware layout, taken
  // straight from projectLedStrandPixels.
  window.__controllerRegistry = boundStrandRegistry(3);
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

// ── LED PIXEL FIXTURES: `bus: led` makes a parLights fixture LED end-to-end ──
//
// Operator ruling 2026-07-31: *"the TE signs must be associated with MarsinLED
// controllers in the controller mapping pane … make sure the TE sign fixtures
// are clearly of type LED not DMX."* An LED pixel fixture keeps its baked
// per-pixel geometry but is WIRED like a strand — one MarsinLED output, cursor
// at (port universe, ch 1), stride bytes per pixel — so it exports
// `type: 'led'` with the per-pixel LED walk, never a whole-fixture DMX
// footprint. The classification is DATA: the definition's `bus`.

const SIGN_TYPE = 'TeSignSix';

/** A 6-pixel LED-bus fixture definition, registered like the real sign YAMLs. */
function registerSignDefinition() {
  initRegistry({
    [SIGN_TYPE]: {
      id: 'te_sign_six', name: 'TE Sign Six', fixture_type: SIGN_TYPE,
      channel_mode: 18, bus: 'led', controller_family: 'ango_4',
      pixels: Array.from({ length: 6 }, (_, i) => ({
        id: `pixel_${i + 1}`, type: 'rgb', size: 12,
        channels: { red: 3 * i + 1, green: 3 * i + 2, blue: 3 * i + 3 },
        dots: [[i * 50, 0, 0]],
      })),
    },
  });
}

/** The runtime fixture the exporter binds by config identity. */
function signRuntime(config) {
  const group = makeGroup();
  return {
    config,
    group,
    fixtureDef: { fixtureType: SIGN_TYPE, footprint: 18, bus: 'led' },
    pixels: Array.from({ length: 6 }, (_, i) => ({
      localPos: new THREE.Vector3(i * 0.05, 0, 0),
      model: { id: `pixel_${i + 1}`, size: 12,
        channels: { red: 3 * i + 1, green: 3 * i + 2, blue: 3 * i + 3 } },
    })),
    setPixelColorRGB() {},
  };
}

function signConfig(name) {
  return { name, fixtureType: SIGN_TYPE, group: 'TE Sign', x: 0, y: 0, z: 0 };
}

test('LED-bus fixture on a BOUND MarsinLED output exports type led + the per-pixel walk', () => {
  resetWorld();
  registerSignDefinition();
  const cfg = signConfig('TE Sign V3 A');
  params.parLights = [cfg];
  window.parFixtures = [signRuntime(cfg)];
  window.__controllerRegistry = ledRegistry([port(1, 3, 'TE Sign V3 A'), port(2, 4)]);

  const { pixels } = generatePixelMap();
  const sign = pixels.filter((p) => p.name.startsWith('TE Sign V3 A'));
  assert.equal(sign.length, 6);
  // TRANSPORT: LED, not DMX. This is the whole point of the reclassification.
  assert.ok(sign.every((p) => p.type === 'led'));
  // The fixtureType string is UNCHANGED — every selector that names it still
  // resolves (report 20260725_48 addendum 2).
  assert.ok(sign.every((p) => p.fixtureType === SIGN_TYPE));
  // ADDRESSING: stride 4 (RGBW controller) per pixel from U3 ch1 — the strand
  // walk, NOT one 18-channel DMX block.
  assert.deepEqual(sign.map((p) => p.patch), [1, 5, 9, 13, 17, 21].map((addr) => (
    { universe: 3, addr, footprint: 4, led: true })));
  // CHANNELS: the CONTROLLER's order map, relative to each pixel's own address
  // — never the definition's absolute 3i+1 block.
  assert.ok(sign.every((p) => JSON.stringify(p.channels) === JSON.stringify({ r: 1, g: 2, b: 3, w: 4 })));
  assert.ok(sign.every((p) => p.unpatched !== true));
  // GEOMETRY is untouched: the baked per-pixel dots still place the logo.
  assert.deepEqual(sign.map((p) => p.x), [0, 0.05, 0.1, 0.15, 0.2, 0.25]);
  assert.deepEqual(sign.map((p) => p.localIndex), [0, 1, 2, 3, 4, 5]);
});

test('LED-bus fixture chained on NOTHING exports UNPATCHED, loudly — like a strand', () => {
  resetWorld();
  registerSignDefinition();
  const cfg = signConfig('TE Sign V3 A');
  params.parLights = [cfg];
  window.parFixtures = [signRuntime(cfg)];
  // An LED controller exists, but the sign is on none of its outputs.
  window.__controllerRegistry = ledRegistry([port(1, 3), port(2, 4)]);

  const { pixels } = generatePixelMap();
  const sign = pixels.filter((p) => p.name.startsWith('TE Sign V3 A'));
  assert.equal(sign.length, 6);
  assert.ok(sign.every((p) => p.type === 'led'), 'still LED — the bus is the definition, not the wiring');
  assert.ok(sign.every((p) => p.patch === null && p.unpatched === true));
  assert.ok(sign.every((p) => p.channels === null));
});

test('a DMX-bus fixture is untouched by the LED-bus branch (regression)', () => {
  resetWorld();
  initRegistry({
    Par1: { id: 'par1', name: 'Par', fixture_type: 'Par1', channel_mode: 3, bus: 'dmx',
      pixels: [{ id: 'p1', channels: { red: 1, green: 2, blue: 3 } }] },
  });
  const cfg = { name: 'Par A', fixtureType: 'Par1', group: 'Pars', x: 0, y: 0, z: 0,
    dmxUniverse: 7, dmxAddress: 21 };
  params.parLights = [cfg];
  window.parFixtures = [{
    config: cfg, group: makeGroup(), fixtureDef: { fixtureType: 'Par1', footprint: 3 },
    pixels: [{ localPos: new THREE.Vector3(0, 0, 0),
      model: { id: 'p1', size: 12, channels: { red: 1, green: 2, blue: 3 } } }],
    setPixelColorRGB() {},
  }];
  window.__controllerRegistry = null;

  const { pixels } = generatePixelMap();
  const par = pixels.filter((p) => p.name.startsWith('Par A'));
  assert.equal(par.length, 1);
  assert.equal(par[0].type, 'dmx');
  assert.deepEqual(par[0].patch, { universe: 7, addr: 21, footprint: 3 });
  assert.deepEqual(par[0].channels, { r: 1, g: 2, b: 3 });
  assert.equal(par[0].unpatched, undefined);
});
