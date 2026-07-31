/**
 * Operator ruling (Sina, 2026-07-24): the TE sign is DMX-TRANSPORTED but
 * classified as an LED fixture in the taxonomy. The titanic scene's sign is the
 * real TE Sign V3 pair (TeSignV3A40 + TeSignV3B34, group 'TE Sign'; report _14).
 * This locks:
 *   1. buildClusters derives kind: 'led' for the DMX-transported TeSignV3* halves,
 *      while their fixtureType stays TeSignV3A40 / TeSignV3B34.
 *   2. The default views keep membership to spec despite that reclassification:
 *      top_down = LED bars + strands (NO sign), strands = strands ALONE (NO sign),
 *      te_sign = the two sign halves. The excludes on top_down/strands are what
 *      stop the now-LED sign from leaking into those `{kind:'led'}` panels.
 * Wire/model bytes are untouched — that is covered by the exporter byte-parity
 * test; here we only assert the display/selector classification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildClusters } from '../src/gui/pixel_map/pixel_map_layout.js';
import { resolveView, findView } from '../src/gui/pixel_map/pixel_map_views.js';
import { buildDefaultViews, TE_SIGN_GROUPS } from '../src/gui/pixel_map/pixel_map_view_defaults.js';

function entry(type, fixIndex, name, fixtureType, group, wx, wy, wz) {
  return { type, fixIndex, fixKey: name, name, fixtureType, group, wx, wy, wz };
}

// A titanic-shaped batch: 1 bar, 1 vintage, 1 strand, the two TE Sign V3 halves.
function scene() {
  const list = [];
  list.push(...Array.from({ length: 4 }, (_, k) => entry('dmx', 0, 'Bar A', 'ShehdsBar', 'Bars', k, 0, 0)));
  list.push(...Array.from({ length: 3 }, (_, k) => entry('dmx', 1, 'Vint A', 'VintageLed', 'Vint', 10 + k, 1, 0)));
  list.push(...Array.from({ length: 5 }, (_, k) => entry('led', 2, 'Left_Hull', '', 'Hull', -5, 0, k)));
  // BOTH signs' halves, DMX-transported (type 'dmx'), real V3 fixtureTypes. The
  // operator added a second sign ('TE Sign 2') on 2026-07-29; the te_sign view
  // gives each its own panel (report 20260725_48 addendum 2), and the excludes
  // on top_down/strands must keep EVERY sign out.
  // One fixIndex PER HALF (buildClusters clusters on it) — resolve it outside
  // the Array.from callback, or every pixel becomes its own cluster.
  let fi = 3;
  TE_SIGN_GROUPS.forEach((g, s) => {
    const a = fi++, b = fi++;
    list.push(...Array.from({ length: 6 }, (_, k) => entry('dmx', a, `${g} V3 A`, 'TeSignV3A40', g, k + s * 40, 0, 20)));
    list.push(...Array.from({ length: 6 }, (_, k) => entry('dmx', b, `${g} V3 B`, 'TeSignV3B34', g, k + s * 40, 0, 20)));
  });
  return list;
}

test('buildClusters classifies the DMX-transported TE Sign V3 halves as kind:led', () => {
  const clusters = buildClusters(scene());
  const sign = clusters.filter((c) => c.fixtureType === 'TeSignV3A40' || c.fixtureType === 'TeSignV3B34');
  assert.equal(sign.length, 2 * TE_SIGN_GROUPS.length);
  assert.ok(sign.every((c) => c.kind === 'led'), 'TE sign halves are LED-class');
  // The real strand stays led; the bar/vintage stay dmx.
  assert.equal(clusters.find((c) => c.fixKey === 'Bar A').kind, 'dmx');
  assert.equal(clusters.find((c) => c.fixKey === 'Vint A').kind, 'dmx');
  assert.equal(clusters.find((c) => c.fixKey === 'Left_Hull').kind, 'led');
  // Total led clusters = 1 strand + two halves per sign.
  assert.equal(clusters.filter((c) => c.kind === 'led').length, 1 + 2 * TE_SIGN_GROUPS.length);
});

test('default views keep TE sign membership to spec after reclassification', () => {
  const clusters = buildClusters(scene());
  const list = scene();
  const c = buildDefaultViews();
  const resolveMembers = (viewId, panelId) => {
    const r = resolveView(findView(c, viewId), clusters, list);
    const panel = r.panels.find((p) => (p.def && p.def.id) === panelId);
    return (panel.clusters || []).map((cl) => cl.fixtureType);
  };

  // top_down "main" = ShehdsBar + LED strands, NO sign.
  const top = resolveMembers('top_down', 'main');
  assert.ok(top.includes('ShehdsBar'));
  assert.ok(top.includes('LedStrand'));
  assert.ok(!top.includes('TeSignV3A40') && !top.includes('TeSignV3B34'), 'sign excluded from top_down');

  // strands "main" = strands ALONE, NO sign.
  const strands = resolveMembers('strands', 'main');
  assert.deepEqual([...new Set(strands)], ['LedStrand'], 'strands are strands alone');

  // te_sign = ONE panel per sign, each holding that sign's two halves.
  const r = resolveView(findView(c, 'te_sign'), clusters, list);
  assert.equal(r.panels.length, TE_SIGN_GROUPS.length);
  for (const [i, panel] of r.panels.entries()) {
    assert.equal(panel.error, undefined);
    assert.deepEqual([...new Set(panel.clusters.map((cl) => cl.fixtureType))].sort(),
      ['TeSignV3A40', 'TeSignV3B34']);
    assert.equal(panel.clusters.length, 2);
    assert.deepEqual([...new Set(panel.clusters.map((cl) => cl.group))], [TE_SIGN_GROUPS[i]]);
  }
});
