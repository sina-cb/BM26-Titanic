// Unit tests for the additive PatternChannel fields from the channel_features
// wave: faderMax (F-C) and color (F-D). Pins the constructor defaults +
// validation so absent/garbage values resolve to the documented schema
// defaults (NOT a silent fallback — a default value IS the schema).
//
// Run:  cd marsin_engine && node --test tests/channel_feature_fields.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../lib/pattern_channel.js';

function ch(extra = {}) {
  return new PatternChannel({ id: 'c1', name: 'C', pattern: 'p', ...extra });
}

test('faderMax defaults to 1.0 when absent', () => {
  assert.equal(ch().faderMax, 1.0);
});

test('color defaults to null when absent', () => {
  assert.equal(ch().color, null);
});

test('faderMax round-trips a valid value', () => {
  assert.equal(ch({ faderMax: 0.6 }).faderMax, 0.6);
});

test('faderMax clamps out-of-range values to [0,1]', () => {
  assert.equal(ch({ faderMax: 2.0 }).faderMax, 1.0);
  assert.equal(ch({ faderMax: -1.0 }).faderMax, 0.0);
});

test('a non-finite / non-number faderMax falls back to the 1.0 default', () => {
  assert.equal(ch({ faderMax: NaN }).faderMax, 1.0);
  assert.equal(ch({ faderMax: 'oops' }).faderMax, 1.0);
});

test('color round-trips a string', () => {
  assert.equal(ch({ color: '#00ff00' }).color, '#00ff00');
});

test('a non-string color resolves to null', () => {
  assert.equal(ch({ color: 42 }).color, null);
  assert.equal(ch({ color: {} }).color, null);
});
