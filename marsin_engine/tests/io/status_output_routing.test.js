// End-to-end: GET /status must expose `outputRouting`, and it must be EMPTY.
//
// The field is the sim bridge's proof that the engine has no writer the bridge
// cannot see. Its ABSENCE means something different — "this engine is too old to
// say what it delivers itself" — which makes one-writer-per-(universe,
// controller) unprovable and is a hard refusal on the bridge side (bench-mirror
// R-8). So the contract is: present, well-shaped, and empty.
//
// It is empty by construction as of operator ruling 2026-08-05: the engine's
// per-controller `controllers:` block, which unicast declared universes STRAIGHT
// TO HARDWARE (sACN or Art-Net, with `alsoFlat` dual-send), is REMOVED and
// refused at boot (lib/output_config_guard.js). All engine output is sACN to
// `sacn.destinations`, where the simulation's input bridge is the single router.
//
// This test spawns a real engine on the repo config and asserts the contract the
// bridge depends on (simulation/lib/bridge_routing.cjs::engineOwnedPairs, which
// must derive an EMPTY owned set from this).
//   node --test tests/io/status_output_routing.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'marsin-outrouting',
  portBase: 7440,
  portSpan: 60,
});

let statusAtReady = null;

before(async () => {
  h.spawnEngine();
  statusAtReady = await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('GET /status carries outputRouting, present and well-shaped', async () => {
  const { status, data } = await h.api('GET', '/status');
  assert.equal(status, 200);
  assert.ok(data.outputRouting,
    '/status must expose outputRouting — its absence is what the bridge reads as "unprovable"');
  assert.ok(Array.isArray(data.outputRouting.controllers),
    'outputRouting.controllers must be a list');
});

test('outputRouting is EMPTY — the engine declares no direct-to-hardware route', async () => {
  const { data } = await h.api('GET', '/status');
  assert.deepEqual(data.outputRouting.controllers, [],
    'the engine must deliver nothing directly to hardware: the per-controller `controllers:` ' +
    'mechanism was removed, and the bridge is the single router');
});

test('outputRouting is stable across /status reads (introspection, not a counter)', async () => {
  const a = await h.api('GET', '/status');
  const b = await h.api('GET', '/status');
  assert.deepEqual(a.data.outputRouting, b.data.outputRouting);
  // And matches what waitForReady saw at boot.
  assert.deepEqual(a.data.outputRouting, statusAtReady.outputRouting);
});
