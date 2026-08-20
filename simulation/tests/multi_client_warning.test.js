/**
 * multi_client_warning.test.js — pure-state tests for the multi-client
 * contention banner (src/gui/multi_client_warning.js), 2026-07-24 operator
 * decision: >1 connected sim window must warn loudly in every window.
 * DOM-free: covers bannerStateForCount across the census transitions the
 * bridge broadcasts (1→2→3→1→0 and the unknown/disconnected census).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { bannerStateForCount } from '../src/gui/multi_client_warning.js';

test('single client (the production norm) shows no banner', () => {
  assert.deepEqual(bannerStateForCount(1), { show: false, text: '' });
});

test('zero clients shows no banner', () => {
  assert.deepEqual(bannerStateForCount(0), { show: false, text: '' });
});

test('two clients warns with the count', () => {
  const s = bannerStateForCount(2);
  assert.equal(s.show, true);
  assert.match(s.text, /2 sim windows connected/);
  assert.match(s.text, /contention risk/);
});

test('census transition 1→2→3→1 tracks show state and count text', () => {
  assert.equal(bannerStateForCount(1).show, false);
  assert.equal(bannerStateForCount(2).show, true);
  const three = bannerStateForCount(3);
  assert.equal(three.show, true);
  assert.match(three.text, /3 sim windows connected/);
  assert.equal(bannerStateForCount(1).show, false); // recovery hides it
});

test('unknown census (bridge connection lost) hides rather than screams stale state', () => {
  assert.deepEqual(bannerStateForCount(null), { show: false, text: '' });
  assert.deepEqual(bannerStateForCount(undefined), { show: false, text: '' });
  assert.deepEqual(bannerStateForCount(NaN), { show: false, text: '' });
  assert.deepEqual(bannerStateForCount('garbage'), { show: false, text: '' });
});

test('fractional/string counts are floored into the text, not crashed on', () => {
  assert.match(bannerStateForCount('4').text, /4 sim windows/);
  assert.match(bannerStateForCount(2.9).text, /2 sim windows/);
});
