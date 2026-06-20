/**
 * hil_deck_swap_response_test.mjs — HIL Test for FIX B (deck swap response id)
 *
 * Regression guard for the deck soft-swap "UI pinned to OLD entry ~8s" bug.
 *
 * When deck transitions are ENABLED, POST /deck/playlist/swap kicks off a soft
 * crossfade and returns 200 immediately — but `baseCh.playlist.activeEntryId`
 * is still the OLD entry at that moment (the new id is only written in the swap
 * onComplete AFTER the fade). CaptainPad's handleHotSwap used to arm its
 * pending-gate from that stale `playlist.activeEntryId`, so the panel suppressed
 * reconcile until an ~8s watchdog.
 *
 * FIX B: the engine now returns the RESOLVED target entry id as `targetEntryId`
 * in the swap (and /deck/playlist/entry) 200 body, and CaptainPad arms the gate
 * from it. This HIL exercises the transition-ENABLED swap path that the existing
 * deck-swap HIL never covered and asserts:
 *
 *   1. /deck/playlist/swap (transitions ENABLED) → 200 with targetEntryId === the
 *      resolved target entry (the playlist's first usable entry, or an explicit
 *      entryId), and DISTINCT from the stale playlist.activeEntryId mid-fade.
 *   2. /deck/playlist/swap with an explicit entryId → targetEntryId === that id.
 *   3. /deck/playlist/entry (transitions ENABLED) → 200 with targetEntryId ===
 *      the requested entryId.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   ENGINE_BASE=http://127.0.0.1:31268 node tests/hil/hil_deck_swap_response_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed   1 = one or more failed / setup error
 *
 * State hygiene: creates two throwaway playlists (hil_swap_resp_a/_b), restores
 * the deck's original playlist + transition config on exit, and DELETEs both
 * test playlists so states/test_bench/*.yaml is left as found.
 */

import http from 'http';

const PORT = Number(process.env.ENGINE_PORT || 6968);
const ENGINE_BASE = process.env.ENGINE_BASE || `http://127.0.0.1:${PORT}`;
const SETTLE_MS = 250;

function httpFull(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function httpJson(method, path, body = null) {
  const r = await httpFull(method, path, body);
  return r.body;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const results = [];
function check(cond, label, detail) {
  if (cond) console.log('  ✓ PASS  ' + label);
  else console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(!!cond);
}

const cleanupState = {
  done: false,
  savedTxCfg: null,
  savedDeckPlaylistName: null,
  createdPlaylists: [],
};

async function cleanup() {
  if (cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    if (cleanupState.savedDeckPlaylistName) {
      try {
        await httpJson('POST', '/deck/playlist', { name: cleanupState.savedDeckPlaylistName });
        console.log(`  restored deck playlist: ${cleanupState.savedDeckPlaylistName}`);
      } catch (e) { console.warn(`  could not restore deck playlist: ${e.message}`); }
    }
    if (cleanupState.savedTxCfg) {
      try {
        await httpJson('POST', '/deck/transition-config', {
          enabled: cleanupState.savedTxCfg.enabled,
          mode: cleanupState.savedTxCfg.mode,
          durationMs: cleanupState.savedTxCfg.durationMs,
          shuffle: cleanupState.savedTxCfg.shuffle,
        });
        console.log(`  restored deck transition config (enabled=${cleanupState.savedTxCfg.enabled})`);
      } catch (e) { console.warn(`  could not restore transition config: ${e.message}`); }
    }
    for (const name of cleanupState.createdPlaylists) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(name)}`);
        console.log(`  deleted test playlist: ${name}`);
      } catch (e) { console.warn(`  could not delete ${name}: ${e.message}`); }
    }
  } catch (e) {
    console.warn('  cleanup warn:', e.message);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { try { await cleanup(); } finally { process.exit(1); } });
}

(async () => {
  console.log('==========================================================');
  console.log('hil_deck_swap_response_test.mjs — FIX B targetEntryId in swap response');
  console.log('==========================================================');

  // ── Setup ──────────────────────────────────────────────────────────
  // Confirm a deck channel exists.
  const deckResp = await httpJson('GET', '/deck/channel');
  if (!deckResp || !deckResp.channel) {
    console.log('  FATAL: no deck channel — engine not initialized');
    await cleanup();
    process.exit(1);
  }

  cleanupState.savedTxCfg = await httpJson('GET', '/deck/transition-config');
  try {
    const cur = await httpJson('GET', '/deck/playlist');
    cleanupState.savedDeckPlaylistName = (cur && cur.name) || 'default';
  } catch { cleanupState.savedDeckPlaylistName = 'default'; }

  // Two throwaway playlists with distinct, deterministic entry ids.
  const PL_A = 'hil_swap_resp_a';
  const PL_B = 'hil_swap_resp_b';
  await httpJson('POST', '/playlists', {
    name: PL_A,
    entries: [
      { id: 'a_one', pattern: 'test_const', label: 'A1', defaults: {} },
      { id: 'a_two', pattern: 'test_dualband', label: 'A2', defaults: {} },
    ],
  });
  cleanupState.createdPlaylists.push(PL_A);
  await httpJson('POST', '/playlists', {
    name: PL_B,
    entries: [
      { id: 'b_one', pattern: 'test_dualband', label: 'B1', defaults: {} },
      { id: 'b_two', pattern: 'test_const', label: 'B2', defaults: {} },
    ],
  });
  cleanupState.createdPlaylists.push(PL_B);
  await sleep(SETTLE_MS);

  // Start the deck on PL_A entry a_one, transitions DISABLED so this lands
  // instantly and we have a clean known "old" entry.
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist', { name: PL_A });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'a_one' });
  await sleep(SETTLE_MS * 2);

  // ── TEST 1: transition-ENABLED swap returns the resolved targetEntryId ──
  // This is the path the bug lived on: with a soft crossfade in flight, the
  // returned playlist.activeEntryId is STILL the old entry, but targetEntryId
  // must carry the NEW resolved entry (PL_B's first usable entry = b_one).
  console.log('\n[TEST 1] transition-enabled /deck/playlist/swap returns targetEntryId');
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: 1500, shuffle: false,
  });
  await sleep(SETTLE_MS);

  const swapRes = await httpFull('POST', '/deck/playlist/swap', { name: PL_B });
  check(swapRes.status === 200, `swap returns 200 (got ${swapRes.status})`,
    JSON.stringify(swapRes.body));
  const sb = swapRes.body || {};
  check(typeof sb.targetEntryId === 'string' && sb.targetEntryId.length > 0,
    `response carries targetEntryId (got ${JSON.stringify(sb.targetEntryId)})`);
  check(sb.targetEntryId === 'b_one',
    `targetEntryId resolves to PL_B first usable entry 'b_one' (got ${sb.targetEntryId})`);
  // Mid-fade the stale playlist.activeEntryId is still the OLD entry — proving
  // why the client must use targetEntryId, not playlist.activeEntryId.
  const stale = sb.playlist && sb.playlist.activeEntryId;
  check(sb.targetEntryId !== stale,
    `targetEntryId (${sb.targetEntryId}) is DISTINCT from stale playlist.activeEntryId (${stale}) mid-fade`,
    'this distinction is the whole bug — gate must arm from targetEntryId');
  // Transition should actually be in flight (a transitionId present).
  check(sb.transitionId != null, `swap kicked off a transition (transitionId=${sb.transitionId})`);

  // Let the fade complete before the next test.
  await sleep(1800);

  // ── TEST 2: explicit entryId swap echoes that id as targetEntryId ──────
  console.log('\n[TEST 2] swap with explicit entryId → targetEntryId === entryId');
  // Reset to PL_A instantly so the next swap isn't blocked by an in-flight one.
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist', { name: PL_A });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'a_one' });
  await sleep(SETTLE_MS * 2);
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: 1500, shuffle: false,
  });
  await sleep(SETTLE_MS);

  const swapRes2 = await httpFull('POST', '/deck/playlist/swap', { name: PL_B, entryId: 'b_two' });
  check(swapRes2.status === 200, `explicit-entry swap returns 200 (got ${swapRes2.status})`,
    JSON.stringify(swapRes2.body));
  check(swapRes2.body && swapRes2.body.targetEntryId === 'b_two',
    `targetEntryId echoes explicit entryId 'b_two' (got ${swapRes2.body?.targetEntryId})`);
  await sleep(1800);

  // ── TEST 3: /deck/playlist/entry (transition enabled) returns targetEntryId ──
  console.log('\n[TEST 3] transition-enabled /deck/playlist/entry returns targetEntryId');
  // Land on PL_B b_one instantly, then advance to b_two with a transition.
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist', { name: PL_B });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'b_one' });
  await sleep(SETTLE_MS * 2);
  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: 'trans_crossfade', durationMs: 1500, shuffle: false,
  });
  await sleep(SETTLE_MS);

  const entryRes = await httpFull('POST', '/deck/playlist/entry', { entryId: 'b_two' });
  check(entryRes.status === 200, `entry advance returns 200 (got ${entryRes.status})`,
    JSON.stringify(entryRes.body));
  check(entryRes.body && entryRes.body.targetEntryId === 'b_two',
    `entry response targetEntryId === requested 'b_two' (got ${entryRes.body?.targetEntryId})`);
  // Mid-fade stale id is still b_one — same bug surface as the swap path.
  const staleEntry = entryRes.body && entryRes.body.playlist && entryRes.body.playlist.activeEntryId;
  check(entryRes.body && entryRes.body.targetEntryId !== staleEntry,
    `entry targetEntryId distinct from stale playlist.activeEntryId mid-fade (stale=${staleEntry})`);
  await sleep(1800);

  // ── Cleanup ──────────────────────────────────────────────────────────
  await cleanup();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  process.exit(passed === total ? 0 : 1);
})().catch(async (e) => {
  console.error('test crashed:', e);
  try { await cleanup(); } catch (_) {}
  process.exit(1);
});
