/**
 * rename_invalidation.test.js — contract tests for the rename policy
 * (operator ruling 2026-07-29, plan report 20260725_44 steps 8-13).
 *
 * THE RULING, restated as assertions: a rename CHECKS the mapping and
 * INVALIDATES it, loudly. Never a silent carry-over to the new names, never a
 * lingering old-name phantom. Display state (view membership) does follow the
 * name; addresses never do.
 *
 * These tests assert the LOG CONTRACT as well as the state — the whole point
 * of the ruling is what the operator is told, so "it happened to end up
 * unmapped" (today's accidental behaviour) is not enough to pass.
 *
 * Pure logic: no DOM, no three.js, no browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry, addController,
  describeFixtureMappings, invalidateFixtureMappings, mappedFixtures,
  renameFixtureInChains,
} from '../src/dmx/controller_registry.js';
import {
  generatedFixtureNames, renamePairs, prunePatchTreeEntries, carryViewMasks,
  duplicateNameError, formatMappingLine, formatPatchLine, buildInvalidationReport,
  MAPPING_PATCH_FIELDS, DISPLAY_PATCH_FIELDS,
} from '../src/dmx/rename_invalidation.js';
import {
  createViewsContainer, renameGroupInViews, resolveView, resetPanelErrorWarnings,
} from '../src/gui/pixel_map/pixel_map_views.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

/** A registry with "Old Ring 1..3" mapped on one port and a stranger beside them. */
function mappedRegistry() {
  const r = createControllerRegistry(null);
  const c = addController(r, { name: 'Bow PKnight', ip: '10.1.1.10' });
  c.ports[0].universe = 2;
  c.ports[0].chain.push(
    { fixture: 'Old Ring 1', at: 1 },
    { fixture: 'Old Ring 2', at: 11 },
    { gap: 10, at: 21 },
    { fixture: 'Old Ring 3', at: 31 },
  );
  c.ports[1].universe = 3;
  c.ports[1].chain.push({ fixture: 'Untouched Par', at: 1 });
  return r;
}

function patchTreeFor(names, base = 1) {
  const tree = {};
  names.forEach((n, i) => {
    tree[n] = {
      controllerIp: '10.1.1.10', dmxUniverse: 2, dmxAddress: base + i * 10,
      controllerId: 1, sectionId: 4, fixtureId: 20 + i, viewMask: 0,
    };
  });
  return tree;
}

// ── Enumeration: the CHECK half ────────────────────────────────────────────

test('describeFixtureMappings enumerates exactly what the old names map, read-only', () => {
  const r = mappedRegistry();
  const before = JSON.stringify(r);
  const rows = describeFixtureMappings(r, generatedFixtureNames('Old Ring', 3));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((x) => x.fixture), ['Old Ring 1', 'Old Ring 2', 'Old Ring 3']);
  assert.deepEqual(rows.map((x) => x.address), [1, 11, 31]);
  assert.equal(rows[0].controllerName, 'Bow PKnight');
  assert.equal(rows[0].controllerIp, '10.1.1.10');
  assert.equal(rows[0].universe, 2);
  assert.equal(rows[0].port, 1);
  assert.equal(JSON.stringify(r), before, 'enumeration must not mutate the registry');
});

test('describeFixtureMappings ignores gaps and unrelated fixtures', () => {
  const r = mappedRegistry();
  assert.deepEqual(describeFixtureMappings(r, ['Nope']), []);
  const rows = describeFixtureMappings(r, ['Old Ring 2', 'Untouched Par']);
  assert.deepEqual(rows.map((x) => x.fixture), ['Old Ring 2', 'Untouched Par']);
  assert.deepEqual(rows.map((x) => x.universe), [2, 3]);
});

test('describeFixtureMappings walks in CABLE order, not caller order', () => {
  const r = mappedRegistry();
  const rows = describeFixtureMappings(r, ['Old Ring 3', 'Old Ring 1']);
  assert.deepEqual(rows.map((x) => x.fixture), ['Old Ring 1', 'Old Ring 3']);
});

test('describeFixtureMappings on an empty registry is empty, not a throw', () => {
  assert.deepEqual(describeFixtureMappings(createControllerRegistry(null), ['A']), []);
});

// ── Invalidation: the INVALIDATE half (the DEFAULT policy) ─────────────────

test('mapped group rename: EVERY old-name chain entry is removed', () => {
  const r = mappedRegistry();
  const rows = invalidateFixtureMappings(r, generatedFixtureNames('Old Ring', 3));
  assert.equal(rows.length, 3);
  const mapped = mappedFixtures(r);
  for (const n of generatedFixtureNames('Old Ring', 3)) {
    assert.equal(mapped.has(n), false, `${n} must be unmapped`);
  }
  assert.equal(mapped.has('Untouched Par'), true, 'other fixtures are untouched');
});

test('mapped group rename mints NO new-name chain entry (never a silent carry-over)', () => {
  const r = mappedRegistry();
  invalidateFixtureMappings(r, generatedFixtureNames('Old Ring', 3));
  const mapped = mappedFixtures(r);
  for (const n of generatedFixtureNames('New Ring', 3)) {
    assert.equal(mapped.has(n), false, `${n} must NOT appear — migration is opt-in only`);
  }
  assert.equal(mapped.size, 1);
});

test('invalidation preserves the addresses of the fixtures it did not touch', () => {
  const r = mappedRegistry();
  invalidateFixtureMappings(r, ['Old Ring 2']);
  const port = r.controllers[0].ports[0];
  assert.deepEqual(port.chain.map((e) => e.at), [1, 21, 31],
    'absolute addresses — removing an entry shifts nothing');
});

test('invalidating names that are not mapped is a clean no-op', () => {
  const r = mappedRegistry();
  const rows = invalidateFixtureMappings(r, ['Ghost 1', 'Ghost 2']);
  assert.deepEqual(rows, []);
  assert.equal(mappedFixtures(r).size, 4);
});

// ── Patch-tree phantoms ────────────────────────────────────────────────────

test('prunePatchTreeEntries deletes old-name keys and reports what vanished', () => {
  const names = generatedFixtureNames('Old Ring', 3);
  const tree = patchTreeFor(names);
  tree['Untouched Par'] = { controllerIp: '10.1.1.10', dmxUniverse: 3, dmxAddress: 1 };
  const rows = prunePatchTreeEntries(tree, names);
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(tree), ['Untouched Par'], 'no old-name phantom survives');
  assert.equal(rows[0].dmxAddress, 1);
  assert.equal(rows[2].dmxAddress, 21);
  assert.equal(rows[0].wasMapped, true);
});

test('prunePatchTreeEntries NEVER copies values to the new names', () => {
  const tree = patchTreeFor(['Old Ring 1']);
  prunePatchTreeEntries(tree, ['Old Ring 1']);
  assert.equal(Object.prototype.hasOwnProperty.call(tree, 'New Ring 1'), false);
  assert.deepEqual(Object.keys(tree), []);
});

test('prunePatchTreeEntries reports an unpatched record honestly', () => {
  const tree = { 'Par 9': { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, viewMask: 8 } };
  const [row] = prunePatchTreeEntries(tree, ['Par 9']);
  assert.equal(row.wasMapped, false);
  assert.equal(row.viewMask, 8);
});

test('prunePatchTreeEntries tolerates a missing tree and missing keys', () => {
  assert.deepEqual(prunePatchTreeEntries(null, ['A']), []);
  assert.deepEqual(prunePatchTreeEntries({}, ['A']), []);
});

test('mapping vs display field split is explicit', () => {
  assert.deepEqual(MAPPING_PATCH_FIELDS,
    ['controllerIp', 'dmxUniverse', 'dmxAddress', 'controllerId', 'sectionId', 'fixtureId']);
  assert.deepEqual(DISPLAY_PATCH_FIELDS, ['viewMask']);
  for (const f of DISPLAY_PATCH_FIELDS) {
    assert.equal(MAPPING_PATCH_FIELDS.includes(f), false, `${f} cannot be both`);
  }
});

// ── Display state DOES follow the rename ───────────────────────────────────

test('carryViewMasks moves view membership onto the new names', () => {
  const pairs = renamePairs('Old Ring', 'New Ring', 3);
  const masks = new Map([['Old Ring 1', 4], ['Old Ring 3', 16]]);
  const configs = new Map(pairs.map((p) => [p.to, { name: p.to, viewMask: 0 }]));
  const carried = carryViewMasks(masks, configs, pairs);
  assert.deepEqual(carried.map((c) => c.to), ['New Ring 1', 'New Ring 3']);
  assert.equal(configs.get('New Ring 1').viewMask, 4);
  assert.equal(configs.get('New Ring 2').viewMask, 0);
  assert.equal(configs.get('New Ring 3').viewMask, 16);
});

test('carryViewMasks skips zero masks and missing configs (no invented state)', () => {
  const pairs = renamePairs('A', 'B', 2);
  const carried = carryViewMasks({ 'A 1': 0, 'A 2': 2 }, new Map(), pairs);
  assert.deepEqual(carried, []);
});

// ── Name-set contract ──────────────────────────────────────────────────────

test('generatedFixtureNames follows the "<group> N" contract, 1-based', () => {
  assert.deepEqual(generatedFixtureNames('Ring', 3), ['Ring 1', 'Ring 2', 'Ring 3']);
  assert.deepEqual(generatedFixtureNames('Ring', 0), []);
});

test('generatedFixtureNames FAILS LOUD on a bad group or count', () => {
  assert.throws(() => generatedFixtureNames('', 3), /non-empty string/);
  assert.throws(() => generatedFixtureNames('Ring', -1), /integer >= 0/);
  assert.throws(() => generatedFixtureNames('Ring', 2.5), /integer >= 0/);
  assert.throws(() => generatedFixtureNames('Ring', undefined), /integer >= 0/);
});

test('renamePairs maps chain number N to chain number N', () => {
  assert.deepEqual(renamePairs('Old', 'New', 2),
    [{ from: 'Old 1', to: 'New 1' }, { from: 'Old 2', to: 'New 2' }]);
});

// ── Duplicate guard ────────────────────────────────────────────────────────

test('duplicateNameError refuses a taken name and an empty name', () => {
  assert.match(duplicateNameError('Par 2', ['Par 1', 'Par 2']), /already exists/);
  assert.match(duplicateNameError('   ', ['Par 1']), /cannot be empty/);
  assert.equal(duplicateNameError('Par 3', ['Par 1', 'Par 2']), null);
});

test('duplicateNameError compares the TRIMMED name (whitespace is not a new name)', () => {
  assert.match(duplicateNameError('  Par 1  ', ['Par 1']), /already exists/);
});

test('duplicateNameError explains the consequence, not just the refusal', () => {
  const msg = duplicateNameError('Par 1', ['Par 1']);
  assert.match(msg, /single patch record/);
  assert.match(msg, /scene load/);
});

// ── The LOG CONTRACT — what the operator actually sees ─────────────────────

test('every freed chain entry gets a line naming controller, IP, port, universe, address', () => {
  const line = formatMappingLine({
    fixture: 'Old Ring 1', controllerName: 'Bow PKnight', controllerIp: '10.1.1.10',
    port: 1, universe: 2, address: 11,
  });
  assert.match(line, /"Old Ring 1"/);
  assert.match(line, /INVALIDATED/);
  assert.match(line, /Bow PKnight/);
  assert.match(line, /10\.1\.1\.10/);
  assert.match(line, /Port 1/);
  assert.match(line, /U2/);
  assert.match(line, /addr 11/);
  assert.match(line, /UNMAPPED/);
});

test('a pruned patch-tree phantom says so, with its old address', () => {
  const [row] = prunePatchTreeEntries(patchTreeFor(['Old Ring 1']), ['Old Ring 1']);
  const line = formatPatchLine(row);
  assert.match(line, /"Old Ring 1"/);
  assert.match(line, /U2:1/);
  assert.match(line, /phantom/);
});

test('the group report is one line per fixture plus a header and a re-map instruction', () => {
  const r = mappedRegistry();
  const names = generatedFixtureNames('Old Ring', 3);
  const chainRows = invalidateFixtureMappings(r, names);
  const patchRows = prunePatchTreeEntries(patchTreeFor(names), names);
  const report = buildInvalidationReport({
    oldLabel: 'Old Ring', newLabel: 'New Ring', scope: 'group', chainRows, patchRows,
  });
  assert.equal(report.invalidatedCount, 3);
  assert.equal(report.prunedCount, 3);
  // header + 3 chain lines + 3 patch lines + footer
  assert.equal(report.lines.length, 8);
  assert.match(report.lines[0], /Generator group rename "Old Ring" → "New Ring"/);
  assert.match(report.lines[0], /CHECK \+ INVALIDATE/);
  assert.match(report.lines[0], /nothing was carried to the new name/);
  for (const n of names) {
    assert.ok(report.lines.some((l) => l.includes(`"${n}"`)), `${n} must appear by name`);
  }
  assert.match(report.lines.at(-1), /Re-map these 3 fixture\(s\) deliberately/);
  assert.match(report.lines.at(-1), /NOT migrated/);
});

test('the toast summary is accurate — never "channels freed", never "deleted"', () => {
  const r = mappedRegistry();
  const chainRows = invalidateFixtureMappings(r, generatedFixtureNames('Old Ring', 3));
  const { summary } = buildInvalidationReport({
    oldLabel: 'Old Ring', newLabel: 'New Ring', scope: 'group', chainRows,
  });
  assert.match(summary, /invalidated the mapping of 3 fixture\(s\)/);
  assert.match(summary, /UNMAPPED/);
  assert.match(summary, /Controllers panel/);
  assert.doesNotMatch(summary, /channels freed/);
  assert.doesNotMatch(summary, /deleted/);
});

test('an UNMAPPED rename still reports — silence is not an option', () => {
  const report = buildInvalidationReport({ oldLabel: 'A', newLabel: 'B', scope: 'fixture' });
  assert.equal(report.invalidatedCount, 0);
  assert.equal(report.lines.length, 1);
  assert.match(report.lines[0], /checked the mapping/);
  assert.match(report.lines[0], /nothing was mapped/);
  assert.match(report.summary, /nothing was mapped under the old name/);
});

test('a rename that only pruned phantoms says exactly that', () => {
  const patchRows = prunePatchTreeEntries(patchTreeFor(['A']), ['A']);
  const { summary, lines } = buildInvalidationReport({
    oldLabel: 'A', newLabel: 'B', patchRows,
  });
  assert.match(summary, /1 stale patch entr\(ies\) pruned/);
  assert.match(lines[0], /no mapping to invalidate/);
});

test('view-membership carries are reported as DISPLAY state, not mapping', () => {
  const { lines } = buildInvalidationReport({
    oldLabel: 'A', newLabel: 'B',
    carriedViewMasks: [{ from: 'A 1', to: 'B 1', viewMask: 4 }],
  });
  const line = lines.find((l) => l.includes('view membership'));
  assert.ok(line);
  assert.match(line, /display state, not mapping/);
});

// ── The opt-in migrate escape hatch stays UNWIRED (gate §5 Q4) ─────────────

test('renameFixtureInChains still exists and still migrates — but is opt-in only', () => {
  const r = mappedRegistry();
  assert.equal(renameFixtureInChains(r, 'Old Ring 1', 'New Ring 1'), true);
  const mapped = mappedFixtures(r);
  assert.equal(mapped.has('New Ring 1'), true);
  const entry = r.controllers[0].ports[0].chain[0];
  assert.equal(entry.at, 1, 'a migrate keeps the address byte-identical');
});

test('the DEFAULT path never calls the migrate primitive', () => {
  // Proven by state: invalidate leaves nothing under the new names, whereas
  // a migrate would leave every one of them mapped at the same address.
  const r = mappedRegistry();
  invalidateFixtureMappings(r, generatedFixtureNames('Old Ring', 3));
  const mapped = mappedFixtures(r);
  assert.equal([...mapped.keys()].some((n) => n.startsWith('New Ring')), false);
});

// ── 2D Pixel Map selector migration (step 12) ──────────────────────────────

function viewsWithGroup(group) {
  return createViewsContainer({
    version: 1,
    views: [{
      id: 'top_down',
      label: 'Top-Down',
      panels: [{
        id: 'main',
        select: [{ fixtureType: 'ShehdsBar' }, { group }],
        exclude: [{ group: 'Backstage' }],
        layout: 'spatial',
        projection: 'top',
      }],
    }],
  });
}

test('renameGroupInViews re-points exact group selectors in select AND exclude', () => {
  const c = viewsWithGroup('Right Top Chimney Generator');
  const changed = renameGroupInViews(c, 'Right Top Chimney Generator', 'Right SmokeStacks');
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0], { view: 'top_down', panel: 'main', where: 'select', index: 1 });
  assert.equal(c.views[0].panels[0].select[1].group, 'Right SmokeStacks');

  const changed2 = renameGroupInViews(c, 'Backstage', 'Back Stage');
  assert.deepEqual(changed2[0], { view: 'top_down', panel: 'main', where: 'exclude', index: 0 });
  assert.equal(c.views[0].panels[0].exclude[0].group, 'Back Stage');
});

test('renameGroupInViews leaves GLOBS alone (operator intent, not a reference)', () => {
  const c = viewsWithGroup('Chimney *');
  assert.deepEqual(renameGroupInViews(c, 'Chimney A', 'Stacks A'), []);
  assert.equal(c.views[0].panels[0].select[1].group, 'Chimney *');
});

test('renameGroupInViews is a no-op on an identical name and fails loud on empty', () => {
  const c = viewsWithGroup('Ring');
  assert.deepEqual(renameGroupInViews(c, 'Ring', 'Ring'), []);
  assert.throws(() => renameGroupInViews(c, '', 'Ring'), /non-empty oldName/);
  assert.throws(() => renameGroupInViews(c, 'Ring', ''), /non-empty newName/);
  assert.deepEqual(renameGroupInViews(null, 'Ring', 'Hoop'), []);
});

test('a selector matching zero clusters is a LOUD error, never a silent empty pane', () => {
  resetPanelErrorWarnings();
  const warned = [];
  const orig = console.warn;
  console.warn = (msg) => warned.push(String(msg));
  try {
    const c = viewsWithGroup('Ghost Group');
    const clusters = [{ fixKey: 'f0', fixtureType: 'VintageLed', kind: 'dmx', group: 'Other' }];
    const resolved = resolveView(c.views[0], clusters, null);
    assert.match(resolved.panels[0].error, /no fixtures match its selectors/);
    assert.deepEqual(resolved.panels[0].clusters, []);
    assert.equal(warned.length, 1, 'and it says so in the console');
    assert.match(warned[0], /renamed or deleted group/);
    // Once per distinct reason — a rebuild storm must not spam the console.
    resolveView(c.views[0], clusters, null);
    assert.equal(warned.length, 1);
  } finally {
    console.warn = orig;
  }
});

test('re-pointing a selector at a live group makes the panel resolve again', () => {
  resetPanelErrorWarnings();
  const c = viewsWithGroup('Old Ring');
  const clusters = [{ fixKey: 'f0', fixtureType: 'UkingPar', kind: 'dmx', group: 'New Ring' }];
  assert.ok(resolveView(c.views[0], clusters, null).panels[0].error, 'broken before');
  renameGroupInViews(c, 'Old Ring', 'New Ring');
  const after = resolveView(c.views[0], clusters, null);
  assert.equal(after.panels[0].error, undefined);
  assert.equal(after.panels[0].clusters.length, 1);
});
