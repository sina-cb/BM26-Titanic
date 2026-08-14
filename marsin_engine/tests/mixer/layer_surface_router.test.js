import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LAYER_TRANSITION_DURATION_MS,
  LAYER_SETTING_IDS,
  LayerSurfaceRouter,
} from '../../lib/layer_surface_router.js';

const SETTINGS = Object.values(LAYER_SETTING_IDS);

function makeRouter(initialSetting = LAYER_SETTING_IDS.DECK) {
  let nowMs = 0;
  const events = [];
  const router = new LayerSurfaceRouter({
    initialSetting,
    defaultDurationMs: 1000,
    now: () => nowMs,
    onChange: event => events.push(event),
  });
  return {
    router,
    events,
    advance(ms) {
      nowMs += ms;
      router.tick(nowMs);
    },
  };
}

for (const from of SETTINGS) {
  for (const to of SETTINGS) {
    if (from === to) continue;
    test(`${from} -> ${to} uses the shared linear transition transaction`, () => {
      const harness = makeRouter(from);
      const result = harness.router.activate(to);

      assert.equal(result.status, 'started');
      assert.deepEqual(harness.router.participants(), [from, to]);
      assert.equal(harness.router.getState().transition.curve, 'linear');

      harness.advance(250);
      const quarter = harness.router.blend();
      assert.equal(quarter.from, from);
      assert.equal(quarter.to, to);
      assert.equal(quarter.amount, 0.25);

      harness.advance(250);
      harness.advance(250);
      harness.advance(250);
      assert.deepEqual(harness.router.participants(), [to]);
      assert.equal(harness.router.getState().active, to);
      assert.equal(harness.router.getState().transition, null);
    });
  }
}

test('a third setting is queued and never becomes a current render participant', () => {
  const harness = makeRouter(LAYER_SETTING_IDS.DECK);
  harness.router.activate(LAYER_SETTING_IDS.MIXER);
  harness.advance(250);

  const result = harness.router.activate(LAYER_SETTING_IDS.LIVE_TOUCH);
  assert.equal(result.status, 'queued');
  assert.deepEqual(harness.router.participants(), [LAYER_SETTING_IDS.DECK, LAYER_SETTING_IDS.MIXER]);
  assert.equal(harness.router.getState().queued, LAYER_SETTING_IDS.LIVE_TOUCH);

  harness.advance(250);
  harness.advance(250);
  harness.advance(250);
  assert.deepEqual(
    harness.router.participants(),
    [LAYER_SETTING_IDS.MIXER, LAYER_SETTING_IDS.LIVE_TOUCH],
  );
});

test('requesting the outgoing setting reverses without a discontinuity', () => {
  const harness = makeRouter(LAYER_SETTING_IDS.DECK);
  harness.router.activate(LAYER_SETTING_IDS.MIXER);
  harness.advance(250);
  const before = harness.router.blend();

  const result = harness.router.activate(LAYER_SETTING_IDS.DECK);
  const after = harness.router.blend();

  assert.equal(result.status, 'reversed');
  assert.equal(before.amount, 1 - after.amount);
  assert.equal(after.from, LAYER_SETTING_IDS.MIXER);
  assert.equal(after.to, LAYER_SETTING_IDS.DECK);
});

test('one active setting is a no-op and never starts a transition', () => {
  const harness = makeRouter(LAYER_SETTING_IDS.LIVE_TOUCH);
  const result = harness.router.activate(LAYER_SETTING_IDS.LIVE_TOUCH);
  assert.equal(result.status, 'active');
  assert.deepEqual(harness.router.participants(), [LAYER_SETTING_IDS.LIVE_TOUCH]);
  assert.equal(harness.router.getState().transition, null);
});

test('the operator setting-switch default is the measured 100 ms fast blend', () => {
  let nowMs = 0;
  const router = new LayerSurfaceRouter({
    initialSetting: LAYER_SETTING_IDS.DECK,
    now: () => nowMs,
  });
  router.activate(LAYER_SETTING_IDS.MIXER);
  assert.equal(DEFAULT_LAYER_TRANSITION_DURATION_MS, 100);
  assert.equal(router.getState().transition.durationMs, 100);
  nowMs = 100;
  router.tick(nowMs);
  assert.equal(router.getState().active, LAYER_SETTING_IDS.MIXER);
  assert.equal(router.getState().transition, null);
});

test('invalid setting and duration fail loudly before mutation', () => {
  const harness = makeRouter(LAYER_SETTING_IDS.DECK);
  assert.throws(() => harness.router.activate('other'), /Unknown layer setting/);
  assert.throws(
    () => harness.router.activate(LAYER_SETTING_IDS.MIXER, { durationMs: 0 }),
    /durationMs/,
  );
  assert.deepEqual(harness.router.participants(), [LAYER_SETTING_IDS.DECK]);
});

test('a long frame stall advances by at most 250 ms', () => {
  const harness = makeRouter(LAYER_SETTING_IDS.DECK);
  harness.router.activate(LAYER_SETTING_IDS.MIXER);
  harness.advance(5000);
  assert.equal(harness.router.getState().transition.progress, 0.25);
});
