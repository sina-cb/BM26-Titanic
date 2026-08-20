/**
 * Tests the S1 strand-cluster fix in pixelblaze_model_exporter.js: every LED
 * strand pixel now carries runtime-only `fixIndex` (continuing the DMX cluster-
 * index space) and `fixKey` (the strand name), so the 2D Pixel Map clusters
 * strands PER STRAND instead of collapsing all of them into one mega-cluster
 * (report 20260724_9 §1.3).
 *
 * The load-bearing guarantee: those fields are runtime-only and are NOT
 * serialized by saveModelJS, so the exported engine model is BYTE-IDENTICAL to
 * before the change. Proven here by reconstructing the serialized `pixels`
 * block independently and asserting the captured save body matches it exactly,
 * plus that neither `fixIndex` nor `fixKey` appears anywhere in the model.
 *
 * `generatePixelMap`/`saveModelJS` read browser-ish globals; we mock the
 * minimum (THREE math + plain objects, a fetch stub, a serverConfig).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { params } from '../src/core/state.js';
import { generatePixelMap, saveModelJS } from '../src/dmx/pixelblaze_model_exporter.js';

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
}

// A multi-pixel DMX bar fixture.
function mkBar(config, nPixels) {
  return {
    config,
    group: makeGroup(),
    fixtureDef: { footprint: 18, channels: { red: 1, green: 2, blue: 3 } },
    pixels: Array.from({ length: nPixels }, (_, k) => ({
      localPos: new THREE.Vector3(k, 0, 0),
      model: { id: `pixel_${k + 1}`, channels: { red: 1, green: 2, blue: 3 }, size: 14 },
    })),
    setPixelColorRGB() {},
  };
}

// Re-implements saveModelJS's exact per-pixel serialization so the test locks
// the model format: if the exporter ever starts serializing a NEW field (e.g.
// the runtime fixIndex/fixKey leaking in), this reconstruction diverges and the
// test fails loudly. Must stay in lockstep with saveModelJS.
function serializePixelsBlock(pixels) {
  const lines = ['export const pixels = ['];
  pixels.forEach((p, i) => {
    let patchStr = 'null';
    if (p.patch) {
      patchStr = `{ universe: ${p.patch.universe}, addr: ${p.patch.addr}, ` +
        `footprint: ${p.patch.footprint}${p.patch.led ? ', led: true' : ''} }`;
    }
    const chStr = p.channels ? JSON.stringify(p.channels) : 'null';
    const extra = (p.type === 'led')
      ? `, whiteMode: '${p.whiteMode || 'native'}'${p.unpatched ? ', unpatched: true' : ''}`
      : '';
    lines.push(`  { i: ${i}, type: '${p.type}', fixtureType: '${p.fixtureType || ''}', ` +
      `name: '${p.name}', group: '${p.group}', x: ${p.x}, y: ${p.y}, z: ${p.z}, ` +
      `nx: ${p.nx}, ny: ${p.ny}, nz: ${p.nz}, cId: ${p.cId || 0}, sId: ${p.sId || 0}, ` +
      `fId: ${p.fId || 0}, localIndex: ${p.localIndex || 0}, vMask: ${p.vMask || 0}, ` +
      `patch: ${patchStr}, channels: ${chStr}${extra} },`);
  });
  lines.push('];');
  return lines.join('\n');
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
  return model.body;
}

// ── The strand cluster keys ───────────────────────────────────────────────

test('LED strand pixels carry fixIndex (continuing DMX space) + fixKey = strand name', () => {
  resetWorld();
  // Two DMX bars → DMX cluster indices 0,1. Two strands → indices 2,3.
  const barA = { name: 'Bar A', type: 'ShehdsBar', dmxUniverse: 1, dmxAddress: 1 };
  const barB = { name: 'Bar B', type: 'ShehdsBar', dmxUniverse: 1, dmxAddress: 50 };
  params.dmxFixtures = [barA, barB];
  window.parFixtures = [mkBar(barA, 3), mkBar(barB, 2)];

  const strandL = { name: 'Left_Hull', ledCount: 4, startX: -5, startY: 0, startZ: 0,
    endX: -5, endY: 0, endZ: 3 };
  const strandR = { name: 'Right_Hull', ledCount: 3, startX: 5, startY: 0, startZ: 0,
    endX: 5, endY: 0, endZ: 2 };
  params.ledStrands = [strandL, strandR];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }, { setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();

  const dmx = pixels.filter((p) => p.type === 'dmx');
  const led = pixels.filter((p) => p.type === 'led');
  assert.equal(dmx.length, 5);
  assert.equal(led.length, 7);

  // DMX clusters unchanged: bars at fixIndex 0 and 1.
  assert.deepEqual([...new Set(dmx.map((p) => p.fixIndex))], [0, 1]);

  // Strands continue the space: Left_Hull → 2, Right_Hull → 3, each its OWN key.
  const leftPx = led.filter((p) => p.name === 'Left_Hull');
  const rightPx = led.filter((p) => p.name === 'Right_Hull');
  assert.ok(leftPx.every((p) => p.fixIndex === 2 && p.fixKey === 'Left_Hull'));
  assert.ok(rightPx.every((p) => p.fixIndex === 3 && p.fixKey === 'Right_Hull'));

  // Two distinct strand fixKeys → two clusters (not one collapsed mega-cluster).
  assert.deepEqual([...new Set(led.map((p) => p.fixKey))].sort(), ['Left_Hull', 'Right_Hull']);
});

test('strand fixIndex base is dmxFixtures.length even when some DMX slots are empty', () => {
  resetWorld();
  // 3 DMX config entries but only 2 resolve to fixtures; the 3rd still consumes
  // a cluster-index slot, so the strand must start at 3 (length), never at 2.
  const barA = { name: 'Bar A', type: 'ShehdsBar', dmxUniverse: 1, dmxAddress: 1 };
  const barB = { name: 'Bar B', type: 'ShehdsBar', dmxUniverse: 1, dmxAddress: 50 };
  const barGhost = { name: 'Ghost', type: 'ShehdsBar' }; // no runtime fixture built
  params.dmxFixtures = [barA, barB, barGhost];
  window.parFixtures = [mkBar(barA, 2), mkBar(barB, 2), null];

  const strand = { name: 'Strand', ledCount: 2, startX: 0, startY: 0, startZ: 0,
    endX: 0, endY: 0, endZ: 1 };
  params.ledStrands = [strand];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  const led = pixels.filter((p) => p.type === 'led');
  assert.ok(led.every((p) => p.fixIndex === 3), 'strand starts at dmxFixtures.length (3), not 2');
});

// ── Byte-identity of the serialized model ─────────────────────────────────

test('saveModelJS model is byte-identical: strand fixIndex/fixKey never serialize', () => {
  resetWorld();
  const barA = { name: 'Bar A', type: 'ShehdsBar', dmxUniverse: 1, dmxAddress: 1 };
  params.dmxFixtures = [barA];
  window.parFixtures = [mkBar(barA, 3)];
  const strand = { name: 'Left_Hull', ledCount: 4, startX: -5, startY: 0, startZ: 0,
    endX: -5, endY: 0, endZ: 3 };
  params.ledStrands = [strand];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const body = captureModelBody(() => saveModelJS());

  // 1) The runtime cluster keys must NOT appear anywhere in the exported model.
  assert.ok(!body.includes('fixIndex'), 'fixIndex is runtime-only, never serialized');
  assert.ok(!body.includes('fixKey'), 'fixKey is runtime-only, never serialized');

  // 2) Strand pixels still serialize an EMPTY fixtureType (unchanged) — the
  //    cluster type 'LedStrand' is derived downstream, never stamped on the model.
  const strandLine = body.split('\n').find((l) => l.includes("name: 'Left_Hull'"));
  assert.ok(strandLine, 'the strand pixel serialized a line');
  assert.ok(strandLine.includes("fixtureType: ''"), 'strand fixtureType stays empty in the model');

  // 3) The whole serialized pixels block equals an independent reconstruction —
  //    the rigorous byte-identity lock.
  const { pixels } = generatePixelMap();
  const start = body.indexOf('export const pixels = [');
  const end = body.indexOf('\n];', start);
  assert.ok(start >= 0 && end > start, 'model has a pixels block');
  const block = body.slice(start, end + '\n];'.length);
  assert.equal(block, serializePixelsBlock(pixels));
});
