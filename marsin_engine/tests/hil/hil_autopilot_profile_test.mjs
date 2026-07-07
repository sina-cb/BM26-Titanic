/**
 * hil_autopilot_profile_test.mjs — HIL test for the AUTOPILOT PROFILE seam (E1).
 *
 * Proves, against a live engine:
 *   1. A no-`profile` autopilot arm behaves EXACTLY as before — the deck cycles
 *      on the timer, `POST /deck/playlist/autopilot {active,delay_s}` works, and
 *      the `autopilot` WS payload reports `profile: 'random'` (the documented
 *      default) + `profiles: ['random','audio_reactive']`.
 *   2. The WS connect-replay ALSO carries `profile` + `profiles` (a late joiner
 *      sees the dropdown state without a GET).
 *   3. `POST /deck/playlist/autopilot {profile:'audio_reactive'}` → 200 and the
 *      broadcast flips `profile` to 'audio_reactive'.
 *   4. `POST /deck/playlist/autopilot {profile:'bogus'}` → 400 (loud, no coerce).
 *   5. The profile persists per-scene: it round-trips on the deck channel's
 *      `playlist.autopilot.profile` (visible via GET /deck/channel).
 *
 * This test OWNS the engine lifecycle: it snapshots state files, boots the
 * engine on ENGINE_PORT (default 31068 — slot 0), polls /status, runs, stops
 * the engine, and RESTORES the state snapshots in a finally — so it never
 * leaves a tracked-state side effect (per marsin_engine_auto_checks.md).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     node tests/hil/hil_autopilot_profile_test.mjs            # port 31068
 *     ENGINE_PORT=31068 node tests/hil/hil_autopilot_profile_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine did not boot / became unreachable)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ENGINE_DIR, 'states', 'test_bench');

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '31068', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}`;
const WS_EVENT_TIMEOUT_MS = 900;
// Every per-scene state file the engine may rewrite while running, so the
// snapshot/restore leaves ZERO tracked side effects (autopilot ticks touch
// deck/mixer; audio analysis touches audio_state; globals get re-saved).
const STATE_FILES = [
  'deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml', 'audio_state.yaml',
];
// The autopilot daemon ALSO writes its timing to the global config.yaml
// (a known pre-existing wart — loadConfig/saveConfig). Snapshot + restore it too
// so this test never leaves a config.yaml diff.
const CONFIG_FILE = path.join(ENGINE_DIR, 'config.yaml');

// ── HTTP / WS helpers ──────────────────────────────────────────────────
function httpJson(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, ENGINE_BASE);
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
  const onMessage = (raw) => { let o; try { o = JSON.parse(raw); } catch { return; } events.push(o); };
  ws.on('message', onMessage);
  return { events, stop: () => ws.off('message', onMessage) };
}

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) { if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail); }

// ── Engine lifecycle (snapshot → boot → run → stop → restore) ──────────
const snapshots = new Map();
function snapshotState() {
  for (const f of STATE_FILES) {
    const full = path.join(STATE_DIR, f);
    if (fs.existsSync(full)) snapshots.set(full, fs.readFileSync(full));
  }
  if (fs.existsSync(CONFIG_FILE)) snapshots.set(CONFIG_FILE, fs.readFileSync(CONFIG_FILE));
}
function restoreState() {
  for (const [full, buf] of snapshots) {
    try { fs.writeFileSync(full, buf); }
    catch (e) { console.warn(`  could not restore ${full}: ${e.message}`); }
  }
}

let engineProc = null;
async function bootEngine() {
  engineProc = spawn('node', [
    'engine.js', '--pattern', 'test_const', '--model', 'test_bench',
    '--port', String(ENGINE_PORT),
  ], { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  engineProc.stdout.on('data', () => {});
  engineProc.stderr.on('data', () => {});
  // Poll /status until ready or timeout (~30s).
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await httpJson('GET', '/status');
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}
function stopEngine() {
  return new Promise((resolve) => {
    if (!engineProc) return resolve();
    const proc = engineProc;
    engineProc = null;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch { finish(); }
    // Hard stop if it doesn't exit promptly so restore isn't blocked forever.
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} finish(); }, 4000);
  });
}

// ── main ────────────────────────────────────────────────────────────────
(async function main() {
  console.log('==========================================================');
  console.log('hil_autopilot_profile_test.mjs — autopilot profile seam (E1)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  snapshotState();
  const booted = await bootEngine();
  if (!booted) {
    console.error('  FATAL: engine did not become ready on ' + ENGINE_BASE);
    await stopEngine();
    restoreState();
    process.exit(2);
  }

  try {
    // ── Baseline: arm autopilot with NO profile field (legacy shape) ──────
    console.log('\n[TEST 1] no-profile autopilot arm → 200, reports random');
    const arm = await httpJson('POST', '/deck/playlist/autopilot', { active: true, delay_s: 20, shuffle: false });
    check(arm.status === 200, `arm → 200 (got ${arm.status})`, 'arm did not return 200',
      `body=${JSON.stringify(arm.body).slice(0, 200)}`);

    // ── WS: broadcastAutopilot carries profile + profiles ─────────────────
    console.log('\n[TEST 2] `autopilot` broadcast carries profile:random + profiles list');
    {
      const ws = await openWs();
      const sub = subscribe(ws);
      // Trigger a fresh broadcast by re-POSTing (no-op change).
      await httpJson('POST', '/deck/playlist/autopilot', { delay_s: 20 });
      await sleep(WS_EVENT_TIMEOUT_MS);
      const ap = sub.events.filter(e => e.type === 'autopilot').pop();
      check(!!ap, 'received an autopilot WS event', 'no autopilot WS event');
      check(ap && ap.profile === 'random', `profile === 'random' (got ${ap && ap.profile})`,
        'profile field missing/wrong', `msg=${JSON.stringify(ap).slice(0, 200)}`);
      check(ap && Array.isArray(ap.profiles) && ap.profiles.includes('random')
        && ap.profiles.includes('audio_reactive'),
        `profiles includes random + audio_reactive`, 'profiles list missing/wrong',
        `profiles=${JSON.stringify(ap && ap.profiles)}`);
      sub.stop(); ws.close(); await sleep(50);
    }

    // ── WS connect-replay carries profile + profiles for a LATE joiner ────
    console.log('\n[TEST 3] WS connect-replay carries profile + profiles');
    {
      const ws = await openWs();
      const sub = subscribe(ws);
      await sleep(WS_EVENT_TIMEOUT_MS);
      const ap = sub.events.filter(e => e.type === 'autopilot').pop();
      check(!!ap, 'connect-replay sent an autopilot event', 'no autopilot on connect');
      check(ap && typeof ap.profile === 'string' && Array.isArray(ap.profiles),
        'connect-replay autopilot carries profile + profiles',
        'connect-replay missing profile/profiles', `msg=${JSON.stringify(ap).slice(0, 200)}`);
      sub.stop(); ws.close(); await sleep(50);
    }

    // ── GET /autopilot carries profile + profiles (CaptainPad seeds from it) ─
    console.log('\n[TEST 3b] GET /autopilot carries profile + profiles');
    {
      const g = await httpJson('GET', '/autopilot');
      check(g.status === 200, `GET /autopilot → 200 (got ${g.status})`, 'GET /autopilot failed');
      check(g.body && g.body.profile === 'random' && Array.isArray(g.body.profiles)
        && g.body.profiles.includes('audio_reactive'),
        `GET /autopilot body carries profile:'random' + profiles`,
        'GET /autopilot missing profile/profiles', JSON.stringify(g.body).slice(0, 200));
      // The fix must NOT leak `profiles` into the persisted live autopilot ref:
      // GET /deck/channel (the persisted-shaped object) must NOT carry it.
      const dc = await httpJson('GET', '/deck/channel');
      const ap = dc.body && dc.body.channel && dc.body.channel.playlist
        && dc.body.channel.playlist.autopilot;
      check(ap && ap.profiles === undefined,
        'the live/persisted autopilot ref does NOT carry the profiles array',
        'GET /autopilot leaked profiles into the persisted ref', JSON.stringify(ap).slice(0, 200));
    }

    // ── Switch to audio_reactive → 200, broadcast flips ───────────────────
    console.log('\n[TEST 4] POST profile:audio_reactive → 200, broadcast flips');
    {
      const ws = await openWs();
      const sub = subscribe(ws);
      const r = await httpJson('POST', '/deck/playlist/autopilot', { profile: 'audio_reactive' });
      check(r.status === 200, `→ 200 (got ${r.status})`, 'profile switch did not 200',
        `body=${JSON.stringify(r.body).slice(0, 200)}`);
      check(r.body && r.body.autopilot && r.body.autopilot.profile === 'audio_reactive',
        `response autopilot.profile === 'audio_reactive'`, 'response did not reflect profile',
        `body=${JSON.stringify(r.body).slice(0, 200)}`);
      await sleep(WS_EVENT_TIMEOUT_MS);
      const ap = sub.events.filter(e => e.type === 'autopilot').pop();
      check(ap && ap.profile === 'audio_reactive', `broadcast profile === 'audio_reactive'`,
        'broadcast did not flip profile', `msg=${JSON.stringify(ap).slice(0, 200)}`);
      sub.stop(); ws.close(); await sleep(50);
    }

    // ── Per-scene persistence: GET /deck/channel reflects the profile ─────
    console.log('\n[TEST 5] profile persists on the deck channel (per-scene)');
    {
      const r = await httpJson('GET', '/deck/channel');
      const ap = r.body && r.body.channel && r.body.channel.playlist
        && r.body.channel.playlist.autopilot;
      check(ap && ap.profile === 'audio_reactive',
        `deck channel playlist.autopilot.profile === 'audio_reactive'`,
        'profile not stored on the deck channel', `ap=${JSON.stringify(ap).slice(0, 200)}`);
    }

    // ── Unknown profile → 400, loud (no silent coerce) ───────────────────
    console.log('\n[TEST 6] POST profile:bogus → 400 (loud)');
    {
      const r = await httpJson('POST', '/deck/playlist/autopilot', { profile: 'bogus' });
      check(r.status === 400, `→ 400 (got ${r.status})`, 'unknown profile did not 400',
        `body=${JSON.stringify(r.body).slice(0, 200)}`);
      check(r.body && typeof r.body.error === 'string' && /unknown autopilot profile/.test(r.body.error),
        'error body names the unknown profile', 'error body wrong',
        `body=${JSON.stringify(r.body).slice(0, 200)}`);
      // And the stored profile must be UNCHANGED (still audio_reactive).
      const g = await httpJson('GET', '/deck/channel');
      const ap = g.body && g.body.channel && g.body.channel.playlist
        && g.body.channel.playlist.autopilot;
      check(ap && ap.profile === 'audio_reactive',
        'rejected profile left the stored value untouched',
        'a 400 mutated the stored profile', `ap=${JSON.stringify(ap).slice(0, 200)}`);
    }

    // ── Restore to random so the seam ends clean ─────────────────────────
    await httpJson('POST', '/deck/playlist/autopilot', { profile: 'random', active: false });
  } finally {
    await stopEngine();
    await sleep(300);   // let any final fs.writeFileSync flush before we restore
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { await stopEngine(); await sleep(300); restoreState(); } catch {}
  process.exit(2);
});
