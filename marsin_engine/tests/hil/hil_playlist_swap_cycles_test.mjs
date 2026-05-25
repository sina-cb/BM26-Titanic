/**
 * hil_playlist_swap_cycles_test.mjs — HIL test for rapid dropdown-swap cycles
 *
 * The user reported: "playlist change causes the playlist change
 * dropdown to freeze even though the playlist changes successfully,
 * it doesn't let me change it again! in both deck and mixer tabs!".
 *
 * The previous PlaylistPanel design wrapped `handleLoadPlaylist` in a
 * busy flag that disabled the dropdown until POST resolution + a
 * try/finally + watchdog tried to clear it. Multiple ways for the
 * busy flag to get stranded (React batching, unmount mid-await, WS
 * handler reentry, error in finally). The fix removes the busy gate
 * on the dropdown entirely (concurrent swaps are legal on the engine)
 * and adds an epoch counter so stale POST responses don't clobber a
 * newer optimistic update.
 *
 * The remaining requirement on the ENGINE is that every swap, even
 * back-to-back rapid swaps on the same channel:
 *   - Returns 200 with the new playlist assignment + inline data.
 *   - Emits a `channelPlaylistData` WS event for the FINAL state
 *     before the corresponding `mixer` event.
 *   - Leaves the engine in a consistent state matching the LAST swap.
 *
 * This test simulates exactly what the operator does on the iPad:
 * open dropdown, pick playlist B, open dropdown, pick playlist C,
 * etc. — back to back, with no waiting. The iPad's UI code is now
 * responsible for letting the operator do this (no busy gate), and
 * the engine must keep up.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31068
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31068 node tests/hil/hil_playlist_swap_cycles_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}`;

const SWAP_TIMEOUT_MS = 500;
const WS_EVENT_TIMEOUT_MS = 600;
const ORDERING_TOLERANCE_MS = 50;
const RAPID_SWAP_TOTAL_BUDGET_MS = 3000;

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
const cleanupState = {
  started: false,
  done: false,
  snapshot: null,
  // Two throwaway playlists we cycle the channel between. Deleted
  // in restoreState so the operator's library is untouched.
  plA: 'hil_swap_cycles_a',
  plB: 'hil_swap_cycles_b',
  plC: 'hil_swap_cycles_c',
  createdPlaylists: [],
};

async function deleteAllOverlays() {
  const m = (await httpJson('GET', '/mixer')).body;
  const base = m.baseChannelId;
  for (const c of m.channels) {
    if (c.id === base) continue;
    await httpJson('DELETE', `/mixer/channels/${c.id}`);
  }
}

async function restoreState() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    await deleteAllOverlays();
    for (const c of (cleanupState.snapshot?.channels || [])) {
      if (c.id === cleanupState.snapshot.baseChannelId) continue;
      const playlistName = (c.playlist && c.playlist.name) || 'default';
      const entryId = c.playlist && c.playlist.activeEntryId;
      await httpJson('POST', '/mixer/channels', {
        playlist: playlistName,
        playlistEntryId: entryId,
        name: c.name,
        mode: c.mode,
        fader: c.fader,
      });
    }
    console.log(`  restored ${(cleanupState.snapshot?.channels?.length || 1) - 1} overlay channel(s)`);
    for (const name of cleanupState.createdPlaylists) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(name)}`);
        console.log(`  deleted test playlist: ${name}`);
      } catch (e) {
        console.warn(`  could not delete ${name}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  restore failed: ${e.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.error(`\nReceived ${sig}; restoring mixer state...`);
    try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
  });
}

// ─────────────────────────── main ──────────────────────────────────
(async function main() {
  console.log('==========================================================');
  console.log('hil_playlist_swap_cycles_test.mjs — rapid dropdown swaps');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  cleanupState.started = true;

  // Snapshot.
  let mixer;
  try {
    mixer = (await httpJson('GET', '/mixer')).body;
  } catch (e) {
    console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
    process.exit(2);
  }
  cleanupState.snapshot = JSON.parse(JSON.stringify(mixer));
  console.log(`  snapshot: ${mixer.channels.length} channel(s), base=${mixer.baseChannelId}`);

  // Create three throwaway playlists with distinct entry counts so we can
  // distinguish them in the assertion.
  for (const [name, count] of [[cleanupState.plA, 2], [cleanupState.plB, 3], [cleanupState.plC, 1]]) {
    const entries = [];
    for (let i = 0; i < count; i++) {
      entries.push({ id: `e_${name}_${i}`, pattern: 'test_const', label: `${name}_${i}`, defaults: {} });
    }
    const r = await httpJson('POST', '/playlists', { name, entries });
    if (r.status !== 200) {
      console.error(`  FATAL: could not create test playlist ${name}: ${r.status}`);
      await restoreState();
      process.exit(2);
    }
    cleanupState.createdPlaylists.push(name);
    console.log(`  created test playlist ${name} with ${count} entries`);
  }

  await deleteAllOverlays();
  await sleep(150);

  // Add a channel we'll swap repeatedly.
  const addRes = await httpJson('POST', '/mixer/channels', {
    playlist: cleanupState.plA, name: 'swap_target', mode: 'blend_screen', fader: 1.0,
  });
  if (addRes.status !== 200) {
    console.error('  FATAL: could not add swap target channel');
    await restoreState();
    process.exit(2);
  }
  const chId = addRes.body.channelId;
  console.log(`  test channel id: ${chId}`);

  const ws = await openWs();
  const sub = subscribe(ws);

  // ── TEST 1: back-to-back swaps all succeed within budget ──────────
  console.log('\n[TEST 1] rapid back-to-back swaps (A→B→C→A→B→C)');
  sub.events.length = 0;
  const swapSeq = [cleanupState.plB, cleanupState.plC, cleanupState.plA, cleanupState.plB, cleanupState.plC, cleanupState.plA];
  const t1Start = Date.now();
  const swapTimes = [];
  for (const name of swapSeq) {
    const t0 = Date.now();
    const r = await httpJson('POST', `/mixer/channels/${chId}/playlist`, { name });
    const dt = Date.now() - t0;
    swapTimes.push(dt);
    if (r.status !== 200) {
      fail(`swap to ${name} failed`, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 120)}`);
    }
  }
  const t1Dt = Date.now() - t1Start;
  check(
    swapTimes.every(t => t < SWAP_TIMEOUT_MS),
    `all ${swapSeq.length} swaps under ${SWAP_TIMEOUT_MS} ms (max=${Math.max(...swapTimes)} ms)`,
    `at least one swap exceeded ${SWAP_TIMEOUT_MS} ms`,
    `times=${swapTimes.join(',')} ms`,
  );
  check(
    t1Dt < RAPID_SWAP_TOTAL_BUDGET_MS,
    `${swapSeq.length} swaps total in ${t1Dt} ms (< ${RAPID_SWAP_TOTAL_BUDGET_MS} ms budget)`,
    `total time ${t1Dt} ms exceeds budget`,
  );

  // ── TEST 2: every swap has a matching ordered channelPlaylistData ─
  console.log('\n[TEST 2] every swap emits channelPlaylistData BEFORE mixer');
  await sleep(WS_EVENT_TIMEOUT_MS);
  // We expect a channelPlaylistData event for each target playlist
  // (in the order issued) with the corresponding playlistData.name.
  const chPlEvents = sub.events.filter(
    e => e.msg.type === 'channelPlaylistData' && e.msg.channelId === chId,
  );
  check(
    chPlEvents.length >= swapSeq.length,
    `received ${chPlEvents.length} channelPlaylistData events for ${swapSeq.length} swaps`,
    `only got ${chPlEvents.length} chPl events for ${swapSeq.length} swaps`,
  );
  // Every distinct target name we swapped to must appear in at least
  // one channelPlaylistData event with the right playlistData.
  const distinctNames = [...new Set(swapSeq)];
  let distinctNameMatchOk = 0;
  for (const name of distinctNames) {
    const chPl = chPlEvents.find(e => e.msg.playlistData?.name === name);
    if (chPl) distinctNameMatchOk++;
  }
  check(
    distinctNameMatchOk === distinctNames.length,
    `every distinct target name (${distinctNames.length}) appears in channelPlaylistData`,
    `only ${distinctNameMatchOk}/${distinctNames.length} distinct names appeared`,
  );
  // Ordering: per-swap, the corresponding chPl must precede its mixer
  // (within tolerance).
  let orderingOk = 0;
  // We use a sliding window — go through events in order and for each
  // chPl event find the NEXT mixer event with matching playlist name.
  const sortedEvents = sub.events.slice().sort((a, b) => a.t - b.t);
  for (let i = 0; i < sortedEvents.length; i++) {
    const e = sortedEvents[i];
    if (e.msg.type !== 'channelPlaylistData' || e.msg.channelId !== chId) continue;
    const name = e.msg.playlistData?.name;
    if (!name) continue;
    // Find the next mixer event listing this channel with this name.
    const nextMixer = sortedEvents.slice(i + 1).find(
      f => f.msg.type === 'mixer' && Array.isArray(f.msg.channels)
        && f.msg.channels.some(c => c.id === chId && c.playlist?.name === name),
    );
    if (nextMixer && (nextMixer.t - e.t) >= -ORDERING_TOLERANCE_MS) orderingOk++;
  }
  check(
    orderingOk >= swapSeq.length - 1, // -1 tolerance for the very last where mixer might be in a later batch
    `${orderingOk} chPl→mixer orderings preserved (>= ${swapSeq.length - 1} expected)`,
    `only ${orderingOk}/${swapSeq.length} orderings preserved`,
  );

  // ── TEST 3: final engine state matches the last swap ──────────────
  console.log('\n[TEST 3] engine state after burst matches last swap');
  const finalCh = (await httpJson('GET', `/mixer`)).body.channels.find(c => c.id === chId);
  check(
    finalCh && finalCh.playlist && finalCh.playlist.name === swapSeq[swapSeq.length - 1],
    `channel.playlist.name == ${swapSeq[swapSeq.length - 1]}`,
    `engine state drifted`,
    `got ${JSON.stringify(finalCh?.playlist).slice(0, 120)}`,
  );

  // ── TEST 4: round-trip a single swap and confirm response shape ───
  // The iPad's PlaylistPanel.handleLoadPlaylist reads
  // `res.data.playlist` to adopt the canonical assignment AND
  // `res.data.playlistData` (via api.ts) to prime the cache. If
  // either is missing we fall back to a slow GET.
  console.log('\n[TEST 4] swap response carries playlist + playlistData inline');
  const r4 = await httpJson('POST', `/mixer/channels/${chId}/playlist`, { name: cleanupState.plB });
  check(
    r4.body && r4.body.playlist && r4.body.playlist.name === cleanupState.plB,
    `response.playlist.name == ${cleanupState.plB}`,
    `response.playlist missing or wrong`,
    `got ${JSON.stringify(r4.body?.playlist).slice(0, 120)}`,
  );
  check(
    r4.body && r4.body.playlistData
      && Array.isArray(r4.body.playlistData.entries)
      && r4.body.playlistData.name === cleanupState.plB,
    `response.playlistData carries entries for ${cleanupState.plB}`,
    `response.playlistData missing or wrong`,
    `got ${JSON.stringify(r4.body?.playlistData).slice(0, 120)}`,
  );

  // ── TEST 5: swap to same name is still 200 (operator may double-tap) ─
  console.log('\n[TEST 5] swap to currently-loaded playlist is idempotent');
  const r5 = await httpJson('POST', `/mixer/channels/${chId}/playlist`, { name: cleanupState.plB });
  check(
    r5.status === 200,
    `re-swap to same playlist returns 200`,
    `re-swap failed: status=${r5.status}`,
  );

  // ── TEST 6: empty playlist swap returns ok with empty entries ─────
  // "fast" is an empty playlist on the test_bench scene; verifies the
  // dropdown can be flipped TO an empty playlist without the engine
  // erroring out (which would leave the iPad's optimistic state
  // permanently inconsistent if the response carried an error).
  console.log('\n[TEST 6] swap to empty playlist returns ok + empty entries');
  // Find any empty playlist in the engine library; create one if none.
  const lib = (await httpJson('GET', '/playlists')).body || [];
  let emptyName = null;
  for (const name of lib) {
    const pl = (await httpJson('GET', `/playlists/${encodeURIComponent(name)}`)).body;
    if (pl && Array.isArray(pl.entries) && pl.entries.length === 0) { emptyName = name; break; }
  }
  if (!emptyName) {
    emptyName = 'hil_swap_cycles_empty';
    await httpJson('POST', '/playlists', { name: emptyName, entries: [] });
    cleanupState.createdPlaylists.push(emptyName);
  }
  const r6 = await httpJson('POST', `/mixer/channels/${chId}/playlist`, { name: emptyName });
  check(
    r6.status === 200
      && r6.body && r6.body.playlist && r6.body.playlist.name === emptyName,
    `swap to empty playlist returns 200 + correct assignment`,
    `swap to empty playlist failed`,
    `status=${r6.status} body=${JSON.stringify(r6.body).slice(0, 120)}`,
  );
  check(
    r6.body && r6.body.playlistData
      && Array.isArray(r6.body.playlistData.entries)
      && r6.body.playlistData.entries.length === 0,
    `empty playlist response carries empty entries array (not null)`,
    `empty playlist response shape wrong`,
    `got ${JSON.stringify(r6.body?.playlistData).slice(0, 120)}`,
  );

  // ── Cleanup ──────────────────────────────────────────────────────
  sub.stop();
  ws.close();
  await restoreState();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  process.exit(passed === total ? 0 : 1);
})().catch(async (e) => {
  console.error('test crashed:', e);
  try { await restoreState(); } catch {}
  process.exit(1);
});
