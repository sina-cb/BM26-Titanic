/**
 * ORPHANED GENERATED FIXTURES — detection, dependency enumeration, removal
 * (report 20260725_76; the class is diagnosed in 20260725_51).
 *
 * The synthetic scene below mirrors the operator's real ghost pattern exactly:
 * a generator group that was renamed and re-created, leaving 7
 * `Left Center Auditorium N` fixtures with `traceGenerated: true`, ZEROED
 * patches, a stale 2D Pixel Map selector and a move offset — and no trace that
 * owns them. Alongside it sit the three things detection must NOT touch: a
 * live generator group, a generator whose display name drifted from its group
 * name, and hand-placed fixtures that never claimed a generator at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVENANCE_GENERATOR, PROVENANCE_HAND_PLACED,
  fixtureProvenance, generatorGroupNames, isOrphanFixture, findOrphanFixtures,
  orphanGroupSummary, orphanCount, pixelMapReferences, groupSelectorReferences,
  enumerateOrphanDependents, formatDependentLines, buildOrphanDeleteConfirm,
  buildEnumerationRefusal, buildStaleOrphanRefusal, buildRemovalReport,
} from '../src/dmx/orphan_fixtures.js';
import { removeFixtureFromViews, validateViewDef } from '../src/gui/pixel_map/pixel_map_views.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const gen = (group, n, extra = {}) => ({
  name: `${group} ${n}`,
  group,
  traceGenerated: true,
  fixtureType: 'UkingPar',
  controllerIp: '', dmxUniverse: 0, dmxAddress: 0,
  controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0,
  ...extra,
});

function scene() {
  return {
    traces: [
      // A live generator whose name IS its group name.
      { name: 'Left Auditorium', groupName: 'Left Auditorium', generated: true },
      // A generator whose DISPLAY name drifted from its group name — it still
      // owns "Left Back Wall Generator". Keying on `name` would orphan a whole
      // live run.
      { name: 'Left Back Wall', groupName: 'Left Back Wall Generator', generated: true },
      // A trace with no explicit groupName falls back to its name.
      { name: 'Right Auditorium', generated: true },
    ],
    parLights: [
      gen('Left Auditorium', 1), gen('Left Auditorium', 2),
      gen('Left Back Wall Generator', 1),
      gen('Right Auditorium', 1),
      // ── the ghosts: generator-claimed, nothing owns them, patches zeroed ──
      gen('Left Center Auditorium', 1, { sectionId: 1, fixtureId: 1 }),
      gen('Left Center Auditorium', 2, { sectionId: 1, fixtureId: 2 }),
      gen('Left Center Auditorium', 3, { sectionId: 1, fixtureId: 3 }),
      // ── hand-placed: never claimed a generator, must never be flagged ──
      { name: 'TE Sign V3 A', group: 'TE Sign', traceGenerated: false },
      { name: 'Spot 1', group: 'Hand Placed' },
    ],
  };
}

const orphanNames = (s) => findOrphanFixtures(s).map((r) => r.name);

// ─── Provenance: only `true` is a claim ────────────────────────────────────

test('provenance: only the boolean true claims generator origin', () => {
  assert.equal(fixtureProvenance({ traceGenerated: true }), PROVENANCE_GENERATOR);
  assert.equal(fixtureProvenance({ traceGenerated: false }), PROVENANCE_HAND_PLACED);
  assert.equal(fixtureProvenance({}), PROVENANCE_HAND_PLACED);
  // Unknown provenance is NEVER upgraded to a claim — that guess would delete
  // hand-placed fixtures (codex P0).
  assert.equal(fixtureProvenance({ traceGenerated: 'true' }), PROVENANCE_HAND_PLACED);
  assert.equal(fixtureProvenance({ traceGenerated: 1 }), PROVENANCE_HAND_PLACED);
  assert.equal(fixtureProvenance({ traceGenerated: null }), PROVENANCE_HAND_PLACED);
});

test('provenance: a non-object config throws rather than guessing', () => {
  assert.throws(() => fixtureProvenance(null), /must be a plain object/);
  assert.throws(() => fixtureProvenance('x'), /must be a plain object/);
});

// ─── Owner set ─────────────────────────────────────────────────────────────

test('ownership is keyed on groupName, falling back to name', () => {
  const owners = generatorGroupNames(scene().traces);
  assert.deepEqual([...owners].sort(),
    ['Left Auditorium', 'Left Back Wall Generator', 'Right Auditorium']);
});

test('an unreadable generator list is refused, never scanned', () => {
  assert.throws(() => generatorGroupNames(undefined), /traces must be an array/);
  assert.throws(() => generatorGroupNames(null), /traces must be an array/);
  // A malformed entry would UNDER-count owners and turn live fixtures into
  // deletion candidates — the one mistake this module must never make.
  assert.throws(() => generatorGroupNames([{ name: 'ok' }, null]), /is not an object/);
  assert.throws(() => generatorGroupNames([{ count: 3 }]), /neither a groupName nor a name/);
});

// ─── The rule ──────────────────────────────────────────────────────────────

test('orphan = claims generator origin AND no live generator owns its group', () => {
  const owners = generatorGroupNames(scene().traces);
  assert.equal(isOrphanFixture(gen('Left Center Auditorium', 1), owners), true);
  assert.equal(isOrphanFixture(gen('Left Auditorium', 1), owners), false);
});

test('a generator whose NAME was renamed still owns its group (no false positive)', () => {
  const owners = generatorGroupNames(scene().traces);
  assert.equal(isOrphanFixture(gen('Left Back Wall Generator', 1), owners), false);
  // And the reverse: the trace's display name is not a group anybody lives in.
  assert.equal(isOrphanFixture(gen('Left Back Wall', 1), owners), true);
});

test('hand-placed fixtures are never orphans, however few generators exist', () => {
  const owners = generatorGroupNames([]);
  assert.equal(isOrphanFixture({ name: 'Spot 1', group: 'Hand Placed' }, owners), false);
  // TE Sign halves are generator OUTPUT but are deliberately stamped
  // traceGenerated:false, because no persistent generator survives them.
  assert.equal(isOrphanFixture({ name: 'TE Sign V3 A', group: 'TE Sign', traceGenerated: false },
    owners), false);
});

test('a generator-claiming fixture with NO group is an orphan (no group ⇒ no owner)', () => {
  const owners = generatorGroupNames(scene().traces);
  assert.equal(isOrphanFixture({ name: 'x', traceGenerated: true }, owners), true);
  assert.equal(isOrphanFixture({ name: 'x', group: '', traceGenerated: true }, owners), true);
});

test('isOrphanFixture demands a real owner Set (no accidental empty scan)', () => {
  assert.throws(() => isOrphanFixture(gen('X', 1), ['X']), /must be a Set/);
  assert.throws(() => isOrphanFixture(gen('X', 1), undefined), /must be a Set/);
});

// ─── Census over a scene ───────────────────────────────────────────────────

test('the census finds exactly the ghosts in the real ghost pattern', () => {
  assert.deepEqual(orphanNames(scene()), [
    'Left Center Auditorium 1', 'Left Center Auditorium 2', 'Left Center Auditorium 3',
  ]);
  assert.equal(orphanCount(scene()), 3);
});

test('the census reports live parLights indices and configs by identity', () => {
  const s = scene();
  const rows = findOrphanFixtures(s);
  assert.deepEqual(rows.map((r) => r.index), [4, 5, 6]);
  assert.equal(rows[0].config, s.parLights[4]);
});

test('a nameless orphan is surfaced with name:null, never invented', () => {
  const s = scene();
  s.parLights.push({ group: 'Ghost Group', traceGenerated: true });
  const row = findOrphanFixtures(s).find((r) => r.group === 'Ghost Group');
  assert.equal(row.name, null);
});

test('deleting the last generator turns its whole group into orphans', () => {
  const s = scene();
  s.traces = s.traces.filter((t) => (t.groupName || t.name) !== 'Left Auditorium');
  assert.ok(orphanNames(s).includes('Left Auditorium 1'));
  assert.ok(orphanNames(s).includes('Left Auditorium 2'));
});

test('an empty generator list orphans every generated fixture — but only those', () => {
  const s = scene();
  s.traces = [];
  const found = orphanNames(s);
  assert.equal(found.length, 7);
  assert.ok(!found.includes('Spot 1'));
  assert.ok(!found.includes('TE Sign V3 A'));
});

// ─── Per-group roll-up ─────────────────────────────────────────────────────

test('group summary marks an ALL-orphan group vs a MIXED one', () => {
  const s = scene();
  // Make "Left Auditorium" mixed: drop nothing, just add one orphan into it by
  // deleting its generator would orphan all — instead park a ghost in the
  // hand-placed group so it is mixed with a non-generated member.
  s.parLights.push(gen('Hand Placed', 9));
  const summary = orphanGroupSummary(s);
  const lca = summary.find((g) => g.group === 'Left Center Auditorium');
  assert.equal(lca.orphanCount, 3);
  assert.equal(lca.memberCount, 3);
  assert.equal(lca.allOrphans, true);

  const mixed = summary.find((g) => g.group === 'Hand Placed');
  assert.equal(mixed.orphanCount, 1);
  assert.equal(mixed.memberCount, 2);
  assert.equal(mixed.allOrphans, false);
});

test('group summary lists no groups when the scene is clean', () => {
  const s = scene();
  s.parLights = s.parLights.filter((c) => c.group !== 'Left Center Auditorium');
  assert.deepEqual(orphanGroupSummary(s), []);
});

// ─── 2D Pixel Map references ───────────────────────────────────────────────

function views() {
  return {
    version: 1,
    views: [
      {
        id: 'top_down',
        label: 'Top Down',
        panels: [
          {
            id: 'main',
            layout: 'spatial',
            select: [{ group: 'Left Auditorium' }, { name: 'Left Center Auditorium 1' }],
            exclude: [{ group: 'Left Center Auditorium' }],
          },
        ],
        offsets: { 'Left Center Auditorium 1': { dx: 3, dy: -2 } },
        placements: { 'Left Center Auditorium 2': { x: 10, y: 20 } },
      },
    ],
  };
}

/** …plus a panel whose ONLY selector names a ghost — the refusal case. */
function viewsWithSoloPanel() {
  const v = views();
  v.views.push({
    id: 'solo',
    label: 'Solo',
    panels: [
      { id: 'only', layout: 'spatial', select: [{ name: 'Left Center Auditorium 3' }] },
    ],
  });
  return v;
}

test('pixel-map references enumerate name selectors, offsets and placements', () => {
  const v = views();
  const refs = pixelMapReferences(v, 'Left Center Auditorium 1');
  assert.equal(refs.selectors.length, 1);
  assert.deepEqual(refs.selectors[0],
    { view: 'top_down', panel: 'main', where: 'select', index: 1, lastInSelect: false });
  assert.deepEqual(refs.offsets, ['top_down']);
  assert.deepEqual(refs.placements, []);
  assert.deepEqual(pixelMapReferences(v, 'Left Center Auditorium 2').placements, ['top_down']);
});

test('a fixture that is a panel\'s ONLY selector is flagged lastInSelect', () => {
  const refs = pixelMapReferences(viewsWithSoloPanel(), 'Left Center Auditorium 3');
  assert.equal(refs.selectors[0].lastInSelect, true);
});

test('group selectors are enumerated (for the zero-match warning), never rewritten', () => {
  const rows = groupSelectorReferences(views(), 'Left Center Auditorium');
  assert.deepEqual(rows, [{ view: 'top_down', panel: 'main', where: 'exclude', index: 0 }]);
});

test('removeFixtureFromViews drops selectors, offsets and placements', () => {
  const v = views();
  const removed = removeFixtureFromViews(v, 'Left Center Auditorium 1');
  assert.equal(removed.selectors.length, 1);
  assert.deepEqual(removed.offsets, ['top_down']);
  assert.deepEqual(v.views[0].panels[0].select, [{ group: 'Left Auditorium' }]);
  assert.equal(v.views[0].offsets['Left Center Auditorium 1'], undefined);
  // The tree it leaves behind must still be schema-valid.
  validateViewDef(v.views[0]);
});

test('removeFixtureFromViews REFUSES to empty a panel\'s select', () => {
  const v = viewsWithSoloPanel();
  assert.throws(() => removeFixtureFromViews(v, 'Left Center Auditorium 3'),
    /ONLY selector of panel 'only'/);
  // …and it left that panel untouched.
  assert.deepEqual(v.views[1].panels[0].select, [{ name: 'Left Center Auditorium 3' }]);
});

// ─── Dependency enumeration ────────────────────────────────────────────────

function sources(s, overrides = {}) {
  const names = findOrphanFixtures(s).map((r) => r.name).filter(Boolean);
  return {
    allRecords: [...s.parLights, ...(s.ledStrands || [])],
    patchTree: {
      'Left Center Auditorium 1': {
        controllerIp: '', dmxUniverse: 0, dmxAddress: 0, sectionId: 1, fixtureId: 1, viewMask: 0,
      },
    },
    chainRows: [],
    pixelMapViews: views(),
    pixelCounts: new Map(names.map((n) => [n, 30])),
    ...overrides,
  };
}

const ghostRows = (s) => findOrphanFixtures(s)
  .filter((r) => r.group === 'Left Center Auditorium');

test('enumeration itemises patch, patch tree, pixel map, group and model pixels', () => {
  const s = scene();
  // Give the first ghost a WORD-1 membership so the enumeration proves it
  // reports the high word with a real value, not just a zero default.
  s.parLights.find((f) => f.name === 'Left Center Auditorium 1').viewMaskHi = 0x800;
  const rows = ghostRows(s);
  const e = enumerateOrphanDependents(rows, sources(s));
  assert.equal(e.blockers.length, 0);
  assert.equal(e.rows.length, 3);

  const first = e.rows[0];
  assert.equal(first.name, 'Left Center Auditorium 1');
  assert.equal(first.patch.live, false, 'the real ghosts carry ZEROED patches');
  assert.equal(first.patch.sectionId, 1);
  // BOTH view words ride the enumeration (views-bulletproofing sweep _141):
  // new custom views land in word 1, so a delete confirmation that read only
  // `viewMask` under-reported a fixture-clicked membership as 0.
  assert.equal(first.patch.viewMaskHi, 0x800);
  assert.equal(typeof first.patchTreeEntry.viewMaskHi, 'number');
  assert.notEqual(first.patchTreeEntry, null);
  assert.equal(first.pixelMap.selectors.length, 1);
  assert.deepEqual(first.pixelMap.offsets, ['top_down']);
  assert.equal(first.engineModel.pixels, 30);
  assert.equal(first.engineModel.present, true);
  assert.equal(first.group_.memberCount, 3);
  assert.equal(first.group_.removedFromGroup, 3);
  assert.equal(first.group_.emptiesGroup, true);

  assert.equal(e.totals.fixtures, 3);
  assert.equal(e.totals.zeroedPatches, 3);
  assert.equal(e.totals.livePatches, 0);
  assert.equal(e.totals.patchTreeEntries, 1);
  assert.equal(e.totals.modelPixels, 90);
  assert.equal(e.totals.emptiedGroups.length, 1);
  assert.equal(e.totals.emptiedGroups[0].group, 'Left Center Auditorium');
  assert.equal(e.totals.emptiedGroups[0].selectors.length, 1,
    'the {group: …} exclude selector goes zero-match and must be reported');
});

test('enumeration reports a LIVE controller mapping fixture by fixture', () => {
  const s = scene();
  s.parLights[4].dmxUniverse = 90;
  s.parLights[4].dmxAddress = 11;
  s.parLights[4].controllerIp = '10.x.x.1';
  const e = enumerateOrphanDependents(ghostRows(s), sources(s, {
    chainRows: [{
      fixture: 'Left Center Auditorium 1', controllerName: 'ZZ Probe DMX',
      controllerIp: '10.x.x.1', port: 1, universe: 90, address: 11,
    }],
  }));
  assert.equal(e.totals.mapped, 1);
  assert.equal(e.totals.livePatches, 1);
  assert.equal(e.rows[0].chains.length, 1);
  const text = formatDependentLines(e).join('\n');
  assert.match(text, /controller mapping: ZZ Probe DMX/);
  assert.match(text, /U90 · addr 11/);
  assert.match(text, /will be UNMAPPED/);
});

test('a mixed group reports partial removal and does NOT claim the group disappears', () => {
  const s = scene();
  s.parLights.push(gen('Hand Placed', 9));
  const rows = findOrphanFixtures(s).filter((r) => r.group === 'Hand Placed');
  const e = enumerateOrphanDependents(rows, sources(s));
  assert.equal(e.rows[0].group_.memberCount, 2);
  assert.equal(e.rows[0].group_.removedFromGroup, 1);
  assert.equal(e.rows[0].group_.emptiesGroup, false);
  assert.equal(e.totals.emptiedGroups.length, 0);
});

// ─── Refusals: enumeration must never proceed blind ────────────────────────

test('enumeration refuses when the runtime pixel counts are not available', () => {
  const s = scene();
  assert.throws(() => enumerateOrphanDependents(ghostRows(s), sources(s, { pixelCounts: null })),
    /pixelCounts must be a Map/);
});

test('enumeration refuses when the patch tree or chain rows cannot be read', () => {
  const s = scene();
  assert.throws(() => enumerateOrphanDependents(ghostRows(s), sources(s, { patchTree: null })),
    /patchTree must be the/);
  assert.throws(() => enumerateOrphanDependents(ghostRows(s), sources(s, { chainRows: null })),
    /chainRows must be an array/);
  assert.throws(() => enumerateOrphanDependents(ghostRows(s), sources(s, { allRecords: null })),
    /allRecords must be an array/);
});

test('a fixture missing from pixelCounts becomes a BLOCKER, not a guess', () => {
  const s = scene();
  const src = sources(s);
  src.pixelCounts.delete('Left Center Auditorium 2');
  const e = enumerateOrphanDependents(ghostRows(s), src);
  assert.equal(e.blockers.length, 1);
  assert.match(e.blockers[0], /no bound runtime fixture/);
});

test('a nameless orphan blocks the delete — every dependent store is name-keyed', () => {
  const s = scene();
  s.parLights.push({ group: 'Ghost Group', traceGenerated: true });
  const rows = findOrphanFixtures(s).filter((r) => r.group === 'Ghost Group');
  const e = enumerateOrphanDependents(rows, sources(s));
  assert.equal(e.rows.length, 0);
  assert.equal(e.blockers.length, 1);
  assert.match(e.blockers[0], /has NO name/);
});

test('being a panel\'s only selector blocks the delete before anything mutates', () => {
  const s = scene();
  const e = enumerateOrphanDependents(ghostRows(s),
    sources(s, { pixelMapViews: viewsWithSoloPanel() }));
  assert.equal(e.blockers.length, 1);
  assert.match(e.blockers[0], /ONLY selector of 2D Pixel Map panel 'only'/);
});

test('enumeration refuses an empty row list outright', () => {
  assert.throws(() => enumerateOrphanDependents([], sources(scene())), /non-empty row list/);
});

// ─── Operator-facing text ──────────────────────────────────────────────────

test('the confirm body enumerates dependents BEFORE it asks anything', () => {
  const s = scene();
  const e = enumerateOrphanDependents(ghostRows(s), sources(s));
  const body = buildOrphanDeleteConfirm({ scopeLabel: 'the whole group', enumeration: e });
  assert.match(body, /Remove 3 ORPHANED fixture\(s\)/);
  assert.match(body, /Left Center Auditorium 1/);
  assert.match(body, /Left Center Auditorium 3/);
  assert.match(body, /90 exported model pixel/);
  assert.match(body, /Nothing is written to disk until YOU save/);
  assert.match(body, /RE-EXPORT the engine model/);
  // The question comes last, after the evidence.
  assert.ok(body.trim().endsWith('Remove them?'));
  assert.ok(body.indexOf('Left Center Auditorium 1') < body.indexOf('Remove them?'));
});

test('the removal report names every fixture and ends with the re-export reminder', () => {
  const s = scene();
  const e = enumerateOrphanDependents(ghostRows(s), sources(s));
  const lines = buildRemovalReport({ scopeLabel: 'the whole group', enumeration: e });
  assert.match(lines[0], /Removed 3 ORPHANED fixture\(s\)/);
  assert.match(lines.join('\n'), /Left Center Auditorium 2/);
  assert.match(lines[lines.length - 1], /RE-EXPORT the engine model, then SAVE/);
});

test('the enumeration refusal says nothing was changed and lists why', () => {
  const msg = buildEnumerationRefusal('the single fixture "X"', ['reason one', 'reason two']);
  assert.match(msg, /Refusing to remove/);
  assert.match(msg, /reason one/);
  assert.match(msg, /reason two/);
  assert.match(msg, /Nothing was changed\./);
});

test('the stale refusal names the fixtures a generator has re-claimed', () => {
  const msg = buildStaleOrphanRefusal(['Left Center Auditorium 1']);
  assert.match(msg, /Nothing was removed/);
  assert.match(msg, /NO LONGER orphaned/);
  assert.match(msg, /Left Center Auditorium 1/);
});

// ─── LED and DMX are both fixtures (operator, 2026-07-30) ──────────────────
// One rule, one badge, one delete flow. The bus is REPORTED, never a branch.

/** The same ghost pattern, but the ghosts are LED strands. */
function ledScene() {
  const s = scene();
  s.ledStrands = [
    { name: 'Ghost Strand 1', group: 'Ghost Strands', traceGenerated: true, ledCount: 60 },
    { name: 'Ghost Strand 2', group: 'Ghost Strands', traceGenerated: true, ledCount: 60 },
    // A normal hand-placed strand — never a claim, never flagged.
    { name: 'Bow Rail', group: 'Bow', ledCount: 120 },
  ];
  return s;
}

test('an orphaned LED strand is detected by the SAME rule, tagged bus:led', () => {
  const rows = findOrphanFixtures(ledScene());
  const led = rows.filter((r) => r.bus === 'led');
  assert.deepEqual(led.map((r) => r.name), ['Ghost Strand 1', 'Ghost Strand 2']);
  assert.equal(rows.filter((r) => r.bus === 'dmx').length, 3, 'the PAR ghosts are still found');
  // …and a hand-placed strand is untouched, exactly like a hand-placed PAR.
  assert.ok(!rows.some((r) => r.name === 'Bow Rail'));
});

test('each orphan row carries the array it lives in, so the delete splices the right one', () => {
  const s = ledScene();
  const rows = findOrphanFixtures(s);
  assert.equal(rows.find((r) => r.bus === 'dmx').records, s.parLights);
  assert.equal(rows.find((r) => r.bus === 'led').records, s.ledStrands);
});

test('group membership is counted ACROSS buses (one group namespace)', () => {
  const s = ledScene();
  // Park a DMX ghost in the strand group: the group is then all-orphan across
  // both buses, and neither bus alone could tell.
  s.parLights.push(gen('Ghost Strands', 9));
  const g = orphanGroupSummary(s).find((x) => x.group === 'Ghost Strands');
  assert.equal(g.orphanCount, 3);
  assert.equal(g.memberCount, 3);
  assert.equal(g.allOrphans, true);

  // And a LIVE strand in the same group makes it mixed, not all-orphan.
  s.ledStrands.push({ name: 'Live Strand', group: 'Ghost Strands', ledCount: 30 });
  const g2 = orphanGroupSummary(s).find((x) => x.group === 'Ghost Strands');
  assert.equal(g2.memberCount, 4);
  assert.equal(g2.allOrphans, false);
});

test('a malformed ledStrands list is refused, not half-scanned', () => {
  const s = scene();
  s.ledStrands = 'nope';
  assert.throws(() => findOrphanFixtures(s), /ledStrands must be an array/);
});

test('a scene with no ledStrands key behaves exactly as before', () => {
  const s = scene();
  delete s.ledStrands;
  assert.equal(orphanCount(s), 3);
});

test('enumeration treats an orphaned strand identically and reports its bus', () => {
  const s = ledScene();
  const rows = findOrphanFixtures(s).filter((r) => r.bus === 'led');
  const e = enumerateOrphanDependents(rows, {
    allRecords: [...s.parLights, ...s.ledStrands],
    patchTree: {},
    chainRows: [],
    pixelMapViews: views(),
    pixelCounts: new Map([['Ghost Strand 1', 60], ['Ghost Strand 2', 60]]),
  });
  assert.equal(e.blockers.length, 0);
  assert.equal(e.totals.fixtures, 2);
  assert.equal(e.totals.modelPixels, 120);
  assert.equal(e.rows[0].bus, 'led');
  assert.equal(e.rows[0].fixtureType, 'LED strand');
  assert.equal(e.rows[0].group_.emptiesGroup, true);
  assert.match(formatDependentLines(e).join('\n'), /"Ghost Strand 1" \(LED · LED strand/);
});

test('a mixed-bus removal enumerates both kinds in one confirm', () => {
  const s = ledScene();
  const rows = findOrphanFixtures(s);
  const e = enumerateOrphanDependents(rows, {
    allRecords: [...s.parLights, ...s.ledStrands],
    patchTree: {},
    chainRows: [],
    pixelMapViews: views(),
    pixelCounts: new Map(rows.map((r) => [r.name, r.bus === 'led' ? 60 : 30])),
  });
  const body = buildOrphanDeleteConfirm({ scopeLabel: 'everything orphaned', enumeration: e });
  assert.match(body, /Left Center Auditorium 1/);
  assert.match(body, /Ghost Strand 1/);
  assert.match(body, /DMX ·/);
  assert.match(body, /LED ·/);
  assert.equal(e.totals.modelPixels, 3 * 30 + 2 * 60);
});
