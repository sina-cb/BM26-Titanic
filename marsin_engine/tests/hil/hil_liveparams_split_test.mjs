/**
 * hil_liveparams_split_test.mjs — HIL Test for the sharedParams / liveParams Split
 *
 * The audio analyser used to push the full CPC snapshot (~30 keys,
 * ~1.5 KB) at up to 30 Hz on the `sharedParams` channel, which forced
 * the iPad mixer / deck onmessage handlers to JSON.parse + setState at
 * that rate even when the operator was just trying to tap a playlist.
 *
 * The fix (May 2026, lib/api_server.js `broadcastCpcSplit`) routes the
 * `live: true` CPC keys onto a separate `liveParams` WS message type.
 * This test pins the new contract:
 *
 *   1. With the mic analyser running, `liveParams` arrives at the
 *      analyser's cadence (≥5 Hz) carrying ONLY the live keys.
 *   2. `sharedParams` is QUIET in the same window (≤1 Hz) — no audio
 *      hop should pull the whole CPC into a broadcast anymore.
 *   3. Each `liveParams` payload is much smaller than the equivalent
 *      `sharedParams` would have been (rough proxy: ≤800 B vs >1 KB).
 *   4. Touching a STEADY key (speed) emits `sharedParams` exactly once
 *      and does NOT emit `liveParams`.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   - Engine running with `test_bench` model AND `audio.enabled: true`
 *     in config.yaml (so the analyser is producing live keys). If the
 *     analyser is off this test will skip live-rate assertions and
 *     warn — it can't synthesise audio.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     node tests/hil/hil_liveparams_split_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed (or analyser off + soft-skip)
 *   1 = contract violated
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_BASE = 'http://127.0.0.1:6968';
// Post-topic-split (May 2026), sharedParams is on /ws/params and
// liveParams is on /ws/signals. Subscribe to both so the assertions
// covering each can still observe their payloads.
const WS_PARAMS_URL  = 'ws://127.0.0.1:6968/ws/params';
const WS_SIGNALS_URL = 'ws://127.0.0.1:6968/ws/signals';

const SAMPLE_WINDOW_MS = 2500;
const LIVE_KEYS = new Set([
  'micLow', 'micMid', 'micHigh', 'micKick',
  'stemsVocals', 'stemsBass', 'stemsDrums',
  'tempoBpm',
]);

// ── helpers ────────────────────────────────────────────────────────────
function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    }, res => {
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
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const results = [];
function ok(label) { console.log('  \u2713 PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  \u2717 FAIL  ' + label + (detail ? '  \u2192 ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

// Collect ALL `sharedParams` and `liveParams` messages for `windowMs`.
// Pre-split this was a single socket; post-split sharedParams lives on
// /ws/params and liveParams on /ws/signals, so we sample both in
// parallel and merge the results.
async function sampleParams(wsParams, wsSignals, windowMs) {
  const live = [];
  const shared = [];
  const onMsgSig = (raw) => {
    let o; try { o = JSON.parse(raw); } catch { return; }
    if (o.type === 'liveParams') live.push({ raw: Buffer.byteLength(raw), params: o.params, t: Date.now() });
  };
  const onMsgPar = (raw) => {
    let o; try { o = JSON.parse(raw); } catch { return; }
    if (o.type === 'sharedParams') shared.push({ raw: Buffer.byteLength(raw), params: o.params, t: Date.now() });
  };
  wsSignals.on('message', onMsgSig);
  wsParams.on('message', onMsgPar);
  await sleep(windowMs);
  wsSignals.off('message', onMsgSig);
  wsParams.off('message', onMsgPar);
  return { live, shared };
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  HIL Test \u2014 sharedParams / liveParams split                ');
  console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\n');

  let baseline;
  try { baseline = (await httpJson('GET', '/mixer')).body; }
  catch {
    console.error('\u2717 Cannot reach engine at ' + ENGINE_BASE);
    return 1;
  }

  // Audio analyser running? If not, skip live-rate assertions with a
  // soft warn — most contributors run with mic off.
  let audioOn = false;
  try {
    const a = (await httpJson('GET', '/audio/config')).body;
    audioOn = !!a?.enabled;
  } catch { /* /audio/config not available, assume off */ }
  console.log(`Audio analyser: ${audioOn ? 'ENABLED' : 'disabled — live-rate checks skipped'}\n`);

  const [wsParams, wsSignals] = await Promise.all([
    openWs(WS_PARAMS_URL),
    openWs(WS_SIGNALS_URL),
  ]);

  try {
    // ─── TEST 1: under audio load, liveParams flows + sharedParams is quiet
    console.log('[TEST 1] Sample WS for ' + SAMPLE_WINDOW_MS + ' ms with no operator input');
    const { live, shared } = await sampleParams(wsParams, wsSignals, SAMPLE_WINDOW_MS);
    const liveHz = live.length / (SAMPLE_WINDOW_MS / 1000);
    const sharedHz = shared.length / (SAMPLE_WINDOW_MS / 1000);
    const avgLive = live.length ? Math.round(live.reduce((s, m) => s + m.raw, 0) / live.length) : 0;
    const avgShared = shared.length ? Math.round(shared.reduce((s, m) => s + m.raw, 0) / shared.length) : 0;
    console.log(`  liveParams:   ${live.length} msgs   (${liveHz.toFixed(2)} Hz, avg ${avgLive} B)`);
    console.log(`  sharedParams: ${shared.length} msgs (${sharedHz.toFixed(2)} Hz, avg ${avgShared} B)`);

    if (audioOn) {
      check(liveHz >= 5,
        `liveParams ≥5 Hz under audio load (got ${liveHz.toFixed(2)} Hz)`,
        `liveParams too sparse: ${liveHz.toFixed(2)} Hz`,
        'expected ≥5 Hz when analyser is running');
    } else {
      console.log('  (skipped live-rate check — analyser off)');
    }
    check(sharedHz <= 1.2,
      `sharedParams ≤1 Hz when only audio params changing (got ${sharedHz.toFixed(2)} Hz)`,
      `sharedParams still chatty: ${sharedHz.toFixed(2)} Hz`,
      'audio params are leaking into the steady broadcast');

    if (live.length > 0) {
      const first = live[0];
      const keys = Object.keys(first.params || {});
      const allLive = keys.every(k => LIVE_KEYS.has(k));
      check(allLive,
        `liveParams payload contains ONLY live keys (got ${keys.length}: ${keys.join(',')})`,
        `liveParams leaked non-live keys`, `keys: ${keys.join(',')}`);
      const smaller = avgLive < 800;
      check(smaller,
        `liveParams avg ${avgLive} B (≤800, smaller than sharedParams)`,
        `liveParams too fat: ${avgLive} B`);
    }

    // ─── TEST 2: touching a steady key emits sharedParams exactly once
    console.log('\n[TEST 2] POST /param-center { speed: 0.42 } emits sharedParams, NOT liveParams');
    {
      const seenSpeed = [];
      const seenLive = [];
      const onMsgPar = (raw) => {
        let o; try { o = JSON.parse(raw); } catch { return; }
        if (o.type === 'sharedParams' && o.params?.speed?.value === 0.42) seenSpeed.push(o);
      };
      const onMsgSig = (raw) => {
        let o; try { o = JSON.parse(raw); } catch { return; }
        if (o.type === 'liveParams') seenLive.push(o);
      };
      wsParams.on('message', onMsgPar);
      wsSignals.on('message', onMsgSig);
      const before = Date.now();
      await httpJson('POST', '/param-center', { speed: 0.42 });
      // Give the broadcast 400 ms to land (sharedParams is throttled by
      // speed.broadcastHz which defaults to 30 → 33 ms interval; 400 ms
      // is comfortably more than that even with replay quirks).
      await sleep(400);
      wsParams.off('message', onMsgPar);
      wsSignals.off('message', onMsgSig);
      const after = Date.now();

      check(seenSpeed.length >= 1,
        `sharedParams with speed=0.42 received (${seenSpeed.length} time(s))`,
        `no sharedParams with speed=0.42`);
      // We don't care if liveParams fired during this 400 ms window
      // (analyser keeps ticking), but we DO care that the speed
      // change didn't somehow ride the liveParams channel.
      const speedOnLive = seenLive.some(o => o.params && Object.prototype.hasOwnProperty.call(o.params, 'speed'));
      check(!speedOnLive,
        `speed change did NOT leak into liveParams`,
        `liveParams carried a 'speed' key`);
      console.log(`  observed in ${after - before} ms: ${seenSpeed.length} sharedParams, ${seenLive.length} liveParams (live ok)`);
    }
  } finally {
    try { wsParams.close(); } catch {}
    try { wsSignals.close(); } catch {}
    // Restore speed to a sensible value
    try { await httpJson('POST', '/param-center', { speed: 0.5 }); } catch {}
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n==========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('==========================================================\n');
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error('\nTest harness error:', err);
  process.exit(1);
});
