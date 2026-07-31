/**
 * generator_chain_order_emission.test.js — the GENERATION contract for chain
 * splits (design 20260725_41 §7 steps 8 + 9).
 *
 * `generateGroupFromTrace` (gui_builder.js) computes one record per PATH
 * position — world position, aim rotations, light defaults — in path order,
 * exactly as it always did, and then hands the list to `emitInChainOrder` to
 * be numbered and ordered. That seam is the whole feature; this suite pins it:
 *
 *   (a) absent chainSplits → emission byte-identical to the pre-splits code
 *       (an independent oracle replicating the old forward loop),
 *   (b) the operator's example → names land on §4's path positions,
 *   (c) every record's aim/position payload is carried through UNCHANGED —
 *       only `name` differs, which is what makes aim invariant per path
 *       position under any renumbering,
 *   (d) per-position data (the pointOffsets-shifted coordinates) follows the
 *       PATH POSITION, never the fixture number,
 *   (e) the NAME SET is invariant under any valid splits — the survivor /
 *       sticky-address contract and the count-shrink casualty set are
 *       therefore untouched,
 *   (f) a count shrink produces the same casualty set with or without splits,
 *   (g) chainSplits survive a JSON snapshot round-trip (undo clones traces),
 *   (h) chainSplits survive the scene-YAML round-trip verbatim, and an absent
 *       field stays absent (no empty-array injection).
 *
 * Pure: plain objects only, no DOM / THREE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};

import { emitInChainOrder } from '../src/dmx/generator_chain_order.js';
import { reconstructYAML } from '../src/core/config.js';
import { params } from '../src/core/state.js';

const GROUP = 'Left Front Wall Generator';
const OPERATOR_SPLITS = [{ from: 4, to: 5 }, { from: 3, to: 2 }, { from: 1, to: 1 }];

/** One record per path position, shaped like the generator's real push. */
function buildPointData(count) {
  const data = [];
  for (let p = 1; p <= count; p++) {
    data.push({
      group: GROUP,
      name: '',
      fixtureType: 'UkingPar',
      color: '#ffaa44',
      intensity: 10,
      angle: 30,
      penumbra: 0.5,
      // Distinct per path position so a mis-permutation is unmissable.
      x: p * 1.5, y: 4, z: -2,
      rotX: p, rotY: p * 10, rotZ: p * 100,
      traceGenerated: true,
      controllerIp: '',
    });
  }
  return data;
}

/** ORACLE: the pre-splits emission — a plain forward walk, numbered 1..N. */
function legacyEmission(count) {
  return buildPointData(count).map((record, i) => {
    record.name = `${GROUP} ${i + 1}`;
    return record;
  });
}

// ── (a) Absent splits are byte-identical to the old forward loop ────────────

test('absent chainSplits emits exactly what the pre-splits generator emitted', () => {
  for (const count of [1, 2, 5, 8, 37]) {
    const actual = emitInChainOrder(buildPointData(count), undefined, GROUP);
    assert.deepEqual(actual, legacyEmission(count),
      `count ${count}: emission must be byte-identical without chainSplits`);
  }
});

test('a null chainSplits is also plain path order', () => {
  assert.deepEqual(emitInChainOrder(buildPointData(5), null, GROUP), legacyEmission(5));
});

// ── (b) The operator's example, as the design's §4 table states it ──────────

test("the operator's example puts each fixture number on §4's path position", () => {
  const emitted = emitInChainOrder(buildPointData(5), OPERATOR_SPLITS, GROUP);
  // Fixture number → path position (§4): 1→p4, 2→p5, 3→p3, 4→p2, 5→p1.
  const expected = [
    { name: `${GROUP} 1`, pathPosition: 4 },
    { name: `${GROUP} 2`, pathPosition: 5 },
    { name: `${GROUP} 3`, pathPosition: 3 },
    { name: `${GROUP} 4`, pathPosition: 2 },
    { name: `${GROUP} 5`, pathPosition: 1 },
  ];
  assert.equal(emitted.length, 5);
  emitted.forEach((record, j) => {
    assert.equal(record.name, expected[j].name);
    // x encodes the path position (p * 1.5) — the geometry must be the
    // position's, not the number's.
    assert.equal(record.x, expected[j].pathPosition * 1.5,
      `${record.name} must sit at path position ${expected[j].pathPosition}`);
  });
});

test('the ⇄ Swap shape (full reverse) numbers the path backwards', () => {
  const emitted = emitInChainOrder(buildPointData(4), [{ from: 4, to: 1 }], GROUP);
  assert.deepEqual(emitted.map((r) => r.name),
    [`${GROUP} 1`, `${GROUP} 2`, `${GROUP} 3`, `${GROUP} 4`]);
  assert.deepEqual(emitted.map((r) => r.x), [4 * 1.5, 3 * 1.5, 2 * 1.5, 1 * 1.5]);
});

// ── (c) + (d) Aim / position payload travels with the PATH POSITION ─────────

test('a record\'s payload is untouched by renumbering — only `name` changes', () => {
  const plain = emitInChainOrder(buildPointData(5), undefined, GROUP);
  const split = emitInChainOrder(buildPointData(5), OPERATOR_SPLITS, GROUP);

  // Index both emissions by the path position their geometry encodes.
  const byPosition = (list) => new Map(list.map((r) => [Math.round(r.x / 1.5), r]));
  const a = byPosition(plain);
  const b = byPosition(split);
  assert.equal(a.size, 5);
  assert.equal(b.size, 5);

  for (const [position, plainRec] of a) {
    const splitRec = b.get(position);
    assert.ok(splitRec, `path position ${position} must still be emitted`);
    for (const key of Object.keys(plainRec)) {
      if (key === 'name') continue;
      assert.deepEqual(splitRec[key], plainRec[key],
        `path position ${position}: '${key}' must not depend on chain numbering`);
    }
  }
});

test('aim rotations stay keyed to the path position under every valid split shape', () => {
  const shapes = [
    undefined,
    [{ from: 1, to: 5 }],
    [{ from: 5, to: 1 }],
    OPERATOR_SPLITS,
    [{ from: 3, to: 1 }, { from: 4, to: 5 }],
  ];
  for (const splits of shapes) {
    for (const record of emitInChainOrder(buildPointData(5), splits, GROUP)) {
      const position = Math.round(record.x / 1.5);
      // The generator builds rotX/Y/Z per path position; this is the rule.
      assert.equal(record.rotX, position);
      assert.equal(record.rotY, position * 10);
      assert.equal(record.rotZ, position * 100);
    }
  }
});

test('every path position is emitted exactly once (no light lost or doubled)', () => {
  const emitted = emitInChainOrder(buildPointData(6),
    [{ from: 2, to: 1 }, { from: 6, to: 3 }], GROUP);
  const positions = emitted.map((r) => Math.round(r.x / 1.5)).sort((p, q) => p - q);
  assert.deepEqual(positions, [1, 2, 3, 4, 5, 6]);
});

// ── (e) + (f) The name set — the survivor / casualty contract ───────────────

const NAME_SET_SHAPES = [
  undefined,
  [{ from: 1, to: 5 }],
  [{ from: 5, to: 1 }],
  OPERATOR_SPLITS,
  [{ from: 2, to: 2 }, { from: 5, to: 3 }, { from: 1, to: 1 }],
];

test('the NAME SET is identical under every valid split shape', () => {
  const expected = [1, 2, 3, 4, 5].map((n) => `${GROUP} ${n}`);
  for (const splits of NAME_SET_SHAPES) {
    const names = emitInChainOrder(buildPointData(5), splits, GROUP).map((r) => r.name);
    assert.deepEqual([...names].sort(), [...expected].sort(),
      `splits ${JSON.stringify(splits)} must not change which names exist`);
  }
});

test('a count shrink produces the same casualty set with or without splits', () => {
  // The generator derives survivors as `${group} 1..count` and drops the rest.
  const before = emitInChainOrder(buildPointData(5), undefined, GROUP).map((r) => r.name);
  const survivorsPlain = new Set(
    emitInChainOrder(buildPointData(3), undefined, GROUP).map((r) => r.name));
  const survivorsSplit = new Set(
    emitInChainOrder(buildPointData(3), [{ from: 3, to: 1 }], GROUP).map((r) => r.name));

  const casualties = (survivors) => before.filter((n) => !survivors.has(n));
  assert.deepEqual(casualties(survivorsPlain), [`${GROUP} 4`, `${GROUP} 5`]);
  assert.deepEqual(casualties(survivorsSplit), casualties(survivorsPlain));
});

// ── Fail-loud at the seam ──────────────────────────────────────────────────

test('emitInChainOrder refuses a blank group name', () => {
  for (const bad of ['', '   ', null, undefined, 7]) {
    assert.throws(() => emitInChainOrder(buildPointData(3), undefined, bad),
      /groupName must be a non-empty string/);
  }
});

test('emitInChainOrder refuses invalid splits rather than emitting path order', () => {
  assert.throws(() => emitInChainOrder(buildPointData(5), [{ from: 3, to: 5 }], GROUP),
    /refusing to expand invalid chainSplits/);
  assert.throws(() => emitInChainOrder(buildPointData(5), [], GROUP),
    /refusing to expand invalid chainSplits/);
});

test('emitInChainOrder refuses a non-array pointData', () => {
  assert.throws(() => emitInChainOrder(null, undefined, GROUP),
    /pointData must be an array/);
});

// ── (g) Undo clones traces — chainSplits must survive the snapshot ──────────

test('chainSplits survive a JSON snapshot round-trip (undo captureSnapshot)', () => {
  const traces = [{ name: GROUP, shape: 'line', count: 5, chainSplits: OPERATOR_SPLITS }];
  const restored = JSON.parse(JSON.stringify(traces));
  assert.deepEqual(restored[0].chainSplits, OPERATOR_SPLITS);
  // And an absent field stays absent through the same clone.
  const plain = JSON.parse(JSON.stringify([{ name: GROUP, shape: 'line', count: 5 }]));
  assert.equal('chainSplits' in plain[0], false);
});

// ── (h) Scene-YAML round-trip (config.js reconstructYAML, verbatim traces) ──

test('reconstructYAML writes chainSplits verbatim into the scene tree', () => {
  const previousTraces = params.traces;
  try {
    params.traces = [{
      name: GROUP, shape: 'line', count: 5, groupName: GROUP, generated: true,
      chainSplits: OPERATOR_SPLITS,
    }];
    const node = { traces: [] };
    reconstructYAML(node);
    assert.equal(node.traces.length, 1);
    assert.deepEqual(node.traces[0].chainSplits, OPERATOR_SPLITS);
  } finally {
    params.traces = previousTraces;
  }
});

test('reconstructYAML never injects an empty chainSplits on a plain trace', () => {
  const previousTraces = params.traces;
  try {
    params.traces = [{
      name: GROUP, shape: 'line', count: 5, groupName: GROUP, generated: true,
    }];
    const node = { traces: [] };
    reconstructYAML(node);
    assert.equal('chainSplits' in node.traces[0], false,
      'an absent declaration must stay absent — [] is invalid, not "no splits"');
  } finally {
    params.traces = previousTraces;
  }
});
