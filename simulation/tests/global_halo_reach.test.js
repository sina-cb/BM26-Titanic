/**
 * global_halo_reach.test.js — "Global Halo Size" is ONE knob for EVERY bus.
 *
 * Operator (2026-07-30): *"The halo size parameter only affects the TE sign
 * lights, no LED strands, none of the DMX lights."* Follow-up: *"please make
 * sure that's a global for-all-fixtures parameter."*
 *
 * A live readonly probe of his running sim (report 20260725_75) measured, at his
 * own settings (Global Pixel Size 1.9, Global Halo Size 1.4), dragging the knob
 * 0.1 → 5:
 *
 *   TE Sign  0.014 → 0.700   (moves — the one class he could see)
 *   UKing par 0.240 → 1.112  (moves; single pixel, no ceiling)
 *   Vintage  0.0608 → 0.101  (**pinned from haloScale 1.0 up**)
 *   Shehds bar 0.0178 → 0.0297 (**pinned from haloScale 1.0 up**)
 *   LED strand 0.196 → 0.196 (**completely dead**)
 *
 * Two independent defects:
 *   1. REACH — the `globalHaloScale` GUI handler iterated parFixtures +
 *      dmxSceneFixtures only. LED strands are a separate list with a separate
 *      re-render entry point (`applyVisualSize`), so their halo radius
 *      (`ledHaloSize × globalHaloScale`) was frozen at whatever the slider read
 *      when the strand was built.
 *   2. CEILING — a DMX halo was bounded by the OPAQUE BULB's pitch ceiling.
 *      A multi-pixel fixture's bulb sits AT that ceiling (0.3 × pitch) at any
 *      normal pixel size, so the halo collapsed to exactly
 *      `bulbCeiling × HALO_RIM_FACTOR` and stopped answering the knob. The halo
 *      now has its own, looser ceiling (MAX_HALO_PITCH_MULTIPLE = 1.5 × pitch),
 *      derived as `MAX_BULB_PITCH_FRACTION × maxRim` = 0.3 × 5.0 — the smallest
 *      bound that lets the knob reach its top end at all.
 *
 * Pinned here: every class MOVES across the knob's range, and where a ceiling
 * legitimately binds it is a stated, tested number rather than a silent stall.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'dmx', 'fixtures');

// The operator's live working point, read off his running sim.
const HIS_PIXEL_SCALE = 1.9;
const HIS_HALO_SCALE = 1.4;

const FOG_TYPES = new Set(['TEFogMachine', 'ChauvetHaze4D']);

function makeCanvasStub() {
  return {
    width: 0,
    height: 0,
    getContext() {
      return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {},
      };
    },
  };
}
globalThis.window = globalThis.window || globalThis;
globalThis.window._patchesActive = false;
globalThis.document = globalThis.document || { createElement: (tag) => (tag === 'canvas' ? makeCanvasStub() : {}) };

const { DmxFixtureRuntime } = await import('../src/fixtures/dmx_fixture_runtime.js');
const { LedStrand } = await import('../src/fixtures/led_strand.js');
const {
  clampHaloRadiusToPitch, dmxHaloRimMultiple, ledHaloRadius,
  MAX_HALO_PITCH_MULTIPLE, MAX_BULB_PITCH_FRACTION, HALO_RIM_FACTOR,
} = await import('../src/fixtures/led_halo.js');
const { params } = await import('../src/core/state.js');
const { initRegistry, getAllDefinitions } = await import('../src/dmx/fixture_definition_registry.js');

function loadAllFixtureModels() {
  const models = {};
  for (const dir of fs.readdirSync(FIXTURE_DIR)) {
    const dirPath = path.join(FIXTURE_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.yaml')) continue;
      const parsed = yaml.load(fs.readFileSync(path.join(dirPath, file), 'utf8'));
      if (parsed && parsed.model && parsed.model.fixture_type) {
        models[parsed.model.fixture_type] = parsed.model;
      }
    }
  }
  return models;
}

function instanceScale(mesh, index = 0) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const scale = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale.x;
}

function buildDmx(fixtureDef) {
  return new DmxFixtureRuntime({
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffffff', x: 0, y: 2, z: 0, enabled: true, brightness: 100,
  }, 0, new THREE.Scene(), [], 50, fixtureDef, null);
}

function buildStrand() {
  // A titanic-like run: 40 LEDs over 11 m ⇒ ~0.28 pitch, the spacing led_halo
  // cites as the reference look.
  return new LedStrand({
    name: 'Probe strand', ledCount: 40, color: '#ffffff',
    startX: 0, startY: 3, startZ: 0, endX: 0, endY: 3, endZ: 11,
  }, 0, new THREE.Scene(), []);
}

// THE update path the GUI's globalHaloScale handler runs, replayed exactly:
// DMX + LED-bus fixtures take updateScales; LED strands take applyVisualSize.
function moveGlobalHaloKnob(v, { dmx = [], strands = [] }) {
  params.globalHaloScale = v;
  dmx.forEach((f) => f.updateScales(params.globalPixelScale || 1.0, v));
  strands.forEach((f) => f.applyVisualSize());
}

let saved;
before(() => {
  saved = {
    profile: params.lightingProfile,
    pixel: params.globalPixelScale,
    halo: params.globalHaloScale,
    ledPixel: params.ledPixelSize,
    ledHalo: params.ledHaloSize,
  };
  params.lightingProfile = 'full'; // the profile that builds every pixel's emitter
  params.ledPixelSize = 0.08;      // the shipped LED defaults
  params.ledHaloSize = 0.14;
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = saved.profile;
  params.globalPixelScale = saved.pixel;
  params.globalHaloScale = saved.halo;
  params.ledPixelSize = saved.ledPixel;
  params.ledHaloSize = saved.ledHalo;
});

// ── The headline: every bus moves ─────────────────────────────────────────

test('GLOBAL: every fixture class\'s halo moves when the one knob moves', () => {
  params.globalPixelScale = HIS_PIXEL_SCALE;
  params.globalHaloScale = HIS_HALO_SCALE;
  const defs = getAllDefinitions();

  // One fixture of every registered class that renders a halo, plus a strand.
  const dmx = Object.values(defs)
    .filter((d) => !FOG_TYPES.has(d.fixtureType))
    .map(buildDmx);
  const strands = [buildStrand()];
  assert.ok(dmx.length >= 4, `expected the full fixture set, got ${dmx.length}`);

  const read = () => [
    ...dmx.map((f) => ({
      cls: `${f._isLed ? 'led-bus' : 'dmx'}:${f.fixtureDef.fixtureType}`,
      halo: instanceScale(f.haloInst, 0),
    })),
    ...strands.map((f) => ({ cls: 'strand', halo: instanceScale(f.haloInst, 0) })),
  ];

  moveGlobalHaloKnob(0.1, { dmx, strands });
  const low = read();
  moveGlobalHaloKnob(5, { dmx, strands });
  const high = read();

  for (let i = 0; i < low.length; i++) {
    assert.equal(low[i].cls, high[i].cls);
    assert.ok(high[i].halo > low[i].halo * 1.2,
      `${low[i].cls}: the global halo knob is DEAD — ${low[i].halo} → ${high[i].halo} ` +
      'across the whole slider (0.1 → 5)');
  }

  // And it tracks continuously, not just at the ends — no dead upper half.
  moveGlobalHaloKnob(1, { dmx, strands });
  const mid = read();
  for (let i = 0; i < mid.length; i++) {
    assert.ok(mid[i].halo > low[i].halo && high[i].halo > mid[i].halo,
      `${mid[i].cls}: the knob stalls somewhere in its range ` +
      `(${low[i].halo} → ${mid[i].halo} → ${high[i].halo})`);
  }

  dmx.forEach((f) => f.destroy());
  strands.forEach((f) => f.destroy());
});

// ── Regression: the two specific defects ──────────────────────────────────

test('REACH: an LED strand tracks the global halo knob (it used to be frozen)', () => {
  params.globalPixelScale = HIS_PIXEL_SCALE;
  const strand = buildStrand();
  const bulbBefore = instanceScale(strand.bulbInst, 0);

  moveGlobalHaloKnob(0.5, { strands: [strand] });
  const lo = instanceScale(strand.haloInst, 0);
  moveGlobalHaloKnob(3, { strands: [strand] });
  const hi = instanceScale(strand.haloInst, 0);

  // The strand halo IS ledHaloRadius() — the shared LED recipe — at both ends.
  assert.ok(Math.abs(lo - 0.14 * 0.5) < 1e-6, `strand halo at 0.5 must be ${0.14 * 0.5}, got ${lo}`);
  assert.ok(Math.abs(hi - 0.14 * 3) < 1e-6, `strand halo at 3 must be ${0.14 * 3}, got ${hi}`);
  assert.ok(Math.abs(hi - ledHaloRadius(3)) < 1e-6, 'and it must be the ONE shared LED halo radius');

  // The halo knob must not disturb the strand's PIXEL size — that is a separate
  // control and a separate open question (Global Pixel Size cannot reach
  // strands; readiness decision item 11). This fix must not quietly change it.
  assert.equal(instanceScale(strand.bulbInst, 0), bulbBefore,
    'moving the halo knob must leave the strand bulb radius alone');
  strand.destroy();
});

test('CEILING: a multi-pixel DMX fixture is no longer pinned at bulbCeiling x 1.8', () => {
  // The vintage light at his own settings: its bulb sits AT the bulb ceiling,
  // which used to freeze the halo at exactly HALO_RIM_FACTOR from haloScale 1.0
  // upward. It must now keep climbing.
  params.globalPixelScale = HIS_PIXEL_SCALE;
  const fixture = buildDmx(getAllDefinitions().VintageLed);
  const pitch = fixture._minPixelPitch;
  const bulbCeiling = pitch * MAX_BULB_PITCH_FRACTION;
  assert.ok(Math.abs(instanceScale(fixture.bulbInst, 0) - bulbCeiling) < 1e-6,
    'precondition: at his pixel size the vintage bulb is AT its ceiling');

  const oldPin = bulbCeiling * HALO_RIM_FACTOR; // what the halo used to stall at
  for (const v of [1.4, 2.5, 5]) {
    moveGlobalHaloKnob(v, { dmx: [fixture] });
    const halo = instanceScale(fixture.haloInst, 0);
    assert.ok(halo > oldPin * (1 + 1e-6),
      `at haloScale ${v} the vintage halo ${halo} is still stuck at the old pin ${oldPin}`);
    assert.ok(halo <= pitch * MAX_HALO_PITCH_MULTIPLE * (1 + 1e-6),
      `at haloScale ${v} the vintage halo ${halo} escaped its own ceiling`);
    // Still a RIM: strictly outside the opaque core it surrounds (20260725_73).
    assert.ok(halo > instanceScale(fixture.bulbInst, 0),
      `at haloScale ${v} the vintage halo sank back inside its bulb`);
  }
  fixture.destroy();
});

test('the halo ceiling is loose enough for the knob to reach its top end', () => {
  // The derivation, stated as an assertion: a bulb at its own ceiling times the
  // maximum rim multiple must FIT under the halo ceiling, or the top of the
  // slider is unreachable for every multi-pixel fixture.
  const maxRim = dmxHaloRimMultiple(5);
  assert.ok(MAX_HALO_PITCH_MULTIPLE >= MAX_BULB_PITCH_FRACTION * maxRim - 1e-12,
    `the halo ceiling ${MAX_HALO_PITCH_MULTIPLE}× pitch is tighter than ` +
    `${MAX_BULB_PITCH_FRACTION} × ${maxRim} — the knob's top end is unreachable`);

  // It is still a real ceiling, and still a pass-through below it.
  assert.equal(clampHaloRadiusToPitch(0.01, 0.1), 0.01);
  assert.ok(Math.abs(clampHaloRadiusToPitch(99, 0.1) - 0.1 * MAX_HALO_PITCH_MULTIPLE) < 1e-12);
  assert.equal(clampHaloRadiusToPitch(0.5, 0), 0.5, 'a single-pixel fixture has no ceiling');
  assert.throws(() => clampHaloRadiusToPitch(NaN, 0.1), /radius/);
  assert.throws(() => clampHaloRadiusToPitch(0.1, -1), /pitch/);
});

test('a single-pixel par is uncapped and tracks the knob linearly', () => {
  params.globalPixelScale = HIS_PIXEL_SCALE;
  const fixture = buildDmx(getAllDefinitions().UkingPar);
  assert.equal(fixture._minPixelPitch, 0, 'a one-head fixture has no neighbour ⇒ no ceiling');
  const bulb = instanceScale(fixture.bulbInst, 0);
  for (const v of [0.1, 1.4, 5]) {
    moveGlobalHaloKnob(v, { dmx: [fixture] });
    assert.ok(Math.abs(instanceScale(fixture.haloInst, 0) - bulb * dmxHaloRimMultiple(v)) < 1e-5,
      `the par halo must be exactly the rim multiple at haloScale ${v}`);
  }
  fixture.destroy();
});
