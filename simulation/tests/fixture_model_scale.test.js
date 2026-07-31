/**
 * fixture_model_scale.test.js — the vintage lights are not tiny dots any more.
 *
 * The bug: a Vintage LED Stage Light is 90 × 460 × 60 mm with 18 mm heads. On a
 * ~100 m ship it draws as a few specks — "the vintage lights are still tiny in
 * the 3d vis". Nothing in the render path exaggerated a physically small
 * fixture, and the earlier sizing work (20260725_53) only ever bounded the
 * bulbs DOWNWARD (the pixel-pitch ceiling), so it could not have made them
 * bigger.
 *
 * The rule locked down here: `fixture_model_scale.js` is a uniform RENDER
 * multiplier per fixture type. Everything DRAWN grows by it — housing, hitbox,
 * emitter positions, bulb + halo radii — while the PHYSICAL pixel positions
 * (`pixel.localPos`, what the Pixelblaze model exporter and the light pool
 * sample) stay true to the model YAML. Because it is uniform, the pixel-pitch
 * ceiling grows with the fixture instead of clamping the bigger bulbs back
 * down, and the fixture's proportions are unchanged.
 *
 * DmxFixtureRuntime is browser code (window._patchesActive, <canvas> for the
 * LED glow texture) — both stubbed below, as in fixture_pixel_pitch_sizing.
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
// READ-ONLY: the operator's real show scene, swept so "global for the vintage
// lights" is proved against the actual inventory, not one fixture in isolation.
const TITANIC_SCENE = path.join(__dirname, '..', 'scenes', 'titanic', 'scene_config.yaml');

// The operator's floor: the vintage fixture must render at LEAST this much
// bigger than its physical model, housing and pixels alike.
const REQUIRED_VINTAGE_SCALE = 2.5;

// Same, for the UKing par cans ("do the same 3X enlargement for the par can
// Uking pars").
const REQUIRED_PAR_SCALE = 3.0;

// Fixture types the app hands to FogMachine, not DmxFixtureRuntime.
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
const { fixtureModelScale, FIXTURE_MODEL_SCALE, DEFAULT_MODEL_SCALE } =
  await import('../src/fixtures/fixture_model_scale.js');
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

function instancePosition(mesh, index = 0) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return pos;
}

function buildFixture(fixtureDef) {
  const scene = new THREE.Scene();
  const config = {
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffffff',
    x: 0, y: 2, z: 0,
    enabled: true,
    brightness: 100,
  };
  return new DmxFixtureRuntime(config, 0, scene, [], 50, fixtureDef, null);
}

let previousProfile;
let previousPixelScale;
let previousHaloScale;
before(() => {
  previousProfile = params.lightingProfile;
  previousPixelScale = params.globalPixelScale;
  previousHaloScale = params.globalHaloScale;
  params.lightingProfile = 'full'; // the only profile that renders every pixel's emitter
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = previousProfile;
  params.globalPixelScale = previousPixelScale;
  params.globalHaloScale = previousHaloScale;
});

test('fixtureModelScale: listed types are exaggerated, everything else draws 1:1', () => {
  assert.equal(fixtureModelScale({ fixtureType: 'VintageLed' }), FIXTURE_MODEL_SCALE.VintageLed);
  assert.equal(fixtureModelScale({ fixtureType: 'UkingPar' }), FIXTURE_MODEL_SCALE.UkingPar);
  assert.equal(fixtureModelScale({ fixtureType: 'ShehdsBar' }), DEFAULT_MODEL_SCALE);
  assert.equal(fixtureModelScale(null), DEFAULT_MODEL_SCALE);
  assert.equal(fixtureModelScale({}), DEFAULT_MODEL_SCALE);
  // Object.freeze on the table is what stops a caller mutating the show's
  // fixture sizes at runtime.
  assert.throws(() => { 'use strict'; FIXTURE_MODEL_SCALE.VintageLed = 1; }, TypeError);
});

test('the operator floor: the Vintage LED renders at >= 2.5x its model size', () => {
  assert.ok(FIXTURE_MODEL_SCALE.VintageLed >= REQUIRED_VINTAGE_SCALE,
    `the vintage render scale must stay at or above ${REQUIRED_VINTAGE_SCALE}× ` +
    `(operator order), got ${FIXTURE_MODEL_SCALE.VintageLed}`);
});

test('the operator floor: the UKing par renders at >= 3x its model size', () => {
  assert.ok(FIXTURE_MODEL_SCALE.UkingPar >= REQUIRED_PAR_SCALE,
    `the par render scale must stay at or above ${REQUIRED_PAR_SCALE}× (operator order), ` +
    `got ${FIXTURE_MODEL_SCALE.UkingPar}`);
});

test('the par can grows housing AND bulb, and its single head is never pitch-clamped', () => {
  const def = getAllDefinitions().UkingPar;
  const scale = FIXTURE_MODEL_SCALE.UkingPar;
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  const fixture = buildFixture(def);

  // Housing: a par's shell is a CYLINDER — the other geometry branch from the
  // vintage light's box, so this covers both.
  assert.ok(fixture.shell, 'the par must still build its can');
  const shellMm = def.shell.dimensions;
  const geo = fixture.shell.geometry.parameters;
  assert.ok(Math.abs(geo.radiusTop - (shellMm[0] / 2) * 0.001 * scale) < 1e-9,
    `can radius ${geo.radiusTop} must be ${scale}× the model's ${shellMm[0]} mm diameter`);
  assert.ok(Math.abs(geo.height - shellMm[2] * 0.001 * scale) < 1e-9,
    `can depth ${geo.height} must be ${scale}× the model's ${shellMm[2]} mm`);
  assert.ok(Math.abs(fixture.shell.position.z + def.shell.offset[2] * 0.001 * scale) < 1e-9,
    'the can offset must scale with the can');

  // Pixel: one 39 mm head, above the 0.02 floor, so the bulb is the real
  // physical size × the scale.
  assert.equal(fixture.pixels.length, 1, 'the UKing par is a single-pixel fixture');
  const expectedBase = Math.max(39 * 0.001, 0.02) * scale;
  assert.ok(Math.abs(fixture.pixels[0].bulbSize - expectedBase) < 1e-9,
    `par bulb base ${fixture.pixels[0].bulbSize} must be ${scale}× the physical 0.039`);

  // Single pixel ⇒ no neighbour ⇒ no ceiling, at ANY slider position. The 3×
  // is exactly what is drawn, even at the slider max.
  assert.equal(fixture._minPixelPitch, 0, 'a one-head fixture has no pixel pitch');
  fixture.updateScales(5, 4.7);
  assert.ok(Math.abs(instanceScale(fixture.bulbInst, 0) - expectedBase * 5) < 1e-5,
    'the par bulb is never clamped — nothing to fuse with');
  fixture.destroy();
});

test('housing AND pixels both grow — the fixture keeps its proportions', () => {
  const def = getAllDefinitions().VintageLed;
  const scale = FIXTURE_MODEL_SCALE.VintageLed;
  params.globalPixelScale = 1.1; // the operator's own slider value
  params.globalHaloScale = 0.6;
  const fixture = buildFixture(def);

  // Housing: the shell box is the model's mm dimensions × the render scale.
  assert.ok(fixture.shell, 'the vintage light must still build an opaque housing');
  const shellParams = fixture.shell.geometry.parameters;
  const shellMm = def.shell.dimensions;
  assert.ok(Math.abs(shellParams.width - shellMm[0] * 0.001 * scale) < 1e-9,
    `housing width ${shellParams.width} must be ${scale}× the model's ${shellMm[0]} mm`);
  assert.ok(Math.abs(shellParams.height - shellMm[1] * 0.001 * scale) < 1e-9,
    `housing height ${shellParams.height} must be ${scale}× the model's ${shellMm[1]} mm`);
  assert.ok(Math.abs(shellParams.depth - shellMm[2] * 0.001 * scale) < 1e-9,
    `housing depth ${shellParams.depth} must be ${scale}× the model's ${shellMm[2]} mm`);
  // The housing offset scales with it, so the body still sits over the heads.
  assert.ok(Math.abs(fixture.shell.position.y - def.shell.offset[1] * 0.001 * scale) < 1e-9,
    'the housing offset must scale with the housing');

  // Pixels: 18 mm heads floored to the 0.02 minimum, then × the render scale.
  const expectedBulbBase = Math.max(18 * 0.001, 0.02) * scale;
  assert.ok(Math.abs(fixture.pixels[0].bulbSize - expectedBulbBase) < 1e-9,
    `bulb base size ${fixture.pixels[0].bulbSize} must be ${scale}× the unscaled 0.02`);
  // And the size actually drawn is that × the slider — NOT clamped back down.
  const drawn = instanceScale(fixture.bulbInst, 0);
  assert.ok(Math.abs(drawn - expectedBulbBase * 1.1) < 1e-6,
    `drawn bulb radius ${drawn} must track the slider at the scaled size`);
  assert.ok(drawn >= 0.02 * 1.1 * REQUIRED_VINTAGE_SCALE - 1e-9,
    `drawn bulb radius ${drawn} is below ${REQUIRED_VINTAGE_SCALE}× the old rendered size`);

  // Head spread: the six heads are drawn 2.5× further apart, so the column is
  // 2.5× taller — housing and pixels moved together.
  const headSpread = instancePosition(fixture.bulbInst, 5).y - instancePosition(fixture.bulbInst, 0).y;
  const physicalSpread = fixture.pixels[5].localPos.y - fixture.pixels[0].localPos.y;
  assert.ok(Math.abs(headSpread - physicalSpread * scale) < 1e-5,
    `the drawn head spread ${headSpread} must be ${scale}× the physical ${physicalSpread}`);

  fixture.destroy();
});

test('the pitch ceiling scales with the fixture — the scale-up survives a maxed slider', () => {
  // 20260725_53 bounds a bulb by its neighbour spacing. Measuring that spacing
  // in PHYSICAL space would have silently clamped the enlarged bulbs straight
  // back to the old size at high slider values, undoing this whole change.
  const def = getAllDefinitions().VintageLed;
  const scale = FIXTURE_MODEL_SCALE.VintageLed;
  params.globalPixelScale = 5; // slider max, where the ceiling actually bites
  params.globalHaloScale = 4.7;
  const fixture = buildFixture(def);

  const physicalPitch = fixture.pixels[0].localPos.distanceTo(fixture.pixels[1].localPos);
  assert.ok(Math.abs(fixture._minPixelPitch - physicalPitch * scale) < 1e-9,
    'the pitch the ceiling is derived from must be the DRAWN spacing');

  const drawn = instanceScale(fixture.bulbInst, 0);
  const clampedUnscaled = physicalPitch * 0.3; // MAX_BULB_PITCH_FRACTION, pre-scale
  // Instance matrices are Float32 — compare with a float32-sized epsilon.
  assert.ok(drawn >= clampedUnscaled * REQUIRED_VINTAGE_SCALE * (1 - 1e-6),
    `at the slider max the clamped bulb ${drawn} must still be ${REQUIRED_VINTAGE_SCALE}× ` +
    `the old clamped ${clampedUnscaled}`);
  // Still separate heads: the ceiling is doing its job in the scaled space.
  assert.ok(drawn * 2 < fixture._minPixelPitch,
    'the enlarged heads must still not touch each other');

  fixture.destroy();
});

test('the exported model stays physical — localPos is NOT exaggerated', () => {
  // pixelblaze_model_exporter.js and light_pool.js sample pixel.localPos. An
  // exported model describes the real rig; if the render exaggeration leaked
  // into it, every pattern mapped onto the vintage lights would shift.
  const def = getAllDefinitions().VintageLed;
  params.globalPixelScale = 1.1;
  const fixture = buildFixture(def);
  def.pixels.forEach((pixelModel, i) => {
    const dot = pixelModel.dots[0];
    const p = fixture.pixels[i].localPos;
    assert.ok(Math.abs(p.x - dot[0] * 0.001) < 1e-9, `pixel ${i} x must stay physical`);
    assert.ok(Math.abs(p.y - dot[1] * 0.001) < 1e-9, `pixel ${i} y must stay physical`);
    assert.ok(Math.abs(p.z + dot[2] * 0.001) < 1e-9, `pixel ${i} z must stay physical`);
  });
  fixture.destroy();
});

test('every other fixture type is byte-identical — the scale is opt-in per type', () => {
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  let checked = 0;
  for (const def of Object.values(getAllDefinitions())) {
    if (FOG_TYPES.has(def.fixtureType)) continue;
    if (FIXTURE_MODEL_SCALE[def.fixtureType] !== undefined) continue;
    const fixture = buildFixture(def);
    assert.equal(fixture._modelScale, DEFAULT_MODEL_SCALE,
      `${def.fixtureType} must draw at physical size`);
    for (let i = 0; i < fixture.pixels.length; i++) {
      const p = fixture.pixels[i];
      assert.ok(p.renderPos.distanceTo(p.localPos) === 0,
        `${def.fixtureType} pixel ${i} must draw exactly where it physically is`);
    }
    checked++;
    fixture.destroy();
  }
  assert.ok(checked >= 3, `expected the unscaled fixture types to be swept, got ${checked}`);
});

// ── The follow-up: "make sure this is a global change" ───────────────────
// Operator, same day: "Left Front Rails 4 still show small pixels … please make
// sure this is a global change you did for the vintage lights", then "these are
// fine though — Left Back Rails 4". Two nominally sibling chains. A live probe
// of his running sim found all 16 VintageLed fixtures drawn IDENTICALLY (scale
// 2.5, bulb radius 0.055, pitch 0.1875) — the difference between those two
// fixtures is that the Left Front Rails are the only PATCHED vintage lights, so
// they render live DMX levels (often near-black) while every other vintage
// fixture sits at its full static config colour. Brightness, not size.
//
// These two tests pin the half of that which is code: EVERY vintage instance in
// his real scene gets the scale, and no vintage-named type can be added to the
// registry without one.

function loadTitanicFixtures() {
  const scene = yaml.load(fs.readFileSync(TITANIC_SCENE, 'utf8'));
  const find = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node.fixtures)) return node.fixtures;
    for (const value of Object.values(node)) {
      const hit = find(value);
      if (hit) return hit;
    }
    return null;
  };
  const fixtures = find(scene);
  assert.ok(Array.isArray(fixtures) && fixtures.length > 0,
    'the titanic scene must still carry a fixtures list');
  return fixtures;
}

test('GLOBAL: every vintage fixture in the real titanic scene is drawn at the same 2.5x', () => {
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  const defs = getAllDefinitions();
  const vintage = loadTitanicFixtures().filter(
    (c) => (c.fixtureType || c.type) === 'VintageLed'
  );
  assert.ok(vintage.length >= 16,
    `expected the scene's full vintage inventory, got ${vintage.length}`);

  const seen = new Set();
  for (const config of vintage) {
    // Built from the fixture's OWN scene config — position, rotation, colour,
    // group and patch flags included — through the real runtime class.
    const fixture = new DmxFixtureRuntime(
      config, 0, new THREE.Scene(), [], 50, defs.VintageLed, null
    );
    assert.equal(fixture._modelScale, FIXTURE_MODEL_SCALE.VintageLed,
      `${config.name} did not pick up the vintage render scale`);
    assert.equal(fixture.pixels.length, 6, `${config.name} must be a 6-head fixture`);
    seen.add([
      fixture.pixels[0].bulbSize.toFixed(6),
      fixture._minPixelPitch.toFixed(6),
      instanceScale(fixture.bulbInst, 0).toFixed(6),
    ].join('|'));
    fixture.destroy();
  }
  // One signature for the whole inventory ⇒ no fixture is drawn smaller than a
  // sibling. Bow, stern, port, starboard, patched or not.
  assert.equal(seen.size, 1,
    `vintage fixtures render at ${seen.size} different sizes: ${[...seen].join(' / ')}`);
});

test('a future vintage variant cannot ship without a render scale', () => {
  // The registry today holds exactly one vintage type. If a 15-channel or
  // second-generation vintage model is ever added, this fails until it is
  // given a scale — "global for the vintage lights" stays true by test, not by
  // somebody remembering.
  const vintageTypes = Object.values(getAllDefinitions())
    .map((def) => def.fixtureType)
    .filter((type) => /vintage/i.test(type));
  assert.ok(vintageTypes.length >= 1, 'the vintage fixture type must still be registered');
  for (const type of vintageTypes) {
    assert.ok(FIXTURE_MODEL_SCALE[type] >= REQUIRED_VINTAGE_SCALE,
      `vintage-class type '${type}' has no >= ${REQUIRED_VINTAGE_SCALE}× render scale`);
  }
});

test('perf P0: the enlarged fixture is still ONE InstancedMesh per emitter layer', () => {
  // Scene-graph object count is the sim's known perf cliff — growing a fixture
  // must never turn its pixels back into per-pixel meshes.
  const def = getAllDefinitions().VintageLed;
  params.globalPixelScale = 1.1;
  const fixture = buildFixture(def);
  assert.ok(fixture.bulbInst.isInstancedMesh, 'bulbs must stay instanced');
  assert.ok(fixture.haloInst.isInstancedMesh, 'halos must stay instanced');
  assert.equal(fixture.bulbInst.count, fixture.pixels.length);
  assert.equal(fixture.haloInst.count, fixture.pixels.length);
  // Group children: shell + bulb batch + halo batch (+ cones when the profile
  // builds them). Never one child per pixel.
  assert.ok(fixture.group.children.length <= 4,
    `the fixture group holds ${fixture.group.children.length} objects — one per pixel is the perf cliff`);
  fixture.destroy();
});
