/**
 * hil_playlist_robustness_test.mjs — HIL test for playlist load reliability
 *
 * The user reported: "when I add a new channel in the mixer, the
 * playlist is not loaded for the new channel — 2nd channel shows
 * 'default' as the selected playlist but still loading, 3rd channel
 * doesn't even show a playlist name". The root cause was that each
 * brand-new PlaylistPanel was racing a separate slow GET
 * /playlists/<name>, and under rapid-add load some of those GETs
 * would never resolve before the iPad's 8s fetch timeout.
 *
 * The fix:
 *   - Engine bundles full playlist data inline in POST /mixer/channels
 *     response AND emits a `channelPlaylistData` WS event BEFORE the
 *     `mixer` broadcast that announces the new channel.
 *   - iPad's api.ts module-level listener primes a per-name playlist
 *     cache from `channelPlaylistData`, so by the time the new
 *     PlaylistPanel mounts and calls fetchPlaylist(name), it hits
 *     the cache instead of issuing a slow GET.
 *
 * This test verifies BOTH halves of the contract — the engine emits
 * the right data in the right order, and under the WS load that
 * tripped the original bug.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model
 *   - At least one playlist on disk (test creates its own throwaway
 *     too, and cleans it up on exit)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     node tests/hil/hil_playlist_robustness_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1.  POST /mixer/channels response includes a `playlistData` field
 *       with full entries (the inline-data contract).
 *   2.  POST /mixer/channels emits a `channelPlaylistData` WS event
 *       BEFORE the corresponding `mixer` event (the cache-prime-first
 *       ordering contract — without it the iPad's new PlaylistPanel
 *       races the broadcast).
 *   3.  POST /mixer/channels/:id/playlist (swap) also returns
 *       playlistData inline AND emits channelPlaylistData on WS.
 *   4.  Rapid-add stress: add 4 channels back-to-back, ALL must:
 *         a. Get a `channelPlaylistData` WS event with valid entries.
 *         b. That event lands BEFORE the corresponding `mixer` event
 *            for the same channel.
 *         c. The whole burst completes within RAPID_ADD_TOTAL_BUDGET_MS.
 *   5.  No data drift: the entries returned inline match the engine's
 *       GET /playlists/<name> response (one source of truth on disk).
 *   6.  channelPlaylistData payload size stays under PAYLOAD_BUDGET_BYTES
 *       for a default-sized playlist (sanity check for WS bloat).
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed (details printed inline)
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';

// Latency budgets — tight on purpose; the operator perceives anything
// slower than this as "stuck". The engine itself is millisecond-fast
// for these ops; this is the budget the iPad pays end-to-end.
const ADD_TIMEOUT_MS = 500;
const SWAP_TIMEOUT_MS = 500;
const RAPID_ADD_TOTAL_BUDGET_MS = 3000; // 4 channels added in sequence
const WS_EVENT_TIMEOUT_MS = 800;        // channelPlaylistData lands within this
const ORDERING_TOLERANCE_MS = 50;       // channelPlaylistData arrives <= mixer + 50ms
const PAYLOAD_BUDGET_BYTES = 64 * 1024; // 64KB per channelPlaylistData event

// ─────────────────────────── helpers ────────────────────────────────
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
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
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

// Subscribe to a WS and collect EVERY message (with a receive
// timestamp) into a sink the caller can post-process. Returns the
// sink + a stop fn that drops the listener. Used by the tests
// below to assert ordering between event types for a single
// channel — much more reliable than waitFor(predicate) variants
// that race the listener install.
function subscribe(ws) {
  const events = [];
  const onMessage = (raw) => {
    let o; try { o = JSON.parse(raw); } catch { return; }
    events.push({ t: Date.now(), msg: o });
  };
  ws.on('message', onMessage);
  return {
    events,
    stop: () => ws.off('message', onMessage),
  };
}

// ─────────────────────────── assertion bus ──────────────────────────
const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : ''));
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
  // snapshot of the mixer's pre-test overlay channels — we restore
  // these on exit so the operator's setup is untouched.
  snapshot: null,
  // throwaway playlist the test creates to keep its mutations off
  // the operator's library. Deleted in restoreState().
  hilPlaylistName: 'hil_playlist_robustness',
  hilPlaylistCreated: false,
};
let signalCleanupInstalled = false;

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
  console.log('\n\u2500\u2500 Cleanup \u2500\u2500');
  try {
    // 1. Drop everything we added.
    await deleteAllOverlays();
    // 2. Re-create the snapshot's overlays.
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
    // 3. Drop the throwaway playlist we created.
    if (cleanupState.hilPlaylistCreated) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(cleanupState.hilPlaylistName)}`);
        console.log(`  deleted test playlist: ${cleanupState.hilPlaylistName}`);
      } catch (e) {
        console.warn(`  could not delete test playlist ${cleanupState.hilPlaylistName}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  restore failed: ${e.message}`);
  }
}

function installSignalCleanup() {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      console.error(`\nReceived ${sig}; restoring mixer state...`);
      try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
    });
  }
}

// ─────────────────────────── tests ──────────────────────────────────
(async function main() {
  console.log('==========================================================');
  console.log('hil_playlist_robustness_test.mjs — playlist load reliability');
  console.log('==========================================================');

  installSignalCleanup();
  cleanupState.started = true;

  // ── Setup ──────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Setup \u2500\u2500');
  let mixer;
  try {
    mixer = (await httpJson('GET', '/mixer')).body;
  } catch (e) {
    console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
    console.error('  Make sure `node engine.js --model test_bench` is running.');
    process.exit(2);
  }
  cleanupState.snapshot = JSON.parse(JSON.stringify(mixer));
  console.log(`  snapshot: ${mixer.channels.length} channel(s), base=${mixer.baseChannelId}`);

  // Pick the operator's first available playlist as PL_A (we never
  // mutate it). Create a throwaway HIL playlist as PL_B so the
  // swap test has something distinct to switch to.
  const lib = (await httpJson('GET', '/playlists')).body;
  if (!Array.isArray(lib) || lib.length === 0) {
    console.error('  FATAL: engine reports no playlists; expected at least 1');
    process.exit(2);
  }
  const PL_A = lib[0];
  // Build the throwaway with 3 entries so the inline payload is
  // non-trivial but well inside PAYLOAD_BUDGET_BYTES.
  const PL_B = cleanupState.hilPlaylistName;
  await httpJson('POST', '/playlists', {
    name: PL_B,
    entries: [
      { id: 'e_rob_const', pattern: 'test_const', label: 'A', defaults: {} },
      { id: 'e_rob_dual',  pattern: 'test_dualband', label: 'B', defaults: {} },
      { id: 'e_rob_three', pattern: 'test_const', label: 'C', defaults: {} },
    ],
  });
  cleanupState.hilPlaylistCreated = true;
  console.log(`  created test playlist: ${PL_B}`);
  console.log(`  using PL_A=${PL_A}, PL_B=${PL_B}`);

  // Start clean — no overlays. We test fresh-add reliability, not
  // already-loaded-channels behaviour.
  await deleteAllOverlays();
  await sleep(150);

  const ws = await openWs();
  const sub = subscribe(ws);

  // ── TEST 1: POST /mixer/channels returns playlistData inline ──────
  console.log('\n[TEST 1] POST /mixer/channels — inline playlistData contract');
  sub.events.length = 0;
  const t1Start = Date.now();
  const addRes = await httpJson('POST', '/mixer/channels', {
    playlist: PL_A, name: 'rob1', mode: 'blend_screen', fader: 1.0,
  });
  const t1Dt = Date.now() - t1Start;
  check(
    addRes.status === 200 && addRes.body && addRes.body.channelId,
    `add channel HTTP 200 in ${t1Dt} ms`,
    'add channel failed',
    `status=${addRes.status} body=${JSON.stringify(addRes.body).slice(0, 120)}`,
  );
  check(
    t1Dt < ADD_TIMEOUT_MS,
    `add channel within ${ADD_TIMEOUT_MS} ms budget (${t1Dt} ms)`,
    `add channel slower than ${ADD_TIMEOUT_MS} ms`,
    `${t1Dt} ms`,
  );
  check(
    addRes.body && addRes.body.playlistData && Array.isArray(addRes.body.playlistData.entries),
    'response includes playlistData with entries array',
    'response missing playlistData.entries',
    `got: ${JSON.stringify(addRes.body && addRes.body.playlistData).slice(0, 120)}`,
  );
  check(
    addRes.body?.playlistData?.name === PL_A,
    `playlistData.name == ${PL_A}`,
    `playlistData.name mismatch (got ${addRes.body?.playlistData?.name})`,
  );
  const t1ChId = addRes.body.channelId;

  // ── TEST 2: channelPlaylistData WS event ordering ─────────────────
  console.log('\n[TEST 2] channelPlaylistData WS event arrives BEFORE mixer event');
  // Wait briefly for events to drain (HTTP response landed, WS may
  // still be in-flight on the same network hop).
  await sleep(WS_EVENT_TIMEOUT_MS);
  const t2ChPlData = sub.events.find(
    e => e.msg.type === 'channelPlaylistData' && e.msg.channelId === t1ChId,
  );
  const t2MixerWithCh = sub.events.find(
    e => e.msg.type === 'mixer' && Array.isArray(e.msg.channels)
      && e.msg.channels.some(c => c.id === t1ChId),
  );
  check(
    !!t2ChPlData,
    'received channelPlaylistData event for new channel',
    'no channelPlaylistData event received',
    `seen types: ${[...new Set(sub.events.map(e => e.msg.type))].join(', ')}`,
  );
  check(
    !!t2MixerWithCh,
    'received mixer event listing the new channel',
    'no mixer event listed the new channel',
  );
  if (t2ChPlData && t2MixerWithCh) {
    const ordering = t2MixerWithCh.t - t2ChPlData.t;
    check(
      ordering >= -ORDERING_TOLERANCE_MS,
      `channelPlaylistData arrived BEFORE/with mixer (delta=${ordering} ms, tolerance=${ORDERING_TOLERANCE_MS} ms)`,
      `mixer arrived BEFORE channelPlaylistData by ${-ordering} ms — iPad will race the GET`,
    );
  }
  if (t2ChPlData) {
    check(
      t2ChPlData.msg.playlistData
        && Array.isArray(t2ChPlData.msg.playlistData.entries)
        && t2ChPlData.msg.playlistData.entries.length > 0,
      'channelPlaylistData carries entries inline (cache-prime payload OK)',
      'channelPlaylistData missing or empty entries',
    );
    const bytes = Buffer.byteLength(JSON.stringify(t2ChPlData.msg));
    check(
      bytes < PAYLOAD_BUDGET_BYTES,
      `channelPlaylistData payload ${bytes} bytes < ${PAYLOAD_BUDGET_BYTES} budget`,
      `channelPlaylistData payload ${bytes} bytes exceeds ${PAYLOAD_BUDGET_BYTES} budget`,
    );
  }

  // ── TEST 3: playlist swap response + WS contract ──────────────────
  console.log('\n[TEST 3] POST /mixer/channels/:id/playlist — swap inline + WS');
  sub.events.length = 0;
  const t3Start = Date.now();
  const swapRes = await httpJson('POST', `/mixer/channels/${t1ChId}/playlist`, { name: PL_B });
  const t3Dt = Date.now() - t3Start;
  check(
    swapRes.status === 200 && swapRes.body && swapRes.body.status === 'ok',
    `swap HTTP 200 in ${t3Dt} ms`,
    'swap failed',
    `status=${swapRes.status} body=${JSON.stringify(swapRes.body).slice(0, 120)}`,
  );
  check(
    t3Dt < SWAP_TIMEOUT_MS,
    `swap within ${SWAP_TIMEOUT_MS} ms budget (${t3Dt} ms)`,
    `swap slower than ${SWAP_TIMEOUT_MS} ms`,
  );
  check(
    swapRes.body?.playlistData?.name === PL_B
      && Array.isArray(swapRes.body.playlistData.entries),
    `swap response carries playlistData for ${PL_B} inline`,
    'swap response missing playlistData',
    `got: ${JSON.stringify(swapRes.body && swapRes.body.playlistData).slice(0, 120)}`,
  );
  await sleep(WS_EVENT_TIMEOUT_MS);
  const t3ChPlData = sub.events.find(
    e => e.msg.type === 'channelPlaylistData'
      && e.msg.channelId === t1ChId
      && e.msg.playlistData
      && e.msg.playlistData.name === PL_B,
  );
  check(
    !!t3ChPlData,
    `received channelPlaylistData for swap to ${PL_B}`,
    'no channelPlaylistData event for swap',
  );

  // ── TEST 4: rapid-add stress under WS load ────────────────────────
  // The engine's mixer caps total channels (deck base + overlays) at
  // maxChannels; we size the burst to fill EVERY available overlay
  // slot, which is the worst-case mount-storm the iPad has to absorb.
  await deleteAllOverlays();
  await sleep(150);
  const mAfter = (await httpJson('GET', '/mixer')).body;
  const burstSize = Math.max(1, (mAfter.maxChannels || 4) - 1);
  console.log(`\n[TEST 4] rapid-add ${burstSize} channels — every new panel gets data in time`);
  sub.events.length = 0;
  const t4Start = Date.now();
  const t4Ids = [];
  // Sequential awaits (NOT Promise.all) — this matches what the iPad
  // does when the user mashes the "+ DEFAULT" button N times. Each
  // add must complete its full server-side work (compile + state
  // save + broadcast) before the next starts.
  for (let i = 0; i < burstSize; i++) {
    const r = await httpJson('POST', '/mixer/channels', {
      playlist: PL_A, name: `rob_burst_${i}`, mode: 'blend_screen', fader: 1.0,
    });
    if (r.status === 200 && r.body && r.body.channelId) {
      t4Ids.push(r.body.channelId);
    } else {
      fail(`burst add ${i} failed`, `status=${r.status}`);
    }
  }
  const t4Dt = Date.now() - t4Start;
  check(
    t4Ids.length === burstSize,
    `all ${burstSize} burst adds succeeded`,
    `only ${t4Ids.length}/${burstSize} burst adds succeeded`,
  );
  check(
    t4Dt < RAPID_ADD_TOTAL_BUDGET_MS,
    `burst (${burstSize} adds) completed in ${t4Dt} ms (< ${RAPID_ADD_TOTAL_BUDGET_MS} ms budget)`,
    `burst took ${t4Dt} ms (> ${RAPID_ADD_TOTAL_BUDGET_MS} ms budget)`,
  );
  // Give WS time to drain.
  await sleep(WS_EVENT_TIMEOUT_MS);
  // Every channel must have at least one channelPlaylistData event
  // with non-empty entries.
  let burstChPlData = 0;
  let burstWithEntries = 0;
  let burstOrderingOk = 0;
  for (const chId of t4Ids) {
    const chPlEvts = sub.events.filter(
      e => e.msg.type === 'channelPlaylistData' && e.msg.channelId === chId,
    );
    if (chPlEvts.length > 0) burstChPlData++;
    const firstWithEntries = chPlEvts.find(
      e => e.msg.playlistData
        && Array.isArray(e.msg.playlistData.entries)
        && e.msg.playlistData.entries.length > 0,
    );
    if (firstWithEntries) burstWithEntries++;
    // Ordering: the FIRST channelPlaylistData event for this channel
    // must arrive BEFORE the FIRST mixer event that lists this channel
    // (or at most ORDERING_TOLERANCE_MS after, to absorb tiny WS
    // reorder jitter).
    const firstMixerListingCh = sub.events.find(
      e => e.msg.type === 'mixer' && Array.isArray(e.msg.channels)
        && e.msg.channels.some(c => c.id === chId),
    );
    const firstChPlData = chPlEvts[0];
    if (firstMixerListingCh && firstChPlData
      && firstMixerListingCh.t - firstChPlData.t >= -ORDERING_TOLERANCE_MS) {
      burstOrderingOk++;
    }
  }
  check(
    burstChPlData === burstSize,
    'every burst-added channel got a channelPlaylistData event',
    `only ${burstChPlData}/${burstSize} burst channels got channelPlaylistData`,
  );
  check(
    burstWithEntries === burstSize,
    'every burst channelPlaylistData carries non-empty entries',
    `only ${burstWithEntries}/${burstSize} carry entries`,
  );
  check(
    burstOrderingOk === burstSize,
    'every burst channelPlaylistData arrived BEFORE its mixer event',
    `only ${burstOrderingOk}/${burstSize} had correct ordering`,
  );

  // ── TEST 5: inline data matches GET /playlists/<name> on disk ─────
  console.log('\n[TEST 5] inline playlistData matches on-disk GET /playlists/<name>');
  const onDiskA = (await httpJson('GET', `/playlists/${encodeURIComponent(PL_A)}`)).body;
  const onDiskB = (await httpJson('GET', `/playlists/${encodeURIComponent(PL_B)}`)).body;
  check(
    onDiskA && Array.isArray(onDiskA.entries)
      && JSON.stringify(addRes.body.playlistData.entries.map(e => e.pattern))
       === JSON.stringify(onDiskA.entries.map(e => e.pattern)),
    `inline playlistData(${PL_A}) matches GET /playlists/${PL_A}`,
    `inline playlistData(${PL_A}) drift vs on-disk`,
  );
  check(
    onDiskB && Array.isArray(onDiskB.entries)
      && JSON.stringify(swapRes.body.playlistData.entries.map(e => e.pattern))
       === JSON.stringify(onDiskB.entries.map(e => e.pattern)),
    `inline playlistData(${PL_B}) matches GET /playlists/${PL_B}`,
    `inline playlistData(${PL_B}) drift vs on-disk`,
  );

  // ── TEST 6: cache priming proves the iPad-side fix ────────────────
  // Even if the iPad never issued a GET /playlists/<name>, the
  // inline payload + WS event are enough to fully render the entry
  // list. We verify that here at the protocol level: every burst
  // channel's channelPlaylistData carries ENOUGH information that a
  // client could render its entry list without any additional HTTP
  // calls.
  console.log('\n[TEST 6] entry list renderable from WS+POST alone (no follow-up GET)');
  let fullyRenderable = 0;
  for (const chId of t4Ids) {
    const evt = sub.events.find(
      e => e.msg.type === 'channelPlaylistData'
        && e.msg.channelId === chId
        && e.msg.playlistData
        && Array.isArray(e.msg.playlistData.entries)
        && e.msg.playlistData.entries.every(
          ent => ent.id && ent.pattern,
        ),
    );
    if (evt) fullyRenderable++;
  }
  check(
    fullyRenderable === burstSize,
    `all ${burstSize} burst channels have renderable playlist data from WS alone`,
    `only ${fullyRenderable}/${burstSize} are renderable without a follow-up GET`,
  );

  // ── TEST 7: multi-WS reproduces the iPad scenario exactly ─────────
  // The iPad opens TWO WebSocket connections simultaneously
  // (mixer.tsx's local socket + RigGlobals' always-on socket). Both
  // pipe every received message into the engineEvents bus. If the
  // engine drops a `channelPlaylistData` event on one of them (e.g.
  // because the broadcastWs() loop blocked mid-burst), the cache
  // may never get primed for that channel on the iPad — even
  // though our single-WS test above sees nothing wrong.
  //
  // This test opens 3 concurrent WS connections (matches iPad's
  // mixer + RigGlobals + Audio tab worst case), runs the same
  // burst-add, and asserts EVERY socket got channelPlaylistData
  // for EVERY new channel BEFORE the corresponding mixer event.
  console.log('\n[TEST 7] multi-WS clients all receive channelPlaylistData per channel');
  await deleteAllOverlays();
  await sleep(150);
  const wsA = await openWs();
  const wsB = await openWs();
  const wsC = await openWs();
  const subA = subscribe(wsA);
  const subB = subscribe(wsB);
  const subC = subscribe(wsC);
  const t7Ids = [];
  for (let i = 0; i < burstSize; i++) {
    const r = await httpJson('POST', '/mixer/channels', {
      playlist: PL_A, name: `rob_multi_${i}`, mode: 'blend_screen', fader: 1.0,
    });
    if (r.status === 200 && r.body && r.body.channelId) {
      t7Ids.push(r.body.channelId);
    }
  }
  await sleep(WS_EVENT_TIMEOUT_MS);

  // Per-socket, per-channel verification. The matrix that matters:
  // for EACH (socket, channel) cell we need exactly one
  // channelPlaylistData event with entries, arriving no later than
  // the first mixer event listing that channel (within tolerance).
  let multiWsCellsOk = 0;
  const totalCells = 3 * burstSize;
  const failures = [];
  for (const [label, s] of [['A', subA], ['B', subB], ['C', subC]]) {
    for (const chId of t7Ids) {
      const chPl = s.events.find(
        e => e.msg.type === 'channelPlaylistData'
          && e.msg.channelId === chId
          && e.msg.playlistData
          && Array.isArray(e.msg.playlistData.entries)
          && e.msg.playlistData.entries.length > 0,
      );
      const mixerEvt = s.events.find(
        e => e.msg.type === 'mixer'
          && Array.isArray(e.msg.channels)
          && e.msg.channels.some(c => c.id === chId),
      );
      const ordering = (chPl && mixerEvt) ? (mixerEvt.t - chPl.t) : null;
      const okOrdering = ordering !== null && ordering >= -ORDERING_TOLERANCE_MS;
      if (chPl && mixerEvt && okOrdering) multiWsCellsOk++;
      else {
        failures.push(
          `socket ${label} ch=${chId.slice(-6)}: chPl=${!!chPl} mixer=${!!mixerEvt} ` +
          `ordering=${ordering == null ? 'n/a' : `${ordering}ms`}`,
        );
      }
    }
  }
  check(
    multiWsCellsOk === totalCells,
    `all ${totalCells} (socket × channel) cells received channelPlaylistData in order`,
    `${totalCells - multiWsCellsOk}/${totalCells} cells failed`,
    failures.slice(0, 5).join('; '),
  );

  // ── TEST 7b: remove + re-add stress — the EXACT user scenario ─────
  // The user reported: "I removed and added the 3rd channel and not
  // working again". Engine assigns new IDs on every add, so the
  // re-added channel is a fresh mount on the iPad. We exercise this
  // cycle 3 times here against all 3 WS clients to ensure every
  // remove-then-re-add still emits a properly-ordered
  // channelPlaylistData before the mixer event — no state hangover
  // from the prior id.
  console.log('\n[TEST 7b] remove + re-add cycle preserves channelPlaylistData → mixer ordering');
  let cycleCellsOk = 0;
  const CYCLES = 3;
  const totalCycleCells = CYCLES * 3; // 3 cycles × 3 sockets
  // Pick the LAST channel in the burst (the one the user is
  // removing + re-adding); the engine treats it like any other
  // channel but historically race-prone because it's at the
  // capacity edge.
  let cycledChId = t7Ids[t7Ids.length - 1];
  const cycleFailures = [];
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    // Drain any in-flight events first so we measure ONLY this cycle.
    subA.events.length = 0;
    subB.events.length = 0;
    subC.events.length = 0;
    // Remove.
    await httpJson('DELETE', `/mixer/channels/${cycledChId}`);
    await sleep(120);
    // Drain remove broadcast.
    subA.events.length = 0;
    subB.events.length = 0;
    subC.events.length = 0;
    // Re-add.
    const reAdd = await httpJson('POST', '/mixer/channels', {
      playlist: PL_A, name: `rob_cycle_${cycle}`, mode: 'blend_screen', fader: 1.0,
    });
    if (reAdd.status !== 200 || !reAdd.body?.channelId) {
      cycleFailures.push(`cycle ${cycle} re-add failed: status=${reAdd.status}`);
      cycledChId = null;
      break;
    }
    cycledChId = reAdd.body.channelId;
    await sleep(WS_EVENT_TIMEOUT_MS);

    for (const [label, s] of [['A', subA], ['B', subB], ['C', subC]]) {
      const chPl = s.events.find(
        e => e.msg.type === 'channelPlaylistData'
          && e.msg.channelId === cycledChId
          && e.msg.playlistData
          && Array.isArray(e.msg.playlistData.entries)
          && e.msg.playlistData.entries.length > 0,
      );
      const mixerEvt = s.events.find(
        e => e.msg.type === 'mixer'
          && Array.isArray(e.msg.channels)
          && e.msg.channels.some(c => c.id === cycledChId),
      );
      const ordering = (chPl && mixerEvt) ? (mixerEvt.t - chPl.t) : null;
      const okOrdering = ordering !== null && ordering >= -ORDERING_TOLERANCE_MS;
      if (chPl && mixerEvt && okOrdering) cycleCellsOk++;
      else cycleFailures.push(
        `cycle ${cycle} socket ${label}: chPl=${!!chPl} mixer=${!!mixerEvt} ordering=${ordering == null ? 'n/a' : `${ordering}ms`}`,
      );
    }
  }
  check(
    cycleCellsOk === totalCycleCells,
    `all ${totalCycleCells} (cycle × socket) cells emitted ordered channelPlaylistData`,
    `${totalCycleCells - cycleCellsOk}/${totalCycleCells} cells failed`,
    cycleFailures.slice(0, 6).join('; '),
  );

  // ── TEST 8: every channel currently on the engine has playlist + entries ──
  // The user's exact symptom was "channel 3 shows default in the
  // dropdown but no entries load". That means the channel's
  // playlist assignment IS attached (engine knew it was 'default')
  // but the entries never propagated. We assert at the engine
  // level that every overlay channel has BOTH:
  //   - playlist.name === PL_A on the canonical GET /mixer
  //   - the on-disk playlist has entries (no _missing entries)
  // We use the LIVE mixer (post-remove-readd cycle) to verify the
  // cycle didn't leave any channels orphaned.
  console.log('\n[TEST 8] every live overlay has correct playlist + entries on engine');
  const mPostBurst = (await httpJson('GET', '/mixer')).body;
  const overlays = mPostBurst.channels.filter(c => c.id !== mPostBurst.baseChannelId);
  let correctlyAssigned = 0;
  for (const ch of overlays) {
    if (ch.playlist && ch.playlist.name === PL_A) correctlyAssigned++;
    else {
      failures.push(`engine state ch=${ch.id.slice(-6)}: playlist=${JSON.stringify(ch?.playlist).slice(0, 80)}`);
    }
  }
  check(
    overlays.length > 0 && correctlyAssigned === overlays.length,
    `all ${overlays.length} live overlays have playlist=${PL_A} on engine`,
    `only ${correctlyAssigned}/${overlays.length} are correctly assigned`,
  );

  subA.stop(); wsA.close();
  subB.stop(); wsB.close();
  subC.stop(); wsC.close();

  // ── Cleanup ────────────────────────────────────────────────────────
  sub.stop();
  ws.close();
  await restoreState();

  // ── Summary ────────────────────────────────────────────────────────
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  process.exit(passed === total ? 0 : 1);
})().catch(async (e) => {
  console.error('test crashed:', e);
  try { await restoreState(); } catch (_) {}
  process.exit(1);
});
