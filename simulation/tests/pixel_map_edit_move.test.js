/**
 * pixel_map_edit_move.test.js — EDIT-mode move and right-click group selection
 * (operator order 2026-07-30, report 20260725_55).
 *
 * The bug this fixes was a SILENT NO-OP, which is the thing these tests really
 * guard: drag/nudge already existed and wrote `placements`, but every shipped
 * view is a `spatial`/`planar` panel and those layouts compute each position
 * from world coordinates and **ignore placements entirely** — so moving a
 * fixture in Top-Down changed nothing at all, with no error anywhere.
 *
 * Moves on a projected panel are therefore OFFSETS: a per-fixture delta applied
 * after the fit. Granularity is per FIXTURE, which is exactly the granularity of
 * the selection (a Set of fixKeys), so no per-pixel persistence is invented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClusters, seedPanel, expandPanel, PROJECTED_LAYOUTS,
} from '../src/gui/pixel_map/pixel_map_layout.js';
import {
  createViewsContainer, addView, findView, toParams, validateViewDef, validateOffsets,
} from '../src/gui/pixel_map/pixel_map_views.js';
import { buildDefaultViews, DEFAULT_VIEWS } from '../src/gui/pixel_map/pixel_map_view_defaults.js';

const CANVAS = { w: 900, h: 520 };

function entry(type, fixIndex, fixKey, fixtureType, group, wx, wy, wz) {
  return { type, fixIndex, fixKey, fixtureType, name: fixKey, group, wx, wy, wz };
}
function rig() {
  const list = [];
  for (let k = 0; k < 4; k++) list.push(entry('dmx', 0, 'Bar A', 'ShehdsBar', 'Left Wall', k, 0, 0));
  for (let k = 0; k < 4; k++) list.push(entry('dmx', 1, 'Bar B', 'ShehdsBar', 'Left Wall', 10 + k, 0, 0));
  for (let k = 0; k < 4; k++) list.push(entry('dmx', 2, 'Bar C', 'ShehdsBar', 'Right Wall', 20 + k, 0, 6));
  return list;
}
const SPATIAL = { id: 'main', layout: 'spatial', projection: 'top' };
function expand(offsets, panel = SPATIAL) {
  const list = rig();
  const clusters = buildClusters(list);
  return expandPanel(panel, clusters, list,
    seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h), {}, offsets);
}
const posOf = (pts, key) => {
  const own = pts.filter((p) => p.fixKey === key);
  return [own.reduce((a, p) => a + p.cx, 0) / own.length,
    own.reduce((a, p) => a + p.cy, 0) / own.length];
};

// ─── the silent no-op, pinned ──────────────────────────────────────────────

test('the shipped views are ALL projected — which is why placements moved nothing', () => {
  // If a default view ever becomes radial/lanes this is the test that says the
  // move model changed for it.
  for (const v of DEFAULT_VIEWS) {
    for (const p of v.panels) {
      assert.ok(PROJECTED_LAYOUTS.has(p.layout),
        `view '${v.id}' panel '${p.id}' is '${p.layout}' — it obeys placements, ` +
        'not offsets, so the move model for it differs');
    }
  }
});

test('a placement still does nothing on a projected panel (unchanged, on purpose)', () => {
  const list = rig();
  const clusters = buildClusters(list);
  const placements = seedPanel(SPATIAL, clusters, list, CANVAS.w, CANVAS.h);
  const before = expandPanel(SPATIAL, clusters, list, placements, {});
  for (const [, v] of placements) { v.x += 250; v.y += 250; }
  const after = expandPanel(SPATIAL, clusters, list, placements, {});
  const key = (pts) => pts.map((p) => `${Math.round(p.cx)},${Math.round(p.cy)}`).join('|');
  assert.equal(key(after), key(before),
    'a TRUE projection must keep computing positions from world coordinates');
});

// ─── offsets: the move that works ──────────────────────────────────────────

test('an offset moves exactly that fixture, by exactly the delta', () => {
  const plain = expand(undefined);
  const moved = expand({ 'Bar A': { dx: 40, dy: -25 } });
  const [ax0, ay0] = posOf(plain, 'Bar A');
  const [ax1, ay1] = posOf(moved, 'Bar A');
  assert.ok(Math.abs(ax1 - (ax0 + 40)) < 1e-6, 'moved by dx exactly');
  assert.ok(Math.abs(ay1 - (ay0 - 25)) < 1e-6, 'moved by dy exactly');
  // …and nobody else shifted, and the fit box did not change.
  for (const other of ['Bar B', 'Bar C']) {
    const [bx0, by0] = posOf(plain, other);
    const [bx1, by1] = posOf(moved, other);
    assert.ok(Math.abs(bx1 - bx0) < 1e-6 && Math.abs(by1 - by0) < 1e-6,
      `'${other}' must not move when '${'Bar A'}' does`);
  }
});

test('a move is RIGID: the fixture keeps its own shape and pixel count', () => {
  const plain = expand(undefined);
  const moved = expand({ 'Bar A': { dx: 33, dy: 17 } });
  const own = (pts) => pts.filter((p) => p.fixKey === 'Bar A');
  assert.equal(own(moved).length, own(plain).length);
  for (let i = 1; i < own(plain).length; i++) {
    const dp = Math.hypot(own(plain)[i].cx - own(plain)[0].cx, own(plain)[i].cy - own(plain)[0].cy);
    const dm = Math.hypot(own(moved)[i].cx - own(moved)[0].cx, own(moved)[i].cy - own(moved)[0].cy);
    assert.ok(Math.abs(dp - dm) < 1e-6, 'internal spacing is untouched by a move');
  }
});

test('moving a whole selection moves each member by the same delta', () => {
  const plain = expand(undefined);
  const moved = expand({ 'Bar A': { dx: 20, dy: 10 }, 'Bar B': { dx: 20, dy: 10 } });
  for (const key of ['Bar A', 'Bar B']) {
    const [x0, y0] = posOf(plain, key);
    const [x1, y1] = posOf(moved, key);
    assert.ok(Math.abs(x1 - (x0 + 20)) < 1e-6 && Math.abs(y1 - (y0 + 10)) < 1e-6);
  }
});

test('offsets apply on planar panels too (the TE sign view)', () => {
  const list = rig();
  const clusters = buildClusters(list);
  const panel = { id: 'main', layout: 'planar' };
  const pl = seedPanel(panel, clusters, list, CANVAS.w, CANVAS.h);
  const plain = expandPanel(panel, clusters, list, pl, {});
  const moved = expandPanel(panel, clusters, list, pl, {}, { 'Bar A': { dx: 12, dy: 8 } });
  const [x0, y0] = posOf(plain, 'Bar A');
  const [x1, y1] = posOf(moved, 'Bar A');
  assert.ok(Math.abs(x1 - (x0 + 12)) < 1e-6 && Math.abs(y1 - (y0 + 8)) < 1e-6);
});

test('an offset for a fixture that is not on the panel is simply not applied', () => {
  const plain = expand(undefined);
  const moved = expand({ 'Ghost Fixture': { dx: 500, dy: 500 } });
  const key = (pts) => pts.map((p) => `${Math.round(p.cx * 100)},${Math.round(p.cy * 100)}`).join('|');
  assert.equal(key(moved), key(plain));
});

// ─── schema + persistence ──────────────────────────────────────────────────

test('offsets validate, and junk is refused rather than repaired', () => {
  assert.doesNotThrow(() => validateOffsets(undefined, 'v'));
  assert.doesNotThrow(() => validateOffsets({ 'Bar A': { dx: 1, dy: -2.5 } }, 'v'));
  assert.throws(() => validateOffsets({ 'Bar A': { dx: 1 } }, 'v'), /finite numeric dx and dy/);
  assert.throws(() => validateOffsets({ 'Bar A': { dx: NaN, dy: 0 } }, 'v'), /finite numeric dx and dy/);
  assert.throws(() => validateOffsets({ 'Bar A': [1, 2] }, 'v'), /finite numeric dx and dy/);
  assert.throws(() => validateOffsets([{ dx: 1, dy: 1 }], 'v'), /must be an object keyed by fixture/);
});

test('moves survive the params round-trip, and a bad one is a hard stop', () => {
  const c = buildDefaultViews();
  findView(c, 'top_down').offsets = { 'Left Front Wall 1': { dx: 24, dy: -8 } };
  const round = createViewsContainer(toParams(c));
  assert.deepEqual(findView(round, 'top_down').offsets, { 'Left Front Wall 1': { dx: 24, dy: -8 } });

  const bad = toParams(c);
  bad.views[0].offsets = { 'Left Front Wall 1': { dx: 'left', dy: 0 } };
  assert.throws(() => createViewsContainer(bad), /finite numeric dx and dy/);
});

test('a view with no moves carries no offsets key at all', () => {
  // "Never moved" must stay distinguishable from "moved and moved back" — the
  // same stance as framing, and what makes "Reset moves" meaningful.
  const c = buildDefaultViews();
  assert.equal(findView(c, 'top_down').offsets, undefined);
  assert.equal('offsets' in toParams(c).views[0], false);
});

test('an empty offsets object round-trips to absent, not to {}', () => {
  const c = buildDefaultViews();
  findView(c, 'top_down').offsets = {};
  assert.equal('offsets' in toParams(c).views[0], false);
});

test('offsets never leak between views', () => {
  const c = buildDefaultViews();
  findView(c, 'top_down').offsets = { 'Left Front Wall 1': { dx: 5, dy: 5 } };
  assert.equal(findView(c, 'front').offsets, undefined);
  assert.equal(findView(c, 'te_sign').offsets, undefined);
});

test('a view carrying moves still passes full schema validation', () => {
  const c = buildDefaultViews();
  const v = findView(c, 'top_down');
  v.offsets = { 'Left Front Wall 1': { dx: 1, dy: 2 } };
  v.framing = { zoom: 2, panX: 0, panY: 0 };
  assert.doesNotThrow(() => validateViewDef(v));
});

test('a hand-authored view may ship offsets from scene YAML', () => {
  const c = createViewsContainer(undefined);
  assert.doesNotThrow(() => addView(c, {
    id: 'v', label: 'v',
    panels: [{ id: 'main', select: [{}], layout: 'spatial' }],
    offsets: { 'Bar A': { dx: 3, dy: 4 } },
  }));
  assert.deepEqual(findView(c, 'v').offsets, { 'Bar A': { dx: 3, dy: 4 } });
});
