/**
 * hil_deck_playlist_load_test.mjs — HIL test for the deck PlaylistPanel
 * load path after slot 6 channel_isolation (May 2026).
 *
 * The user reported: "in the deck, the playlist is not loading and it
 * says failed to load".
 *
 * Root cause: slot 6 (channel_isolation) split the deck channel out of
 * `mixer.channels[]` into its own slot, and the engine's mixer routes
 * (`/mixer/channels/:id/*`) now reject the deck channel's id with HTTP
 * 400 `WRONG_ROLE`. The PlaylistPanel UI was still hitting
 * `/mixer/channels/<deck_id>/playlist` for the deck, so the GET failed,
 * `refresh()` retried forever, and the panel showed "failed to load".
 *
 * The fix:
 *   - PlaylistPanel now takes a `role: 'deck' | 'mixer'` prop and the
 *     deck tab passes 'deck'.
 *   - Polymorphic helpers in CaptainPad/utils/api.ts dispatch to
 *     /deck/playlist* vs /mixer/channels/:id/playlist*.
 *
 * This HIL test guards both contracts on the engine side, so a future
 * change to the route shape (or another schema split) shows up here
 * BEFORE it reaches the iPad:
 *
 *   - GET /deck/playlist                     → 200, returns assignment.
 *   - POST /deck/playlist {name}             → 200, sets the assignment.
 *   - POST /deck/playlist/entry {entryId}    → 200 (or 409 EBUSY mid-trans).
 *   - GET /mixer/channels/<deckId>/playlist  → 400 WRONG_ROLE.
 *   - POST /mixer/channels/<deckId>/playlist → 400 WRONG_ROLE.
 *   - WS `deck` event fires with the updated channel.playlist after a
 *     /deck/playlist POST (this is what PlaylistPanel uses to refresh
 *     cross-tab and on autopilot ticks).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31168
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31168 node tests/hil/hil_deck_playlist_load_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine unreachable, test playlist not creatable)
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}`;

const WS_EVENT_TIMEOUT_MS = 800;

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function subscribe(ws) {
  const events = [];
  const onMessage = (raw) => {
    let o; try { o = JSON.parse(raw); } catch { return; }
    events.push({ t: Date.now(), msg: o });
  };
  ws.on('message', onMessage);
  return { events, stop: () => ws.off('message', onMessage) };
}

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel);
  else fail(failLabel || passLabel, failDetail);
}

// ─────────────────────────── cleanup ────────────────────────────────
// Snapshot the deck's prior playlist assignment + autopilot so we can
// restore it; nuke our throwaway playlist regardless of test outcome.
const cleanupState = {
  started: false,
  done: false,
  snapshotDeckAssignment: null,
  snapshotAutopilot: null,
  testPlaylist: 'hil_deck_load_test',
  createdPlaylist: false,
};

async function restoreState() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    // Re-point the deck at whatever it was on before we ran. POSTing the
    // original name reloads the saved entry; POSTing null detaches the
    // playlist entirely (matches a fresh-boot state).
    const prev = cleanupState.snapshotDeckAssignment;
    if (prev && prev.name) {
      await httpJson('POST', '/deck/playlist', { name: prev.name });
      if (prev.activeEntryId) {
        try { await httpJson('POST', '/deck/playlist/entry', { entryId: prev.activeEntryId }); } catch {}
      }
      console.log(`  restored deck playlist: ${prev.name} entry=${prev.activeEntryId || '(none)'}`);
    } else {
      await httpJson('POST', '/deck/playlist', { name: null });
      console.log('  restored deck playlist: <none>');
    }
    if (cleanupState.snapshotAutopilot) {
      await httpJson('POST', '/deck/playlist/autopilot', cleanupState.snapshotAutopilot);
    }
    if (cleanupState.createdPlaylist) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(cleanupState.testPlaylist)}`);
        console.log(`  deleted test playlist: ${cleanupState.testPlaylist}`);
      } catch (e) {
        console.warn(`  could not delete ${cleanupState.testPlaylist}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  restore failed: ${e.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.error(`\nReceived ${sig}; restoring deck state...`);
    try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
  });
}

// ─────────────────────────── main ──────────────────────────────────
(async function main() {
  console.log('==========================================================');
  console.log('hil_deck_playlist_load_test.mjs — deck/mixer role-isolation');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  cleanupState.started = true;

  // 1. Snapshot deck-channel current state via the dedicated /deck endpoint.
  //    GET /deck/channel returns `{ master, blackout, channel: { id, ..., playlist } }`.
  let deckResp;
  try {
    deckResp = (await httpJson('GET', '/deck/channel')).body;
  } catch (e) {
    console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
    process.exit(2);
  }
  const deckChannel = deckResp && deckResp.channel;
  if (!deckChannel || !deckChannel.id) {
    console.error('  FATAL: GET /deck/channel returned no channel');
    console.error('  body=' + JSON.stringify(deckResp).slice(0, 300));
    process.exit(2);
  }
  const deckId = deckChannel.id;
  cleanupState.snapshotDeckAssignment = deckChannel.playlist ? JSON.parse(JSON.stringify(deckChannel.playlist)) : null;
  cleanupState.snapshotAutopilot = deckChannel.playlist && deckChannel.playlist.autopilot
    ? JSON.parse(JSON.stringify(deckChannel.playlist.autopilot))
    : null;
  console.log(`  deck channel id: ${deckId}`);
  console.log(`  initial playlist: ${cleanupState.snapshotDeckAssignment ? cleanupState.snapshotDeckAssignment.name : '(none)'}`);

  // 2. Create a throwaway test playlist with two entries. test_const is
  //    the lightest pattern the engine ships, so this stays cheap.
  const testEntries = [
    { id: 'e_hil_deck_load_0', pattern: 'test_const', label: 'Alpha', defaults: {} },
    { id: 'e_hil_deck_load_1', pattern: 'test_const', label: 'Bravo', defaults: {} },
  ];
  const createRes = await httpJson('POST', '/playlists', {
    name: cleanupState.testPlaylist,
    entries: testEntries,
  });
  if (createRes.status !== 200) {
    console.error(`  FATAL: could not create test playlist: status=${createRes.status}`);
    console.error('  body=' + JSON.stringify(createRes.body).slice(0, 300));
    process.exit(2);
  }
  cleanupState.createdPlaylist = true;
  console.log(`  created test playlist: ${cleanupState.testPlaylist}`);

  const ws = await openWs();
  const sub = subscribe(ws);

  // ── TEST 1: GET /deck/playlist returns 200 + null-or-assignment ───
  console.log('\n[TEST 1] GET /deck/playlist returns 200');
  {
    const r = await httpJson('GET', '/deck/playlist');
    check(
      r.status === 200,
      `GET /deck/playlist → 200 (got ${r.status})`,
      `GET /deck/playlist did not return 200`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    // body may be null (no playlist loaded) — that's a valid shape.
    check(
      r.body === null || (typeof r.body === 'object' && 'name' in r.body),
      `body is null or an assignment object`,
      `body shape unexpected`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }

  // ── TEST 2: GET /mixer/channels/<deckId>/playlist rejects WRONG_ROLE
  console.log('\n[TEST 2] GET /mixer/channels/<deckId>/playlist returns 400 WRONG_ROLE');
  // This is the assertion that *prevents the regression*. If this ever
  // starts returning 200, the engine has lost its role guard and the
  // iPad will appear to work even when wired wrong.
  {
    const r = await httpJson('GET', `/mixer/channels/${encodeURIComponent(deckId)}/playlist`);
    check(
      r.status === 400,
      `status === 400 (got ${r.status})`,
      `expected 400 WRONG_ROLE on mixer route for deck id`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    check(
      r.body && r.body.code === 'WRONG_ROLE',
      `body.code === 'WRONG_ROLE'`,
      `body.code !== 'WRONG_ROLE'`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    check(
      r.body && r.body.useInstead === '/deck/channel',
      `body.useInstead === '/deck/channel' (operator hint preserved)`,
      `useInstead hint missing`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }

  // ── TEST 3: POST /deck/playlist sets the assignment ──────────────
  console.log('\n[TEST 3] POST /deck/playlist loads our test playlist');
  sub.events.length = 0;
  {
    const r = await httpJson('POST', '/deck/playlist', { name: cleanupState.testPlaylist });
    check(
      r.status === 200,
      `POST /deck/playlist → 200`,
      `POST /deck/playlist did not return 200`,
      `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    check(
      r.body && r.body.status === 'ok',
      `body.status === 'ok'`,
      `body.status !== 'ok'`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    check(
      r.body && r.body.playlist && r.body.playlist.name === cleanupState.testPlaylist,
      `body.playlist.name === '${cleanupState.testPlaylist}'`,
      `body.playlist did not reflect the load`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    // Default activeEntryId picks the first entry per the engine's contract.
    check(
      r.body && r.body.playlist && r.body.playlist.activeEntryId === testEntries[0].id,
      `body.playlist.activeEntryId === '${testEntries[0].id}' (first entry)`,
      `first entry not auto-selected`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }

  // ── TEST 4: WS `deck` event fires with the new assignment ────────
  console.log('\n[TEST 4] WS `deck` event broadcasts the new assignment');
  await sleep(WS_EVENT_TIMEOUT_MS);
  {
    const deckEvents = sub.events
      .filter(e => e.msg.type === 'deck')
      .map(e => e.msg);
    check(
      deckEvents.length > 0,
      `received ${deckEvents.length} deck event(s)`,
      `no deck WS event after POST /deck/playlist`,
    );
    const latest = deckEvents[deckEvents.length - 1];
    check(
      latest && latest.channel && latest.channel.id === deckId,
      `latest deck event has channel.id === '${deckId}'`,
      `deck event channel id mismatch`,
      `latest=${JSON.stringify(latest).slice(0, 200)}`,
    );
    check(
      latest && latest.channel && latest.channel.playlist
        && latest.channel.playlist.name === cleanupState.testPlaylist,
      `latest deck event has channel.playlist.name === '${cleanupState.testPlaylist}'`,
      `deck event did not carry the new playlist`,
      `latest=${JSON.stringify(latest && latest.channel && latest.channel.playlist).slice(0, 200)}`,
    );
  }

  // ── TEST 5: GET /deck/playlist now returns the loaded playlist ───
  console.log('\n[TEST 5] GET /deck/playlist round-trip reflects the load');
  {
    const r = await httpJson('GET', '/deck/playlist');
    check(
      r.status === 200,
      `GET /deck/playlist → 200`,
      `GET /deck/playlist did not return 200`,
    );
    check(
      r.body && r.body.name === cleanupState.testPlaylist,
      `GET assignment.name === '${cleanupState.testPlaylist}'`,
      `GET did not reflect the prior POST`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }

  // ── TEST 6: POST /deck/playlist/entry switches the active entry ──
  console.log('\n[TEST 6] POST /deck/playlist/entry switches the active entry');
  sub.events.length = 0;
  {
    const r = await httpJson('POST', '/deck/playlist/entry', { entryId: testEntries[1].id });
    // 200 is the happy path; 409 EBUSY can happen if a soft transition is
    // already in flight on a freshly-loaded playlist, in which case the
    // engine queues silently and we just verify the rejection shape.
    const okStatus = r.status === 200 || r.status === 409;
    check(
      okStatus,
      `POST /deck/playlist/entry → ${r.status} (200 or 409)`,
      `POST /deck/playlist/entry returned unexpected status`,
      `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    if (r.status === 200) {
      check(
        r.body && r.body.playlist && r.body.playlist.activeEntryId === testEntries[1].id,
        `body.playlist.activeEntryId === '${testEntries[1].id}'`,
        `activeEntryId did not advance`,
        `body=${JSON.stringify(r.body).slice(0, 200)}`,
      );
    } else {
      // 409 EBUSY contract per api_server.js POST /deck/playlist/entry.
      check(
        r.body && r.body.code === 'EBUSY',
        `409 carries code='EBUSY'`,
        `409 missing EBUSY marker`,
        `body=${JSON.stringify(r.body).slice(0, 200)}`,
      );
    }
  }

  // ── TEST 7: POST /mixer/channels/<deckId>/playlist also rejects ──
  console.log('\n[TEST 7] POST /mixer/channels/<deckId>/playlist rejects WRONG_ROLE');
  {
    const r = await httpJson('POST', `/mixer/channels/${encodeURIComponent(deckId)}/playlist`, {
      name: cleanupState.testPlaylist,
    });
    check(
      r.status === 400,
      `status === 400 (got ${r.status})`,
      `POST to mixer route for deck id should be 400`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    check(
      r.body && r.body.code === 'WRONG_ROLE',
      `body.code === 'WRONG_ROLE'`,
      `WRONG_ROLE marker missing`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }

  // ── TEST 8: POST /mixer/channels/<deckId>/playlist/entry also rejects
  console.log('\n[TEST 8] POST /mixer/channels/<deckId>/playlist/entry rejects WRONG_ROLE');
  {
    const r = await httpJson('POST', `/mixer/channels/${encodeURIComponent(deckId)}/playlist/entry`, {
      entryId: testEntries[0].id,
    });
    check(
      r.status === 400,
      `status === 400 (got ${r.status})`,
      `POST /entry to mixer route for deck id should be 400`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
    check(
      r.body && r.body.code === 'WRONG_ROLE',
      `body.code === 'WRONG_ROLE'`,
      `WRONG_ROLE marker missing`,
      `body=${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }

  sub.stop();
  ws.close();
  await sleep(50);

  await restoreState();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { await restoreState(); } catch {}
  process.exit(2);
});
