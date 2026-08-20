/**
 * led_fixture_kind.test.js — the LED-BUS classification.
 *
 * A scene has two kinds of LED-bus thing and both must be treated as LED by the
 * whole mapping chain: an LED STRAND (`params.ledStrands`) and an LED PIXEL
 * FIXTURE (a `parLights` entry whose fixture DEFINITION declares `bus: led` —
 * the TE Sign V3 halves). Operator ruling 2026-07-31: *"the TE signs must be
 * associated with MarsinLED controllers in the controller mapping pane … make
 * sure the TE sign fixtures are clearly of type LED not DMX."*
 *
 * The classification is DATA (`bus` off the definition), never a hardcoded
 * fixtureType list — that is what keeps it from going stale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUS_LED,
  isLedBusDefinition,
  ledBusPixelCount,
  isLedBusFixture,
  ledBusFixtures,
  ledBusFixtureNames,
  ledMappableCounts,
} from '../src/dmx/led/led_fixture_kind.js';

const DEFS = {
  TeSignV3A40: { fixtureType: 'TeSignV3A40', bus: 'led', pixels: new Array(40).fill({}) },
  TeSignV3B34: { fixtureType: 'TeSignV3B34', bus: 'led', pixels: new Array(34).fill({}) },
  UkingPar: { fixtureType: 'UkingPar', bus: 'dmx', pixels: [{}] },
  ShehdsBar: { fixtureType: 'ShehdsBar', pixels: new Array(18).fill({}) }, // no bus → dmx
  Hollow: { fixtureType: 'Hollow', bus: 'led', pixels: [] },
};
const getDefinition = (t) => DEFS[t] || null;

const fx = (name, fixtureType) => ({ name, fixtureType });
const strand = (name, ledCount) => ({ name, ledCount });

test('the LED bus is read off the DEFINITION, never a fixtureType name list', () => {
  assert.equal(BUS_LED, 'led');
  assert.ok(isLedBusDefinition(DEFS.TeSignV3A40));
  assert.ok(isLedBusDefinition(DEFS.TeSignV3B34));
  assert.ok(!isLedBusDefinition(DEFS.UkingPar));
  // A definition that omits `bus` is DMX — legacy files stay byte-identical.
  assert.ok(!isLedBusDefinition(DEFS.ShehdsBar));
  assert.ok(!isLedBusDefinition(null));
  assert.ok(!isLedBusDefinition(undefined));
});

test('a config is LED-bus iff its definition is; a missing definition is not LED', () => {
  assert.ok(isLedBusFixture(fx('TE Sign V3 A', 'TeSignV3A40'), getDefinition));
  assert.ok(!isLedBusFixture(fx('Left Auditorium 1', 'UkingPar'), getDefinition));
  assert.ok(!isLedBusFixture(fx('Mystery', 'NotRegistered'), getDefinition));
  assert.ok(!isLedBusFixture({}, getDefinition));
  assert.ok(!isLedBusFixture(null, getDefinition));
});

test('pixel count is the definition\'s pixel list — the LED walker\'s footprint', () => {
  assert.equal(ledBusPixelCount(DEFS.TeSignV3A40), 40);
  assert.equal(ledBusPixelCount(DEFS.TeSignV3B34), 34);
});

test('an LED-bus definition with NO pixels throws — never a silent 0-px no-op', () => {
  assert.throws(() => ledBusPixelCount(DEFS.Hollow), /carries no pixels/);
});

test('ledBusFixtures / …Names pick out exactly the LED-bus configs, in scene order', () => {
  const configs = [
    fx('Left Auditorium 1', 'UkingPar'),
    fx('TE Sign V3 A', 'TeSignV3A40'),
    fx('Left Front Wall 1', 'ShehdsBar'),
    fx('TE Sign V3 B', 'TeSignV3B34'),
  ];
  assert.deepEqual(ledBusFixtureNames(configs, getDefinition), ['TE Sign V3 A', 'TE Sign V3 B']);
  assert.equal(ledBusFixtures(configs, getDefinition).length, 2);
  // The CONFIG OBJECTS themselves come back — callers mutate them in place,
  // exactly as the DMX projection does.
  assert.ok(ledBusFixtures(configs, getDefinition)[0] === configs[1]);
  assert.deepEqual(ledBusFixtures([], getDefinition), []);
  assert.deepEqual(ledBusFixtures(null, getDefinition), []);
});

test('ledMappableCounts is the UNION strands ∪ LED fixtures — the map both projections key off', () => {
  const strands = [strand('Left_Front_Left', 40), strand('Right_Back_Right', 40)];
  const configs = [
    fx('Left Auditorium 1', 'UkingPar'),
    fx('TE Sign V3 A', 'TeSignV3A40'),
    fx('TE Sign 2 V3 B', 'TeSignV3B34'),
  ];
  const counts = ledMappableCounts(strands, configs, getDefinition);
  assert.deepEqual([...counts.entries()].sort(), [
    ['Left_Front_Left', 40],
    ['Right_Back_Right', 40],
    ['TE Sign 2 V3 B', 34],
    ['TE Sign V3 A', 40],
  ]);
  // DMX fixtures are NOT in it — they are addressed by the DMX allocator.
  assert.ok(!counts.has('Left Auditorium 1'));
});

test('a strand missing ledCount defaults to 10 (the projection\'s long-standing shape)', () => {
  const counts = ledMappableCounts([{ name: 'bare' }], [], getDefinition);
  assert.equal(counts.get('bare'), 10);
});

test('a name used by BOTH a strand and an LED fixture is fatal — names are the join key', () => {
  assert.throws(
    () => ledMappableCounts([strand('TE Sign V3 A', 40)],
      [fx('TE Sign V3 A', 'TeSignV3A40')], getDefinition),
    /is BOTH an LED strand and an LED-bus fixture/);
});

test('unnamed entries are skipped rather than keyed on empty string', () => {
  const counts = ledMappableCounts(
    [{ ledCount: 5 }, strand('ok', 5)], [{ fixtureType: 'TeSignV3A40' }], getDefinition);
  assert.deepEqual([...counts.keys()], ['ok']);
});
