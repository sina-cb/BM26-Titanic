/**
 * controller_registry.test.js — schema, migration, projection, and
 * mutation contract tests for the Controller Mapping registry
 * (docs/33, allocation model — decision 19).
 *
 * Pure logic: synthetic fixture configs with definitions registered
 * explicitly up front (footprints are REAL, never guessed) and an
 * explicit pin table, no DOM, no three.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DMX_UNIVERSE_SIZE,
  createControllerRegistry,
  registryIsActive,
  mappedFixtures,
  derivedUniverses,
  nextFreeUniverse,
  noteUniverseUsed,
  addController,
  addPort,
  removeController,
  removePort,
  appendFixtures,
  unmapFixture,
  moveChainEntry,
  renameFixtureInChains,
  migrateLegacyChains,
  computeProjection,
  projectOntoConfigs,
  isValidIp,
} from '../src/dmx/controller_registry.js';

const PINS = {
  ChauvetHaze4D: { universe: 1, address: 510 },
  TEFogMachine: { universe: 1, address: 512 },
};

// Footprints come from the definition registry — register the
// synthetic test types up front, mirroring main.js's initRegistry.
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';
initRegistry({
  UkingPar: { fixture_type: 'UkingPar', channel_mode: 10 },
  ShehdsBar: { fixture_type: 'ShehdsBar', channel_mode: 119 },
});

const FP = 10;

function par(name, group = 'Pars') {
  return { name, group, fixtureType: 'UkingPar' };
}

function configMap(...configs) {
  return new Map(configs.map(c => [c.name, c]));
}

function reg(tree) {
  return createControllerRegistry(tree);
}

function fieldsOf(projection, name) {
  return projection.fields.get(name);
}

const UNPATCHED = { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 };

// ── Schema validation (createControllerRegistry throws) ────────────────

test('empty / missing tree yields an inactive registry', () => {
  const r = reg(null);
  assert.equal(registryIsActive(r), false);
  assert.equal(r.nextControllerId, 1);
});

test('duplicate fixture across chains throws at load', () => {
  assert.throws(() => reg({
    controllers: [
      { id: 1, name: 'A', ip: '10.0.0.1', ports: [
        { port: 1, universe: 2, chain: [{ fixture: 'Par 1', at: 1 }] },
        { port: 2, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }] },
      ] },
    ],
  }), /appears in two chains/);
});

test('invalid gap, universe, and ids throw at load', () => {
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 2, chain: [{ gap: 0 }] }] }] }), /gap width/);
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 2, chain: [{ gap: 5, at: 'x' }] }] }] }), /gap address/);
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 0, chain: [] }] }] }), /universe/);
  assert.throws(() => reg({ controllers: [{ id: 0, name: 'A', ip: '', ports: [] }] }), /invalid id/);
  assert.throws(() => reg({ controllers: [
    { id: 1, name: 'A', ip: '', ports: [] },
    { id: 1, name: 'B', ip: '', ports: [] },
  ] }), /Duplicate controller id/);
});

test('nextControllerId is preserved and never trails existing ids', () => {
  const r1 = reg({ nextControllerId: 9, controllers: [{ id: 1, name: 'A', ip: '', ports: [] }] });
  assert.equal(r1.nextControllerId, 9);
  const r2 = reg({ nextControllerId: 1, controllers: [{ id: 5, name: 'A', ip: '', ports: [] }] });
  assert.equal(r2.nextControllerId, 6);
});

test('at: 0 (unpinned WIP effect) LOADS and projects a loud no_pin / pin_mismatch', () => {
  // B1 regression (cold review 2026-06-12): the panel writes at: 0 when
  // config.yaml has no pin for the type. It must load, never brick boot.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [
      { fixture: 'Horn 1', at: 0 },  // type has NO pin → no_pin
      { fixture: 'Fog 1', at: 0 },   // type HAS a pin (512) → pin_mismatch
    ] },
  ] }] });
  const horn = { name: 'Horn 1', fixtureType: 'AirHorn' };
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(horn, fog), PINS);
  assert.ok(p.violations.some(v => v.code === 'no_pin'));
  assert.ok(p.violations.some(v => v.code === 'pin_mismatch'));
  for (const name of ['Horn 1', 'Fog 1']) {
    assert.deepEqual(fieldsOf(p, name), UNPATCHED, name);
  }
  // Negative addresses are still structural corruption.
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 1, chain: [{ fixture: 'Fog 1', at: -1 }] }] }] }), /pinned entry/);
});

test('an out-of-range universe LOADS and projects unpatched, loudly', () => {
  // Cold review 2026-06-12: a panel typo (e.g. 64000) must never brick
  // the boot — range is operational, not structural (same class as the
  // at: 0 fix). Only non-positive/non-integer universes are corruption.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 64000, chain: [{ fixture: 'Par 1', at: 1 }] },
    { port: 2, universe: 2, chain: [{ fixture: 'Par 2', at: 1 }] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.ok(p.violations.some(v => v.code === 'universe_range'));
  assert.deepEqual(fieldsOf(p, 'Par 1'), UNPATCHED, 'bad-universe port unpatches');
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 1, 'healthy sibling unaffected');
  // The high-water mark never burns on garbage values.
  const r2 = reg(null);
  noteUniverseUsed(r2, 64000);
  assert.equal(nextFreeUniverse(r2), 2);
});

// ── Allocation model: absolute addresses ────────────────────────────────

test('fixtures project at their stored absolute addresses, order is cosmetic', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: [
      { fixture: 'Par 2', at: 11 },   // chain order ≠ address order — fine
      { fixture: 'Par 1', at: 1 },
      { gap: 33, at: 21 },
      { fixture: 'Par 3', at: 54 },
    ] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  assert.equal(p.violations.length, 0);
  assert.deepEqual(fieldsOf(p, 'Par 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 2, dmxAddress: 1, controllerId: 1 });
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 11);
  assert.equal(fieldsOf(p, 'Par 3').dmxAddress, 54);
  assert.equal(p.universeEnds.get(2), 63, 'gap (21–53) and Par 3 (54–63) count');
});

test('full 512 budget: a fixture ending exactly at 512 is valid; past it unpatches', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: [
      { fixture: 'Par 1', at: DMX_UNIVERSE_SIZE - FP + 1 },  // 503–512 OK
      { fixture: 'Par 2', at: DMX_UNIVERSE_SIZE - FP + 2 },  // 504–513 overflow
    ] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 503);
  assert.deepEqual(fieldsOf(p, 'Par 2'), UNPATCHED);
  assert.ok(p.violations.some(v => v.code === 'pin_overflow'));
});

test('overlaps WARN and mark both claims — nothing unpatches', () => {
  // Decision 19: every address is explicit operator state; conflicts
  // paint red and stand, the operator resolves them.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }] },     // 1–10
    { port: 2, universe: 3, chain: [{ fixture: 'Par 2', at: 5 }] },     // 5–14 collides
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.ok(p.violations.some(v => v.code === 'overlap'));
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1, 'kept');
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 5, 'kept');
  const items = [...p.portLayouts.values()].flat();
  assert.equal(items.filter(i => i.conflict).length, 2, 'both claims marked red');
  // Gap collisions warn the same way.
  const r2 = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [{ gap: 20, at: 1 }] },
    { port: 2, universe: 3, chain: [{ fixture: 'Par 2', at: 10 }] },
  ] }] });
  const p2 = computeProjection(r2, configMap(par('Par 2')), PINS);
  assert.ok(p2.violations.some(v => v.code === 'overlap'));
  assert.equal(fieldsOf(p2, 'Par 2').dmxAddress, 10, 'kept despite the gap collision');
});

test('orphans and unknown definitions unpatch ONLY themselves', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: [
      { fixture: 'Par 1', at: 1 },
      { fixture: 'Ghost', at: 11 },     // no config → orphan
      { fixture: 'Mystery', at: 21 },   // no definition → no_definition
      { fixture: 'Par 2', at: 31 },
    ] },
  ] }] });
  const mystery = { name: 'Mystery', fixtureType: 'UnregisteredBar9000' };
  const p = computeProjection(r, configMap(par('Par 1'), mystery, par('Par 2')), PINS);
  assert.ok(p.violations.some(v => v.code === 'orphan'));
  assert.ok(p.violations.some(v => v.code === 'no_definition'));
  assert.deepEqual(fieldsOf(p, 'Mystery'), UNPATCHED);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 31, 'neighbors unaffected — no chain break');
});

test('legacy packed (string) entries are unallocated: loud + unpatched', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1'] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1')), PINS);
  assert.ok(p.violations.some(v => v.code === 'unallocated'));
  assert.deepEqual(fieldsOf(p, 'Par 1'), UNPATCHED);
});

test('universeMaps carries the FULL occupancy, sorted, across controllers', () => {
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 2', at: 40 }] },
      { port: 2, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }, { gap: 7, at: 100 }] },
    ] },
  ] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  const map = p.universeMaps.get(3);
  assert.deepEqual(map.map(c => [c.start, c.end, c.name]), [
    [1, 10, 'Par 1'],
    [40, 49, 'Par 2'],
    [100, 106, null],
  ]);
  assert.equal(p.universeEnds.get(3), 106);
});

// ── Legacy migration (decision 19 upgrade path) ─────────────────────────

test('migrateLegacyChains converts packed chains at their OLD derived addresses', () => {
  // Mirrors the operator's test_bench mapping: pars (10ch) then bars
  // (119ch), packed from startAddress — migration must reproduce the
  // exact old packing so upgrading moves nothing.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, startAddress: 1,
      chain: ['Par 1', 'Par 2', { gap: 33 }, 'Bar 1', 'Bar 2'] },
    { port: 2, universe: 3, startAddress: 200, chain: ['Par 3'] },
  ] }] });
  const bar = (name) => ({ name, group: 'Bars', fixtureType: 'ShehdsBar' });
  const configs = configMap(par('Par 1'), par('Par 2'), par('Par 3'), bar('Bar 1'), bar('Bar 2'));
  const migrated = migrateLegacyChains(r, configs, PINS);
  assert.equal(migrated.length, 6);
  const p = computeProjection(r, configs, PINS);
  assert.equal(p.violations.length, 0);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 11);
  assert.equal(fieldsOf(p, 'Bar 1').dmxAddress, 54, '21 + 33 gap');
  assert.equal(fieldsOf(p, 'Bar 2').dmxAddress, 173, '54 + 119, NOT 64');
  assert.equal(fieldsOf(p, 'Par 3').dmxAddress, 200, 'old startAddress honored');
  assert.equal(r.controllers[0].ports[0].startAddress, undefined, 'startAddress dropped');
  // Idempotent: a second call changes nothing.
  assert.equal(migrateLegacyChains(r, configs, PINS).length, 0);
});

test('migration is ATOMIC per port: an unknowable footprint defers the whole port', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', 'Mystery', 'Par 2'] },
  ] }] });
  const mystery = { name: 'Mystery', fixtureType: 'UnregisteredBar9000' };
  const configs = configMap(par('Par 1'), mystery, par('Par 2'));
  const migrated = migrateLegacyChains(r, configs, PINS);
  assert.deepEqual(migrated, [], 'nothing converts until every footprint is provable');
  assert.equal(typeof r.controllers[0].ports[0].chain[0], 'string', 'whole port stays legacy');
  assert.equal(r.controllers[0].ports[0].startAddress, 1, 'startAddress kept for the retry');
  const p = computeProjection(r, configs, PINS);
  assert.ok(p.violations.some(v => v.code === 'unallocated'));
  // Retry after the definition appears: full conversion at OLD addresses.
  initRegistry({
    UkingPar: { fixture_type: 'UkingPar', channel_mode: 10 },
    ShehdsBar: { fixture_type: 'ShehdsBar', channel_mode: 119 },
    UnregisteredBar9000: { fixture_type: 'UnregisteredBar9000', channel_mode: 7 },
  });
  const retried = migrateLegacyChains(r, configs, PINS);
  assert.equal(retried.length, 3);
  const p2 = computeProjection(r, configs, PINS);
  assert.equal(fieldsOf(p2, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p2, 'Mystery').dmxAddress, 11);
  assert.equal(fieldsOf(p2, 'Par 2').dmxAddress, 18, '11 + 7ch');
  assert.equal(r.controllers[0].ports[0].startAddress, undefined);
  // Restore the baseline definitions for later tests.
  initRegistry({
    UkingPar: { fixture_type: 'UkingPar', channel_mode: 10 },
    ShehdsBar: { fixture_type: 'ShehdsBar', channel_mode: 119 },
  });
});

// ── Shared universes / controller-level rules ───────────────────────────

test('two controllers may carry the SAME universe with non-overlapping channels', () => {
  // Operator decision 2026-06-15: a shared universe number across
  // distinct controllers (independent sACN unicast targets) is NOT a
  // conflict. Both ports patch normally as long as their channel ranges
  // do not overlap.
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }] }] },   // 1–10
    { id: 2, name: 'B', ip: '10.0.0.2', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 2', at: 20 }] }] },  // 20–29
  ] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.equal(p.violations.length, 0, 'a shared universe is no longer a violation');
  assert.deepEqual(fieldsOf(p, 'Par 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 3, dmxAddress: 1, controllerId: 1 });
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '10.0.0.2', dmxUniverse: 3, dmxAddress: 20, controllerId: 2 });
  // The full universe map aggregates both controllers' claims.
  assert.deepEqual(p.universeMaps.get(3).map(c => [c.start, c.end, c.name]), [
    [1, 10, 'Par 1'],
    [20, 29, 'Par 2'],
  ]);
});

test('a shared universe with OVERLAPPING channels still flags overlap (cross-controller)', () => {
  // The legitimate safety net survives: two controllers on the same
  // universe claiming overlapping channels is a real conflict — both
  // claims paint red and an `overlap` violation is raised, but neither
  // is silently unpatched (explicit addresses stand, decision 19).
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }] }] },   // 1–10
    { id: 2, name: 'B', ip: '10.0.0.2', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 2', at: 5 }] }] },   // 5–14 collides
  ] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.ok(p.violations.some(v => v.code === 'overlap'), 'cross-controller overlap detected');
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1, 'kept');
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 5, 'kept');
  const items = [...p.portLayouts.values()].flat();
  assert.equal(items.filter(i => i.conflict).length, 2, 'both claims marked red');
});

test('malformed and duplicate IPs unpatch the offending controller', () => {
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [
      { port: 1, universe: 2, chain: [{ fixture: 'Par 1', at: 1 }] }] },
    { id: 2, name: 'B', ip: 'not-an-ip', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 2', at: 1 }] }] },
    { id: 3, name: 'C', ip: '10.0.0.1', ports: [
      { port: 1, universe: 4, chain: [{ fixture: 'Par 3', at: 1 }] }] },
  ] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.deepEqual(fieldsOf(p, 'Par 2'), UNPATCHED);
  assert.deepEqual(fieldsOf(p, 'Par 3'), UNPATCHED);
  assert.ok(p.violations.some(v => v.code === 'bad_ip'));
  assert.ok(p.violations.some(v => v.code === 'dup_ip'));
});

test('isValidIp', () => {
  assert.equal(isValidIp('10.1.1.10'), true);
  assert.equal(isValidIp('255.255.255.255'), true);
  assert.equal(isValidIp('256.0.0.1'), false);
  assert.equal(isValidIp('10.1.1'), false);
  assert.equal(isValidIp(''), false);
});

// ── Effects universe rules ──────────────────────────────────────────────

test('effects pins project at their config.yaml addresses', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [
      { fixture: 'Haze 1', at: 510 },
      { fixture: 'Fog 1', at: 512 },
    ] },
  ] }] });
  const haze = { name: 'Haze 1', fixtureType: 'ChauvetHaze4D' };
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(haze, fog), PINS);
  assert.equal(p.violations.length, 0);
  assert.deepEqual(fieldsOf(p, 'Haze 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 1, dmxAddress: 510, controllerId: 1 });
  assert.deepEqual(fieldsOf(p, 'Fog 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 1, dmxAddress: 512, controllerId: 1 });
  assert.equal(p.universeEnds.get(1), 512, 'effects claims feed the U1 map');
});

test('wrong pin address and non-effects on U1 unpatch', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [
      { fixture: 'Haze 1', at: 511 },   // wrong address (pin says 510)
      { fixture: 'Par 1', at: 100 },    // not an effect at all
      { gap: 5, at: 1 },                // gaps are meaningless on U1
    ] },
  ] }] });
  const haze = { name: 'Haze 1', fixtureType: 'ChauvetHaze4D' };
  const p = computeProjection(r, configMap(haze, par('Par 1')), PINS);
  assert.ok(p.violations.some(v => v.code === 'pin_mismatch'));
  assert.ok(p.violations.some(v => v.code === 'non_effect_on_u1'));
  assert.deepEqual(fieldsOf(p, 'Haze 1'), UNPATCHED);
  assert.deepEqual(fieldsOf(p, 'Par 1'), UNPATCHED);
});

test('a PINNED effect on any port projects its U1 pin and holds no port channels', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [
      { fixture: 'Par 1', at: 1 },
      { fixture: 'Fog 1', at: 512 },
    ] },
  ] }] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(par('Par 1'), fog), PINS);
  assert.equal(p.violations.length, 0);
  assert.deepEqual(fieldsOf(p, 'Fog 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 1, dmxAddress: 512, controllerId: 1 });
  assert.equal(p.universeEnds.get(3), 10, 'fogger holds nothing on U3');
});

test('identical pin addresses gang-fire: always allowed, never a violation', () => {
  // Operator decision 2026-06-12: one address may start multiple
  // foggers at the same time, always.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [
      { fixture: 'Fog 1', at: 512 },
      { fixture: 'Fog 2', at: 512 },
    ] },
  ] }] });
  const fog = (name) => ({ name, fixtureType: 'TEFogMachine' });
  const p = computeProjection(r, configMap(fog('Fog 1'), fog('Fog 2')), PINS);
  assert.equal(p.violations.length, 0);
  assert.equal(fieldsOf(p, 'Fog 1').dmxAddress, 512);
  assert.equal(fieldsOf(p, 'Fog 2').dmxAddress, 512);
});

test('pins at DIFFERENT addresses with colliding footprints flag pin_overlap', () => {
  const collidingPins = {
    ChauvetHaze4D: { universe: 1, address: 510 }, // 2 ch → 510–511
    TEFogMachine: { universe: 1, address: 511 },  // 1 ch → 511
  };
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [
      { fixture: 'Haze 1', at: 510 },
      { fixture: 'Fog 1', at: 511 },
    ] },
  ] }] });
  const haze = { name: 'Haze 1', fixtureType: 'ChauvetHaze4D' };
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(haze, fog), collidingPins);
  assert.ok(p.violations.some(v => v.code === 'pin_overlap'));
  assert.equal(fieldsOf(p, 'Haze 1').dmxAddress, 510, 'lower pin keeps its address');
  assert.deepEqual(fieldsOf(p, 'Fog 1'), UNPATCHED);
});

test('a shared universe across controllers patches both; effects pins stay independent', () => {
  // Post-2026-06-15: a shared universe is no longer contested, so a
  // non-overlapping normal fixture on the second controller patches
  // normally. Effects pins remain independent of the port universe.
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [
      { port: 1, universe: 3, chain: [{ fixture: 'Par 1', at: 1 }] }] },
    { id: 2, name: 'B', ip: '10.0.0.2', ports: [
      { port: 1, universe: 3, chain: [
        { fixture: 'Par 2', at: 100 },
        { fixture: 'Fog 1', at: 512 },
      ] }] },
  ] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), fog), PINS);
  assert.equal(p.violations.length, 0, 'shared universe + non-overlapping channels = clean');
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '10.0.0.2', dmxUniverse: 3, dmxAddress: 100, controllerId: 2 },
    'non-overlapping address on a shared universe now patches');
  assert.equal(fieldsOf(p, 'Fog 1').dmxAddress, 512, 'effects pin projects its U1 pin');
});

// ── projectOntoConfigs (live config mutation + metadata) ───────────────

test('projection writes derived fields, unpatches unmapped, reports drift', () => {
  const r = reg({ controllers: [{ id: 7, name: 'A', ip: '10.0.0.7', ports: [
    { port: 1, universe: 2, chain: [{ fixture: 'Par 1', at: 1 }] },
  ] }] });
  const mapped = { ...par('Par 1'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 99, controllerId: 3 };
  const stale = { ...par('Par 2'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 1, controllerId: 3 };
  const { violations, drift } = projectOntoConfigs(r, [mapped, stale], PINS);
  assert.equal(violations.length, 0);
  assert.equal(mapped.controllerIp, '10.0.0.7');
  assert.equal(mapped.dmxUniverse, 2);
  assert.equal(mapped.dmxAddress, 1);
  assert.equal(mapped.controllerId, 1, 'panel ordinal (decision 20), NOT the stable id 7');
  assert.equal(stale.controllerIp, '');
  assert.equal(stale.dmxUniverse, 0);
  assert.equal(drift.length, 2);
});

test('projected controllerId is the PANEL ORDINAL, renumbered after a delete', () => {
  // Decision 20 (operator 2026-06-12): the projected controllerId is the
  // controller's 1-based position in the Controller Mapping panel list
  // (registry.controllers array order). After add/delete churn the
  // operator must see 1, 2, … — never the stable internal ids (3, 5, 7).
  const r = reg(null);
  const a = addController(r, { name: 'A', ip: '10.0.0.1' }); // stable id 1
  const b = addController(r, { name: 'B', ip: '10.0.0.2' }); // stable id 2
  const c = addController(r, { name: 'C', ip: '10.0.0.3' }); // stable id 3
  a.ports[0].chain.push({ fixture: 'Par 1', at: 1 });
  b.ports[0].chain.push({ fixture: 'Par 2', at: 1 });
  c.ports[0].chain.push({ fixture: 'Fog 1', at: 512 });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const configs = configMap(par('Par 1'), par('Par 2'), fog);

  const p1 = computeProjection(r, configs, PINS);
  assert.equal(p1.violations.length, 0);
  assert.equal(fieldsOf(p1, 'Par 1').controllerId, 1);
  assert.equal(fieldsOf(p1, 'Par 2').controllerId, 2);
  assert.equal(fieldsOf(p1, 'Fog 1').controllerId, 3, 'effects pins carry the ordinal too');

  removeController(r, b); // panel now lists A (id 1), C (id 3)
  const p2 = computeProjection(r, configs, PINS);
  assert.equal(fieldsOf(p2, 'Par 1').controllerId, 1);
  assert.equal(p2.fields.has('Par 2'), false, 'unmapped after its controller was deleted');
  assert.equal(fieldsOf(p2, 'Fog 1').controllerId, 2, 'id-3 controller is SECOND in the panel → 2');
  assert.equal(r.controllers[1].id, 3, 'the stable internal id itself never renumbers');
});

test('projectOntoConfigs migrates legacy chains and reports it', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, startAddress: 1, chain: ['Par 1', 'Par 2'] },
  ] }] });
  const a = par('Par 1');
  const b = par('Par 2');
  const { violations, migrated } = projectOntoConfigs(r, [a, b], PINS);
  assert.equal(violations.length, 0);
  assert.deepEqual(migrated, ['Par 1', 'Par 2']);
  assert.equal(a.dmxAddress, 1);
  assert.equal(b.dmxAddress, 11);
  assert.deepEqual(r.controllers[0].ports[0].chain[1], { fixture: 'Par 2', at: 11 });
});

test('inactive registry leaves stored patch fields alone', () => {
  const r = reg(null);
  const config = { ...par('Par 1'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 99 };
  projectOntoConfigs(r, [config], PINS);
  assert.equal(config.dmxUniverse, 9);
});

test('metadata: sectionId per group (stable), fixtureId monotonic (stable)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: [
      { fixture: 'Par 1', at: 1 },
      { fixture: 'Par 2', at: 11 },
      { fixture: 'Mast 1', at: 21 },
    ] },
  ] }] });
  const a = { ...par('Par 1'), sectionId: 4, fixtureId: 12 };
  const b = par('Par 2');
  const c = { ...par('Mast 1', 'Masts') };
  projectOntoConfigs(r, [a, b, c], PINS);
  assert.equal(b.sectionId, 4, 'same group reuses the existing sectionId');
  assert.equal(c.sectionId, 5, 'new group gets the next free sectionId');
  assert.equal(a.fixtureId, 12, 'existing fixtureId untouched');
  assert.ok(b.fixtureId > 12 && c.fixtureId > b.fixtureId, 'new fixtureIds are monotonic');
});

// ── Mutations ───────────────────────────────────────────────────────────

test('addController creates 4 ports with distinct next-free universes (never U1)', () => {
  const r = reg(null);
  const c = addController(r, { name: 'Bow', ip: '10.1.1.10' });
  assert.equal(c.id, 1);
  assert.equal(r.nextControllerId, 2);
  assert.equal(c.ports.length, 4);
  assert.deepEqual(c.ports.map(p => p.universe), [2, 3, 4, 5]);
  const c2 = addController(r, { name: 'Stern', ip: '10.1.1.11' });
  assert.deepEqual(c2.ports.map(p => p.universe), [6, 7, 8, 9]);
});

test('controller ids are never reused after delete', () => {
  const r = reg(null);
  const c1 = addController(r, { name: 'A', ip: '10.0.0.1' });
  removeController(r, c1);
  const c2 = addController(r, { name: 'B', ip: '10.0.0.2' });
  assert.equal(c2.id, 2);
});

test('universes are never reused after a controller is removed', () => {
  const r = reg(null);
  const a = addController(r, { name: 'A', ip: '10.0.0.1' }); // U2–5
  const b = addController(r, { name: 'B', ip: '10.0.0.2' }); // U6–9
  removeController(r, a);
  const c = addController(r, { name: 'C', ip: '10.0.0.3' });
  assert.deepEqual(c.ports.map(p => p.universe), [10, 11, 12, 13],
    'C must NOT reclaim A\'s freed U2–5');
  assert.deepEqual(b.ports.map(p => p.universe), [6, 7, 8, 9], 'B untouched');
  const r2 = reg(JSON.parse(JSON.stringify(r)));
  assert.equal(nextFreeUniverse(r2), 14, 'high-water mark survives a round-trip');
});

test('noteUniverseUsed: a manually-typed universe is never handed out again', () => {
  const r = reg(null);
  const a = addController(r, { name: 'A', ip: '10.0.0.1' }); // U2–5, next=6
  noteUniverseUsed(r, 20);
  const p = addPort(r, a);
  assert.equal(p.universe, 21);
  noteUniverseUsed(r, 7); // lower than high-water: no effect
  assert.equal(nextFreeUniverse(r), 22);
});

test('derivedUniverses and nextFreeUniverse (monotonic — holes are wasted, not filled)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 5, chain: [] },
    { port: 2, universe: 2, chain: [] },
    { port: 3, universe: 1, chain: [] },
  ] }] });
  assert.deepEqual(derivedUniverses(r), [1, 2, 5]);
  assert.equal(nextFreeUniverse(r), 6);
});

test('appendFixtures rejects already-mapped names, preserves order', () => {
  const r = reg(null);
  const c = addController(r, { name: 'A', ip: '10.0.0.1' });
  const [p1, p2] = c.ports;
  appendFixtures(r, p1, ['Par 1']);
  const { added, rejected } = appendFixtures(r, p2, ['Par 2', 'Par 1', 'Par 3']);
  assert.deepEqual(added, ['Par 2', 'Par 3']);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].name, 'Par 1');
  assert.match(rejected[0].where, /Port 1/);
});

test('removePort / removeController return freed fixture names; deletion frees channels', () => {
  const r = reg(null);
  const c = addController(r, { name: 'A', ip: '10.0.0.1' });
  c.ports[0].chain.push({ fixture: 'Par 1', at: 1 }, { fixture: 'Par 2', at: 11 });
  c.ports[1].chain.push({ fixture: 'Par 3', at: 1 });
  assert.deepEqual(removePort(r, c, c.ports[0]), ['Par 1', 'Par 2']);
  assert.deepEqual(removeController(r, c), ['Par 3']);
  assert.equal(registryIsActive(r), false);
});

test('unmapFixture, moveChainEntry, renameFixtureInChains', () => {
  const r = reg(null);
  const c = addController(r, { name: 'A', ip: '10.0.0.1' });
  const p = c.ports[0];
  p.chain.push(
    { fixture: 'Par 1', at: 1 },
    { fixture: 'Par 2', at: 11 },
    { fixture: 'Par 3', at: 21 },
  );
  moveChainEntry(p, 2, 0);
  assert.equal(p.chain[0].fixture, 'Par 3');
  assert.equal(p.chain[0].at, 21, 'reordering never changes addresses');
  assert.equal(unmapFixture(r, 'Par 1'), true);
  assert.equal(p.chain.length, 2);
  assert.equal(renameFixtureInChains(r, 'Par 3', 'Bow Par'), true);
  assert.equal(mappedFixtures(r).has('Bow Par'), true);
});

// ── Round-trip identity (save→load→save) ───────────────────────────────

test('registry survives a JSON round-trip identically', () => {
  const tree = {
    nextControllerId: 3,
    nextUniverse: 6,
    controllers: [
      { id: 1, name: 'Bow PKnight', ip: '10.1.1.10', ports: [
        { port: 1, universe: 2, chain: [
          { fixture: 'Par 1', at: 1 },
          { gap: 33, at: 11 },
          { fixture: 'Par 2', at: 44 },
        ] },
        { port: 2, universe: 3, chain: [] },
        { port: 3, universe: 1, chain: [{ fixture: 'Fog 1', at: 512 }] },
      ] },
    ],
  };
  const r1 = reg(tree);
  const r2 = reg(JSON.parse(JSON.stringify(r1)));
  assert.deepEqual(r2, r1);
});
