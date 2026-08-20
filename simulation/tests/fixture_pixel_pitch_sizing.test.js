/**
 * fixture_pixel_pitch_sizing.test.js — a fixture's pixels never fuse into a blob.
 *
 * The bug this locks down: a model fixture's opaque bulb core is sized from its
 * PHYSICAL pixel size times the global "Global Pixel Size" slider (0.1–5), a
 * multiplier that knows nothing about how far apart that fixture's pixels
 * actually are. Past a per-fixture threshold the cores overlap and the fixture
 * stops reading as a run of lights — it fuses into one solid blob column.
 *
 * The Vintage LED Stage Light is the worst case in the shipped set (6 heads,
 * 18 mm bulbs, 75 mm pitch): its cores touch at "Global Pixel Size" ≥ 1.9 and
 * are 2.7× the pitch at the slider's max — six distinct Edison heads rendered
 * as one sausage, right next to LED strands that still read as individual dots
 * because a strand's radius is absolute and ignores that slider entirely.
 *
 * The rule enforced here is GENERAL, not Vintage-shaped: for EVERY fixture type
 * shipped in dmx/fixtures/, at EVERY position of the size sliders, a pixel's
 * rendered bulb radius stays at or under MAX_BULB_PITCH_FRACTION of the
 * distance to its nearest neighbour in the same fixture — the same ratio the
 * reference LED strands already render at. Below that ceiling the sliders are
 * untouched, so "Pixel Size" / "Global Pixel Size" keep working.
 *
 * DmxFixtureRuntime is browser code: it reads `window._patchesActive` and, for
 * LED-bus fixtures, generates the diffusion sprite texture from a <canvas>.
 * Both are stubbed below — the geometry assertions are pure THREE.
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
const { clampPixelRadiusToPitch, ledHaloRadius, minPixelPitch, MAX_BULB_PITCH_FRACTION } =
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
  const config = Object.assign({
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffffff',
    x: 0, y: 2, z: 0,
    enabled: true,
    brightness: 100,
  }, configOverrides);
  return new DmxFixtureRuntime(config, 0, scene, [], 50, fixtureDef, null);
}

// The GUI's "Global Pixel Size" slider (scenes/common.yaml): min, shipped
// value, and max. The titanic scene ships the max.
const PIXEL_SCALE_SLIDER = [0.1, 1.1, 5];

let previousProfile;
let previousPixelScale;
let previousHaloScale;
before(() => {
  previousProfile = params.lightingProfile;
  previousPixelScale = params.globalPixelScale;
  previousHaloScale = params.globalHaloScale;
  // 'full' renders every pixel's emitter — the profile the show runs in and the
  // only one where per-pixel fusion is possible at all.
  params.lightingProfile = 'full';
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = previousProfile;
  params.globalPixelScale = previousPixelScale;
  params.globalHaloScale = previousHaloScale;
});

test('minPixelPitch reports the closest spacing, and 0 when there is no neighbour', () => {
  assert.equal(minPixelPitch([]), 0, 'no pixels ⇒ no spacing');
  assert.equal(minPixelPitch([new THREE.Vector3(0, 0, 0)]), 0, 'one pixel ⇒ no neighbour');
  const row = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(0, 0.7, 0),
    new THREE.Vector3(0, 2, 0),
  ];
  assert.ok(Math.abs(minPixelPitch(row) - 0.2) < 1e-9,
    'the CLOSEST pair sets the spacing, not the first pair or the list order');
  // Coincident pixels carry no spacing information — must not collapse to 0
  // radius for every bulb.
  assert.equal(minPixelPitch([new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)]), 0);
});

test('clampPixelRadiusToPitch is a ceiling, not a replacement — and fails loudly on garbage', () => {
  // Below the ceiling: passed through untouched, so the sliders still work.
  assert.equal(clampPixelRadiusToPitch(0.01, 0.1), 0.01);
  // Above the ceiling: bounded to the fraction of the pitch.
  assert.ok(Math.abs(clampPixelRadiusToPitch(5, 0.1) - 0.1 * MAX_BULB_PITCH_FRACTION) < 1e-12);
  // No neighbour (single-pixel fixture) ⇒ no ceiling.
  assert.equal(clampPixelRadiusToPitch(0.5, 0), 0.5);
  // P0 "no fallback behaviours": bad input crashes instead of silently coping.
  assert.throws(() => clampPixelRadiusToPitch(NaN, 0.1), /radius/);
  assert.throws(() => clampPixelRadiusToPitch(-1, 0.1), /radius/);
  assert.throws(() => clampPixelRadiusToPitch(0.1, NaN), /pitch/);
  assert.throws(() => clampPixelRadiusToPitch(0.1, -0.5), /pitch/);
});

test('NO shipped fixture fuses its pixels at ANY position of the Global Pixel Size slider', () => {
  let multiPixelTypesChecked = 0;
  for (const def of Object.values(getAllDefinitions())) {
    if (FOG_TYPES.has(def.fixtureType)) continue;
    for (const scale of PIXEL_SCALE_SLIDER) {
      params.globalPixelScale = scale;
      const fixture = buildFixture(def);
      if (fixture.pixels.length < 2) { fixture.destroy(); continue; }
      const pitch = fixture._minPixelPitch;
      assert.ok(pitch > 0, `${def.fixtureType} must measure a pixel pitch`);
      for (let i = 0; i < fixture.pixels.length; i++) {
        // Instance matrices are Float32 — compare with a float32-sized epsilon.
        const radius = instanceScale(fixture.bulbInst, i);
        assert.ok(radius <= pitch * MAX_BULB_PITCH_FRACTION * (1 + 1e-6),
          `${def.fixtureType} pixel ${i} bulb radius ${radius} exceeds the pitch ceiling ` +
          `${pitch * MAX_BULB_PITCH_FRACTION} at Global Pixel Size ${scale} — its pixels would fuse`);
        // The real thing the operator sees: two neighbouring cores must not
        // touch, so there is always a dark gap between them.
        assert.ok(radius * 2 < pitch,
          `${def.fixtureType} pixel ${i} bulb DIAMETER ${radius * 2} >= pitch ${pitch} at ` +
          `Global Pixel Size ${scale} — neighbouring cores overlap into one blob`);
      }
      multiPixelTypesChecked++;
      fixture.destroy();
    }
  }
  assert.ok(multiPixelTypesChecked >= 3,
    `expected the multi-pixel fixture types to be swept, got ${multiPixelTypesChecked}`);
});

test('the Vintage LED renders 6 distinct heads, at the LED strands\' own size-to-spacing ratio', () => {
  // The regression the operator reported: a vertical column of large fused
  // blobs where six separate Edison heads should be, next to a strand whose
  // dots were individually readable.
  //
  // The reference is measured at the GUI's shipped "Pixel Size" default
  // (gui_builder.js installs 0.08 when the setting is absent), not at
  // led_strand.js's bare module default — 0.08 is what actually renders in the
  // window the operator screenshotted.
  const previousLedPixelSize = params.ledPixelSize;
  params.ledPixelSize = 0.08;
  const strand = new LedStrand({
    name: 'LED_0',
    startX: -31.5, startY: 2.5, startZ: 13.5,   // titanic 'Left_Front_Left', the
    endX: -28.3, endY: 12.5, endZ: 10.04,        // strand beside the vintage rail
    color: '#00ffaa',
    ledCount: 40,
  }, 0, new THREE.Scene(), []);
  const strandPitch = new THREE.Vector3(-31.5, 2.5, 13.5)
    .distanceTo(new THREE.Vector3(-28.3, 12.5, 10.04)) / 39;
  const strandRatio = instanceScale(strand.bulbInst) / strandPitch;

  params.globalPixelScale = 5; // the titanic scene's own saved value, the slider max
  const vintage = buildFixture(getAllDefinitions().VintageLed);
  assert.equal(vintage.pixels.length, 6, 'the Vintage LED is a 6-head fixture');
  const ratio = instanceScale(vintage.bulbInst) / vintage._minPixelPitch;
  assert.ok(ratio <= MAX_BULB_PITCH_FRACTION * (1 + 1e-6),
    `vintage head radius is ${ratio}× its 75 mm head spacing — the heads fuse`);
  assert.ok(ratio <= strandRatio * 1.1,
    `vintage heads (${ratio}× spacing) must read no fatter than the reference LED ` +
    `strand pixels (${strandRatio}× spacing) the operator compared them against`);
  vintage.destroy();
  params.ledPixelSize = previousLedPixelSize;
});

test('the size sliders still drive the Vintage LED below the ceiling', () => {
  const def = getAllDefinitions().VintageLed;
  params.globalPixelScale = 0.5;
  const fixture = buildFixture(def);
  const small = instanceScale(fixture.bulbInst);
  const uncapped = fixture.pixels[0].bulbSize * 0.5;
  assert.ok(Math.abs(small - uncapped) < 1e-9,
    'below the ceiling the slider value is passed through untouched');

  // The live path the "Global Pixel Size" slider calls.
  fixture.updateScales(1.0, params.globalHaloScale || 1.0);
  const bigger = instanceScale(fixture.bulbInst);
  assert.ok(bigger > small, 'raising the slider still grows the bulb');
  assert.ok(Math.abs(bigger - fixture.pixels[0].bulbSize) < 1e-9,
    'and still tracks the setting exactly while under the ceiling');
  fixture.destroy();
});

test('fixture_representative mode is exempt — one instance cannot fuse with itself', () => {
  // A 'fixture_representative' emitter profile collapses the fixture to ONE
  // deliberately oversized instance standing in for the whole thing. Bounding
  // that by the pixel pitch would shrink the stand-in to a single head. No
  // shipped profile selects this mode today (profile_registry.js), so it is
  // driven directly rather than through a profile name that would silently
  // fall back to 'edit' and make the assertion vacuous.
  params.globalPixelScale = 5;
  const fixture = buildFixture(getAllDefinitions().VintageLed);
  fixture._emitterRepresentative = true;
  fixture._rebuildBulbHaloMatrices(params.globalPixelScale, params.globalHaloScale || 1.0);
  const radius = instanceScale(fixture.bulbInst, 0);
  assert.ok(radius > fixture._minPixelPitch * MAX_BULB_PITCH_FRACTION,
    'the representative stand-in stays intentionally larger than one pixel');
  fixture.destroy();
});

test('the LED halo settings still own every LED-bus halo (no regression to halo parity)', () => {
  params.globalPixelScale = 5;
  params.globalHaloScale = 4.7;
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
  assert.ok(checked >= 3, `expected the LED-bus types to be checked, got ${checked}`);
});
