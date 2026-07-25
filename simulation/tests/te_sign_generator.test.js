/**
 * Tests for the TE Sign fixture-pair generator (src/fixtures/te_sign_generator.js).
 *
 * The load-bearing invariant: the two halves (Side A, Side B) ALWAYS carry the
 * identical transform (position/rotation/scale). x/y/z place the WHOLE sign as
 * one rigid unit — never a per-half offset. Plus: fail-loud param validation
 * (no fallbacks, codex P0).
 *
 * Pure module — plain objects only, no DOM/THREE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTeSign,
  applyTeSignPlacement,
  resolveTeSignOptions,
  TE_SIGN_DEFAULTS,
  TE_SIGN_TYPE_A,
  TE_SIGN_TYPE_B,
} from '../src/fixtures/te_sign_generator.js';

const TRANSFORM_KEYS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'];

function transformOf(cfg) {
  const t = {};
  for (const k of TRANSFORM_KEYS) t[k] = cfg[k];
  return t;
}

// ── Shape ─────────────────────────────────────────────────────────────

test('buildTeSign: returns exactly two configs, Side A then Side B', () => {
  const pair = buildTeSign();
  assert.equal(pair.length, 2);
  const [a, b] = pair;
  assert.equal(a.fixtureType, TE_SIGN_TYPE_A);
  assert.equal(b.fixtureType, TE_SIGN_TYPE_B);
  assert.equal(a.name, 'TE Sign V3 A');
  assert.equal(b.name, 'TE Sign V3 B');
  // Both halves share one group — the grouping-parity acceptance case.
  assert.equal(a.group, 'TE Sign');
  assert.equal(b.group, 'TE Sign');
  // Not trace-generated, enabled by default.
  assert.equal(a.traceGenerated, false);
  assert.equal(b.enabled, true);
});

// ── HARD INVARIANT: A ≡ B transform ───────────────────────────────────

test('buildTeSign: Side A and Side B carry IDENTICAL transforms (default)', () => {
  const [a, b] = buildTeSign();
  assert.deepEqual(transformOf(a), transformOf(b));
});

test('buildTeSign: A ≡ B transform holds for arbitrary placements', () => {
  for (const p of [
    { x: 5, y: 3, z: -2 },
    { x: -12.5, y: 0, z: 40, rotY: 90 },
    { x: 100, y: -100, z: 100, rotX: 45, rotY: 180, rotZ: -30, scaleX: 2, scaleY: 0.5, scaleZ: 3 },
  ]) {
    const [a, b] = buildTeSign(p);
    assert.deepEqual(transformOf(a), transformOf(b),
      `A and B must be identical for placement ${JSON.stringify(p)}`);
  }
});

// ── x/y/z place the WHOLE sign (not a per-half offset) ─────────────────

test('buildTeSign: x/y/z set both halves to the same location (whole-sign move)', () => {
  const [a, b] = buildTeSign({ x: 7, y: 11, z: -4 });
  for (const cfg of [a, b]) {
    assert.equal(cfg.x, 7);
    assert.equal(cfg.y, 11);
    assert.equal(cfg.z, -4);
  }
  // Neither half is offset from the other along any axis.
  assert.equal(a.x - b.x, 0);
  assert.equal(a.y - b.y, 0);
  assert.equal(a.z - b.z, 0);
});

test('buildTeSign: defaults reuse the shipped centered pose', () => {
  const [a] = buildTeSign();
  assert.equal(a.x, TE_SIGN_DEFAULTS.x);
  assert.equal(a.y, TE_SIGN_DEFAULTS.y);
  assert.equal(a.z, TE_SIGN_DEFAULTS.z);
  assert.equal(a.rotY, 180);
});

// ── Overrides ─────────────────────────────────────────────────────────

test('buildTeSign: name/group/type overrides propagate to both halves', () => {
  const [a, b] = buildTeSign({ name: 'Bow Sign', group: 'Signs', color: '#ff0000' });
  assert.equal(a.name, 'Bow Sign A');
  assert.equal(b.name, 'Bow Sign B');
  assert.equal(a.group, 'Signs');
  assert.equal(b.group, 'Signs');
  assert.equal(a.color, '#ff0000');
  assert.equal(b.color, '#ff0000');
});

// ── Fail-loud validation (no fallbacks) ───────────────────────────────

test('resolveTeSignOptions: non-finite placement throws', () => {
  assert.throws(() => buildTeSign({ x: 'nope' }), /'x' must be a finite number/);
  assert.throws(() => buildTeSign({ y: NaN }), /'y' must be a finite number/);
  assert.throws(() => buildTeSign({ z: Infinity }), /'z' must be a finite number/);
  assert.throws(() => buildTeSign({ rotY: null }), /'rotY' must be a finite number/);
});

test('resolveTeSignOptions: non-positive scale throws', () => {
  assert.throws(() => buildTeSign({ scaleX: 0 }), /'scaleX' must be > 0/);
  assert.throws(() => buildTeSign({ scaleY: -1 }), /'scaleY' must be > 0/);
});

test('resolveTeSignOptions: empty name/group throws', () => {
  assert.throws(() => buildTeSign({ name: '' }), /'name' must be a non-empty string/);
  assert.throws(() => buildTeSign({ group: '   ' }), /'group' must be a non-empty string/);
});

test('resolveTeSignOptions: non-object opts throws', () => {
  assert.throws(() => resolveTeSignOptions(null), /options must be an object/);
  assert.throws(() => resolveTeSignOptions(42), /options must be an object/);
});

// ── applyTeSignPlacement: rigid re-placement after instantiation ──────

test('applyTeSignPlacement: overwrites both halves with one identical transform', () => {
  const pair = buildTeSign({ x: 0, y: 9, z: 17 });
  applyTeSignPlacement(pair, { x: 20, y: 5, z: -3, rotY: 90 });
  const [a, b] = pair;
  assert.equal(a.x, 20);
  assert.equal(a.rotY, 90);
  assert.deepEqual(transformOf(a), transformOf(b));
});

test('applyTeSignPlacement: empty/invalid input throws', () => {
  assert.throws(() => applyTeSignPlacement([], { x: 1 }), /non-empty array/);
  assert.throws(() => applyTeSignPlacement('nope', { x: 1 }), /non-empty array/);
  assert.throws(() => applyTeSignPlacement([null], { x: 1 }), /every fixture must be an object/);
});
