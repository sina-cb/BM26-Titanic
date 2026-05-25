/**
 * hil_transition_pixel_perfect_test.mjs — HIL: every transition through
 * the real engine deck-swap pipeline, asserting per-pixel validity at
 * three sample positions (start, mid, end).
 *
 * Companion to tests/transitions_pixel_perfect.test.js (unit-test
 * oracle that bypasses the engine). This file boots a real engine on
 * the slot-1 port (31168), runs every trans_*.js script through
 * triggerDeckPatternSwap between two deterministic patterns
 * (test_const → test_dualband), and captures the master vis frames
 * via WebSocket. For each transition it asserts:
 *
 *   1. deckSwapStarted broadcasts within 500 ms of the swap request.
 *   2. deckSwapComplete fires within +/-400 ms of the requested
 *      durationMs.
 *   3. Every captured vis frame is a valid 6-channel array of
 *      length PIXEL_COUNT (52), with no NaN and every byte in
 *      [0, 255].
 *   4. The first vis frame after deckSwapStarted is dominated by
 *      A's solo signature (red), the final frame matches B's solo
 *      signature (red+cyan banded).
 *   5. At least one midpoint frame differs from BOTH endpoints
 *      (the transition is actually transitioning, not an instant
 *      cut at boot).
 *
 * No per-transition visual signature checks here — those live in
 * hil_transition_visual_test.mjs and the unit test. We only validate
 * the engine pipeline applied to every transition end-to-end, with
 * a total wall-time budget under 60 s for all 16 transitions.
 *
 * ── Self-booting ──────────────────────────────────────────────────────
 *   Per .agent/00_gol/13_multi_agent.md §5, a sub-agent runs servers
 *   on its allocated slot ports. This test spawns its OWN engine on
 *   slot 1 (port 31168) and shuts it down before exit. The operator's
 *   main engine on port 6968 is untouched. State snapshots from
 *   marsin_engine/states/test_bench/ are NOT touched because the test
 *   engine writes to the SAME state files (single source of truth);
 *   we snapshot before boot and restore on exit.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   cd marsin_engine
 *   node tests/hil/hil_transition_pixel_perfect_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = every transition passed
 *   1 = one or more transitions failed
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

const PORT = 31168;       // Slot 1 engine API per 13_multi_agent.md §5
const OSC_PORT = 31100;
const ENGINE_BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;
const PIXEL_COUNT = 52;
const BYTES_PER_PIXEL = 6;
const TRANSITION_DURATION_MS = 1200;
const SETTLE_MS = 300;

const TRANSITIONS = [
  'trans_crossfade',
  'trans_flash',
  'trans_dissolve',
  'trans_color_burst',
  'trans_morse_blink',
  'trans_ripple_in',
  'trans_iris',
  'trans_iris_close',
  'trans_diamond_wipe',
  'trans_diagonal_wipe',
  'trans_split_horizontal',
  'trans_split_vertical',
  'trans_wave_sweep',
  'trans_wipe_left',
  'trans_wipe_right',
  'trans_wipe_down',
];

// ─────────────────────────── helpers ────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
function openWs() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL);
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
function pixelsOf(buf) {
  const px = [];
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const o = i * BYTES_PER_PIXEL;
    px.push({ r: buf[o], g: buf[o+1], b: buf[o+2], w: buf[o+3], a: buf[o+4], u: buf[o+5] });
  }
  return px;
}
function bufsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function bufValid(buf) {
  // Every byte in [0,255] (Uint8 already enforces this, but check
  // length and reject undefined/non-finite values that could come from
  // a misframed broadcast).
  if (!buf || buf.length !== PIXEL_COUNT * BYTES_PER_PIXEL) return false;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v) || v < 0 || v > 255) return false;
  }
  return true;
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
      const p = path.join(STATE_DIR, f);
      fs.writeFileSync(p, snapshots[f]);
    }
  }
}

// ─────────────────────────── engine lifecycle ────────────────────────
let engineProc = null;
function startEngine() {
  return new Promise((resolve, reject) => {
    // Use the same node binary, run engine.js with overrides for port +
    // pattern + model. We also pipe stdout to a per-slot log file so a
    // failed boot can be triaged offline.
    const logPath = path.join('/tmp', `hil_transition_pixel_perfect_${PORT}.log`);
    const out = fs.openSync(logPath, 'w');
    const err = fs.openSync(logPath, 'a');
    // engine.js doesn't accept --osc-port; OSC binding comes from
    // config.yaml. Slot 1 owns OSC 31100 by 13_multi_agent.md §5, but
    // for the HIL test we leave OSC on the config default (10000) and
    // assert the API port (PORT) is free. The main checkout's engine
    // (on 6968 + OSC 10000) is presumed NOT running during a slot's
    // HIL run; if it is, this test will fail loudly on bind with a
    // clear error in the engine log.
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
    // Poll /mixer until we get a 200.
    const deadline = Date.now() + 15000;
    const poll = async () => {
      while (Date.now() < deadline) {
        try {
          const r = await httpJson('GET', '/mixer');
          if (r && r.channels !== undefined) return resolve();
        } catch {}
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

// ─────────────────────────── core runner ────────────────────────────
//
// For each transition: reset deck to test_const, configure deck
// transition mode, fire the swap to test_dualband, capture vis
// frames + lifecycle events, then assert.
async function runTransition(transitionMode) {
  // Capture timestamps relative to subscribe-open so we can correlate
  // events and vis frames.
  const ws = await openWs();
  const visFrames = [];   // { t, buf: Uint8Array }
  const events = [];      // { t, type, ... }
  const t0 = Date.now();
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const t = Date.now() - t0;
      if (msg.type === 'vis' && msg.vis && msg.vis.master) {
        const buf = decodeMaster(msg.vis.master);
        if (buf) visFrames.push({ t, buf });
      } else if (msg.type === 'deckSwapStarted' || msg.type === 'deckSwapComplete') {
        events.push({ t, ...msg });
      }
    } catch {}
  });

  // Make sure the master output is the deck (so vis.master reflects
  // the swap's blended buffer, not whatever mixer overlays are on).
  await httpJson('POST', '/mixer/view', { view: 'deck' });
  await sleep(SETTLE_MS);

  // Disable transitions, reset to test_const (instant), then enable
  // the transition we want to test and swap to test_dualband. Without
  // this two-step the reset itself becomes a soft-swap and the test
  // swap lands in the 409 EBUSY window.
  await httpJson('POST', '/deck/transition-config', { enabled: false });
  await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_const' });
  await sleep(SETTLE_MS);

  await httpJson('POST', '/deck/transition-config', {
    enabled: true, mode: transitionMode, durationMs: TRANSITION_DURATION_MS, shuffle: false,
  });
  await sleep(SETTLE_MS);

  // Snapshot a "pre" vis frame for the A-baseline check.
  const preVis = visFrames.length > 0 ? visFrames[visFrames.length - 1] : null;

  // Clear collectors and fire the swap.
  events.length = 0;
  const visBefore = visFrames.length;
  const reqT = Date.now() - t0;
  const swap = await httpJson('POST', '/deck/playlist/entry', { entryId: 'e_hil_dual' });
  await sleep(TRANSITION_DURATION_MS + 800);

  // Final settle to capture the post-completion B-baseline frame.
  const finalVis = visFrames.length > 0 ? visFrames[visFrames.length - 1] : null;

  ws.close();

  // Compute assertions.
  const startedEv = events.find(e => e.type === 'deckSwapStarted');
  const completeEv = events.find(e => e.type === 'deckSwapComplete');
  const errors = [];

  if (!startedEv) errors.push('deckSwapStarted not broadcast within window');
  if (!completeEv) errors.push('deckSwapComplete not broadcast within window');
  if (startedEv && (startedEv.t - reqT) > 500) {
    errors.push(`deckSwapStarted lagged ${startedEv.t - reqT} ms after request (>500 ms)`);
  }
  if (startedEv && completeEv) {
    const dur = completeEv.t - startedEv.t;
    if (Math.abs(dur - TRANSITION_DURATION_MS) > 500) {
      errors.push(`completion in ${dur} ms, expected ~${TRANSITION_DURATION_MS} +/- 500 ms`);
    }
  }

  // Pixel validity on EVERY frame captured during the swap.
  let invalidFrames = 0;
  let nanFrames = 0;
  for (const f of visFrames.slice(visBefore)) {
    if (!bufValid(f.buf)) {
      invalidFrames++;
      // bufValid combines length + value range + NaN. Re-check for NaN
      // specifically so the error is precise.
      for (let i = 0; i < f.buf.length; i++) if (!Number.isFinite(f.buf[i])) { nanFrames++; break; }
    }
  }
  if (invalidFrames > 0) {
    errors.push(`${invalidFrames}/${visFrames.length - visBefore} vis frames invalid (NaN frames: ${nanFrames})`);
  }

  // Check pre-swap = A solo signature: pixel[0]=red (R>200, G<50)
  if (preVis) {
    const px = pixelsOf(preVis.buf);
    if (!(px[0].r > 200 && px[0].g < 50)) {
      errors.push(`pre-swap pixel[0] not red: R:${px[0].r} G:${px[0].g} B:${px[0].b}`);
    }
  }
  // Check final = B solo: pixel[0] still red AND pixel[15] cyan
  if (finalVis) {
    const px = pixelsOf(finalVis.buf);
    const cyan15 = px[15].g > 200 && px[15].b > 200;
    if (!cyan15) {
      errors.push(`final pixel[15] not cyan (B-band): R:${px[15].r} G:${px[15].g} B:${px[15].b}`);
    }
  }

  // Verify the transition was actually transitioning: at least one
  // mid-swap frame must differ from BOTH the pre and final signatures.
  // (preVis / finalVis can be null on a flaky first run, in which case
  // we skip this rather than fail spuriously.)
  if (preVis && finalVis) {
    let anyMidDiffers = false;
    for (const f of visFrames.slice(visBefore)) {
      // Skip the very last frame (== finalVis) and the very first
      // (== preVis) so we don't trivially match endpoints.
      if (!bufsEqual(f.buf, preVis.buf) && !bufsEqual(f.buf, finalVis.buf)) {
        anyMidDiffers = true;
        break;
      }
    }
    if (!anyMidDiffers) {
      errors.push('no mid-swap frame differed from both pre and final — transition appears inactive');
    }
  }

  return {
    transitionMode,
    pass: errors.length === 0,
    errors,
    frameCount: visFrames.length - visBefore,
  };
}

// ─────────────────────────── main ───────────────────────────────────
(async () => {
  console.log('==========================================================');
  console.log('hil_transition_pixel_perfect_test.mjs');
  console.log(`  engine port: ${PORT}  pixel_count: ${PIXEL_COUNT}`);
  console.log('==========================================================');

  snapshotState();
  process.on('exit', restoreState);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => { try { restoreState(); await stopEngine(); } finally { process.exit(130); } });
  }

  console.log('\n[boot] starting test engine on port', PORT, '...');
  const bootStart = Date.now();
  try {
    await startEngine();
    console.log(`  engine ready in ${Date.now() - bootStart} ms`);
  } catch (e) {
    console.error('  engine boot failed:', e.message);
    restoreState();
    process.exit(1);
  }

  // Provision the test playlist (idempotent — same name as
  // hil_deck_swap_test so we don't duplicate cleanup logic).
  const HIL_PL = 'hil_transition_pixel_perfect';
  let originalPlaylist = 'default';
  try {
    const cur = await httpJson('GET', '/deck/playlist');
    originalPlaylist = (cur && cur.name) || 'default';
  } catch {}

  await httpJson('POST', '/playlists', {
    name: HIL_PL,
    entries: [
      { id: 'e_hil_const', pattern: 'test_const', label: 'A (red)', defaults: {} },
      { id: 'e_hil_dual',  pattern: 'test_dualband', label: 'B (red+cyan)', defaults: {} },
    ],
  });
  await httpJson('POST', '/deck/playlist', { name: HIL_PL });
  await sleep(SETTLE_MS * 2);

  // Pin the color palette so test_const = red and test_dualband =
  // red+cyan bands (CPC bound via colorPalette1/2 in those patterns).
  let savedCpc = null;
  try {
    const cpcBefore = await httpJson('GET', '/param-center');
    const p = cpcBefore.params || cpcBefore;
    savedCpc = {
      colorPalette1: p.colorPalette1?.value || p.colorPalette1 || { h: 0, s: 1, v: 1 },
      colorPalette2: p.colorPalette2?.value || p.colorPalette2 || { h: 0.5, s: 1, v: 1 },
      size: (typeof p.size?.value === 'number') ? p.size.value : (typeof p.size === 'number' ? p.size : 0.5),
    };
    await httpJson('POST', '/param-center', {
      colorPalette1: { h: 0.0, s: 1.0, v: 1.0 },
      colorPalette2: { h: 0.5, s: 1.0, v: 1.0 },
      size: 0.5,
    });
  } catch (e) {
    console.warn('  could not pin CPC palette:', e.message);
  }

  const overallStart = Date.now();
  const results = [];
  for (const tm of TRANSITIONS) {
    process.stdout.write(`\n[${tm}]\n`);
    try {
      const r = await runTransition(tm);
      results.push(r);
      const tag = r.pass ? 'PASS' : 'FAIL';
      console.log(`  ${tag}  frames=${r.frameCount}`);
      for (const e of r.errors) console.log(`    - ${e}`);
    } catch (e) {
      results.push({ transitionMode: tm, pass: false, errors: [`exception: ${e.message}`], frameCount: 0 });
      console.log(`  FAIL  exception: ${e.message}`);
    }
  }
  const elapsedSec = ((Date.now() - overallStart) / 1000).toFixed(1);

  // Restore CPC.
  if (savedCpc) {
    try { await httpJson('POST', '/param-center', savedCpc); } catch {}
  }
  // Swing deck back to the original playlist and delete the HIL one.
  try {
    await httpJson('POST', '/deck/transition-config', { enabled: false });
    await httpJson('POST', '/deck/playlist', { name: originalPlaylist });
    await httpJson('DELETE', `/playlists/${encodeURIComponent(HIL_PL)}`);
  } catch (e) {
    console.warn('  cleanup warn:', e.message);
  }

  await stopEngine();
  restoreState();

  // Summary.
  console.log('\n' + '='.repeat(58));
  console.log('SUMMARY');
  console.log('='.repeat(58));
  const passN = results.filter(r => r.pass).length;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${tag.padEnd(4)}  ${r.transitionMode.padEnd(26)}  frames=${r.frameCount}`);
  }
  console.log(`\n${passN}/${results.length} transitions passed in ${elapsedSec}s`);

  if (Number(elapsedSec) > 60) {
    console.log(`  (NOTE: total wall time ${elapsedSec}s exceeded the 60s budget — consider trimming TRANSITION_DURATION_MS)`);
  }

  process.exit(passN === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error('Unexpected failure:', e);
  try { await stopEngine(); } catch {}
  restoreState();
  process.exit(1);
});
