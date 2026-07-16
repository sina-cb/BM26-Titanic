// Unit tests for the pure SessionParamCache module (feature A). No engine
// spawn — exercises store/get/merge/clear semantics directly.
// Run:  node --test tests/session_param_cache.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionParamCache } from '../../lib/session_param_cache.js';

test('store + get round-trips a control map', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.5, v1: 0, v2: 0 } });
  assert.deepEqual(c.get('ch1', 'patA'), { 7: { v0: 0.5, v1: 0, v2: 0 } });
});

test('get returns null for unknown channel / pattern', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.5, v1: 0, v2: 0 } });
  assert.equal(c.get('chX', 'patA'), null);
  assert.equal(c.get('ch1', 'patZ'), null);
  assert.equal(c.get('ch1', 'patA') !== null, true);
});

test('store MERGES per control — latest write per control wins, others kept', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.1, v1: 0, v2: 0 }, 8: { v0: 0.2, v1: 0, v2: 0 } });
  c.store('ch1', 'patA', { 7: { v0: 0.9, v1: 0, v2: 0 } }); // update 7, keep 8
  assert.deepEqual(c.get('ch1', 'patA'), {
    7: { v0: 0.9, v1: 0, v2: 0 },
    8: { v0: 0.2, v1: 0, v2: 0 },
  });
});

test('store with empty / null controls is a no-op (never erases prior intent)', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.5, v1: 0, v2: 0 } });
  c.store('ch1', 'patA', {});
  c.store('ch1', 'patA', null);
  assert.deepEqual(c.get('ch1', 'patA'), { 7: { v0: 0.5, v1: 0, v2: 0 } });
});

test('store with missing channelId / patternName is a no-op', () => {
  const c = new SessionParamCache();
  c.store(null, 'patA', { 7: { v0: 0.5 } });
  c.store('ch1', null, { 7: { v0: 0.5 } });
  assert.equal(c.size(), 0);
});

test('per-pattern isolation: two patterns on one channel do not collide', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.1, v1: 0, v2: 0 } });
  c.store('ch1', 'patB', { 7: { v0: 0.8, v1: 0, v2: 0 } });
  assert.equal(c.get('ch1', 'patA')[7].v0, 0.1);
  assert.equal(c.get('ch1', 'patB')[7].v0, 0.8);
});

test('clearPattern drops one (channel, pattern) but leaves siblings', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.1 } });
  c.store('ch1', 'patB', { 7: { v0: 0.8 } });
  c.clearPattern('ch1', 'patA');
  assert.equal(c.get('ch1', 'patA'), null);
  assert.equal(c.get('ch1', 'patB') !== null, true);
});

test('clearChannel drops every pattern for a channel, other channels untouched', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.1 } });
  c.store('ch1', 'patB', { 7: { v0: 0.2 } });
  c.store('ch2', 'patA', { 7: { v0: 0.3 } });
  c.clearChannel('ch1');
  assert.equal(c.get('ch1', 'patA'), null);
  assert.equal(c.get('ch1', 'patB'), null);
  assert.equal(c.get('ch2', 'patA')[7].v0, 0.3);
});

test('clearAll empties the whole cache', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 7: { v0: 0.1 } });
  c.store('ch2', 'patB', { 8: { v0: 0.2 } });
  c.clearAll();
  assert.equal(c.size(), 0);
  assert.equal(c.get('ch1', 'patA'), null);
});

test('size counts (channel, pattern) entries', () => {
  const c = new SessionParamCache();
  assert.equal(c.size(), 0);
  c.store('ch1', 'patA', { 7: { v0: 0.1 } });
  c.store('ch1', 'patB', { 7: { v0: 0.2 } });
  c.store('ch2', 'patA', { 7: { v0: 0.3 } });
  assert.equal(c.size(), 3);
});

test('hsv (3-component) control values are preserved through store/get', () => {
  const c = new SessionParamCache();
  c.store('ch1', 'patA', { 5: { v0: 0.3, v1: 0.6, v2: 0.9 } });
  assert.deepEqual(c.get('ch1', 'patA')[5], { v0: 0.3, v1: 0.6, v2: 0.9 });
});
