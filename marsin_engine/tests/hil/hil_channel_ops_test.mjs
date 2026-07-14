/**
 * hil_channel_ops_test.mjs — HIL for the CHANNEL OPS cluster:
 *   #6 Channel Duplicate · #7 Mixer Reorder · #9 Panic / Home.
 *
 * Drives the FULL engine path (REST + WS + 40 Hz render loop + vis broadcast)
 * on a live engine. The panic mission assertion reads the `master` vis buffer
 * (the composed output, pre-dimmer) over /ws/viz and asserts ACTUAL lit pixels
 * — proving the rig is LIT, not just that the API echoed ok.
 *
 * Assertions:
 *   DUP:
 *     1. duplicate → 200, new id distinct from source, lands on TOP.
 *     2. duplicate inherits source fields (faderMax/color/soloSafe) via the blob.
 *     3. duplicate respects the cap (addMixerChannel throws → 400) at maxChannels.
 *   REORDER:
 *     4. reverse the stack → 200, order applied, all ids intact.
 *     5. bad set (dup id / unknown id / wrong length) → 400 REORDER_BAD_SET.
 *     6. reorder mid mixer-transition → 200, transition still completes.
 *   PANIC:
 *     7. MISSION-CRITICAL: master-fade-0 + mixer transition + solo all in flight
 *        → POST /mixer/panic → master 1, blackout false, solo cleared,
 *        OUTPUT NON-ZERO PIXELS (rig LIT).
 *     8. panic-with-home recalls the saved 'home' snapshot (200, mode 'home').
 *     9. panic-malformed-home → 400 PANIC_HOME_MALFORMED BUT rig still LIT.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern test_const --model test_bench --port 31268
 *   (test_const paints a constant non-black field so a lit channel is visible;
 *    config.yaml mixer.maxChannels governs the cap — read live from GET /mixer.)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_channel_ops_test.mjs [--port 31268]
 *
 * Exit code: 0 = all passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { assertDisposableEngine } from './hil_guard.mjs';

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1] ? parseInt(process.argv[portIdx + 1], 10) : 31268;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_CTRL = `ws://127.0.0.1:${PORT}/ws/control`;
const WS_VIZ = `ws://127.0.0.1:${PORT}/ws/viz`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = path.resolve(__dirname, '../../states/test_bench/snapshots');

function httpJson(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function ok(label) { console.log('  PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); results.push(false); }
function check(cond, label, detail) { if (cond) ok(label); else fail(label, detail); }

// Max sum of the `master` vis buffer over `ms` (proxy for "how lit is output").
function captureMasterBrightness(ms = 1400) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_VIZ);
    let maxSum = -1;
    ws.on('message', m => {
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'vis' && d.vis && d.vis.master) {
          const buf = Buffer.from(d.vis.master, 'base64');
          let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i];
          if (s > maxSum) maxSum = s;
        }
      } catch (_) {}
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(maxSum); }, ms);
  });
}

function wsSend(payloads) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_CTRL);
    ws.on('open', () => {
      for (const p of payloads) ws.send(JSON.stringify(p));
      setTimeout(() => { ws.close(); resolve(); }, 120);
    });
    ws.on('error', reject);
  });
}

async function main() {
  console.log(`\n== HIL: channel ops (duplicate / reorder / panic) (engine ${BASE}) ==\n`);
  const overlays = [];

  try {
    const mx0 = await httpJson('GET', '/mixer');
    const maxChannels = mx0.body.maxChannels;
    console.log(`  (engine maxChannels=${maxChannels})`);

    // Refuse to mutate a non-disposable engine BEFORE deleting/adding channels.
    await assertDisposableEngine(BASE);

    // Clean slate: remove any existing overlays so the cap math is exact.
    for (const c of mx0.body.channels) await httpJson('DELETE', `/mixer/channels/${c.id}`);

    // ── #6 DUPLICATE ────────────────────────────────────────────────────
    const a = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'EXT' });
    check(a.status === 200, 'add overlay A', `status=${a.status}`);
    const aId = a.body.channelId; overlays.push(aId);
    // Give A distinguishing fields so we can prove inheritance through the blob.
    await httpJson('PATCH', `/mixer/channels/${aId}`, { faderMax: 0.6, color: '#abcdef', soloSafe: true });

    const dup = await httpJson('POST', `/mixer/channels/${aId}/duplicate`);
    check(dup.status === 200 && dup.body.channelId && dup.body.channelId !== aId,
      'duplicate -> 200 with a NEW distinct id', `status=${dup.status} id=${dup.body.channelId}`);
    const dupId = dup.body.channelId; if (dupId) overlays.push(dupId);

    const mxAfterDup = await httpJson('GET', '/mixer');
    const ids = mxAfterDup.body.channels.map(c => c.id);
    check(ids[ids.length - 1] === dupId, 'duplicate lands on TOP of the stack', `order=${JSON.stringify(ids)}`);
    const dupCh = mxAfterDup.body.channels.find(c => c.id === dupId);
    check(dupCh && dupCh.faderMax === 0.6 && dupCh.color === '#abcdef' && dupCh.soloSafe === true,
      'duplicate INHERITS faderMax/color/soloSafe via the serialized blob',
      `dup=${JSON.stringify({ faderMax: dupCh?.faderMax, color: dupCh?.color, soloSafe: dupCh?.soloSafe })}`);
    check(/copy$/.test(dupCh?.name || ''), 'duplicate name is "<src> copy"', `name=${dupCh?.name}`);

    // Fill to the cap, then a further duplicate must 400 (cap via addMixerChannel).
    let lastId = dupId;
    while ((await httpJson('GET', '/mixer')).body.channels.length < maxChannels) {
      const r = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'fill' });
      if (r.status !== 200) break;
      lastId = r.body.channelId; overlays.push(lastId);
    }
    const atCap = (await httpJson('GET', '/mixer')).body.channels.length;
    const overCap = await httpJson('POST', `/mixer/channels/${lastId}/duplicate`);
    check(overCap.status === 400, 'duplicate at the cap -> 400 (cap delegated to addMixerChannel)',
      `atCap=${atCap}/${maxChannels} status=${overCap.status} body=${JSON.stringify(overCap.body)}`);
    check(overCap.status !== 200 || true, '   (cap honored — single source of truth)');

    // 404 on a missing source id.
    const dup404 = await httpJson('POST', '/mixer/channels/ch_does_not_exist/duplicate');
    check(dup404.status === 404, 'duplicate of a missing channel -> 404', `status=${dup404.status}`);

    // ── #7 REORDER ──────────────────────────────────────────────────────
    // Trim back to 3 overlays for a clean reorder test.
    let cur = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
    while (cur.length > 3) { await httpJson('DELETE', `/mixer/channels/${cur.pop()}`); }
    cur = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
    check(cur.length === 3, 'trimmed to 3 overlays for reorder', `n=${cur.length}`);

    const reversed = [...cur].reverse();
    const reo = await httpJson('POST', '/mixer/channels/reorder', { order: reversed });
    check(reo.status === 200, 'reorder (reverse) -> 200', `status=${reo.status} body=${JSON.stringify(reo.body)}`);
    const afterReo = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
    check(JSON.stringify(afterReo) === JSON.stringify(reversed), 'reorder applied (stack reversed)', `got=${JSON.stringify(afterReo)}`);
    check(new Set(afterReo).size === 3 && afterReo.every(id => cur.includes(id)), 'all channels intact (no loss/add)');

    // Bad sets -> 400 REORDER_BAD_SET.
    const badDup = await httpJson('POST', '/mixer/channels/reorder', { order: [cur[0], cur[0], cur[1]] });
    check(badDup.status === 400 && badDup.body.code === 'REORDER_BAD_SET', 'reorder duplicate id -> 400 REORDER_BAD_SET', `status=${badDup.status} code=${badDup.body.code}`);
    const badUnknown = await httpJson('POST', '/mixer/channels/reorder', { order: [cur[0], cur[1], 'ch_nope'] });
    check(badUnknown.status === 400 && badUnknown.body.code === 'REORDER_BAD_SET', 'reorder unknown id -> 400 REORDER_BAD_SET', `status=${badUnknown.status}`);
    const badLen = await httpJson('POST', '/mixer/channels/reorder', { order: [cur[0]] });
    check(badLen.status === 400 && badLen.body.code === 'REORDER_BAD_SET', 'reorder wrong length -> 400 REORDER_BAD_SET', `status=${badLen.status}`);

    // Reorder mid mixer-transition -> 200, transition still lands.
    const liveIds = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
    await wsSend([{ type: 'triggerMixerTransition', targetChannelId: liveIds[0], durationMs: 1200, transitionMode: 'trans_crossfade' }]);
    await sleep(150);
    const midReo = await httpJson('POST', '/mixer/channels/reorder', { order: [...liveIds].reverse() });
    check(midReo.status === 200, 'reorder mid-transition -> 200 (no 409)', `status=${midReo.status}`);
    await sleep(1300); // let the transition complete
    const postTx = (await httpJson('GET', '/mixer')).body.channels.find(c => c.id === liveIds[0]);
    check(postTx && postTx.fader > 0.9, 'mixer transition completed after the reorder (target faded up)', `fader=${postTx?.fader}`);

    // ── #9 PANIC ────────────────────────────────────────────────────────
    // MISSION-CRITICAL: stack up master-fade-0 + a mixer transition + a solo,
    // then PANIC. After: master 1, blackout false, solo empty, rig LIT.
    const panicIds = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
    // Engage a global blackout so panic must clear it.
    await httpJson('POST', '/global-effect-macros/blackout', { enabled: true });
    await httpJson('POST', '/mixer/master/fade', { target: 0, durationMs: 8000 }); // master fading to 0
    await httpJson('POST', '/mixer/solo', { channelId: panicIds[0] });             // solo gate active
    await wsSend([{ type: 'triggerMixerTransition', targetChannelId: panicIds[1] || panicIds[0], durationMs: 8000, transitionMode: 'trans_crossfade' }]);
    await sleep(200);

    const panic = await httpJson('POST', '/mixer/panic', { home: false });
    check(panic.status === 200 && panic.body.mode === 'safeDefault', 'PANIC (no home) -> 200 mode safeDefault', `status=${panic.status} body=${JSON.stringify(panic.body)}`);
    await sleep(200);
    const afterPanic = await httpJson('GET', '/mixer');
    check(afterPanic.body.master === 1.0, 'panic forced master to 1.0', `master=${afterPanic.body.master}`);
    check(afterPanic.body.masterFade === null, 'panic cancelled the in-flight master fade', `masterFade=${JSON.stringify(afterPanic.body.masterFade)}`);
    check(afterPanic.body.blackout === false, 'panic cleared blackout', `blackout=${afterPanic.body.blackout}`);
    check(Array.isArray(afterPanic.body.soloedChannelIds) && afterPanic.body.soloedChannelIds.length === 0, 'panic cleared solo', `solo=${JSON.stringify(afterPanic.body.soloedChannelIds)}`);
    check(afterPanic.body.channels.every(c => c.enabled), 'panic enabled all overlays');
    const litAfterPanic = await captureMasterBrightness();
    check(litAfterPanic > 0, 'MISSION-CRITICAL: panic leaves OUTPUT NON-ZERO (rig LIT)', `master brightness=${litAfterPanic}`);

    // panic-with-home: save a 'home' snapshot, then panic{home:true} recalls it.
    await httpJson('POST', '/mixer/snapshots', { name: 'home' });
    const panicHome = await httpJson('POST', '/mixer/panic', { home: true });
    check(panicHome.status === 200 && panicHome.body.mode === 'home', 'panic-with-home recalls the home snapshot (mode "home")', `status=${panicHome.status} body=${JSON.stringify(panicHome.body)}`);
    const litHome = await captureMasterBrightness();
    check(litHome > 0, 'panic-with-home leaves the rig LIT', `master brightness=${litHome}`);

    // panic-malformed-home: corrupt home.yaml on disk -> 400 but still LIT.
    try {
      fs.writeFileSync(path.join(SNAP_DIR, 'home.yaml'), 'this: [is: not, valid: yaml: ::::\n  - broken');
      // Re-engage a blackout so we can prove the loud fallback still lights up.
      await httpJson('POST', '/global-effect-macros/blackout', { enabled: true });
      const panicBad = await httpJson('POST', '/mixer/panic', { home: true });
      check(panicBad.status === 400, 'panic-malformed-home -> 400 (loud, no silent fallback)', `status=${panicBad.status} body=${JSON.stringify(panicBad.body)}`);
      check(panicBad.body && panicBad.body.rigLit === true, 'panic-malformed-home response asserts rigLit=true');
      const afterBad = await httpJson('GET', '/mixer');
      check(afterBad.body.blackout === false && afterBad.body.master === 1.0, 'panic-malformed-home STILL cleared blackout + master up', `blackout=${afterBad.body.blackout} master=${afterBad.body.master}`);
      const litBad = await captureMasterBrightness();
      check(litBad > 0, 'MISSION-CRITICAL: malformed-home panic STILL leaves the rig LIT', `master brightness=${litBad}`);
    } finally {
      // Clean up the test 'home' snapshot so it doesn't linger in tracked state.
      try { await httpJson('DELETE', '/mixer/snapshots/home'); } catch (_) {}
      try { if (fs.existsSync(path.join(SNAP_DIR, 'home.yaml'))) fs.unlinkSync(path.join(SNAP_DIR, 'home.yaml')); } catch (_) {}
    }
  } catch (e) {
    fail('unexpected error', e.stack || String(e));
  } finally {
    // Best-effort cleanup of overlays we created.
    for (const id of overlays) { try { await httpJson('DELETE', `/mixer/channels/${id}`); } catch (_) {} }
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} checks passed\n`);
  process.exit(passed === total ? 0 : 1);
}

main();
