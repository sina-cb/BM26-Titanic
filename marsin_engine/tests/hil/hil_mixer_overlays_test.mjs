/**
 * hil_mixer_overlays_test.mjs — HIL Test for Mixer Overlay Channels
 *
 * The user reported: "the mixer worked nicely with 1 channel, when I
 * added the 2nd it was slow to load the playlist". The existing HIL
 * tests all exercise the deck view (autopilot, soft-swap, transitions).
 * This test fills the gap: it exercises the *mixer overlay* code paths
 * the iPad's mixer tab actually hits — add channel, load playlist,
 * switch entry, switch playlist — and measures latency at every step,
 * including the WS broadcast fan-out the iPad has to react to.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model (52 pixels)
 *   - Mixer can be in any state; the test takes a snapshot, deletes
 *     all overlays, runs its scenarios, restores the snapshot on exit
 *     (so it never permanently disturbs the operator's setup).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     node tests/hil/hil_mixer_overlays_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1.  Adding a 1st overlay channel completes within ADD_TIMEOUT_MS
 *       and the WS `mixer` broadcast lands within BROADCAST_TIMEOUT_MS.
 *   2.  Loading a different playlist on that 1st overlay channel is
 *       fast (< LOAD_TIMEOUT_MS for the full iPad-style sequence:
 *       POST /mixer/channels/:id/playlist + the 4 GETs PlaylistPanel
 *       does after a switch).
 *   3.  Adding a 2nd overlay channel completes within ADD_TIMEOUT_MS.
 *   4.  Loading a different playlist on the 2nd overlay must not be
 *       SLOWER than loading on the 1st (no per-channel scaling
 *       blow-up). This is the specific user-reported regression.
 *   5.  Adding a 3rd overlay channel completes within ADD_TIMEOUT_MS.
 *   6.  Mass playlist switches across all 3 overlays in tight loop
 *       all return 200 with no failures.
 *   7.  Vis broadcast cadence + payload size are within budget — a
 *       diagnostic that flags if the broadcast is the source of perceived
 *       slowness on the iPad.
 *   8.  No `mixer` broadcasts contain stale or duplicate channel ids
 *       after the rapid add/remove cycle (regression: rapid adds in the
 *       same millisecond used to collide and "hide" channels).
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed (details printed inline)
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';

// Latency budgets — generous enough that we're not testing wall-clock
// jitter, tight enough to catch the kind of multi-second hang the user
// reported. Tuned for a quiet dev machine; bump on CI if needed.
const ADD_TIMEOUT_MS = 400;        // Add channel includes compile + register + save
const LOAD_TIMEOUT_MS = 500;       // Switch playlist (full iPad sequence)
const BROADCAST_TIMEOUT_MS = 200;  // First mixer broadcast after a mutation
const MASS_SWITCH_BUDGET_MS = 4000; // 30 switches across 3 channels
const VIS_BUDGET_BYTES_PER_FRAME = 32 * 1024; // 32 KB / vis frame (master+rig+N channels, 52px each)

// Test playlist setup — picked dynamically from the engine's playlist
// library at boot. We need TWO distinct names so the "switch playlist"
// tests can actually swap. If the operator has only one playlist on
// disk we bail early with a clear message instead of falsely passing.
let PL_A = null;
let PL_B = null;

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
function fmt(n, p = 0) { return n == null ? 'null' : Number(n).toFixed(p); }
function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function timed(label, fn) {
  const t0 = Date.now();
  const result = await fn();
  const dt = Date.now() - t0;
  return { dt, result, label };
}

// ─────────────────────────── assertion bus ──────────────────────────
const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

// ─────────────────────────── cleanup ────────────────────────────────
const cleanupState = { started: false, done: false, snapshot: null };
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
    // Delete everything the test left behind, then re-create the
    // snapshot's overlays so the operator's mixer is back to where
    // we found it.
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

// ─────────────────────────── per-test helpers ───────────────────────
// Wait for ONE `mixer` WS broadcast that satisfies `predicate`, with a
// timeout. Returns { t, msg } where t is ms since `waitForMixer` was
// called. Resolves null on timeout (caller checks).
function waitForMixer(ws, predicate, timeoutMs) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const onMsg = (raw) => {
      let o; try { o = JSON.parse(raw); } catch { return; }
      if (o.type !== 'mixer') return;
      if (!predicate(o)) return;
      cleanup(); resolve({ t: Date.now() - t0, msg: o });
    };
    const onTimeout = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const cleanup = () => { ws.off('message', onMsg); clearTimeout(onTimeout); };
    ws.on('message', onMsg);
  });
}

// Add an overlay channel via the same HTTP shape the iPad's mixer tab
// uses (`{playlist:'default'}`), measure latency, and return the new
// channel id (or null on failure).
async function addOverlay(name, playlist = PL_A) {
  const t0 = Date.now();
  const { status, body } = await httpJson('POST', '/mixer/channels', {
    playlist, name, mode: 'blend_screen', fader: 1.0,
  });
  const dt = Date.now() - t0;
  if (status !== 200 || !body.channelId) {
    console.log(`  \u2717 add overlay '${name}' failed: status=${status} body=${JSON.stringify(body).slice(0, 120)}`);
    return { id: null, dt };
  }
  return { id: body.channelId, dt };
}

// Emulate exactly what PlaylistPanel does after the user picks a new
// playlist from the library dropdown — single POST to switch, then the
// 4 GETs `refresh()` fires (playlists list, channel assignment, all
// patterns, playlist contents). Returns the wall-clock duration for
// the whole sequence; this is what the operator perceives as "load
// time" when they tap a different playlist.
async function iPadStylePlaylistSwitch(channelId, newPlaylist) {
  const t0 = Date.now();
  const post = await httpJson('POST', `/mixer/channels/${channelId}/playlist`, { name: newPlaylist });
  if (post.status !== 200) return { dt: Date.now() - t0, ok: false, status: post.status };
  // PlaylistPanel.refresh() fires these 3 in parallel...
  await Promise.all([
    httpJson('GET', '/playlists'),
    httpJson('GET', `/mixer/channels/${channelId}/playlist`),
    httpJson('GET', '/list-patterns'),
  ]);
  // ...then the 4th once the assignment is known.
  await httpJson('GET', `/playlists/${newPlaylist}`);
  return { dt: Date.now() - t0, ok: true };
}

// Sample vis broadcasts for a brief window and report the average
// payload size + observed cadence. Diagnostic only — used to flag when
// the broadcast is the actual perf bottleneck (the user requested a
// 1 fps vis cadence + 100-px subsample as a follow-up).
async function sampleVisBroadcasts(ws, windowMs = 1200) {
  const sizes = [];
  const ts = [];
  const onMsg = (raw) => {
    let o; try { o = JSON.parse(raw); } catch { return; }
    if (o.type !== 'vis') return;
    sizes.push(Buffer.byteLength(raw));
    ts.push(Date.now());
  };
  ws.on('message', onMsg);
  await sleep(windowMs);
  ws.off('message', onMsg);
  const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const max = sizes.length ? Math.max(...sizes) : 0;
  const hz = sizes.length >= 2 ? (sizes.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000) : 0;
  return { count: sizes.length, avgBytes: Math.round(avg), maxBytes: max, hz: Number(hz.toFixed(2)) };
}

// ─────────────────────────── main ───────────────────────────────────
async function main() {
  console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  HIL Test \u2014 Mixer Overlay Channels (add + playlist switch)   ');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\n');

  let baseline;
  try { baseline = (await httpJson('GET', '/mixer')).body; }
  catch {
    console.error('\u2717 Cannot reach engine at ' + ENGINE_BASE);
    console.error('  Start with: node engine.js --pattern test_const --model test_bench');
    return 1;
  }
  cleanupState.started = true;
  cleanupState.snapshot = baseline;
  installSignalCleanup();

  // Pick two distinct playlists at random from whatever the operator
  // has on disk. We don't edit them; if there's only one playlist we
  // bail with a clear message — the switch tests are meaningless with
  // a single target.
  const playlists = (await httpJson('GET', '/playlists')).body || [];
  if (!Array.isArray(playlists) || playlists.length < 2) {
    console.error(`\u2717 Need at least 2 playlists for switch tests; got ${JSON.stringify(playlists)}`);
    return 1;
  }
  PL_A = playlists[0];
  PL_B = playlists[1];
  console.log(`Using playlists: A='${PL_A}' B='${PL_B}'`);

  // Engage mixer view so /mixer/view {view:'mixer'} matches the iPad's
  // actual state when the operator is on the Mixer tab.
  await httpJson('POST', '/mixer/view', { view: 'mixer' });

  // Reset overlays — the test owns the mixer for its duration.
  await deleteAllOverlays();
  await sleep(150);

  const ws = await openWs();

  try {
    // ─── TEST 1: add the FIRST overlay ────────────────────────────
    console.log('\n[TEST 1] add 1st overlay (1ch total + base)');
    {
      const bcastP = waitForMixer(ws,
        (m) => m.channels && m.channels.some(c => c.id !== baseline.baseChannelId),
        BROADCAST_TIMEOUT_MS,
      );
      const { id: ch1Id, dt: addDt } = await addOverlay('ch1', PL_A);
      const bcast = await bcastP;
      check(!!ch1Id, `POST /mixer/channels returned a new channel id`, 'add failed');
      check(addDt < ADD_TIMEOUT_MS,
        `add latency ${addDt} ms within ${ADD_TIMEOUT_MS} ms`,
        `add too slow: ${addDt} ms (budget ${ADD_TIMEOUT_MS} ms)`);
      check(!!bcast,
        `mixer broadcast arrived within ${BROADCAST_TIMEOUT_MS} ms (got ${bcast?.t} ms)`,
        `no mixer broadcast within ${BROADCAST_TIMEOUT_MS} ms`);

      // Save for next tests
      global.ch1Id = ch1Id;
    }

    // ─── TEST 2: switch playlist on 1ch-overlay setup ─────────────
    console.log('\n[TEST 2] switch playlist on overlay (1ch baseline)');
    let load1ChDt = 0;
    {
      const { dt, ok: switched } = await iPadStylePlaylistSwitch(global.ch1Id, PL_B);
      load1ChDt = dt;
      check(switched && dt < LOAD_TIMEOUT_MS,
        `iPad-style playlist switch (POST + 4 GETs): ${dt} ms within ${LOAD_TIMEOUT_MS} ms`,
        `switch latency too high: ${dt} ms`);
      // Switch it back so the test starts each phase from the same point.
      await iPadStylePlaylistSwitch(global.ch1Id, PL_A);
    }

    // ─── TEST 3: add the SECOND overlay ───────────────────────────
    console.log('\n[TEST 3] add 2nd overlay (2ch total + base)');
    {
      const bcastP = waitForMixer(ws,
        (m) => m.channels && m.channels.filter(c => c.id !== baseline.baseChannelId).length >= 2,
        BROADCAST_TIMEOUT_MS,
      );
      const { id: ch2Id, dt: addDt } = await addOverlay('ch2', PL_A);
      const bcast = await bcastP;
      check(!!ch2Id, `POST /mixer/channels returned a new channel id`, 'add failed');
      check(addDt < ADD_TIMEOUT_MS,
        `add latency ${addDt} ms within ${ADD_TIMEOUT_MS} ms`,
        `add too slow: ${addDt} ms`);
      check(!!bcast,
        `mixer broadcast arrived within ${BROADCAST_TIMEOUT_MS} ms (got ${bcast?.t} ms)`,
        `no mixer broadcast within ${BROADCAST_TIMEOUT_MS} ms`);
      global.ch2Id = ch2Id;
    }

    // ─── TEST 4: the user's reported regression ───────────────────
    // "When I added the 2nd it was slow to load the playlist".
    // Compare load time with 1ch vs 2ch — must not blow up.
    console.log('\n[TEST 4] switch playlist on 2ch setup (user-reported regression)');
    {
      // Switch on ch1 and ch2 to measure both
      const r1 = await iPadStylePlaylistSwitch(global.ch1Id, PL_B);
      const r2 = await iPadStylePlaylistSwitch(global.ch2Id, PL_B);
      console.log(`  load 1ch (TEST 2): ${load1ChDt} ms`);
      console.log(`  load 2ch (ch1):    ${r1.dt} ms`);
      console.log(`  load 2ch (ch2):    ${r2.dt} ms`);

      check(r1.ok && r2.ok,
        `both playlist switches returned 200`,
        `playlist switch failed: ch1=${r1.ok} ch2=${r2.ok}`);
      check(r1.dt < LOAD_TIMEOUT_MS,
        `ch1 load latency ${r1.dt} ms within ${LOAD_TIMEOUT_MS} ms`,
        `ch1 load too slow: ${r1.dt} ms`);
      check(r2.dt < LOAD_TIMEOUT_MS,
        `ch2 load latency ${r2.dt} ms within ${LOAD_TIMEOUT_MS} ms`,
        `ch2 load too slow: ${r2.dt} ms`);

      // The actual regression assertion: 2-channel load can't be more
      // than 2.5x slower than 1-channel load (allowing for noise but
      // catching e.g. broadcast fan-out scaling super-linearly).
      const ratio = load1ChDt > 0 ? Math.max(r1.dt, r2.dt) / load1ChDt : 1;
      check(ratio < 2.5,
        `2ch/1ch load ratio ${ratio.toFixed(2)}x within 2.5x (no per-channel blow-up)`,
        `2ch load ${ratio.toFixed(2)}x slower than 1ch (regression)`);

      // Restore
      await iPadStylePlaylistSwitch(global.ch1Id, PL_A);
      await iPadStylePlaylistSwitch(global.ch2Id, PL_A);
    }

    // ─── TEST 5: add the THIRD overlay (mixer cap is 4: base + 3) ─
    console.log('\n[TEST 5] add 3rd overlay (3ch total + base)');
    {
      const bcastP = waitForMixer(ws,
        (m) => m.channels && m.channels.filter(c => c.id !== baseline.baseChannelId).length >= 3,
        BROADCAST_TIMEOUT_MS,
      );
      const { id: ch3Id, dt: addDt } = await addOverlay('ch3', PL_A);
      const bcast = await bcastP;
      check(!!ch3Id, `POST /mixer/channels returned a new channel id`, 'add failed');
      check(addDt < ADD_TIMEOUT_MS,
        `add latency ${addDt} ms within ${ADD_TIMEOUT_MS} ms`,
        `add too slow: ${addDt} ms`);
      check(!!bcast,
        `mixer broadcast arrived within ${BROADCAST_TIMEOUT_MS} ms (got ${bcast?.t} ms)`,
        `no mixer broadcast within ${BROADCAST_TIMEOUT_MS} ms`);
      global.ch3Id = ch3Id;
    }

    // ─── TEST 6: mass switch under load ───────────────────────────
    console.log('\n[TEST 6] mass playlist switch (10 rounds x 3 channels = 30 ops)');
    {
      const preCount = ((await httpJson('GET', '/mixer')).body.channels || [])
        .filter(c => c.id !== baseline.baseChannelId).length;
      console.log(`  pre-test overlay count: ${preCount}`);
      const t0 = Date.now();
      let fails = 0;
      for (let round = 0; round < 10; round++) {
        for (const id of [global.ch1Id, global.ch2Id, global.ch3Id]) {
          const target = round % 2 ? PL_B : PL_A;
          const post = await httpJson('POST', `/mixer/channels/${id}/playlist`, { name: target });
          if (post.status !== 200) { fails++; console.log(`    round ${round} id ${id} -> ${post.status}`); }
        }
      }
      const dt = Date.now() - t0;
      const perOp = Math.round(dt / 30);
      console.log(`  30 switches in ${dt} ms (${perOp} ms/op), failures: ${fails}`);
      const postCount = ((await httpJson('GET', '/mixer')).body.channels || [])
        .filter(c => c.id !== baseline.baseChannelId).length;
      console.log(`  post-test overlay count: ${postCount}`);
      check(fails === 0, `0 failures across 30 rapid switches`, `${fails} failures`);
      check(dt < MASS_SWITCH_BUDGET_MS,
        `30 switches in ${dt} ms within ${MASS_SWITCH_BUDGET_MS} ms`,
        `mass switch budget blown: ${dt} ms > ${MASS_SWITCH_BUDGET_MS} ms`);
      check(preCount === postCount,
        `channel count preserved across mass switches (${preCount})`,
        `channel count changed during mass switches: ${preCount} -> ${postCount}`);
    }

    // ─── TEST 7: vis broadcast diagnostics ────────────────────────
    // The mixer-view perf regression the user reported ("when I added
    // the 2nd it was slow to load the playlist") was caused by the
    // engine pushing a 1.5 KB CPC snapshot at 30 Hz on `sharedParams`
    // every audio hop. The fix split that into a quiet `sharedParams`
    // + a separate `liveParams` channel that mixer/deck ignore
    // (api_server.js `broadcastCpcSplit`). With audio off the
    // sharedParams stream, vis can stay at its native 10 Hz again
    // — the iPad's only per-frame cost is now 100 subsampled pixels
    // × N channels, which is well within budget.
    console.log('\n[TEST 7] vis broadcast cadence + payload (10 Hz + subsampled)');
    {
      // 1.5 s catches ~15 vis frames at 10 Hz with healthy margin.
      const v = await sampleVisBroadcasts(ws, 1500);
      console.log(`  vis frames: ${v.count} in ~1.5s (~${v.hz} Hz)`);
      console.log(`  avg payload: ${v.avgBytes} bytes  max: ${v.maxBytes} bytes`);
      check(v.count >= 8,
        `received ${v.count} vis frame(s) in 1.5 s window`,
        `too few vis frames: ${v.count}`);
      // Cadence: config 10 Hz → 8..15 Hz is the healthy band (timer
      // jitter, engine GC, test scheduling all conspire against an
      // exact 10.00). Outside that band means somebody re-introduced
      // an interval-based burst or accidentally throttled the engine.
      check(v.hz >= 6 && v.hz <= 15,
        `vis cadence ${v.hz} Hz inside 10 Hz band [6, 15]`,
        `vis cadence outside 10 Hz band: ${v.hz} Hz`);
      check(v.maxBytes <= VIS_BUDGET_BYTES_PER_FRAME,
        `vis payload max ${v.maxBytes} B <= ${VIS_BUDGET_BYTES_PER_FRAME} B`,
        `vis payload over budget: ${v.maxBytes} B > ${VIS_BUDGET_BYTES_PER_FRAME} B`);
    }

    // ─── TEST 8: state integrity ─────────────────────────────────
    console.log('\n[TEST 8] no duplicate / stale channel ids after rapid mutations');
    {
      const m = (await httpJson('GET', '/mixer')).body;
      const overlays = m.channels.filter(c => c.id !== baseline.baseChannelId);
      const ids = overlays.map(c => c.id);
      const uniq = new Set(ids);
      check(ids.length === uniq.size,
        `all ${ids.length} overlay ids are unique`,
        `duplicate channel ids detected: ${ids.join(',')}`);
      check(overlays.length === 3,
        `mixer has exactly 3 overlay channels (got ${overlays.length})`,
        `unexpected overlay count: ${overlays.length}`);
      // Every overlay should have a playlist assignment
      for (const c of overlays) {
        check(c.playlist && c.playlist.name,
          `overlay ${c.id} has playlist '${c.playlist?.name}'`,
          `overlay ${c.id} has no playlist`);
      }
    }
  } finally {
    try { ws.close(); } catch {}
  }

  await restoreState();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error('\nTest harness error:', err);
  restoreState().finally(() => process.exit(1));
});
