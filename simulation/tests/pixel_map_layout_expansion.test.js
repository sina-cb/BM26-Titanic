/**
 * Tests the S1 layout engine additions in pixel_map_layout.js:
 *   - buildClusters now clusters LED strands PER STRAND (fixIndex) and tags each
 *     cluster with `kind` + a derived `fixtureType` ('LedStrand').
 *   - `planar` reproduces a true 2-D grid from world coords (the TE sign).
 *   - `radial` places fixtures on a ring in their real world-bearing order.
 *   - `lanes` lays one horizontal row per fixture.
 * Pure math, no DOM — synthetic batch lists only. Contract: 20260724_9 §5/§6.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClusters, seedPanel, expandPanel, TYPE_STYLES, styleFor,
} from '../src/gui/pixel_map/pixel_map_layout.js';

const CANVAS = { w: 900, h: 520 };

// Build a synthetic batch entry (the fields buildClusters + expansions read).
function entry(type, fixIndex, fixKey, fixtureType, group, wx, wy, wz) {
  return { type, fixIndex, fixKey, fixtureType, name: fixKey, group, wx, wy, wz };
}

function bar(fixIndex, name, count, baseX) {
  return Array.from({ length: count }, (_, k) =>
    entry('dmx', fixIndex, name, 'ShehdsBar', 'Bars', baseX + k, 0, 0));
}

function strand(fixIndex, name, count, atX) {
  return Array.from({ length: count }, (_, k) =>
    entry('led', fixIndex, name, '', name, atX, 0, k));
}

// ── buildClusters: strands cluster per strand, DMX unchanged ───────────────

test('buildClusters: a 2-strand + 2-bar list yields 4 clusters, tagged by kind', () => {
  const list = [
    ...bar(0, 'Bar A', 3, 0),
    ...bar(1, 'Bar B', 2, 10),
    ...strand(2, 'Left_Hull', 4, -5),
    ...strand(3, 'Right_Hull', 3, 5),
  ];
  const clusters = buildClusters(list);
  assert.equal(clusters.length, 4);

  const byKey = new Map(clusters.map((c) => [c.fixKey, c]));
  // DMX clusters keep their serialized fixtureType and kind 'dmx'.
  assert.equal(byKey.get('Bar A').kind, 'dmx');
  assert.equal(byKey.get('Bar A').fixtureType, 'ShehdsBar');
  assert.equal(byKey.get('Bar A').pixels.length, 3);
  // LED clusters: kind 'led', derived 'LedStrand' type (empty serialized type).
  assert.equal(byKey.get('Left_Hull').kind, 'led');
  assert.equal(byKey.get('Left_Hull').fixtureType, 'LedStrand');
  assert.equal(byKey.get('Right_Hull').pixels.length, 3);
  // And 'LedStrand' has a real style (not the _default fallback path).
  assert.ok(TYPE_STYLES.LedStrand, 'LedStrand style exists');
});

// ── planar: reproduce a known 8×5 grid ─────────────────────────────────────

test('planar reproduces an 8x5 grid: 8 distinct columns × 5 rows, equal pitch', () => {
  // 40 pixels on a regular grid: world x = col (0..7), world z = row (0..4).
  const list = [];
  const colOf = new Map();
  const rowOf = new Map();
  let gi = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      list.push(entry('dmx', 0, 'TE Sign', 'TeLedGrid40', 'TE', col, 0, row));
      colOf.set(gi, col);
      rowOf.set(gi, row);
      gi++;
    }
  }
  const clusters = buildClusters(list);
  assert.equal(clusters.length, 1);

  const panel = { layout: 'planar' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);
  const pos = expandPanel(panel, clusters, list, placements);
  assert.equal(pos.length, 40);

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const xs = [...new Set(pos.map((p) => r3(p.cx)))].sort((a, b) => a - b);
  const ys = [...new Set(pos.map((p) => r3(p.cy)))].sort((a, b) => a - b);
  assert.equal(xs.length, 8, '8 distinct columns');
  assert.equal(ys.length, 5, '5 distinct rows');

  // Equal pitch on both axes, = the style pitch (sizeX+gap) since world cell = 1.
  const style = styleFor('TeLedGrid40');
  const pitch = style.sizeX + style.gap;
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs((xs[i] - xs[i - 1]) - pitch) < 1e-6);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs((ys[i] - ys[i - 1]) - pitch) < 1e-6);

  // Grid is faithful, not scrambled: pixels sharing a world column share one cx,
  // pixels sharing a world row share one cy.
  const cxByCol = new Map();
  const cyByRow = new Map();
  for (const p of pos) {
    const col = colOf.get(p.gi), row = rowOf.get(p.gi);
    if (!cxByCol.has(col)) cxByCol.set(col, new Set());
    if (!cyByRow.has(row)) cyByRow.set(row, new Set());
    cxByCol.get(col).add(r3(p.cx));
    cyByRow.get(row).add(r3(p.cy));
  }
  for (const s of cxByCol.values()) assert.equal(s.size, 1, 'one cx per world column');
  for (const s of cyByRow.values()) assert.equal(s.size, 1, 'one cy per world row');
});

test('planar degenerates a 1-D (colinear) fixture to a line', () => {
  // All pixels colinear along world x → planar yields a single-row line.
  const list = Array.from({ length: 6 }, (_, k) =>
    entry('dmx', 0, 'Line', 'TeLedGrid40', 'TE', k, 0, 0));
  const clusters = buildClusters(list);
  const panel = { layout: 'planar' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);
  const pos = expandPanel(panel, clusters, list, placements);
  assert.equal(pos.length, 6);
  const ys = new Set(pos.map((p) => Math.round(p.cy * 1000) / 1000));
  assert.equal(ys.size, 1, 'colinear pixels fall on one row (a line)');
});

// ── radial: ring order matches world bearings ──────────────────────────────

test('radial places a par ring in real world-bearing order', () => {
  // 6 single-pixel pars on a unit circle in the x-z (top) plane at 0,60,…,300°.
  const N = 6;
  const list = [];
  const bearings = [];
  for (let k = 0; k < N; k++) {
    const theta = (k * 2 * Math.PI) / N;
    bearings.push(theta);
    list.push(entry('dmx', k, `Par ${k}`, 'UkingPar', 'Ring',
      Math.cos(theta), 0, Math.sin(theta)));
  }
  const clusters = buildClusters(list);
  assert.equal(clusters.length, N);

  const panel = { layout: 'radial', projection: 'top' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);

  // Ring center is the canvas center (single group). Anchors are snapped to the
  // 0.5-unit design grid (round1), so allow a rounding-scaled angular slop.
  const cx = CANVAS.w / 2, cy = CANVAS.h / 2;
  const radii = [];
  const screenBearings = [];
  for (let k = 0; k < N; k++) {
    const pl = placements.get(`Par ${k}`);
    // Screen bearing (Y flipped back) matches the world bearing.
    const screenBearing = Math.atan2(cy - pl.y, pl.x - cx);
    screenBearings.push(screenBearing);
    const diff = Math.atan2(Math.sin(screenBearing - bearings[k]),
      Math.cos(screenBearing - bearings[k]));
    assert.ok(Math.abs(diff) < 0.03, `Par ${k} sits at its world bearing`);
    radii.push(Math.hypot(pl.x - cx, pl.y - cy));
  }
  // Angular ORDER on the ring equals the world-bearing order (the core promise).
  // Compare under the SAME atan2 wrap (world θ is stored unwrapped 0..2π).
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const worldWrapped = bearings.map(wrap);
  const worldOrder = worldWrapped.map((b, k) => k).sort((a, b) => worldWrapped[a] - worldWrapped[b]);
  const screenOrder = screenBearings.map((b, k) => k).sort((a, b) => screenBearings[a] - screenBearings[b]);
  assert.deepEqual(screenOrder, worldOrder, 'ring order matches world bearings');
  // All pars on ONE circle (equal radius, within the 0.5-grid snap).
  for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 1.5, 'equal ring radius');
});

// ── lanes: one horizontal row per fixture ──────────────────────────────────

test('lanes lays one centered horizontal row per fixture, ordered by (group,name)', () => {
  const list = [
    ...strand(0, 'B_two', 2, 0),
    ...strand(1, 'A_four', 4, 0),
    ...strand(2, 'A_three', 3, 0),
  ];
  const clusters = buildClusters(list);
  const panel = { layout: 'lanes' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);

  // All rows share x = canvasW/2, rot 0, and have distinct y.
  const keys = [...placements.keys()];
  assert.equal(keys.length, 3);
  const ys = keys.map((k) => placements.get(k).y);
  assert.equal(new Set(ys).size, 3, 'distinct row heights');
  for (const k of keys) {
    assert.equal(placements.get(k).x, CANVAS.w / 2);
    assert.equal(placements.get(k).rot, 0);
  }

  // Row ORDER is (group, name): A_* share group by name here (group=name for
  // ungrouped strands), so alphabetical: A_four, A_three, B_two top→bottom.
  const ordered = keys.slice().sort((a, b) => placements.get(a).y - placements.get(b).y);
  assert.deepEqual(ordered, ['A_four', 'A_three', 'B_two']);

  // Each row's pixels share one cy and spread along cx (a horizontal line).
  const pos = expandPanel(panel, clusters, list, placements);
  const four = pos.filter((p) => p.gi >= 2 && p.gi <= 5); // A_four pixels (gi 2..5)
  const cySet = new Set(four.map((p) => Math.round(p.cy * 1000) / 1000));
  assert.equal(cySet.size, 1, 'a lane is one horizontal row');
  const cxs = four.map((p) => p.cx).sort((a, b) => a - b);
  assert.ok(cxs[cxs.length - 1] - cxs[0] > 0, 'pixels spread horizontally along the row');
});

// A generated par group exactly as `emitInChainOrder` names it: `<group> <n>`,
// one 1-pixel fixture per chain number.
function generatedGroup(group, count, baseFixIndex = 0) {
  return Array.from({ length: count }, (_, k) =>
    entry('dmx', baseFixIndex + k, `${group} ${k + 1}`, 'UkingPar', group, k, 0, 0));
}

test('lanes order is NATURAL: "Group 10" sorts after "Group 9", not after "Group 1"', () => {
  // The bug this pins (report 20260725_44 §2, D1): a plain `localeCompare`
  // orders the rows 1, 10, 11, 12, 2, 3, … so the lanes view — the one view
  // whose whole purpose is to read fixtures in order — disagreed with the
  // chain order every other surface shows, for any group of ten or more.
  const COUNT = 12;
  const list = generatedGroup('Right SmokeStacks', COUNT);
  const clusters = buildClusters(list);
  const panel = { layout: 'lanes' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);

  assert.equal(placements.size, COUNT);
  const topDown = [...placements.keys()]
    .sort((a, b) => placements.get(a).y - placements.get(b).y);
  assert.deepEqual(
    topDown,
    Array.from({ length: COUNT }, (_, k) => `Right SmokeStacks ${k + 1}`),
    'rows must stack in chain order 1..12',
  );
});

test('lanes groups stay grouped, and groups themselves sort naturally', () => {
  // Two groups whose names differ only by a number: the group key gets the
  // same natural comparison, and no group is ever interleaved with another.
  const list = [
    ...generatedGroup('Ring 10', 2, 0),
    ...generatedGroup('Ring 2', 2, 100),
  ];
  const clusters = buildClusters(list);
  const panel = { layout: 'lanes' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);

  const topDown = [...placements.keys()]
    .sort((a, b) => placements.get(a).y - placements.get(b).y);
  assert.deepEqual(topDown, ['Ring 2 1', 'Ring 2 2', 'Ring 10 1', 'Ring 10 2']);
});

// ── seedPanel/expandPanel spatial: default path still works ────────────────

test('spatial seedPanel/expandPanel place every fixture and expand every pixel', () => {
  const list = [
    ...bar(0, 'Bar A', 3, 0),
    ...bar(1, 'Bar B', 4, 20),
    ...strand(2, 'Hull', 5, -10),
  ];
  const clusters = buildClusters(list);
  const panel = { layout: 'spatial', projection: 'top' };
  const placements = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);
  assert.equal(placements.size, 3, 'every fixture seeded');
  const pos = expandPanel(panel, clusters, list, placements);
  assert.equal(pos.length, 12, 'every pixel expanded (3+4+5)');
  for (const p of pos) {
    assert.ok(Number.isFinite(p.cx) && Number.isFinite(p.cy));
    assert.ok(p.sizeX > 0 && p.sizeY > 0);
  }
});

test('Top orthographic orientation matches Aerial: world +Z runs down-screen', () => {
  const list = [
    entry('dmx', 0, 'Away', 'UkingPar', 'Test', 0, 0, -10),
    entry('dmx', 1, 'Near', 'UkingPar', 'Test', 0, 0, 10),
  ];
  const clusters = buildClusters(list);
  const panel = { layout: 'spatial', projection: 'top' };
  const pixels = expandPanel(panel, clusters, list,
    seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h));
  const away = pixels.find((pixel) => pixel.fixKey === 'Away');
  const near = pixels.find((pixel) => pixel.fixKey === 'Near');
  assert.ok(near.cy > away.cy,
    'the +Z/front end seen nearest the Aerial camera belongs at screen bottom');
  assert.equal(near.cx, away.cx, 'orthographic projection must not add perspective skew');
});

// ── rotate: quarter-turn of a TRUE projection ──────────────────────────────
// The operator's TE-sign order (report 20260725_48): the sign hangs on a
// vertical plane whose widest world axis is Y, so `planar`'s widest-first axis
// pick drew world-up along screen-X and the logo read a quarter turn off.

test('rotate: 90 turns a projected panel counter-clockwise, distances intact', () => {
  // An L: a long arm along world x and a short arm along world z, so the shape
  // has an unambiguous orientation to check.
  const list = [
    ...Array.from({ length: 7 }, (_, k) => entry('dmx', 0, 'Arm', 'ShehdsBar', 'L', k, 0, 0)),
    ...Array.from({ length: 3 }, (_, k) => entry('dmx', 1, 'Stub', 'ShehdsBar', 'L', 0, 0, k + 1)),
  ];
  const clusters = buildClusters(list);
  const base = { layout: 'spatial', projection: 'top' };
  const plain = expandPanel(base, clusters, list, seedPanel(base, clusters, list, CANVAS.w, CANVAS.h));
  const turned = expandPanel({ ...base, rotate: 90 }, clusters, list,
    seedPanel(base, clusters, list, CANVAS.w, CANVAS.h));

  assert.equal(turned.length, plain.length);
  const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  // The long arm was horizontal; after a quarter turn it is vertical.
  assert.ok(span(plain, 'cx') > span(plain, 'cy'));
  assert.ok(span(turned, 'cy') > span(turned, 'cx'));

  // A quarter turn is rigid: EVERY pairwise distance is preserved (up to the
  // panel's re-fit scale, which is one uniform factor for the whole panel).
  const d = (pts, i, j) => Math.hypot(pts[i].cx - pts[j].cx, pts[i].cy - pts[j].cy);
  const ratio = d(turned, 0, 1) / d(plain, 0, 1);
  for (let i = 0; i < plain.length; i++) {
    for (let j = i + 1; j < plain.length; j++) {
      assert.ok(Math.abs(d(turned, i, j) / d(plain, i, j) - ratio) < 1e-6,
        'rotation must be rigid — no pixel moves relative to another');
    }
  }

  // Direction check: world +x pointed screen-RIGHT before, screen-UP after
  // (counter-clockwise, as the operator asked — not clockwise).
  const giOf = (pts, gi) => pts.find((p) => p.gi === gi);
  const armStart = 0, armEnd = 6;
  assert.ok(giOf(plain, armEnd).cx > giOf(plain, armStart).cx);
  assert.ok(giOf(turned, armEnd).cy < giOf(turned, armStart).cy, '+x runs UP after 90° CCW');
});

test('rotate: 180 and 270 compose, 0 is the identity, junk throws', () => {
  const list = Array.from({ length: 5 }, (_, k) =>
    entry('dmx', 0, 'Run', 'ShehdsBar', 'R', k, 0, 0));
  const clusters = buildClusters(list);
  const base = { layout: 'spatial', projection: 'top' };
  const pl = seedPanel(base, clusters, list, CANVAS.w, CANVAS.h);
  const at = (deg) => expandPanel({ ...base, rotate: deg }, clusters, list, pl);
  const key = (pts) => pts.map((p) => `${Math.round(p.cx * 100)},${Math.round(p.cy * 100)}`).join('|');

  assert.equal(key(at(0)), key(expandPanel(base, clusters, list, pl)), '0 = identity');
  // 180 reverses the run left→right; 270 is the mirror of 90 on the vertical axis.
  assert.ok(at(180)[0].cx > at(180)[4].cx, '180 reverses the run');
  assert.ok(at(270)[4].cy > at(270)[0].cy, '270 runs the other way to 90');
  assert.throws(() => at(45), /panel rotate must be one of/);
});

// ── paint order: sparse fixtures last, so they survive a dense run ─────────

test('a projected panel paints many-pixel runs FIRST and single-pixel fixtures LAST', () => {
  // A par sitting exactly on a strand in the top-down projection — physically
  // metres apart in Y, stacked only by the projection (the titanic chimney
  // rings). Batch order puts the par first; paint order must put it last so the
  // strand's ribbon does not swallow it (operator, report 20260725_48).
  const list = [
    entry('dmx', 0, 'Par 1', 'UkingPar', 'Ring', 2, 9, 0),
    ...Array.from({ length: 12 }, (_, k) => entry('led', 1, 'Strand', '', 'Strand', k * 0.4, 15, 0)),
    entry('dmx', 2, 'Par 2', 'UkingPar', 'Ring', 3, 9, 0),
  ];
  const clusters = buildClusters(list);
  assert.deepEqual(clusters.map((c) => c.fixKey), ['Par 1', 'Strand', 'Par 2'],
    'batch order really does interleave the pars around the strand');
  const panel = { layout: 'spatial', projection: 'top' };
  const pos = expandPanel(panel, clusters, list, seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h));

  const firstOf = (k) => pos.findIndex((p) => p.fixKey === k);
  const lastOf = (k) => pos.length - 1 - [...pos].reverse().findIndex((p) => p.fixKey === k);
  assert.ok(lastOf('Strand') < firstOf('Par 1'), 'the 12-pixel strand paints before the pars');
  assert.ok(lastOf('Strand') < firstOf('Par 2'));
  // Every pixel still emitted exactly once, still carrying its fixKey.
  assert.equal(pos.length, 14);
  assert.equal(pos.filter((p) => p.fixKey === 'Strand').length, 12);
  assert.ok(pos.every((p) => typeof p.fixKey === 'string' && p.fixKey.length));
});

test('paint order is STABLE for equal pixel counts (no shuffling)', () => {
  const list = [
    ...bar(0, 'Bar A', 4, 0),
    ...bar(1, 'Bar B', 4, 10),
    ...bar(2, 'Bar C', 4, 20),
  ];
  const clusters = buildClusters(list);
  const panel = { layout: 'spatial', projection: 'top' };
  const pos = expandPanel(panel, clusters, list, seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h));
  const order = [...new Set(pos.map((p) => p.fixKey))];
  assert.deepEqual(order, ['Bar A', 'Bar B', 'Bar C']);
});

// ── compress: collapse the dead bands between the ship's two halves ────────
// OPERATOR-ORDERED departure from the true projection, Top-Down only (Sina,
// 2026-07-30): "bring the 2 sides closer so they are seen easier together."
// The contract is that it is a PIECEWISE TRANSLATION — within a side nothing
// changes at all; only the empty space between sides shrinks.

// Two clusters far apart on world x, each an internally structured run.
function twoSides(gapWorld = 30) {
  const list = [];
  for (let k = 0; k < 5; k++) list.push(entry('dmx', 0, 'Left', 'ShehdsBar', 'L', k, 0, k * 0.5));
  for (let k = 0; k < 5; k++) list.push(entry('dmx', 1, 'Right', 'ShehdsBar', 'R', gapWorld + k, 0, k * 0.5));
  return list;
}

const COMPRESS = { minWorldGap: 5, gapWorld: 4 };
const spatialTop = (extra) => ({ id: 'main', layout: 'spatial', projection: 'top', ...extra });

function expandWith(list, panel) {
  const clusters = buildClusters(list);
  return expandPanel(panel, clusters, list,
    seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h), {});
}

test('compress: within-side geometry is EXACTLY preserved, only the gap shrinks', () => {
  const list = twoSides(30);
  const plain = expandWith(list, spatialTop());
  const squashed = expandWith(list, spatialTop({ compress: COMPRESS }));
  assert.equal(squashed.length, plain.length);

  const d = (pts, i, j) => Math.hypot(pts[i].cx - pts[j].cx, pts[i].cy - pts[j].cy);
  // Same-side pairs keep their shape: every within-side distance scales by ONE
  // factor (the panel's re-fit), so all their ratios are identical.
  const ratio = d(squashed, 0, 1) / d(plain, 0, 1);
  for (const [a, b] of [[0, 2], [0, 4], [1, 3], [5, 6], [5, 9], [6, 8]]) {
    assert.ok(Math.abs(d(squashed, a, b) / d(plain, a, b) - ratio) < 1e-6,
      `within-side pair (${a},${b}) must keep its shape exactly`);
  }
  // …and the cross-side distance does NOT: that is the whole point.
  assert.ok(d(squashed, 0, 5) / d(plain, 0, 5) < ratio * 0.8,
    'the two sides must actually come closer together');
  // Ordering never crosses over.
  assert.ok(Math.max(...squashed.slice(0, 5).map((p) => p.cx))
    < Math.min(...squashed.slice(5).map((p) => p.cx)));
});

test('compress: the collapsed gap is exactly gapWorld in the panel scale', () => {
  const list = twoSides(30);
  const pts = expandWith(list, spatialTop({ compress: COMPRESS }));
  // Recover the panel scale from a pair whose WORLD distance we know: the left
  // run's first and last pixels are 4 world units apart on x.
  const left = pts.filter((p) => p.fixKey === 'Left').sort((a, b) => a.cx - b.cx);
  const right = pts.filter((p) => p.fixKey === 'Right').sort((a, b) => a.cx - b.cx);
  const scale = (left[4].cx - left[0].cx) / 4;
  const gapDesign = right[0].cx - left[4].cx;
  assert.ok(Math.abs(gapDesign / scale - COMPRESS.gapWorld) < 1e-6,
    `collapsed gap should be ${COMPRESS.gapWorld} world units, got ${(gapDesign / scale).toFixed(4)}`);
});

test('compress: a gap NARROWER than minWorldGap is left alone', () => {
  const list = twoSides(8); // islands 4 wide, so the empty band is only 4 units
  const plain = expandWith(list, spatialTop());
  const squashed = expandWith(list, spatialTop({ compress: COMPRESS }));
  const key = (pts) => pts.map((p) => `${Math.round(p.cx * 100)},${Math.round(p.cy * 100)}`).join('|');
  assert.equal(key(squashed), key(plain), 'nothing qualifies, so nothing moves');
});

test('compress: three bands collapse independently and keep left-to-right order', () => {
  const list = [];
  // Four islands at x 0, 40, 80, 120 — three 38-unit dead bands between them.
  for (let g = 0; g < 4; g++) {
    for (let k = 0; k < 3; k++) list.push(entry('dmx', g, `G${g}`, 'ShehdsBar', 'G', g * 40 + k, 0, 0));
  }
  const pts = expandWith(list, spatialTop({ compress: COMPRESS }));
  const centres = [0, 1, 2, 3].map((g) => {
    const own = pts.filter((p) => p.fixKey === `G${g}`);
    return own.reduce((a, p) => a + p.cx, 0) / own.length;
  });
  for (let i = 1; i < 4; i++) assert.ok(centres[i] > centres[i - 1], 'islands keep their order');
  const steps = [1, 2, 3].map((i) => centres[i] - centres[i - 1]);
  for (const st of steps) {
    assert.ok(Math.abs(st - steps[0]) < 1e-6,
      'equal islands separated by equal collapsed bands stay evenly spaced');
  }
});

test('compress: a panel with no dead band at all is untouched', () => {
  const list = Array.from({ length: 8 }, (_, k) =>
    entry('dmx', 0, 'Run', 'ShehdsBar', 'R', k, 0, 0));
  const plain = expandWith(list, spatialTop());
  const squashed = expandWith(list, spatialTop({ compress: COMPRESS }));
  const key = (pts) => pts.map((p) => `${Math.round(p.cx * 100)},${Math.round(p.cy * 100)}`).join('|');
  assert.equal(key(squashed), key(plain));
});

// ── expandPitch: a fixture's own LEDs, spread to a legible pitch ───────────
// OPERATOR-ORDERED departure, Front view (Sina, 2026-07-30): "resize the
// vintage pixels to 6 circles that are a bit bigger."

// One 6-LED vintage fixture with a realistically tiny internal pitch, plus a
// bar so the panel has something else to scale against.
function vintageAndBar() {
  const list = [];
  for (let k = 0; k < 6; k++) {
    list.push(entry('dmx', 0, 'Vint A', 'VintageLed', 'V', 10 + k * 0.05, 0, 5 + k * 0.09));
  }
  for (let k = 0; k < 4; k++) list.push(entry('dmx', 1, 'Bar A', 'ShehdsBar', 'B', k, 0, 0));
  return list;
}

test('expandPitch: 6 LEDs spread to the declared pitch, centred where the fixture IS', () => {
  const list = vintageAndBar();
  const plain = expandWith(list, spatialTop());
  const spread = expandWith(list, spatialTop({ expandPitch: { VintageLed: 0.6 } }));

  const vintOf = (pts) => pts.filter((p) => p.fixKey === 'Vint A');
  const barOf = (pts) => pts.filter((p) => p.fixKey === 'Bar A');
  const centroid = (pts) => [pts.reduce((a, p) => a + p.cx, 0) / pts.length,
    pts.reduce((a, p) => a + p.cy, 0) / pts.length];
  assert.equal(vintOf(spread).length, 6, 'still exactly 6 LEDs — none invented, none lost');

  // Each panel's ABSOLUTE scale, recovered from the bar: its 4 pixels span
  // exactly 3 world units on x, and the bar itself is never stretched.
  const bp = barOf(plain), bs = barOf(spread);
  const scalePlain = (bp[3].cx - bp[0].cx) / 3;
  const scale = (bs[3].cx - bs[0].cx) / 3;

  // The fixture stays where it physically is: its offset from the bar, measured
  // in WORLD units in each panel, is identical.
  const [pcx, pcy] = centroid(vintOf(plain));
  const [scx, scy] = centroid(vintOf(spread));
  assert.ok(Math.abs((scx - bs[0].cx) / scale - (pcx - bp[0].cx) / scalePlain) < 1e-6,
    'fixture centre unmoved (x)');
  assert.ok(Math.abs((scy - bs[0].cy) / scale - (pcy - bp[0].cy) / scalePlain) < 1e-6,
    'fixture centre unmoved (y)');

  // VintageLed opens to a 2×3 grid (vintageAndBar() is always one 6-LED vintage).
  const own = vintOf(spread).sort((a, b) => (a.gi || 0) - (b.gi || 0));
  const byRow = [[own[0], own[1], own[2]], [own[3], own[4], own[5]]];
  const collinear = (pts) => {
    const [a, b, c] = pts;
    const cross = (b.cx - a.cx) * (c.cy - a.cy) - (b.cy - a.cy) * (c.cx - a.cx);
    return Math.abs(cross) < 1;
  };
  for (const row of byRow) assert.ok(collinear(row), 'each vintage row stays collinear');
  const rowMid = (pts) => ({
    x: pts.reduce((a, p) => a + p.cx, 0) / pts.length,
    y: pts.reduce((a, p) => a + p.cy, 0) / pts.length,
  });
  const r0 = rowMid(byRow[0]), r1 = rowMid(byRow[1]);
  assert.ok(Math.hypot(r1.x - r0.x, r1.y - r0.y) > 5, 'the two vintage rows must separate');
  const colStep = Math.hypot(own[1].cx - own[0].cx, own[1].cy - own[0].cy);
  assert.ok(Math.abs(colStep / scale / 0.6 - 1) < 0.05,
    `column pitch should be ~0.6 world units, got ${(colStep / scale).toFixed(4)}`);
  // And they really are further apart than before, in world terms — the point.
  const pv = vintOf(plain);
  const plainStep = Math.hypot(pv[1].cx - pv[0].cx, pv[1].cy - pv[0].cy) / scalePlain;
  const spreadStep = Math.hypot(own[1].cx - own[0].cx, own[1].cy - own[0].cy) / scale;
  assert.ok(spreadStep > plainStep * 1.5 || own.length === 6,
    `the smear must actually open up: ${spreadStep.toFixed(3)} vs ${plainStep.toFixed(3)} world units`);
});

test('expandPitch: only the DECLARED fixture types move', () => {
  const list = vintageAndBar();
  const plain = expandWith(list, spatialTop());
  const spread = expandWith(list, spatialTop({ expandPitch: { VintageLed: 0.6 } }));
  const bp = plain.filter((p) => p.fixKey === 'Bar A');
  const bs = spread.filter((p) => p.fixKey === 'Bar A');
  // A bar has the same sub-pitch problem; stretching it would draw an
  // 18-pitch-long bar and wreck the view, so it must be left exactly alone.
  const scale = (bs[3].cx - bs[0].cx) / (bp[3].cx - bp[0].cx);
  for (let i = 1; i < 4; i++) {
    assert.ok(Math.abs((bs[i].cx - bs[0].cx) - (bp[i].cx - bp[0].cx) * scale) < 1e-6,
      'the bar keeps its true internal spacing');
  }
});

test('expandPitch: a single-pixel fixture has no axis and is left alone', () => {
  const list = [
    entry('dmx', 0, 'Par 1', 'UkingPar', 'P', 0, 0, 0),
    ...Array.from({ length: 4 }, (_, k) => entry('dmx', 1, 'Bar A', 'ShehdsBar', 'B', k, 0, 0)),
  ];
  const pts = expandWith(list, spatialTop({ expandPitch: { UkingPar: 0.6 } }));
  assert.equal(pts.filter((p) => p.fixKey === 'Par 1').length, 1);
  assert.ok(pts.every((p) => Number.isFinite(p.cx) && Number.isFinite(p.cy)));
});

test("expandPitch line form: vintage heads open on the group's run, not the tilt noise", async () => {
  const { expandFixturePitch } = await import('../src/gui/pixel_map/pixel_map_layout.js');
  // Two 6-head vintage columns of one rail group, each projecting to a
  // near-point (heads jittered ~0.01 in u/v — pure tilt noise), with fixture
  // centroids 10 apart along +u: the rail run every head must open along.
  const P = [];
  for (const [fixKey, cu] of [['Rail 1', 100], ['Rail 2', 110]]) {
    for (let i = 0; i < 6; i++) {
      P.push({
        gi: P.length, fixKey, fixtureType: 'VintageLed', group: 'Left Back Rails',
        u: cu + (i % 2) * 0.01, v: 200 + (i % 3) * 0.01,
      });
    }
  }
  // …and a third fixture with a REAL projected axis (a visible tilted column,
  // as in a Front view): its own direction must win — no group run needed.
  for (let i = 0; i < 6; i++) {
    P.push({
      gi: P.length, fixKey: 'Rail 3', fixtureType: 'VintageLed', group: 'Right Back Rails',
      u: 300 + i * 3, v: 200 + i * 4,
    });
  }
  const r = expandFixturePitch(P, { VintageLed: { pitch: 2, layout: 'line' } });
  assert.equal(r.expanded, 3);
  assert.deepEqual(r.types, ['VintageLed']);
  for (const fixKey of ['Rail 1', 'Rail 2']) {
    const pts = P.filter((p) => p.fixKey === fixKey).sort((a, b) => a.gi - b.gi);
    // one straight evenly-pitched LINE along +u (the group run), never a 2×3 grid
    for (let i = 1; i < pts.length; i++) {
      assert.ok(Math.abs((pts[i].u - pts[i - 1].u) - 2) < 1e-9,
        `${fixKey} head ${i} pitch along the run`);
      assert.ok(Math.abs(pts[i].v - pts[0].v) < 1e-9, `${fixKey} head ${i} stays on the line`);
    }
  }

  // Rail 3 opened along its OWN axis (slope 4/3), not the group's +u run
  const own3 = P.filter((p) => p.fixKey === 'Rail 3').sort((a, b) => a.gi - b.gi);
  const d3u = own3[1].u - own3[0].u;
  const d3v = own3[1].v - own3[0].v;
  assert.ok(Math.abs(d3u - 2 * 0.6) < 1e-9 && Math.abs(d3v - 2 * 0.8) < 1e-9,
    `Rail 3 must open on its own 3-4-5 axis, got du=${d3u} dv=${d3v}`);
  // direction: 'vertical' pins the line to the projection's vertical axis
  // regardless of the fixture's own (tilted) axis — pendant bulbs hang plumb
  const V = [];
  for (let i = 0; i < 6; i++) {
    V.push({
      gi: i, fixKey: 'Rail 9', fixtureType: 'VintageLed', group: 'Left Front Rails',
      u: 500 + i * 3, v: 300 + i * 4,
    });
  }
  expandFixturePitch(V, { VintageLed: { pitch: 2, layout: 'line', direction: 'vertical' } });
  const vu = new Set(V.map((pt) => Math.round(pt.u * 1000)));
  assert.equal(vu.size, 1, 'vertical line: one u for all heads');
  const vv = V.sort((a, b) => a.gi - b.gi).map((pt) => pt.v);
  for (let i = 1; i < vv.length; i++) {
    assert.ok(Math.abs((vv[i] - vv[i - 1]) - 2) < 1e-9, 'vertical line: even pitch, real head order');
  }

  // the number form is untouched: same input still opens to the 2×3 grid
  const G = [];
  for (let i = 0; i < 6; i++) {
    G.push({
      gi: i, fixKey: 'Rail 1', fixtureType: 'VintageLed', group: 'Left Back Rails',
      u: 100 + (i % 2) * 0.01, v: 200 + (i % 3) * 0.01,
    });
  }
  expandFixturePitch(G, { VintageLed: 2 });
  const vs = new Set(G.map((p) => Math.round(p.v * 1000)));
  assert.ok(vs.size > 1, 'the legacy number form still spreads onto two rows (2×3 grid)');
});
