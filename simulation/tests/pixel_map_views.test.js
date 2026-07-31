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
  SMALL_SMOKESTACK_GROUPS, FRONT_BAR_GROUPS, FRONT_VINTAGE_GROUPS,
  FRONT_STRAND_GROUPS, ORPHAN_GROUPS, TE_SIGN_GROUPS,
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
  // The two chimney par rings, named off the module rather than spelled out:
  // these group names are the operator's to rename (he already renamed the
  // right one), and this synthetic rig only has to mirror whatever the shipped
  // defaults currently select.
  for (const g of CHIMNEY_GROUPS) {
    for (let i = 1; i <= 10; i++) out.push(cluster('UkingPar', 'dmx', g, `${g} ${i}`, 1));
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

// ─── A cluster set with the REAL titanic group vocabulary ──────────────────
// The generic rig above is deliberately abstract ('Bars', 'Vintage', …), but the
// shipped defaults select the operator's ACTUAL group names, so the default-view
// tests need a rig that speaks them. Built from the exported constants, never
// from spelled-out literals, so a re-point after a rename moves the fixtures
// with the selectors instead of orphaning the test. Census mirrors the live
// scene: 25 ShehdsBar, 16 VintageLed, 47 UkingPar, 8 LED strands, the sign pair.
// Back-of-ship groups, as the operator named them (his 2026-07-29 rename batch,
// plus the 2026-07-30 'Left Back Wall Generator' → 'Left Back Wall' rename that
// followed his ghost-fixture delete). These are only DECOYS for the membership
// assertions (the Front view must not pick them up); nothing here is a selector
// under test, so if they go stale the tests still mean what they say — they just
// stop mirroring the scene.
const BACK_BAR_GROUPS = ['Left Back Wall', 'Right Back Wall'];
const BACK_VINTAGE_GROUPS = ['Left Back Rails', 'Right Back Rails'];
const AUDITORIUM_GROUPS = ['Left Auditorium', 'Right Auditorium'];
const ALL_STRAND_GROUPS = [
  'Left_Front_Left', 'Left_Back_Left', 'Left_Back_Right', 'Left_Front_Right',
  'Right_Back_Left', 'Right_Back_Right', 'Right_Front_Right', 'Right_Front_Left',
];

function defaultsClusters() {
  _fi = 0;
  const out = [];
  const many = (n, type, kind, group, pix) => {
    for (let i = 1; i <= n; i++) out.push(cluster(type, kind, group, `${group} ${i}`, pix));
  };
  for (const g of [...FRONT_BAR_GROUPS, ...BACK_BAR_GROUPS]) many(5, 'ShehdsBar', 'dmx', g, 18);
  for (const g of [...FRONT_VINTAGE_GROUPS, ...BACK_VINTAGE_GROUPS]) many(4, 'VintageLed', 'dmx', g, 6);
  for (const g of CHIMNEY_GROUPS) many(8, 'UkingPar', 'dmx', g, 1);
  for (const g of SMALL_SMOKESTACK_GROUPS) many(4, 'UkingPar', 'dmx', g, 1);
  for (const g of AUDITORIUM_GROUPS) many(8, 'UkingPar', 'dmx', g, 1);
  // The remaining ghosts: coordinates duplicate a real group's, no generator
  // trace. The 5 ghost bars were deleted by the operator on 2026-07-30, so this
  // is now the 7 'Left Center Auditorium' pars alone.
  for (const g of ORPHAN_GROUPS) many(7, 'UkingPar', 'dmx', g, 1);
  // LED-class by the 2026-07-24 ruling — kind 'led' here (unlike the generic
  // rig) precisely so the top_down/strands fixtureType excludes have to work.
  // BOTH signs: the operator added 'TE Sign 2' on 2026-07-29, which is what
  // broke the single-panel te_sign view (report 20260725_48 addendum 2).
  for (const g of TE_SIGN_GROUPS) {
    out.push(cluster('TeSignV3A40', 'led', g, `${g} V3 A`, 40));
    out.push(cluster('TeSignV3B34', 'led', g, `${g} V3 B`, 34));
  }
  for (const g of ALL_STRAND_GROUPS) out.push(cluster('LedStrand', 'led', g, g, 40));
  return out;
}

const DCL = defaultsClusters();

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
  // Off the constant, never a literal: the operator renames these groups often
  // (three times so far), and a spelled-out name turns this into a silent
  // no-match the moment he does — the very failure mode under test elsewhere.
  const p = onePanel(selView('v', [{ group: CHIMNEY_GROUPS[0] }]));
  assert.equal(p.clusters.length, 10);
  assert.ok(p.clusters.every((c) => c.group === CHIMNEY_GROUPS[0]));
});

// Globs onto the two chimney rings, derived from whatever they are CURRENTLY
// called ('Left …' / 'Right …'). Spelling the names out here meant that the
// operator's 'Right Top Chimney Generator' → 'Right SmokeStacks' rename turned
// a glob test into a silent no-match — the same failure mode as the default
// view losing his right ring (report 20260725_44 §3.6).
const CHIMNEY_GLOBS = CHIMNEY_GROUPS.map((g) => ({ group: `${g.split(' ')[0]} *` }));

test('group selector: glob matches both chimney rings', () => {
  const p = onePanel(selView('v', CHIMNEY_GLOBS));
  assert.equal(p.clusters.length, 20);
  // …and matches ONLY them — a glob that over-matches is as wrong as one that
  // misses (the strand groups are 'Left_Front' etc, no space, so they are out).
  assert.deepEqual(
    [...new Set(p.clusters.map((c) => c.group))].sort(),
    [...CHIMNEY_GROUPS].sort(),
  );
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
    { fixtureType: 'UkingPar', group: CHIMNEY_GROUPS[0] },
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
    exclude: CHIMNEY_GLOBS,
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

test('default top_down: ONE spatial panel = bars + strands + rings + small stacks', () => {
  const c = buildDefaultViews();
  const view = findView(c, 'top_down');
  // The chimney pars ride the same spatial projection as the rest of the rig, so
  // each ring renders at the centre of the cluster it crowns — no side panel.
  assert.deepEqual(view.panels.map((p) => p.id), ['main']);
  const r = resolveView(view, DCL, null);
  const main = r.panels.find((p) => p.def.id === 'main');
  assert.equal(main.def.layout, 'spatial');
  assert.equal(main.def.projection, 'top');
  assert.equal(main.error, undefined);
  // 20 bars (no ghost bars left to drop) + 8 strands + 8+8 chimney + 4+4 stacks
  assert.equal(main.clusters.length, 20 + 8 + 16 + 8);
  // The de-orphaned real back wall is DRAWN, not excluded (2026-07-30).
  assert.equal(main.clusters.filter((c2) => c2.group === BACK_BAR_GROUPS[0]).length, 5,
    'the real (de-orphaned) Left Back Wall must appear on Top-Down');
  // Both rings represented (the shipped two-group default, not one 8-par ring).
  const chimney = main.clusters.filter((c2) => CHIMNEY_GROUPS.includes(c2.group));
  assert.equal(chimney.length, 16);
  assert.deepEqual([...new Set(chimney.map((c2) => c2.group))].sort(),
    [...CHIMNEY_GROUPS].sort());
  // The operator's third Top-Down order: BOTH small smoke stacks are on the view.
  for (const g of SMALL_SMOKESTACK_GROUPS) {
    assert.equal(main.clusters.filter((c2) => c2.group === g).length, 4,
      `small smoke stack '${g}' must contribute its 4 pars to the Top-Down view`);
  }
  // The auditorium pars must NOT be dragged in by the group selectors.
  assert.equal(main.clusters.filter((c2) => AUDITORIUM_GROUPS.includes(c2.group)).length, 0);
  // Neither the TE sign (LED-class) nor the 12 orphan duplicates pollute it.
  assert.equal(main.clusters.filter((c2) => c2.group === 'TE Sign').length, 0);
  assert.equal(main.clusters.filter((c2) => ORPHAN_GROUPS.includes(c2.group)).length, 0);
  // Per-view glyph styles: a readable par ring, and thin strand lines that leave
  // the rings room (operator, report 20260725_48).
  assert.equal(main.styles.UkingPar.sizeX, 13);
  assert.equal(main.styles.LedStrand.sizeX, 5);
  // Distinct bar boxes with visible gaps (operator, 2026-07-30) — trimmed from
  // the shipped 17, still square so a diagonal bar reads the same.
  assert.equal(main.styles.ShehdsBar.sizeX, 14);
  assert.equal(main.styles.ShehdsBar.sizeY, 14);
  // …and the operator-ordered side-gap compression is declared on the panel.
  assert.deepEqual(main.def.compress, { minWorldGap: 5, gapWorld: 4 });
});

test('default front: one panel per side, front lights + TWO ropes each', () => {
  const c = buildDefaultViews();
  const view = findView(c, 'front');
  assert.deepEqual(view.panels.map((p) => p.id), ['left', 'right']);
  const r = resolveView(view, DCL, null);
  for (const [i, panel] of r.panels.entries()) {
    assert.equal(panel.error, undefined);
    assert.equal(panel.def.layout, 'spatial');
    assert.equal(panel.def.projection, 'front');
    // 5 bars + 4 vintage + exactly 2 smoke-stack ropes on this side.
    assert.equal(panel.clusters.length, 11);
    assert.equal(panel.clusters.filter((c2) => c2.group === FRONT_BAR_GROUPS[i]).length, 5);
    assert.equal(panel.clusters.filter((c2) => c2.group === FRONT_VINTAGE_GROUPS[i]).length, 4);
    const strands = panel.clusters.filter((c2) => c2.kind === 'led');
    assert.equal(strands.length, 2, 'exactly two LED ropes per side (operator spec)');
    assert.deepEqual(strands.map((c2) => c2.group).sort(),
      [...FRONT_STRAND_GROUPS[i]].sort());
  }
  // Nothing from the BACK of the ship, and no orphans, on either panel.
  const all = r.panels.flatMap((p) => p.clusters);
  assert.equal(all.length, 22);
  assert.equal(all.filter((c2) => c2.kind === 'led').length, 4,
    'four smoke-stack ropes in total across the two panels');
  for (const g of ['Left_Back_Left', 'Left_Back_Right', 'Right_Back_Left', 'Right_Back_Right']) {
    assert.equal(all.filter((c2) => c2.group === g).length, 0,
      `'${g}' is a BACK rope and must not appear on the Front view`);
  }
  for (const g of [...BACK_BAR_GROUPS, ...BACK_VINTAGE_GROUPS, ...ORPHAN_GROUPS]) {
    assert.equal(all.filter((c2) => c2.group === g).length, 0,
      `'${g}' is not a front fixture and must not appear on the Front view`);
  }
});

test('default strands resolves to the 8 LED strands, sign excluded', () => {
  const c = buildDefaultViews();
  const p = onePanel(findView(c, 'strands'), DCL);
  assert.equal(p.clusters.length, 8);
  assert.ok(p.clusters.every((c2) => c2.fixtureType === 'LedStrand'));
});

test('default te_sign: ONE planar panel per sign, each rotated 90° CCW', () => {
  // `planar` scales by true world CELL size and never fits to the canvas, so two
  // signs 34 world units apart in ONE panel render mostly off-screen. A panel per
  // sign keeps each logo at honest scale while its interlocking A/B halves stay
  // in a shared frame (report 20260725_48 addendum 2).
  const c = buildDefaultViews();
  const r = resolveView(findView(c, 'te_sign'), DCL, null);
  assert.equal(r.panels.length, TE_SIGN_GROUPS.length);
  for (const [i, p] of r.panels.entries()) {
    assert.equal(p.error, undefined);
    assert.equal(p.def.layout, 'planar');
    // The operator's third order (report 20260725_48). 90 = counter-clockwise.
    assert.equal(p.def.rotate, 90);
    assert.equal(p.clusters.length, 2); // TeSignV3A40 + TeSignV3B34
    assert.deepEqual([...new Set(p.clusters.map((x) => x.group))], [TE_SIGN_GROUPS[i]],
      'each panel holds exactly ONE sign — never both');
  }
});

test('a second sign cannot leak into top_down or strands', () => {
  // Those two exclude by fixtureType, so they were right about sign 2 from day
  // one — unlike te_sign, which selected by type and swallowed both.
  const c = buildDefaultViews();
  for (const id of ['top_down', 'strands']) {
    const p = onePanel(findView(c, id), DCL);
    assert.equal(p.clusters.filter((x) => TE_SIGN_GROUPS.includes(x.group)).length, 0,
      `view '${id}' must exclude every TE sign`);
  }
});

test('panel `rotate` is validated: quarter turns, projected layouts only', () => {
  const rot = (extra) => validateViewDef(selView('v', [{}], extra));
  for (const deg of [0, 90, 180, 270]) assert.doesNotThrow(() => rot({ rotate: deg }));
  assert.throws(() => rot({ rotate: 45 }), /rotate must be one of/);
  assert.throws(() => rot({ rotate: '90' }), /rotate must be one of/);
  assert.throws(() => rot({ rotate: 90, layout: 'lanes' }), /only meaningful on a TRUE projection/);
  assert.throws(() => rot({ rotate: 90, layout: 'radial' }), /only meaningful on a TRUE projection/);
  assert.doesNotThrow(() => rot({ rotate: 180, layout: 'planar' }));
});

test('panel `compress` is validated: spatial only, and a real compression', () => {
  const v = (extra) => validateViewDef(selView('v', [{}], extra));
  assert.doesNotThrow(() => v({ compress: { minWorldGap: 5, gapWorld: 4 } }));
  assert.doesNotThrow(() => v({ compress: { minWorldGap: 5, gapWorld: 0 } }));
  // gapWorld must be SMALLER than the threshold, or a "collapsed" band comes
  // out wider than the gap that qualified it.
  assert.throws(() => v({ compress: { minWorldGap: 4, gapWorld: 4 } }), /must be SMALLER/);
  assert.throws(() => v({ compress: { minWorldGap: 4, gapWorld: 9 } }), /must be SMALLER/);
  assert.throws(() => v({ compress: { minWorldGap: -1, gapWorld: 0 } }), /non-negative finite/);
  assert.throws(() => v({ compress: { minWorldGap: 5 } }), /non-negative finite/);
  assert.throws(() => v({ compress: 5 }), /must be an object/);
  // Only a TRUE world-axis projection can be compressed meaningfully.
  assert.throws(() => v({ compress: { minWorldGap: 5, gapWorld: 4 }, layout: 'lanes' }),
    /needs a 'spatial' layout/);
  assert.throws(() => v({ compress: { minWorldGap: 5, gapWorld: 4 }, layout: 'planar' }),
    /needs a 'spatial' layout/);
});

test('panel `expandPitch` is validated: spatial only, positive world pitches', () => {
  const v = (extra) => validateViewDef(selView('v', [{}], extra));
  assert.doesNotThrow(() => v({ expandPitch: { VintageLed: 0.6 } }));
  assert.doesNotThrow(() => v({ expandPitch: {} }));
  assert.throws(() => v({ expandPitch: { VintageLed: 0 } }), /positive number of WORLD units/);
  assert.throws(() => v({ expandPitch: { VintageLed: -1 } }), /positive number of WORLD units/);
  assert.throws(() => v({ expandPitch: { VintageLed: '0.6' } }), /positive number of WORLD units/);
  assert.throws(() => v({ expandPitch: [0.6] }), /must be an object/);
  assert.throws(() => v({ expandPitch: { VintageLed: 0.6 }, layout: 'radial' }),
    /needs a 'spatial' layout/);
});

test('`compress` and `expandPitch` survive the persistence round-trip', () => {
  const c = createViewsContainer(undefined);
  addView(c, selView('v', [{}], {
    compress: { minWorldGap: 5, gapWorld: 4 },
    expandPitch: { VintageLed: 0.6 },
  }));
  const round = createViewsContainer(toParams(c));
  const panel = findView(round, 'v').panels[0];
  assert.deepEqual(panel.compress, { minWorldGap: 5, gapWorld: 4 });
  assert.deepEqual(panel.expandPitch, { VintageLed: 0.6 });
});

test('panel `rotate` survives the persistence round-trip', () => {
  const c = createViewsContainer(undefined);
  addView(c, selView('v', [{}], { rotate: 270 }));
  const round = createViewsContainer(toParams(c));
  assert.equal(findView(round, 'v').panels[0].rotate, 270);
});
