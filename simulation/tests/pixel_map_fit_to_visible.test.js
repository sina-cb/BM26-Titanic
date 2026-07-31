/**
 * pixel_map_fit_to_visible.test.js — "fit to the area not under any menu"
 * (operator order 2026-07-30, report 20260725_54 addendum).
 *
 * Pure geometry: obstruction trimming and the zoom/pan solve. The DOM measuring
 * that feeds them is exercised live by `agent_tools/pixel_map_view_tuning_verify.cjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  intersectRect, unobstructedRect, fitFramingFor, panelTransform,
} from '../src/gui/pixel_map/pixel_map_pane_view.js';

const PANE = { x: 0, y: 0, w: 1000, h: 600 };
const ZOOM = { min: 0.3, max: 8 };

test('intersectRect: overlap, touching edges, and disjoint', () => {
  assert.deepEqual(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }),
    { x: 5, y: 5, w: 5, h: 5 });
  assert.equal(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), null,
    'edge-touching is not an overlap');
  assert.equal(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 5, h: 5 }), null);
});

test('a docked panel on the right trims the pane from the right only', () => {
  // The Lighting Controls panel: full-height, hugging the right edge.
  const free = unobstructedRect(PANE, [{ x: 700, y: 0, w: 300, h: 600 }]);
  assert.deepEqual(free, { x: 0, y: 0, w: 700, h: 600 });
});

test('a bottom chip strip trims from the bottom, a top banner from the top', () => {
  assert.deepEqual(unobstructedRect(PANE, [{ x: 0, y: 560, w: 1000, h: 40 }]),
    { x: 0, y: 0, w: 1000, h: 560 });
  assert.deepEqual(unobstructedRect(PANE, [{ x: 0, y: 0, w: 1000, h: 50 }]),
    { x: 0, y: 50, w: 1000, h: 550 });
});

test('several overlays compose, and the cheapest trim is chosen each time', () => {
  const free = unobstructedRect(PANE, [
    { x: 780, y: 0, w: 220, h: 600 },     // right panel
    { x: 0, y: 555, w: 1000, h: 45 },     // bottom strip
    { x: 300, y: 0, w: 400, h: 30 },      // centred top banner
  ]);
  assert.deepEqual(free, { x: 0, y: 30, w: 780, h: 525 });
  for (const ob of [{ x: 780, y: 0, w: 220, h: 600 }, { x: 0, y: 555, w: 1000, h: 45 }]) {
    assert.equal(intersectRect(free, ob), null, 'the free rect really is free');
  }
});

test('a centred overlay is escaped by the side that costs least area', () => {
  // Sitting slightly right of centre → trimming the right is cheaper.
  const free = unobstructedRect(PANE, [{ x: 600, y: 250, w: 100, h: 100 }]);
  assert.equal(intersectRect(free, { x: 600, y: 250, w: 100, h: 100 }), null);
  assert.deepEqual(free, { x: 0, y: 0, w: 600, h: 600 });
});

test('an overlay covering everything is IGNORED rather than collapsing the rect', () => {
  // A fit into a zero-size box would be worse than a fit that ignores one
  // overlay — so the pane rect survives intact.
  const free = unobstructedRect(PANE, [{ x: -10, y: -10, w: 2000, h: 2000 }]);
  assert.deepEqual(free, PANE);
});

test('no obstructions → the whole pane', () => {
  assert.deepEqual(unobstructedRect(PANE, []), PANE);
  assert.deepEqual(unobstructedRect(PANE, undefined), PANE);
});

// ── the fit solve ─────────────────────────────────────────────────────────

const DESIGN = { w: 900, h: 520 };
const onePanel = (box, rect = PANE) => [{ rect, design: DESIGN, box }];
/** Where a design point lands, in pane-local px, under a solved framing. */
const project = (p, framing, cx, cy) => {
  const xf = panelTransform(p.design, p.rect, framing.zoom, framing.pan);
  return { x: cx * xf.scale + xf.ox, y: cy * xf.scale + xf.oy };
};

test('the fitted content lands INSIDE the free rect, not under the overlay', () => {
  const obstruction = { x: 700, y: 0, w: 300, h: 600 };
  const free = unobstructedRect(PANE, [obstruction]);
  const box = { minX: 100, minY: 60, maxX: 500, maxY: 300 };
  const panels = onePanel(box);
  const f = fitFramingFor(panels, free, ZOOM);

  const tl = project(panels[0], f, box.minX, box.minY);
  const br = project(panels[0], f, box.maxX, box.maxY);
  assert.ok(tl.x >= free.x && tl.y >= free.y, 'top-left inside the free area');
  assert.ok(br.x <= free.x + free.w && br.y <= free.y + free.h, 'bottom-right inside');
  // …and specifically NOT under the panel that was trimmed away.
  assert.ok(br.x <= obstruction.x, 'nothing lands under the docked panel');
});

test('the fitted content is CENTRED in the free rect', () => {
  const free = unobstructedRect(PANE, [{ x: 700, y: 0, w: 300, h: 600 }]);
  const box = { minX: 100, minY: 60, maxX: 500, maxY: 300 };
  const panels = onePanel(box);
  const f = fitFramingFor(panels, free, ZOOM);
  const tl = project(panels[0], f, box.minX, box.minY);
  const br = project(panels[0], f, box.maxX, box.maxY);
  assert.ok(Math.abs((tl.x + br.x) / 2 - (free.x + free.w / 2)) < 1e-6);
  assert.ok(Math.abs((tl.y + br.y) / 2 - (free.y + free.h / 2)) < 1e-6);
});

test('a smaller free area yields a smaller zoom', () => {
  const box = { minX: 0, minY: 0, maxX: 900, maxY: 520 };
  const wide = fitFramingFor(onePanel(box), PANE, ZOOM);
  const narrow = fitFramingFor(onePanel(box), unobstructedRect(PANE, [{ x: 500, y: 0, w: 500, h: 600 }]), ZOOM);
  assert.ok(narrow.zoom < wide.zoom, `${narrow.zoom} should be under ${wide.zoom}`);
});

test('zoom stays inside the range, and says so when it was capped', () => {
  // A single dot would want infinite zoom.
  const tiny = fitFramingFor(onePanel({ minX: 449, minY: 259, maxX: 451, maxY: 261 }), PANE, ZOOM);
  assert.ok(tiny.zoom <= ZOOM.max && tiny.zoom >= ZOOM.min);
  assert.equal(tiny.clamped, true, 'capping must be reported, not hidden');
  // Content far larger than the pane cannot fit even at minimum zoom.
  const huge = fitFramingFor(onePanel({ minX: -90000, minY: -90000, maxX: 90000, maxY: 90000 }), PANE, ZOOM);
  assert.equal(huge.zoom, ZOOM.min);
  assert.equal(huge.clamped, true);
});

test('a two-panel pane fits BOTH panels, each scaling about its own centre', () => {
  // Side-by-side sub-rects: one similarity in screen space cannot do this, so
  // this pins that the solve handles the per-panel centres correctly.
  const left = { x: 0, y: 0, w: 496, h: 600 };
  const right = { x: 504, y: 0, w: 496, h: 600 };
  const box = { minX: 200, minY: 100, maxX: 700, maxY: 420 };
  const panels = [
    { rect: left, design: DESIGN, box },
    { rect: right, design: DESIGN, box },
  ];
  const free = unobstructedRect(PANE, [{ x: 850, y: 0, w: 150, h: 600 }]);
  const f = fitFramingFor(panels, free, ZOOM);
  for (const p of panels) {
    const tl = project(p, f, box.minX, box.minY);
    const br = project(p, f, box.maxX, box.maxY);
    assert.ok(tl.x >= free.x - 1e-6 && br.x <= free.x + free.w + 1e-6, 'panel fits horizontally');
    assert.ok(tl.y >= free.y - 1e-6 && br.y <= free.y + free.h + 1e-6, 'panel fits vertically');
  }
});

test('no content → a neutral framing rather than a divide-by-zero', () => {
  const f = fitFramingFor([], PANE, ZOOM);
  assert.deepEqual(f, { zoom: 1, pan: { x: 0, y: 0 }, clamped: false });
});
