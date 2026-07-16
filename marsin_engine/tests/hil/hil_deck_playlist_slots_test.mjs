/**
 * hil_deck_playlist_slots_test.mjs — HIL test for the deck split-playlist
 * SLOTS (E3): two stacked, independently-browsable panes over the existing
 * single-live-pattern deck.
 *
 * Proves, against a live engine (self-booted on ENGINE_PORT, default 31068):
 *   1. GET /deck/playlist/slots → the { primary, secondary, splitRatio } shape,
 *      slots as FULL objects ({name, activeEntryId, cursor, autopilot, live}).
 *   2. POST /deck/playlist/secondary assigns pane 2 WITHOUT changing what plays
 *      (browse-only), returns { status:'ok', playlist:<slot> }, and emits a
 *      channelPlaylistData(channelId:'secondary') broadcast.
 *   3. 400 when secondary === primary (structural rule).
 *   4. Driving via POST /deck/playlist/entry {entryId, slot:'secondary'} flips
 *      the LIVE pointer to the secondary playlist; primary stays a stable
 *      binding; the deck `playlistSlots` reflects live-ness (live flag moves).
 *   5. POST /deck/playlist/split validates INCLUSIVE [0.15, 0.85] — accepts the
 *      boundary values, 400s outside them.
 *   6. Clear-while-live PROMOTES: POST secondary {name:null} while secondary is
 *      live sets primary = the (now-cleared) live name, secondary = null.
 *   7. Restart round-trip: slots + splitRatio persist in deck_state.yaml.
 *
 * Owns the engine lifecycle (snapshot state → boot → run → [restart] → stop →
 * restore) so it leaves ZERO tracked-state side effects.
 *
 * ── Run ─────────────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     node tests/hil/hil_deck_playlist_slots_test.mjs
 *
 * ── Exit ────────────────────────────────────────────────────────────────
 *   0 pass · 1 assertion fail · 2 setup error
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

import { assertDisposableEngine } from './hil_guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ENGINE_DIR, 'states', 'test_bench');
const CONFIG_FILE = path.join(ENGINE_DIR, 'config.yaml');

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '31068', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}`;
const STATE_FILES = [
  'deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml', 'audio_state.yaml',
];
const PL_A = 'hil_slots_primary';
const PL_B = 'hil_slots_secondary';

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

async function slots() { return (await httpJson('GET', '/deck/playlist/slots')).body; }
async function liveName() {
  const r = await httpJson('GET', '/deck/channel');
  return r.body && r.body.channel && r.body.channel.playlist ? r.body.channel.playlist.name : null;
}

// ── engine lifecycle (snapshot/restore + boot/stop) ────────────────────────
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
    try { fs.writeFileSync(full, buf); } catch (e) { console.warn(`  restore ${full}: ${e.message}`); }
  }
}
let engineProc = null;
async function bootEngine() {
  engineProc = spawn('node', [
    'engine.js', '--pattern', 'test_const', '--model', 'test_bench', '--port', String(ENGINE_PORT),
  ], { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  engineProc.stdout.on('data', () => {});
  engineProc.stderr.on('data', () => {});
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const r = await httpJson('GET', '/status'); if (r.status === 200) return true; } catch {}
    await sleep(500);
  }
  return false;
}
function stopEngine() {
  return new Promise((resolve) => {
    if (!engineProc) return resolve();
    const proc = engineProc; engineProc = null;
    let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch { finish(); }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} finish(); }, 4000);
  });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_deck_playlist_slots_test.mjs — deck split slots (E3)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  snapshotState();
  if (!(await bootEngine())) {
    console.error('  FATAL: engine did not become ready');
    await stopEngine(); restoreState(); process.exit(2);
  }

  // Guard: even though we self-boot a test_bench engine, if our slot port was
  // already bound by a real engine the readiness poll above would have latched
  // onto IT — refuse to mutate anything but the disposable test_bench model.
  await assertDisposableEngine(ENGINE_BASE);

  let made = false;
  try {
    // Two throwaway playlists, two entries each.
    const mk = (n) => [
      { id: `${n}_0`, pattern: 'test_const', label: 'A', defaults: {} },
      { id: `${n}_1`, pattern: 'test_const', label: 'B', defaults: {} },
    ];
    let r = await httpJson('POST', '/playlists', { name: PL_A, entries: mk('a') });
    if (r.status !== 200) { console.error('FATAL: create A', r.status); throw new Error('setup'); }
    r = await httpJson('POST', '/playlists', { name: PL_B, entries: mk('b') });
    if (r.status !== 200) { console.error('FATAL: create B', r.status); throw new Error('setup'); }
    made = true;

    // Instant swaps (transitions off) for deterministic live-name flips.
    await httpJson('POST', '/deck/transition-config', { enabled: false });
    // Load PL_A as the primary (pane 1) — this is the live playlist.
    await httpJson('POST', '/deck/playlist', { name: PL_A });

    // ── TEST 1: GET /deck/playlist/slots shape ────────────────────────────
    console.log('\n[TEST 1] GET /deck/playlist/slots shape');
    {
      const s = await slots();
      check(s && typeof s === 'object' && 'primary' in s && 'secondary' in s && 'splitRatio' in s,
        'slots has primary/secondary/splitRatio keys', 'slots shape wrong', JSON.stringify(s));
      check(s && s.primary && s.primary.name === PL_A && typeof s.primary.live === 'boolean',
        `primary is a slot object bound to '${PL_A}' (live=${s && s.primary && s.primary.live})`,
        'primary slot object wrong', JSON.stringify(s && s.primary));
      check(s && s.secondary === null, 'secondary is null when unbound',
        'secondary should be null', JSON.stringify(s && s.secondary));
      check(s && typeof s.splitRatio === 'number', `splitRatio is a number (${s && s.splitRatio})`,
        'splitRatio not a number', JSON.stringify(s && s.splitRatio));
    }

    // ── TEST 2: assign secondary (browse-only) + channelPlaylistData ──────
    console.log('\n[TEST 2] POST secondary assigns pane 2 browse-only + broadcasts');
    {
      const ws = await openWs(); const sub = subscribe(ws);
      const liveBefore = await liveName();
      const res = await httpJson('POST', '/deck/playlist/secondary', { name: PL_B });
      check(res.status === 200, `→ 200 (got ${res.status})`, 'assign secondary failed', JSON.stringify(res.body));
      check(res.body && res.body.status === 'ok' && res.body.playlist && res.body.playlist.name === PL_B,
        `response playlist is the secondary slot ('${PL_B}')`, 'response playlist wrong', JSON.stringify(res.body));
      // Browse-only: what's PLAYING must be unchanged.
      const liveAfter = await liveName();
      check(liveAfter === liveBefore,
        `assigning secondary did NOT change the live playlist (still '${liveBefore}')`,
        'assigning secondary changed the live playlist', `before=${liveBefore} after=${liveAfter}`);
      await sleep(400);
      const cpd = sub.events.filter(e => e.type === 'channelPlaylistData' && e.channelId === 'secondary').pop();
      check(!!cpd && cpd.playlistData && cpd.playlistData.name === PL_B,
        'channelPlaylistData(secondary) broadcast carries the playlist content',
        'no channelPlaylistData for secondary', JSON.stringify(cpd));
      sub.stop(); ws.close(); await sleep(50);
    }

    // ── TEST 3: 400 when secondary === primary ────────────────────────────
    console.log('\n[TEST 3] secondary === primary → 400');
    {
      const res = await httpJson('POST', '/deck/playlist/secondary', { name: PL_A });
      check(res.status === 400, `→ 400 (got ${res.status})`, 'dup-name did not 400', JSON.stringify(res.body));
    }

    // ── TEST 4: drive slot:'secondary' flips live; primary stays bound ────
    console.log('\n[TEST 4] drive slot:secondary flips live; primary stays a stable binding');
    {
      const res = await httpJson('POST', '/deck/playlist/entry', { entryId: 'b_1', slot: 'secondary' });
      check(res.status === 200, `→ 200 (got ${res.status})`, 'drive secondary failed', JSON.stringify(res.body));
      const live = await liveName();
      check(live === PL_B, `live playlist flipped to '${PL_B}'`, 'live did not flip to secondary', `live=${live}`);
      const s = await slots();
      check(s && s.primary && s.primary.name === PL_A && s.primary.live === false && s.primary.activeEntryId === null,
        `primary still bound to '${PL_A}', now non-live (activeEntryId null)`,
        'primary slot did not stay a stable non-live binding', JSON.stringify(s && s.primary));
      check(s && s.secondary && s.secondary.name === PL_B && s.secondary.live === true,
        `secondary '${PL_B}' is now the live slot`, 'secondary not live', JSON.stringify(s && s.secondary));
    }

    // ── TEST 4b: 409 EBUSY when a slot drive lands mid-transition ─────────
    console.log('\n[TEST 4b] slot drive mid-transition → 409 { code:EBUSY }');
    {
      // Enable a slow transition so a second drive races the in-flight swap.
      await httpJson('POST', '/deck/transition-config', { enabled: true, mode: 'trans_crossfade', durationMs: 3000 });
      // First drive kicks off a 3 s soft swap on the secondary slot.
      const first = await httpJson('POST', '/deck/playlist/entry', { entryId: 'b_0', slot: 'secondary' });
      // Immediately drive again — should be refused while the swap is in flight.
      const second = await httpJson('POST', '/deck/playlist/entry', { entryId: 'b_1', slot: 'secondary' });
      check(second.status === 409, `mid-transition drive → 409 (got ${second.status})`,
        'mid-transition drive did not 409', `first=${first.status} second=${JSON.stringify(second.body)}`);
      check(second.body && second.body.code === 'EBUSY', `409 body carries code:'EBUSY'`,
        '409 missing EBUSY marker', JSON.stringify(second.body));
      // Let the transition settle + go back to instant swaps for later tests.
      await sleep(3300);
      await httpJson('POST', '/deck/transition-config', { enabled: false });
    }

    // ── TEST 5: split ratio bounds (inclusive) ────────────────────────────
    console.log('\n[TEST 5] POST split: inclusive [0.15, 0.85] bounds');
    {
      const okLo = await httpJson('POST', '/deck/playlist/split', { ratio: 0.15 });
      check(okLo.status === 200, `ratio 0.15 (boundary) → 200 (got ${okLo.status})`, '0.15 rejected', JSON.stringify(okLo.body));
      const okHi = await httpJson('POST', '/deck/playlist/split', { ratio: 0.85 });
      check(okHi.status === 200, `ratio 0.85 (boundary) → 200 (got ${okHi.status})`, '0.85 rejected', JSON.stringify(okHi.body));
      const mid = await httpJson('POST', '/deck/playlist/split', { ratio: 0.4 });
      check(mid.status === 200 && mid.body && mid.body.splitRatio === 0.4, 'ratio 0.4 → 200 + stored', '0.4 failed', JSON.stringify(mid.body));
      const tooLo = await httpJson('POST', '/deck/playlist/split', { ratio: 0.1 });
      check(tooLo.status === 400, `ratio 0.1 → 400 (got ${tooLo.status})`, '0.1 not rejected', JSON.stringify(tooLo.body));
      const tooHi = await httpJson('POST', '/deck/playlist/split', { ratio: 0.9 });
      check(tooHi.status === 400, `ratio 0.9 → 400 (got ${tooHi.status})`, '0.9 not rejected', JSON.stringify(tooHi.body));
      const nan = await httpJson('POST', '/deck/playlist/split', { ratio: 'abc' });
      check(nan.status === 400, `ratio 'abc' → 400 (got ${nan.status})`, 'NaN not rejected', JSON.stringify(nan.body));
    }

    // ── TEST 6: clear-while-live promotes secondary → primary ─────────────
    console.log('\n[TEST 6] clear secondary while it is live → promote to primary');
    {
      // secondary (PL_B) is currently live from TEST 4. Clearing it must promote.
      const res = await httpJson('POST', '/deck/playlist/secondary', { name: null });
      check(res.status === 200, `clear → 200 (got ${res.status})`, 'clear failed', JSON.stringify(res.body));
      const s = await slots();
      check(s && s.secondary === null, 'secondary cleared to null', 'secondary not cleared', JSON.stringify(s && s.secondary));
      check(s && s.primary && s.primary.name === PL_B,
        `primary PROMOTED to the (formerly-secondary) live name '${PL_B}'`,
        'primary not promoted to the live name', JSON.stringify(s && s.primary));
    }

    // ── TEST 7: restart round-trip (slots + splitRatio persist) ───────────
    console.log('\n[TEST 7] restart → slots + splitRatio round-trip from deck_state.yaml');
    {
      // Set a distinctive state: secondary=PL_A, ratio=0.4 (primary is PL_B live).
      await httpJson('POST', '/deck/playlist/secondary', { name: PL_A });
      await httpJson('POST', '/deck/playlist/split', { ratio: 0.4 });
      const before = await slots();
      // Restart the engine (state was saved by the POSTs above).
      await stopEngine();
      await sleep(400);
      if (!(await bootEngine())) { fail('engine restart', 'did not come back up'); }
      else {
        const after = await slots();
        check(after && after.primary && after.primary.name === (before.primary && before.primary.name),
          `primary persisted ('${after && after.primary && after.primary.name}')`,
          'primary did not round-trip', JSON.stringify(after && after.primary));
        check(after && after.secondary && after.secondary.name === PL_A,
          `secondary persisted ('${PL_A}')`, 'secondary did not round-trip', JSON.stringify(after && after.secondary));
        check(after && after.splitRatio === 0.4, `splitRatio persisted (0.4, got ${after && after.splitRatio})`,
          'splitRatio did not round-trip', JSON.stringify(after && after.splitRatio));
      }
    }
  } catch (e) {
    if (e.message !== 'setup') fail('unexpected error', e && e.message);
  } finally {
    // Detach both slots + clear playlists so nothing lingers, then restore.
    try { await httpJson('POST', '/deck/playlist/secondary', { name: null }); } catch {}
    if (made) {
      try { await httpJson('DELETE', `/playlists/${encodeURIComponent(PL_A)}`); } catch {}
      try { await httpJson('DELETE', `/playlists/${encodeURIComponent(PL_B)}`); } catch {}
    }
    await stopEngine();
    await sleep(300);
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total && total > 0 ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { await stopEngine(); await sleep(300); restoreState(); } catch {}
  process.exit(2);
});
