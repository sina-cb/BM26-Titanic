/**
 * hil_add_button_latency_test.mjs — verify the iPad "ADDING…"
 * button can never stay stuck for more than ADD_TIMEOUT_MS, even
 * under heavy WS load.
 *
 * The user reported: "the button keeps staying as adding". The
 * iPad shows "ADDING…" until the POST /mixer/channels HTTP
 * response is parsed by the iPad. If that promise resolves slowly
 * (because the iPad's JS thread is starved by 10Hz vis + mixer
 * broadcasts firing setChannels / PixelStrip re-renders), the
 * button feels stuck.
 *
 * This test pumps the engine with the iPad's worst-case
 * concurrent load (3 simultaneous WS clients all receiving
 * mixer + vis at 10Hz) and measures HTTP round-trip latency for
 * back-to-back adds + removes. If the engine itself ever takes
 * longer than ADD_TIMEOUT_MS to respond, the iPad CANNOT
 * possibly clear the button faster — so this is the engine-side
 * floor for the user's perceived button responsiveness.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     node tests/hil/hil_add_button_latency_test.mjs
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1.  POST /mixer/channels response latency (HTTP RTT) for each
 *       of N=3 sequential adds, with 3 WS clients connected.
 *       Each MUST complete in < ADD_TIMEOUT_MS.
 *   2.  Remove + re-add latency for the LAST channel, 3 times.
 *       Each cycle's add MUST complete in < ADD_TIMEOUT_MS.
 *   3.  Worst-case mean RTT across all adds.
 *   4.  Engine emits a valid mixer broadcast within
 *       BROADCAST_TIMEOUT_MS of each add (sanity).
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
const WS_URL = 'ws://127.0.0.1:6968';

const ADD_TIMEOUT_MS = 250;          // iPad's perceived "stuck" threshold
const BROADCAST_TIMEOUT_MS = 250;
const MEAN_RTT_BUDGET_MS = 100;

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

const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

const cleanup = { snapshot: null, done: false, hilPlaylistName: 'hil_add_button_latency', hilPlaylistCreated: false };
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
    await deleteAllOverlays();
    for (const c of (cleanup.snapshot?.channels || [])) {
      if (c.id === cleanup.snapshot.baseChannelId) continue;
      await httpJson('POST', '/mixer/channels', {
        playlist: c.playlist?.name || 'default',
        playlistEntryId: c.playlist?.activeEntryId,
        name: c.name, mode: c.mode, fader: c.fader,
      });
    }
    console.log(`  restored ${(cleanup.snapshot?.channels?.length || 1) - 1} overlay channel(s)`);
    if (cleanup.hilPlaylistCreated) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(cleanup.hilPlaylistName)}`);
        console.log(`  deleted test playlist: ${cleanup.hilPlaylistName}`);
      } catch (_) {}
    }
  } catch (e) { console.warn('  cleanup warn:', e.message); }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => { try { await restore(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); } });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_add_button_latency_test.mjs — POST RTT under WS load');
  console.log('==========================================================');

  cleanup.snapshot = (await httpJson('GET', '/mixer')).body;
  console.log(`\n── Setup ──`);
  console.log(`  snapshot: ${cleanup.snapshot.channels.length} channel(s), base=${cleanup.snapshot.baseChannelId}`);
  const maxChannels = cleanup.snapshot.maxChannels || 4;
  const burstSize = Math.max(1, maxChannels - 1);
  await deleteAllOverlays();
  await sleep(150);

  // Open 3 WS clients to simulate the iPad's worst-case load
  // (mixer.tsx, RigGlobals, Audio tab). We do NOT throttle these —
  // each one receives every mixer + vis broadcast, exactly like
  // the iPad does. If the engine can't service POST /mixer/channels
  // fast under THIS load, the iPad's button WILL stay stuck.
  console.log(`  opening 3 WS clients (simulating iPad worst case)...`);
  const wsA = await openWs();
  const wsB = await openWs();
  const wsC = await openWs();
  // Drain WS — we measure HTTP latency, not WS bytes. We also let
  // the listeners accumulate frames for the broadcast-timing test.
  const wsCEvents = [];
  wsC.on('message', raw => { try { wsCEvents.push({ t: Date.now(), msg: JSON.parse(raw) }); } catch {} });

  // ── TEST 1: each burst-add HTTP RTT < ADD_TIMEOUT_MS ──────────────
  console.log(`\n[TEST 1] burst-add (${burstSize}) HTTP RTT under 3-WS load`);
  const addIds = [];
  const addRTTs = [];
  for (let i = 0; i < burstSize; i++) {
    const t0 = Date.now();
    const r = await httpJson('POST', '/mixer/channels', {
      playlist: 'default', name: `latency_${i}`, mode: 'blend_screen', fader: 1.0,
    });
    const dt = Date.now() - t0;
    addRTTs.push(dt);
    if (r.status === 200 && r.body?.channelId) addIds.push(r.body.channelId);
    check(
      dt < ADD_TIMEOUT_MS,
      `add #${i + 1} RTT ${dt} ms < ${ADD_TIMEOUT_MS} ms budget`,
      `add #${i + 1} RTT ${dt} ms > ${ADD_TIMEOUT_MS} ms budget — iPad button will appear stuck`,
    );
  }
  const meanRTT = Math.round(addRTTs.reduce((a, b) => a + b, 0) / addRTTs.length);
  check(
    meanRTT < MEAN_RTT_BUDGET_MS,
    `mean burst-add RTT ${meanRTT} ms < ${MEAN_RTT_BUDGET_MS} ms budget`,
    `mean burst-add RTT ${meanRTT} ms over budget`,
  );

  // ── TEST 2: remove + re-add cycle — exact user scenario ───────────
  console.log(`\n[TEST 2] remove + re-add cycle (3x) RTT — exact user scenario`);
  let cycleId = addIds[addIds.length - 1];
  for (let cycle = 0; cycle < 3; cycle++) {
    await httpJson('DELETE', `/mixer/channels/${cycleId}`);
    await sleep(120);
    const t0 = Date.now();
    const r = await httpJson('POST', '/mixer/channels', {
      playlist: 'default', name: `relat_${cycle}`, mode: 'blend_screen', fader: 1.0,
    });
    const dt = Date.now() - t0;
    if (r.status === 200 && r.body?.channelId) cycleId = r.body.channelId;
    check(
      dt < ADD_TIMEOUT_MS,
      `cycle ${cycle + 1} re-add RTT ${dt} ms < ${ADD_TIMEOUT_MS} ms`,
      `cycle ${cycle + 1} re-add RTT ${dt} ms > ${ADD_TIMEOUT_MS} ms — iPad button will appear stuck`,
    );
  }

  // ── TEST 3: WS mixer broadcast lands quickly after the add ────────
  console.log(`\n[TEST 3] WS mixer broadcast within ${BROADCAST_TIMEOUT_MS} ms of POST`);
  await deleteAllOverlays();
  await sleep(120);
  wsCEvents.length = 0;
  const t3PostStart = Date.now();
  const lastAdd = await httpJson('POST', '/mixer/channels', {
    playlist: 'default', name: 'broadcast_check', mode: 'blend_screen', fader: 1.0,
  });
  const t3RespAt = Date.now();
  await sleep(BROADCAST_TIMEOUT_MS + 100);
  const mixerEvt = wsCEvents.find(e => e.msg.type === 'mixer'
    && e.msg.channels?.some(c => c.id === lastAdd.body?.channelId));
  check(
    mixerEvt && (mixerEvt.t - t3PostStart) < BROADCAST_TIMEOUT_MS,
    `mixer broadcast lands ${mixerEvt ? mixerEvt.t - t3PostStart : 'n/a'} ms after POST`,
    `mixer broadcast late or missing`,
  );

  wsA.close(); wsB.close(); wsC.close();

  await restore();
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('  burst RTTs: [' + addRTTs.join(', ') + '] ms  (mean ' + meanRTT + ' ms)');
  console.log('==========================================================\n');
  process.exit(passed === total ? 0 : 1);
})().catch(async (e) => {
  console.error('test crashed:', e);
  try { await restore(); } catch (_) {}
  process.exit(1);
});
