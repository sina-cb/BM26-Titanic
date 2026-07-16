// Unit tests for the fader input validator (engine hardening, slot 2).
// These pin the Codex P0 "no silent fallback" contract:
// a non-finite fader/duration must be REJECTED, not coerced; an out-of-range
// finite fader must be CLAMPED, not rejected. Pure-function tests — no engine
// boot, no WASM, no disk.
//
// Run:  node --test tests/channel_validation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateFader,
} from '../../lib/api_server.js';

// ── validateFader ──────────────────────────────────────────────────────

test('validateFader accepts in-range numbers unchanged', () => {
  for (const v of [0, 0.25, 0.5, 1]) {
    const r = validateFader(v);
    assert.equal(r.ok, true, `${v} should be ok`);
    assert.equal(r.value, v);
  }
});

test('validateFader accepts numeric strings (coerced) in range', () => {
  const r = validateFader('0.5');
  assert.equal(r.ok, true);
  assert.equal(r.value, 0.5);
});

test('validateFader CLAMPS finite out-of-range (benign saturation)', () => {
  assert.deepEqual(validateFader(1.5), { ok: true, value: 1 });
  assert.deepEqual(validateFader(-0.2), { ok: true, value: 0 });
  assert.deepEqual(validateFader(1000), { ok: true, value: 1 });
});

test('validateFader REJECTS non-finite (no silent fallback)', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'abc', undefined, null, {}, [], 'NaN']) {
    const r = validateFader(bad);
    assert.equal(r.ok, false, `${String(bad)} must be rejected`);
    assert.match(r.error, /finite number/);
  }
});
