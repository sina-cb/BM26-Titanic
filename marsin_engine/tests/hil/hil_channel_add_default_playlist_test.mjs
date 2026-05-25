/**
 * hil_channel_add_default_playlist_test.mjs — mimic the iPad's "+ default"
 * and "+ from playlist" buttons end-to-end and verify the engine's
 * synchronous-handoff contract that the CaptainPad PlaylistPanel depends
 * on for instant-render of a brand-new channel's entry list.
 *
 * Operator-reported bug (May 2026 — slot 2 channel_add_default_load):
 *   "When I click + default, it adds the channel fast, but then I have
 *    to go to the playlist selection dropdown, and select the default
 *    otherwise the patterns won't show. Same for the + from playlist."
 *
 * Engine-side contract (this test pins it down):
 *
 *   1. POST /mixer/channels with {playlist: <name>} returns 200 and
 *      includes a non-null `playlistData` in the response body. The
 *      `playlistData` MUST contain the same `entries[]` the iPad's
 *      PlaylistPanel renders from — the iPad reads this synchronously
 *      and stashes it keyed by `channelId` so the new PlaylistPanel's
 *      first paint already has the entry list (no follow-up GET).
 *
 *   2. The engine emits a `channelPlaylistData` WS event BEFORE the
 *      matching `mixer` WS event that announces the new channel. The
 *      event MUST land within 500 ms of the POST and MUST carry
 *      `assignment.name === <playlist>`.
 *
 *   3. Same contract holds for BOTH the "+ default" flow
 *      (playlist:'default') AND the "+ from playlist" flow
 *      (playlist:<some-non-default-name>).
 *
 * The CaptainPad-side hook-up is verified by code inspection (the
 * `initialPlaylist` prop + the `useEffect([initialPlaylist])` in
 * `CaptainPad/components/PlaylistPanel.tsx`, and the
 * `inlinePlaylistRef` Map in `CaptainPad/app/(tabs)/mixer.tsx`).
 *
 * ── How to Run ───────────────────────────────────────────────────────
 *   Terminal 1 (slot 2 engine):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     MARSIN_HIL_PORT=31268 node tests/hil/hil_channel_add_default_playlist_test.mjs
 *
 * Set MARSIN_HIL_PORT=<port> if your engine isn't on the default 6968.
 */

import http from 'http';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.MARSIN_HIL_PORT || 6968;
const ENGINE_BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;

function httpJson(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, ENGINE_BASE);
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

// ── State file snapshot (per 13_multi_agent.md §6.5) ────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ENGINE_ROOT, 'states', 'test_bench');
const STATE_FILES = ['deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml'];
const snapshot = {};
for (const f of STATE_FILES) {
  const p = path.join(STATE_DIR, f);
  try { snapshot[f] = fs.readFileSync(p, 'utf8'); } catch (_) { snapshot[f] = null; }
}

const cleanup = { snapshot: null, done: false, addedIds: [] };
async function deleteAllOverlays() {
  const m = (await httpJson('GET', '/mixer')).body;
  for (const c of (m.channels || [])) {
    if (c.id !== m.baseChannelId) await httpJson('DELETE', `/mixer/channels/${c.id}`);
  }
}
async function restore() {
  if (cleanup.done) return;
  cleanup.done = true;
  console.log('\n── Cleanup ──');
  try {
    for (const id of cleanup.addedIds) {
      try { await httpJson('DELETE', `/mixer/channels/${id}`); } catch (_) {}
    }
    await deleteAllOverlays();
    for (const c of (cleanup.snapshot?.channels || [])) {
      if (c.id === cleanup.snapshot.baseChannelId) continue;
      try {
        await httpJson('POST', '/mixer/channels', {
          playlist: c.playlist?.name || 'default',
          playlistEntryId: c.playlist?.activeEntryId,
          name: c.name, mode: c.mode, fader: c.fader,
        });
      } catch (_) {}
    }
    for (const f of STATE_FILES) {
      if (snapshot[f] == null) continue;
      try { fs.writeFileSync(path.join(STATE_DIR, f), snapshot[f]); } catch (_) {}
    }
    console.log(`  restored ${STATE_FILES.length} state file snapshot(s)`);
  } catch (e) { console.warn('  cleanup warn:', e.message); }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => { try { await restore(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); } });
}

// Wait for a `channelPlaylistData` event matching predicate, with timeout.
function waitForChannelPlaylistData(events, predicate, timeoutMs = 500) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const tick = () => {
      const found = events.find(e => e.type === 'channelPlaylistData' && predicate(e));
      if (found) return resolve(found);
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(tick, 10);
    };
    tick();
  });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_channel_add_default_playlist_test.mjs');
  console.log('iPad-UI-mimic for + default and + from playlist');
  console.log(`engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  cleanup.snapshot = (await httpJson('GET', '/mixer')).body;
  if ((cleanup.snapshot.maxChannels || 0) < 2) {
    fail(`engine maxChannels=${cleanup.snapshot.maxChannels} < 2 — cannot test two adds`);
    await restore();
    process.exit(1);
  }
  console.log(`\n── Setup ──`);
  console.log(`  initial: ${cleanup.snapshot.channels.length} channel(s), base=${cleanup.snapshot.baseChannelId}, max=${cleanup.snapshot.maxChannels}`);
  await deleteAllOverlays();
  await sleep(150);

  // Discover a non-default playlist with at least one usable entry. This
  // proves the "+ from playlist" flow with a real non-default name.
  const lists = (await httpJson('GET', '/playlists')).body || [];
  let nonDefaultName = null;
  for (const n of lists) {
    if (n === 'default') continue;
    const pl = (await httpJson('GET', `/playlists/${encodeURIComponent(n)}`)).body;
    if (pl && Array.isArray(pl.entries) && pl.entries.length > 0) {
      nonDefaultName = n;
      break;
    }
  }
  if (!nonDefaultName) {
    console.log('  no non-default playlist with entries found — skipping "+ from playlist" path');
  } else {
    console.log(`  will use "${nonDefaultName}" for + from playlist`);
  }

  // ── WS subscriber, BEFORE the POST per the brief ──────────────────
  const ws = await openWs();
  const events = [];
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'mixer') {
        events.push({ t: Date.now(), type: 'mixer', channelIds: (m.channels || []).map(c => c.id) });
      } else if (m.type === 'channelPlaylistData') {
        events.push({
          t: Date.now(), type: 'channelPlaylistData',
          channelId: m.channelId,
          assignmentName: m.playlist?.name,
          playlistName: m.playlistData?.name,
          entriesCount: m.playlistData?.entries?.length || 0,
        });
      }
    } catch (_) {}
  });
  await sleep(120);
  events.length = 0;

  // ── TEST 1: "+ default" payload ────────────────────────────────────
  console.log('\n[TEST 1] "+ default" flow (POST playlist:"default")');
  const t1 = Date.now();
  const r1 = await httpJson('POST', '/mixer/channels', {
    playlist: 'default',
    name: 'New Layer',
    mode: 'blend_screen',
    fader: 1.0,
  });
  if (r1.status === 200 && r1.body?.channelId) cleanup.addedIds.push(r1.body.channelId);
  check(r1.status === 200, '+ default: POST returns 200', `+ default: POST returned ${r1.status}`, JSON.stringify(r1.body).slice(0, 200));
  check(
    !!(r1.body && r1.body.playlistData && r1.body.playlistData.name === 'default'),
    '+ default: response carries playlistData with name="default"',
    '+ default: response missing playlistData or wrong name',
    `playlistData=${JSON.stringify(r1.body?.playlistData).slice(0, 120)}`,
  );
  check(
    Array.isArray(r1.body?.playlistData?.entries) && r1.body.playlistData.entries.length > 0,
    '+ default: response playlistData.entries is non-empty',
    '+ default: response playlistData.entries is empty or missing',
  );
  check(
    !!(r1.body?.playlist && r1.body.playlist.name === 'default'),
    '+ default: response carries assignment.playlist with name="default"',
    '+ default: response assignment missing or wrong name',
  );
  const cpd1 = await waitForChannelPlaylistData(events, e => e.channelId === r1.body.channelId, 500);
  check(
    !!cpd1,
    '+ default: channelPlaylistData WS event arrives within 500 ms',
    '+ default: no channelPlaylistData WS event within 500 ms',
  );
  check(
    cpd1 && cpd1.assignmentName === 'default',
    '+ default: WS event carries assignment.name="default"',
    `+ default: WS assignment.name=${cpd1?.assignmentName}`,
  );
  check(
    cpd1 && cpd1.playlistName === 'default' && cpd1.entriesCount > 0,
    '+ default: WS event carries playlistData with name="default" and entries[]',
    `+ default: WS playlistName=${cpd1?.playlistName}, entries=${cpd1?.entriesCount}`,
  );
  // Ordering: WS event lands before or at the same ms as the mixer
  // broadcast that announces this channel. This is the synchronous-
  // handoff contract the iPad's inlinePlaylistRef + PlaylistPanel
  // depend on.
  const mxr1 = events.find(e => e.type === 'mixer' && e.channelIds.includes(r1.body.channelId));
  check(
    cpd1 && mxr1 && cpd1.t <= mxr1.t,
    '+ default: WS channelPlaylistData lands BEFORE matching mixer broadcast',
    `+ default: ordering wrong — cpd@${cpd1?.t} vs mixer@${mxr1?.t}`,
  );
  // Latency from POST to channelPlaylistData. The brief asks for
  // <500 ms time-to-patterns. The iPad reads from the POST response
  // synchronously and the WS event seeds the cache redundantly; the
  // WS arrival is a strict ceiling for end-to-end latency here.
  check(
    cpd1 && (cpd1.t - t1) < 500,
    `+ default: channelPlaylistData latency ${cpd1?.t ? cpd1.t - t1 : '?'} ms < 500 ms`,
    `+ default: channelPlaylistData latency ${cpd1?.t ? cpd1.t - t1 : '?'} ms >= 500 ms`,
  );

  // ── TEST 2: "+ from playlist" payload ──────────────────────────────
  if (nonDefaultName) {
    console.log(`\n[TEST 2] "+ from playlist" flow (POST playlist:"${nonDefaultName}")`);
    events.length = 0;
    const t2 = Date.now();
    const r2 = await httpJson('POST', '/mixer/channels', {
      playlist: nonDefaultName,
      name: nonDefaultName,
      mode: 'blend_screen',
      fader: 1.0,
    });
    if (r2.status === 200 && r2.body?.channelId) cleanup.addedIds.push(r2.body.channelId);
    check(r2.status === 200, '+ playlist: POST returns 200', `+ playlist: POST returned ${r2.status}`, JSON.stringify(r2.body).slice(0, 200));
    check(
      !!(r2.body && r2.body.playlistData && r2.body.playlistData.name === nonDefaultName),
      `+ playlist: response carries playlistData with name="${nonDefaultName}"`,
      `+ playlist: response missing playlistData or wrong name`,
      `playlistData=${JSON.stringify(r2.body?.playlistData).slice(0, 120)}`,
    );
    check(
      Array.isArray(r2.body?.playlistData?.entries) && r2.body.playlistData.entries.length > 0,
      `+ playlist: response playlistData.entries is non-empty`,
      `+ playlist: response playlistData.entries is empty or missing`,
    );
    check(
      !!(r2.body?.playlist && r2.body.playlist.name === nonDefaultName),
      `+ playlist: response carries assignment.playlist with name="${nonDefaultName}"`,
      `+ playlist: response assignment missing or wrong name`,
    );
    const cpd2 = await waitForChannelPlaylistData(
      events,
      e => e.channelId === r2.body.channelId,
      500,
    );
    check(
      !!cpd2,
      '+ playlist: channelPlaylistData WS event arrives within 500 ms',
      '+ playlist: no channelPlaylistData WS event within 500 ms',
    );
    check(
      cpd2 && cpd2.assignmentName === nonDefaultName,
      `+ playlist: WS event carries assignment.name="${nonDefaultName}"`,
      `+ playlist: WS assignment.name=${cpd2?.assignmentName}`,
    );
    check(
      cpd2 && cpd2.playlistName === nonDefaultName && cpd2.entriesCount > 0,
      `+ playlist: WS event carries playlistData with name="${nonDefaultName}" and entries[]`,
      `+ playlist: WS playlistName=${cpd2?.playlistName}, entries=${cpd2?.entriesCount}`,
    );
    const mxr2 = events.find(e => e.type === 'mixer' && e.channelIds.includes(r2.body.channelId));
    check(
      cpd2 && mxr2 && cpd2.t <= mxr2.t,
      '+ playlist: WS channelPlaylistData lands BEFORE matching mixer broadcast',
      `+ playlist: ordering wrong — cpd@${cpd2?.t} vs mixer@${mxr2?.t}`,
    );
    check(
      cpd2 && (cpd2.t - t2) < 500,
      `+ playlist: channelPlaylistData latency ${cpd2?.t ? cpd2.t - t2 : '?'} ms < 500 ms`,
      `+ playlist: channelPlaylistData latency ${cpd2?.t ? cpd2.t - t2 : '?'} ms >= 500 ms`,
    );
  }

  // ── TEST 3: GET /mixer/channels/:id/playlist for each added channel ──
  console.log('\n[TEST 3] GET /mixer/channels/:id/playlist round-trips the assignment');
  for (const id of cleanup.addedIds) {
    const r = await httpJson('GET', `/mixer/channels/${id}/playlist`);
    check(
      r.status === 200 && r.body && typeof r.body.name === 'string' && r.body.name.length > 0,
      `GET /mixer/channels/${id.slice(-6)}/playlist returns a non-empty assignment`,
      `GET /mixer/channels/${id.slice(-6)}/playlist returned ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`,
    );
  }

  ws.close();
  await restore();
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  process.exit(passed === total ? 0 : 1);
})().catch(async (e) => {
  console.error('test crashed:', e);
  try { await restore(); } catch (_) {}
  process.exit(1);
});
