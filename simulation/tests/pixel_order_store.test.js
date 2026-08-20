/**
 * pixel_order_store.test.js — the PURE half of Mechanism A (design contract
 * 20260806_174 §2): the name-keyed `pixelOrder` store, its strict enum, its
 * lifecycle helpers (rename carry, casualty clear), its prune-on-persist rule,
 * and its round trip through the scene config tree (`extractParams` /
 * `reconstructYAML` — the groupOverrides idiom).
 *
 * No DOM, no THREE, no window: this module is the single source of truth for the
 * rule, so it is tested directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  PIXEL_ORDER_NORMAL, PIXEL_ORDER_REVERSED, pixelOrderFor, isReversed, reverseIndex, wireSlot,
  validatePixelOrderStore, carryPixelOrderEntries, clearCasualtyPixelOrder, casualtyClearMessage,
  reversedMembers, prunePixelOrder,
} from '../src/dmx/pixel_order_store.js';
import { params } from '../src/core/state.js';
import { extractParams, reconstructYAML } from '../src/core/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');

// ── The enum: exactly two lowercase strings, everything else REFUSED ───────

test('absence is NORMAL — the defined default state, not a fallback', () => {
  assert.equal(pixelOrderFor(undefined, 'Bar 1'), PIXEL_ORDER_NORMAL);
  assert.equal(pixelOrderFor(null, 'Bar 1'), PIXEL_ORDER_NORMAL);
  assert.equal(pixelOrderFor({}, 'Bar 1'), PIXEL_ORDER_NORMAL);
  assert.equal(isReversed({}, 'Bar 1'), false);
});

test("'normal' and 'reversed' are accepted verbatim", () => {
  const store = { 'Bar 1': PIXEL_ORDER_NORMAL, 'Bar 2': PIXEL_ORDER_REVERSED };
  assert.equal(isReversed(store, 'Bar 1'), false);
  assert.equal(isReversed(store, 'Bar 2'), true);
});

test('every other value is refused LOUDLY, by name and value (no coercion)', () => {
  for (const bad of ['REVERSED', 'Reversed', 'reverse', true, 1, 0, '', { flip: true }, ['x']]) {
    const store = { 'Bar 1': bad };
    assert.throws(() => isReversed(store, 'Bar 1'), (err) => {
      assert.match(err.message, /Bar 1/);
      assert.match(err.message, /must be 'normal' or 'reversed'/);
      return true;
    }, `value ${JSON.stringify(bad)} must throw`);
  }
});

test('the refusal quotes the offending value so the operator can find it', () => {
  assert.throws(() => isReversed({ 'Left Front Wall 1': 'REVERSED' }, 'Left Front Wall 1'),
    /'REVERSED'/);
  assert.throws(() => isReversed({ 'Left Front Wall 1': true }, 'Left Front Wall 1'),
    /boolean true/);
});

// ── The permutation P(j) = N-1-j ───────────────────────────────────────────

test('reverseIndex is the involution N-1-j', () => {
  assert.deepEqual([0, 1, 2, 3].map((j) => reverseIndex(j, 4)), [3, 2, 1, 0]);
  for (let j = 0; j < 18; j++) assert.equal(reverseIndex(reverseIndex(j, 18), 18), j);
});

test('reverseIndex refuses an out-of-range slot instead of returning nonsense', () => {
  assert.throws(() => reverseIndex(4, 4), /out of range/);
  assert.throws(() => reverseIndex(-1, 4), /out of range/);
  assert.throws(() => reverseIndex(0, 0), /out of range/);
});

test('wireSlot is identity when NORMAL and the reversal when REVERSED', () => {
  assert.deepEqual([0, 1, 2].map((j) => wireSlot(false, j, 3)), [0, 1, 2]);
  assert.deepEqual([0, 1, 2].map((j) => wireSlot(true, j, 3)), [2, 1, 0]);
});

// ── Validation against the live scene ──────────────────────────────────────

const fixtures = [
  { name: 'Bar Left 1', pixelCount: 18 },
  { name: 'Bar Left 2', pixelCount: 18 },
  { name: 'Par 1', pixelCount: 1 },
  { name: 'Unknown Type 1', pixelCount: null },
];

test('validate: a clean store reports the reversed names and no stale entries', () => {
  const result = validatePixelOrderStore({ 'Bar Left 2': 'reversed' }, fixtures);
  assert.deepEqual(result, { stale: [], reversed: ['Bar Left 2'] });
});

test('validate: an entry naming no fixture is STALE — warned, never thrown', () => {
  const result = validatePixelOrderStore(
    { 'Bar Left 1': 'reversed', 'Ghost Bar 9': 'reversed' }, fixtures);
  assert.deepEqual(result.stale, ['Ghost Bar 9']);
  assert.deepEqual(result.reversed, ['Bar Left 1']);
});

test('validate: an entry on a SINGLE-PIXEL fixture throws (pars refuse the flag)', () => {
  assert.throws(() => validatePixelOrderStore({ 'Par 1': 'reversed' }, fixtures),
    /Par 1.*single-pixel/s);
  // Even a hand-authored `normal` on a par is refused — the entry is nonsense
  // either way, and silently pruning it would hide the mistake.
  assert.throws(() => validatePixelOrderStore({ 'Par 1': 'normal' }, fixtures), /Par 1/);
});

test('validate: an UNKNOWN pixel count is not treated as single-pixel', () => {
  const result = validatePixelOrderStore({ 'Unknown Type 1': 'reversed' }, fixtures);
  assert.deepEqual(result.reversed, ['Unknown Type 1']);
  assert.deepEqual(result.stale, []);
});

test('validate: an invalid value anywhere refuses the whole store, by name', () => {
  assert.throws(() => validatePixelOrderStore({ 'Bar Left 1': 'yes' }, fixtures), /Bar Left 1/);
});

// ── Rename carry (§2.4) ────────────────────────────────────────────────────

test('rename carry moves `<old> N` → `<new> N` for N = 1..count', () => {
  const store = { 'Wall 1': 'reversed', 'Wall 3': 'reversed', 'Other 1': 'reversed' };
  const moved = carryPixelOrderEntries(store, 'Wall', 'Front Wall', 4);
  assert.deepEqual(store, {
    'Front Wall 1': 'reversed', 'Front Wall 3': 'reversed', 'Other 1': 'reversed',
  });
  assert.deepEqual(moved.map((m) => `${m.from}→${m.to}`),
    ['Wall 1→Front Wall 1', 'Wall 3→Front Wall 3']);
});

test('rename carry beyond the member count leaves higher-numbered entries alone', () => {
  const store = { 'Wall 1': 'reversed', 'Wall 9': 'reversed' };
  carryPixelOrderEntries(store, 'Wall', 'Bow', 4);
  assert.deepEqual(store, { 'Bow 1': 'reversed', 'Wall 9': 'reversed' });
});

test('rename carry is a no-op on an unchanged name and on an empty store', () => {
  const store = { 'Wall 1': 'reversed' };
  assert.deepEqual(carryPixelOrderEntries(store, 'Wall', 'Wall', 4), []);
  assert.deepEqual(store, { 'Wall 1': 'reversed' });
  assert.deepEqual(carryPixelOrderEntries(undefined, 'Wall', 'Bow', 4), []);
});

// ── Casualty clear (§2.3) ──────────────────────────────────────────────────

test('shrink casualties clear their flags and report what was cleared', () => {
  const store = { 'Wall 1': 'reversed', 'Wall 3': 'reversed', 'Wall 4': 'reversed' };
  const cleared = clearCasualtyPixelOrder(store, ['Wall 3', 'Wall 4']);
  assert.deepEqual(store, { 'Wall 1': 'reversed' });
  assert.deepEqual(cleared, [
    { name: 'Wall 3', value: 'reversed' }, { name: 'Wall 4', value: 'reversed' },
  ]);
});

test('casualties with no flag clear nothing and therefore warn about nothing', () => {
  const store = { 'Wall 1': 'reversed' };
  assert.deepEqual(clearCasualtyPixelOrder(store, ['Wall 3', 'Wall 4']), []);
  assert.deepEqual(store, { 'Wall 1': 'reversed' });
});

test('the casualty warning names the group, the cleared fixtures and pattern 71', () => {
  const message = casualtyClearMessage('Wall', ['Wall 3', 'Wall 4']);
  assert.match(message, /Wall 3, Wall 4/);
  assert.match(message, /REVERSED/);
  assert.match(message, /pattern 71/);
});

// ── Swap start/end helper (§2.5): flags stay NAME-STUCK ────────────────────

test('reversedMembers names the currently-REVERSED members, in order', () => {
  const store = { 'Wall 2': 'reversed', 'Wall 4': 'reversed' };
  assert.deepEqual(reversedMembers(store, ['Wall 1', 'Wall 2', 'Wall 3', 'Wall 4']),
    ['Wall 2', 'Wall 4']);
});

test('reversedMembers refuses an invalid value rather than hiding it in a dialog', () => {
  assert.throws(() => reversedMembers({ 'Wall 2': 'REVERSED' }, ['Wall 2']), /Wall 2/);
});

// ── Prune on persist ───────────────────────────────────────────────────────

test('prune keeps `reversed`, drops `normal`, and keeps a hand edit verbatim', () => {
  assert.deepEqual(prunePixelOrder({
    'Wall 1': 'reversed', 'Wall 2': 'normal', 'Wall 3': 'REVERSED',
  }), { 'Wall 1': 'reversed', 'Wall 3': 'REVERSED' });
  assert.deepEqual(prunePixelOrder(undefined), {});
  assert.deepEqual(prunePixelOrder({}), {});
});

// ── Round trip through the scene config tree (the groupOverrides idiom) ────

function resetParams() {
  params.parLights = [];
  params.dmxFixtures = [];
  params.traces = [];
  params.ledStrands = [];
  params.groupOverrides = {};
  params.ledGroupOverrides = {};
  params.pixelMap2d = null;
  params.pixelOrder = undefined;
}

test('extractParams lifts a top-level pixelOrder map straight into params', () => {
  resetParams();
  const tree = yaml.load('pixelOrder:\n  Left Front Wall 1: reversed\n');
  extractParams(tree);
  assert.deepEqual(params.pixelOrder, { 'Left Front Wall 1': 'reversed' });
});

test('the map survives the { value } recursion untouched (no control mangling)', () => {
  resetParams();
  const tree = yaml.load(
    'atmosphere:\n  fog:\n    value: 0.5\npixelOrder:\n  Bar Left 1: reversed\n');
  extractParams(tree);
  assert.deepEqual(params.pixelOrder, { 'Bar Left 1': 'reversed' });
  assert.equal(params.fog, 0.5);
});

test('a malformed top-level pixelOrder (scalar/array) is flagged loudly, never lifted', () => {
  // F-177-2 / operator ruling: the hand-edit failure mode must be VISIBLE.
  // config.js records it on params.pixelOrderMalformed (surfaced as a sim
  // toast by reportPixelOrderStore) and never populates params.pixelOrder.
  for (const [snippet, recorded] of [
    ['pixelOrder: 7\n', '7'],
    ['pixelOrder:\n  - Bar Left 1\n', '["Bar Left 1"]'],
  ]) {
    resetParams();
    delete params.pixelOrderMalformed;
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    try {
      extractParams(yaml.load(snippet));
    } finally {
      console.error = orig;
    }
    assert.equal(params.pixelOrder, undefined, snippet);
    assert.equal(params.pixelOrderMalformed, recorded, snippet);
    assert.ok(errors.some((e) => e.includes('IGNORED')), snippet);
  }
  // And a valid map must never trip the flag.
  resetParams();
  delete params.pixelOrderMalformed;
  extractParams(yaml.load('pixelOrder:\n  Bar Left 1: reversed\n'));
  assert.equal(params.pixelOrderMalformed, undefined);
  assert.deepEqual(params.pixelOrder, { 'Bar Left 1': 'reversed' });
});

test('save/load/save round trip is stable for a REVERSED entry', () => {
  resetParams();
  const tree = yaml.load('pixelOrder:\n  Bar Left 1: reversed\n');
  extractParams(tree);
  reconstructYAML(tree);
  const once = yaml.dump(tree);
  extractParams(yaml.load(once));
  const tree2 = yaml.load(once);
  reconstructYAML(tree2);
  assert.equal(yaml.dump(tree2), once);
  assert.match(once, /pixelOrder:\n\s+Bar Left 1: reversed/);
});

test('an ALL-NORMAL scene writes NO pixelOrder key at all (byte-clean default)', () => {
  resetParams();
  const tree = yaml.load('atmosphere:\n  fog:\n    value: 0.5\n');
  extractParams(tree);
  params.pixelOrder = { 'Bar Left 1': 'normal' };
  reconstructYAML(tree);
  assert.equal(tree.pixelOrder, undefined);
  assert.equal(yaml.dump(tree).includes('pixelOrder'), false);
});

test('clearing the last reversed flag DELETES the key from the tree', () => {
  resetParams();
  const tree = yaml.load('pixelOrder:\n  Bar Left 1: reversed\n');
  extractParams(tree);
  delete params.pixelOrder['Bar Left 1'];
  reconstructYAML(tree);
  assert.equal(tree.pixelOrder, undefined);
});

// ── POST /save round trip: the server strips FIXTURE keys, not top-level ───
//
// The save server splits patches/views/controllers out of the POSTed tree and
// deletes an enumerated set of DMX/LED keys FROM FIXTURE ARRAYS. `pixelOrder`
// is a top-level map, so it must pass through untouched. Asserted on the source
// (the deletions are all `delete fixture.X` / `delete strand.X`) rather than by
// starting the server: this agent may not bind ports.

test('save-server deletes only per-fixture keys — nothing top-level, so pixelOrder rides along', () => {
  const src = read('server', 'save-server.js');
  assert.equal(src.includes('pixelOrder'), false,
    'the save server must not know about pixelOrder at all — it is a plain top-level map');
  const deletions = [...src.matchAll(/^\s*delete\s+([A-Za-z_$][\w$]*)\.[\w$]+;/gm)]
    .map((m) => m[1]);
  const targets = new Set(deletions);
  for (const t of targets) {
    assert.ok(['fixture', 'strand', 'configTree', 'config', 'light', 'trace', 'entry']
      .includes(t), `unexpected delete target '${t}' in save-server.js — a top-level ` +
      'deletion could eat the pixelOrder map');
  }
});
