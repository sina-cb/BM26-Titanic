/**
 * effect_scope_groups — per-group effect scoping, parking, and 5-colour paint.
 *
 * These are the contracts behind three operator rulings that had no coverage:
 *
 *   "the whole point is that you can pre-choose each group's colour palette and
 *    then add effects, without global taking over"   -> effect-groups scoping
 *   "locked = fully parked"                          -> parked-groups
 *   "each group can use 5 colours at a time"         -> group paint `colors[]`
 *
 * All three live on the ENGINE and are applied every frame, so a stale one is a
 * rig obeying a surface nobody is driving. Each must round-trip, and — the part
 * that actually matters — each must CLEAR back to unrestricted on null, because
 * that is what disarm and the deadman revert rely on.
 *
 * Spawned with `--dest 127.0.0.9` so sACN cannot reach the live sim bridge.
 *
 * Run: node --import ./tests/helpers/setup_config_guard.mjs \
 *        --test marsin_engine/tests/effects/effect_scope_groups.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'effect-scope-groups',
  portBase: 7900,
  portSpan: 200,
  extraEnv: { MARSIN_VSN1_DEPLOY: '0' },
  extraArgs: ['--dest', '127.0.0.9'],
});

/** Real group names from the loaded model — never hard-code one. */
let GROUP_A = null;
let GROUP_B = null;

before(async () => {
  await h.spawnEngine();
  await h.waitForReady();
  const { data } = await h.api('GET', '/dimmer-groups');
  const names = Array.isArray(data) ? data
    : Object.keys(data && data.groups ? data.groups : (data || {}));
  const flat = names.map(n => (typeof n === 'string' ? n : n && n.name)).filter(Boolean);
  assert.ok(flat.length >= 2, `need >=2 model groups to test scoping, saw ${flat.length}`);
  GROUP_A = flat[0];
  GROUP_B = flat[1];
});

after(async () => { await h.teardown(); });

test('effect scope round-trips and CLEARS to unrestricted on null', async () => {
  const set = await h.api('PUT', '/effect-groups', { groups: [GROUP_A] });
  assert.equal(set.status, 200, `PUT /effect-groups should accept a group list: ${JSON.stringify(set.data)}`);

  const read = await h.api('GET', '/effect-groups');
  assert.deepEqual(read.data.groups, [GROUP_A],
    'the scope must read back exactly what was set — a silently dropped scope aims effects at the wrong hull');

  // The clear is the load-bearing half: disarm and the deadman revert both rely
  // on null meaning "unrestricted", not "no change".
  const cleared = await h.api('PUT', '/effect-groups', { groups: null });
  assert.equal(cleared.status, 200);
  const after = await h.api('GET', '/effect-groups');
  assert.equal(after.data.groups, null,
    'null must UNRESTRICT the scope, or a disarmed panel keeps confining the rig');
});

test('parked groups round-trip and CLEAR on null', async () => {
  const set = await h.api('PUT', '/parked-groups', { groups: [GROUP_B] });
  assert.equal(set.status, 200, `PUT /parked-groups should accept a group list: ${JSON.stringify(set.data)}`);

  const read = await h.api('GET', '/parked-groups');
  assert.deepEqual(read.data.groups, [GROUP_B]);

  const cleared = await h.api('PUT', '/parked-groups', { groups: null });
  assert.equal(cleared.status, 200);
  const after = await h.api('GET', '/parked-groups');
  assert.equal(after.data.groups, null,
    'a park left behind by a disarmed panel would hold a group lit through the master');
});

test('a group can carry FIVE colours at once', async () => {
  // The operator asked for five colours per group; the engine indexes them by
  // each pixel's ordinal within the group.
  const five = [
    [1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0],
    [1, 1, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0],
  ];
  const put = await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`, {
    color: five[0], colors: five, brightness: 1,
  });
  assert.equal(put.status, 200, `five-colour paint must be accepted: ${JSON.stringify(put.data)}`);

  const read = await h.api('GET', '/group-fixed-colors');
  const ov = read.data && (read.data[GROUP_A] || (read.data.overrides || {})[GROUP_A]);
  assert.ok(ov, 'the painted group must appear in /group-fixed-colors');
  assert.ok(Array.isArray(ov.colors), 'the colours array must survive the round trip');
  assert.equal(ov.colors.length, 5, 'all five colours must be kept, not collapsed to one');

  const del = await h.api('DELETE', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`);
  assert.equal(del.status, 200);
});

test('the arm envelope is bounded and never silently coerced', async () => {
  // 400, never a clamp: a silently coerced fade target is a silently wrong house
  // level on the last stage before the wire.
  for (const bad of [{ target: 2, durationMs: 100 },
                     { target: 0, durationMs: 99999 },
                     { target: 'x', durationMs: 100 }]) {
    const r = await h.api('POST', '/arm-fade', bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)} must be rejected, not clamped`);
  }
  const ok = await h.api('POST', '/arm-fade', { target: 1, durationMs: 0 });
  assert.equal(ok.status, 200);
  const read = await h.api('GET', '/arm-fade');
  assert.equal(read.data.armFade, 1);
});
