// Tests for lib/name_id_registry.js — the shared compile-time
// name → id substrate that both MASK_* (view masks) and FIX_* (fixture
// types) register onto. The MASK_-facing facade is covered separately by
// view_mask_constants.test.js; these tests pin the prefix-agnostic core
// and prove it works for an arbitrary prefix (FIX_).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeName,
  buildConstantTable,
  injectConstants,
} from '../lib/name_id_registry.js';

// ── sanitizeName ──────────────────────────────────────────────────

test('sanitizeName: prefix + camelCase split', () => {
  assert.equal(sanitizeName('MASK', 'RedwoodPARs'), 'MASK_REDWOOD_PARS');
  assert.equal(sanitizeName('FIX', 'UkingPar'), 'FIX_UKING_PAR');
  assert.equal(sanitizeName('FIX', 'VintageLed'), 'FIX_VINTAGE_LED');
});

test('sanitizeName: spaces/underscores collapse, digits survive', () => {
  assert.equal(sanitizeName('FIX', 'Bar 18'), 'FIX_BAR_18');
  assert.equal(sanitizeName('MASK', 'DJ Lights'), 'MASK_DJ_LIGHTS');
  assert.equal(sanitizeName('FIX', 'Redwoods1'), 'FIX_REDWOODS1');
});

test('sanitizeName: empty body throws', () => {
  assert.throws(() => sanitizeName('FIX', '***'), /empty constant name/);
});

test('sanitizeName: empty prefix throws', () => {
  assert.throws(() => sanitizeName('', 'Foo'), /non-empty string/);
});

// ── buildConstantTable ────────────────────────────────────────────

test('buildConstantTable: builds { PREFIX_NAME: value }', () => {
  const t = buildConstantTable('FIX', [
    { name: 'Par', value: 1, origin: 'fixtureType' },
    { name: 'Bar 18', value: 2, origin: 'fixtureType' },
  ]);
  assert.deepEqual(t, { FIX_PAR: 1, FIX_BAR_18: 2 });
});

test('buildConstantTable: same name + same value dedupes', () => {
  const t = buildConstantTable('FIX', [
    { name: 'Par', value: 1 },
    { name: 'Par', value: 1 },
  ]);
  assert.deepEqual(t, { FIX_PAR: 1 });
});

test('buildConstantTable: sanitized collision with different values throws', () => {
  assert.throws(() => buildConstantTable('FIX', [
    { name: 'Bar 18', value: 2 },
    { name: 'Bar_18', value: 3 },
  ]), /collision/);
});

test('buildConstantTable: non-integer / nameless entries are skipped', () => {
  const t = buildConstantTable('FIX', [
    { name: 'Par', value: 1 },
    { name: 'Bad', value: 1.5 },
    { value: 2 },
    null,
  ]);
  assert.deepEqual(t, { FIX_PAR: 1 });
});

// ── injectConstants ───────────────────────────────────────────────

const FIX_TABLE = { FIX_PAR: 2, FIX_BAR_18: 4 };

test('injectConstants: no PREFIX_* references → source unchanged', () => {
  const src = 'export function render(index) { rgb(1, 0, 0); }';
  assert.equal(injectConstants(src, FIX_TABLE, 'FIX'), src);
});

test('injectConstants: referenced constant is prepended; others are not', () => {
  const src = 'export function render(index) { var on = fixtureType == FIX_PAR; rgb(on, 0, 0); }';
  const out = injectConstants(src, FIX_TABLE, 'FIX');
  assert.match(out, /^var FIX_PAR = 2;\n/);
  assert.doesNotMatch(out, /FIX_BAR_18/);
});

test('injectConstants: prefix isolation — MASK_* untouched by FIX injection', () => {
  const src = 'export function render(index) { var a = viewMask & MASK_PARS; var b = fixtureType == FIX_PAR; rgb(a, b, 0); }';
  const out = injectConstants(src, FIX_TABLE, 'FIX');
  assert.match(out, /^var FIX_PAR = 2;/);
  // The FIX injector must not try to resolve MASK_* (a different prefix's
  // namespace) — no throw, no MASK_ var prepended.
  assert.doesNotMatch(out.split('\n', 1)[0], /var MASK_/);
});

test('injectConstants: unknown PREFIX_* reference throws naming known constants', () => {
  const src = 'export function render(index) { rgb(fixtureType == FIX_TYPO, 0, 0); }';
  assert.throws(() => injectConstants(src, FIX_TABLE, 'FIX'),
    /FIX_TYPO.*FIX_PAR/s);
});

test('injectConstants: pattern-declared name overrides (injected unconditionally)', () => {
  const src = 'var FIX_PAR = 9;\nexport function render(index) { rgb(FIX_PAR, 0, 0); }';
  const out = injectConstants(src, FIX_TABLE, 'FIX');
  // Injected first; pattern's later declaration wins at compile.
  assert.match(out, /^var FIX_PAR = 2;\n/);
  assert.equal(out.slice(out.indexOf('\n') + 1), src);
});

test('injectConstants: declared-but-unknown name is skipped silently', () => {
  const src = 'var FIX_LOCAL = 7;\nexport function render(index) { rgb(FIX_LOCAL, 0, 0); }';
  assert.equal(injectConstants(src, FIX_TABLE, 'FIX'), src);
});

test('injectConstants: commented-out references are ignored', () => {
  const src = '// targets FIX_NOT_REAL when enabled\nexport function render(index) { rgb(fixtureType == FIX_PAR, 0, 0); }';
  const out = injectConstants(src, FIX_TABLE, 'FIX');
  assert.match(out, /^var FIX_PAR = 2;\n/);
});

test('injectConstants: empty prefix throws', () => {
  assert.throws(() => injectConstants('x', {}, ''), /non-empty prefix/);
});
