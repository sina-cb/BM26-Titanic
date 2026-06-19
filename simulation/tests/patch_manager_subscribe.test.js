/**
 * patch_manager_subscribe.test.js — sACN-IN auto-subscribe (item #9).
 *
 * When a model patches new universes (e.g. Test Auto-Patch reaching U7/U8),
 * the sim must auto-subscribe to ALL universes the current patches reference
 * so a freshly-patched model just lights up — no manual "add universe under
 * sACN Settings + restart" step. These tests pin the two pieces of logic:
 *   1. deriveSubscribedUniverses — the union of every patched universe
 *      (fixtures in params.parLights + LED strands in params.ledStrands).
 *   2. autoSubscribePatchUniverses — merges that union into
 *      params.sacn_universes, returning what it newly added.
 *
 * patch_manager.js is a browser module (touches `window`, starts a poll), so
 * we stub the few globals it assigns at import time before importing it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser-global stubs for the module's import-time side effects.
globalThis.window = globalThis.window || {};

const { params } = await import('../src/core/state.js');
const { deriveSubscribedUniverses, autoSubscribePatchUniverses } =
  await import('../src/dmx/patch_manager.js');

function fixture(name, universe, address) {
  return { name, dmxUniverse: universe, dmxAddress: address };
}

test('deriveSubscribedUniverses unions every patched universe U2..U9', () => {
  // A model patched across U2..U9 (DMX fixtures + LED strands), deliberately
  // out of order and with duplicates within a universe.
  params.parLights = [
    fixture('Generator 1', 2, 1),
    fixture('Generator 2', 2, 120), // dup universe — must collapse
    fixture('Bar A', 3, 1),
    fixture('Bar B', 5, 1),
    fixture('Par X', 4, 1),
    fixture('Par Y', 6, 1),
    fixture('Unpatched', 0, 0), // not patched — excluded
  ];
  params.ledStrands = [
    { name: 'Left_Front_Left', dmxUniverse: 9, dmxAddress: 1 },
    { name: 'Left_Front_Right', dmxUniverse: 8, dmxAddress: 1 },
    { name: 'Right_Front', dmxUniverse: 7, dmxAddress: 1 },
  ];

  const derived = deriveSubscribedUniverses(params.parLights);
  assert.deepEqual(derived, [2, 3, 4, 5, 6, 7, 8, 9],
    'derived set must include all of U2..U9 (fixtures + strands), deduped + sorted');
});

test('autoSubscribePatchUniverses merges patched universes into sacn_universes', () => {
  // Operator started with a partial subscribed list (the classic sharp edge:
  // U7/U8 missing). Auto-subscribe must extend it to cover the full patch set.
  params.sacn_universes = '1, 2, 3, 4, 5, 6';
  params.parLights = [
    fixture('Generator 1', 2, 1),
    fixture('Par Y', 6, 1),
  ];
  params.ledStrands = [
    { name: 'Right_Front', dmxUniverse: 7, dmxAddress: 1 },
    { name: 'Left_Front_Right', dmxUniverse: 8, dmxAddress: 1 },
    { name: 'Left_Front_Left', dmxUniverse: 9, dmxAddress: 1 },
  ];

  const added = autoSubscribePatchUniverses(params.parLights);
  assert.deepEqual(added, [7, 8, 9], 'only the genuinely-missing universes are added');

  const subscribed = params.sacn_universes
    .split(',').map((u) => parseInt(u.trim(), 10));
  for (const u of [2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.ok(subscribed.includes(u),
      `subscribed set must include U${u} after auto-subscribe`);
  }
});

test('autoSubscribePatchUniverses is a no-op when already fully subscribed', () => {
  params.sacn_universes = '1, 2, 7, 8';
  params.parLights = [fixture('Generator 1', 2, 1)];
  params.ledStrands = [
    { name: 'Right_Front', dmxUniverse: 7, dmxAddress: 1 },
    { name: 'Left_Front_Right', dmxUniverse: 8, dmxAddress: 1 },
  ];

  const before = params.sacn_universes;
  const added = autoSubscribePatchUniverses(params.parLights);
  assert.deepEqual(added, [], 'nothing to add when every patched universe is already subscribed');
  assert.equal(params.sacn_universes, before, 'sacn_universes is left untouched');
});
