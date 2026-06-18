/**
 * hil_ws_topic_split_test.mjs — HIL test for the WS topic split.
 *
 * The engine fans every broadcast onto one of four sockets
 * (/ws/control, /ws/params, /ws/signals, /ws/viz). The split exists
 * because pre-split, every audio-analyser tick (15-30 Hz × 1.5 KB)
 * and every vis frame (10 Hz × N channels × pixel buffer) was being
 * delivered to every WS client, so the iPad's onmessage handler had
 * to parse + filter every single message even when the operator was
 * just trying to load the audio config tab.
 *
 * This test pins the topology end-to-end:
 *
 *   1. The engine accepts WS upgrades ONLY on the four canonical
 *      topic paths plus the `/` back-compat alias. Any other path
 *      gets HTTP 400.
 *   2. The four topic-keyed broadcasts land on the expected socket
 *      and ONLY on that socket:
 *        - mixer / deck / pattern / autopilot / playlistLibrary /
 *          oscStats / audioStatus    →  /ws/control
 *        - sharedParams              →  /ws/params
 *        - liveParams                →  /ws/signals
 *        - vis                       →  /ws/viz
 *   3. Vis frames must NOT leak onto /ws/control or /ws/params or
 *      /ws/signals. This is the whole point of the split — the audio
 *      tab opens /ws/control + /ws/signals and must never pay for
 *      vis-frame JSON.parse.
 *   4. The root path `/` back-compat alias receives /ws/control
 *      payloads only (no vis, no liveParams) so legacy clients still
 *      see UI/state but don't get re-flooded.
 *
 * Owns its own engine process per slot (so it runs cleanly in the
 * multi-agent worktree harness without conflicting with the main
 * checkout's engine on 6968).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     node tests/hil/hil_ws_topic_split_test.mjs [--port 31168]
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

const SAMPLE_WINDOW_MS = 2500;

const KNOWN_TOPICS = ['control', 'params', 'signals', 'viz'];
const TOPIC_PATHS = {
  control: '/ws/control',
  params:  '/ws/params',
  signals: '/ws/signals',
  viz:     '/ws/viz',
};

// Snapshot of which message types are EXPECTED on which topic. Mirrors
// the engine's lib/ws_topic_routing.js TOPIC_BY_TYPE. Kept here as the
// "what the iPad expects to see" contract — if this drifts from the
// engine table the test will fail loud (intentional: the routing
// table is the source of truth, this snapshot is the client contract).
const EXPECTED_TOPIC_BY_TYPE = {
  // /ws/control — UI/state
  mixer:                       'control',
  deck:                        'control',
  pattern:                     'control',
  autopilot:                   'control',
  viewOverride:                'control',
  deckTransitionConfig:        'control',
  deckSwapStarted:             'control',
  deckSwapComplete:            'control',
  mixerTransitionStarted:      'control',
  mixerTransitionComplete:     'control',
  mixerTransitionRejected:     'control',
  globalEffectSlots:           'control',
  globalEffectMacroStatus:     'control',
  playlistLibrary:             'control',
  playlistSaved:               'control',
  playlistDeleted:             'control',
  channelPlaylistData:         'control',
  playlistEntryCaptured:       'control',
  paramRejected:               'control',
  audioStatus:                 'control',
  oscStats:                    'control',
  stats:                       'control',
  groupFixedColors:            'control',
  scheduledTasks:              'control',
  // docs/29: chain-editor reconcile rebroadcast after PUT/PATCH/reset.
  audioChainsChanged:          'control',
  // docs/30: sparse drop-instant event from the audio structure detector.
  dropFired:                   'control',
  // /ws/params — steady CPC
  sharedParams:                'params',
  modulationState:             'params',
  // /ws/signals — audio meters
  liveParams:                  'signals',
  // docs/29: 5 Hz per-op chain preview (gated by subscribeChains).
  signalChain:                 'signals',
  // /ws/viz — frames
  vis:                         'viz',
};

// ── helpers ─────────────────────────────────────────────────────────────
function httpReq(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, BASE);
    const req = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json' },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openTopic(topic) {
  return new Promise((resolve, reject) => {
    const url = `ws://${WS_HOST}${TOPIC_PATHS[topic]}`;
    const ws = new WebSocket(url);
    const seen = []; // { type, t, raw_bytes }
    let opened = false;
    ws.once('open', () => { opened = true; resolve({ ws, seen, opened: () => opened }); });
    ws.once('error', (e) => { if (!opened) reject(e); });
    ws.on('message', (raw) => {
      let o; try { o = JSON.parse(raw.toString()); } catch { return; }
      if (o && typeof o.type === 'string') seen.push({ type: o.type, t: Date.now(), bytes: raw.length });
    });
  });
}

function tryUpgrade(p) {
  // Attempt a raw HTTP upgrade to path `p` and capture the response.
  // We don't use `ws` here because we want to see the engine's actual
  // 400 response, not the library's error wrapper.
  return new Promise((resolve) => {
    const req = http.request({
      method: 'GET',
      hostname: '127.0.0.1',
      port: PORT,
      path: p,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('upgrade', (res) => {
      // Successful upgrade — close immediately.
      res.socket.destroy();
      resolve({ status: 101 });
    });
    req.on('response', (res) => {
      // Server refused — capture status.
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

// ── state snapshot/restore ──────────────────────────────────────────────
// The split test pokes /autopilot, /param-center, and /mixer/view-override
// which the engine persists to disk. Snapshot before, restore in finally,
// so the worktree is clean after the test run regardless of outcome.
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
    const logPath = path.join('/tmp', `hil_ws_topic_split_${PORT}.log`);
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
  console.log('  HIL Test — WS topic split');
  console.log('========================================================\n');

  snapshotState();
  await startEngine();
  console.log(`Engine up on ${BASE}\n`);

  try {
    // ─── TEST 1: upgrade routing ────────────────────────────────────────
    console.log('[TEST 1] Upgrade routing');
    for (const t of KNOWN_TOPICS) {
      const r = await tryUpgrade(TOPIC_PATHS[t]);
      check(r.status === 101,
        `${TOPIC_PATHS[t]} upgrade accepted (101)`,
        `${TOPIC_PATHS[t]} upgrade failed`,
        `status=${r.status}`);
    }
    // Root path is the back-compat alias for /ws/control.
    {
      const r = await tryUpgrade('/');
      check(r.status === 101,
        `/ upgrade accepted (back-compat alias for /ws/control)`,
        `/ upgrade was rejected`,
        `status=${r.status}`);
    }
    // Unknown path must be rejected with 400 — explicit failure, not
    // a silently-empty socket.
    {
      const r = await tryUpgrade('/ws/bogus');
      check(r.status === 400,
        `/ws/bogus upgrade rejected with 400`,
        `/ws/bogus upgrade not rejected`,
        `status=${r.status}`);
    }

    // ─── TEST 2: per-topic broadcast isolation ─────────────────────────
    console.log('\n[TEST 2] Per-topic broadcast isolation');
    // Open all four sockets plus the root alias simultaneously so we
    // can compare what each one received over the same 2.5 s window.
    const [ctl, par, sig, viz, root] = await Promise.all([
      openTopic('control'),
      openTopic('params'),
      openTopic('signals'),
      openTopic('viz'),
      // root is `/` — connect manually:
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${WS_HOST}/`);
        const seen = [];
        let opened = false;
        ws.once('open', () => { opened = true; resolve({ ws, seen, opened: () => opened }); });
        ws.once('error', (e) => { if (!opened) reject(e); });
        ws.on('message', (raw) => {
          let o; try { o = JSON.parse(raw.toString()); } catch { return; }
          if (o && typeof o.type === 'string') seen.push({ type: o.type, t: Date.now(), bytes: raw.length });
        });
      }),
    ]);

    // Stimulate the system so traffic flows on every topic:
    //   - control: trigger autopilot pattern + a playlist save/delete + viewOverride
    //   - params:  poke a steady CPC key (speed)
    //   - signals: depends on audio analyser (may or may not be live)
    //   - viz:     render loop publishes vis frames at vis.broadcastHz
    try { await httpReq('POST', '/autopilot', { active: false }); } catch {}
    try { await httpReq('POST', '/param-center', { speed: 0.42 }); } catch {}
    try { await httpReq('POST', '/mixer/view-override', { view: 'mixer' }); } catch {}
    // Bounce back to deck so subsequent runs don't leave the view on mixer.
    try { await httpReq('POST', '/mixer/view-override', { view: 'deck' }); } catch {}

    await sleep(SAMPLE_WINDOW_MS);

    const byTopic = {
      control: ctl.seen,
      params:  par.seen,
      signals: sig.seen,
      viz:     viz.seen,
    };
    for (const t of KNOWN_TOPICS) {
      const types = new Set(byTopic[t].map(m => m.type));
      console.log(`  ${TOPIC_PATHS[t]} — ${byTopic[t].length} msgs: ${[...types].join(', ') || '(none)'}`);
    }
    console.log(`  / (root alias) — ${root.seen.length} msgs: ${[...new Set(root.seen.map(m => m.type))].join(', ') || '(none)'}`);

    // Build observed type → topic map from what landed.
    const observedTopicByType = {};
    for (const t of KNOWN_TOPICS) {
      for (const m of byTopic[t]) {
        if (observedTopicByType[m.type] && observedTopicByType[m.type] !== t) {
          fail(`message type "${m.type}" leaked across topics`,
            `seen on ${observedTopicByType[m.type]} AND ${t}`);
        }
        observedTopicByType[m.type] = t;
      }
    }
    // Compare every observed type against the expected snapshot.
    for (const [type, observed] of Object.entries(observedTopicByType)) {
      const expected = EXPECTED_TOPIC_BY_TYPE[type];
      if (!expected) {
        fail(`unknown message type "${type}" — not in EXPECTED_TOPIC_BY_TYPE`,
          'add it to the snapshot AND to lib/ws_topic_routing.js');
        continue;
      }
      check(observed === expected,
        `${type} → ${TOPIC_PATHS[observed]}`,
        `${type} routed to wrong topic`,
        `expected ${expected}, got ${observed}`);
    }
    // Required types must have been seen on the right topic at least
    // once. We don't require liveParams (depends on audio config).
    const REQUIRED_SEEN = ['mixer', 'sharedParams', 'oscStats', 'audioStatus', 'vis'];
    for (const t of REQUIRED_SEEN) {
      check(!!observedTopicByType[t],
        `${t} broadcast observed`,
        `${t} broadcast not observed in ${SAMPLE_WINDOW_MS} ms window`);
    }

    // ─── TEST 3: vis frames are isolated to /ws/viz ────────────────────
    console.log('\n[TEST 3] vis frames are isolated to /ws/viz');
    const visOnViz = byTopic.viz.filter(m => m.type === 'vis').length;
    const visOnCtl = byTopic.control.filter(m => m.type === 'vis').length;
    const visOnPar = byTopic.params.filter(m => m.type === 'vis').length;
    const visOnSig = byTopic.signals.filter(m => m.type === 'vis').length;
    const visOnRoot = root.seen.filter(m => m.type === 'vis').length;
    check(visOnViz >= 1,
      `vis frames flowed on /ws/viz (${visOnViz} in ${SAMPLE_WINDOW_MS} ms)`,
      `no vis frames on /ws/viz`);
    check(visOnCtl === 0,
      `no vis frames leaked onto /ws/control`,
      `vis frames leaked onto /ws/control`,
      `${visOnCtl} frames`);
    check(visOnPar === 0,
      `no vis frames leaked onto /ws/params`,
      `vis frames leaked onto /ws/params`,
      `${visOnPar} frames`);
    check(visOnSig === 0,
      `no vis frames leaked onto /ws/signals`,
      `vis frames leaked onto /ws/signals`,
      `${visOnSig} frames`);
    check(visOnRoot === 0,
      `no vis frames leaked onto root / back-compat socket`,
      `vis frames leaked onto root /`,
      `${visOnRoot} frames`);

    // ─── TEST 4: sharedParams / liveParams stay split ──────────────────
    console.log('\n[TEST 4] sharedParams / liveParams stay split');
    const sharedOnPar = byTopic.params.filter(m => m.type === 'sharedParams').length;
    const sharedOnCtl = byTopic.control.filter(m => m.type === 'sharedParams').length;
    const sharedOnSig = byTopic.signals.filter(m => m.type === 'sharedParams').length;
    const liveOnSig = byTopic.signals.filter(m => m.type === 'liveParams').length;
    const liveOnPar = byTopic.params.filter(m => m.type === 'liveParams').length;
    const liveOnCtl = byTopic.control.filter(m => m.type === 'liveParams').length;
    check(sharedOnPar >= 1,
      `sharedParams arrived on /ws/params (${sharedOnPar} times)`,
      `sharedParams missing from /ws/params`);
    check(sharedOnCtl === 0 && sharedOnSig === 0,
      `sharedParams isolated on /ws/params`,
      `sharedParams leaked`,
      `control=${sharedOnCtl}, signals=${sharedOnSig}`);
    // liveParams may be zero if the audio analyser isn't running; we
    // only fail if it appeared on the WRONG topic.
    check(liveOnPar === 0 && liveOnCtl === 0,
      `liveParams isolated on /ws/signals${liveOnSig > 0 ? ` (${liveOnSig} obs)` : ' (analyser idle)'}`,
      `liveParams leaked`,
      `params=${liveOnPar}, control=${liveOnCtl}`);

    // ─── TEST 5: root alias mirrors control only ───────────────────────
    console.log('\n[TEST 5] Root path / mirrors /ws/control only');
    // Every type on root should also be on control.
    const rootTypes = new Set(root.seen.map(m => m.type));
    const ctlTypes = new Set(byTopic.control.map(m => m.type));
    for (const t of rootTypes) {
      check(ctlTypes.has(t),
        `root saw "${t}" — also on /ws/control`,
        `root saw "${t}" but /ws/control did not`);
    }
    // Root must NOT see params/signals/viz-only types.
    const nonControlOnRoot = [...rootTypes].filter(t => EXPECTED_TOPIC_BY_TYPE[t] && EXPECTED_TOPIC_BY_TYPE[t] !== 'control');
    check(nonControlOnRoot.length === 0,
      `root saw only control-topic types`,
      `non-control types leaked onto root`,
      nonControlOnRoot.join(', '));

    // ─── cleanup ───────────────────────────────────────────────────────
    for (const s of [ctl, par, sig, viz, root]) {
      try { s.ws.close(); } catch {}
    }
    // Restore CPC speed so we leave the engine in a sane place.
    try { await httpReq('POST', '/param-center', { speed: 0.5 }); } catch {}
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
