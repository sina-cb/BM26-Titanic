// docs/70 W4 — the Live Touch preset PLAYLIST (item 3): one ordered,
// per-scene, engine-side, server-authoritative preset store.
//
// Home: `<stateDir>/live_touch_presets.yaml`, a third sibling of
// `snapshots/` and `param_presets/`. `lib/live_touch_preset_manager.js`
// owns the persistence (atomic whole-file writes, autoSave-INDEPENDENT,
// fail-loud on a corrupt store); this suite proves the REST + WS surface
// `lib/api_server.js` wires around it end to end against a REAL spawned
// engine — the same headline acceptance a client-only (localStorage) store
// could never pass: a preset must survive an ENGINE RESTART.
//
// ISOLATION: MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR redirect every write
// into throwaway temp dirs (createEngineHarness) — this suite never writes
// into the tracked states/ tree or simulation/scenes/, and in particular
// never touches states/titanic/ (the live show scene). `--dest 192.0.2.9`
// (TEST-NET-1, RFC 5737, never routed) black-holes sACN so no frame can
// reach the live sim bridge.
//
// Run:  cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs --test tests/state/live_touch_presets.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'test_bench';

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'live-touch-presets',
  portBase: 17650,
  portSpan: 50,
  extraArgs: ['--dest', '192.0.2.9'],
});
const { api, stateDir, port } = h;
const BASE = h.base;

const STORE_FILE = () => path.join(stateDir, 'live_touch_presets.yaml');

function readStoreOnDisk() {
  if (!fs.existsSync(STORE_FILE())) return null;
  return yaml.load(fs.readFileSync(STORE_FILE(), 'utf8'));
}

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Resolve the next `liveTouchPresets` frame on `ws` whose `action` matches, ignoring others (e.g. the connect-replay). */
function waitForPresetAction(ws, action, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMsg);
      reject(new Error(`timeout waiting for liveTouchPresets action='${action}'`));
    }, timeoutMs);
    function onMsg(buf) {
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'liveTouchPresets' && m.action === action) {
        clearTimeout(timer);
        ws.removeListener('message', onMsg);
        resolve(m);
      }
    }
    ws.on('message', onMsg);
  });
}

function waitForControlMessage(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMsg);
      reject(new Error('timeout waiting for Live Touch control message'));
    }, timeoutMs);
    function onMsg(buf) {
      let message;
      try { message = JSON.parse(buf.toString()); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.removeListener('message', onMsg);
      resolve(message);
    }
    ws.on('message', onMsg);
  });
}

function sampleState(tag) {
  // An arbitrary panel-owned capture blob — palette/scheme/follow/groups/fx/
  // spatial/mode/background/colour, per docs/70 §5.2's capture set. The
  // engine must store/return this VERBATIM (never interpret the interior),
  // so the shape here is deliberately messy (nested object + array) to
  // prove verbatim round-tripping, not just flat-field copying.
  return {
    mode: 'SPATIAL',
    background: { playlist: 'ambient', entryId: `e_${tag}` },
    palette: { colorPalette1: '#ff8800', colorPalette2: '#0088ff' },
    groups: [1, 2, 3],
    fx: { e1: { p2: 0.4 }, e3: { p1: 0.9 } },
    tag,
  };
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

// ── 1. Missing file is benign — the ONE legitimate empty case ───────────

test('a scene that has never saved a preset returns an empty list, not an error', async () => {
  assert.equal(fs.existsSync(STORE_FILE()), false, 'precondition: no store file written yet');
  const r = await api('GET', '/layers/live_touch/presets');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.entries, []);
});

// ── 2. autoSave-INDEPENDENT: mutations hit disk even with autoSave OFF ──

test('create/rename/delete write straight to disk even while autoSave is OFF', async () => {
  const off = await api('POST', '/settings', { autoSave: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.autoSave, false);

  const state = sampleState('autosave_proof');
  const created = await api('POST', '/layers/live_touch/presets', { name: 'Warm Wash', state });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const entry = created.data.entry;
  assert.equal(entry.name, 'Warm Wash');
  assert.ok(typeof entry.id === 'string' && entry.id.length > 0);
  assert.ok(typeof entry.capturedAt === 'string' && entry.capturedAt.length > 0);
  assert.deepEqual(entry.state, state, 'state must round-trip verbatim (opaque blob)');

  // Direct disk read — proves the write bypassed saveAllState/autoSave entirely.
  let onDisk = readStoreOnDisk();
  assert.ok(onDisk, 'live_touch_presets.yaml must exist on disk after a create, autoSave OFF notwithstanding');
  assert.equal(onDisk.schemaVersion, 1);
  assert.equal(onDisk.entries.length, 1);
  assert.equal(onDisk.entries[0].name, 'Warm Wash');
  assert.deepEqual(onDisk.entries[0].state, state);

  const renamed = await api('PATCH', `/layers/live_touch/presets/${encodeURIComponent(entry.id)}`, { name: 'Golden Wash' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.entry.name, 'Golden Wash');
  onDisk = readStoreOnDisk();
  assert.equal(onDisk.entries[0].name, 'Golden Wash', 'rename must hit disk immediately, autoSave OFF');

  const deleted = await api('DELETE', `/layers/live_touch/presets/${encodeURIComponent(entry.id)}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  onDisk = readStoreOnDisk();
  assert.deepEqual(onDisk.entries, [], 'delete must hit disk immediately, autoSave OFF');

  // autoSave itself must still read OFF — none of this flipped the toggle.
  const settings = await api('GET', '/settings');
  assert.equal(settings.data.autoSave, false);
});

// ── 3. Corrupt store fails loudly — never a silent empty list ───────────

test('a corrupt store file 400s loudly instead of silently reporting an empty list', async () => {
  // Precondition: the store exists (previous test left an empty-but-valid
  // file) and reads clean.
  const before1 = await api('GET', '/layers/live_touch/presets');
  assert.equal(before1.status, 200);

  // Tab-indentation is invalid YAML — guaranteed parse failure.
  fs.writeFileSync(STORE_FILE(), 'schemaVersion: 1\nentries:\n\t- bad\n', 'utf8');

  const r = await api('GET', '/layers/live_touch/presets');
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'LIVE_TOUCH_PRESET_STORE_MALFORMED');
  assert.notDeepEqual(r.data.entries, [], 'a corrupt store must never masquerade as an empty list');

  // Clean slate for the tests that follow: delete the corrupt file so the
  // scene reverts to the "never saved a preset" benign-empty state.
  fs.unlinkSync(STORE_FILE());
  const after1 = await api('GET', '/layers/live_touch/presets');
  assert.equal(after1.status, 200);
  assert.deepEqual(after1.data.entries, []);
});

// ── 4. Two-client WS: create/rename/reorder/delete all broadcast ────────

test('preset mutations obey the active Live Touch lease owner while armed', async () => {
  const ownerId = 'preset_document_owner';
  const ws = await openWs();
  try {
    const hello = waitForControlMessage(
      ws,
      message => message.type === 'touchControlHelloAck' && message.ownerId === ownerId,
    );
    ws.send(JSON.stringify({ type: 'touchControlHello', ownerId }));
    await hello;

    const armed = waitForControlMessage(
      ws,
      message => message.type === 'touchControlArmedAck'
        && message.ownerId === ownerId
        && message.armed === true,
    );
    ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId, armed: true }));
    await armed;

    const beforeRejectedWrites = readStoreOnDisk();

    const unowned = await api('POST', '/layers/live_touch/presets', {
      name: 'Lease-neutral document',
      state: sampleState('lease_neutral'),
    });
    assert.equal(unowned.status, 423, JSON.stringify(unowned.data));
    assert.equal(unowned.data.code, 'TOUCH_CONTROL_LEASE_HELD');
    assert.deepEqual(readStoreOnDisk(), beforeRejectedWrites,
      'an unowned preset mutation must not alter the persisted document');

    const staleOwner = await api('POST', '/layers/live_touch/presets', {
      name: 'Stale owner document',
      state: sampleState('stale_owner'),
    }, { 'X-Touch-Control-Owner': 'not_the_active_owner' });
    assert.equal(staleOwner.status, 409, JSON.stringify(staleOwner.data));
    assert.equal(staleOwner.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');
    assert.deepEqual(readStoreOnDisk(), beforeRejectedWrites,
      'a stale owner preset mutation must not alter the persisted document');

    const ownerHeaders = { 'X-Touch-Control-Owner': ownerId };
    const created = await api('POST', '/layers/live_touch/presets', {
      name: 'Owner document',
      state: sampleState('owner_document'),
    }, ownerHeaders);
    assert.equal(created.status, 200, JSON.stringify(created.data));

    const entryId = created.data.entry.id;
    const renamed = await api(
      'PATCH',
      `/layers/live_touch/presets/${encodeURIComponent(entryId)}`,
      { name: 'Owner document renamed' },
      ownerHeaders,
    );
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));

    const removed = await api(
      'DELETE',
      `/layers/live_touch/presets/${encodeURIComponent(entryId)}`,
      undefined,
      ownerHeaders,
    );
    assert.equal(removed.status, 200, JSON.stringify(removed.data));

    const disarmed = waitForControlMessage(
      ws,
      message => message.type === 'touchControlArmedAck'
        && message.ownerId === ownerId
        && message.armed === false,
    );
    ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId, armed: false }));
    await disarmed;
  } finally {
    ws.close();
  }
});

test('a second WS client observes create/rename/reorder/delete broadcasts', async () => {
  const wsA = await openWs();
  const wsB = await openWs();
  try {
    const stateP1 = sampleState('p1');
    const stateP2 = sampleState('p2');

    const [bcA1, bcB1, created1] = await Promise.all([
      waitForPresetAction(wsA, 'created'),
      waitForPresetAction(wsB, 'created'),
      api('POST', '/layers/live_touch/presets', { name: 'Preset One', state: stateP1 }),
    ]);
    assert.equal(created1.status, 200, JSON.stringify(created1.data));
    const id1 = created1.data.entry.id;
    assert.equal(bcA1.id, id1);
    assert.equal(bcB1.id, id1);
    assert.equal(bcA1.entries.length, 1);
    assert.equal(bcB1.entries.length, 1);

    const [bcA2, bcB2, created2] = await Promise.all([
      waitForPresetAction(wsA, 'created'),
      waitForPresetAction(wsB, 'created'),
      api('POST', '/layers/live_touch/presets', { name: 'Preset Two', state: stateP2 }),
    ]);
    assert.equal(created2.status, 200, JSON.stringify(created2.data));
    const id2 = created2.data.entry.id;
    assert.equal(bcA2.entries.length, 2);
    assert.equal(bcB2.entries.length, 2);

    const [bcA3, bcB3, renamed] = await Promise.all([
      waitForPresetAction(wsA, 'renamed'),
      waitForPresetAction(wsB, 'renamed'),
      api('PATCH', `/layers/live_touch/presets/${encodeURIComponent(id1)}`, { name: 'Preset One Renamed' }),
    ]);
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.equal(bcA3.id, id1);
    assert.equal(bcB3.id, id1);
    const renamedInA = bcA3.entries.find(e => e.id === id1);
    assert.equal(renamedInA.name, 'Preset One Renamed');

    const [bcA4, bcB4, reordered] = await Promise.all([
      waitForPresetAction(wsA, 'reordered'),
      waitForPresetAction(wsB, 'reordered'),
      api('POST', '/layers/live_touch/presets/reorder', { order: [id2, id1] }),
    ]);
    assert.equal(reordered.status, 200, JSON.stringify(reordered.data));
    assert.deepEqual(bcA4.entries.map(e => e.id), [id2, id1]);
    assert.deepEqual(bcB4.entries.map(e => e.id), [id2, id1]);

    const [bcA5, bcB5, deleted] = await Promise.all([
      waitForPresetAction(wsA, 'deleted'),
      waitForPresetAction(wsB, 'deleted'),
      api('DELETE', `/layers/live_touch/presets/${encodeURIComponent(id1)}`),
    ]);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(bcA5.id, id1);
    assert.equal(bcB5.id, id1);
    assert.deepEqual(bcA5.entries.map(e => e.id), [id2]);
    assert.deepEqual(bcB5.entries.map(e => e.id), [id2]);

    // Clean up the surviving preset so later tests start from a known slate.
    const cleanup = await api('DELETE', `/layers/live_touch/presets/${encodeURIComponent(id2)}`);
    assert.equal(cleanup.status, 200);
  } finally {
    wsA.close();
    wsB.close();
  }
});

// ── 5. Reorder with an unknown id is rejected loudly, store unchanged ───

test('reorder with an unknown preset id 400s and leaves the store untouched', async () => {
  const a = await api('POST', '/layers/live_touch/presets', { name: 'Order A', state: sampleState('order_a') });
  const b = await api('POST', '/layers/live_touch/presets', { name: 'Order B', state: sampleState('order_b') });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const idA = a.data.entry.id;
  const idB = b.data.entry.id;

  const before2 = await api('GET', '/layers/live_touch/presets');
  assert.equal(before2.status, 200);
  const beforeIds = before2.data.entries.map(e => e.id);

  const bad = await api('POST', '/layers/live_touch/presets/reorder', { order: [idA, 'ltp_does_not_exist'] });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
  assert.equal(bad.data.code, 'LIVE_TOUCH_PRESET_INVALID');
  assert.match(bad.data.error, /ltp_does_not_exist/);

  const after2 = await api('GET', '/layers/live_touch/presets');
  assert.equal(after2.status, 200);
  assert.deepEqual(after2.data.entries.map(e => e.id), beforeIds, 'a rejected reorder must not mutate the store');

  // A reorder that OMITS an existing id must also be rejected loudly.
  const partial = await api('POST', '/layers/live_touch/presets/reorder', { order: [idA] });
  assert.equal(partial.status, 400, JSON.stringify(partial.data));
  assert.equal(partial.data.code, 'LIVE_TOUCH_PRESET_INVALID');
  assert.match(partial.data.error, new RegExp(idB));

  const after3 = await api('GET', '/layers/live_touch/presets');
  assert.deepEqual(after3.data.entries.map(e => e.id), beforeIds, 'a partial reorder must not mutate the store either');

  // Clean up.
  await api('DELETE', `/layers/live_touch/presets/${encodeURIComponent(idA)}`);
  await api('DELETE', `/layers/live_touch/presets/${encodeURIComponent(idB)}`);
});

// ── 6. Engine-restart round trip — the headline W4 acceptance ───────────
// (Runs last: it kills and re-spawns the engine process.)

test('a preset survives an engine restart and replays on connect, verbatim', async () => {
  const preRestart = await api('GET', '/layers/live_touch/presets');
  assert.deepEqual(preRestart.data.entries, [], 'precondition: clean slate before the restart proof');

  const state = sampleState('restart_proof');
  const created = await api('POST', '/layers/live_touch/presets', { name: 'Survives Restart', state });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const entry = created.data.entry;

  // Kill and re-spawn on the SAME harness (same port, same MARSIN_STATE_DIR
  // temp root) — mirrors the restart pattern used elsewhere in this suite
  // family (tests/playlist/playlist_api.test.js's "persists across engine
  // restart" test).
  h.proc.kill('SIGTERM');
  await new Promise(res => setTimeout(res, 1000));
  h.spawnEngine();
  await h.waitForReady();

  // REST surface round-trips the exact entry.
  const afterRestart = await api('GET', '/layers/live_touch/presets');
  assert.equal(afterRestart.status, 200, JSON.stringify(afterRestart.data));
  assert.equal(afterRestart.data.entries.length, 1);
  const survived = afterRestart.data.entries[0];
  assert.equal(survived.id, entry.id);
  assert.equal(survived.name, entry.name);
  assert.equal(survived.capturedAt, entry.capturedAt);
  assert.deepEqual(survived.state, state, 'the opaque state blob must survive the restart verbatim');

  // A freshly connected pad must also see it via the connect-replay frame —
  // proving liveTouchPresets is wired into BOTH the routing table
  // (ws_topic_routing.js) and the /ws/control connect handshake, not just
  // the REST surface.
  const ws = await openWs();
  try {
    const replay = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no liveTouchPresets replay frame on connect')), 4000);
      ws.on('message', (buf) => {
        let m; try { m = JSON.parse(buf.toString()); } catch { return; }
        if (m.type === 'liveTouchPresets') { clearTimeout(timer); resolve(m); }
      });
    });
    assert.equal(replay.entries.length, 1);
    assert.equal(replay.entries[0].id, entry.id);
    assert.deepEqual(replay.entries[0].state, state);
  } finally {
    ws.close();
  }
});

test('the restarted engine never wrote into the tracked states/ tree', () => {
  const tracked = path.join(h.engineDir, 'states', SCENE);
  if (!fs.existsSync(tracked)) return; // nothing to protect
  for (const f of fs.readdirSync(tracked, { recursive: true })) {
    const p = path.join(tracked, String(f));
    if (fs.statSync(p).isFile()) {
      assert.ok(!p.includes('live_touch_presets'), `spawned engine wrote a preset store into the tracked tree: ${p}`);
    }
  }
});
