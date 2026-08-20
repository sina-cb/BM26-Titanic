/**
 * trace_visual_gate.test.js — generator/trace preview visuals are authoring
 * furniture, not part of the show (20260725_79 → _81).
 *
 * `buildTraceObject` puts opaque `SphereGeometry r=0.3` preview dots at every
 * generated light position, tinted by the spacing gradient (blue → green →
 * RED), plus r=0.4 end handles at `#ff4400`. A UkingPar's bulb draws at 0.2223
 * and its halo at 0.4713, so in a beauty profile the dot COVERS the bulb and
 * leaves the fixture's own additive halo showing as a rim: a coloured ring
 * around a disk. The operator reported red rings around his pars three times in
 * one day before that was named.
 *
 * The rule these tests pin: beauty profiles (`emissive`, `full`) do not draw
 * them BY DEFAULT; every working profile still does; and the operator's own
 * "Show Generators" flip outranks the default in both directions, anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { traceVisualsShouldShow } from '../src/gui/trace_visual_gate.js';
import { LIGHTING_PROFILES, isBeautyProfile } from '../src/core/profile_registry.js';

const BEAUTY = ['emissive', 'full'];
const WORKING = ['edit', 'pixel_mapping', '2d_pixels'];

test('every profile is classified, and only the two beauty views are beauty', () => {
  // A new profile added later must be classified deliberately, not inherit a
  // silent default that puts authoring dots back into the show view.
  assert.deepEqual(Object.keys(LIGHTING_PROFILES).filter(isBeautyProfile).sort(),
    [...BEAUTY].sort());
  for (const id of WORKING) {
    assert.equal(isBeautyProfile(id), false, `${id} is a working profile`);
  }
});

test('DEFAULT: trace visuals are OFF in the beauty profiles', () => {
  for (const lightingProfile of BEAUTY) {
    assert.equal(
      traceVisualsShouldShow({ generatorsVisible: true, lightingProfile }), false,
      `${lightingProfile}: preview dots must not default into the view the ` +
      'operator judges the show by');
  }
});

test('DEFAULT: trace visuals are ON in every working profile — unchanged behaviour', () => {
  for (const lightingProfile of WORKING) {
    assert.equal(
      traceVisualsShouldShow({ generatorsVisible: true, lightingProfile }), true,
      `${lightingProfile}: authoring views keep their generator visuals`);
  }
});

test('the operator flipping "Show Generators" ON overrides the beauty default', () => {
  for (const lightingProfile of BEAUTY) {
    assert.equal(traceVisualsShouldShow({
      generatorsVisible: true, traceVisualsOperatorChoice: true, lightingProfile,
    }), true, `${lightingProfile}: an explicit choice wins — the toggle still works`);
  }
});

test('"Show Generators" OFF wins everywhere, choice or not', () => {
  for (const lightingProfile of [...BEAUTY, ...WORKING]) {
    assert.equal(traceVisualsShouldShow({
      generatorsVisible: false, lightingProfile,
    }), false, `${lightingProfile}: off is off`);
    assert.equal(traceVisualsShouldShow({
      generatorsVisible: false, traceVisualsOperatorChoice: true, lightingProfile,
    }), false, `${lightingProfile}: off is off even after an explicit flip`);
  }
});

test('par lights off still forces every trace visual off (pre-existing coupling)', () => {
  for (const lightingProfile of [...BEAUTY, ...WORKING]) {
    assert.equal(traceVisualsShouldShow({
      parsEnabled: false, generatorsVisible: true, traceVisualsOperatorChoice: true,
      lightingProfile,
    }), false, `${lightingProfile}: the par master outranks everything`);
  }
});

test('an unset generatorsVisible behaves as ON (the shipped scene default)', () => {
  // scenes/*.yaml ship generatorsVisible: true; a scene that omits it must not
  // change how the working profiles behave.
  assert.equal(traceVisualsShouldShow({ lightingProfile: 'edit' }), true);
  assert.equal(traceVisualsShouldShow({ lightingProfile: 'full' }), false);
});

test('the gate refuses to guess when it has no params', () => {
  assert.throws(() => traceVisualsShouldShow(), TypeError);
  assert.throws(() => traceVisualsShouldShow(null), TypeError);
});
