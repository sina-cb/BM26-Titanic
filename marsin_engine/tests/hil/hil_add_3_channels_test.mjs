/**
 * hil_add_3_channels_test.mjs — verify the engine never strands a
 * freshly-added mixer channel without its playlist data.
 *
 * The user-reported bug: "I added 3 layers (channels), and the first
 * two loaded the patterns' list fine, but the 3rd one is not showing
 * patterns." This test pins down the engine-side invariants that the
 * iPad's PlaylistPanel relies on for instant-render of a brand-new
 * channel:
 *
 *  1. Each POST /mixer/channels response carries a non-null
 *     `playlistData` (entries inline) — the iPad's api.ts uses this
 *     to prime its per-name cache so PlaylistPanel doesn't have to
 *     issue a follow-up GET that could race the engine under load.
 *
 *  2. For each add, the engine emits a `channelPlaylistData` WS
 *     event BEFORE the `mixer` WS event that announces the new
 *     channel. This ordering is what lets the global cache-prime
 *     listener in api.ts populate `_playlistCache` BEFORE React
 *     mounts the new PlaylistPanel off the mixer broadcast.
 *
 *  3. GET /mixer/channels/:id/playlist returns the right assignment
 *     for each added channel.
 *
 * ── How to Run ───────────────────────────────────────────────────────
 *   Terminal 1 (this slot's engine):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31068
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     node tests/hil/hil_add_3_channels_test.mjs
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

// ── State file snapshot ─────────────────────────────────────────────
// Per 13_multi_agent.md §6.5: HIL tests must restore any state files
// they touched. Snapshot the three test_bench state files we know the
// engine writes back via saveAllState().
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
  for (const c of m.channels) {
    if (c.id !== m.baseChannelId) await httpJson('DELETE', `/mixer/channels/${c.id}`);
  }
}
async function restore() {
  if (cleanup.done) return;
  cleanup.done = true;
  console.log('\n── Cleanup ──');
  try {
    // Delete any channels we may have added (covers the partial-failure case
    // where the test bailed mid-way).
    for (const id of cleanup.addedIds) {
      try { await httpJson('DELETE', `/mixer/channels/${id}`); } catch (_) {}
    }
    await deleteAllOverlays();
    // Re-add the original overlays from the snapshot so the rig state
    // matches what we found at startup.
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
    console.log(`  restored ${(cleanup.snapshot?.channels?.length || 1) - 1} overlay channel(s)`);
    // Restore state files verbatim — covers any edge where ids drifted.
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

(async function main() {
  console.log('==========================================================');
  console.log('hil_add_3_channels_test.mjs — 3 back-to-back adds');
  console.log(`engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  cleanup.snapshot = (await httpJson('GET', '/mixer')).body;
  console.log(`\n── Setup ──`);
  console.log(`  initial: ${cleanup.snapshot.channels.length} channel(s), base=${cleanup.snapshot.baseChannelId}, max=${cleanup.snapshot.maxChannels}`);
  if ((cleanup.snapshot.maxChannels || 0) < 3) {
    fail(`engine maxChannels=${cleanup.snapshot.maxChannels} < 3 — cannot test 3-channel add`);
    await restore();
    process.exit(1);
  }
  await deleteAllOverlays();
  await sleep(150);

  // ── Open WS and timestamp every relevant event ────────────────────
  const ws = await openWs();
  const events = [];
  let mixerSeq = 0;
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'mixer') {
        events.push({
          t: Date.now(), type: 'mixer',
          mixerSeq: mixerSeq++,
          channelIds: (m.channels || []).map(c => c.id),
        });
      } else if (m.type === 'channelPlaylistData') {
        events.push({
          t: Date.now(), type: 'channelPlaylistData',
          channelId: m.channelId,
          hasPlaylistData: !!(m.playlistData && m.playlistData.name),
          playlistName: m.playlistData?.name,
        });
      }
    } catch (_) {}
  });
  await sleep(150);
  events.length = 0;

  // ── Burst-add 3 channels back-to-back ─────────────────────────────
  console.log('\n[TEST 1] POST /mixer/channels response carries non-null playlistData');
  const adds = [];
  const NAMES_TO_USE = ['default', 'default', 'default'];
  for (let i = 0; i < 3; i++) {
    const r = await httpJson('POST', '/mixer/channels', {
      playlist: NAMES_TO_USE[i],
      name: `hil3_${i}`,
      mode: 'blend_screen',
      fader: 1.0,
    });
    adds.push({ i, status: r.status, body: r.body });
    if (r.status === 200 && r.body?.channelId) cleanup.addedIds.push(r.body.channelId);
    check(
      r.status === 200,
      `add #${i + 1} returned 200`,
      `add #${i + 1} returned ${r.status}`,
      JSON.stringify(r.body).slice(0, 200),
    );
    check(
      r.body && r.body.playlistData && typeof r.body.playlistData === 'object' && r.body.playlistData.name === NAMES_TO_USE[i],
      `add #${i + 1} response includes playlistData for "${NAMES_TO_USE[i]}"`,
      `add #${i + 1} response missing or wrong playlistData`,
      `playlistData=${JSON.stringify(r.body?.playlistData).slice(0, 120)}`,
    );
    check(
      Array.isArray(r.body?.playlistData?.entries) && r.body.playlistData.entries.length > 0,
      `add #${i + 1} playlistData has ≥1 entry`,
      `add #${i + 1} playlistData.entries empty or missing`,
    );
  }

  // Wait for WS events to settle.
  await sleep(400);

  // ── TEST 2: channelPlaylistData fires BEFORE mixer (per channel) ──
  console.log('\n[TEST 2] channelPlaylistData WS event fires BEFORE its matching mixer event');
  for (let i = 0; i < adds.length; i++) {
    const a = adds[i];
    if (!a.body?.channelId) continue;
    const cpd = events.find(e => e.type === 'channelPlaylistData' && e.channelId === a.body.channelId);
    // The matching mixer event is the FIRST one whose channelIds[] includes
    // this channel id — that's the broadcast that announces this add to
    // the client.
    const mxr = events.find(e => e.type === 'mixer' && e.channelIds.includes(a.body.channelId));
    check(
      cpd && cpd.hasPlaylistData,
      `channel ${i + 1}: channelPlaylistData event present with inline playlistData`,
      `channel ${i + 1}: missing channelPlaylistData WS event (or no payload)`,
    );
    check(
      cpd && mxr && cpd.t <= mxr.t,
      `channel ${i + 1}: channelPlaylistData lands BEFORE matching mixer broadcast`,
      `channel ${i + 1}: ordering wrong — cpd@${cpd?.t || '?'} vs mixer@${mxr?.t || '?'}`,
    );
  }

  // ── TEST 3: GET /mixer/channels/:id/playlist returns the assignment ──
  console.log('\n[TEST 3] GET /mixer/channels/:id/playlist returns the right assignment');
  for (let i = 0; i < adds.length; i++) {
    const a = adds[i];
    if (!a.body?.channelId) continue;
    const r = await httpJson('GET', `/mixer/channels/${a.body.channelId}/playlist`);
    check(
      r.status === 200 && r.body && r.body.name === NAMES_TO_USE[i],
      `channel ${i + 1}: GET playlist returns name="${NAMES_TO_USE[i]}"`,
      `channel ${i + 1}: GET playlist returned status=${r.status} body=${JSON.stringify(r.body).slice(0, 120)}`,
    );
  }

  // ── TEST 4: /mixer now reports all 3 channels with playlists ──────
  console.log('\n[TEST 4] /mixer reflects all 3 added channels with playlist assignments');
  const finalMixer = (await httpJson('GET', '/mixer')).body;
  const overlayChannels = (finalMixer.channels || []).filter(c => c.id !== finalMixer.baseChannelId);
  check(
    overlayChannels.length === 3,
    `mixer reports 3 overlay channels`,
    `mixer reports ${overlayChannels.length} overlay channels`,
  );
  for (let i = 0; i < overlayChannels.length; i++) {
    const c = overlayChannels[i];
    check(
      c.playlist && c.playlist.name,
      `channel ${i + 1} (${c.id}) has playlist assignment`,
      `channel ${i + 1} (${c.id}) playlist is null/missing`,
    );
  }

  ws.close();

  // ── Cleanup + summary ─────────────────────────────────────────────
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
