/**
 * hil_deck_swap_param_test.mjs — HIL for slot-2 timeline-ready endpoints.
 *
 * Self-contained runner: boots the engine on the slot-2 port (31268),
 * snapshots the test_bench state files, runs assertions, then restores the
 * snapshots + kills the engine in a finally block. Leaves NO tracked state
 * residue (verified by the caller with `git status`).
 *
 * Covers:
 *   1. POST /deck/playlist/swap with a per-call `transition` override
 *      (item 10): a valid override is accepted (200); a bad override
 *      (non-trans_ mode, non-finite durationMs) is rejected 400 BEFORE the
 *      deck moves; the GLOBAL deckTransitionConfig is NOT mutated by the
 *      override.
 *   2. POST /deck/playlist/queue (item 11): warms the inactive slot without
 *      advancing the deck (200, returns warmed pattern); a second identical
 *      queue reports reused:true; a missing entry → 404; a missing playlist
 *      → 404.
 *   3. WS setChannelFader non-finite rejection (item 1): sending NaN over
 *      the WS yields a `channelFaderRejected` reply, NOT a corrupted fader.
 *   4. PATCH /mixer master with a non-finite value → 400 (item 1).
 *
 * Exit 0 = all passed; 1 = a failure or the engine never became ready.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.ENGINE_PORT || 31268);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws/control`;
const STATE_DIR = path.join(ENGINE_DIR, 'states', 'test_bench');
const STATE_FILES = ['deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml'];

let failures = 0;
function check(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); }
  else { console.error(`  ❌ ${label}`); failures++; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// HTTP helper that returns BOTH the status code and parsed body.
function req(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (body !== null) r.write(JSON.stringify(body));
    r.end();
  });
}

async function waitForReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await req('GET', '/status');
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

// ── state snapshot / restore ───────────────────────────────────────────
function snapshotState() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hil_swap_param_'));
  for (const f of STATE_FILES) {
    const src = path.join(STATE_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, f));
  }
  return tmp;
}
function restoreState(tmp) {
  for (const f of STATE_FILES) {
    const saved = path.join(tmp, f);
    if (fs.existsSync(saved)) fs.copyFileSync(saved, path.join(STATE_DIR, f));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  console.log('==========================================================');
  console.log('hil_deck_swap_param_test.mjs — parametric swap + queue + fader guard');
  console.log('==========================================================');

  const snapshot = snapshotState();
  let engine = null;
  let ws = null;
  try {
    engine = spawn('node', ['engine.js', '--pattern', 'test_const', '--model', 'test_bench',
      '--port', String(PORT)], { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    engine.stdout.on('data', () => {});
    engine.stderr.on('data', (d) => process.stderr.write(`[engine] ${d}`));

    const ready = await waitForReady();
    if (!ready) { console.error('  ❌ engine never became ready'); failures++; return; }
    console.log('  engine ready');

    // Discover two usable entries from the default playlist.
    const pl = await req('GET', '/playlists/default');
    check(pl.status === 200 && pl.body && Array.isArray(pl.body.entries),
      'GET /playlists/default returns entries');
    const usable = (pl.body.entries || []).filter((e) => !e._missing);
    if (usable.length < 2) { console.error('  ❌ need >=2 usable entries'); failures++; return; }
    const [entryA, entryB] = usable;

    // Snapshot the global transition-config so we can prove the per-call
    // override doesn't mutate it.
    const cfgBefore = (await req('GET', '/deck/transition-config')).body;

    // ── item 10: bad per-call override is rejected 400 (no deck move) ───
    const badMode = await req('POST', '/deck/playlist/swap', {
      name: 'default', entryId: entryB.id, transition: { mode: 'blend_screen' },
    });
    check(badMode.status === 400, 'swap with non-trans_ mode override → 400');

    const badDur = await req('POST', '/deck/playlist/swap', {
      name: 'default', entryId: entryB.id, transition: { durationMs: 'abc' },
    });
    check(badDur.status === 400, 'swap with non-finite durationMs override → 400');

    const cfgAfterBad = (await req('GET', '/deck/transition-config')).body;
    check(JSON.stringify(cfgBefore) === JSON.stringify(cfgAfterBad),
      'global deckTransitionConfig UNCHANGED by rejected overrides');

    // ── item 10: valid per-call override accepted (200) ────────────────
    const okSwap = await req('POST', '/deck/playlist/swap', {
      name: 'default', entryId: entryB.id,
      transition: { enabled: true, mode: 'trans_crossfade', durationMs: 200 },
    });
    check(okSwap.status === 200, 'swap with valid override → 200');
    // Let the short transition settle so the deck is idle for the next case.
    await sleep(600);
    const cfgAfterOk = (await req('GET', '/deck/transition-config')).body;
    check(JSON.stringify(cfgBefore) === JSON.stringify(cfgAfterOk),
      'global deckTransitionConfig UNCHANGED by a valid override too');

    // ── item 11: queue warms without advancing ─────────────────────────
    const deckBefore = (await req('GET', '/deck/channel')).body;
    const q1 = await req('POST', '/deck/playlist/queue', { name: 'default', entryId: entryA.id });
    check(q1.status === 200 && q1.body.warmed === entryA.pattern,
      `queue warms entryA pattern (${entryA.pattern})`);
    check(q1.body.reused === false, 'first queue compiles fresh (reused:false)');
    const deckAfterQueue = (await req('GET', '/deck/channel')).body;
    check(deckBefore.channel && deckAfterQueue.channel &&
      deckBefore.channel.pattern === deckAfterQueue.channel.pattern,
      'queue did NOT advance the live deck pattern');

    // Re-queue the same entry → reused:true (slot already warm).
    const q2 = await req('POST', '/deck/playlist/queue', { name: 'default', entryId: entryA.id });
    check(q2.status === 200 && q2.body.reused === true, 're-queue same entry → reused:true');

    // Queue a missing entry / missing playlist → 404.
    const qMissingEntry = await req('POST', '/deck/playlist/queue',
      { name: 'default', entryId: 'no_such_entry' });
    check(qMissingEntry.status === 404, 'queue missing entry → 404');
    const qMissingPl = await req('POST', '/deck/playlist/queue',
      { name: 'no_such_playlist', entryId: entryA.id });
    check(qMissingPl.status === 404, 'queue missing playlist → 404');

    // ── item 1: PATCH master non-finite → 400 ──────────────────────────
    const badMaster = await req('PATCH', '/mixer', { master: 'not-a-number' });
    check(badMaster.status === 400, 'PATCH /mixer master="not-a-number" → 400');
    const okMaster = await req('PATCH', '/mixer', { master: 1.5 });
    check(okMaster.status === 200, 'PATCH /mixer master=1.5 (clamps) → 200');

    // ── item 1: WS setChannelFader non-finite rejection ────────────────
    ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(WS_URL);
      s.once('open', () => resolve(s));
      s.once('error', reject);
    });
    const deckId = deckAfterQueue.channel.id;
    const rejected = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw);
          if (m.type === 'channelFaderRejected' && m.channelId === deckId) {
            clearTimeout(timer); resolve(m);
          }
        } catch { /* ignore */ }
      });
      ws.send(JSON.stringify({ type: 'setChannelFader', channelId: deckId, fader: 'NaN' }));
    });
    check(rejected !== null, 'WS setChannelFader with non-finite → channelFaderRejected');

    // Confirm the live deck fader was NOT corrupted by the rejected write.
    const deckFinal = (await req('GET', '/deck/channel')).body;
    check(deckFinal.channel && Number.isFinite(deckFinal.channel.fader),
      'deck fader remains a finite number after the rejected WS write');
  } finally {
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    if (engine) {
      engine.kill('SIGTERM');
      await sleep(500);
      if (!engine.killed) { try { engine.kill('SIGKILL'); } catch { /* ignore */ } }
    }
    // Give the engine a beat to release the port + flush, then restore.
    await sleep(300);
    restoreState(snapshot);
    console.log('  state snapshots restored');
  }

  console.log('==========================================================');
  if (failures === 0) { console.log('ALL HIL ASSERTIONS PASSED'); }
  else { console.error(`${failures} HIL ASSERTION(S) FAILED`); }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HIL crashed:', e); process.exit(1); });
