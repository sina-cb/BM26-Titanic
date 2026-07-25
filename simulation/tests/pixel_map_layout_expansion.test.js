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
