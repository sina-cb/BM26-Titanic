/**
 * led_halo_parity.test.js — EVERY LED fixture abides by the halo settings.
 *
 * The bug this locks down: the TE Sign (an LED-bus fixture rendered by
 * DmxFixtureRuntime) built NO halo at all. Its render path swapped the instanced
 * additive rim for per-pixel diffusion Sprites that were (a) gated on the
 * per-fixture `diffusion` toggle and (b) sized from the pixel's PHYSICAL size
 * (12 mm), so next to an LED strand — whose halo is params.ledHaloSize ×
 * params.globalHaloScale — the sign read as bare dots.
 *
 * The rule these tests enforce is GENERAL, not TE-Sign-shaped:
 *   1. every fixture type in dmx/fixtures/ builds exactly one halo InstancedMesh
 *      (never per-pixel halo objects — the WebGPU object-count perf rule);
 *   2. every fixture on the LED bus resolves the SAME halo radius an LED strand
 *      does, from the same settings;
 *   3. the halo does not depend on the diffusion toggle.
 * A new LED product added to dmx/fixtures/ is covered the moment it lands,
 * because the sweep reads the shipped YAMLs rather than a hardcoded list.
 *
 * DmxFixtureRuntime is browser code: it reads `window._patchesActive` and, for
 * LED-bus fixtures, generates the diffusion sprite texture from a <canvas>.
 * Both are stubbed below — the geometry/material assertions are pure THREE.
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

// Fixture types the app hands to FogMachine, not DmxFixtureRuntime (fixtures.js).
const FOG_TYPES = new Set(['TEFogMachine', 'ChauvetHaze4D']);

// ── Browser stubs (installed before the modules under test are imported) ──
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
const { ledHaloRadius, LED_HALO_RADIUS, LED_HALO_OPACITY, isLedBusFixture } =
  await import('../src/fixtures/led_halo.js');
const { params } = await import('../src/core/state.js');
const { initRegistry, getAllDefinitions } = await import('../src/dmx/fixture_definition_registry.js');

// Load every shipped fixture model YAML into the definition registry — the same
// map main.js builds at boot.
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

// Uniform scale baked into an InstancedMesh instance matrix — the rendered
// radius, because every builder writes dummy.scale.setScalar(radius).
function instanceScale(mesh, index = 0) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return scale.x;
}

function buildFixture(fixtureDef, configOverrides = {}) {
  const scene = new THREE.Scene();
  const interactiveObjects = [];
  const config = Object.assign({
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffffff',
    x: 0, y: 2, z: 0,
    enabled: true,
    brightness: 100,
  }, configOverrides);
  const fixture = new DmxFixtureRuntime(config, 0, scene, interactiveObjects, 50, fixtureDef, null);
  return { fixture, scene, config };
}

function buildStrand() {
  const scene = new THREE.Scene();
  const interactiveObjects = [];
  return new LedStrand({
    name: 'LED_0',
    startX: -3, startY: 5, startZ: 0,
    endX: 3, endY: 5, endZ: 0,
    color: '#ffffff',
    ledCount: 8,
  }, 0, scene, interactiveObjects);
}

let previousProfile;
before(() => {
  previousProfile = params.lightingProfile;
  // 'full' renders every pixel's emitter — the profile the show runs in and the
  // only one where the halo is expected to exist at all.
  params.lightingProfile = 'full';
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = previousProfile;
});

test('the fixture registry actually loaded the shipped models (guards a silent empty sweep)', () => {
  const defs = getAllDefinitions();
  const types = Object.keys(defs);
  assert.ok(types.length >= 5, `expected the shipped fixture types, got ${types.join(', ') || '(none)'}`);
  assert.ok(types.includes('TeSignV3A40'), 'TE Sign Side A must be registered');
  assert.ok(types.includes('TeSignV3B34'), 'TE Sign Side B must be registered');
  assert.ok(Object.values(defs).some(isLedBusFixture), 'at least one LED-bus fixture must exist');
});

test('EVERY fixture type builds exactly one halo InstancedMesh (no fixture opts out)', () => {
  for (const def of Object.values(getAllDefinitions())) {
    if (FOG_TYPES.has(def.fixtureType)) continue;
    const { fixture } = buildFixture(def);
    assert.ok(fixture.haloInst && fixture.haloInst.isInstancedMesh,
      `${def.fixtureType} must build a halo InstancedMesh`);
    assert.equal(fixture.haloInst.count, fixture.pixels.length,
      `${def.fixtureType} halo instance count must equal its pixel count`);
    const haloMeshes = fixture.group.children.filter(
      (c) => c.isInstancedMesh && c.material && c.material.side === THREE.BackSide);
    assert.equal(haloMeshes.length, 1,
      `${def.fixtureType} must draw its halo as ONE instanced batch, not per pixel`);
    fixture.destroy();
  }
});

test('the halo material is the one shared additive BackSide recipe for every type', () => {
  for (const def of Object.values(getAllDefinitions())) {
    if (FOG_TYPES.has(def.fixtureType)) continue;
    const { fixture } = buildFixture(def);
    const mat = fixture.haloInst.material;
    assert.ok(mat.isMeshBasicMaterial, `${def.fixtureType} halo is MeshBasicMaterial`);
    assert.equal(mat.transparent, true, `${def.fixtureType} halo is transparent`);
    assert.equal(mat.blending, THREE.AdditiveBlending, `${def.fixtureType} halo is additive`);
    assert.equal(mat.depthWrite, false, `${def.fixtureType} halo does not write depth`);
    assert.equal(mat.side, THREE.BackSide, `${def.fixtureType} halo is a BackSide rim`);
    assert.equal(mat.opacity, LED_HALO_OPACITY, `${def.fixtureType} halo uses the shared opacity`);
    fixture.destroy();
  }
});

test('every LED-bus fixture renders the SAME halo radius as an LED strand', () => {
  const strand = buildStrand();
  const strandRadius = instanceScale(strand.haloInst);
  assert.ok(Math.abs(strandRadius - ledHaloRadius()) < 1e-6,
    'the strand halo radius is the settings-derived LED halo radius');

  let ledTypesChecked = 0;
  for (const def of Object.values(getAllDefinitions())) {
    if (!isLedBusFixture(def)) continue;
    const { fixture } = buildFixture(def);
    for (let i = 0; i < fixture.pixels.length; i++) {
      assert.ok(Math.abs(instanceScale(fixture.haloInst, i) - strandRadius) < 1e-6,
        `${def.fixtureType} pixel ${i} halo radius must match the LED strand halo radius`);
    }
    ledTypesChecked++;
    fixture.destroy();
  }
  assert.ok(ledTypesChecked >= 3, `expected the LED-bus types to be checked, got ${ledTypesChecked}`);
});

test('the LED halo tracks params.ledHaloSize × params.globalHaloScale live', () => {
  const def = getAllDefinitions()['TeSignV3A40'];
  params.ledHaloSize = 0.2;
  params.globalHaloScale = 2;
  try {
    const { fixture } = buildFixture(def);
    assert.ok(Math.abs(instanceScale(fixture.haloInst) - 0.4) < 1e-6,
      'built at ledHaloSize × globalHaloScale');

    // The live path the "Halo Size" / "Global Halo Size" sliders call.
    params.ledHaloSize = 0.05;
    fixture.updateScales(params.globalPixelScale || 1.0, 3);
    assert.ok(Math.abs(instanceScale(fixture.haloInst) - 0.15) < 1e-6,
      'updateScales re-reads the settings and rescales the halo');
    fixture.destroy();
  } finally {
    delete params.ledHaloSize;
    delete params.globalHaloScale;
  }
});

test('absent halo settings fall back to the module default radius', () => {
  delete params.ledHaloSize;
  delete params.globalHaloScale;
  const { fixture } = buildFixture(getAllDefinitions()['TeSignV3B34']);
  assert.ok(Math.abs(instanceScale(fixture.haloInst) - LED_HALO_RADIUS) < 1e-6,
    'defaults to LED_HALO_RADIUS with no settings present');
  fixture.destroy();
});

test('the halo does NOT depend on the per-fixture diffusion toggle (the TE Sign regression)', () => {
  const def = getAllDefinitions()['TeSignV3A40'];
  for (const diffusion of [true, false]) {
    const { fixture } = buildFixture(def, { diffusion, diffusionAmount: 1.5 });
    assert.ok(fixture.haloInst && fixture.haloInst.isInstancedMesh,
      `halo must exist with diffusion=${diffusion}`);
    assert.ok(Math.abs(instanceScale(fixture.haloInst) - ledHaloRadius()) < 1e-6,
      `halo radius must be the settings radius with diffusion=${diffusion}`);
    assert.equal(fixture.haloInst.visible, true, `halo must render with diffusion=${diffusion}`);
    fixture.destroy();
  }
});

test('a driven pixel colors the halo instance, not just the bulb', () => {
  const { fixture } = buildFixture(getAllDefinitions()['TeSignV3A40']);
  fixture.setPixelColorRGB(2, 0, 1, 0);
  const c = new THREE.Color();
  fixture.haloInst.getColorAt(2, c);
  assert.ok(c.g > 0.5 && c.r < 1e-5 && c.b < 1e-5, 'halo instance 2 turned green with its pixel');
  fixture.destroy();
});

test('the LED diffusion sprites are an EXTRA layer, not a replacement for the halo', () => {
  const { fixture } = buildFixture(getAllDefinitions()['TeLedGrid40'], { diffusion: true, diffusionAmount: 1.5 });
  assert.ok(fixture.haloInst, 'LED-bus fixture keeps its instanced halo');
  assert.ok(fixture.pixels.every((p) => p.halo && p.halo.isSprite),
    'and still carries the per-pixel diffusion sprites');
  fixture.destroy();
});
