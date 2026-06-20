// Unit tests for the fader + swap-transition input validators (engine
// hardening, slot 2). These pin the Codex P0 "no silent fallback" contract:
// a non-finite fader/duration must be REJECTED, not coerced; an out-of-range
// finite fader must be CLAMPED, not rejected. Pure-function tests — no engine
// boot, no WASM, no disk.
//
// Run:  node --test tests/channel_validation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateFader,
  validateSwapTransitionOverride,
  DECK_TRANSITION_MIN_MS,
  DECK_TRANSITION_MAX_MS,
} from '../lib/api_server.js';

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

// ── validateSwapTransitionOverride ─────────────────────────────────────

const BASE = Object.freeze({
  enabled: true, shuffle: false, mode: 'trans_crossfade', durationMs: 1000,
});

test('null/undefined override returns a copy of base (existing behavior)', () => {
  for (const ov of [null, undefined]) {
    const r = validateSwapTransitionOverride(ov, BASE);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, BASE);
    assert.notEqual(r.value, BASE, 'must be a fresh object, not the base ref');
  }
});

test('override merges only provided fields onto base', () => {
  const r = validateSwapTransitionOverride({ durationMs: 2500 }, BASE);
  assert.equal(r.ok, true);
  assert.equal(r.value.durationMs, 2500);
  assert.equal(r.value.mode, 'trans_crossfade', 'untouched field keeps base value');
  assert.equal(r.value.enabled, true);
});

test('override does NOT mutate the base config', () => {
  const base = { enabled: false, shuffle: false, mode: 'trans_crossfade', durationMs: 1000 };
  validateSwapTransitionOverride({ enabled: true, durationMs: 5000 }, base);
  assert.equal(base.enabled, false, 'base.enabled mutated');
  assert.equal(base.durationMs, 1000, 'base.durationMs mutated');
});

test('override clamps durationMs to [min,max]', () => {
  assert.equal(validateSwapTransitionOverride({ durationMs: 1 }, BASE).value.durationMs,
    DECK_TRANSITION_MIN_MS);
  assert.equal(validateSwapTransitionOverride({ durationMs: 99999999 }, BASE).value.durationMs,
    DECK_TRANSITION_MAX_MS);
});

test('override REJECTS non-finite durationMs (no silent fallback)', () => {
  for (const bad of ['abc', NaN, Infinity]) {
    const r = validateSwapTransitionOverride({ durationMs: bad }, BASE);
    assert.equal(r.ok, false, `durationMs ${String(bad)} must reject`);
    assert.match(r.error, /finite number/);
  }
});

test('override REJECTS a non-trans_ mode', () => {
  for (const bad of ['blend_screen', 'crossfade', 'multiply', '']) {
    const r = validateSwapTransitionOverride({ mode: bad }, BASE);
    assert.equal(r.ok, false, `mode '${bad}' must reject`);
    assert.match(r.error, /trans_\*/);
  }
});

test('override accepts a valid trans_ mode', () => {
  const r = validateSwapTransitionOverride({ mode: 'trans_iris_close' }, BASE);
  assert.equal(r.ok, true);
  assert.equal(r.value.mode, 'trans_iris_close');
});

test('override REJECTS non-boolean enabled/shuffle and non-object override', () => {
  assert.equal(validateSwapTransitionOverride({ enabled: 'yes' }, BASE).ok, false);
  assert.equal(validateSwapTransitionOverride({ shuffle: 1 }, BASE).ok, false);
  assert.equal(validateSwapTransitionOverride('nope', BASE).ok, false);
  assert.equal(validateSwapTransitionOverride([1, 2], BASE).ok, false);
});
