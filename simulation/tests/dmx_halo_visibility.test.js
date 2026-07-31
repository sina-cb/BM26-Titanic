/**
 * dmx_halo_visibility.test.js — every DMX fixture's halo is actually a RIM.
 *
 * Operator: "make sure all DMX fixtures have the halo, if it's not hurting
 * performance." They always had one in the scene graph — `haloInst` is built
 * for every fixture type (led_halo_parity.test.js pins that) — but it was sized
 * `physicalBulb × 1.8 × globalHaloScale` while the bulb it rims was sized
 * `physicalBulb × modelScale × globalPixelScale`. Two different sliders on the
 * two radii, so the "rim" sank INSIDE its own opaque core whenever
 * `haloScale < pixelScale / 1.8`. At the operator's own settings (Global Pixel
 * Size 1.1, Global Halo Size 0.6) a par's halo was 0.98× its bulb — drawn every
 * frame, invisible in every frame. Model-scaling a fixture made it strictly
 * worse: the bulb grew, the rim did not.
 *
 * The rule pinned here: a DMX halo is a rim MULTIPLE of the bulb as DRAWN
 * (`dmxHaloRimMultiple`), so it is outside the core at every setting, for every
 * type, at every model scale — while still answering to the same single global
 * halo control, and still bounded by the pixel-spacing ceiling so a dense bar
 * cannot smear into a featureless strip. LED-bus halos are untouched.
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

const FOG_TYPES = new Set(['TEFogMachine', 'ChauvetHaze4D']);

// The operator's live settings, plus the extremes of both sliders. The first
// pair is the case that was broken in his window.
const SLIDER_CASES = [
  { pixel: 1.1, halo: 0.6, label: "the operator's current settings" },
  { pixel: 1.0, halo: 1.0, label: 'the shipped defaults' },
  { pixel: 5, halo: 0.1, label: 'max pixels, minimum halo — the worst case for a rim' },
  { pixel: 0.1, halo: 5, label: 'minimum pixels, max halo' },
  { pixel: 5, halo: 4.7, label: 'both sliders at the scene maximum' },
];

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
const { dmxHaloRimMultiple, HALO_RIM_FACTOR, MAX_HALO_PITCH_MULTIPLE, ledHaloRadius } =
  await import('../src/fixtures/led_halo.js');
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
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return scale.x;
}

function buildFixture(fixtureDef) {
  return new DmxFixtureRuntime(
    {
      name: `${fixtureDef.fixtureType} test`,
      fixtureType: fixtureDef.fixtureType,
      color: '#ffffff',
      x: 0, y: 2, z: 0,
      enabled: true,
      brightness: 100,
    },
    0, new THREE.Scene(), [], 50, fixtureDef, null
  );
}

let previousProfile;
let previousPixelScale;
let previousHaloScale;
before(() => {
  previousProfile = params.lightingProfile;
  previousPixelScale = params.globalPixelScale;
  previousHaloScale = params.globalHaloScale;
  params.lightingProfile = 'full';
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = previousProfile;
  params.globalPixelScale = previousPixelScale;
  params.globalHaloScale = previousHaloScale;
});

test('dmxHaloRimMultiple is always a rim (>= 1) and fails loudly on garbage', () => {
  assert.equal(dmxHaloRimMultiple(0), 1, 'halo off ⇒ the rim collapses onto the bulb, never inside it');
  assert.equal(dmxHaloRimMultiple(1), HALO_RIM_FACTOR, 'at the default the rim is the historical 1.8×');
  assert.ok(dmxHaloRimMultiple(0.6) > 1.4, 'the operator’s 0.6 must still give a clearly visible rim');
  assert.ok(dmxHaloRimMultiple(4.7) > dmxHaloRimMultiple(1), 'the slider still grows the halo');
  assert.throws(() => dmxHaloRimMultiple(NaN), /haloScale/);
  assert.throws(() => dmxHaloRimMultiple(-1), /haloScale/);
});

test('EVERY DMX fixture draws a halo strictly OUTSIDE its bulb, at every slider setting', () => {
  let checked = 0;
  for (const def of Object.values(getAllDefinitions())) {
    if (FOG_TYPES.has(def.fixtureType)) continue;
    if (def.bus === 'led') continue; // LED-bus halos are the shared absolute radius
    for (const { pixel, halo, label } of SLIDER_CASES) {
      params.globalPixelScale = pixel;
      params.globalHaloScale = halo;
      const fixture = buildFixture(def);
      for (let i = 0; i < fixture.pixels.length; i++) {
        const bulb = instanceScale(fixture.bulbInst, i);
        const rim = instanceScale(fixture.haloInst, i);
        assert.ok(rim >= bulb * (1 - 1e-6),
          `${def.fixtureType} pixel ${i}: halo ${rim} is INSIDE its bulb ${bulb} at ${label} — ` +
          'the fixture renders with no visible halo');
      }
      checked++;
      fixture.destroy();
    }
  }
  assert.ok(checked >= 9, `expected every DMX type swept at every setting, got ${checked}`);
});

test("the regression: at the operator's own settings a par's halo used to hide inside its bulb", () => {
  // The exact numbers from his window. Old rule: physicalBulb × 1.8 × haloScale
  // = 0.039 × 1.8 × 0.6 = 0.0421, against a bulb of 0.039 × 1.1 = 0.0429.
  const OLD_PAR_HALO = 0.039 * HALO_RIM_FACTOR * 0.6;
  const OLD_PAR_BULB = 0.039 * 1.1;
  assert.ok(OLD_PAR_HALO < OLD_PAR_BULB,
    'sanity: the old rule really did put the par halo inside its bulb');

  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  const fixture = buildFixture(getAllDefinitions().UkingPar);
  const bulb = instanceScale(fixture.bulbInst, 0);
  const rim = instanceScale(fixture.haloInst, 0);
  assert.ok(rim > bulb * 1.4,
    `the par halo (${rim}) must now stand clearly outside its bulb (${bulb})`);
  fixture.destroy();
});

test('a dense DMX fixture still cannot smear without limit', () => {
  // The other half of 20260725_53: bounded by a pixel-spacing ceiling. The
  // ceiling is now the HALO's own (MAX_HALO_PITCH_MULTIPLE), not the opaque
  // bulb's — see 20260725_75. Sharing the bulb's ceiling pinned the rim at
  // exactly HALO_RIM_FACTOR as soon as the bulb hit its own cap, which is what
  // made the global halo knob dead above haloScale 1.0 on every multi-pixel DMX
  // fixture. Additive rims are allowed to overlap (the LED strands already do);
  // the bound is still real, it just no longer bites before the knob has moved.
  params.globalPixelScale = 5;
  params.globalHaloScale = 4.7;
  const fixture = buildFixture(getAllDefinitions().ShehdsBar);
  const pitch = fixture._minPixelPitch;
  assert.ok(pitch > 0, 'the bar must measure a pixel pitch');
  for (let i = 0; i < fixture.pixels.length; i++) {
    const rim = instanceScale(fixture.haloInst, i);
    assert.ok(rim <= pitch * MAX_HALO_PITCH_MULTIPLE * (1 + 1e-6),
      `bar pixel ${i} halo ${rim} exceeds the halo pitch ceiling`);
  }
  fixture.destroy();
});

test('LED-bus halos are untouched — still the one shared radius', () => {
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  let checked = 0;
  for (const def of Object.values(getAllDefinitions())) {
    if (def.bus !== 'led') continue;
    const fixture = buildFixture(def);
    for (let i = 0; i < fixture.pixels.length; i++) {
      assert.ok(Math.abs(instanceScale(fixture.haloInst, i) - ledHaloRadius()) < 1e-6,
        `${def.fixtureType} pixel ${i} halo must stay on the shared LED halo radius`);
    }
    checked++;
    fixture.destroy();
  }
  assert.ok(checked >= 2, `expected the LED-bus types to be swept, got ${checked}`);
});

test('perf P0: making halos visible added NO scene-graph objects', () => {
  // The operator's gate is frames. The halo is the same single InstancedMesh it
  // always was — only the radii in its matrix buffer changed — so there is
  // nothing here that can grow the object count.
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  for (const def of Object.values(getAllDefinitions())) {
    if (FOG_TYPES.has(def.fixtureType)) continue;
    const fixture = buildFixture(def);
    assert.ok(fixture.haloInst.isInstancedMesh, `${def.fixtureType} halo must stay instanced`);
    assert.equal(fixture.haloInst.count, fixture.pixels.length);
    const haloObjects = fixture.group.children.filter((c) => c === fixture.haloInst).length;
    assert.equal(haloObjects, 1, `${def.fixtureType} must carry exactly ONE halo object`);
    fixture.destroy();
  }
});
