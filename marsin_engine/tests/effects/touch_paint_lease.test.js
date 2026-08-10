// touch_paint_lease — the TOUCH CONTROL deadman for PAINT SHIP.
//
// PAINT SHIP writes group fixed-colour overrides, which are a FLAT OVERWRITE:
// a painted group goes static and stops showing the pattern entirely. Before
// the lease, a painted group outlived everything an operator would reach for —
// the panel dying sent no DELETE, panicStop() spares group locks by design, and
// the override was persisted and re-applied at boot. An iPad that walked out of
// wifi range left part of the ship frozen with no recovery but editing YAML.
//
// These tests drive a REAL engine subprocess and assert the two independent
// nets actually fire, plus the persistence rule that stops paint resurrecting:
//   1. LEASE expiry   — owner stops renewing  -> group auto-clears
//   2. WS-CLOSE        — owner's socket closes -> group clears immediately
//   3. NOT PERSISTED   — leased paint never reaches globals_state.yaml
//   4. PERMANENT paint — no ownerId still persists and is NOT swept (no
//                        regression for saved operator looks)
//
// The engine is spawned with `--dest 127.0.0.9` so its sACN can never reach the
// operator's live sim bridge on 127.0.0.1:5568 (see spawn_engine.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

// Short lease so expiry is exercised in ~1 s instead of 12.
const LEASE_MS = 900;

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'touch-paint-lease',
  portBase: 7400,
  portSpan: 200,
  extraEnv: {
    MARSIN_VSN1_DEPLOY: '0',
    BM26_TOUCH_PAINT_LEASE_MS: String(LEASE_MS),
  },
  extraArgs: ['--dest', '127.0.0.9'],
});

/** First real group name from the loaded model — never hard-code one. */
let GROUP_A = null;
let GROUP_B = null;

const COLOR = [1, 0, 0, 0, 0, 0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overrides() {
  const { data } = await h.api('GET', '/group-fixed-colors');
  return data.overrides || {};
}

function globalsOnDisk() {
  const p = path.join(h.stateDir, 'globals_state.yaml');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

/** Open /ws/control and resolve once it is open. */
function openControlWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 8000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Send a message and wait for one matching reply type. */
function rpc(ws, msg, expectType) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${expectType}' reply`)), 8000);
    function onMsg(raw) {
      let d; try { d = JSON.parse(raw.toString()); } catch { return; }
      if (d.type !== expectType) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(d);
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify(msg));
  });
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
  const { data } = await h.api('GET', '/group-fixed-colors');
  assert.ok(Array.isArray(data.groups) && data.groups.length >= 2,
    `model must expose >= 2 groups, got ${JSON.stringify(data.groups)}`);
  GROUP_A = data.groups[0];
  GROUP_B = data.groups[1];
});

after(async () => { await h.teardown(); });

test('leased paint applies, reports its lease, and is NOT persisted to disk', async () => {
  const { status, data } = await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`, {
    color: COLOR, brightness: 1, ownerId: 'touch-test-owner',
  });
  assert.equal(status, 200);
  assert.equal(data.leased, true, 'PUT with ownerId must report leased:true');
  assert.equal(data.leaseMs, LEASE_MS);

  const ov = await overrides();
  assert.ok(ov[GROUP_A], 'the group must actually be painted live');

  // The whole point: nothing on disk to resurrect at boot.
  assert.ok(!globalsOnDisk().includes(GROUP_A),
    'leased paint must NOT be written to globals_state.yaml');
});

test('lease expiry auto-clears the group when the owner stops renewing', async () => {
  await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`, {
    color: COLOR, brightness: 1, ownerId: 'touch-test-owner',
  });
  assert.ok((await overrides())[GROUP_A], 'painted before expiry');

  // Stop renewing. Lease + one sweep interval + slack.
  await sleep(LEASE_MS + Math.max(50, LEASE_MS / 4) + 700);

  assert.ok(!(await overrides())[GROUP_A],
    'group must auto-clear once its lease lapses — this is the frozen-ship failsafe');
});

test('heartbeat renewal keeps the paint alive past the raw lease window', async () => {
  const ws = await openControlWs();
  try {
    await rpc(ws, { type: 'touchControlHello', ownerId: 'hb-owner' }, 'touchControlHelloAck');
    await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`, {
      color: COLOR, brightness: 1, ownerId: 'hb-owner',
    });

    // Renew across a span comfortably longer than one lease.
    const deadline = Date.now() + LEASE_MS * 2;
    while (Date.now() < deadline) {
      const ack = await rpc(ws, { type: 'touchControlHeartbeat', ownerId: 'hb-owner' }, 'touchControlHeartbeatAck');
      assert.equal(ack.renewed, 1, 'heartbeat must renew exactly this owner\'s one group');
      await sleep(LEASE_MS / 3);
    }

    assert.ok((await overrides())[GROUP_A],
      'a renewing owner must keep its paint — the deadman must not fight a healthy panel');
  } finally {
    ws.close();
  }
  // And once that socket is gone, the fast path clears it.
  await sleep(400);
  assert.ok(!(await overrides())[GROUP_A], 'closing the owner socket releases its paint');
});

test('WS close releases the owner paint immediately, well inside the lease', async () => {
  const ws = await openControlWs();
  await rpc(ws, { type: 'touchControlHello', ownerId: 'close-owner' }, 'touchControlHelloAck');
  await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`, {
    color: COLOR, brightness: 1, ownerId: 'close-owner',
  });
  assert.ok((await overrides())[GROUP_A], 'painted while the owner is connected');

  const t0 = Date.now();
  ws.close();
  // Poll for the release rather than sleeping a full lease, so this test fails
  // if the fast path is silently relying on the sweep.
  let clearedAtMs = null;
  while (Date.now() - t0 < LEASE_MS) {
    if (!(await overrides())[GROUP_A]) { clearedAtMs = Date.now() - t0; break; }
    await sleep(50);
  }
  assert.notEqual(clearedAtMs, null,
    'WS close must clear the paint WITHOUT waiting out the lease');
});

test('explicit release clears the owner paint (clean disarm == crash outcome)', async () => {
  const ws = await openControlWs();
  try {
    await rpc(ws, { type: 'touchControlHello', ownerId: 'rel-owner' }, 'touchControlHelloAck');
    await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_A)}`, {
      color: COLOR, brightness: 1, ownerId: 'rel-owner',
    });
    const rel = await rpc(ws, { type: 'touchControlRelease', ownerId: 'rel-owner' }, 'touchControlReleased');
    assert.deepEqual(rel.cleared, [GROUP_A]);
    assert.ok(!(await overrides())[GROUP_A], 'explicit release clears immediately');
  } finally {
    ws.close();
  }
});

test('touchControlHello rejects a missing ownerId loudly (no silent accept)', async () => {
  const ws = await openControlWs();
  try {
    const rej = await rpc(ws, { type: 'touchControlHello' }, 'touchControlRejected');
    assert.match(rej.reason, /ownerId/);
  } finally {
    ws.close();
  }
});

test('REGRESSION: permanent paint (no ownerId) still persists and is never swept', async () => {
  const { status, data } = await h.api('PUT', `/group-fixed-colors/${encodeURIComponent(GROUP_B)}`, {
    color: COLOR, brightness: 1,
  });
  assert.equal(status, 200);
  assert.equal(data.leased, false, 'a PUT without ownerId must NOT be leased');
  assert.equal(data.leaseMs, null);

  assert.ok(globalsOnDisk().includes(GROUP_B),
    'permanent paint must still reach globals_state.yaml — saved looks depend on it');

  // Outlast several lease windows: the deadman must not touch unleased paint.
  await sleep(LEASE_MS * 2 + 700);
  assert.ok((await overrides())[GROUP_B],
    'unleased paint must survive — the failsafe must only reclaim what it owns');

  // Clean up so the assertion above cannot leak into another suite's state.
  await h.api('DELETE', `/group-fixed-colors/${encodeURIComponent(GROUP_B)}`);
  assert.ok(!(await overrides())[GROUP_B]);
});
