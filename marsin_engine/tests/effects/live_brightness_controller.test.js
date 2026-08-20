import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LiveBrightnessController,
  modelGroupSectionMap,
  sameModelGroupSections,
} from '../../lib/live_brightness_controller.js';

function pixel(sectionId, value = 1) {
  return { sId: sectionId, r: value, g: value, b: value, w: value, a: value, u: value };
}

test('Live Touch brightness is neutral and inactive at boot', () => {
  const controller = new LiveBrightnessController();
  const pixels = [pixel(1, 0.6)];
  controller.apply(pixels);
  assert.deepEqual(pixels, [pixel(1, 0.6)]);
  assert.deepEqual(controller.getState(), {
    active: false,
    ownerId: null,
    revision: 0,
    master: 1,
    groupsBySectionId: new Map(),
    masterFade: null,
  });
});

test('group and master multiply every lane and clamp creative overshoot first', () => {
  const controller = new LiveBrightnessController();
  const activated = controller.activate('touch_a', [11, 22]);
  controller.replace('touch_a', activated.revision, 0.5, new Map([[11, 0.5], [22, 1]]));
  const pixels = [pixel(11, 2), pixel(22, 0.8)];
  controller.apply(pixels);
  for (const lane of ['r', 'g', 'b', 'w', 'a', 'u']) {
    assert.equal(pixels[0][lane], 0.25);
    assert.equal(pixels[1][lane], 0.4);
  }
});

test('Uint8 Live Touch render buffer is scaled before the shared crossfade', () => {
  const controller = new LiveBrightnessController();
  const activated = controller.activate('touch_a', [11, 22]);
  controller.replace('touch_a', activated.revision, 0.5, new Map([[11, 0.5], [22, 1]]));
  const buffer = new Uint8Array([
    200, 200, 200, 200, 200, 200,
    200, 200, 200, 200, 200, 200,
  ]);
  controller.applyBuffer(buffer, [{ sId: 11 }, { sId: 22 }]);
  assert.deepEqual(
    [...buffer],
    [50, 50, 50, 50, 50, 50, 100, 100, 100, 100, 100, 100],
  );
});

test('Uint8 render buffer refuses a model-size mismatch', () => {
  const controller = new LiveBrightnessController();
  controller.activate('touch_a', [11]);
  assert.throws(
    () => controller.applyBuffer(new Uint8Array(6), [{ sId: 11 }, { sId: 11 }]),
    /output\/model size mismatch/,
  );
});

test('active brightness refuses unknown model sections instead of bypassing them', () => {
  const controller = new LiveBrightnessController();
  controller.activate('touch_a', [11]);
  assert.throws(() => controller.apply([pixel(22)]), /no factor for sectionId 22/);
  assert.throws(
    () => controller.applyBuffer(new Uint8Array(6), [{ sId: 22 }]),
    /no factor for sectionId 22/,
  );
});

test('armed model reload compatibility is keyed by stable group name and section id', () => {
  const current = [
    { group: 'Hull', sId: 11 },
    { group: 'Hull', sId: 11 },
    { group: 'Sign', sId: 22 },
  ];
  assert.deepEqual(modelGroupSectionMap(current), new Map([['Hull', 11], ['Sign', 22]]));
  assert.equal(sameModelGroupSections(current, [...current].reverse()), true);
  assert.equal(sameModelGroupSections(current, [
    { group: 'Hull', sId: 22 }, { group: 'Sign', sId: 11 },
  ]), false);
  assert.throws(() => modelGroupSectionMap([
    { group: 'Hull', sId: 11 }, { group: 'Hull', sId: 12 },
  ]), /spans sectionIds/);
});

test('replace is exhaustive and atomic', () => {
  const controller = new LiveBrightnessController();
  const activated = controller.activate('touch_a', [11, 22]);
  assert.throws(
    () => controller.replace('touch_a', activated.revision, 0.5, new Map([[11, 0.2]])),
    /requires 2 groups/,
  );
  const state = controller.getState();
  assert.equal(state.master, 1);
  assert.deepEqual(state.groupsBySectionId, new Map([[11, 1], [22, 1]]));
  assert.equal(state.revision, activated.revision);
});

test('patch rejects stale revision, wrong owner, unknown groups, and invalid values atomically', () => {
  const controller = new LiveBrightnessController();
  const activated = controller.activate('touch_a', [11]);
  assert.throws(
    () => controller.patch('touch_b', activated.revision, { master: 0.5 }),
    /owned by 'touch_a'/,
  );
  assert.throws(
    () => controller.patch('touch_a', activated.revision - 1, { master: 0.5 }),
    /stale Live Touch brightness revision/,
  );
  assert.throws(
    () => controller.patch('touch_a', activated.revision, {
      master: 0.5,
      groupsBySectionId: new Map([[99, 0.5]]),
    }),
    /unknown Live Touch sectionId 99/,
  );
  assert.throws(
    () => controller.patch('touch_a', activated.revision, { master: Number.NaN }),
    /master must be a finite number/,
  );
  assert.throws(
    () => controller.patch('touch_a', activated.revision, {
      master: 0.5,
      groupsBySectionId: { 11: 0.5 },
    }),
    /groupsBySectionId must be a Map/,
  );
  const unchanged = controller.getState();
  assert.equal(unchanged.master, 1);
  assert.deepEqual(unchanged.groupsBySectionId, new Map([[11, 1]]));
  assert.equal(unchanged.revision, activated.revision);
});

test('master fade is engine-clocked and lands exactly', () => {
  let now = 1000;
  const controller = new LiveBrightnessController(() => now);
  const activated = controller.activate('touch_a', [11]);
  const fading = controller.startMasterFade('touch_a', activated.revision, 0, 1000);
  assert.equal(fading.master, 1);
  now = 1500;
  assert.equal(controller.getState().master, 0.5);
  now = 2000;
  const landed = controller.getState();
  assert.equal(landed.master, 0);
  assert.equal(landed.masterFade, null);
});

test('master fade never extrapolates when the host clock moves backwards', () => {
  let now = 1000;
  const controller = new LiveBrightnessController(() => now);
  const activated = controller.activate('touch_a', [11]);
  controller.startMasterFade('touch_a', activated.revision, 0, 1000);
  now = 900;
  assert.equal(controller.getState().master, 1);
});

test('reset is neutral, clears ownership, and prevents stale writes', () => {
  const controller = new LiveBrightnessController();
  const activated = controller.activate('touch_a', [11]);
  const changed = controller.patch('touch_a', activated.revision, { master: 0.25 });
  const reset = controller.reset('touch_a');
  assert.equal(reset.active, false);
  assert.equal(reset.ownerId, null);
  assert.equal(reset.master, 1);
  assert.deepEqual(reset.groupsBySectionId, new Map());
  assert.equal(reset.revision, changed.revision + 1);
  assert.throws(
    () => controller.patch('touch_a', reset.revision, { master: 1 }),
    /not active/,
  );
});
