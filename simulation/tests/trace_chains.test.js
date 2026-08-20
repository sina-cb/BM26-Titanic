/**
 * Tests for the circle-chain placement math (src/dmx/trace_chains.js).
 *
 * This suite pins the two hard contracts the S2 wiring depends on:
 *   1. splits=1 (or absent) is BYTE-IDENTICAL to today's circle-trace output.
 *      An independent oracle here replicates gui_builder's exact arithmetic
 *      (computeTraceBaseArclengths + buildTracePath, gui_builder.js ~L2481 /
 *      ~L3297) and the real titanic smokestack trace params (circle, r=3,
 *      arc=360, count=10) are fed through both — every coordinate must match
 *      to the last bit (===, not approximately).
 *   2. The 2-chain smokestack plan: index 1 nearest the start point, chains
 *      fan opposite directions, even 360° coverage, per-chain group names.
 * Plus sequential layout, chainGroupNames, and fail-loud validation (no
 * fallbacks): 0 fixtures, splits out of range, mirror≠2, NaN startAngle, etc.
 *
 * Pure module — plain objects only, no DOM/THREE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chainPlan, chainGroupNames } from '../src/dmx/trace_chains.js';

// ── Oracle: gui_builder's EXACT circle placement (READ-ONLY mirror) ─────────
// Copied verbatim (arithmetic sequence preserved) from gui_builder.js so the
// byte-identity test compares against the shipping math, not a paraphrase.
const DEG2RAD = Math.PI / 180;

function guiCirclePlacements(trace) {
  const r = trace.radius || 5;
  const arcRad = (trace.arc || 360) * DEG2RAD; // THREE.MathUtils.degToRad
  const length = r * arcRad;
  // computeTraceBaseArclengths (circle branch)
  const count = Math.max(1, Math.round(trace.count ?? 8));
  const isClosed = Math.abs((trace.arc || 360) - 360) < 1e-6;
  const denom = isClosed ? count : Math.max(1, count - 1);
  const placements = [];
  for (let i = 0; i < count; i++) {
    const s = (i / denom) * length;
    // buildTracePath.at(s) (circle branch)
    const angle = length > 1e-9 ? (s / length) * arcRad : 0;
    placements.push({ x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r });
  }
  return placements;
}

// Real titanic smokestack circle traces (scene_config.yaml): both stacks are
// identical geometry — circle, radius 3, arc 360, count 10.
const SMOKESTACK_TRACE = Object.freeze({
  shape: 'circle',
  radius: 3,
  arc: 360,
  count: 10,
  groupName: 'Left Top Chimney Generator',
});

// ── 1. splits=1 backward-compat equivalence (byte-identical) ────────────────

test('splits=1: single chain, byte-identical to legacy circle placement (real smokestack numbers)', () => {
  const plan = chainPlan(SMOKESTACK_TRACE);
  assert.equal(plan.length, 1);
  const [chain] = plan;
  assert.equal(chain.suffix, null);
  assert.equal(chain.groupName, 'Left Top Chimney Generator');
  assert.equal(chain.count, 10);
  assert.equal(chain.points.length, 10);

  const oracle = guiCirclePlacements(SMOKESTACK_TRACE);
  assert.equal(chain.points.length, oracle.length);
  for (let i = 0; i < oracle.length; i++) {
    // Strict === on doubles — the whole point of the contract.
    assert.equal(chain.points[i].x, oracle[i].x, `x[${i}] must be bit-identical`);
    assert.equal(chain.points[i].y, oracle[i].y, `y[${i}] must be bit-identical`);
    assert.equal(chain.points[i].z, oracle[i].z, `z[${i}] must be bit-identical`);
  }
});

test('splits absent behaves as splits=1 (default), byte-identical', () => {
  const withOne = chainPlan({ ...SMOKESTACK_TRACE, splits: 1 });
  const withNone = chainPlan(SMOKESTACK_TRACE);
  assert.deepEqual(withNone, withOne);
});

test('splits=1 byte-identical across varied geometry (radius/arc/count, closed & open arcs)', () => {
  const cases = [
    { shape: 'circle', radius: 5, arc: 360, count: 8, groupName: 'A' },
    { shape: 'circle', radius: 3, arc: 360, count: 4, groupName: 'B' },
    { shape: 'circle', radius: 5, arc: 180, count: 8, groupName: 'C' }, // open arc
    { shape: 'circle', radius: 3, arc: 270, count: 6, groupName: 'D' }, // open arc
    { shape: 'circle', radius: 3, arc: 360, count: 1, groupName: 'E' }, // single fixture
    { shape: 'circle', radius: 2, arc: 90, count: 3, groupName: 'F' },  // open arc
  ];
  for (const trace of cases) {
    const [chain] = chainPlan(trace);
    const oracle = guiCirclePlacements(trace);
    assert.equal(chain.points.length, oracle.length, `count mismatch for ${trace.groupName}`);
    for (let i = 0; i < oracle.length; i++) {
      assert.equal(chain.points[i].x, oracle[i].x, `${trace.groupName} x[${i}]`);
      assert.equal(chain.points[i].z, oracle[i].z, `${trace.groupName} z[${i}]`);
    }
  }
});

test('splits=1 with startAngle rotates the whole ring by startAngle', () => {
  const start = 30;
  const [chain] = chainPlan({ ...SMOKESTACK_TRACE, startAngle: start });
  const oracle = guiCirclePlacements(SMOKESTACK_TRACE);
  const rad = start * DEG2RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let i = 0; i < oracle.length; i++) {
    // Rotate the legacy point by startAngle about Y: matches gui_builder's
    // planned buildTracePath change `angle = startRad + (s/length)*arcRad`.
    const rx = oracle[i].x * cos - oracle[i].z * sin;
    const rz = oracle[i].x * sin + oracle[i].z * cos;
    assert.ok(Math.abs(chain.points[i].x - rx) < 1e-9, `rotated x[${i}]`);
    assert.ok(Math.abs(chain.points[i].z - rz) < 1e-9, `rotated z[${i}]`);
  }
});

// ── 2. 2-chain smokestack plan (mirror) ─────────────────────────────────────

const SMOKE_2CHAIN = Object.freeze({
  shape: 'circle',
  radius: 3,
  arc: 360,
  count: 4,
  groupName: 'Left Smokestack',
  splits: 2,
  splitLayout: 'mirror',
});

test('mirror/2: two chains, per-chain group names L then R', () => {
  const plan = chainPlan(SMOKE_2CHAIN);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].suffix, 'L');
  assert.equal(plan[1].suffix, 'R');
  assert.equal(plan[0].groupName, 'Left Smokestack L');
  assert.equal(plan[1].groupName, 'Left Smokestack R');
  assert.equal(plan[0].count, 4);
  assert.equal(plan[1].count, 4);
});

test('mirror/2: chains fan opposite directions at ±(22.5,67.5,112.5,157.5)', () => {
  const [left, right] = chainPlan(SMOKE_2CHAIN);
  assert.deepEqual(left.angles, [22.5, 67.5, 112.5, 157.5]);
  assert.deepEqual(right.angles, [-22.5, -67.5, -112.5, -157.5]);
});

test('mirror/2: index 1 (array[0]) is the fixture nearest the start point', () => {
  const [left, right] = chainPlan(SMOKE_2CHAIN);
  // Nearest the start (0°) = smallest |angle|; array[0] (fixture #1) must win.
  for (let i = 1; i < left.angles.length; i++) {
    assert.ok(Math.abs(left.angles[0]) < Math.abs(left.angles[i]), `L[0] nearest start`);
    assert.ok(Math.abs(right.angles[0]) < Math.abs(right.angles[i]), `R[0] nearest start`);
  }
  assert.equal(Math.abs(left.angles[0]), 22.5);
  assert.equal(Math.abs(right.angles[0]), 22.5);
});

test('mirror/2: union of both chains gives even 45° coverage over full 360°', () => {
  const [left, right] = chainPlan(SMOKE_2CHAIN);
  const norm = (a) => ((a % 360) + 360) % 360;
  const all = [...left.angles, ...right.angles].map(norm).sort((a, b) => a - b);
  assert.equal(all.length, 8);
  // Consecutive gaps (with wrap) all exactly 45°.
  for (let i = 0; i < all.length; i++) {
    const next = i === all.length - 1 ? all[0] + 360 : all[i + 1];
    assert.ok(Math.abs(next - all[i] - 45) < 1e-9, `gap ${i} == 45°`);
  }
  // No fixture sits exactly on the start point (0°) or the far seam (180°).
  assert.ok(!all.some((a) => Math.abs(a - 0) < 1e-9 || Math.abs(a - 180) < 1e-9));
});

test('mirror/2: points match cos/sin of the planned angles on the ring', () => {
  const [left] = chainPlan(SMOKE_2CHAIN);
  for (let i = 0; i < left.angles.length; i++) {
    const rad = left.angles[i] * DEG2RAD;
    assert.ok(Math.abs(left.points[i].x - Math.cos(rad) * 3) < 1e-12);
    assert.ok(Math.abs(left.points[i].z - Math.sin(rad) * 3) < 1e-12);
    assert.equal(left.points[i].y, 0);
  }
});

test('mirror/2: startAngle shifts both chains by the same offset', () => {
  const start = 90;
  const [left, right] = chainPlan({ ...SMOKE_2CHAIN, startAngle: start });
  assert.deepEqual(left.angles, [112.5, 157.5, 202.5, 247.5]);
  assert.deepEqual(right.angles, [67.5, 22.5, -22.5, -67.5]);
});

// ── 3. sequential layout ────────────────────────────────────────────────────

test('sequential: N chains tile the arc, uniform ring of splits·count fixtures', () => {
  const plan = chainPlan({
    shape: 'circle',
    radius: 4,
    arc: 360,
    count: 3,
    groupName: 'Ring',
    splits: 4,
    splitLayout: 'sequential',
  });
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((c) => c.groupName), [
    'Ring Chain 1',
    'Ring Chain 2',
    'Ring Chain 3',
    'Ring Chain 4',
  ]);
  // Each chain starts at its own block start; fixture #1 sits there.
  assert.equal(plan[0].angles[0], 0);
  assert.equal(plan[1].angles[0], 90);
  assert.equal(plan[2].angles[0], 180);
  assert.equal(plan[3].angles[0], 270);
  // Combined ring: 12 fixtures spaced exactly 30° (360/12).
  const all = plan.flatMap((c) => c.angles).sort((a, b) => a - b);
  assert.equal(all.length, 12);
  for (let i = 1; i < all.length; i++) {
    assert.ok(Math.abs(all[i] - all[i - 1] - 30) < 1e-9, `sequential gap ${i}`);
  }
});

test('sequential: splits=2 tiles into head-to-tail halves', () => {
  const plan = chainPlan({
    shape: 'circle',
    radius: 3,
    arc: 360,
    count: 2,
    groupName: 'Half',
    splits: 2,
    splitLayout: 'sequential',
  });
  assert.deepEqual(plan.map((c) => c.groupName), ['Half Chain 1', 'Half Chain 2']);
  assert.deepEqual(plan[0].angles, [0, 90]);
  assert.deepEqual(plan[1].angles, [180, 270]);
});

// ── 4. chainGroupNames (used by BOTH gui_builder and config.js) ──────────────

test('chainGroupNames: splits=1 -> [groupName] (the legacy single-group contract)', () => {
  assert.deepEqual(chainGroupNames(SMOKESTACK_TRACE), ['Left Top Chimney Generator']);
  assert.deepEqual(chainGroupNames({ ...SMOKESTACK_TRACE, splits: 1 }), [
    'Left Top Chimney Generator',
  ]);
});

test('chainGroupNames: mirror -> [L, R]; sequential -> [Chain 1..N]', () => {
  assert.deepEqual(chainGroupNames(SMOKE_2CHAIN), ['Left Smokestack L', 'Left Smokestack R']);
  assert.deepEqual(
    chainGroupNames({ ...SMOKESTACK_TRACE, splits: 3, splitLayout: 'sequential' }),
    ['Left Top Chimney Generator Chain 1', 'Left Top Chimney Generator Chain 2', 'Left Top Chimney Generator Chain 3'],
  );
});

test('chainGroupNames: names are distinct within a trace (no self-collision), and agree with chainPlan', () => {
  for (const trace of [
    SMOKE_2CHAIN,
    { ...SMOKESTACK_TRACE, splits: 4, splitLayout: 'sequential' },
  ]) {
    const names = chainGroupNames(trace);
    assert.equal(new Set(names).size, names.length, 'names must be unique');
    assert.deepEqual(chainPlan(trace).map((c) => c.groupName), names);
  }
});

test('chainGroupNames: blank/missing groupName fails loud (would collide onto " L"/" R"/" Chain N")', () => {
  assert.throws(() => chainGroupNames({ ...SMOKE_2CHAIN, groupName: '' }), /non-empty string/);
  assert.throws(() => chainGroupNames({ ...SMOKE_2CHAIN, groupName: '   ' }), /non-empty string/);
  assert.throws(() => chainGroupNames({ ...SMOKE_2CHAIN, groupName: undefined }), /non-empty string/);
  assert.throws(() => chainGroupNames({ ...SMOKE_2CHAIN, groupName: 42 }), /non-empty string/);
});

// ── 5. Fail-loud validation (no fallbacks) ──────────────────────────────────

test('validation: 0 fixtures (count<1) fails loud — no clamp to 1, no default', () => {
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, count: 0 }), /count .* >= 1/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, count: -3 }), /count .* >= 1/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, count: 2.5 }), /count .* integer/);
  // count missing must NOT silently default to 8 (gui's clamp is intentionally
  // not reproduced — the caller must supply a real count).
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, count: undefined }), /count/);
});

test('validation: splits out of range or non-integer fails loud (splits>fixtures class)', () => {
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, splits: 0 }), /splits must be an integer/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, splits: 5 }), /splits must be an integer/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, splits: 2.5 }), /splits must be an integer/);
});

test("validation: 'mirror' layout requires exactly splits=2", () => {
  assert.throws(
    () => chainPlan({ ...SMOKESTACK_TRACE, splits: 3, splitLayout: 'mirror' }),
    /mirror.*requires splits=2/,
  );
  assert.throws(
    () => chainPlan({ ...SMOKESTACK_TRACE, splits: 4, splitLayout: 'mirror' }),
    /mirror.*requires splits=2/,
  );
  // splits=1 ignores layout (mirror default must not throw for a single chain).
  assert.doesNotThrow(() => chainPlan({ ...SMOKESTACK_TRACE, splits: 1, splitLayout: 'mirror' }));
});

test('validation: unknown splitLayout fails loud', () => {
  assert.throws(
    () => chainPlan({ ...SMOKE_2CHAIN, splitLayout: 'spiral' }),
    /splitLayout must be one of/,
  );
});

test('validation: non-finite startAngle fails loud', () => {
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, startAngle: NaN }), /startAngle/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, startAngle: Infinity }), /startAngle/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, startAngle: '30' }), /startAngle/);
});

test('validation: non-circle shape, bad radius/arc fail loud', () => {
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, shape: 'line' }), /only circle traces/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, radius: 0 }), /radius must be a positive/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, radius: -1 }), /radius must be a positive/);
  assert.throws(() => chainPlan({ ...SMOKESTACK_TRACE, arc: 0 }), /arc must be a positive/);
});

test('validation: non-object trace fails loud', () => {
  assert.throws(() => chainPlan(null), /expected a trace object/);
  assert.throws(() => chainPlan(undefined), /expected a trace object/);
  assert.throws(() => chainGroupNames(42), /expected a trace object/);
});
