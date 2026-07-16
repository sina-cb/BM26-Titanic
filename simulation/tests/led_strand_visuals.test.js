/**
 * Visual-look regression for the LED strand fixture (Slice S1, Requirement A).
 *
 * The old per-LED build put a dark hexagonal MeshStandardMaterial housing under
 * a TRANSPARENT bulb, so every pixel read as a black-cored plug under the night
 * scene + bloom. The rewrite renders each strand as TWO InstancedMeshes — an
 * opaque, toneMapped:false emissive bulb + an additive BackSide halo (the DMX
 * pixel recipe) — with no dark core and no fragile child-index arithmetic.
 *
 * LedStrand only needs THREE math + a plain Scene/array — no DOM, no WebGL — so
 * these run under node:test with the npm-installed `three`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { LedStrand, LED_BULB_RADIUS, LED_HALO_RADIUS } from '../src/fixtures/led_strand.js';
import { mixRgbwauToRgb } from '../src/core/sim_preview.js';
import { params } from '../src/core/state.js';

// Decompose an InstancedMesh instance matrix and return its uniform scale.
// The strand builds each pixel with dummy.scale.setScalar(radius), so the
// matrix's uniform scale IS the rendered bulb/halo radius in world units.
function instanceScale(mesh, index = 0) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return scale.x;
}

function makeStrand(overrides = {}) {
  const scene = new THREE.Scene();
  const interactiveObjects = [];
  const config = Object.assign({
    name: 'LED_0',
    startX: -3, startY: 5, startZ: 0,
    endX: 3, endY: 5, endZ: 0,
    color: '#ff8800',
    ledCount: 10,
  }, overrides);
  const strand = new LedStrand(config, 0, scene, interactiveObjects);
  return { strand, scene, interactiveObjects, config };
}

function instancedMeshes(strand) {
  return strand.group.children.filter(c => c.isInstancedMesh);
}

test('no dark housing: no MeshStandardMaterial anywhere in the strand group', () => {
  const { strand } = makeStrand();
  for (const child of strand.group.children) {
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      assert.ok(m == null || !m.isMeshStandardMaterial,
        'strand must not build any MeshStandardMaterial (the old dark housing)');
    }
  }
});

test('exactly two InstancedMeshes (bulb + halo) each with count === ledCount', () => {
  const { strand } = makeStrand({ ledCount: 17 });
  const inst = instancedMeshes(strand);
  assert.equal(inst.length, 2, 'expected exactly 2 InstancedMeshes');
  for (const m of inst) assert.equal(m.count, 17, 'InstancedMesh.count must equal ledCount');
  assert.ok(strand.bulbInst && strand.bulbInst.isInstancedMesh, 'bulbInst set');
  assert.ok(strand.haloInst && strand.haloInst.isInstancedMesh, 'haloInst set');
});

test('bulb material is opaque + toneMapped:false (punches through ACES/bloom)', () => {
  const { strand } = makeStrand();
  const bulbMat = strand.bulbInst.material;
  assert.ok(bulbMat.isMeshBasicMaterial, 'bulb is MeshBasicMaterial');
  assert.equal(bulbMat.transparent, false, 'bulb must be OPAQUE (no dark core bleed-through)');
  assert.equal(bulbMat.toneMapped, false, 'bulb must skip tone mapping to punch through');
});

test('halo material matches the DMX additive BackSide recipe', () => {
  const { strand } = makeStrand();
  const haloMat = strand.haloInst.material;
  assert.ok(haloMat.isMeshBasicMaterial, 'halo is MeshBasicMaterial');
  assert.equal(haloMat.transparent, true, 'halo is transparent');
  assert.equal(haloMat.blending, THREE.AdditiveBlending, 'halo is additive');
  assert.equal(haloMat.depthWrite, false, 'halo does not write depth');
  assert.equal(haloMat.side, THREE.BackSide, 'halo renders only its far hemisphere (soft rim)');
});

test('setLedColorRGB writes the per-instance color on bulb + halo at that index', () => {
  const { strand } = makeStrand();
  strand.setLedColorRGB(3, 1, 0, 0);

  const c = new THREE.Color();
  strand.bulbInst.getColorAt(3, c);
  assert.ok(Math.abs(c.r - 1) < 1e-5 && c.g < 1e-5 && c.b < 1e-5, 'bulb instance 3 is red');
  strand.haloInst.getColorAt(3, c);
  assert.ok(Math.abs(c.r - 1) < 1e-5 && c.g < 1e-5 && c.b < 1e-5, 'halo instance 3 is red');

  // A different index stays at the strand's base color (not clobbered).
  strand.bulbInst.getColorAt(5, c);
  assert.ok(c.r > 0, 'untouched instance keeps its base color');
});

test('setLedColorRGBWAU white (w=1) mixes to the firmware toRGBFallback value', () => {
  const { strand } = makeStrand();
  strand.setLedColorRGBWAU(4, 0, 0, 0, 1, 0, 0);

  const [mr, mg, mb] = mixRgbwauToRgb(0, 0, 0, 1, 0, 0);
  assert.deepEqual([mr, mg, mb], [1, 1, 1], 'white channel mixes to full RGB');

  const c = new THREE.Color();
  strand.bulbInst.getColorAt(4, c);
  assert.ok(Math.abs(c.r - 1) < 1e-5 && Math.abs(c.g - 1) < 1e-5 && Math.abs(c.b - 1) < 1e-5,
    'RGBWAU white lights the pixel white');
});

test('guides hidden by default; selecting the strand shows the handles', () => {
  const { strand } = makeStrand();
  assert.equal(strand.startHandle.visible, false, 'start handle hidden in the beauty render');
  assert.equal(strand.endHandle.visible, false, 'end handle hidden in the beauty render');
  const wire = strand.group.children.find(c => c.userData._strandPart === 'wire');
  assert.ok(wire, 'wire guide exists for a non-degenerate strand');
  assert.equal(wire.visible, false, 'wire hidden by default');

  strand.setSelected(true);
  assert.equal(strand.startHandle.visible, true, 'selecting shows the start handle');
  assert.equal(strand.endHandle.visible, true, 'selecting shows the end handle');
  assert.equal(wire.visible, true, 'selecting shows the wire');
  const tube = strand.group.children.find(c => c.userData._strandPart === 'tube');
  assert.equal(tube.visible, true, 'the glow tube is a selection-only cue');

  strand.setSelected(false);
  assert.equal(strand.startHandle.visible, false, 'deselecting re-hides the handle');
});

test('the global guides toggle force-shows handles for an edit session', () => {
  const { strand } = makeStrand();
  strand.setGuidesVisible(true);
  assert.equal(strand.startHandle.visible, true, 'guides-on shows the handle without selecting');
});

test('degenerate zero-length strand builds and recolors without throwing', () => {
  // Regression for the old hardcoded ledStartIdx=2: with start === end there is
  // no wire and no tube, so child-index arithmetic mis-indexed the pixels.
  const { strand } = makeStrand({
    startX: 1, startY: 1, startZ: 1,
    endX: 1, endY: 1, endZ: 1,
    ledCount: 4,
  });
  assert.equal(instancedMeshes(strand).length, 2, 'pixels still build with zero length');
  assert.ok(!strand.group.children.some(c => c.userData._strandPart === 'wire'),
    'no wire for a zero-length strand');
  assert.doesNotThrow(() => strand.setLedColorRGB(0, 0, 1, 0), 'recolor must not throw');

  const c = new THREE.Color();
  strand.bulbInst.getColorAt(0, c);
  assert.ok(c.g > 0.9 && c.r < 1e-5, 'zero-length pixel 0 recolored green');
});

// The bulb + halo radius is now a GLOBAL control (params.ledPixelSize /
// params.ledHaloSize) applied to EVERY strand — not per-strand config. These
// mutate the shared `params` singleton, so each test deletes its keys after.
test('global ledPixelSize/ledHaloSize scale the bulb + halo geometry to those values', () => {
  const globalHalo = Number.isFinite(params.globalHaloScale) ? params.globalHaloScale : 1;
  params.ledPixelSize = 0.3;
  params.ledHaloSize = 0.9;
  try {
    const { strand } = makeStrand();
    assert.ok(Math.abs(instanceScale(strand.bulbInst) - 0.3) < 1e-6,
      'bulb radius follows params.ledPixelSize');
    assert.ok(Math.abs(instanceScale(strand.haloInst) - 0.9 * globalHalo) < 1e-6,
      'halo radius follows params.ledHaloSize (× global halo scale)');
  } finally {
    delete params.ledPixelSize;
    delete params.ledHaloSize;
  }
});

test('absent ledPixelSize/ledHaloSize fall back to the module defaults', () => {
  const globalHalo = Number.isFinite(params.globalHaloScale) ? params.globalHaloScale : 1;
  delete params.ledPixelSize;
  delete params.ledHaloSize;
  const { strand } = makeStrand();
  assert.ok(Math.abs(instanceScale(strand.bulbInst) - LED_BULB_RADIUS) < 1e-6,
    'bulb radius defaults to LED_BULB_RADIUS');
  assert.ok(Math.abs(instanceScale(strand.haloInst) - LED_HALO_RADIUS * globalHalo) < 1e-6,
    'halo radius defaults to LED_HALO_RADIUS');
});

test('invalid ledPixelSize/ledHaloSize (zero, negative, non-finite) fall back to defaults', () => {
  try {
    for (const bad of [0, -1, NaN, 'big', null]) {
      params.ledPixelSize = bad;
      params.ledHaloSize = bad;
      const { strand } = makeStrand();
      assert.ok(Math.abs(instanceScale(strand.bulbInst) - LED_BULB_RADIUS) < 1e-6,
        `ledPixelSize=${String(bad)} falls back to the default bulb radius`);
    }
  } finally {
    delete params.ledPixelSize;
    delete params.ledHaloSize;
  }
});

test('changing ledPixelSize/ledHaloSize and re-rendering updates the geometry live', () => {
  const globalHalo = Number.isFinite(params.globalHaloScale) ? params.globalHaloScale : 1;
  params.ledPixelSize = 0.08;
  params.ledHaloSize = 0.14;
  try {
    const { strand } = makeStrand();
    assert.ok(Math.abs(instanceScale(strand.bulbInst) - 0.08) < 1e-6, 'starts at 0.08');

    params.ledPixelSize = 0.25;
    params.ledHaloSize = 0.6;
    strand.applyVisualSize(); // the live-update path the GUI calls per fixture

    assert.ok(Math.abs(instanceScale(strand.bulbInst) - 0.25) < 1e-6,
      'bulb re-rendered to the new ledPixelSize');
    assert.ok(Math.abs(instanceScale(strand.haloInst) - 0.6 * globalHalo) < 1e-6,
      'halo re-rendered to the new ledHaloSize');
  } finally {
    delete params.ledPixelSize;
    delete params.ledHaloSize;
  }
});

test('destroy() removes the group + both handles and cleans interactiveObjects', () => {
  const { strand, scene, interactiveObjects } = makeStrand();
  assert.equal(interactiveObjects.length, 2, 'two draggable handles registered');
  assert.equal(scene.children.length, 3, 'group + 2 handles in the scene');

  strand.destroy();

  assert.equal(interactiveObjects.length, 0, 'handles removed from interactiveObjects');
  assert.ok(!scene.children.includes(strand.group), 'group removed from scene');
  assert.ok(!scene.children.includes(strand.startHandle), 'start handle removed');
  assert.ok(!scene.children.includes(strand.endHandle), 'end handle removed');
  assert.equal(strand.group.children.length, 0, 'group children disposed');
});
