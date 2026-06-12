/**
 * controller_registry.test.js — packing, validation, and projection
 * contract tests for the Controller Mapping registry (docs/33).
 *
 * Pure logic: synthetic fixture configs with definitions registered
 * explicitly up front (packing REQUIRES a registered footprint — the
 * silent 10-channel fallback is dead) and an explicit pin table, no
 * DOM, no three.js.
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
  addController,
  addPort,
  removeController,
  removePort,
  appendFixtures,
  unmapFixture,
  replaceFixtureWithGap,
  noteUniverseUsed,
  moveChainEntry,
  renameFixtureInChains,
  computeProjection,
  projectOntoConfigs,
  portPackedWidth,
  isValidIp,
} from '../src/dmx/controller_registry.js';

const PINS = {
  ChauvetHaze4D: { universe: 1, address: 510 },
  TEFogMachine: { universe: 1, address: 512 },
};

// Packing now REQUIRES registered definitions (the silent 10-channel
// fallback scrambled real mappings at boot — 2026-06-12). Register the
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
        { port: 1, universe: 2, chain: ['Par 1'] },
        { port: 2, universe: 3, chain: ['Par 1'] },
      ] },
    ],
  }), /appears in two chains/);
});

test('invalid gap, startAddress, universe, and ids throw at load', () => {
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 2, chain: [{ gap: 0 }] }] }] }), /gap width/);
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 2, startAddress: 0, chain: [] }] }] }), /startAddress/);
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

// ── Packing ─────────────────────────────────────────────────────────────

test('chain packs from startAddress by footprint, gaps consume channels', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', { gap: 33 }, 'Par 2', 'Par 3'] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  assert.equal(p.violations.length, 0);
  assert.deepEqual(fieldsOf(p, 'Par 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 2, dmxAddress: 1, controllerId: 1 });
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 1 + FP + 33);
  assert.equal(fieldsOf(p, 'Par 3').dmxAddress, 1 + FP + 33 + FP);
});

test('full 512 budget: a fixture ending exactly at 512 is valid', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, startAddress: DMX_UNIVERSE_SIZE - FP + 1, chain: ['Par 1'] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1')), PINS);
  assert.equal(p.violations.length, 0);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 503);
});

test('overflow unpatches the crossing fixture and everything after it', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, startAddress: 495, chain: ['Par 1', 'Par 2', 'Par 3'] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  // Par 1: 495..504 valid. Par 2: 505..514 crosses 512 → unpatched, and Par 3 after it.
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 495);
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.deepEqual(fieldsOf(p, 'Par 3'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.ok(p.violations.some(v => v.code === 'overflow'));
});

test('orphan entry breaks the chain after it but keeps earlier addresses', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', 'Ghost', 'Par 2'] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.ok(p.violations.some(v => v.code === 'orphan'));
});

// ── Shared-universe ports ───────────────────────────────────────────────

test('same universe across two ports of one controller packs independently', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: ['Par 1', 'Par 2'] },
    { port: 2, universe: 3, startAddress: 200, chain: ['Par 3'] },
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  assert.equal(p.violations.length, 0);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 3').dmxAddress, 200);
  assert.equal(fieldsOf(p, 'Par 3').dmxUniverse, 3);
});

test('overlapping same-universe sibling ranges unpatch the higher port only', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: ['Par 1', 'Par 2'] },          // 1..20
    { port: 2, universe: 3, startAddress: 15, chain: ['Par 3'] }, // 15..24 — overlaps
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 11);
  assert.deepEqual(fieldsOf(p, 'Par 3'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.ok(p.violations.some(v => v.code === 'overlap'));
});

test('a universe spanning two controllers unpatches the higher-id controller port', () => {
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [{ port: 1, universe: 3, chain: ['Par 1'] }] },
    { id: 2, name: 'B', ip: '10.0.0.2', ports: [{ port: 1, universe: 3, chain: ['Par 2'] }] },
  ] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.ok(p.violations.some(v => v.code === 'dup_universe'));
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
});

test('wrong pin address, packed effect on U1, and non-effect on U1 all unpatch', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [
      { fixture: 'Haze 1', at: 511 },   // wrong address (pin says 510)
      'Fog 1',                          // packed entry — must be pinned
      'Par 1',                          // not an effect at all
    ] },
  ] }] });
  const haze = { name: 'Haze 1', fixtureType: 'ChauvetHaze4D' };
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(haze, fog, par('Par 1')), PINS);
  for (const name of ['Haze 1', 'Fog 1', 'Par 1']) {
    assert.deepEqual(fieldsOf(p, name),
      { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 }, name);
  }
  assert.ok(p.violations.some(v => v.code === 'pin_mismatch'));
  assert.ok(p.violations.some(v => v.code === 'non_effect_on_u1'));
});

test('a PACKED effect entry on a normal universe unpatches (must be pinned)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Fog 1'] },
  ] }] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(fog), PINS);
  assert.deepEqual(fieldsOf(p, 'Fog 1'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.ok(p.violations.some(v => v.code === 'effect_off_u1'));
});

test('a PINNED effect on any port projects its U1 pin and consumes no port channels', () => {
  // The fogger is physically cabled to port 1 (universe 3) but its
  // address is always the config.yaml pin on the effects universe.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [
      'Par 1',
      { fixture: 'Fog 1', at: 512 },
      'Par 2',
    ] },
  ] }] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), fog), PINS);
  assert.equal(p.violations.length, 0);
  assert.deepEqual(fieldsOf(p, 'Fog 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 1, dmxAddress: 512, controllerId: 1 });
  // Par 2 packs directly after Par 1 — the pinned fogger holds no
  // channels on universe 3.
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 1 + FP);
  // A pinned non-effect is still a violation.
  const r2 = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [{ fixture: 'Par 9', at: 100 }] },
  ] }] });
  const p2 = computeProjection(r2, configMap(par('Par 9')), PINS);
  assert.ok(p2.violations.some(v => v.code === 'pin_not_effect'));
});

test('at: 0 (unpinned WIP) LOADS and projects a loud no_pin / pin_mismatch', () => {
  // B1 regression (cold review 2026-06-12): the panel writes at: 0 when
  // config.yaml has no pin for the type. Treating that as schema
  // corruption bricked the next boot off a normal UI flow.
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
    assert.deepEqual(fieldsOf(p, name),
      { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 }, name);
  }
  // Negative addresses are still structural corruption.
  assert.throws(() => reg({ controllers: [{ id: 1, name: 'A', ip: '', ports: [
    { port: 1, universe: 1, chain: [{ fixture: 'Fog 1', at: -1 }] }] }] }), /pinned entry/);
});

test('gaps join the overlap check — a sibling port cannot pack into reserved channels', () => {
  // M2 regression (cold review 2026-06-12): gaps reserve channels for
  // real hardware not modeled in the sim; a sibling landing in one is a
  // physical DMX collision.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [{ gap: 20 }, 'Par 1'] }, // gap 1–20, par 21–30
    { port: 2, universe: 3, startAddress: 5, chain: ['Par 2'] }, // 5–14: inside the gap
  ] }] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.ok(p.violations.some(v => v.code === 'overlap'));
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 21, 'lower port keeps its addresses');
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });

  // A gap-only chain still claims its channels.
  const r2 = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: [{ gap: 50 }] },               // 1–50, nothing projected
    { port: 2, universe: 3, startAddress: 10, chain: ['Par 2'] }, // 10–19: collision
  ] }] });
  const p2 = computeProjection(r2, configMap(par('Par 2')), PINS);
  assert.ok(p2.violations.some(v => v.code === 'overlap'));
  assert.deepEqual(fieldsOf(p2, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
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
  // M3 (cold review 2026-06-12): the haze pin spans 510–511; a fog pin
  // at 511 lands inside it — a config.yaml global_effects error. The
  // higher address loses deterministically.
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
  assert.deepEqual(fieldsOf(p, 'Fog 1'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
});

test('a pin whose footprint runs past 512 flags pin_overflow', () => {
  const overflowPins = { ChauvetHaze4D: { universe: 1, address: 512 } }; // 2 ch → 512–513
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 1, chain: [{ fixture: 'Haze 1', at: 512 }] },
  ] }] });
  const haze = { name: 'Haze 1', fixtureType: 'ChauvetHaze4D' };
  const p = computeProjection(r, configMap(haze), overflowPins);
  assert.ok(p.violations.some(v => v.code === 'pin_overflow'));
  assert.deepEqual(fieldsOf(p, 'Haze 1'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
});

test('pinned effects survive their port losing an overlap or universe contest', () => {
  // m3 (cold review 2026-06-12): the pin lives on the effects universe
  // — a packed-channel conflict on the port's own universe is unrelated.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: ['Par 1', 'Par 2'] },          // 1–20
    { port: 2, universe: 3, startAddress: 15,
      chain: ['Par 3', { fixture: 'Fog 1', at: 512 }] },          // loses the overlap
  ] }] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r,
    configMap(par('Par 1'), par('Par 2'), par('Par 3'), fog), PINS);
  assert.ok(p.violations.some(v => v.code === 'overlap'));
  assert.deepEqual(fieldsOf(p, 'Par 3'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.deepEqual(fieldsOf(p, 'Fog 1'),
    { controllerIp: '10.0.0.1', dmxUniverse: 1, dmxAddress: 512, controllerId: 1 });

  // Same for a contested universe across controllers.
  const r2 = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [{ port: 1, universe: 3, chain: ['Par 1'] }] },
    { id: 2, name: 'B', ip: '10.0.0.2', ports: [
      { port: 1, universe: 3, chain: ['Par 2', { fixture: 'Fog 1', at: 512 }] },
    ] },
  ] });
  const p2 = computeProjection(r2, configMap(par('Par 1'), par('Par 2'), fog), PINS);
  assert.ok(p2.violations.some(v => v.code === 'dup_universe'));
  assert.deepEqual(fieldsOf(p2, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.equal(fieldsOf(p2, 'Fog 1').dmxAddress, 512, 'pin unaffected by the contest');
});

test('universeEnds tracks the running end of every universe in one pass', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', { gap: 33 }, 'Par 2'] }, // ends at 53
    { port: 2, universe: 3, startAddress: 200, chain: ['Par 3'] },    // ends at 209
    { port: 3, universe: 3, chain: ['Par 4'] },                       // 1..10 (no overlap)
    { port: 4, universe: 4, chain: [{ fixture: 'Fog 1', at: 512 }] }, // pin → U1 end 512
  ] }] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const p = computeProjection(r,
    configMap(par('Par 1'), par('Par 2'), par('Par 3'), par('Par 4'), fog), PINS);
  assert.equal(p.violations.length, 0);
  assert.equal(p.universeEnds.get(2), 1 + FP + 33 + FP - 1);
  assert.equal(p.universeEnds.get(3), 209);
  assert.equal(p.universeEnds.get(1), 512);
  assert.equal(p.universeEnds.get(4), undefined, 'pinned fogger holds nothing on U4');
});

test('portPackedWidth sums fixtures + gaps, skips pinned effects', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: [
      'Par 1', { gap: 7 }, { fixture: 'Fog 1', at: 512 }, 'Par 2',
    ] },
  ] }] });
  const fog = { name: 'Fog 1', fixtureType: 'TEFogMachine' };
  const width = portPackedWidth(r.controllers[0].ports[0],
    configMap(par('Par 1'), par('Par 2'), fog));
  assert.equal(width, FP + 7 + FP);
});

// ── Controller-level violations ─────────────────────────────────────────

test('malformed and duplicate IPs unpatch the offending controller', () => {
  const r = reg({ controllers: [
    { id: 1, name: 'A', ip: '10.0.0.1', ports: [{ port: 1, universe: 2, chain: ['Par 1'] }] },
    { id: 2, name: 'B', ip: 'not-an-ip', ports: [{ port: 1, universe: 3, chain: ['Par 2'] }] },
    { id: 3, name: 'C', ip: '10.0.0.1', ports: [{ port: 1, universe: 4, chain: ['Par 3'] }] },
  ] });
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 2'), par('Par 3')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.deepEqual(fieldsOf(p, 'Par 3'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
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

// ── projectOntoConfigs (live config mutation + metadata) ───────────────

test('projection writes derived fields, unpatches unmapped, reports drift', () => {
  const r = reg({ controllers: [{ id: 7, name: 'A', ip: '10.0.0.7', ports: [
    { port: 1, universe: 2, chain: ['Par 1'] },
  ] }] });
  const mapped = { ...par('Par 1'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 99, controllerId: 3 };
  const stale = { ...par('Par 2'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 1, controllerId: 3 };
  const { violations, drift } = projectOntoConfigs(r, [mapped, stale], PINS);
  assert.equal(violations.length, 0);
  assert.equal(mapped.controllerIp, '10.0.0.7');
  assert.equal(mapped.dmxUniverse, 2);
  assert.equal(mapped.dmxAddress, 1);
  assert.equal(mapped.controllerId, 7);
  // Unmapped fixture under an active registry → unpatched (docs/33).
  assert.equal(stale.controllerIp, '');
  assert.equal(stale.dmxUniverse, 0);
  assert.equal(stale.dmxAddress, 0);
  assert.equal(drift.length, 2);
});

test('inactive registry leaves stored patch fields alone', () => {
  const r = reg(null);
  const config = { ...par('Par 1'), controllerIp: '1.2.3.4', dmxUniverse: 9, dmxAddress: 99 };
  projectOntoConfigs(r, [config], PINS);
  assert.equal(config.dmxUniverse, 9);
});

test('metadata: sectionId per group (stable), fixtureId monotonic (stable)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', 'Par 2', 'Berg 1'] },
  ] }] });
  const a = { ...par('Par 1'), sectionId: 4, fixtureId: 12 };
  const b = par('Par 2');
  const c = { ...par('Berg 1', 'Bergs') };
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
  assert.deepEqual(p2.chain, ['Par 2', 'Par 3']);
});

test('removePort / removeController return freed fixture names', () => {
  const r = reg(null);
  const c = addController(r, { name: 'A', ip: '10.0.0.1' });
  appendFixtures(r, c.ports[0], ['Par 1', 'Par 2']);
  appendFixtures(r, c.ports[1], ['Par 3']);
  assert.deepEqual(removePort(r, c, c.ports[0]), ['Par 1', 'Par 2']);
  assert.deepEqual(removeController(r, c), ['Par 3']);
  assert.equal(registryIsActive(r), false);
});

test('unmapFixture, moveChainEntry, renameFixtureInChains', () => {
  const r = reg(null);
  const c = addController(r, { name: 'A', ip: '10.0.0.1' });
  const p = c.ports[0];
  appendFixtures(r, p, ['Par 1', 'Par 2', 'Par 3']);
  moveChainEntry(p, 2, 0);
  assert.deepEqual(p.chain, ['Par 3', 'Par 1', 'Par 2']);
  assert.equal(unmapFixture(r, 'Par 1'), true);
  assert.deepEqual(p.chain, ['Par 3', 'Par 2']);
  assert.equal(renameFixtureInChains(r, 'Par 3', 'Bow Par'), true);
  assert.deepEqual(p.chain, ['Bow Par', 'Par 2']);
  assert.equal(mappedFixtures(r).has('Bow Par'), true);
});

test('derivedUniverses and nextFreeUniverse (monotonic — holes are wasted, not filled)', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 5, chain: [] },
    { port: 2, universe: 2, chain: [] },
    { port: 3, universe: 1, chain: [] },
  ] }] });
  assert.deepEqual(derivedUniverses(r), [1, 2, 5]);
  // U3/U4 are free but NOT handed out — allocation never backfills, so
  // removals can never cause later gear to reclaim old universes
  // (operator decision 2026-06-12: waste universes, never reshuffle).
  assert.equal(nextFreeUniverse(r), 6);
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
  // The high-water mark survives a save/load round-trip.
  const r2 = reg(JSON.parse(JSON.stringify(r)));
  assert.equal(nextFreeUniverse(r2), 14);
});

test('noteUniverseUsed: a manually-typed universe is never handed out again', () => {
  const r = reg(null);
  const a = addController(r, { name: 'A', ip: '10.0.0.1' }); // U2–5, next=6
  noteUniverseUsed(r, 20); // operator types U20 on a port
  const p = addPort(r, a);
  assert.equal(p.universe, 21);
  noteUniverseUsed(r, 7); // lower than high-water: no effect
  assert.equal(nextFreeUniverse(r), 22);
});

test('replaceFixtureWithGap: deleting a fixture keeps every downstream address', () => {
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', 'Par 2', 'Par 3'] }, // 1 / 11 / 21
  ] }] });
  assert.equal(replaceFixtureWithGap(r, 'Par 2', FP), 'gapped');
  const p = computeProjection(r, configMap(par('Par 1'), par('Par 3')), PINS);
  assert.equal(p.violations.length, 0, 'no orphan — the entry is a gap now');
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 3').dmxAddress, 21, 'unchanged despite the delete');
  // Pinned effects hold no port channels — entry simply drops.
  const r2 = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 3, chain: ['Par 1', { fixture: 'Fog 1', at: 512 }, 'Par 2'] },
  ] }] });
  assert.equal(replaceFixtureWithGap(r2, 'Fog 1', 1), 'unpinned');
  const p2 = computeProjection(r2, configMap(par('Par 1'), par('Par 2')), PINS);
  assert.equal(fieldsOf(p2, 'Par 2').dmxAddress, 11, 'packed neighbors unaffected');
  // Unmapped names report false (nothing to do).
  assert.equal(replaceFixtureWithGap(r2, 'Ghost', FP), false);
});

test('a fixture type with no registered definition unpatches the rest of the chain, loudly', () => {
  // The exact reload-scramble bug: packing must never guess a footprint.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', 'Mystery', 'Par 2'] },
  ] }] });
  const mystery = { name: 'Mystery', fixtureType: 'UnregisteredBar9000' };
  const p = computeProjection(r, configMap(par('Par 1'), mystery, par('Par 2')), PINS);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1, 'entries before the unknown keep packing');
  assert.deepEqual(fieldsOf(p, 'Mystery'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.deepEqual(fieldsOf(p, 'Par 2'),
    { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  assert.ok(p.violations.some(v => v.code === 'no_definition'));
});

test('mixed-footprint chain packs with REAL definition footprints (reload regression)', () => {
  // Mirrors the operator's test_bench mapping: pars (10ch) then bars
  // (119ch). The boot-order bug packed the bars 10 apart.
  const r = reg({ controllers: [{ id: 1, name: 'A', ip: '10.0.0.1', ports: [
    { port: 1, universe: 2, chain: ['Par 1', 'Par 2', 'Bar 1', 'Bar 2'] },
  ] }] });
  const bar = (name) => ({ name, group: 'Bars', fixtureType: 'ShehdsBar' });
  const p = computeProjection(r,
    configMap(par('Par 1'), par('Par 2'), bar('Bar 1'), bar('Bar 2')), PINS);
  assert.equal(p.violations.length, 0);
  assert.equal(fieldsOf(p, 'Par 1').dmxAddress, 1);
  assert.equal(fieldsOf(p, 'Par 2').dmxAddress, 11);
  assert.equal(fieldsOf(p, 'Bar 1').dmxAddress, 21);
  assert.equal(fieldsOf(p, 'Bar 2').dmxAddress, 140, '21 + 119, NOT 31');
});

// ── Round-trip identity (save→load→save) ───────────────────────────────

test('registry survives a JSON round-trip identically', () => {
  const tree = {
    nextControllerId: 3,
    controllers: [
      { id: 1, name: 'Bow PKnight', ip: '10.1.1.10', ports: [
        { port: 1, universe: 2, startAddress: 1, chain: ['Par 1', { gap: 33 }, 'Par 2'] },
        { port: 2, universe: 3, startAddress: 200, chain: [] },
        { port: 3, universe: 1, startAddress: 1, chain: [{ fixture: 'Fog 1', at: 512 }] },
      ] },
    ],
  };
  const r1 = reg(tree);
  const r2 = reg(JSON.parse(JSON.stringify(r1)));
  assert.deepEqual(r2, r1);
});
