/**
 * section_fixture_id_space.test.js — the SHARED DMX ∪ LED section/fixture
 * id space, tested across BOTH passes in the order main.js runs them.
 *
 * controller_registry.test.js and led_metadata.test.js each pin one half.
 * Neither can catch the class of bug reported in 20260725_4 (secondary
 * finding 1) and fixed in 20260725_34, because that bug lives in the SEAM:
 * `projectOntoConfigs` (DMX) minted ids without seeing the strand ids that
 * `assignLedStrandMetadata` (LED) had handed out on an earlier pass, so
 * test_bench's TE Sign V3 A landed on LED_0's `sectionId 5 / fixtureId 11`
 * and every sId-keyed consumer treated them as one fixture.
 *
 * The invariant under test, stated once:
 *
 *   After the boot order projectOntoConfigs → assignLedStrandMetadata, no
 *   fixtureId is held by two entities, and no sectionId is held by both a
 *   DMX group and an LED group — no matter which side grew last, and no
 *   matter how many times the cycle re-runs.
 *
 * Explicitly NOT an invariant: any global ordering between the two halves
 * ("all LED ids above all DMX ids"). The one-time collision repair can
 * lift a DMX id above an existing LED id, and nothing may depend on that.
 *
 * Pure logic — no DOM, no three.js, no I/O.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry,
  projectOntoConfigs,
} from '../src/dmx/controller_registry.js';
import { assignLedStrandMetadata } from '../src/dmx/led/led_metadata.js';
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';

initRegistry({ UkingPar: { fixture_type: 'UkingPar', channel_mode: 10 } });

const PINS = {};

// An active registry is the gate on BOTH passes; one controller with one
// chained fixture is enough to open it. Metadata is assigned to every
// config, mapped or not, so the chain does not have to be exhaustive.
function activeRegistry() {
  return createControllerRegistry({ controllers: [{
    id: 1, name: 'Bench', ip: '10.1.1.10',
    ports: [{ port: 1, universe: 2, chain: [{ fixture: 'Par 1', at: 1 }] }],
  }] });
}

function dmx(name, group, sectionId = 0, fixtureId = 0) {
  return { name, group, fixtureType: 'UkingPar', sectionId, fixtureId };
}

function strand(name, sectionId = 0, fixtureId = 0) {
  return { name, group: '', sectionId, fixtureId };
}

/** One full boot pass, in main.js's order (DMX first, then LED). */
function projectBoth(configs, strands) {
  const result = projectOntoConfigs(activeRegistry(), configs, PINS, strands);
  assignLedStrandMetadata(strands, configs);
  return result;
}

/**
 * Assert the invariant and return the id snapshot. `sectionOwners` maps a
 * sectionId to the set of group keys claiming it — a section legitimately
 * spans many fixtures of ONE group, so the failure mode is two DIFFERENT
 * groups (or a DMX group and an LED group) on one id.
 */
function assertIdSpaceSound(configs, strands) {
  const fixtureOwners = new Map();
  const sectionOwners = new Map();
  const claim = (entity, groupKey) => {
    assert.ok(entity.sectionId > 0, `${entity.name} has no sectionId`);
    assert.ok(entity.fixtureId > 0, `${entity.name} has no fixtureId`);
    assert.equal(fixtureOwners.has(entity.fixtureId), false,
      `fixtureId ${entity.fixtureId} claimed by both ` +
      `'${fixtureOwners.get(entity.fixtureId)}' and '${entity.name}'`);
    fixtureOwners.set(entity.fixtureId, entity.name);
    const owner = sectionOwners.get(entity.sectionId);
    if (owner === undefined) sectionOwners.set(entity.sectionId, groupKey);
    else assert.equal(owner, groupKey,
      `sectionId ${entity.sectionId} claimed by both '${owner}' and '${groupKey}'`);
  };
  for (const c of configs) claim(c, `dmx:${c.group}`);
  for (const s of strands) claim(s, `led:${s.group || s.name}`);
  return {
    fixtures: [...configs, ...strands].map(x => `${x.name}=${x.fixtureId}`),
    sections: [...configs, ...strands].map(x => `${x.name}=${x.sectionId}`),
  };
}

test('the seam: DMX grows after LED (the reported bug) keeps the id space sound', () => {
  const configs = [dmx('Par 1', 'Pars', 1, 1), dmx('Bar Left', 'Bars', 2, 2)];
  const strands = [strand('LED_0'), strand('LED_1')];
  projectBoth(configs, strands);
  assert.deepEqual(strands.map(s => [s.sectionId, s.fixtureId]), [[3, 3], [4, 4]],
    'LED continues above the DMX max');

  // Now the TE Sign arrives — the exact sequence that produced the bug.
  configs.push(dmx('TE Sign V3 A', 'TE Sign'), dmx('TE Sign V3 B', 'TE Sign'));
  projectBoth(configs, strands);
  assertIdSpaceSound(configs, strands);
  assert.equal(configs[2].sectionId, 5, 'the new DMX group clears the LED ids, not just the DMX ones');
  assert.equal(configs[2].fixtureId, 5);
});

test('the seam: LED grows after a DMX repair — no strand lands back on a repaired DMX id', () => {
  // Post-repair the DMX ids sit ABOVE the LED ones. The LED pass floors on
  // the union, so it must clear the repaired DMX ids too.
  const configs = [
    dmx('Par 1', 'Pars', 1, 1),
    dmx('TE Sign V3 A', 'TE Sign', 2, 2), // baked onto LED_0 by the old pass
  ];
  const strands = [strand('LED_0', 2, 2)];
  const { collisions } = projectBoth(configs, strands);
  assert.equal(collisions.length, 2, 'the stale DMX section AND fixture id are repaired');
  assert.equal(configs[1].sectionId, 3);
  assert.equal(configs[1].fixtureId, 3);
  assertIdSpaceSound(configs, strands);

  strands.push(strand('LED_1'));
  projectBoth(configs, strands);
  assert.deepEqual([strands[1].sectionId, strands[1].fixtureId], [4, 4],
    'the new strand clears the REPAIRED DMX ids (3), it does not reuse them');
  assertIdSpaceSound(configs, strands);
});

test('alternating growth over many cycles never collides, and settles (idempotent)', () => {
  const configs = [dmx('Par 1', 'Pars', 1, 1)];
  const strands = [strand('LED_0', 2, 2)];
  projectBoth(configs, strands);
  for (let round = 0; round < 5; round++) {
    configs.push(dmx(`Par ${round + 2}`, `Group ${round}`));
    projectBoth(configs, strands);
    assertIdSpaceSound(configs, strands);
    strands.push(strand(`LED_${round + 1}`));
    projectBoth(configs, strands);
    assertIdSpaceSound(configs, strands);
  }
  const settled = assertIdSpaceSound(configs, strands);
  projectBoth(configs, strands);
  projectBoth(configs, strands);
  assert.deepEqual(assertIdSpaceSound(configs, strands), settled,
    're-running the boot passes on an unchanged scene changes no id');
});

test('the committed test_bench inventory: repaired once, then stable', () => {
  // Verbatim from simulation/scenes/test_bench (patches.yaml sectionId/
  // fixtureId + scene_config.yaml ledStrands) at the time of the fix.
  const configs = [
    dmx('Par 1', 'Pars', 1, 1), dmx('Par 2', 'Pars', 1, 2),
    dmx('Par 3', 'Pars', 1, 3), dmx('Par 4', 'Pars', 1, 4),
    dmx('Vintage Left', 'Vintage', 2, 5), dmx('Vintage Right', 'Vintage', 2, 6),
    dmx('Bar Left', 'Bars', 3, 7), dmx('Bar Right', 'Bars', 3, 8),
    dmx('ChauvetHaze4D 10', 'Effects', 4, 9), dmx('TEFogMachine 10', 'Effects', 4, 10),
    dmx('TE Sign V3 A', 'TE Sign', 5, 11), dmx('TE Sign V3 B', 'TE Sign', 5, 12),
  ];
  const strands = [strand('LED_0', 5, 11), strand('LED_1', 6, 12)];

  const { collisions } = projectBoth(configs, strands);
  assert.deepEqual(collisions.map(c => `${c.name}.${c.field} ${c.before}→${c.after}`), [
    'TE Sign V3 A.sectionId 5→7',
    'TE Sign V3 A.fixtureId 11→13',
    'TE Sign V3 B.sectionId 5→7',
    'TE Sign V3 B.fixtureId 12→14',
  ], 'exactly the two TE Sign halves move; nothing else in the scene does');

  // The other ten fixtures and both strands keep every stored id.
  assert.deepEqual(configs.slice(0, 10).map(c => [c.sectionId, c.fixtureId]),
    [[1, 1], [1, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 7], [3, 8], [4, 9], [4, 10]]);
  assert.deepEqual(strands.map(s => [s.sectionId, s.fixtureId]), [[5, 11], [6, 12]]);
  assertIdSpaceSound(configs, strands);

  const after = projectBoth(configs, strands);
  assert.deepEqual(after.collisions, [], 'the repair is one-time: the re-save is stable');
});
