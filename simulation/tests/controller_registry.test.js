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
  CONTROLLER_TYPE_DMX,
  CONTROLLER_TYPE_LED,
  isLedController,
  setControllerType,
  CONTROLLER_PROTOCOL_SACN,
  CONTROLLER_PROTOCOL_ARTNET,
  DEFAULT_CONTROLLER_PROTOCOL,
  isArtnetController,
  setControllerProtocol,
  normalizeLedConfig,
  computeLedProjection,
  ledOutputIndexForPort,
  nextLedOutputNumber,
  parkedUniverseFor,
  setParkedUniverse,
  clearParkedUniverse,
  LED_MAX_OUTPUTS,
  testAutoPatch,
  clearAllPatches,
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
  const { violations, drift } = projectOntoConfigs(r, [mapped, stale], PINS, []);
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
  const { violations, migrated } = projectOntoConfigs(r, [a, b], PINS, []);
  assert.equal(violations.length, 0);
  assert.deepEqual(migrated, ['Par 1', 'Par 2']);
  assert.equal(a.dmxAddress, 1);
  assert.equal(b.dmxAddress, 11);
  assert.deepEqual(r.controllers[0].ports[0].chain[1], { fixture: 'Par 2', at: 11 });
});

test('inactive registry leaves stored patch fields alone', () => {
  const r = reg(null);
  const config = { ...par('Par 1'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 99 };
  projectOntoConfigs(r, [config], PINS, []);
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
  projectOntoConfigs(r, [a, b, c], PINS, []);
  assert.equal(b.sectionId, 4, 'same group reuses the existing sectionId');
  assert.equal(c.sectionId, 5, 'new group gets the next free sectionId');
  assert.equal(a.fixtureId, 12, 'existing fixtureId untouched');
  assert.ok(b.fixtureId > 12 && c.fixtureId > b.fixtureId, 'new fixtureIds are monotonic');
});

// ── DMX ↔ LED section/fixture id space (report 20260725_34) ────────────
//
// DMX fixtures and LED strands share ONE section/fixture id space. The
// pre-fix metadata pass took its max over DMX configs only, so a DMX
// fixture added after the strands were numbered was minted straight on
// top of a strand id (test_bench: TE Sign V3 A == LED_0 at sId 5 /
// fId 11). These tests pin both halves of the fix: the floors now cover
// the DMX ∪ LED union, and ids already baked in by the old pass are
// repaired loudly instead of living forever behind stickiness.

// The exact test_bench fixture/strand inventory that produced the bug.
function benchDmxConfigs() {
  return [
    { ...par('Par 1', 'Pars'), sectionId: 1, fixtureId: 1 },
    { ...par('Par 2', 'Pars'), sectionId: 1, fixtureId: 2 },
    { ...par('Vintage Left', 'Vintage'), sectionId: 2, fixtureId: 5 },
    { ...par('Bar Left', 'Bars'), sectionId: 3, fixtureId: 7 },
    { ...par('ChauvetHaze4D 10', 'Effects'), sectionId: 4, fixtureId: 9 },
    { ...par('TEFogMachine 10', 'Effects'), sectionId: 4, fixtureId: 10 },
  ];
}

// LED_0 / LED_1 as scene_config.yaml stores them.
function benchStrands() {
  return [
    { name: 'LED_0', group: '', sectionId: 5, fixtureId: 11 },
    { name: 'LED_1', group: '', sectionId: 6, fixtureId: 12 },
  ];
}

function benchRegistry(extraChain = []) {
  return reg({ controllers: [{ id: 1, name: 'Test Bench 1', ip: '10.1.1.10', ports: [
    { port: 1, universe: 2, chain: [
      { fixture: 'Par 1', at: 1 },
      { fixture: 'Par 2', at: 11 },
      { fixture: 'Vintage Left', at: 41 },
      { fixture: 'Bar Left', at: 107 },
      ...extraChain,
    ] },
  ] }] });
}

function idsOf(configs, strands) {
  return {
    sections: [...configs, ...strands].map(x => x.sectionId),
    fixtures: [...configs, ...strands].map(x => x.fixtureId),
  };
}

test('ledStrands is REQUIRED — a missing/non-array argument throws (no silent [])', () => {
  const r = benchRegistry();
  assert.throws(() => projectOntoConfigs(r, benchDmxConfigs(), PINS),
    /`ledStrands` is required/, 'omitted argument throws');
  assert.throws(() => projectOntoConfigs(r, benchDmxConfigs(), PINS, null),
    /`ledStrands` is required/, 'null throws');
  assert.throws(() => projectOntoConfigs(r, benchDmxConfigs(), PINS, { LED_0: {} }),
    /`ledStrands` is required/, 'a non-array object throws');
  // Validated BEFORE the inactive-registry early return: an inactive
  // registry must not hide the misuse.
  assert.throws(() => projectOntoConfigs(reg(null), [], PINS),
    /`ledStrands` is required/, 'inactive registry still validates the argument');
});

test('REGRESSION: a DMX fixture added after the strands can no longer be minted onto a strand id', () => {
  // The literal bug: TE Sign V3 A/B enter with sectionId/fixtureId 0
  // while LED_0/LED_1 already hold sId 5/6 and fId 11/12. The pre-fix
  // pass maxed over DMX only (4 / 10) and handed out 5 / 11 — LED_0.
  const configs = benchDmxConfigs();
  const strands = benchStrands();
  const a = { ...par('TE Sign V3 A', 'TE Sign') };
  const b = { ...par('TE Sign V3 B', 'TE Sign') };
  configs.push(a, b);
  const { collisions } = projectOntoConfigs(
    benchRegistry([{ fixture: 'TE Sign V3 A', at: 200 }, { fixture: 'TE Sign V3 B', at: 320 }]),
    configs, PINS, strands);

  assert.deepEqual(collisions, [], 'nothing to repair — the ids were never minted onto the strands');
  assert.equal(a.sectionId, 7, 'new group clears the LED max (6), not the DMX max (4)');
  assert.equal(b.sectionId, 7, 'same group shares the section');
  assert.equal(a.fixtureId, 13, 'new fixtureId clears the LED max (12), not the DMX max (10)');
  assert.equal(b.fixtureId, 14);

  const { sections, fixtures } = idsOf(configs, strands);
  assert.equal(new Set(fixtures).size, fixtures.length, 'every fixtureId is unique across DMX ∪ LED');
  for (const s of strands) {
    assert.ok(!configs.some(c => c.sectionId === s.sectionId),
      `no DMX fixture shares LED strand '${s.name}' sectionId ${s.sectionId}`);
    assert.ok(!configs.some(c => c.fixtureId === s.fixtureId),
      `no DMX fixture shares LED strand '${s.name}' fixtureId ${s.fixtureId}`);
  }
  assert.ok(sections.every(id => id > 0), 'every fixture/strand carries a real section');
});

test('REPAIR: ids already baked onto strand ids are moved above the union and reported', () => {
  // test_bench as committed today: TE Sign V3 A stored sId 5 / fId 11
  // (== LED_0), TE Sign V3 B stored sId 5 / fId 12 (fId == LED_1).
  const configs = benchDmxConfigs();
  const strands = benchStrands();
  const a = { ...par('TE Sign V3 A', 'TE Sign'), sectionId: 5, fixtureId: 11 };
  const b = { ...par('TE Sign V3 B', 'TE Sign'), sectionId: 5, fixtureId: 12 };
  configs.push(a, b);
  const { collisions } = projectOntoConfigs(
    benchRegistry([{ fixture: 'TE Sign V3 A', at: 200 }, { fixture: 'TE Sign V3 B', at: 320 }]),
    configs, PINS, strands);

  assert.equal(a.sectionId, 7, 'the colliding DMX section moves above the union max (6)');
  assert.equal(b.sectionId, 7, 'the whole group moves together — group↔section stays bijective');
  assert.equal(a.fixtureId, 13);
  assert.equal(b.fixtureId, 14);
  assert.deepEqual(strands, benchStrands(), 'the LED side is READ ONLY — strands never renumber');

  assert.deepEqual(collisions, [
    { name: 'TE Sign V3 A', field: 'sectionId', before: 5, after: 7, strand: 'LED_0' },
    { name: 'TE Sign V3 A', field: 'fixtureId', before: 11, after: 13, strand: 'LED_0' },
    { name: 'TE Sign V3 B', field: 'sectionId', before: 5, after: 7, strand: 'LED_0' },
    { name: 'TE Sign V3 B', field: 'fixtureId', before: 12, after: 14, strand: 'LED_1' },
  ], 'every repair is reported with the strand it collided with (callers log it loudly)');
});

test('REPAIR is idempotent — a second pass finds nothing and changes nothing', () => {
  const configs = benchDmxConfigs();
  const strands = benchStrands();
  configs.push(
    { ...par('TE Sign V3 A', 'TE Sign'), sectionId: 5, fixtureId: 11 },
    { ...par('TE Sign V3 B', 'TE Sign'), sectionId: 5, fixtureId: 12 });
  const chain = [{ fixture: 'TE Sign V3 A', at: 200 }, { fixture: 'TE Sign V3 B', at: 320 }];

  const first = projectOntoConfigs(benchRegistry(chain), configs, PINS, strands);
  assert.equal(first.collisions.length, 4);
  const afterFirst = idsOf(configs, strands);

  const second = projectOntoConfigs(benchRegistry(chain), configs, PINS, strands);
  assert.deepEqual(second.collisions, [], 'nothing left to repair');
  assert.deepEqual(idsOf(configs, strands), afterFirst, 'ids are byte-identical on a re-run');
});

test('a clean scene is untouched — no repairs, no id churn (existing scenes stay identical)', () => {
  const configs = benchDmxConfigs();
  const strands = benchStrands();
  const before = idsOf(configs, strands);
  const { collisions } = projectOntoConfigs(benchRegistry(), configs, PINS, strands);
  assert.deepEqual(collisions, [], 'no collisions to repair');
  assert.deepEqual(idsOf(configs, strands), before, 'every stored id survives unchanged');
});

test('two distinct colliding groups get two distinct new sections; a group-less fixture moves alone', () => {
  const strands = [
    { name: 'LED_0', group: '', sectionId: 3, fixtureId: 3 },
    { name: 'LED_1', group: '', sectionId: 4, fixtureId: 4 },
  ];
  const a = { ...par('Par 1', 'Pars'), sectionId: 3, fixtureId: 3 };
  const b = { ...par('Mast 1', 'Masts'), sectionId: 4, fixtureId: 4 };
  const loose = { name: 'Fog 1', fixtureType: 'TEFogMachine', sectionId: 3, fixtureId: 9 };
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: [{ fixture: 'Par 1', at: 1 }, { fixture: 'Mast 1', at: 11 }] },
  ] }] });
  projectOntoConfigs(r, [a, b, loose], PINS, strands);

  assert.equal(a.sectionId, 5);
  assert.equal(b.sectionId, 6, 'a second colliding group does NOT reuse the first repair');
  assert.equal(loose.sectionId, 7, 'a group-less fixture is repaired on its own');
  assert.equal(a.fixtureId, 10);
  assert.equal(b.fixtureId, 11);
  assert.equal(loose.fixtureId, 9, 'a non-colliding fixtureId is left alone');
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

// ── LED parity: controller type + LED projection (report 20260618_6/_7) ─

test('LED parity: un-typed controller migrates to DMX (loud, not silent)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'L', ip: '10.1.1.10', ports: [] }] });
  assert.equal(r.controllers[0].type, CONTROLLER_TYPE_DMX);
  assert.ok(r._untypedControllers.has(1));
});

test('LED parity: LED controller carries normalized led config; DMX path skips its chain', () => {
  const r = reg({
    controllers: [{
      id: 1, name: 'LEDs', ip: '10.1.1.20', type: 'LED',
      led: { order: 'GRBW' },
      ports: [{ port: 1, universe: 2, chain: ['StrandA'] }],
    }],
  });
  const c = r.controllers[0];
  assert.ok(isLedController(c));
  assert.equal(c.led.order, 'GRBW');
  assert.equal(c.led.stride, 4);
  // The DMX projection must NOT treat the strand as an orphan fixture.
  const { violations } = computeProjection(r, new Map(), PINS);
  assert.ok(!violations.some(v => v.code === 'orphan'));
});

test('LED parity: setControllerType toggles led config in place', () => {
  const r = reg({});
  const c = addController(r, { name: 'C', ip: '10.1.1.30', type: CONTROLLER_TYPE_DMX });
  assert.equal(c.led, undefined);
  setControllerType(c, CONTROLLER_TYPE_LED);
  assert.equal(c.led.order, 'RGBW');
  setControllerType(c, CONTROLLER_TYPE_DMX);
  assert.equal(c.led, undefined);
});

test('LED parity: computeLedProjection allocates sequential RGBW patches', () => {
  const r = reg({
    controllers: [{
      id: 1, name: 'LEDs', ip: '10.1.1.20', type: 'LED',
      led: { order: 'RGBW', startAddr: 1, baseUniverse: 7 },
      ports: [{ port: 1, universe: 7, chain: ['A', 'B'] }],
    }],
  });
  const { fields } = computeLedProjection(r, new Map([['A', 50], ['B', 50]]));
  assert.equal(fields.get('A').universe, 7);
  assert.equal(fields.get('A').addr, 1);
  assert.equal(fields.get('B').addr, 201); // after A's 50*4=200 ch
});

test('LED parity: normalizeLedConfig throws on bad inputs (no fallback)', () => {
  assert.throws(() => normalizeLedConfig({ order: 'NOPE' }, 'C'), /unknown channel order/);
  assert.throws(() => normalizeLedConfig({ whiteMode: 'x' }, 'C'), /whiteMode/);
});

// ── Test Auto-Patch / Clear All Patches (operator quick-patch tools) ────

function effect(name, type = 'TEFogMachine') {
  return { name, group: 'GlobalEffects', fixtureType: type };
}

test('testAutoPatch creates controllers and patches all DMX fixtures (0 unmapped)', () => {
  const r = reg(null); // empty, inactive registry — nothing exists yet
  assert.equal(registryIsActive(r), false);
  const configs = configMap(par('P1'), par('P2'), par('P3'));
  const result = testAutoPatch(r, configs, new Map(), PINS);

  // It created a DMX controller (none existed) and patched every fixture.
  assert.equal(result.created.length, 1);
  assert.match(result.created[0], /DMX controller/);
  assert.equal(result.dmxPatched, 3);
  assert.equal(result.strandsPatched, 0);

  // Zero unmapped after.
  const mapped = mappedFixtures(r);
  for (const name of configs.keys()) assert.ok(mapped.has(name), `${name} should be mapped`);

  // Sequential addresses by footprint (UkingPar = 10 ch): 1, 11, 21 on U2.
  const proj = computeProjection(r, configs, PINS);
  assert.deepEqual(fieldsOf(proj, 'P1').dmxUniverse, 2);
  assert.equal(fieldsOf(proj, 'P1').dmxAddress, 1);
  assert.equal(fieldsOf(proj, 'P2').dmxAddress, 11);
  assert.equal(fieldsOf(proj, 'P3').dmxAddress, 21);
  assert.equal(proj.violations.length, 0);
});

test('testAutoPatch wraps universes at 512 by footprint', () => {
  const r = reg(null);
  // ShehdsBar = 119 ch. 4 of them = 476 ≤ 512 on U2; the 5th (would end at
  // 595) wraps to U3:ch1.
  const bar = (name) => ({ name, group: 'Bars', fixtureType: 'ShehdsBar' });
  const configs = configMap(bar('B1'), bar('B2'), bar('B3'), bar('B4'), bar('B5'));
  testAutoPatch(r, configs, new Map(), PINS);
  const proj = computeProjection(r, configs, PINS);
  assert.equal(fieldsOf(proj, 'B1').dmxAddress, 1);    // U2:1
  assert.equal(fieldsOf(proj, 'B4').dmxAddress, 358);  // 1+3*119
  assert.equal(fieldsOf(proj, 'B4').dmxUniverse, 2);
  assert.equal(fieldsOf(proj, 'B5').dmxUniverse, 3);   // wrapped
  assert.equal(fieldsOf(proj, 'B5').dmxAddress, 1);
  assert.equal(proj.violations.length, 0);
});

test('testAutoPatch pins global effects at config.yaml addresses on U1', () => {
  const r = reg(null);
  const configs = configMap(par('P1'), effect('Fog 1', 'TEFogMachine'),
    effect('Haze 1', 'ChauvetHaze4D'));
  const result = testAutoPatch(r, configs, new Map(), PINS);
  assert.equal(result.dmxPatched, 1);
  assert.equal(result.effectsPatched, 2);
  const proj = computeProjection(r, configs, PINS);
  assert.equal(fieldsOf(proj, 'Fog 1').dmxUniverse, 1);
  assert.equal(fieldsOf(proj, 'Fog 1').dmxAddress, 512);
  assert.equal(fieldsOf(proj, 'Haze 1').dmxAddress, 510);
  // Nothing unmapped, no overflow.
  const mapped = mappedFixtures(r);
  for (const name of configs.keys()) assert.ok(mapped.has(name));
});

test('testAutoPatch binds all LED strands to an LED controller', () => {
  const r = reg(null);
  const strands = new Map([['S1', 50], ['S2', 50]]);
  const result = testAutoPatch(r, new Map(), strands, PINS);
  assert.equal(result.strandsPatched, 2);
  assert.equal(result.created.length, 1);
  assert.match(result.created[0], /LED controller/);
  const { fields } = computeLedProjection(r, strands);
  assert.ok(fields.has('S1'));
  assert.ok(fields.has('S2'));
  assert.equal(fields.get('S2').addr, 201); // after S1's 50*4 = 200 ch
  const mapped = mappedFixtures(r);
  assert.ok(mapped.has('S1') && mapped.has('S2'));
});

test('testAutoPatch covers DMX + LED together, zero unmapped', () => {
  const r = reg(null);
  const configs = configMap(par('P1'), par('P2'), effect('Fog 1'));
  const strands = new Map([['S1', 30]]);
  const result = testAutoPatch(r, configs, strands, PINS);
  assert.equal(result.created.length, 2); // a DMX + an LED controller
  const mapped = mappedFixtures(r);
  for (const name of [...configs.keys(), ...strands.keys()]) {
    assert.ok(mapped.has(name), `${name} should be mapped`);
  }
});

test('testAutoPatch reuses an existing usable controller (no duplicate create)', () => {
  const r = reg({
    controllers: [{ id: 1, name: 'Real DMX', ip: '10.0.0.9', type: 'DMX',
      ports: [{ port: 1, universe: 2, chain: [] }] }],
  });
  const configs = configMap(par('P1'));
  const result = testAutoPatch(r, configs, new Map(), PINS);
  assert.equal(result.created.length, 0); // reused 'Real DMX'
  assert.equal(r.controllers.length, 1);
  assert.ok(mappedFixtures(r).has('P1'));
});

test('testAutoPatch is loud: never leaves anything unmapped (zero count after)', () => {
  const r = reg(null);
  const configs = configMap(par('P1'), par('P2'), effect('Fog 1'));
  const strands = new Map([['S1', 10], ['S2', 10]]);
  testAutoPatch(r, configs, strands, PINS);
  const mapped = mappedFixtures(r);
  let unmapped = 0;
  for (const name of [...configs.keys(), ...strands.keys()]) {
    if (!mapped.has(name)) unmapped += 1;
  }
  assert.equal(unmapped, 0);
});

test('clearAllPatches unpatches everything (patched count == 0 after)', () => {
  const r = reg(null);
  const configs = configMap(par('P1'), par('P2'), effect('Fog 1'));
  const strands = new Map([['S1', 20]]);
  testAutoPatch(r, configs, strands, PINS);
  assert.ok(mappedFixtures(r).size > 0);

  const { entriesCleared, freed } = clearAllPatches(r);
  assert.ok(entriesCleared >= 4); // 2 pars + 1 effect + 1 strand
  assert.ok(freed.includes('P1') && freed.includes('S1'));

  // Nothing mapped, controllers + ports kept.
  assert.equal(mappedFixtures(r).size, 0);
  assert.ok(r.controllers.length > 0);
  for (const c of r.controllers) for (const p of c.ports) assert.equal(p.chain.length, 0);

  // And the projection now reports every fixture unpatched.
  const proj = computeProjection(r, configs, PINS);
  for (const name of configs.keys()) {
    const f = fieldsOf(proj, name);
    if (f) assert.equal(f.dmxUniverse, 0);
  }
});

test('clearAllPatches on an empty/inactive registry is a no-op', () => {
  const r = reg(null);
  const { entriesCleared, freed } = clearAllPatches(r);
  assert.equal(entriesCleared, 0);
  assert.equal(freed.length, 0);
});

// ── Output transport: per-controller protocol (sACN | Art-Net) ──────────

test('protocol: un-protocolled controller migrates to sACN (loud, not silent)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'C', ip: '10.1.1.10', type: 'DMX', ports: [] }] });
  assert.equal(r.controllers[0].protocol, DEFAULT_CONTROLLER_PROTOCOL);
  assert.equal(r.controllers[0].protocol, CONTROLLER_PROTOCOL_SACN);
  assert.ok(r._unprotocolledControllers.has(1));
});

test('protocol: explicit artnet loads and is reported via isArtnetController', () => {
  const r = reg({
    controllers: [{ id: 1, name: 'C', ip: '10.1.1.10', type: 'DMX', protocol: 'artnet', ports: [] }],
  });
  const c = r.controllers[0];
  assert.equal(c.protocol, CONTROLLER_PROTOCOL_ARTNET);
  assert.ok(isArtnetController(c));
  assert.ok(!r._unprotocolledControllers.has(1));
});

test('protocol: invalid protocol hard-stops the boot (structural)', () => {
  assert.throws(() => reg({
    controllers: [{ id: 1, name: 'C', ip: '10.1.1.10', protocol: 'ddp', ports: [] }],
  }), /invalid protocol 'ddp'/);
});

test('protocol: addController defaults to sACN, honors explicit artnet', () => {
  const r = reg({});
  const a = addController(r, { name: 'A', ip: '10.1.1.10' });
  assert.equal(a.protocol, CONTROLLER_PROTOCOL_SACN);
  const b = addController(r, { name: 'B', ip: '10.1.1.20', protocol: CONTROLLER_PROTOCOL_ARTNET });
  assert.ok(isArtnetController(b));
});

test('protocol: setControllerProtocol toggles in place; invalid throws', () => {
  const r = reg({});
  const c = addController(r, { name: 'C', ip: '10.1.1.30' });
  setControllerProtocol(c, CONTROLLER_PROTOCOL_ARTNET);
  assert.equal(c.protocol, CONTROLLER_PROTOCOL_ARTNET);
  setControllerProtocol(c, CONTROLLER_PROTOCOL_SACN);
  assert.equal(c.protocol, CONTROLLER_PROTOCOL_SACN);
  assert.throws(() => setControllerProtocol(c, 'wled'), /invalid protocol/);
});

test('protocol: round-trips through createControllerRegistry (serializes)', () => {
  const r = reg({
    controllers: [{ id: 1, name: 'C', ip: '10.1.1.10', type: 'DMX', protocol: 'artnet', ports: [] }],
  });
  const r2 = reg(JSON.parse(JSON.stringify(r)));
  assert.equal(r2.controllers[0].protocol, CONTROLLER_PROTOCOL_ARTNET);
});

// ── Report 20260725_70/_71: a port DECLARES the physical board output ────────
// `port.output` is 1-based (matching the `port:` key next to it and every
// operator-facing string); the device's 0-based strands[] index is derived at
// the device boundary only, by ledOutputIndexForPort. These cases pin the LOAD
// contract: what migrates, what throws, and what loads-but-is-flagged.

function ledCardTree(ports, extra = {}) {
  return {
    controllers: [{
      id: 1, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
      protocol: CONTROLLER_PROTOCOL_SACN,
      led: { order: 'RGBW', startAddr: 1 },
      ports,
      ...extra,
    }],
  };
}

test('_71 (1): an LED port with no `output` loads as the IDENTITY mapping and round-trips', () => {
  const r = reg(ledCardTree([
    { port: 1, universe: 21, chain: ['sA'] },
    { port: 3, universe: 23, chain: [] },
  ]));
  const [p1, p3] = r.controllers[0].ports;
  assert.equal(p1.output, 1);
  assert.equal(p3.output, 3);                     // identity, NOT "second row"
  assert.equal(ledOutputIndexForPort(p1), 0);
  assert.equal(ledOutputIndexForPort(p3), 2);
  // Surfaced for ONE log line per CARD (not per port) — never swallowed.
  assert.deepEqual(r._ledOutputMigrations.get(1), { name: 'LeftLeftFront', ports: [1, 3] });
  // Materialized at load ⇒ the next save writes it, and re-loading is a no-op.
  const r2 = reg(JSON.parse(JSON.stringify(r)));
  assert.equal(r2.controllers[0].ports[0].output, 1);
  assert.equal(r2.controllers[0].ports[1].output, 3);
  assert.equal(r2._ledOutputMigrations.size, 0, 'an explicit file migrates nothing');
});

test('_71 (1): a DMX port gains NO `output` field (port numbers are chain labels there)', () => {
  const r = reg({
    controllers: [{
      id: 1, name: 'Deck', ip: '10.0.0.11', type: CONTROLLER_TYPE_DMX,
      ports: [{ port: 1, universe: 23, chain: [] }],
    }],
  });
  assert.equal('output' in r.controllers[0].ports[0], false);
  assert.equal(r._ledOutputMigrations.size, 0);
  // And ledOutputIndexForPort refuses to guess one rather than returning port-1.
  assert.throws(() => ledOutputIndexForPort(r.controllers[0].ports[0]),
    /has no integer 'output'/);
});

test('_71 (2): a non-integer / out-of-range `output` HARD-STOPS the boot', () => {
  for (const bad of [0, 17, '2', 2.5, null === undefined ? 1 : -1]) {
    assert.throws(() => reg(ledCardTree([{ port: 1, output: bad, universe: 21, chain: [] }])),
      /output .* must be an integer in 1–16/,
      `output ${JSON.stringify(bad)} must throw`);
  }
  // The message names the offending field so a playa-night typo is findable.
  assert.throws(() => reg(ledCardTree([{ port: 1, output: 99, universe: 21, chain: [] }])),
    /Controller 'LeftLeftFront' port 1: output 99/);
});

test('_71 (3): TWO ports declaring the SAME output LOAD — the duplicate is operational', () => {
  // A hand-edited duplicate must be fixable in the pane, not brick the boot: the
  // row's IDENTITY is intact, only the MAPPING is invalid. The chips flag it and
  // the push gate refuses it (per_output_push.test.js).
  const r = reg(ledCardTree([
    { port: 1, output: 2, universe: 21, chain: ['sA'] },
    { port: 3, output: 2, universe: 23, chain: ['sB'] },
  ]));
  assert.deepEqual(r.controllers[0].ports.map((p) => p.output), [2, 2]);
});

test('_71 (4): addPort on an LED card takes the lowest output no other port claims', () => {
  const r = reg({});
  // addController seeds DEFAULT_PORT_COUNT rows — on a fresh card that is still
  // exactly the pre-selector behaviour: port N drives board output N.
  const c = addController(r, { name: 'L', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED });
  assert.deepEqual(c.ports.map((p) => p.output), [1, 2, 3, 4]);
  assert.deepEqual(c.ports.map((p) => p.port), [1, 2, 3, 4]);
  // A card whose rows already claim 1–4 gives the next row output 5…
  assert.equal(nextLedOutputNumber(c), 5);
  assert.equal(addPort(r, c).output, 5);
  // …and a HOLE is refilled, never skipped (the same rule as the port number).
  c.ports = c.ports.filter((p) => p.output !== 2);
  assert.equal(nextLedOutputNumber(c), 2);
  assert.equal(addPort(r, c).output, 2);
  // A DMX card never gets the field.
  const dmx = addController(r, { name: 'D', ip: '10.0.0.11', type: CONTROLLER_TYPE_DMX });
  assert.equal('output' in addPort(r, dmx), false);
});

test('_71 (4): nextLedOutputNumber refuses past the 16-output device ceiling', () => {
  const card = { name: 'full', ports: [] };
  for (let n = 1; n <= LED_MAX_OUTPUTS; n++) card.ports.push({ port: n, output: n });
  assert.throws(() => nextLedOutputNumber(card), /already drives all 16 board output/);
});

test('_71 (5): parkedOutputs round-trips, and a malformed entry THROWS', () => {
  const r = reg(ledCardTree(
    [{ port: 1, output: 1, universe: 21, chain: ['sA'] }],
    { parkedOutputs: [{ output: 3, universe: 27 }] },
  ));
  const card = r.controllers[0];
  assert.deepEqual(card.parkedOutputs, [{ output: 3, universe: 27 }]);
  // 0-based lookup at the device boundary; 1-based in the file.
  assert.equal(parkedUniverseFor(card, 2), 27);
  assert.equal(parkedUniverseFor(card, 0), null);
  // A parked universe moves the monotonic high-water mark — the device really
  // subscribes to it, so a later addPort must never hand it to real gear.
  assert.ok(nextFreeUniverse(r) > 27);
  // Round-trip through a save.
  assert.deepEqual(reg(JSON.parse(JSON.stringify(r))).controllers[0].parkedOutputs,
    [{ output: 3, universe: 27 }]);

  const ports = [{ port: 1, output: 1, universe: 21, chain: [] }];
  assert.throws(() => reg(ledCardTree(ports, { parkedOutputs: 'nope' })),
    /parkedOutputs must be a list/);
  assert.throws(() => reg(ledCardTree(ports, { parkedOutputs: [{ universe: 27 }] })),
    /parkedOutputs output undefined must be an integer/);
  assert.throws(() => reg(ledCardTree(ports, { parkedOutputs: [{ output: 3 }] })),
    /parkedOutputs output 3 universe undefined must be an integer/);
  assert.throws(() => reg(ledCardTree(ports, {
    parkedOutputs: [{ output: 3, universe: 27 }, { output: 3, universe: 28 }],
  })), /duplicate parkedOutputs entry for output 3/);
  // A DMX card cannot carry parks at all — a DMX port is a chain label.
  assert.throws(() => reg({
    controllers: [{ id: 1, name: 'D', ip: '10.0.0.11', type: CONTROLLER_TYPE_DMX,
      ports: [], parkedOutputs: [{ output: 1, universe: 5 }] }],
  }), /parkedOutputs is only valid on an LED controller/);
});

test('_71 (5): a park on an output a PORT drives LOADS (operational), and is flagged elsewhere', () => {
  const r = reg(ledCardTree(
    [{ port: 1, output: 3, universe: 21, chain: ['sA'] }],
    { parkedOutputs: [{ output: 3, universe: 27 }] },
  ));
  // It loads — the operator fixes it in the pane; validateLedManualUniverses
  // raises led_parked_output_conflict and the next push drops the stale park.
  assert.deepEqual(r.controllers[0].parkedOutputs, [{ output: 3, universe: 27 }]);
});

test('_71 (5): setParkedUniverse / clearParkedUniverse are the ONE place parks move', () => {
  const card = { name: 'c', ports: [] };
  setParkedUniverse(card, 2, 27);
  setParkedUniverse(card, 0, 25);
  assert.deepEqual(card.parkedOutputs, [{ output: 1, universe: 25 }, { output: 3, universe: 27 }]);
  setParkedUniverse(card, 2, 28);                       // move, never duplicate
  assert.deepEqual(card.parkedOutputs, [{ output: 1, universe: 25 }, { output: 3, universe: 28 }]);
  assert.equal(clearParkedUniverse(card, 0), true);
  assert.equal(clearParkedUniverse(card, 0), false);
  assert.deepEqual(card.parkedOutputs, [{ output: 3, universe: 28 }]);
  assert.equal(clearParkedUniverse(card, 2), true);
  assert.equal('parkedOutputs' in card, false, 'an empty list is dropped, not left as []');
  assert.throws(() => setParkedUniverse(card, -1, 5), /outputIndex -1 must be in 0–15/);
  assert.throws(() => setParkedUniverse(card, 2, 0), /universe 0 must be an integer/);
});

test('_71: flipping a card DMX → LED materializes `output`; LED → DMX strips it', () => {
  const r = reg({
    controllers: [{
      id: 1, name: 'Flip', ip: '10.0.0.9', type: CONTROLLER_TYPE_DMX,
      ports: [
        { port: 1, universe: 5, chain: [] },
        { port: 3, universe: 6, chain: [] },
      ],
    }],
  });
  const c = r.controllers[0];
  assert.equal('output' in c.ports[0], false);
  // Every LED consumer refuses to GUESS an output index, so the flip must
  // materialize it — otherwise the pane throws on the next render.
  setControllerType(c, CONTROLLER_TYPE_LED);
  assert.deepEqual(c.ports.map((p) => p.output), [1, 3]);
  assert.equal(ledOutputIndexForPort(c.ports[1]), 2);
  // Flipping back strips it: a DMX port number is a chain label, and the loader
  // refuses to re-parse `output`/`parkedOutputs` on a DMX card.
  setParkedUniverse(c, 1, 30);
  setControllerType(c, CONTROLLER_TYPE_DMX);
  assert.equal('output' in c.ports[0], false);
  assert.equal('parkedOutputs' in c, false);
  assert.doesNotThrow(() => reg(JSON.parse(JSON.stringify(r))));
});

test('_71: a DMX card with an unaddressable port number takes the lowest free output on flip', () => {
  const r = reg({
    controllers: [{
      id: 1, name: 'Wide', ip: '10.0.0.9', type: CONTROLLER_TYPE_DMX,
      ports: [{ port: 20, universe: 5, chain: [] }],   // no board has a 20th output
    }],
  });
  const c = r.controllers[0];
  setControllerType(c, CONTROLLER_TYPE_LED);
  assert.equal(c.ports[0].output, 1);
  assert.doesNotThrow(() => reg(JSON.parse(JSON.stringify(r))));
});
