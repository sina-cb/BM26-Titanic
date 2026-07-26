/**
 * Tests for the DMX last-layer output gate on the RENDERED color — the twin of
 * the universe-buffer gate (applyFixtureOutputOverrides) that makes a DMX group
 * master real on the paths that read the RAW _batchRenderList entry: the global
 * V2 instanced-dot flush, the 2D Pixel Map, and (while nothing is patched) the
 * direct-painted fixture bulbs. Report 20260724_40.
 *
 * Two halves:
 *   1. the pure math + keying (dmxOutputScale / applyDmxEntryOutputGate), incl.
 *      a parity check that the entry gate and the buffer gate can NEVER disagree;
 *   2. the exporter join — every DMX pixel must carry the LIVE fixture config
 *      (`fixtureConfig`) the buffer gate reads, and it must stay runtime-only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  dmxOutputScale,
  applyDmxEntryOutputGate,
  applyFixtureOutputOverrides,
} from '../src/dmx/dmx_output_overrides.js';
import { params } from '../src/core/state.js';
import { generatePixelMap, saveModelJS } from '../src/dmx/pixelblaze_model_exporter.js';

const entry = (over = {}) => ({ r: 1, g: 0.5, b: 0.25, w: 0.8, a: 0.4, u: 0.2, ...over });

// ── dmxOutputScale: the ONE authority ────────────────────────────────────

test('full-on fixture in a full-on group scales by exactly 1 (no-op)', () => {
  assert.equal(dmxOutputScale({ enabled: true, brightness: 100, group: 'A' },
    { A: { enabled: true, brightness: 100 } }), 1);
  assert.equal(dmxOutputScale({ group: 'A' }, {}), 1, 'missing fields default to on/100');
  assert.equal(dmxOutputScale({ group: 'A' }, null), 1, 'no overrides map at all');
});

test('group Off and fixture Off both scale to 0', () => {
  assert.equal(dmxOutputScale({ enabled: true, group: 'A' }, { A: { enabled: false } }), 0);
  assert.equal(dmxOutputScale({ enabled: false, group: 'A' }, { A: { enabled: true } }), 0);
});

test('brightness scales linearly, group winning over fixture', () => {
  assert.equal(dmxOutputScale({ brightness: 100, group: 'A' }, { A: { brightness: 40 } }), 0.4);
  // Group at its 100 % passthrough → the fixture's own brightness applies.
  assert.equal(dmxOutputScale({ brightness: 50, group: 'A' }, { A: { brightness: 100 } }), 0.5);
  // Group set → the group wins even over a lower fixture value.
  assert.equal(dmxOutputScale({ brightness: 10, group: 'A' }, { A: { brightness: 60 } }), 0.6);
  assert.equal(dmxOutputScale({ brightness: 0, group: 'A' }, {}), 0);
});

test('out-of-range brightness is clamped to 0..1', () => {
  assert.equal(dmxOutputScale({ brightness: 400, group: 'A' }, {}), 1);
  assert.equal(dmxOutputScale({ brightness: -50, group: 'A' }, {}), 0);
});

test('a null config scales by 1 — the caller must report the missing join', () => {
  // Never invent an override for a pixel we cannot resolve; animate.js logs the
  // orphan loudly instead (codex P0: no silent fallbacks, but no silent gate
  // either — a wrong blackout would be just as bad as a missed one).
  assert.equal(dmxOutputScale(null, { A: { enabled: false } }), 1);
  assert.equal(dmxOutputScale(undefined, {}), 1);
});

// ── The keying trap: the gate must key EXACTLY like the buffer gate ───────

test('an ungrouped config ignores group overrides — same as the buffer gate', () => {
  // resolveGroupOverride treats a falsy group name as "no group entry". A gate
  // that instead bucketed '' into a 'Default'/'Ungrouped' key would black out
  // fixtures the wire keeps lit (the LED keying trap of report 20260724_27).
  // The GUI is what normalises a par config's group to 'Default'; the gate must
  // NOT second-guess it.
  assert.equal(dmxOutputScale({ group: '' }, { Default: { enabled: false } }), 1);
  assert.equal(dmxOutputScale({}, { Default: { enabled: false } }), 1);
  // …and once the GUI has normalised it, the master bites.
  assert.equal(dmxOutputScale({ group: 'Default' }, { Default: { enabled: false } }), 0);
});

test('entry gate and universe-buffer gate never disagree (one authority)', () => {
  const combos = [
    [{ enabled: true, brightness: 100 }, { enabled: true, brightness: 100 }],
    [{ enabled: true, brightness: 100 }, { enabled: false, brightness: 100 }],
    [{ enabled: false, brightness: 100 }, { enabled: true, brightness: 100 }],
    [{ enabled: true, brightness: 80 }, { enabled: true, brightness: 100 }],
    [{ enabled: true, brightness: 80 }, { enabled: true, brightness: 60 }],
    [{ enabled: true, brightness: 100 }, { enabled: true, brightness: 25 }],
    [{ enabled: true, brightness: 100 }, { enabled: true, brightness: 0 }],
  ];
  for (const [fixture, group] of combos) {
    const config = { ...fixture, group: 'A', dmxUniverse: 1, dmxAddress: 1 };
    const frame = new Uint8Array(512).fill(200);
    const router = { getFullFrame: (u) => (u === 1 ? frame : null) };
    applyFixtureOutputOverrides(router, [[{
      config,
      fixtureDef: { footprint: 3, pixels: [{ channels: { red: 1, green: 2, blue: 3 } }] },
    }]], { A: group });

    const scale = dmxOutputScale(config, { A: group });
    const wire = frame[0];
    const expected = scale === 0 ? 0 : Math.round(200 * scale);
    assert.equal(wire, expected,
      `wire byte ${wire} vs entry scale ${scale} for ${JSON.stringify({ fixture, group })}`);
  }
});

// ── applyDmxEntryOutputGate: in-place RGBWAU ─────────────────────────────

test('group Off zeroes every RGBWAU lane', () => {
  const e = entry({ fixtureConfig: { group: 'A' } });
  assert.equal(applyDmxEntryOutputGate(e, { A: { enabled: false } }), 0);
  assert.deepEqual([e.r, e.g, e.b, e.w, e.a, e.u], [0, 0, 0, 0, 0, 0]);
});

test('brightness scales every RGBWAU lane by the same factor', () => {
  const e = entry({ fixtureConfig: { group: 'A' } });
  assert.equal(applyDmxEntryOutputGate(e, { A: { brightness: 40 } }), 0.4);
  assert.deepEqual([e.r, e.g, e.b, e.w, e.a, e.u].map((v) => +v.toFixed(6)),
    [0.4, 0.2, 0.1, 0.32, 0.16, 0.08]);
});

test('a full-on entry is left byte-identical (zero behavior change)', () => {
  const e = entry({ fixtureConfig: { group: 'A', enabled: true, brightness: 100 } });
  const before = { ...e };
  assert.equal(applyDmxEntryOutputGate(e, { A: { enabled: true, brightness: 100 } }), 1);
  assert.deepEqual({ ...e }, before);
});

test('an entry with no fixtureConfig is left untouched', () => {
  const e = entry();
  const before = { ...e };
  assert.equal(applyDmxEntryOutputGate(e, { A: { enabled: false } }), 1);
  assert.deepEqual({ ...e }, before);
});

test('gating is idempotent per frame — repeated Off stays 0, not NaN', () => {
  const e = entry({ fixtureConfig: { group: 'A' } });
  applyDmxEntryOutputGate(e, { A: { enabled: false } });
  applyDmxEntryOutputGate(e, { A: { enabled: false } });
  assert.deepEqual([e.r, e.g, e.b, e.w, e.a, e.u], [0, 0, 0, 0, 0, 0]);
});

// ── Exporter join: every DMX pixel carries the LIVE config object ────────

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

function multiPixelFixture(config, nPixels) {
  const group = new THREE.Group();
  group.updateMatrixWorld(true);
  return {
    config,
    group,
    fixtureDef: { footprint: 18, channels: { red: 1, green: 2, blue: 3 } },
    pixels: Array.from({ length: nPixels }, (_, k) => ({
      localPos: new THREE.Vector3(k, 0, 0),
      model: { id: `p${k}`, channels: { red: 1, green: 2, blue: 3 }, size: 14 },
    })),
    setPixelColorRGB() {},
  };
}

function simpleFixture(config) {
  const group = new THREE.Group();
  group.updateMatrixWorld(true);
  return {
    config,
    group,
    light: {},
    fixtureDef: { footprint: 3, channels: { red: 1, green: 2, blue: 3 } },
    setPixelColorRGB() {},
  };
}

test('multi-pixel DMX pixels carry the SAME live config object as the runtime', () => {
  resetWorld();
  const bar = { name: 'Bar', type: 'ShehdsBar', group: 'G', dmxUniverse: 1, dmxAddress: 1 };
  params.dmxFixtures = [bar];
  const runtime = multiPixelFixture(bar, 3);
  window.parFixtures = [runtime];

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 3);
  for (const p of pixels) {
    // Identity, not a copy: applyFixtureOutputOverrides reads `fixture.config`,
    // so sharing the object is what guarantees the two gates key identically.
    assert.equal(p.fixtureConfig, bar);
    assert.equal(p.fixtureConfig, runtime.config);
  }
  // A live group-name edit is visible to the gate with no re-export.
  bar.group = 'Renamed';
  assert.equal(dmxOutputScale(pixels[0].fixtureConfig, { Renamed: { enabled: false } }), 0);
});

test('single-pixel (simple) DMX fixtures carry it too', () => {
  resetWorld();
  const par = { name: 'Par', type: 'UkingPar', group: 'G', dmxUniverse: 2, dmxAddress: 1 };
  params.dmxFixtures = [par];
  window.parFixtures = [simpleFixture(par)];

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 1);
  assert.equal(pixels[0].fixtureConfig, par);
});

test('LED strand pixels do NOT carry fixtureConfig (LED has its own gate)', () => {
  resetWorld();
  params.ledStrands = [{
    name: 'S1', ledCount: 2, group: '',
    startX: 0, startY: 0, startZ: 0, endX: 1, endY: 0, endZ: 0,
  }];
  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 2);
  for (const p of pixels) {
    assert.equal(p.type, 'led');
    assert.equal(p.fixtureConfig, undefined,
      'LED strands are governed by ledOutputScale, never the DMX group master');
    assert.equal(p.displayGroup, 'Ungrouped');
  }
});

test('fixtureConfig is runtime-only — never serialized into the engine model', () => {
  resetWorld();
  const bar = { name: 'Bar', type: 'ShehdsBar', group: 'G', dmxUniverse: 1, dmxAddress: 1 };
  params.dmxFixtures = [bar];
  window.parFixtures = [multiPixelFixture(bar, 2)];
  window.serverConfig = { save_port: 6970 };
  window.location = { protocol: 'http:', hostname: '127.0.0.1' };
  window.__viewRegistry = null;
  window.__activeScene = 'unit_test';

  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => { bodies.push(String(opts.body)); return Promise.resolve(); };
  try {
    saveModelJS();
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(bodies.length > 0, 'the model POST fired');
  const modelJS = bodies[0];
  assert.ok(modelJS.includes("type: 'dmx'"), 'sanity: the model has the dmx pixels');
  assert.ok(!modelJS.includes('fixtureConfig'),
    'a live config object must never leak into the generated engine model');
});
