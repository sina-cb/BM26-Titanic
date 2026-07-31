/**
 * Tests for the generator chain-order (split) math
 * (src/dmx/generator_chain_order.js, design report 20260725_41 §3).
 *
 * The contracts pinned here:
 *   1. Absent chainSplits → identity order. This is the backward-compat
 *      promise: a scene that never heard of splits generates byte-identically.
 *   2. The OPERATOR'S EXAMPLE — Left Front Wall Generator, count 5,
 *      splits 4→5 / 3→2 / 1→1 — expands to [4, 5, 3, 2, 1] and maps fixture
 *      numbers to path positions exactly as §4's table says.
 *   3. Every §3.3 defect class is REFUSED BY NAME: out of range, non-integer,
 *      overlap (across splits and within one), gap, empty array, bad shape.
 *      No auto-repair, no clamping, no silent identity fallback.
 *   4. ⇄ Swap is the single full-reverse split — not a second mechanism.
 *
 * Pure module — plain objects only, no DOM/THREE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  chainSplitsError,
  expandChainOrder,
  describeChainOrder,
  fullReverseSplits,
  isFullReverse,
} from '../src/dmx/generator_chain_order.js';

// The operator's verbatim example (design 20260725_41 §3.1 / §4):
// Left Front Wall Generator, 5 lights, wire enters at path position 4.
const OPERATOR_SPLITS = Object.freeze([
  Object.freeze({ from: 4, to: 5 }),
  Object.freeze({ from: 3, to: 2 }),
  Object.freeze({ from: 1, to: 1 }),
]);
const OPERATOR_COUNT = 5;

// ── 1. Absent splits: the backward-compat identity ──────────────────────────

test('absent chainSplits is valid and expands to identity order', () => {
  for (const absent of [undefined, null]) {
    assert.equal(chainSplitsError(absent, 5), null);
    assert.deepEqual(expandChainOrder(absent, 5), [1, 2, 3, 4, 5]);
    assert.equal(describeChainOrder(absent, 5), '1..5 (path order)');
  }
});

test('identity order is produced for every count 1..12 when splits are absent', () => {
  for (let count = 1; count <= 12; count++) {
    const order = expandChainOrder(undefined, count);
    assert.equal(order.length, count);
    order.forEach((p, j) => assert.equal(p, j + 1));
  }
});

test('an explicit single forward split equals identity', () => {
  const splits = [{ from: 1, to: 5 }];
  assert.equal(chainSplitsError(splits, 5), null);
  assert.deepEqual(expandChainOrder(splits, 5), [1, 2, 3, 4, 5]);
});

// ── 2. The operator's example, end to end ───────────────────────────────────

test("operator's example (4→5 / 3→2 / 1→1) is valid", () => {
  assert.equal(chainSplitsError(OPERATOR_SPLITS, OPERATOR_COUNT), null);
});

test("operator's example expands to [4, 5, 3, 2, 1]", () => {
  assert.deepEqual(expandChainOrder(OPERATOR_SPLITS, OPERATOR_COUNT), [4, 5, 3, 2, 1]);
});

test("operator's example: fixture number → path position matches design §4's table", () => {
  const order = expandChainOrder(OPERATOR_SPLITS, OPERATOR_COUNT);
  // "<group> 1" is the first light on the cable and sits at path position 4.
  const table = [
    { fixtureNumber: 1, pathPosition: 4 },
    { fixtureNumber: 2, pathPosition: 5 },
    { fixtureNumber: 3, pathPosition: 3 },
    { fixtureNumber: 4, pathPosition: 2 },
    { fixtureNumber: 5, pathPosition: 1 },
  ];
  for (const row of table) {
    assert.equal(order[row.fixtureNumber - 1], row.pathPosition,
      `fixture ${row.fixtureNumber} must land on path position ${row.pathPosition}`);
  }
});

test("operator's example describes as the card's status row", () => {
  assert.equal(describeChainOrder(OPERATOR_SPLITS, OPERATOR_COUNT),
    '4→5, 3→2, 1 · covers 1–5 ✓');
});

test('every expansion is a permutation of 1..count (no lost or duplicated light)', () => {
  const cases = [
    { splits: OPERATOR_SPLITS, count: 5 },
    { splits: [{ from: 3, to: 1 }, { from: 4, to: 6 }], count: 6 },
    { splits: [{ from: 2, to: 2 }, { from: 1, to: 1 }, { from: 4, to: 3 }], count: 4 },
    { splits: [{ from: 10, to: 1 }], count: 10 },
  ];
  for (const { splits, count } of cases) {
    const order = expandChainOrder(splits, count);
    assert.equal(order.length, count);
    assert.deepEqual([...order].sort((a, b) => a - b),
      Array.from({ length: count }, (_, i) => i + 1));
  }
});

// ── 3. Direction + single-light splits ──────────────────────────────────────

test('from > to walks backwards', () => {
  assert.deepEqual(expandChainOrder([{ from: 5, to: 2 }, { from: 1, to: 1 }], 5),
    [5, 4, 3, 2, 1]);
});

test('from == to is a single light', () => {
  const splits = [{ from: 2, to: 2 }, { from: 1, to: 1 }, { from: 3, to: 3 }];
  assert.equal(chainSplitsError(splits, 3), null);
  assert.deepEqual(expandChainOrder(splits, 3), [2, 1, 3]);
  assert.equal(describeChainOrder(splits, 3), '2, 1, 3 · covers 1–3 ✓');
});

test('count of 1 accepts the only possible split', () => {
  assert.equal(chainSplitsError([{ from: 1, to: 1 }], 1), null);
  assert.deepEqual(expandChainOrder([{ from: 1, to: 1 }], 1), [1]);
});

// ── 4. Every defect class is refused BY NAME (no auto-repair) ───────────────

test('an out-of-range endpoint names the split and the bound', () => {
  const err = chainSplitsError([{ from: 4, to: 7 }, { from: 3, to: 1 }], 5);
  assert.equal(err, 'split 1: to=7 outside 1..5');
});

test('a zero / negative endpoint is out of range', () => {
  assert.equal(chainSplitsError([{ from: 0, to: 5 }], 5), 'split 1: from=0 outside 1..5');
  assert.equal(chainSplitsError([{ from: 5, to: -1 }], 5), 'split 1: to=-1 outside 1..5');
});

test('a non-integer endpoint is refused (no rounding)', () => {
  assert.equal(chainSplitsError([{ from: 1.5, to: 5 }], 5),
    'split 1: from=1.5 is not an integer');
  assert.equal(chainSplitsError([{ from: 1, to: '5' }], 5),
    'split 1: to="5" is not an integer');
  assert.equal(chainSplitsError([{ from: 1, to: undefined }], 5),
    'split 1: to=undefined is not an integer');
  assert.equal(chainSplitsError([{ from: NaN, to: 5 }], 5),
    'split 1: from=null is not an integer'); // JSON.stringify(NaN) === 'null'
});

test('an overlap across two splits names both splits', () => {
  const err = chainSplitsError([{ from: 1, to: 3 }, { from: 3, to: 5 }], 5);
  assert.equal(err, 'position 3 covered twice (splits 1 and 2)');
});

test('a split that overlaps itself is caught too', () => {
  // 1..3 then 2..4 — position 2 is the first double-cover.
  const err = chainSplitsError([{ from: 1, to: 3 }, { from: 2, to: 4 }], 4);
  assert.equal(err, 'position 2 covered twice (splits 1 and 2)');
});

test('a gap names the uncovered positions', () => {
  const err = chainSplitsError([{ from: 3, to: 5 }], 5);
  assert.equal(err, 'positions {1, 2} not covered by any split ' +
    '(splits must cover 1..5 exactly once)');
});

test('an empty array is INVALID — never treated as "same as absent"', () => {
  assert.equal(chainSplitsError([], 5),
    'chainSplits: [] — declare full coverage or remove the field');
});

test('a non-array chainSplits is refused', () => {
  assert.equal(chainSplitsError('4-5', 5),
    'chainSplits must be a list of {from, to} ranges (got string)');
  assert.equal(chainSplitsError(42, 5),
    'chainSplits must be a list of {from, to} ranges (got number)');
});

test('a malformed split entry is refused by position', () => {
  assert.equal(chainSplitsError([{ from: 1, to: 5 }, null], 5),
    'split 2: expected a {from, to} object (got null)');
  assert.equal(chainSplitsError([[1, 5]], 5),
    'split 1: expected a {from, to} object (got array)');
  assert.equal(chainSplitsError(['1-5'], 5),
    'split 1: expected a {from, to} object (got string)');
});

test('a long gap list elides rather than spamming the card', () => {
  // 18 positions (3..20) are uncovered; only the first 8 are named.
  const err = chainSplitsError([{ from: 1, to: 2 }], 20);
  assert.match(err, /^positions \{3, 4, 5, 6, 7, 8, 9, 10, … and 10 more\} not covered/);
});

// ── 5. Callers never expand or describe blind ───────────────────────────────

test('expandChainOrder THROWS on invalid splits (never silently identity)', () => {
  assert.throws(() => expandChainOrder([{ from: 3, to: 5 }], 5),
    /refusing to expand invalid chainSplits — positions \{1, 2\} not covered/);
  assert.throws(() => expandChainOrder([], 5),
    /refusing to expand invalid chainSplits — chainSplits: \[\]/);
});

test('describeChainOrder THROWS on invalid splits', () => {
  assert.throws(() => describeChainOrder([{ from: 1, to: 3 }, { from: 3, to: 5 }], 5),
    /refusing to describe invalid chainSplits — position 3 covered twice/);
});

test('a bad count is a programming error and throws everywhere', () => {
  for (const bad of [0, -1, 2.5, '5', null, undefined, NaN]) {
    assert.throws(() => chainSplitsError(undefined, bad),
      /count must be an integer >= 1/, `chainSplitsError count=${String(bad)}`);
    assert.throws(() => expandChainOrder(undefined, bad),
      /count must be an integer >= 1/, `expandChainOrder count=${String(bad)}`);
    assert.throws(() => fullReverseSplits(bad),
      /count must be an integer >= 1/, `fullReverseSplits count=${String(bad)}`);
  }
});

// ── 6. ⇄ Swap = the single full-reverse split ───────────────────────────────

test('fullReverseSplits is one split spanning the whole trace, backwards', () => {
  assert.deepEqual(fullReverseSplits(5), [{ from: 5, to: 1 }]);
  assert.equal(chainSplitsError(fullReverseSplits(5), 5), null);
  assert.deepEqual(expandChainOrder(fullReverseSplits(5), 5), [5, 4, 3, 2, 1]);
  assert.equal(describeChainOrder(fullReverseSplits(5), 5), '5→1 (reversed)');
});

test('isFullReverse recognizes exactly what Swap wrote', () => {
  assert.equal(isFullReverse(fullReverseSplits(8), 8), true);
  assert.equal(isFullReverse([{ from: 8, to: 1 }], 8), true);
});

test('isFullReverse is false for path order, partial reverses and other shapes', () => {
  assert.equal(isFullReverse(undefined, 5), false);
  assert.equal(isFullReverse(null, 5), false);
  assert.equal(isFullReverse([], 5), false);
  assert.equal(isFullReverse([{ from: 1, to: 5 }], 5), false);
  assert.equal(isFullReverse([{ from: 4, to: 1 }], 5), false);   // wrong span
  assert.equal(isFullReverse(OPERATOR_SPLITS, 5), false);
  assert.equal(isFullReverse([{ from: 5, to: 1 }], 8), false);   // stale count
  assert.equal(isFullReverse([{ from: 5, to: 3 }, { from: 2, to: 1 }], 5), false);
});

test('swapping twice returns to path order (toggle round-trip)', () => {
  const count = 6;
  let splits = null;
  // Press ⇄ Swap.
  splits = isFullReverse(splits, count) ? null : fullReverseSplits(count);
  assert.deepEqual(expandChainOrder(splits, count), [6, 5, 4, 3, 2, 1]);
  // Press it again.
  splits = isFullReverse(splits, count) ? null : fullReverseSplits(count);
  assert.equal(splits, null);
  assert.deepEqual(expandChainOrder(splits, count), [1, 2, 3, 4, 5, 6]);
});

// ── 7. Count changes invalidate rather than stretch (design §3.5) ───────────

test('splits valid at one count are refused at a larger count (gap), never stretched', () => {
  assert.equal(chainSplitsError(OPERATOR_SPLITS, 5), null);
  const err = chainSplitsError(OPERATOR_SPLITS, 7);
  assert.equal(err, 'positions {6, 7} not covered by any split ' +
    '(splits must cover 1..7 exactly once)');
});

test('splits valid at one count are refused at a smaller count (range), never truncated', () => {
  const err = chainSplitsError(OPERATOR_SPLITS, 3);
  assert.equal(err, 'split 1: from=4 outside 1..3');
});

// ── 8. Purity: the input list is never mutated ──────────────────────────────

test('validation and expansion do not mutate the splits list', () => {
  const splits = [{ from: 4, to: 5 }, { from: 3, to: 2 }, { from: 1, to: 1 }];
  const before = JSON.stringify(splits);
  chainSplitsError(splits, 5);
  expandChainOrder(splits, 5);
  describeChainOrder(splits, 5);
  isFullReverse(splits, 5);
  assert.equal(JSON.stringify(splits), before);
});
