/**
 * S4 integration seam: expandPanel stamps `fixKey` on every emitted pixel.
 *
 * The multiview pane renderer (pixel_map_pane_view) draws per-fixture selection
 * chrome from `pixel.fixKey`, and the EDIT-mode interaction resolves a click
 * back to a fixture via the nearest pixel's `fixKey`. Both need every expanded
 * pixel to carry its source cluster's fixKey — this locks that in for the
 * spatial/radial/lanes line-expansion path AND the planar (TE-grid) path.
 * Contract: design 20260724_9 §5 (expandPanel returns objects with `fixKey`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildClusters, seedPanel, expandPanel } from '../src/gui/pixel_map/pixel_map_layout.js';

const CANVAS = { w: 900, h: 520 };

function entry(type, fixIndex, name, fixtureType, group, wx, wy, wz) {
  return { type, fixIndex, fixKey: name, name, fixtureType, group, wx, wy, wz };
}

test('expandPanel stamps fixKey on every pixel (line expansion)', () => {
  const list = [
    ...Array.from({ length: 4 }, (_, k) => entry('dmx', 0, 'Bar A', 'ShehdsBar', 'Bars', k, 0, 0)),
    ...Array.from({ length: 3 }, (_, k) => entry('dmx', 1, 'Bar B', 'ShehdsBar', 'Bars', 20 + k, 0, 0)),
  ];
  const clusters = buildClusters(list);
  const def = { id: 'main', select: [{ fixtureType: 'ShehdsBar' }], layout: 'spatial', projection: 'top' };
  const placements = seedPanel(def, clusters, list, CANVAS.w, CANVAS.h, {});
  const pixels = expandPanel(def, clusters, list, placements, {});

  assert.equal(pixels.length, 7);
  assert.ok(pixels.every((p) => typeof p.fixKey === 'string' && p.fixKey.length));
  // fixKey count matches each cluster's pixel count.
  const a = pixels.filter((p) => p.fixKey === 'Bar A').length;
  const b = pixels.filter((p) => p.fixKey === 'Bar B').length;
  assert.equal(a, 4);
  assert.equal(b, 3);
});

test('expandPanel stamps fixKey on planar (TE-grid) pixels too', () => {
  // A tiny 3×2 grid in the x/z plane → planar expansion.
  const list = [];
  let k = 0;
  for (let z = 0; z < 2; z++) for (let x = 0; x < 3; x++) list.push(entry('dmx', 0, 'TE Sign', 'TeLedGrid40', 'Sign', x, 0, z, k++));
  const clusters = buildClusters(list);
  const def = { id: 'main', select: [{ fixtureType: 'TeLedGrid40' }], layout: 'planar' };
  const placements = seedPanel(def, clusters, list, CANVAS.w, CANVAS.h, {});
  const pixels = expandPanel(def, clusters, list, placements, {});

  assert.equal(pixels.length, 6);
  assert.ok(pixels.every((p) => p.fixKey === 'TE Sign'));
});
