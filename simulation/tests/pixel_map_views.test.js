/**
 * pixel_map_views.test.js — S2 view-model unit tests (design 20260724_9 §6).
 *
 * Covers: selector resolution against a realistic titanic-like cluster set
 * (kind / fixtureType / group-glob / name-glob / view-via-registry, union +
 * exclude + match-all), the add/remove/duplicate lifecycle, fail-loud schema
 * validation, zero-match → loud renderable per-panel error, the four shipped
 * defaults, persistence round-trip, and legacy pixelMap2d migration.
 *
 * Pure logic — no DOM, no canvas, no three. Clusters are hand-built to the §5
 * contract shape { fixIndex, fixKey, fixtureType, kind, group, pixels }.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createViewsContainer, addView, addBlankView, removeView, duplicateView,
  findView, resolveView, validateViewDef, toParams, migrateLegacyPixelMap2d,
  VIEWS_SCHEMA_VERSION,
} from '../src/gui/pixel_map/pixel_map_views.js';
import {
  DEFAULT_VIEWS, buildDefaultViews, seedDefaultViews, CHIMNEY_GROUPS,
} from '../src/gui/pixel_map/pixel_map_view_defaults.js';
import { createViewRegistry } from '../src/dmx/view_registry.js';

// ─── A realistic titanic-like cluster set ──────────────────────────────────
let _fi = 0;
function cluster(fixtureType, kind, group, fixKey, nPix = 4) {
  const fixIndex = _fi++;
  return {
    fixIndex,
    fixKey,
    fixtureType,
    kind,
    group,
    pixels: Array.from({ length: nPix }, (_, k) => ({ gi: fixIndex * 100 + k })),
  };
}

// 24 ShehdsBar, 20 VintageLed, 38 UkingPar (10+10 chimney + 18 deck),
// TE Sign V3 pair (TeSignV3A40 + TeSignV3B34), 16 LED strands (8 large
// "Left_/Right_*", 8 small "Small_*").
function titanicClusters() {
  _fi = 0;
  const out = [];
  for (let i = 1; i <= 24; i++) out.push(cluster('ShehdsBar', 'dmx', 'Bars', `Bar ${i}`, 60));
  for (let i = 1; i <= 20; i++) out.push(cluster('VintageLed', 'dmx', 'Vintage', `Vintage ${i}`, 1));
  for (let i = 1; i <= 10; i++) {
    out.push(cluster('UkingPar', 'dmx', 'Left Top Chimney Generator', `Left Top Chimney Generator ${i}`, 1));
  }
  for (let i = 1; i <= 10; i++) {
    out.push(cluster('UkingPar', 'dmx', 'Right Top Chimney Generator', `Right Top Chimney Generator ${i}`, 1));
  }
  for (let i = 1; i <= 18; i++) out.push(cluster('UkingPar', 'dmx', 'Deck Pars', `Deck Par ${i}`, 1));
  // The real TE Sign V3 pair (LED-class, DMX transport). Kept kind:'dmx' here so
  // the strand-only kind assertions below stay about strands; the led-class
  // ruling on the sign is proven separately in pixel_map_te_led_classification.
  out.push(cluster('TeSignV3A40', 'dmx', 'TE Sign', 'TE Sign A', 200));
  out.push(cluster('TeSignV3B34', 'dmx', 'TE Sign', 'TE Sign B', 200));
  for (const side of ['Left', 'Right']) {
    for (const seg of ['Front', 'Mid', 'Rear', 'Tail']) {
      out.push(cluster('LedStrand', 'led', `${side}_${seg}`, `${side}_${seg}`, 40));
    }
  }
  for (let i = 1; i <= 8; i++) out.push(cluster('LedStrand', 'led', `Small_${i}`, `Small_${i}`, 20));
  return out;
}

const CL = titanicClusters();
const TOTAL = CL.length; // 24+20+38+2+16 = 100

// A view_registry with a base group + a custom "Stacks" view over both chimneys.
function stubRegistry() {
  return createViewRegistry({
    groupBits: { Bars: 0x1, Vintage: 0x2, 'Deck Pars': 0x4 },
    custom: [
      { name: 'Stacks', bit: 0x8, groups: CHIMNEY_GROUPS },
      { name: 'Empty View', bit: 0x10, groups: [] },
    ],
  });
}

// Resolve one single-panel view and return that panel.
function onePanel(view, clusters = CL, ctx = {}) {
  return resolveView(view, clusters, null, ctx).panels[0];
}
function selView(id, select, extra = {}) {
  return { id, label: id, panels: [{ id: 'main', select, layout: 'spatial', ...extra }] };
}

// ─── Selector resolution ────────────────────────────────────────────────────

test('sanity: the titanic-like set has the expected census', () => {
  assert.equal(CL.length, 100);
  assert.equal(CL.filter((c) => c.fixtureType === 'ShehdsBar').length, 24);
  assert.equal(CL.filter((c) => c.fixtureType === 'VintageLed').length, 20);
  assert.equal(CL.filter((c) => c.fixtureType === 'UkingPar').length, 38);
  assert.equal(CL.filter((c) => c.fixtureType === 'TeSignV3A40' || c.fixtureType === 'TeSignV3B34').length, 2);
  assert.equal(CL.filter((c) => c.kind === 'led').length, 16);
});

test('kind selector: {kind: led} matches exactly the 16 strands', () => {
  const p = onePanel(selView('v', [{ kind: 'led' }]));
  assert.equal(p.error, undefined);
  assert.equal(p.clusters.length, 16);
  assert.ok(p.clusters.every((c) => c.kind === 'led'));
});

test('fixtureType selector is exact-match', () => {
  assert.equal(onePanel(selView('v', [{ fixtureType: 'ShehdsBar' }])).clusters.length, 24);
  assert.equal(onePanel(selView('v', [{ fixtureType: 'TeSignV3A40' }])).clusters.length, 1);
  assert.equal(onePanel(selView('v', [{ fixtureType: 'TeSignV3B34' }])).clusters.length, 1);
});

test('group selector: exact string', () => {
  const p = onePanel(selView('v', [{ group: 'Left Top Chimney Generator' }]));
  assert.equal(p.clusters.length, 10);
  assert.ok(p.clusters.every((c) => c.group === 'Left Top Chimney Generator'));
});

test('group selector: glob matches both chimney rings', () => {
  const p = onePanel(selView('v', [{ group: '* Top Chimney Generator' }]));
  assert.equal(p.clusters.length, 20);
});

test('name selector: glob on fixKey', () => {
  const p = onePanel(selView('v', [{ name: 'Small_*' }]));
  assert.equal(p.clusters.length, 8);
  const one = onePanel(selView('v', [{ name: 'Bar 1' }]));
  assert.equal(one.clusters.length, 1);
});

test('multiple keys in one selector are ANDed', () => {
  // UkingPar AND the left chimney group → 10; UkingPar AND kind led → 0.
  assert.equal(onePanel(selView('v', [
    { fixtureType: 'UkingPar', group: 'Left Top Chimney Generator' },
  ])).clusters.length, 10);
  assert.equal(onePanel(selView('v', [
    { fixtureType: 'UkingPar', kind: 'led' },
  ])).error !== undefined, true);
});

test('select array is a union (OR) across selectors', () => {
  const p = onePanel(selView('v', [
    { fixtureType: 'ShehdsBar' },
    { kind: 'led' },
  ]));
  assert.equal(p.clusters.length, 24 + 16);
});

test('empty selector {} matches every cluster', () => {
  assert.equal(onePanel(selView('v', [{}])).clusters.length, TOTAL);
});

test('exclude removes matched clusters', () => {
  // All UkingPar minus the two chimney rings = 18 deck pars.
  const p = onePanel(selView('v', [{ fixtureType: 'UkingPar' }], {
    exclude: [{ group: '* Top Chimney Generator' }],
  }));
  assert.equal(p.clusters.length, 18);
  assert.ok(p.clusters.every((c) => c.group === 'Deck Pars'));
});

test('view: selector resolves a base group via the registry', () => {
  const p = onePanel(selView('v', [{ view: 'Bars' }]), CL, { viewRegistry: stubRegistry() });
  assert.equal(p.clusters.length, 24);
});

test('view: selector resolves a custom view to its member groups', () => {
  const p = onePanel(selView('v', [{ view: 'Stacks' }]), CL, { viewRegistry: stubRegistry() });
  assert.equal(p.clusters.length, 20); // both chimney rings
});

test('view: selector with no registry in ctx throws (wiring bug, fail loud)', () => {
  assert.throws(() => onePanel(selView('v', [{ view: 'Bars' }])), /needs a view_registry/);
});

test('view: selector naming an unknown registry view → loud panel error, not a throw', () => {
  const p = onePanel(selView('v', [{ view: 'Nope' }]), CL, { viewRegistry: stubRegistry() });
  assert.equal(p.clusters.length, 0);
  assert.match(p.error, /unknown view.*'Nope'/);
});

// ─── Zero-match is loud + renderable, never a silent blank ─────────────────

test('zero-match selector yields an error string and empty clusters (codex P0)', () => {
  const p = onePanel(selView('v', [{ fixtureType: 'DoesNotExist' }]));
  assert.equal(p.clusters.length, 0);
  assert.match(p.error, /no fixtures match/);
});

test('a zero-match panel does NOT kill sibling panels in the same view', () => {
  const view = {
    id: 'mix', label: 'mix',
    panels: [
      { id: 'good', select: [{ kind: 'led' }], layout: 'spatial' },
      { id: 'bad', select: [{ fixtureType: 'Ghost' }], layout: 'radial' },
    ],
  };
  const r = resolveView(view, CL, null);
  assert.equal(r.panels[0].clusters.length, 16);
  assert.equal(r.panels[0].error, undefined);
  assert.match(r.panels[1].error, /no fixtures match/);
});

// ─── resolveView carries per-view placements (as a Map) + styles ───────────

test('resolveView returns per-view placements as a Map and shared styles', () => {
  const view = {
    id: 'v', label: 'v',
    panels: [{ id: 'main', select: [{ kind: 'led' }], layout: 'spatial' }],
    placements: { Left_Front: { x: 10, y: 20, rot: 90 } },
    typeStyles: { LedStrand: { sizeX: 5 } },
  };
  const p = resolveView(view, CL, null).panels[0];
  assert.ok(p.placements instanceof Map);
  assert.deepEqual(p.placements.get('Left_Front'), { x: 10, y: 20, rot: 90 });
  assert.deepEqual(p.styles, { LedStrand: { sizeX: 5 } });
});

// ─── Fail-loud schema validation ───────────────────────────────────────────

test('unknown selector key throws', () => {
  assert.throws(() => validateViewDef(selView('v', [{ colour: 'red' }])),
    /unknown selector key 'colour'/);
});

test('unknown layout throws', () => {
  assert.throws(() => validateViewDef({
    id: 'v', panels: [{ id: 'm', select: [{}], layout: 'spiral' }],
  }), /layout must be one of/);
});

test('unknown projection throws', () => {
  assert.throws(() => validateViewDef({
    id: 'v', panels: [{ id: 'm', select: [{}], layout: 'spatial', projection: 'oblique' }],
  }), /projection must be one of/);
});

test('bad kind value throws', () => {
  assert.throws(() => validateViewDef(selView('v', [{ kind: 'rgb' }])),
    /kind must be one of/);
});

test('empty select array throws', () => {
  assert.throws(() => validateViewDef({
    id: 'v', panels: [{ id: 'm', select: [], layout: 'spatial' }],
  }), /'select' must be a non-empty array/);
});

test('missing view id throws', () => {
  assert.throws(() => validateViewDef({ panels: [{ id: 'm', select: [{}], layout: 'spatial' }] }),
    /non-empty string id/);
});

test('no panels throws', () => {
  assert.throws(() => validateViewDef({ id: 'v', panels: [] }),
    /'panels' must be a non-empty array/);
});

test('duplicate panel id within a view throws', () => {
  assert.throws(() => validateViewDef({
    id: 'v', panels: [
      { id: 'm', select: [{}], layout: 'spatial' },
      { id: 'm', select: [{}], layout: 'radial' },
    ],
  }), /duplicate panel id 'm'/);
});

test('bad placement (missing numeric coords) throws', () => {
  assert.throws(() => validateViewDef({
    id: 'v', panels: [{ id: 'm', select: [{}], layout: 'spatial' }],
    placements: { Foo: { x: 1 } },
  }), /numeric x and y/);
});

test('non-string selector value throws', () => {
  assert.throws(() => validateViewDef(selView('v', [{ group: 5 }])),
    /must be a non-empty string/);
});

// ─── Container add / remove / duplicate lifecycle ──────────────────────────

test('createViewsContainer(undefined) is an empty v1 container', () => {
  const c = createViewsContainer(undefined);
  assert.equal(c.version, VIEWS_SCHEMA_VERSION);
  assert.deepEqual(c.views, []);
});

test('addView validates, normalizes, and rejects duplicate ids', () => {
  const c = createViewsContainer(undefined);
  addView(c, selView('a', [{ kind: 'led' }]));
  assert.equal(c.views.length, 1);
  // Normalized: placements/typeStyles always present.
  assert.deepEqual(c.views[0].placements, {});
  assert.deepEqual(c.views[0].typeStyles, {});
  assert.throws(() => addView(c, selView('a', [{ kind: 'dmx' }])), /already exists/);
});

test('addBlankView creates a one-panel match-all spatial view', () => {
  const c = createViewsContainer(undefined);
  addBlankView(c, { id: 'blank', label: 'Blank' });
  const v = findView(c, 'blank');
  assert.equal(v.panels.length, 1);
  assert.deepEqual(v.panels[0].select, [{}]);
  assert.equal(v.panels[0].layout, 'spatial');
});

test('removeView deletes by id and throws on unknown id', () => {
  const c = buildDefaultViews();
  const n = c.views.length;
  removeView(c, 'front');
  assert.equal(c.views.length, n - 1);
  assert.equal(findView(c, 'front'), null);
  assert.throws(() => removeView(c, 'front'), /cannot remove unknown view/);
});

test('duplicateView deep-clones under an auto-derived unique id', () => {
  const c = buildDefaultViews();
  const dup = duplicateView(c, 'top_down');
  assert.equal(dup.id, 'top_down_copy');
  assert.notEqual(dup, findView(c, 'top_down'));
  // Deep clone: editing the copy's placements must not touch the source.
  dup.placements['Bar 1'] = { x: 1, y: 2, rot: 0 };
  assert.equal(findView(c, 'top_down').placements['Bar 1'], undefined);
  // A second duplicate bumps the suffix.
  assert.equal(duplicateView(c, 'top_down').id, 'top_down_copy2');
});

test('duplicateView honors an explicit new id when free', () => {
  const c = buildDefaultViews();
  const dup = duplicateView(c, 'front', 'front_stage');
  assert.equal(dup.id, 'front_stage');
});

// ─── Persistence round-trip ────────────────────────────────────────────────

test('toParams → createViewsContainer round-trips the four defaults', () => {
  const c = buildDefaultViews();
  const params = toParams(c);
  assert.equal(params.version, VIEWS_SCHEMA_VERSION);
  const c2 = createViewsContainer(params);
  assert.deepEqual(c2, c);
});

test('createViewsContainer rejects a bad persisted tree (fail loud, no repair)', () => {
  assert.throws(() => createViewsContainer({
    version: 1, views: [{ id: 'x', panels: [{ id: 'm', select: [{ nope: 1 }], layout: 'spatial' }] }],
  }), /unknown selector key 'nope'/);
});

test('createViewsContainer rejects an unsupported version', () => {
  assert.throws(() => createViewsContainer({ version: 99, views: [] }),
    /unsupported pixelMapViews.version/);
});

test('createViewsContainer rejects duplicate view ids in the tree', () => {
  assert.throws(() => createViewsContainer({
    version: 1,
    views: [selView('dup', [{}]), selView('dup', [{}])],
  }), /already exists/);
});

// ─── Legacy pixelMap2d migration ───────────────────────────────────────────

test('migrateLegacyPixelMap2d builds an all_fixtures view preserving placements', () => {
  const c = createViewsContainer(undefined);
  const migrated = migrateLegacyPixelMap2d(c, {
    plane: 'top',
    fixtures: { 'Bar 1': { x: 5, y: 6, rot: 15 }, Left_Front: { x: 1, y: 2, rot: 0 } },
    types: { ShehdsBar: { sizeX: 10 } },
  });
  assert.equal(migrated, true);
  const v = findView(c, 'all_fixtures');
  assert.ok(v);
  assert.deepEqual(v.panels[0].select, [{}]);
  assert.equal(v.panels[0].projection, 'top');
  assert.deepEqual(v.placements['Bar 1'], { x: 5, y: 6, rot: 15 });
  assert.deepEqual(v.typeStyles, { ShehdsBar: { sizeX: 10 } });
  // Migrated view resolves cleanly against the real cluster set.
  assert.equal(onePanel(v).clusters.length, TOTAL);
});

test('migrateLegacyPixelMap2d is a no-op when the container already has views', () => {
  const c = buildDefaultViews();
  assert.equal(migrateLegacyPixelMap2d(c, { fixtures: { 'Bar 1': { x: 0, y: 0 } } }), false);
});

test('migrateLegacyPixelMap2d is a no-op when there is nothing to carry over', () => {
  const c = createViewsContainer(undefined);
  assert.equal(migrateLegacyPixelMap2d(c, undefined), false);
  assert.equal(migrateLegacyPixelMap2d(c, { plane: 'top' }), false);
  assert.equal(c.views.length, 0);
});

// ─── The four shipped defaults ─────────────────────────────────────────────

test('buildDefaultViews instantiates exactly the four expected views', () => {
  const c = buildDefaultViews();
  assert.deepEqual(c.views.map((v) => v.id), ['top_down', 'front', 'strands', 'te_sign']);
  assert.equal(DEFAULT_VIEWS.length, 4);
});

test('every default view passes schema validation', () => {
  for (const v of DEFAULT_VIEWS) assert.doesNotThrow(() => validateViewDef(v));
});

test('seedDefaultViews fills an empty container, no-ops a populated one', () => {
  const c = createViewsContainer(undefined);
  assert.equal(seedDefaultViews(c), true);
  assert.equal(c.views.length, 4);
  assert.equal(seedDefaultViews(c), false);
  assert.equal(c.views.length, 4);
});

test('default top_down: main panel = bars+strands, stacks panel = BOTH chimney rings', () => {
  const c = buildDefaultViews();
  const r = resolveView(findView(c, 'top_down'), CL, null);
  const main = r.panels.find((p) => p.def.id === 'main');
  const stacks = r.panels.find((p) => p.def.id === 'stacks');
  assert.equal(main.clusters.length, 24 + 16); // ShehdsBar + LED strands
  assert.equal(stacks.def.layout, 'radial');
  assert.equal(stacks.clusters.length, 20);    // 10 + 10 chimney pars
  assert.equal(stacks.error, undefined);
  // Both rings represented (the shipped two-group default, not one 8-par ring).
  const groups = new Set(stacks.clusters.map((c2) => c2.group));
  assert.deepEqual([...groups].sort(), [...CHIMNEY_GROUPS].sort());
});

test('default front resolves to bars + vintage', () => {
  const c = buildDefaultViews();
  assert.equal(onePanel(findView(c, 'front')).clusters.length, 24 + 20);
});

test('default strands resolves to the 16 LED strands', () => {
  const c = buildDefaultViews();
  assert.equal(onePanel(findView(c, 'strands')).clusters.length, 16);
});

test('default te_sign resolves to the TE Sign V3 pair, planar layout', () => {
  const c = buildDefaultViews();
  const p = onePanel(findView(c, 'te_sign'));
  assert.equal(p.clusters.length, 2); // TeSignV3A40 + TeSignV3B34
  assert.equal(p.def.layout, 'planar');
});
