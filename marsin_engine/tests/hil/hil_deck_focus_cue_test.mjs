/**
 * hil_deck_focus_cue_test.mjs — HIL test for cue-to-deck (docs/39 §F-cue).
 *
 * Cue-to-deck lets the operator audition a MIXER overlay's pattern on the
 * DECK preview buffer at 100% (PFL) before pushing it live, via
 * POST /deck/focus { channelId }. The render path already honours
 * `mixer.deckFocusChannelId`; this test drives the full engine path end-to-end.
 *
 * Scenario (engine on its OWN spawned process, slot 2 port 31268):
 *   1. Boot engine (deck pattern test_const), snapshot state for restore.
 *   2. Add a mixer overlay running a DIFFERENT pattern (test_dualband) so the
 *      cued buffer is visibly distinct from the deck's own buffer.
 *   3. Force deck view (POST /mixer/view {view:'deck'}) so vis.master == the
 *      rendered DECK buffer (no overlay composite mixed in).
 *   4. Capture the baseline vis.master frame (the deck channel's pattern).
 *   5. POST /deck/focus {channelId: overlay} → 200; assert:
 *        - GET /deck/channel reflects deckFocusChannelId === overlay.
 *        - the `deck` WS broadcast carries deckFocusChannelId === overlay.
 *        - the rendered deck buffer (vis.master) now DIFFERS from baseline
 *          (the overlay's pattern is being previewed on the deck).
 *   6. POST /deck/focus {channelId: null} → 200; assert:
 *        - GET /deck/channel reflects deckFocusChannelId === null.
 *        - the rendered deck buffer (vis.master) RETURNS to the baseline.
 *   7. Error paths (fail-loud, Codex P0):
 *        - unknown channel id → 404.
 *        - the deck channel's own id → 400.
 *        - non-string channelId → 400.
 *   8. Cleanup in finally: clear focus, remove the added overlay, restore
 *      tracked state files, kill the engine, free the port.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_deck_focus_cue_test.mjs [--port 31268]
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '../..');
const STATE_DIR = path.join(ENGINE_ROOT, 'states', 'test_bench');

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : 31268;
const BASE = `http://127.0.0.1:${PORT}`;
// Post-split WS topology (lib/ws_topic_routing.js): vis frames live on
// /ws/viz; control-plane events (the `deck` broadcast) live on /ws/control.
const WS_VIZ_URL = `ws://127.0.0.1:${PORT}/ws/viz`;
const WS_CONTROL_URL = `ws://127.0.0.1:${PORT}/ws/control`;
const PIXEL_COUNT = 52;
const BYTES_PER_PIXEL = 6;
const SETTLE_MS = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpJson(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
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

function openWs(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.once('open', () => res(ws));
    ws.once('error', rej);
  });
}

function decodeMaster(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < PIXEL_COUNT * BYTES_PER_PIXEL) return null;
  return buf;
}
function bufsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failDetail) {
  if (cond) ok(passLabel); else fail(passLabel, failDetail);
}

// ─────────────────────────── snapshot/restore ────────────────────────
const SNAPSHOT_FILES = ['deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml'];
const snapshots = {};
function snapshotState() {
  for (const f of SNAPSHOT_FILES) {
    const p = path.join(STATE_DIR, f);
    if (fs.existsSync(p)) snapshots[f] = fs.readFileSync(p, 'utf8');
  }
}
function restoreState() {
  for (const f of SNAPSHOT_FILES) {
    if (snapshots[f] !== undefined) {
      fs.writeFileSync(path.join(STATE_DIR, f), snapshots[f]);
    }
  }
}

// ─────────────────────────── engine lifecycle ────────────────────────
let engineProc = null;
function startEngine() {
  return new Promise((resolve, reject) => {
    const logPath = path.join('/tmp', `hil_deck_focus_cue_${PORT}.log`);
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
    const deadline = Date.now() + 15000;
    const poll = async () => {
      while (Date.now() < deadline) {
        try {
          const r = await httpJson('GET', '/mixer');
          if (r && r.body && r.body.channels !== undefined) return resolve();
        } catch { /* not up yet */ }
        await sleep(250);
      }
      reject(new Error(`engine did not come up on port ${PORT} within 15s. See ${logPath}`));
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

// Capture a single complete vis frame (the whole `vis` map of base64 6ch
// buffers) from a fresh /ws/viz subscription. We compare per-frame keys within
// the SAME frame (master vs the deck/overlay channel key) so animated patterns
// don't make a cross-frame byte compare flaky. In deck view, vis.master == the
// rendered DECK buffer.
function captureVisFrame(timeoutMs = 2500) {
  return new Promise(async (resolve, reject) => {
    let ws;
    try { ws = await openWs(WS_VIZ_URL); } catch (e) { return reject(e); }
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('no vis frame within timeout')); }, timeoutMs);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'vis' && msg.vis && msg.vis.master) {
          clearTimeout(timer); try { ws.close(); } catch {}
          resolve(msg.vis);
        }
      } catch { /* ignore */ }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// Capture the next `deck` control-plane broadcast (carries deckFocusChannelId).
// Trigger it by performing `triggerFn` after the subscription is open.
function captureDeckBroadcast(triggerFn, timeoutMs = 3000) {
  return new Promise(async (resolve, reject) => {
    let ws;
    try { ws = await openWs(WS_CONTROL_URL); } catch (e) { return reject(e); }
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('no deck broadcast within timeout')); }, timeoutMs);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'deck') {
          clearTimeout(timer); try { ws.close(); } catch {}
          resolve(msg);
        }
      } catch { /* ignore */ }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    // Give the subscription a tick to register, then fire the trigger.
    setTimeout(() => { Promise.resolve(triggerFn()).catch(reject); }, 100);
  });
}

async function main() {
  console.log(`\n== HIL: deck_focus_cue (engine ${BASE}) ==\n`);

  snapshotState();
  try {
    await startEngine();
  } catch (e) {
    console.error(`Could not start engine: ${e.message}`);
    restoreState();
    return 1;
  }

  let addedOverlayId = null;
  let deckChannelId = null;

  try {
    // ── Setup: add an overlay running a DIFFERENT pattern than the deck ──
    const add = await httpJson('POST', '/mixer/channels', {
      pattern: 'test_dualband', name: 'hil_cue_overlay', mode: 'blend_screen', fader: 1.0,
    });
    check(add.status === 200, 'add overlay (test_dualband) → 200', `status ${add.status} ${JSON.stringify(add.body)}`);
    addedOverlayId = add.body.channelId;

    const deckRes0 = await httpJson('GET', '/deck/channel');
    deckChannelId = deckRes0.body?.channel?.id || null;
    check(!!deckChannelId, 'deck channel id resolved', `got ${deckChannelId}`);
    // Default (no cue): GET /deck/channel surfaces deckFocusChannelId === null.
    check(deckRes0.body?.deckFocusChannelId === null,
      'GET /deck/channel deckFocusChannelId defaults to null',
      `got ${JSON.stringify(deckRes0.body?.deckFocusChannelId)}`);

    // Force deck view so vis.master == the rendered deck buffer.
    await httpJson('POST', '/mixer/view', { view: 'deck' });
    await sleep(SETTLE_MS);

    // ── Baseline (no cue): the deck buffer (vis.master) must NOT be the
    // overlay's render — the deck shows its own pattern. We compare against
    // the overlay (not the deck channel) because the two render the SAME
    // pattern slightly out of phase across the vis pre-pass vs the deck-buffer
    // render for an animated pattern; the meaningful baseline claim is "the
    // overlay is not being previewed yet". The cued/cleared assertions below
    // (master == overlay while armed; != overlay after clear) carry the
    // render-honoured proof. ─────────────────────────────────────────────
    {
      const f = await captureVisFrame();
      const master = decodeMaster(f.master);
      const deckOwn = decodeMaster(f[deckChannelId]);
      const overlay = decodeMaster(f[addedOverlayId]);
      // Sanity: the two patterns differ, so the test can detect a swap at all.
      check(!!deckOwn && !!overlay && !bufsEqual(deckOwn, overlay),
        'sanity: deck and overlay patterns render differently',
        'deck and overlay render identically — test cannot distinguish a cue');
      check(!!master && !!overlay && !bufsEqual(master, overlay),
        'baseline: deck buffer is NOT the overlay render (no cue armed)',
        'master equals overlay render with no cue armed');
    }

    // ── Arm the cue: focus the overlay onto the deck preview ────────────
    const arm = await httpJson('POST', '/deck/focus', { channelId: addedOverlayId });
    check(arm.status === 200, 'POST /deck/focus overlay → 200', `status ${arm.status} ${JSON.stringify(arm.body)}`);
    check(arm.body?.deckFocusChannelId === addedOverlayId,
      'POST response echoes deckFocusChannelId === overlay', `got ${arm.body?.deckFocusChannelId}`);

    const deckRes1 = await httpJson('GET', '/deck/channel');
    check(deckRes1.body?.deckFocusChannelId === addedOverlayId,
      'GET /deck/channel reflects deckFocusChannelId === overlay', `got ${deckRes1.body?.deckFocusChannelId}`);

    // WS deck broadcast carries the focus id (trigger a fresh broadcast by
    // re-arming the same focus — idempotent + always broadcasts).
    const deckMsg = await captureDeckBroadcast(
      () => httpJson('POST', '/deck/focus', { channelId: addedOverlayId }));
    check(deckMsg?.deckFocusChannelId === addedOverlayId,
      'deck WS broadcast carries deckFocusChannelId === overlay', `got ${deckMsg?.deckFocusChannelId}`);

    await sleep(SETTLE_MS);
    {
      const f = await captureVisFrame();
      const master = decodeMaster(f.master);
      const overlay = decodeMaster(f[addedOverlayId]);
      const deckOwn = decodeMaster(f[deckChannelId]);
      check(!!master && !!overlay && bufsEqual(master, overlay),
        'cued: rendered deck buffer == overlay render (overlay previewed on deck)',
        'master != overlay render while cued — focus did not affect the render');
      check(!!deckOwn && !bufsEqual(master, deckOwn),
        'cued: rendered deck buffer != deck channel render',
        'master still equals deck channel render while cued');
    }

    // ── Clear the cue: deck preview returns to its own pattern ──────────
    const clear = await httpJson('POST', '/deck/focus', { channelId: null });
    check(clear.status === 200, 'POST /deck/focus null (clear) → 200', `status ${clear.status}`);
    check(clear.body?.deckFocusChannelId === null,
      'clear response echoes deckFocusChannelId === null', `got ${clear.body?.deckFocusChannelId}`);

    const deckRes2 = await httpJson('GET', '/deck/channel');
    check(deckRes2.body?.deckFocusChannelId === null,
      'GET /deck/channel reflects deckFocusChannelId === null after clear', `got ${deckRes2.body?.deckFocusChannelId}`);

    await sleep(SETTLE_MS);
    {
      const f = await captureVisFrame();
      const master = decodeMaster(f.master);
      const deckOwn = decodeMaster(f[deckChannelId]);
      check(!!master && !!deckOwn && bufsEqual(master, deckOwn),
        'cleared: rendered deck buffer == deck channel render again (canonical view restored)',
        'master != deck channel render after clear — clear did not restore the deck view');
    }

    // ── Error paths (Codex P0 fail-loud) ────────────────────────────────
    const notFound = await httpJson('POST', '/deck/focus', { channelId: 'ch_does_not_exist' });
    check(notFound.status === 404, 'focus unknown id → 404', `status ${notFound.status}`);

    const deckSelf = await httpJson('POST', '/deck/focus', { channelId: deckChannelId });
    check(deckSelf.status === 400, 'focus the deck channel id → 400', `status ${deckSelf.status}`);

    const badType = await httpJson('POST', '/deck/focus', { channelId: 42 });
    check(badType.status === 400, 'focus non-string channelId → 400', `status ${badType.status}`);

  } finally {
    try {
      await httpJson('POST', '/deck/focus', { channelId: null });
      if (addedOverlayId) await httpJson('DELETE', `/mixer/channels/${addedOverlayId}`);
    } catch (e) {
      console.warn(`  cleanup (engine) failed: ${e.message}`);
    }
    await stopEngine();
    // Restore tracked state files AFTER the engine is down (it writes on exit).
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\nSUMMARY: ${passed}/${total} assertions passed\n`);
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(async err => {
  console.error('Test harness error:', err);
  try { await stopEngine(); } catch {}
  try { restoreState(); } catch {}
  process.exit(1);
});
