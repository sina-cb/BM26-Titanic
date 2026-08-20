import assert from 'node:assert/strict';
import test from 'node:test';

import { LiveBrightnessController } from '../../lib/live_brightness_controller.js';
import {
  groupsByNameToSectionMap,
  serializeTouchBrightness,
  statusForTouchBrightnessError,
} from '../../lib/touch_brightness_api.js';

const groups = { Bow: 11, Stern: 22 };

test('stable group names resolve to exhaustive section factors', () => {
  assert.deepEqual(
    groupsByNameToSectionMap({ Bow: 0.3, Stern: 0.8 }, groups, true),
    new Map([[11, 0.3], [22, 0.8]]),
  );
  assert.throws(
    () => groupsByNameToSectionMap({ Bow: 0.3 }, groups, true),
    /all 2 model groups/,
  );
  assert.throws(
    () => groupsByNameToSectionMap({ Bow: 0.3, Nope: 0.8 }, groups, true),
    /unknown Dimmer Rack group 'Nope'/,
  );
});

test('partial group patches are non-empty and strict', () => {
  assert.deepEqual(groupsByNameToSectionMap({ Stern: 0 }, groups, false), new Map([[22, 0]]));
  assert.throws(() => groupsByNameToSectionMap({}, groups, false), /at least one group/);
  assert.throws(
    () => groupsByNameToSectionMap({ Bow: Number.NaN }, groups, false),
    /finite number/,
  );
});

test('serialized operator truth includes rack ceilings and effective caps', () => {
  const controller = new LiveBrightnessController();
  const activated = controller.activate('touch_a', [11, 22]);
  controller.replace('touch_a', activated.revision, 0.5, new Map([[11, 0.4], [22, 1]]));
  assert.deepEqual(serializeTouchBrightness(controller, groups, { 11: 0.3, 22: 0.8 }), {
    active: true,
    ownerId: 'touch_a',
    revision: 2,
    master: 0.5,
    groups: { Bow: 0.4, Stern: 1 },
    rackCeilings: { Bow: 0.3, Stern: 0.8 },
    effectiveCaps: { Bow: 0.06, Stern: 0.4 },
    masterFade: null,
  });
});

test('typed state errors map to conflict/forbidden statuses', () => {
  assert.equal(statusForTouchBrightnessError({ code: 'TOUCH_BRIGHTNESS_STALE_REVISION' }), 409);
  assert.equal(statusForTouchBrightnessError({ code: 'TOUCH_BRIGHTNESS_INACTIVE' }), 409);
  assert.equal(statusForTouchBrightnessError({ code: 'TOUCH_BRIGHTNESS_WRONG_OWNER' }), 403);
  assert.equal(statusForTouchBrightnessError(new Error('bad input')), 400);
});
