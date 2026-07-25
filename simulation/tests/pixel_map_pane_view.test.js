import test from 'node:test';
import assert from 'node:assert/strict';

import {
  panelSubRects, panelTransform, bufColor,
} from '../src/gui/pixel_map/pixel_map_pane_view.js';

// Pins the pure geometry math of a multiview pane (design §2.1). The canvas
// drawing itself needs a real 2D context (verified via the capture tool); these
// helpers are the part that must stay numerically correct.

// ── panelSubRects ─────────────────────────────────────────────────────────

test('a single panel fills the whole box', () => {
  const r = panelSubRects([{ id: 'main' }], 800, 400);
  assert.deepEqual(r, [{ id: 'main', x: 0, y: 0, w: 800, h: 400 }]);
});

test('two panels split by weight, left→right', () => {
  const r = panelSubRects([{ id: 'main', weight: 3 }, { id: 'stacks', weight: 1 }], 800, 400, 0);
  assert.equal(r[0].w, 600);
  assert.equal(r[1].x, 600);
  assert.equal(r[1].w, 200);
  assert.equal(r[0].h, 400);
});

test('missing/zero weight defaults to 1', () => {
  const r = panelSubRects([{ id: 'a' }, { id: 'b', weight: 0 }], 400, 100, 0);
  assert.equal(r[0].w, 200);
  assert.equal(r[1].w, 200);
});

test('gap is subtracted from the inner width', () => {
  const r = panelSubRects([{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }], 408, 100, 8);
  assert.equal(r[0].w, 200);
  assert.equal(r[1].x, 208);
  assert.equal(r[1].w, 200);
});

test('empty panel list yields no rects', () => {
  assert.deepEqual(panelSubRects([], 100, 100), []);
});

// ── panelTransform ────────────────────────────────────────────────────────

test('letterboxes design into the sub-rect, aspect-preserving', () => {
  // 100×100 design into a 200×100 rect → scale 1, centered horizontally.
  const xf = panelTransform({ w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 100 });
  assert.equal(xf.scale, 1);
  assert.equal(xf.ox, 50);   // (200 - 100)/2
  assert.equal(xf.oy, 0);
  // A design-space point maps correctly.
  assert.equal(0 * xf.scale + xf.ox, 50);
  assert.equal(100 * xf.scale + xf.ox, 150);
});

test('zoom scales about the sub-rect center', () => {
  const rect = { x: 0, y: 0, w: 200, h: 200 };
  const xf1 = panelTransform({ w: 200, h: 200 }, rect, 1);
  const xf2 = panelTransform({ w: 200, h: 200 }, rect, 2);
  // Center of the design (100,100) sits at the rect center under both zooms.
  assert.equal(100 * xf1.scale + xf1.ox, 100);
  assert.equal(100 * xf2.scale + xf2.ox, 100);
  assert.equal(xf2.scale, 2);
});

test('pan offsets the mapping', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  const base = panelTransform({ w: 100, h: 100 }, rect, 1, { x: 0, y: 0 });
  const panned = panelTransform({ w: 100, h: 100 }, rect, 1, { x: 15, y: -5 });
  assert.equal(panned.ox - base.ox, 15);
  assert.equal(panned.oy - base.oy, -5);
});

// ── bufColor ──────────────────────────────────────────────────────────────

test('bufColor reads the RGB triple for a pixel index', () => {
  const buf = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  assert.deepEqual(bufColor(buf, 0), [
    Math.fround(0.1), Math.fround(0.2), Math.fround(0.3),
  ]);
  assert.deepEqual(bufColor(buf, 1), [
    Math.fround(0.4), Math.fround(0.5), Math.fround(0.6),
  ]);
});

test('bufColor returns null for out-of-range or missing buffer', () => {
  const buf = new Float32Array([0, 0, 0]);
  assert.equal(bufColor(buf, 1), null);
  assert.equal(bufColor(buf, -1), null);
  assert.equal(bufColor(null, 0), null);
});
