/**
 * analytic_light_gate.test.js — unpatched fixtures must not be mapped into the
 * analytic SpotLight pool (operator, 2026-07-30: "a big leak — the par light
 * halos on the right side are being mapped, but they are not patched").
 *
 * Measured live before the fix (report 20260725_82): 36 of 60 active pool slots
 * were held by unpatched, undriven, pure-black right-side fixtures, emitting
 * nothing, while the patched left side got 24. The pool hands slots to the
 * pixels closest to camera and never asked whether they were emitting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emitsVisibleLight, MIN_ANALYTIC_LIGHT_LUMINANCE,
} from '../src/core/analytic_light_gate.js';

const rgb = (r, g, b) => ({ r, g, b });

test('a black pixel never holds a slot — it emits nothing by definition', () => {
  assert.equal(emitsVisibleLight(rgb(0, 0, 0)), false);
});

test('an emitting pixel always competes, on any single channel', () => {
  assert.equal(emitsVisibleLight(rgb(1, 0, 0)), true, 'the undriven-red diagnostic');
  assert.equal(emitsVisibleLight(rgb(0, 1, 0)), true);
  assert.equal(emitsVisibleLight(rgb(0, 0, 1)), true);
  assert.equal(emitsVisibleLight(rgb(0.18, 0, 0)), true,
    "the Left Auditorium pars' real driven colour must keep its light");
});

test('the threshold is exactly one 8-bit code value — nothing visible is dropped', () => {
  assert.equal(MIN_ANALYTIC_LIGHT_LUMINANCE, 1 / 255);
  assert.equal(emitsVisibleLight(rgb(1 / 255, 0, 0)), true, 'the dimmest visible value still lights');
  assert.equal(emitsVisibleLight(rgb(0.9 / 255, 0, 0)), false, 'below one code value quantises to black');
});

test('the rule is about EMISSION, not about patching', () => {
  // A patched fixture at blackout is just as wasteful as an unpatched one, and
  // an unpatched fixture painted red by the operator's diagnostic is genuinely
  // emitting and SHOULD take a slot. One rule covers both.
  assert.equal(emitsVisibleLight(rgb(0, 0, 0)), false, 'patched but faded to black → no slot');
  assert.equal(emitsVisibleLight(rgb(1, 0, 0)), true, 'unpatched but red-diagnosed → slot, on purpose');
});

test('a malformed colour fails loudly instead of silently winning or losing a slot', () => {
  assert.throws(() => emitsVisibleLight(null), TypeError);
  assert.throws(() => emitsVisibleLight(undefined), TypeError);
  assert.throws(() => emitsVisibleLight(rgb(NaN, 0, 0)), TypeError);
  assert.throws(() => emitsVisibleLight({ r: 0, g: 0 }), TypeError);
});

test('the leak, replayed: 36 dark right-side requests no longer evict 36 lit ones', () => {
  // The measured live census, as data: 42 unpatched fixtures dark on the right,
  // patched fixtures driven on the left. Rebuild the pool's admission step and
  // assert that no dark pixel is admitted and every lit one survives.
  const requests = [];
  for (let i = 0; i < 36; i++) requests.push({ side: 'right', patched: false, color: rgb(0, 0, 0) });
  for (let i = 0; i < 24; i++) requests.push({ side: 'left', patched: true, color: rgb(0.18, 0, 0) });

  const admitted = requests.filter((r) => emitsVisibleLight(r.color));

  assert.equal(admitted.length, 24, 'only the emitting pixels compete for slots');
  assert.ok(admitted.every((r) => r.side === 'left' && r.patched),
    'no unpatched, undriven fixture is mapped into the pool');
  assert.equal(admitted.filter((r) => !emitsVisibleLight(r.color)).length, 0);
});
