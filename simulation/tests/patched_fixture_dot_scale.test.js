/**
 * patched_fixture_dot_scale.test.js — the render exaggeration must reach the
 * layer that actually lights a PATCHED fixture.
 *
 * The operator's report (2026-07-30, with a screenshot): "the vintage lights
 * are still bad … funny thing, it's only Left Front Rails so I think it might
 * be a lingering cache somewhere". The Left Front Rails are the ONLY patched
 * vintage fixtures in the titanic scene.
 *
 * There was no cache. There are TWO emitter layers over every pixel:
 *
 *   1. the per-fixture instanced bulb/halo built by DmxFixtureRuntime — which
 *      20260725_68 scaled correctly, and which a live probe measured as
 *      identical across all 16 vintage fixtures;
 *   2. the scene-wide instanced-dot mesh in animate.js, one instance per pixel
 *      in the whole show, which placed and sized its dots from the pixel map's
 *      PHYSICAL `x/y/z` + `pixelSize`. It never saw fixture_model_scale at all.
 *
 * Layer 2 draws every UNPATCHED pixel black (or flat red under the
 * unpatched-red overlay) and only a PATCHED pixel in its live colour — so the
 * pre-scale dots were visible on exactly the patched fixtures, and invisible
 * everywhere else. Hence "only Left Front Rails".
 *
 * Pinned here:
 *   • a driven colour update NEVER touches an instance matrix (the "live frames
 *     clobber the scaled matrices" theory, killed — it must stay killed);
 *   • the pixel map emits DRAWN geometry (rx/ry/rz + renderScale) alongside the
 *     physical fields, and the physical ones are unchanged;
 *   • the dot mesh's own geometry recipe reads the drawn fields and refuses to
 *     run without them;
 *   • the operator's floor holds on layer 2 as well as layer 1.
 *
 * DmxFixtureRuntime is browser code (window._patchesActive, <canvas> for the
 * LED glow texture) — both stubbed below, as in fixture_model_scale.test.js.
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

// The operator's floors, restated on the dot mesh (see fixture_model_scale.js).
const REQUIRED_VINTAGE_SCALE = 2.5;
const REQUIRED_PAR_SCALE = 3.0;

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
const { FIXTURE_MODEL_SCALE } = await import('../src/fixtures/fixture_model_scale.js');
const { dotDrawnRadius, writeDotMatrix, DEFAULT_PIXEL_SIZE_MM } =
  await import('../src/core/pixel_dot_geometry.js');
const { generatePixelMap } = await import('../src/dmx/pixelblaze_model_exporter.js');
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

// Every instance matrix of a mesh, as plain arrays — the exact bytes the GPU
// gets, so "unchanged" means unchanged.
function snapshotMatrices(mesh) {
  const out = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push([...m.elements]);
  }
  return out;
}

// A fixture placed and rotated like a real rail run, so the world transform is
// not the identity and a position bug cannot hide behind it.
function buildFixture(fixtureDef, config = {}) {
  const scene = new THREE.Scene();
  return new DmxFixtureRuntime({
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffffff',
    x: -17.4, y: 11.5, z: 13.7,
    rotX: -23.4, rotY: -165.1, rotZ: 147.2,
    enabled: true,
    brightness: 100,
    ...config,
  }, 0, scene, [], 50, fixtureDef, null);
}

// Run generatePixelMap() over a set of REAL runtime fixtures.
function pixelMapFor(fixtures) {
  window._isRebuildingFixtures = false;
  window._missingFixtureWarnCount = 0;
  window.dmxSceneFixtures = [];
  window.ledStrandFixtures = [];
  window.__controllerRegistry = null;
  params.dmxFixtures = [];
  params.ledStrands = [];
  params.parLights = fixtures.map((f) => f.config);
  window.parFixtures = fixtures;
  return generatePixelMap().pixels;
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

// ── 1. A driven frame never resizes anything ─────────────────────────────

test('a live DMX frame changes colours only — every instance matrix is untouched', () => {
  // The first theory for "only the patched fixtures look wrong" was that the
  // per-frame driven path rebuilt bulb matrices from the PHYSICAL sizes, so a
  // patched fixture got clobbered back to pre-scale on its first frame. It does
  // not — applyDmxFrame only writes instanceColor. This test keeps it that way:
  // if anyone ever moves matrix work into the colour path, the drawn size of a
  // patched fixture becomes frame-dependent and this bug class comes back.
  const def = getAllDefinitions().VintageLed;
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  const fixture = buildFixture(def);

  const before = {
    bulb: snapshotMatrices(fixture.bulbInst),
    halo: snapshotMatrices(fixture.haloInst),
  };

  // A full 33-channel vintage frame: dimmer up, heads 1-4 lit yellow-green,
  // heads 5-6 dark — the exact pattern in the operator's screenshot.
  const frame = new Uint8Array(33);
  frame[0] = 255; // total dimming
  for (let head = 0; head < 4; head++) {
    const base = 15 + head * 3; // ch16/19/22/25 (1-based) → red of each head
    frame[base] = 180;      // red
    frame[base + 1] = 255;  // green
    frame[base + 2] = 20;   // blue
    frame[2 + head] = 255;  // that head's `value` (warm) channel
  }
  fixture.applyDmxFrame(frame);
  // ...and the other two colour entry points patterns drive fixtures through.
  fixture.setColor(0.1, 0.9, 0.2);
  fixture.setPixelColorRGB(0, 1, 1, 1);

  assert.deepEqual(snapshotMatrices(fixture.bulbInst), before.bulb,
    'a driven colour update must not move or resize a bulb instance');
  assert.deepEqual(snapshotMatrices(fixture.haloInst), before.halo,
    'a driven colour update must not move or resize a halo instance');
  // The colours DID change — otherwise the test above proves nothing.
  assert.ok(fixture.pixels[0].color.g > 0, 'the driven colour must have landed');

  fixture.destroy();
});

// ── 2. The dot mesh's geometry recipe ────────────────────────────────────

test('dotDrawnRadius applies the render multiplier the physical size does not carry', () => {
  // An 18 mm vintage head at the operator's slider (1.1) on a 2.5× fixture.
  const head = { name: 'head', pixelSize: 18, renderScale: FIXTURE_MODEL_SCALE.VintageLed };
  const physical = 18 * 0.001 * 1.1;
  assert.ok(Math.abs(dotDrawnRadius(head, 1.1) - physical * FIXTURE_MODEL_SCALE.VintageLed) < 1e-12);
  assert.ok(dotDrawnRadius(head, 1.1) >= physical * REQUIRED_VINTAGE_SCALE - 1e-12,
    'the drawn dot must clear the operator floor, not the pre-scale size');

  // A 39 mm par head at 3×.
  const par = { name: 'par', pixelSize: 39, renderScale: FIXTURE_MODEL_SCALE.UkingPar };
  assert.ok(dotDrawnRadius(par, 1.1) >= 39 * 0.001 * 1.1 * REQUIRED_PAR_SCALE - 1e-12);

  // A pixel with no model size (an LED strand LED) keeps the 14 mm default.
  const strandPx = { name: 'led', renderScale: 1 };
  assert.ok(Math.abs(dotDrawnRadius(strandPx, 2) - DEFAULT_PIXEL_SIZE_MM * 0.001 * 2) < 1e-12);
});

test('the dot geometry refuses to run on physical-only data (no silent fallback)', () => {
  // The pre-fix entries had no renderScale and no rx/ry/rz. If those ever stop
  // being emitted, the dot mesh must fail LOUD rather than quietly go back to
  // drawing every fixture at its physical size (codex P0).
  assert.throws(() => dotDrawnRadius({ name: 'x', pixelSize: 18 }, 1.1), /renderScale/);
  assert.throws(() => dotDrawnRadius({ name: 'x', pixelSize: 18, renderScale: 0 }, 1.1), /renderScale/);
  assert.throws(() => dotDrawnRadius({ name: 'x', pixelSize: 18, renderScale: 2.5 }, 0), /globalScale/);

  const dummy = new THREE.Object3D();
  const mesh = { setMatrixAt() { throw new Error('must not reach the mesh'); } };
  assert.throws(() => writeDotMatrix(mesh, 0, { name: 'x', wx: 1, wy: 2, wz: 3 }, 0.05, dummy),
    /DRAWN position/);
});

test('writeDotMatrix places the instance at the DRAWN position, never the physical one', () => {
  const dummy = new THREE.Object3D();
  const written = [];
  const mesh = { setMatrixAt(i, m) { written.push([i, m.clone()]); } };
  // Physical and drawn deliberately disagree — a writer reading wx/wy/wz fails.
  const entry = { name: 'head', wx: 1, wy: 2, wz: 3, rx: 2.5, ry: 5, rz: 7.5 };
  writeDotMatrix(mesh, 4, entry, 0.05, dummy);

  assert.equal(written.length, 1);
  assert.equal(written[0][0], 4);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  written[0][1].decompose(pos, quat, scale);
  assert.deepEqual([pos.x, pos.y, pos.z], [2.5, 5, 7.5]);
  assert.ok(Math.abs(scale.x - 0.05) < 1e-9);

  // Radius 0 is how view isolation hides a non-member dot — still a write.
  writeDotMatrix(mesh, 5, entry, 0, dummy);
  written[1][1].decompose(pos, quat, scale);
  assert.ok(scale.x === 0 && scale.y === 0 && scale.z === 0);
});

// ── 3. The pixel map carries BOTH geometries ─────────────────────────────

test('the pixel map emits drawn geometry for a vintage fixture and keeps x/y/z physical', () => {
  const def = getAllDefinitions().VintageLed;
  const scale = FIXTURE_MODEL_SCALE.VintageLed;
  params.globalPixelScale = 1.1;
  params.globalHaloScale = 0.6;
  const fixture = buildFixture(def);
  const pixels = pixelMapFor([fixture]);
  assert.equal(pixels.length, 6, 'the vintage light exports its six heads');

  const world = new THREE.Vector3();
  pixels.forEach((px, i) => {
    // PHYSICAL — the engine model, the light pool and sACN patching sample it.
    world.copy(fixture.pixels[i].localPos).applyMatrix4(fixture.group.matrixWorld);
    assert.ok(Math.abs(px.x - world.x) < 1e-3, `pixel ${i} x must stay physical`);
    assert.ok(Math.abs(px.y - world.y) < 1e-3, `pixel ${i} y must stay physical`);
    assert.ok(Math.abs(px.z - world.z) < 1e-3, `pixel ${i} z must stay physical`);
    assert.equal(px.pixelSize, 18, 'the exported pixel size stays the real 18 mm head');

    // DRAWN — exactly where DmxFixtureRuntime put the emitter instance.
    world.copy(fixture.pixels[i].renderPos).applyMatrix4(fixture.group.matrixWorld);
    assert.ok(Math.abs(px.rx - world.x) < 1e-3, `pixel ${i} rx must match the drawn emitter`);
    assert.ok(Math.abs(px.ry - world.y) < 1e-3, `pixel ${i} ry must match the drawn emitter`);
    assert.ok(Math.abs(px.rz - world.z) < 1e-3, `pixel ${i} rz must match the drawn emitter`);
    assert.equal(px.renderScale, scale, `pixel ${i} must carry the vintage render scale`);
  });

  // The head column is drawn 2.5× longer than the real fixture — the visible
  // half of the bug was six dots huddled at pre-scale spacing inside a housing
  // that had grown around them.
  const physicalSpan = Math.hypot(pixels[5].x - pixels[0].x,
    pixels[5].y - pixels[0].y, pixels[5].z - pixels[0].z);
  const drawnSpan = Math.hypot(pixels[5].rx - pixels[0].rx,
    pixels[5].ry - pixels[0].ry, pixels[5].rz - pixels[0].rz);
  assert.ok(Math.abs(drawnSpan - physicalSpan * scale) < 1e-2,
    `the drawn head span ${drawnSpan} must be ${scale}× the physical ${physicalSpan}`);

  fixture.destroy();
});

test('the pixel map emits drawn geometry for a par can, and 1:1 for an unscaled type', () => {
  const defs = getAllDefinitions();
  params.globalPixelScale = 1.1;

  const par = buildFixture(defs.UkingPar);
  const parPixels = pixelMapFor([par]);
  assert.equal(parPixels[0].renderScale, FIXTURE_MODEL_SCALE.UkingPar);
  assert.ok(parPixels[0].renderScale >= REQUIRED_PAR_SCALE);
  par.destroy();

  // An unlisted type draws where it physically is — byte-identical to before
  // fixture_model_scale existed.
  const bar = buildFixture(defs.ShehdsBar);
  const barPixels = pixelMapFor([bar]);
  assert.ok(barPixels.length > 1, 'the bar exports its run of pixels');
  for (const px of barPixels) {
    assert.equal(px.renderScale, 1, 'an unscaled type must report no exaggeration');
    assert.equal(px.rx, px.x);
    assert.equal(px.ry, px.y);
    assert.equal(px.rz, px.z);
  }
  bar.destroy();
});

test('LED strand pixels are drawn exactly where they physically are', () => {
  // A strand carries no fixture type, and led_strand.js lays its LEDs straight
  // on the start→end line. Drawn === physical, and it must stay that way.
  window._isRebuildingFixtures = false;
  window.dmxSceneFixtures = [];
  window.__controllerRegistry = null;
  params.dmxFixtures = [];
  params.parLights = [];
  window.parFixtures = [];
  params.ledStrands = [{
    name: 'Hull', ledCount: 5,
    startX: 0, startY: 1, startZ: 0, endX: 0, endY: 1, endZ: 4,
  }];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const pixels = generatePixelMap().pixels.filter((p) => p.type === 'led');
  assert.equal(pixels.length, 5);
  for (const px of pixels) {
    assert.equal(px.renderScale, 1);
    assert.equal(px.rx, px.x);
    assert.equal(px.ry, px.y);
    assert.equal(px.rz, px.z);
  }
});

// ── 4. End to end: the floor holds on the layer the operator sees ────────

test('FLOOR: a patched vintage head\'s scene-wide dot clears 2.5x pre-scale, at its drawn position', () => {
  // The whole chain in one assertion set: real fixture → real pixel map → the
  // real dot-mesh recipe. Pre-fix this radius was 18 mm × slider (no 2.5×) and
  // this position was the physical one.
  const def = getAllDefinitions().VintageLed;
  const scale = FIXTURE_MODEL_SCALE.VintageLed;
  params.globalPixelScale = 1.1;
  const fixture = buildFixture(def);
  const pixels = pixelMapFor([fixture]);

  const preFixRadius = 18 * 0.001 * 1.1;
  for (const px of pixels) {
    assert.ok(dotDrawnRadius(px, 1.1) >= preFixRadius * REQUIRED_VINTAGE_SCALE - 1e-12,
      'every head\'s dot must clear the operator floor');
  }

  // And the dots land on the drawn emitters, not clustered at the physical ones.
  const dummy = new THREE.Object3D();
  const drawnPositions = [];
  const mesh = {
    setMatrixAt(i, m) {
      const pos = new THREE.Vector3();
      m.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
      drawnPositions[i] = pos;
    },
  };
  pixels.forEach((px, i) => writeDotMatrix(mesh, i, px, dotDrawnRadius(px, 1.1), dummy));

  const emitter = new THREE.Vector3();
  drawnPositions.forEach((pos, i) => {
    emitter.copy(fixture.pixels[i].renderPos).applyMatrix4(fixture.group.matrixWorld);
    assert.ok(pos.distanceTo(emitter) < 1e-2,
      `dot ${i} must sit on its fixture's drawn emitter, not ${scale}× short of it`);
  });

  fixture.destroy();
});
