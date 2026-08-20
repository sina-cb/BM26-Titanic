/**
 * Tests for the chain-order OVERLAY plan (src/dmx/chain_order_visual.js).
 *
 * `generator_chain_order.test.js` pins which fixture NUMBER lands on which
 * path position. This file pins what the 3D overlay draws from that:
 *
 *   1. The polyline point sequence per run — the operator's 4→5 / 3→2 / 1
 *      must come out as THREE runs walking exactly [4,5] / [3,2] / [1], each
 *      with its own colour, and the numbers must run 1..count continuously
 *      across them (the chain does not restart at a split).
 *   2. Jumps: the dashed hops that make three runs read as ONE cable.
 *   3. Labels: one per fixture, carrying its post-renumber chain number.
 *   4. The comet ramp is monotonic along the direction of travel — that is
 *      the direction cue that survives head-on viewing angles.
 *   5. Invalid splits are REFUSED, never half-drawn. A pretty picture of a
 *      chain the generator will not build is worse than no picture.
 *
 * Pure module — plain objects only, no DOM/THREE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAIN_RUN_COLORS,
  CHAIN_JUMP_COLOR,
  COMET_MIN_MIX,
  chainRunColor,
  buildChainRuns,
  chainJumpSegments,
  chainLabelPlan,
  cometMix,
} from '../src/dmx/chain_order_visual.js';
import { expandChainOrder, emitInChainOrder } from '../src/dmx/generator_chain_order.js';

// The operator's verbatim case: Left Front Wall Generator, 5 lights,
// wire enters at path position 4 (design 20260725_41 §4).
const OPERATOR_SPLITS = Object.freeze([
  Object.freeze({ from: 4, to: 5 }),
  Object.freeze({ from: 3, to: 2 }),
  Object.freeze({ from: 1, to: 1 }),
]);
const OPERATOR_COUNT = 5;

// ── 1. Runs: the polyline point sequence ────────────────────────────────────

test('the operator example becomes three runs walking exactly 4→5, 3→2, 1', () => {
  const runs = buildChainRuns(OPERATOR_SPLITS, OPERATOR_COUNT);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.pathPositions), [[4, 5], [3, 2], [1]]);
  assert.deepEqual(runs.map((r) => r.numbers), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(runs.map((r) => r.reversed), [false, true, false]);
  assert.deepEqual(runs.map((r) => r.splitIndex), [0, 1, 2]);
});

test('each split gets its own colour so the runs read apart at a glance', () => {
  const runs = buildChainRuns(OPERATOR_SPLITS, OPERATOR_COUNT);
  const colors = runs.map((r) => r.colorHex);
  assert.equal(new Set(colors).size, 3, 'three runs must not share a colour');
  assert.deepEqual(colors, [
    CHAIN_RUN_COLORS[0], CHAIN_RUN_COLORS[1], CHAIN_RUN_COLORS[2],
  ]);
});

test('concatenated run positions are exactly expandChainOrder — one source of truth', () => {
  const runs = buildChainRuns(OPERATOR_SPLITS, OPERATOR_COUNT);
  const flat = runs.flatMap((r) => r.pathPositions);
  assert.deepEqual(flat, expandChainOrder(OPERATOR_SPLITS, OPERATOR_COUNT));
  assert.deepEqual(flat, [4, 5, 3, 2, 1]);
});

test('numbers run 1..count continuously across runs, never restarting per split', () => {
  const runs = buildChainRuns(
    [{ from: 1, to: 3 }, { from: 7, to: 4 }, { from: 8, to: 8 }], 8,
  );
  assert.deepEqual(runs.flatMap((r) => r.numbers), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(runs.map((r) => r.pathPositions), [[1, 2, 3], [7, 6, 5, 4], [8]]);
});

test('absent chainSplits draws ONE run in plain path order', () => {
  for (const splits of [undefined, null]) {
    const runs = buildChainRuns(splits, 5);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].pathPositions, [1, 2, 3, 4, 5]);
    assert.deepEqual(runs[0].numbers, [1, 2, 3, 4, 5]);
    assert.equal(runs[0].reversed, false);
    assert.equal(runs[0].colorHex, CHAIN_RUN_COLORS[0]);
  }
});

test('a full reverse is one run walking backwards', () => {
  const runs = buildChainRuns([{ from: 5, to: 1 }], 5);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].pathPositions, [5, 4, 3, 2, 1]);
  assert.deepEqual(runs[0].numbers, [1, 2, 3, 4, 5]);
  assert.equal(runs[0].reversed, true);
});

test('a one-light trace draws a single run with no direction to show', () => {
  const runs = buildChainRuns(null, 1);
  assert.deepEqual(runs[0].pathPositions, [1]);
  assert.equal(runs[0].reversed, false);
});

test('the palette cycles past its length instead of running out of colours', () => {
  const n = CHAIN_RUN_COLORS.length;
  assert.equal(chainRunColor(0), CHAIN_RUN_COLORS[0]);
  assert.equal(chainRunColor(n), CHAIN_RUN_COLORS[0]);
  assert.equal(chainRunColor(n + 2), CHAIN_RUN_COLORS[2]);
  const splits = [];
  for (let p = 1; p <= n + 2; p++) splits.push({ from: p, to: p });
  const runs = buildChainRuns(splits, n + 2);
  assert.equal(runs.length, n + 2);
  assert.equal(runs[n].colorHex, CHAIN_RUN_COLORS[0]);
});

test('the run palette never collides with the trace editor colour vocabulary', () => {
  // Orange path, yellow selection, aim yellow, green start, red end.
  const taken = new Set(['#ff8800', '#ffff00', '#ffcc00', '#00ff88', '#ff4400']);
  for (const c of CHAIN_RUN_COLORS) assert.equal(taken.has(c), false, c);
  assert.equal(taken.has(CHAIN_JUMP_COLOR), false);
  assert.equal(new Set(CHAIN_RUN_COLORS).size, CHAIN_RUN_COLORS.length);
});

test('chainRunColor refuses a non-index', () => {
  for (const bad of [-1, 1.5, '0', null, undefined, NaN]) {
    assert.throws(() => chainRunColor(bad), /splitIndex must be an integer/);
  }
});

// ── 2. Jumps ────────────────────────────────────────────────────────────────

test('jumps connect the end of each run to the start of the next', () => {
  const runs = buildChainRuns(OPERATOR_SPLITS, OPERATOR_COUNT);
  assert.deepEqual(chainJumpSegments(runs), [
    { fromPathPosition: 5, toPathPosition: 3, fromNumber: 2, toNumber: 3 },
    { fromPathPosition: 2, toPathPosition: 1, fromNumber: 4, toNumber: 5 },
  ]);
});

test('jump endpoints are always consecutive fixture numbers — it is ONE cable', () => {
  const runs = buildChainRuns(
    [{ from: 2, to: 4 }, { from: 9, to: 5 }, { from: 1, to: 1 }], 9,
  );
  for (const jump of chainJumpSegments(runs)) {
    assert.equal(jump.toNumber, jump.fromNumber + 1);
  }
});

test('a single run has no jumps', () => {
  assert.deepEqual(chainJumpSegments(buildChainRuns(null, 6)), []);
  assert.deepEqual(chainJumpSegments(buildChainRuns([{ from: 6, to: 1 }], 6)), []);
});

test('chainJumpSegments refuses a non-array', () => {
  assert.throws(() => chainJumpSegments(null), /runs must be an array/);
});

// ── 3. Labels ───────────────────────────────────────────────────────────────

test('the operator example labels each light with its post-renumber number', () => {
  const labels = chainLabelPlan(OPERATOR_SPLITS, OPERATOR_COUNT);
  // Design 20260725_41 §4's table, read as "number → path position".
  assert.deepEqual(
    labels.map((l) => [l.number, l.pathPosition]),
    [[1, 4], [2, 5], [3, 3], [4, 2], [5, 1]],
  );
});

test('labels carry their run colour and run-boundary flags', () => {
  const labels = chainLabelPlan(OPERATOR_SPLITS, OPERATOR_COUNT);
  assert.deepEqual(labels.map((l) => l.splitIndex), [0, 0, 1, 1, 2]);
  assert.deepEqual(labels.map((l) => l.colorHex), [
    CHAIN_RUN_COLORS[0], CHAIN_RUN_COLORS[0],
    CHAIN_RUN_COLORS[1], CHAIN_RUN_COLORS[1],
    CHAIN_RUN_COLORS[2],
  ]);
  assert.deepEqual(labels.map((l) => l.isRunStart), [true, false, true, false, true]);
  assert.deepEqual(labels.map((l) => l.isRunEnd), [false, true, false, true, true]);
});

test('there is exactly one label per fixture and per path position', () => {
  for (const [splits, count] of [
    [null, 7],
    [OPERATOR_SPLITS, OPERATOR_COUNT],
    [[{ from: 8, to: 1 }], 8],
    [[{ from: 3, to: 1 }, { from: 4, to: 6 }], 6],
  ]) {
    const labels = chainLabelPlan(splits, count);
    assert.equal(labels.length, count);
    const numbers = labels.map((l) => l.number).sort((a, b) => a - b);
    const positions = labels.map((l) => l.pathPosition).sort((a, b) => a - b);
    const expected = Array.from({ length: count }, (_, i) => i + 1);
    assert.deepEqual(numbers, expected);
    assert.deepEqual(positions, expected);
  }
});

test('with no splits the label at path position p just reads p', () => {
  for (const l of chainLabelPlan(undefined, 9)) {
    assert.equal(l.number, l.pathPosition);
    assert.equal(l.splitIndex, 0);
  }
});

// ── 3b. The label number IS the fixture's number, across the module seam ────
//
// The guide shows the INDEX ONLY (operator ruling, 2026-07-29: "I don't like
// the names on the generator guides too messy, just the index is enough"), so
// that number had better be the same `n` as in the fixture's `"<group> n"`
// name. Both sides derive from `expandChainOrder`, but through different
// functions in different modules — this pins the equality across that seam, so
// a change to either one can never leave the 3D guide pointing at a number the
// fixture list does not use (report 20260725_44 §2, plan step 15).

test('the label number equals the <group> N suffix a regenerate emits', () => {
  const GROUP = 'Right SmokeStacks';
  for (const [splits, count] of [
    [null, 8],
    [undefined, 12],
    [OPERATOR_SPLITS, OPERATOR_COUNT],
    [[{ from: 10, to: 1 }], 10],
    [[{ from: 4, to: 6 }, { from: 3, to: 1 }, { from: 7, to: 11 }], 11],
  ]) {
    // What a regenerate actually emits: records in path order, renamed and
    // handed back in CHAIN order.
    const pointData = Array.from({ length: count }, (_, i) => ({ pathPosition: i + 1 }));
    const emitted = emitInChainOrder(pointData, splits, GROUP);
    const labels = chainLabelPlan(splits, count);
    assert.equal(labels.length, count);

    // The label floating over path position p must carry the number in the
    // name the generator gave the fixture AT path position p.
    const nameAtPath = new Map(emitted.map((r) => [r.pathPosition, r.name]));
    for (const l of labels) {
      assert.equal(nameAtPath.get(l.pathPosition), `${GROUP} ${l.number}`);
    }
  }
});

// ── 4. The comet direction ramp ─────────────────────────────────────────────

test('the comet ramp rises monotonically from the run start to its end', () => {
  const n = 5;
  let previous = -Infinity;
  for (let k = 0; k < n; k++) {
    const mix = cometMix(k, n);
    assert.ok(mix > previous, `step ${k}: ${mix} must exceed ${previous}`);
    previous = mix;
  }
  assert.equal(cometMix(0, n), COMET_MIN_MIX);
  assert.equal(cometMix(n - 1, n), 1);
});

test('the comet floor keeps a run start visible rather than black', () => {
  assert.ok(COMET_MIN_MIX > 0);
  assert.ok(COMET_MIN_MIX < 1);
});

test('a single-light run is drawn at full brightness', () => {
  assert.equal(cometMix(0, 1), 1);
});

test('cometMix refuses an out-of-range step', () => {
  assert.throws(() => cometMix(3, 3), /outside 0\.\.2/);
  assert.throws(() => cometMix(-1, 3), /outside 0\.\.2/);
  assert.throws(() => cometMix(0, 0), /stepCount must be an integer >= 1/);
  assert.throws(() => cometMix(1.5, 3), /outside 0\.\.2/);
});

// ── 5. Invalid splits are refused, never half-drawn ─────────────────────────

test('every entry point refuses invalid splits by name', () => {
  const cases = [
    [[{ from: 1, to: 2 }], 5, /not covered by any split/],          // gap
    [[{ from: 1, to: 3 }, { from: 3, to: 5 }], 5, /covered twice/], // overlap
    [[{ from: 1, to: 7 }], 5, /outside 1\.\.5/],                    // range
    [[], 5, /declare full coverage or remove the field/],           // empty
    [[{ from: 1.5, to: 5 }], 5, /is not an integer/],               // non-integer
  ];
  for (const [splits, count, pattern] of cases) {
    assert.throws(() => buildChainRuns(splits, count), pattern);
    assert.throws(() => chainLabelPlan(splits, count), pattern);
    assert.throws(() => buildChainRuns(splits, count), /refusing to visualize/);
  }
});

test('a bad count is refused before anything is drawn', () => {
  assert.throws(() => buildChainRuns(null, 0), /count must be an integer >= 1/);
  assert.throws(() => chainLabelPlan(null, -3), /count must be an integer >= 1/);
});

// ── 6. Purity ───────────────────────────────────────────────────────────────

test('the plan never mutates the splits it is handed', () => {
  const splits = [{ from: 4, to: 5 }, { from: 3, to: 2 }, { from: 1, to: 1 }];
  const before = JSON.stringify(splits);
  buildChainRuns(splits, 5);
  chainLabelPlan(splits, 5);
  chainJumpSegments(buildChainRuns(splits, 5));
  assert.equal(JSON.stringify(splits), before);
});

test('the palette constants are frozen', () => {
  assert.equal(Object.isFrozen(CHAIN_RUN_COLORS), true);
});
