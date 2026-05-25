/**
 * hil_ws_audio_settle_test.mjs — HIL test for audio-config settle time.
 *
 * The operator's complaint that triggered the WS topic split:
 *
 *   > the audio config tab is still very slow → right now saying
 *   > "loading audio config" for more than 30s and no settings yet.
 *   > FYI, when I remove 2 channels from the mixer, and only kept 1,
 *   > the audio settings popped up super fast.
 *
 * Root cause was a single WebSocketServer fanning vis frames (10 Hz ×
 * N channels × pixel buffer) and audio-analyser ticks (15-30 Hz ×
 * ~1.5 KB) to every client, so the iPad's onmessage handler was
 * spending so much time JSON.parsing chatter that the REST
 * /audio/config response sat behind it in the event loop.
 *
 * Post-split, the audio tab only opens /ws/control + /ws/signals and
 * never pays for vis frames. This test reproduces the operator's
 * "3 mixer channels seeded, then open audio tab" scenario and asserts
 * the audio-config payload lands FAST.
 *
 * Contract:
 *
 *   1. With 3 mixer overlay channels seeded, a fresh GET /audio/config
 *      returns inside 500 ms — even while the engine is publishing
 *      vis frames at full cadence. (This is the REST roundtrip;
 *      pre-split it would still return fast on the wire because HTTP
 *      and WS are independent, but it's a useful baseline.)
 *
 *   2. A fresh /ws/control subscriber receives the audioStatus replay
 *      payload inside 2 s of opening the socket. (This is what makes
 *      the audio-tab pill paint warm immediately.)
 *
 *   3. A fresh /ws/control subscriber does NOT receive any vis frame
 *      in the same window — i.e. the heavy traffic is fully isolated
 *      on /ws/viz.
 *
 *   4. A fresh /ws/signals subscriber either receives a liveParams
 *      replay payload OR (if analyser disabled in config.yaml) no
 *      liveParams at all — but again, never any vis frame.
 *
 *   5. A /ws/viz subscriber that opens at the same time receives vis
 *      frames at the configured cadence. (Sanity check that we didn't
 *      isolate vis into nothingness.)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     node tests/hil/hil_ws_audio_settle_test.mjs [--port 31168]
 *
 * Exit code 0 on full pass, 1 on any failure.
 */

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ENGINE_ROOT, 'states', 'test_bench');

const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const PORT = portIdx !== -1 && argv[portIdx + 1] ? parseInt(argv[portIdx + 1], 10) : 31168;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_HOST = `127.0.0.1:${PORT}`;

const AUDIO_CONFIG_DEADLINE_MS = 500;
const AUDIO_STATUS_REPLAY_DEADLINE_MS = 2000;
const VIS_OBSERVE_WINDOW_MS = 2000;

// ── helpers ─────────────────────────────────────────────────────────────
function httpReq(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, BASE);
    const t0 = Date.now();
    const req = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json' },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const dt = Date.now() - t0;
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null, ms: dt }); }
        catch { resolve({ status: res.statusCode, body: data, ms: dt }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openTopic(topicPath) {
  return new Promise((resolve, reject) => {
    const url = `ws://${WS_HOST}${topicPath}`;
    const ws = new WebSocket(url);
    const seen = []; // { type, t, bytes }
    const openedAt = { t: 0 };
    ws.once('open', () => { openedAt.t = Date.now(); resolve({ ws, seen, openedAt }); });
    ws.once('error', (e) => { if (!openedAt.t) reject(e); });
    ws.on('message', (raw) => {
      let o; try { o = JSON.parse(raw.toString()); } catch { return; }
      if (o && typeof o.type === 'string') seen.push({ type: o.type, t: Date.now(), bytes: raw.length });
    });
  });
}

// ── state snapshot/restore — never leave the test_bench state dirty ────
const STATE_FILES = ['deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml', 'global_effect_slots.yaml'];
const stateSnapshot = {};
function snapshotState() {
  for (const f of STATE_FILES) {
    const p = path.join(STATE_DIR, f);
    if (fs.existsSync(p)) stateSnapshot[f] = fs.readFileSync(p, 'utf8');
  }
}
function restoreState() {
  for (const f of STATE_FILES) {
    if (stateSnapshot[f] !== undefined) {
      fs.writeFileSync(path.join(STATE_DIR, f), stateSnapshot[f]);
    }
  }
}

// ── engine lifecycle ────────────────────────────────────────────────────
let engineProc = null;
function startEngine() {
  return new Promise((resolve, reject) => {
    const logPath = path.join('/tmp', `hil_ws_audio_settle_${PORT}.log`);
    const out = fs.openSync(logPath, 'w');
    const err = fs.openSync(logPath, 'a');
    engineProc = spawn(
      process.execPath,
      [
        path.join(ENGINE_ROOT, 'engine.js'),
        '--pattern', 'test_const',
        '--model', 'test_bench',
        '--port', String(PORT),
      ],
      { cwd: ENGINE_ROOT, stdio: ['ignore', out, err] }
    );
    engineProc.once('error', reject);
    engineProc.once('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`engine exited with code ${code}. See ${logPath}`);
      }
    });
    const deadline = Date.now() + 15000;
    (async () => {
      while (Date.now() < deadline) {
        try {
          const r = await httpReq('GET', '/mixer');
          if (r && r.status === 200) return resolve();
        } catch {}
        await sleep(250);
      }
      reject(new Error(`engine did not come up on ${PORT} within 15s. See ${logPath}`));
    })();
  });
}
function stopEngine() {
  return new Promise((resolve) => {
    if (!engineProc || engineProc.killed) return resolve();
    engineProc.once('exit', () => resolve());
    engineProc.kill('SIGTERM');
    setTimeout(() => { if (engineProc && !engineProc.killed) engineProc.kill('SIGKILL'); resolve(); }, 3000);
  });
}

// ── Seed mixer with 3 channels so we reproduce the operator's scenario ─
async function seedMixerWith3Channels() {
  // /mixer reports current channels including the base/deck. The
  // operator's complaint was "3 channels" on the mixer surface, which
  // means 3 OVERLAY channels (plus the deck). The HIL test target is
  // the worst-case the operator hit, so we make sure there are at
  // least 3 channels visible on the mixer view.
  const r = await httpReq('GET', '/mixer');
  const existing = (r.body && Array.isArray(r.body.channels)) ? r.body.channels.length : 0;
  const want = 3;
  let added = 0;
  while (existing + added < want) {
    const a = await httpReq('POST', '/mixer/channel', {});
    if (a.status !== 200 && a.status !== 201) {
      // Hit the cap or the API rejected — break and let the test
      // report what it observed.
      console.warn(`  ! add-channel returned ${a.status}; stopping at ${existing + added} channels`);
      break;
    }
    added++;
  }
  const after = await httpReq('GET', '/mixer');
  const finalCount = (after.body && Array.isArray(after.body.channels)) ? after.body.channels.length : 0;
  return finalCount;
}

// ── results ─────────────────────────────────────────────────────────────
const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

// ── tests ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\n========================================================');
  console.log('  HIL Test — WS audio-config settle time (3 channels)');
  console.log('========================================================\n');

  snapshotState();
  await startEngine();
  console.log(`Engine up on ${BASE}`);

  try {
    const seeded = await seedMixerWith3Channels();
    console.log(`Mixer seeded with ${seeded} channels (target 3)\n`);

    // ─── TEST 1: GET /audio/config returns fast even with 3 channels ─
    console.log('[TEST 1] GET /audio/config under mixer load');
    const cfg = await httpReq('GET', '/audio/config');
    console.log(`  /audio/config returned in ${cfg.ms} ms (status ${cfg.status})`);
    check(cfg.status === 200,
      `/audio/config returned 200`,
      `/audio/config returned ${cfg.status}`);
    check(cfg.ms < AUDIO_CONFIG_DEADLINE_MS,
      `/audio/config returned in ${cfg.ms} ms (< ${AUDIO_CONFIG_DEADLINE_MS} ms)`,
      `/audio/config too slow`,
      `${cfg.ms} ms ≥ ${AUDIO_CONFIG_DEADLINE_MS} ms`);

    // ─── TEST 2: /ws/control replays audioStatus quickly ─────────────
    console.log('\n[TEST 2] /ws/control replays audioStatus within 2 s');
    const ctlConn = await openTopic('/ws/control');
    const audioStatusDeadline = ctlConn.openedAt.t + AUDIO_STATUS_REPLAY_DEADLINE_MS;
    let audioStatusSeenAt = 0;
    while (Date.now() < audioStatusDeadline) {
      const hit = ctlConn.seen.find(m => m.type === 'audioStatus');
      if (hit) { audioStatusSeenAt = hit.t; break; }
      await sleep(50);
    }
    if (audioStatusSeenAt) {
      const dt = audioStatusSeenAt - ctlConn.openedAt.t;
      ok(`audioStatus arrived on /ws/control in ${dt} ms`);
    } else {
      fail(`audioStatus did not arrive on /ws/control within ${AUDIO_STATUS_REPLAY_DEADLINE_MS} ms`,
        'replay-on-connect is broken or audio module unwired');
    }

    // ─── TEST 3: /ws/control sees NO vis frames ──────────────────────
    console.log('\n[TEST 3] /ws/control sees no vis frames');
    const ctlConn2 = await openTopic('/ws/control');
    await sleep(VIS_OBSERVE_WINDOW_MS);
    const visOnCtl = ctlConn2.seen.filter(m => m.type === 'vis').length;
    check(visOnCtl === 0,
      `no vis frames on /ws/control in ${VIS_OBSERVE_WINDOW_MS} ms`,
      `vis frames leaked onto /ws/control`,
      `${visOnCtl} frames — the whole point of the split is that they shouldn't be here`);

    // ─── TEST 4: /ws/signals sees no vis frames either ───────────────
    console.log('\n[TEST 4] /ws/signals sees no vis frames');
    const sigConn = await openTopic('/ws/signals');
    await sleep(VIS_OBSERVE_WINDOW_MS);
    const visOnSig = sigConn.seen.filter(m => m.type === 'vis').length;
    check(visOnSig === 0,
      `no vis frames on /ws/signals in ${VIS_OBSERVE_WINDOW_MS} ms`,
      `vis frames leaked onto /ws/signals`,
      `${visOnSig} frames`);

    // ─── TEST 5: /ws/viz DOES receive vis frames (sanity) ────────────
    console.log('\n[TEST 5] /ws/viz still receives vis frames');
    const vizConn = await openTopic('/ws/viz');
    await sleep(VIS_OBSERVE_WINDOW_MS);
    const visOnViz = vizConn.seen.filter(m => m.type === 'vis').length;
    check(visOnViz >= 1,
      `vis frames flowed on /ws/viz (${visOnViz} in ${VIS_OBSERVE_WINDOW_MS} ms)`,
      `no vis frames on /ws/viz`,
      'split broke the vis pipeline entirely');

    // ─── TEST 6: simulate the audio-tab open path end-to-end ─────────
    console.log('\n[TEST 6] Audio tab open: REST /audio/config + WS controls + signals settle');
    // Open both sockets the audio tab opens in production, then issue
    // the REST fetch, and measure when EVERYTHING the tab needs to
    // render its first frame is in hand.
    const t0 = Date.now();
    const [ctl3, sig3] = await Promise.all([
      openTopic('/ws/control'),
      openTopic('/ws/signals'),
    ]);
    const cfgPromise = httpReq('GET', '/audio/config');
    const cfgRes = await cfgPromise;
    // Wait until we've seen at least one audioStatus on control (or
    // the deadline elapses) — that's the warm pill the tab needs.
    const settleDeadline = t0 + AUDIO_STATUS_REPLAY_DEADLINE_MS;
    while (Date.now() < settleDeadline) {
      if (ctl3.seen.find(m => m.type === 'audioStatus')) break;
      await sleep(25);
    }
    const settleMs = Date.now() - t0;
    console.log(`  open WS + /audio/config + audioStatus replay = ${settleMs} ms (cfg ${cfgRes.ms} ms)`);
    check(settleMs < AUDIO_STATUS_REPLAY_DEADLINE_MS,
      `audio tab full-paint readiness in ${settleMs} ms (< ${AUDIO_STATUS_REPLAY_DEADLINE_MS} ms)`,
      `audio tab too slow to settle`,
      `${settleMs} ms ≥ ${AUDIO_STATUS_REPLAY_DEADLINE_MS} ms`);

    // ─── cleanup ─────────────────────────────────────────────────────
    for (const c of [ctlConn, ctlConn2, sigConn, vizConn, ctl3, sig3]) {
      try { c.ws.close(); } catch {}
    }
  } finally {
    await stopEngine();
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n========================================================');
  console.log(`SUMMARY: ${passed}/${total} assertions passed`);
  console.log('========================================================\n');
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error('\nTest harness error:', err);
  stopEngine().finally(() => { try { restoreState(); } catch {}; process.exit(1); });
});
