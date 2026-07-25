// End-to-end: GET /status must expose `outputRouting` — the engine's declared
// per-controller routes (config.yaml `controllers:`). The sim's sACN bridge
// polls this field and SUPPRESSES its own hardware relay for every
// (universe → host) pair the engine delivers itself; without it the bridge
// reflected the engine's alsoFlat loopback stream back at declared
// controllers and the fixture received two interleaved sACN sources on one
// universe — the 2026-07-24 physical-flicker root cause (report 20260724_15).
//
// Spawns a real engine (repo config.yaml, which declares Titanic-202 →
// 10.1.1.202 U10+U12 alsoFlat) and asserts the /status contract the bridge
// depends on (lib/bridge_routing.cjs::engineOwnedPairs).
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

test('GET /status carries outputRouting with the declared controllers', async () => {
  const { status, data } = await h.api('GET', '/status');
  assert.equal(status, 200);
  assert.ok(data.outputRouting, '/status must expose outputRouting (bridge dual-source suppression contract)');
  assert.ok(Array.isArray(data.outputRouting.controllers), 'outputRouting.controllers must be a list');

  // Repo config.yaml declares Titanic-202. Find it by host — the exact set of
  // other controllers may evolve, but the SHAPE contract must hold for all.
  const t202 = data.outputRouting.controllers.find(c => c.host === '10.1.1.202');
  assert.ok(t202, 'declared controller Titanic-202 (10.1.1.202) missing from outputRouting');
  assert.equal(t202.name, 'Titanic-202');
  assert.equal(t202.protocol, 'sACN');
  assert.equal(t202.alsoFlat, true);
  assert.deepEqual([...t202.universes].sort((a, b) => a - b), [10, 12]);

  for (const c of data.outputRouting.controllers) {
    assert.equal(typeof c.host, 'string');
    assert.ok(c.host.length > 0);
    assert.ok(Array.isArray(c.universes));
  }
});

test('outputRouting is stable across /status reads (introspection, not a counter)', async () => {
  const a = await h.api('GET', '/status');
  const b = await h.api('GET', '/status');
  assert.deepEqual(a.data.outputRouting, b.data.outputRouting);
  // And matches what waitForReady saw at boot.
  assert.deepEqual(a.data.outputRouting, statusAtReady.outputRouting);
});
