/**
 * pixel_order_export.test.js — the EXPORTER SEAM of Mechanism A (design contract
 * 20260806_174 §2.6).
 *
 * The rule under test: a `pixelOrder: reversed` entry permutes ONLY the WIRE
 * ASSOCIATION of a fixture's pixels — the DMX `channels` map for a DMX pixel,
 * the `ledWalk` patch entry for an LED-bus pixel — while geometry (`x/y/z`,
 * `rx/ry/rz`), `localIndex`, `pixelSize`, the pixel name and the sim's `apply`
 * closure all stay at the MODEL slot `j`. Patterns stay spatial, the 3D preview
 * keeps showing model intent, and the engine needs no change at all.
 *
 * Also pinned: the all-NORMAL export is BYTE-IDENTICAL to a scene that has never
 * heard of pixel order, and every refusal (invalid enum, single-pixel fixture)
 * throws out of the model export — which is what aborts the whole save, because
 * exportConfig runs saveModelJS FIRST.
 *
 * `generatePixelMap`/`saveModelJS` read browser-ish globals; we mock the minimum
 * (no DOM/WebGL — THREE math + plain objects).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import yaml from 'js-yaml';

import { params } from '../src/core/state.js';
import { generatePixelMap, saveModelJS } from '../src/dmx/pixelblaze_model_exporter.js';
import { createControllerRegistry, CONTROLLER_TYPE_LED } from '../src/dmx/controller_registry.js';
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';
import { extractParams, reconstructYAML } from '../src/core/config.js';

function makeGroup() {
  const g = new THREE.Group();
  g.updateMatrixWorld(true);
  return g;
}

function resetWorld() {
  globalThis.window = globalThis.window || {};
  window._isRebuildingFixtures = false;
  window.parFixtures = [];
  window.dmxSceneFixtures = [];
  window.ledStrandFixtures = [];
  window.__controllerRegistry = null;
  window.__viewRegistry = null;
  window.__activeScene = null;
  window._missingFixtureWarnCount = 0;
  window.serverConfig = { save_port: 6970 };
  params.dmxFixtures = [];
  params.parLights = [];
  params.ledStrands = [];
  params.pixelOrder = undefined;
  initRegistry({});
}

function captureModelBody(fn) {
  const bodies = [];
  const realFetch = global.fetch;
  global.fetch = (url, opts) => {
    bodies.push({ url: String(url), body: opts && opts.body });
    return Promise.resolve({ ok: true });
  };
  try {
    fn();
  } finally {
    global.fetch = realFetch;
  }
  const model = bodies.find((b) => b.url.includes('/save-model') && !b.url.includes('type='));
  assert.ok(model, 'saveModelJS should POST the model body');
  // The header carries a wall-clock timestamp — strip it so two exports taken
  // milliseconds apart can be compared byte-for-byte.
  return model.body.replace(/^\/\/ Updated: .*$/m, '// Updated: <stamped>');
}

// ── SHEHDS 18×18W RGBWAV bar (119ch): 6-channel RGBWAU blocks from ch 12 ──
//
// The real definition (dmx/fixtures/shehds_18_18w_led_bar/model_119.yaml):
// 11 master/control channels, then 18 pixels × { red, green, blue, white,
// amber, violet } starting at channel 12.

const SHEHDS_TYPE = 'ShehdsBar';
const shehdsPixelChannels = (k) => ({
  red: 12 + 6 * k, green: 13 + 6 * k, blue: 14 + 6 * k,
  white: 15 + 6 * k, amber: 16 + 6 * k, violet: 17 + 6 * k,
});

function shehdsRuntime(config, n = 18) {
  return {
    config,
    group: makeGroup(),
    fixtureDef: { fixtureType: SHEHDS_TYPE, footprint: 119 },
    pixels: Array.from({ length: n }, (_, k) => ({
      localPos: new THREE.Vector3(k * 0.05, 0, 0),
      model: { id: `pixel_${k + 1}`, size: 14, channels: shehdsPixelChannels(k) },
    })),
    setPixelColorRGB() {},
  };
}

function registerShehds(n = 18) {
  initRegistry({
    [SHEHDS_TYPE]: {
      id: 'shehds_bar_119', name: 'SHEHDS Bar', fixture_type: SHEHDS_TYPE, channel_mode: 119,
      pixels: Array.from({ length: n }, (_, k) => ({
        id: `pixel_${k + 1}`, type: 'rgbwav', size: 14, channels: shehdsPixelChannels(k),
      })),
    },
  });
}

/** One patched 18-px bar named `name`, ready to export. */
function oneBar(name = 'Bar Left', n = 18) {
  registerShehds(n);
  const cfg = { name, type: SHEHDS_TYPE, group: 'Bars', fixtureId: 1,
    dmxUniverse: 1, dmxAddress: 1 };
  params.dmxFixtures = [cfg];
  window.parFixtures = [shehdsRuntime(cfg, n)];
  return cfg;
}

// ── 1. All-NORMAL is byte-identical to "no such feature" ───────────────────

test('all-NORMAL export is BYTE-IDENTICAL with no store, an empty store, and explicit normal', () => {
  resetWorld();
  oneBar();
  const noStore = captureModelBody(() => saveModelJS());

  resetWorld();
  oneBar();
  params.pixelOrder = {};
  const emptyStore = captureModelBody(() => saveModelJS());

  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'normal' };
  const explicitNormal = captureModelBody(() => saveModelJS());

  assert.equal(emptyStore, noStore);
  assert.equal(explicitNormal, noStore);
});

test('an entry naming a DIFFERENT fixture changes nothing for this one', () => {
  resetWorld();
  oneBar();
  const before = captureModelBody(() => saveModelJS());
  resetWorld();
  oneBar();
  params.pixelOrder = { 'Some Other Bar 3': 'reversed' };
  assert.equal(captureModelBody(() => saveModelJS()), before);
});

// ── 2. REVERSED permutes the wire association EXACTLY ONCE ────────────────

test('REVERSED: channels come from slot N-1-j; geometry, localIndex and name stay at j', () => {
  resetWorld();
  oneBar();
  const normal = generatePixelMap().pixels;

  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'reversed' };
  const reversed = generatePixelMap().pixels;

  assert.equal(normal.length, 18);
  assert.equal(reversed.length, 18);

  // The wire association is the exact reverse — applied ONCE, not twice.
  assert.deepEqual(reversed.map((p) => p.channels), [...normal.map((p) => p.channels)].reverse());
  // Slot 0 now carries the LAST pixel's channel block (ch 114..119).
  assert.deepEqual(reversed[0].channels,
    { r: 114, g: 115, b: 116, w: 117, a: 118, u: 119 });
  assert.deepEqual(reversed[17].channels, { r: 12, g: 13, b: 14, w: 15, a: 16, u: 17 });

  // EVERYTHING ELSE is untouched, field by field.
  for (let j = 0; j < 18; j++) {
    for (const field of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'nx', 'ny', 'nz',
      'localIndex', 'pixelSize', 'name', 'type', 'fixtureType', 'group', 'cId', 'sId', 'fId']) {
      assert.deepEqual(reversed[j][field], normal[j][field],
        `pixel ${j}: ${field} must not move`);
    }
    assert.deepEqual(reversed[j].patch, normal[j].patch, `pixel ${j}: DMX patch must not move`);
  }
});

test('REVERSED twice (reversing the reversal) returns the identity model', () => {
  resetWorld();
  oneBar();
  const normal = generatePixelMap().pixels.map((p) => p.channels);

  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'reversed' };
  const once = generatePixelMap().pixels.map((p) => p.channels);
  // The permutation is an involution: reversing the reversed channel LIST
  // reproduces the normal one exactly (nothing is applied twice inside).
  assert.deepEqual([...once].reverse(), normal);
});

// ── 3. RGBWAU blocks intact; w/a never swapped; controls untouched ────────

test('RGBWAU blocks move as ONE unit — r/g/b/w/a/u keep their roles', () => {
  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'reversed' };
  const pixels = generatePixelMap().pixels;
  for (let j = 0; j < 18; j++) {
    const src = 17 - j;
    const expected = shehdsPixelChannels(src);
    assert.deepEqual(pixels[j].channels, {
      r: expected.red, g: expected.green, b: expected.blue,
      w: expected.white, a: expected.amber, u: expected.violet,
    }, `pixel ${j}: the whole 6-channel block comes from slot ${src}, role for role`);
    // The white and amber lanes are ADJACENT channels of the same block — the
    // classic silent-corruption pair. They are never exchanged.
    assert.equal(pixels[j].channels.w + 1, pixels[j].channels.a);
  }
});

test('control channels (1..11, claimed by no pixel) never enter a pixel channel map', () => {
  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'reversed' };
  for (const px of generatePixelMap().pixels) {
    for (const ch of Object.values(px.channels)) {
      assert.ok(ch >= 12, `channel ${ch} is a master/control channel — no pixel may claim it`);
    }
  }
});

// ── 4. Vintage LED (33ch): six heads on NON-CONTIGUOUS lanes ──────────────
//
// dmx/fixtures/vintage_led_stage_light/model_33.yaml: head k has
// { value: 3+k, red: 16+3k, green: 17+3k, blue: 18+3k }. Channels 1,2 and 9..15
// (dimmer/strobe/aux/macros) are claimed by NO pixel and are not per-pixel data
// at all, so the permutation cannot touch them.

const VINTAGE_TYPE = 'VintageLed';
const vintageHead = (k) => ({ value: 3 + k, red: 16 + 3 * k, green: 17 + 3 * k, blue: 18 + 3 * k });

function oneVintage(name = 'Vintage 1') {
  initRegistry({
    [VINTAGE_TYPE]: {
      id: 'vintage_33', name: 'Vintage LED', fixture_type: VINTAGE_TYPE, channel_mode: 33,
      pixels: Array.from({ length: 6 }, (_, k) => ({
        id: `head_${k + 1}`, type: 'rgbw', size: 18, channels: vintageHead(k),
      })),
    },
  });
  const cfg = { name, type: VINTAGE_TYPE, group: 'Vintage', fixtureId: 2,
    dmxUniverse: 2, dmxAddress: 1 };
  params.dmxFixtures = [cfg];
  window.parFixtures = [{
    config: cfg,
    group: makeGroup(),
    fixtureDef: { fixtureType: VINTAGE_TYPE, footprint: 33 },
    pixels: Array.from({ length: 6 }, (_, k) => ({
      localPos: new THREE.Vector3(0, k * 0.075, 0),
      model: { id: `head_${k + 1}`, size: 18, channels: vintageHead(k) },
    })),
    setPixelColorRGB() {},
  }];
  return cfg;
}

test('Vintage six heads: non-contiguous value 3..8 and rgb 16..33 permute head-wise', () => {
  resetWorld();
  oneVintage();
  params.pixelOrder = { 'Vintage 1': 'reversed' };
  const pixels = generatePixelMap().pixels;
  assert.equal(pixels.length, 6);

  // Head order reverses: slot 0 takes head 6's lanes, slot 5 takes head 1's.
  // `value` (the dimmer-per-head lane) standardizes to `w`.
  assert.deepEqual(pixels.map((p) => p.channels.w), [8, 7, 6, 5, 4, 3]);
  assert.deepEqual(pixels.map((p) => p.channels.r), [31, 28, 25, 22, 19, 16]);
  assert.deepEqual(pixels.map((p) => p.channels.g), [32, 29, 26, 23, 20, 17]);
  assert.deepEqual(pixels.map((p) => p.channels.b), [33, 30, 27, 24, 21, 18]);

  // Inside a head, r→r / g→g / b→b: the triplet is contiguous and ascending.
  for (const px of pixels) {
    assert.equal(px.channels.g, px.channels.r + 1);
    assert.equal(px.channels.b, px.channels.r + 2);
  }
  // Geometry still runs bottom→top at slots 0..5 (the model's own layout).
  assert.deepEqual(pixels.map((p) => p.localIndex), [0, 1, 2, 3, 4, 5]);
  const ys = pixels.map((p) => p.y);
  for (let j = 1; j < 6; j++) assert.ok(ys[j] > ys[j - 1]);
});

// ── 5. LED-bus fixtures: the WIRE is the ledWalk patch, not the channels ──
//
// Audit finding F-6: an LED-bus fixture's per-pixel `channels` are the
// CONTROLLER's order map — identical on every pixel — so permuting them reverses
// nothing. The wire association there is the per-pixel patch entry.

const SIGN_TYPE = 'TeSignSix';

function oneSign(name = 'TE Sign A') {
  initRegistry({
    [SIGN_TYPE]: {
      id: 'te_sign_six', name: 'TE Sign Six', fixture_type: SIGN_TYPE, channel_mode: 18,
      bus: 'led', controller_family: 'ango_4',
      pixels: Array.from({ length: 6 }, (_, i) => ({
        id: `pixel_${i + 1}`, type: 'rgb', size: 12,
        channels: { red: 3 * i + 1, green: 3 * i + 2, blue: 3 * i + 3 },
      })),
    },
  });
  const cfg = { name, fixtureType: SIGN_TYPE, group: 'TE Sign', x: 0, y: 0, z: 0 };
  params.parLights = [cfg];
  window.parFixtures = [{
    config: cfg,
    group: makeGroup(),
    fixtureDef: { fixtureType: SIGN_TYPE, footprint: 18, bus: 'led' },
    pixels: Array.from({ length: 6 }, (_, i) => ({
      localPos: new THREE.Vector3(i * 0.05, 0, 0),
      model: { id: `pixel_${i + 1}`, size: 12,
        channels: { red: 3 * i + 1, green: 3 * i + 2, blue: 3 * i + 3 } },
    })),
    setPixelColorRGB() {},
  }];
  window.__controllerRegistry = createControllerRegistry({
    controllers: [{
      id: 1, name: 'T201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse: 3, startAddr: 1 },
      device: { vendor: 'marsinled', controllerId: 'titanic_201' },
      ports: [{ port: 1, universe: 3, chain: [name] }, { port: 2, universe: 4, chain: [] }],
    }],
  });
  return cfg;
}

test('LED-bus fixture REVERSED: the per-pixel stride block (ledWalk) permutes, whole', () => {
  resetWorld();
  oneSign();
  const normal = generatePixelMap().pixels;
  assert.deepEqual(normal.map((p) => p.patch.addr), [1, 5, 9, 13, 17, 21]);

  resetWorld();
  oneSign();
  params.pixelOrder = { 'TE Sign A': 'reversed' };
  const reversed = generatePixelMap().pixels;

  // The WIRE moved: slot 0 now drives the last stride block, slot 5 the first.
  assert.deepEqual(reversed.map((p) => p.patch.addr), [21, 17, 13, 9, 5, 1]);
  assert.ok(reversed.every((p) => p.patch.universe === 3 && p.patch.footprint === 4));
  // WHOLE stride blocks — the in-block byte order (the controller order map) is
  // untouched, so w never lands where r belongs.
  assert.ok(reversed.every((p) =>
    JSON.stringify(p.channels) === JSON.stringify({ r: 1, g: 2, b: 3, w: 4 })));
  // Transport, geometry and localIndex stay put.
  for (let j = 0; j < 6; j++) {
    for (const field of ['type', 'x', 'y', 'z', 'localIndex', 'name', 'whiteMode']) {
      assert.deepEqual(reversed[j][field], normal[j][field], `pixel ${j}: ${field}`);
    }
  }
});

test('LED-bus fixture that is UNPATCHED stays unpatched under REVERSED (no invented address)', () => {
  resetWorld();
  oneSign();
  // Same sign, chained nowhere.
  window.__controllerRegistry = createControllerRegistry({
    controllers: [{
      id: 1, name: 'T201', type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse: 3, startAddr: 1 },
      device: { vendor: 'marsinled', controllerId: 'titanic_201' },
      ports: [{ port: 1, universe: 3, chain: [] }],
    }],
  });
  params.pixelOrder = { 'TE Sign A': 'reversed' };
  const pixels = generatePixelMap().pixels;
  assert.equal(pixels.length, 6);
  assert.ok(pixels.every((p) => p.patch === null && p.unpatched === true));
});

// ── 6. Refusals: single-pixel fixtures and invalid values ────────────────

test('a REVERSED entry on a single-pixel (par) fixture THROWS at export', () => {
  resetWorld();
  initRegistry({
    UkingPar: { id: 'uking', name: 'Uking Par', fixture_type: 'UkingPar', channel_mode: 10,
      pixels: [{ id: 'p1', channels: { red: 1, green: 2, blue: 3 } }] },
  });
  const cfg = { name: 'Par 1', type: 'UkingPar', group: 'Pars', dmxUniverse: 1, dmxAddress: 1 };
  params.dmxFixtures = [cfg];
  window.parFixtures = [{
    config: cfg, group: makeGroup(), fixtureDef: { fixtureType: 'UkingPar', footprint: 10 },
    pixels: [{ localPos: new THREE.Vector3(0, 0, 0),
      model: { id: 'p1', size: 14, channels: { red: 1, green: 2, blue: 3 } } }],
    setPixelColorRGB() {},
  }];
  params.pixelOrder = { 'Par 1': 'reversed' };
  assert.throws(() => generatePixelMap(), /Par 1.*single-pixel/s);
});

test('a REVERSED entry on a SIMPLE (no-pixel-model) fixture THROWS at export', () => {
  resetWorld();
  const cfg = { name: 'Simple 1', type: 'Generic', group: 'simples',
    dmxUniverse: 2, dmxAddress: 1 };
  params.dmxFixtures = [cfg];
  window.parFixtures = [{
    config: cfg, light: {}, group: makeGroup(),
    fixtureDef: { footprint: 3, channels: { red: 1, green: 2, blue: 3 } },
    setPixelColorRGB() {},
  }];
  params.pixelOrder = { 'Simple 1': 'reversed' };
  assert.throws(() => generatePixelMap(), /Simple 1.*single-pixel/s);
});

test('an INVALID enum value THROWS at export, naming fixture, value and the fix', () => {
  for (const bad of ['REVERSED', 'true', true, 1]) {
    resetWorld();
    oneBar();
    params.pixelOrder = { 'Bar Left': bad };
    assert.throws(() => generatePixelMap(), (err) => {
      assert.match(err.message, /Bar Left/);
      assert.match(err.message, /scene_config\.yaml pixelOrder/);
      assert.match(err.message, /must be 'normal' or 'reversed'/);
      return true;
    }, `value ${JSON.stringify(bad)} must abort the export`);
  }
});

test('the refusal happens inside saveModelJS — which is what aborts the whole save', () => {
  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'REVERSED' };
  let posted = 0;
  const realFetch = global.fetch;
  global.fetch = () => { posted += 1; return Promise.resolve({ ok: true }); };
  try {
    assert.throws(() => saveModelJS(), /Bar Left/);
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(posted, 0, 'nothing may be written when the store is invalid');
});

// ── 7. Raw LED strands are NOT in Mechanism A's scope (design §2.9) ───────

test('a store entry naming a raw LED strand is inert at export (extension, not slice 1)', () => {
  resetWorld();
  params.ledStrands = [{ name: 'Hull', ledCount: 5,
    startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 4 }];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];
  const before = captureModelBody(() => saveModelJS());

  resetWorld();
  params.ledStrands = [{ name: 'Hull', ledCount: 5,
    startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 4 }];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];
  params.pixelOrder = { Hull: 'reversed' };
  // Manually-placed strands are flipped in 3D directly (operator ruling); the
  // strand read site is a documented EXTENSION, so the entry does nothing here
  // and surfaces as a stale entry in the validation pass instead.
  assert.equal(captureModelBody(() => saveModelJS()), before);
});

// ── 8. Export → persist → reload → export survives the round trip ─────────

test('a REVERSED flag survives save → YAML → load and re-exports identically', () => {
  resetWorld();
  oneBar();
  params.pixelOrder = { 'Bar Left': 'reversed' };
  const first = captureModelBody(() => saveModelJS());

  // Persist exactly as the scene save does, reload it, and re-export.
  const tree = {};
  reconstructYAML(tree);
  const yamlStr = yaml.dump(tree);
  assert.match(yamlStr, /pixelOrder:\n\s+Bar Left: reversed/);

  resetWorld();
  oneBar();
  extractParams(yaml.load(yamlStr));
  assert.deepEqual(params.pixelOrder, { 'Bar Left': 'reversed' });
  assert.equal(captureModelBody(() => saveModelJS()), first);
});
