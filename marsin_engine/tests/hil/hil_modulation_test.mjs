/**
 * hil_modulation_test.mjs — end-to-end HIL test for Dynamic Audio
 * Parameter Mapping (docs/26).
 *
 * Boots its own engine on port 31068 (slot 0 per 13_multi_agent.md §5),
 * creates a throwaway playlist with a single 13_sparkle entry, attaches
 * a `localSpeed ← micLow` modulation, drives micLow via POST
 * /param-center, then asserts:
 *
 *   - REST CRUD (PUT/PATCH/DELETE) on the modulations endpoint round-trips.
 *   - `modulationState` WS frames arrive with the right shape.
 *   - The modulated value tracks the source within ±0.02.
 *   - DELETE-ing the mapping causes modulationState to stop carrying
 *     that target (restore-base-on-removal).
 *   - Disk persistence — re-reading the playlist shows the saved mapping.
 *
 * ── How to Run ─────────────────────────────────────────────────────────
 *   cd marsin_engine
 *   node tests/hil/hil_modulation_test.mjs
 *
 * Override port: MARSIN_HIL_PORT=31168 node tests/hil/hil_modulation_test.mjs
 *
 * Exit 0 on full pass, 1 on assertion failure, 2 on setup error.
 */

import http from 'http';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');

const PORT = parseInt(process.env.MARSIN_HIL_PORT || '31068', 10);
const ENGINE_BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;

const TEST_PLAYLIST = 'hil_modulation_test';
const TEST_ENTRY_ID = 'e_hil_mod_0';
const TEST_MAPPING_ID = 'mod_localSpeed_micLow_test';
const TEST_PATTERN = '13_sparkle';
// Modulation targets are the SLIDER function export name (kind=1, the
// `slider*` setter), not the underlying var. This mirrors the codebase
// convention used by playlist defaults (see scenes/test_bench/playlists/
// default.yaml — `sliderLocalSpeed`, `sliderNoiseScale`).
const TARGET_PARAM = 'sliderLocalSpeed';

let engineProc = null;
let testPlaylistCreated = false;

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openWs(path = '/') {
  // Post-topic-split: `modulationState` rides /ws/params (see
  // lib/ws_topic_routing.js). The bare `/` socket maps to /ws/control
  // as a back-compat alias and will NOT receive modulationState
  // frames. Callers that need them must pass `/ws/params` explicitly.
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + path);
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
  if (cond) ok(passLabel);
  else fail(failLabel || passLabel, failDetail);
}

function startEngine() {
  return new Promise((resolve, reject) => {
    const logPath = path.join('/tmp', `hil_modulation_${PORT}.log`);
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
        console.error(`engine exited unexpectedly with code ${code}. See ${logPath}`);
      }
    });
    const deadline = Date.now() + 20000;
    const poll = async () => {
      while (Date.now() < deadline) {
        try {
          const r = await httpJson('GET', '/mixer');
          if (r && r.body && r.body.channels !== undefined) return resolve(logPath);
        } catch {}
        await sleep(250);
      }
      reject(new Error(`engine did not boot on port ${PORT} within 20s. See ${logPath}`));
    };
    poll();
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

async function cleanup() {
  console.log('\n── Cleanup ──');
  try {
    if (testPlaylistCreated) {
      try {
        // Switch the deck off our test playlist before deleting it,
        // otherwise the engine keeps a stale activeEntryId pointing
        // at a vanished entry.
        await httpJson('POST', '/deck/playlist', { name: null });
      } catch {}
      try {
        const r = await httpJson('DELETE', `/playlists/${encodeURIComponent(TEST_PLAYLIST)}`);
        console.log(`  deleted test playlist: ${TEST_PLAYLIST} (status=${r.status})`);
      } catch (e) {
        console.warn(`  could not delete ${TEST_PLAYLIST}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  cleanup failed: ${e.message}`);
  }
  await stopEngine();
  // Reset micLow back to 0 — though the engine's about to die anyway.
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.error(`\nReceived ${sig}; cleaning up...`);
    try { await cleanup(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
  });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_modulation_test.mjs — modulation end-to-end on port', PORT);
  console.log('==========================================================');

  console.log('\n[SETUP] booting engine...');
  let logPath;
  try {
    logPath = await startEngine();
    console.log('  engine up. log: ' + logPath);
  } catch (e) {
    console.error('  FATAL: engine boot failed:', e.message);
    process.exit(2);
  }

  // 1. Create the test playlist with one entry. localSpeed default 0.3,
  //    no modulation yet (we'll PUT it next).
  const createRes = await httpJson('POST', '/playlists', {
    name: TEST_PLAYLIST,
    entries: [{
      id: TEST_ENTRY_ID,
      pattern: TEST_PATTERN,
      label: 'Sparkle for mod test',
      defaults: { [TARGET_PARAM]: 0.3 },
      notes: null,
    }],
  });
  if (createRes.status !== 200) {
    console.error('  FATAL: could not create test playlist. body=', JSON.stringify(createRes.body));
    await cleanup();
    process.exit(2);
  }
  testPlaylistCreated = true;
  console.log(`  created playlist ${TEST_PLAYLIST}`);

  // 2. Load it on the deck so the controller picks up the entry.
  let r = await httpJson('POST', '/deck/playlist', { name: TEST_PLAYLIST });
  if (r.status !== 200) {
    console.error('  FATAL: deck load failed. body=', JSON.stringify(r.body));
    await cleanup(); process.exit(2);
  }
  // Wait for the deck swap (it may use a transition) to settle.
  await sleep(1500);
  // Force the active entry just in case.
  await httpJson('POST', '/deck/playlist/entry', { entryId: TEST_ENTRY_ID });
  await sleep(1500);

  // ── TEST 1: PUT mapping creates it ────────────────────────────────
  console.log('\n[TEST 1] PUT modulation creates a mapping');
  {
    const mapping = {
      type: 'continuous',
      enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: TARGET_PARAM },
      mode: 'offset', polarity: 'unipolar',
      range: [0, 0.4], curve: 'linear',
    };
    const r = await httpJson(
      'PUT',
      `/api/playlists/${TEST_PLAYLIST}/items/${TEST_ENTRY_ID}/modulations/${TEST_MAPPING_ID}`,
      mapping,
    );
    check(r.status === 200, `PUT returned 200 (got ${r.status})`, 'PUT failed',
      `body=${JSON.stringify(r.body).slice(0, 300)}`);
    check(r.body && r.body.entry && Array.isArray(r.body.entry.modulations)
      && r.body.entry.modulations.length === 1
      && r.body.entry.modulations[0].id === TEST_MAPPING_ID,
      'response.entry.modulations has the new mapping',
      'response missing or wrong modulation',
      `body=${JSON.stringify(r.body).slice(0, 300)}`);
  }

  // ── TEST 2: disk round-trip ───────────────────────────────────────
  console.log('\n[TEST 2] GET /playlists/<name> shows persisted mapping');
  {
    const r = await httpJson('GET', `/playlists/${TEST_PLAYLIST}`);
    check(r.status === 200, 'GET 200', 'GET failed');
    const entry = r.body && r.body.entries && r.body.entries.find(e => e.id === TEST_ENTRY_ID);
    check(entry && entry.modulations && entry.modulations.length === 1,
      'disk has 1 mapping for entry',
      'expected 1 mapping on disk',
      `entry=${JSON.stringify(entry).slice(0, 200)}`);
  }

  // ── TEST 3: drive micLow, observe modulationState WS ─────────────
  console.log('\n[TEST 3] modulationState arrives with tracked value');
  {
    // Pin micLow's source to 'api' so the live audio analyzer (running
    // off the host mic by default in test_bench) can't overwrite our
    // synthesized value mid-test.
    await httpJson('POST', '/param-center/source-lock', {
      mode: 'per-param', leases: { micLow: 'api' },
    });
    // modulationState lives on /ws/params after the topic split — the
    // bare `/` socket only sees /ws/control traffic.
    const ws = await openWs('/ws/params');
    const events = [];
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.type === 'modulationState') events.push(m);
      } catch {}
    });
    // Drive micLow halfway through its range and hold for a few frames.
    for (let i = 0; i < 6; i++) {
      await httpJson('POST', '/param-center', { micLow: 0.5 });
      await sleep(100);
    }
    ws.close();
    check(events.length > 0,
      `received ${events.length} modulationState frame(s)`,
      'no modulationState received',
    );
    const latest = events[events.length - 1];
    if (latest) {
      const p = latest.parameters && latest.parameters[TARGET_PARAM];
      check(!!p, `parameters.${TARGET_PARAM} present`, 'target missing from frame',
        `frame=${JSON.stringify(latest).slice(0, 300)}`);
      if (p) {
        check(p.source === 'micLow', `source === 'micLow'`, 'wrong source',
          `p=${JSON.stringify(p)}`);
        check(p.mappingId === TEST_MAPPING_ID, 'mappingId matches', 'wrong mappingId',
          `p=${JSON.stringify(p)}`);
        // micLow=0.5, range [0, 0.4], unipolar offset → delta = 0.2.
        // baseline localSpeed = 0.3 (entry default) → modulated ≈ 0.5.
        const expected = 0.5;
        const diff = Math.abs(p.modulated - expected);
        check(diff < 0.05, `modulated≈${expected} (got ${p.modulated.toFixed(3)})`,
          `modulated value off by ${diff.toFixed(3)}`,
          `p=${JSON.stringify(p)}`);
      }
    }
  }

  // Release the source lock so other tests don't see stale leases.
  await httpJson('POST', '/param-center/source-lock', null);

  // ── TEST 4: PATCH disables the mapping, value freezes to base ────
  console.log('\n[TEST 4] PATCH enabled:false bypasses modulation');
  {
    const r = await httpJson(
      'PATCH',
      `/api/playlists/${TEST_PLAYLIST}/items/${TEST_ENTRY_ID}/modulations/${TEST_MAPPING_ID}`,
      { enabled: false },
    );
    check(r.status === 200, `PATCH 200 (got ${r.status})`, 'PATCH failed',
      `body=${JSON.stringify(r.body).slice(0, 300)}`);
    // After disabling, the controller stops writing modulated values and
    // restores base ONE-SHOT, then no more modulationState frames carry
    // this target. micLow stays at 0.5 from previous test.
    await sleep(300);
    const ws = await openWs('/ws/params');
    const events = [];
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.type === 'modulationState') events.push(m);
      } catch {}
    });
    await sleep(400);
    ws.close();
    const carriesTarget = events.some(e => e.parameters && e.parameters[TARGET_PARAM]);
    check(!carriesTarget,
      'no modulationState frames carry the disabled target',
      'still receiving modulated frames after disable',
    );
  }

  // ── TEST 5: PUT validation rejects bad input ─────────────────────
  console.log('\n[TEST 5] PUT rejects invalid mapping with 400');
  {
    const r = await httpJson(
      'PUT',
      `/api/playlists/${TEST_PLAYLIST}/items/${TEST_ENTRY_ID}/modulations/${TEST_MAPPING_ID}_bad`,
      {
        type: 'continuous', enabled: true,
        source: { scope: 'cpc', key: 'micLow' },
        target: { scope: 'pattern', parameter: 'other' },
        mode: 'offset', polarity: 'unipolar',
        range: [0, 5], curve: 'linear',   // out-of-bounds range
      },
    );
    check(r.status === 400, `PUT 400 (got ${r.status})`, 'expected 400',
      `body=${JSON.stringify(r.body).slice(0, 300)}`);
    check(r.body && typeof r.body.error === 'string' && r.body.error.includes('range'),
      'error mentions range',
      'error message unclear',
      `body=${JSON.stringify(r.body).slice(0, 200)}`);
  }

  // ── TEST 6: PATCH source change (operator-reported bulletproof) ──
  console.log('\n[TEST 6] PATCH source: micLow → micMid round-trips');
  {
    // First re-enable + reset the mapping to a known state — TEST 4
    // left it `enabled: false`. This is the exact flow the operator
    // hits: open popover, change SOURCE chip, hit SAVE.
    const r = await httpJson(
      'PATCH',
      `/api/playlists/${TEST_PLAYLIST}/items/${TEST_ENTRY_ID}/modulations/${TEST_MAPPING_ID}`,
      {
        id: TEST_MAPPING_ID,
        type: 'continuous', enabled: true,
        source: { scope: 'cpc', key: 'micMid' },
        target: { scope: 'pattern', parameter: TARGET_PARAM },
        mode: 'offset', polarity: 'unipolar',
        range: [0, 0.4], curve: 'linear',
      },
    );
    check(r.status === 200, `PATCH source-change 200 (got ${r.status})`,
      'PATCH source-change failed',
      `body=${JSON.stringify(r.body).slice(0, 300)}`);
    const disk = await httpJson('GET', `/playlists/${TEST_PLAYLIST}`);
    const entry = disk.body && disk.body.entries && disk.body.entries.find(e => e.id === TEST_ENTRY_ID);
    const m = entry && entry.modulations && entry.modulations[0];
    check(m && m.source && m.source.key === 'micMid',
      'disk shows source.key = micMid',
      'source.key did not flip',
      `m=${JSON.stringify(m).slice(0, 300)}`);
    // The id MUST be preserved across a source-change PATCH so the
    // operator's subsequent DELETE (which still targets the original
    // url) finds the mapping.
    check(m && m.id === TEST_MAPPING_ID,
      'mapping.id preserved across source change',
      'id changed',
      `m=${JSON.stringify(m).slice(0, 300)}`);
  }

  // ── TEST 7: DELETE emits final empty modulationState (ghost clear) ─
  console.log('\n[TEST 7] DELETE emits one final empty modulationState frame');
  {
    // Open WS BEFORE the delete so we can observe the clearing frame.
    // Pin the source again so the controller actually has a stream
    // to lock onto before we yank the mapping.
    await httpJson('POST', '/param-center/source-lock', {
      mode: 'per-param', leases: { micMid: 'api' },
    });
    for (let i = 0; i < 4; i++) {
      await httpJson('POST', '/param-center', { micMid: 0.5 });
      await sleep(50);
    }
    const ws = await openWs('/ws/params');
    const frames = [];
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.type === 'modulationState') frames.push(m);
      } catch {}
    });
    // Wait for at least one non-empty frame so the >0 → 0 transition
    // is observable on this subscriber.
    const t0 = Date.now();
    while (frames.length === 0 && (Date.now() - t0) < 1500) await sleep(50);
    const sawNonEmptyBefore = frames.some(f =>
      f.parameters && Object.keys(f.parameters).length > 0);
    // Now delete.
    const r = await httpJson(
      'DELETE',
      `/api/playlists/${TEST_PLAYLIST}/items/${TEST_ENTRY_ID}/modulations/${TEST_MAPPING_ID}`,
    );
    check(r.status === 200, `DELETE 200 (got ${r.status})`, 'DELETE failed',
      `body=${JSON.stringify(r.body).slice(0, 200)}`);
    // Give the engine ~250 ms to emit the clearing frame.
    await sleep(400);
    ws.close();
    await httpJson('POST', '/param-center/source-lock', null);
    check(sawNonEmptyBefore,
      'observed at least one non-empty modulationState before DELETE',
      'never saw a pre-delete modulation frame — test setup race?');
    const lastFrame = frames[frames.length - 1];
    const lastIsEmpty = lastFrame
      && lastFrame.parameters
      && Object.keys(lastFrame.parameters).length === 0;
    check(!!lastIsEmpty,
      'last modulationState frame after DELETE has empty parameters',
      'ghost-clearing frame not emitted — slider ghost would linger',
      `lastFrame=${JSON.stringify(lastFrame).slice(0, 300)}`);
    const disk = await httpJson('GET', `/playlists/${TEST_PLAYLIST}`);
    const entry = disk.body && disk.body.entries && disk.body.entries.find(e => e.id === TEST_ENTRY_ID);
    check(entry && (!entry.modulations || entry.modulations.length === 0),
      'disk shows zero mappings after DELETE',
      'mapping still on disk',
      `entry=${JSON.stringify(entry).slice(0, 200)}`);
  }

  await cleanup();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { await cleanup(); } catch {}
  process.exit(2);
});
