/**
 * hil_mixer_undo_test.mjs — HIL test for round-2 #10 MIXER UNDO (docs/39 §F-undo).
 *
 * Undo the last DESTRUCTIVE mixer action (channel delete, snapshot recall,
 * recall-fade, reorder, param-preset recall) by restoring a captureLook()
 * snapshot taken BEFORE the mutation, via the proven never-dark recallLook().
 *
 * Drives the FULL engine path (REST + WS + 40 Hz render loop + vis broadcast)
 * on a live engine — the CPC re-registration + WASM rebuild that a unit test
 * with a fake host can't exercise (those pure bits live in
 * tests/mixer_undo.test.js + tests/ws_topic_routing.test.js).
 *
 * Scenario:
 *   1. Empty-stack guard: POST /mixer/undo on a fresh ring → 400 UNDO_EMPTY.
 *   2. DELETE → undo: add an overlay (test_const, lit), delete it, undo;
 *      GET /mixer shows it back with the SAME id + pattern + fader, and the
 *      output renders (master vis buffer non-zero). depth/top tracked.
 *   3. RECALL → undo: capture a snapshot of the current look, move the live
 *      mix AWAY (master + fader), recall the snapshot, undo; the live mix
 *      EQUALS the pre-recall look (master + per-channel faders).
 *   4. REORDER → undo: reverse the overlay order, undo, order is restored.
 *   5. Non-destructive PATCH does NOT push: a fader PATCH leaves undo depth
 *      unchanged.
 *   6. Deck never dark: the master vis buffer is non-zero across every undo.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   ENGINE_PORT=31268 node engine.js --pattern test_const --model test_bench --port 31268
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   ENGINE_PORT=31268 node tests/hil/hil_mixer_undo_test.mjs
 *   (or: node tests/hil/hil_mixer_undo_test.mjs --port 31268)
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : (process.env.ENGINE_PORT ? parseInt(process.env.ENGINE_PORT, 10) : 31268);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_VIZ = `ws://127.0.0.1:${PORT}/ws/viz`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = path.resolve(__dirname, '../../states/test_bench/snapshots');
const SNAP_NAME = 'hil_undo_target';

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
function captureMasterBrightness(ms = 1200) {
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

async function undoDepth() {
  const r = await httpJson('GET', '/mixer/undo');
  return r.body && typeof r.body.depth === 'number' ? r.body.depth : -1;
}

async function main() {
  console.log(`\n== HIL: mixer UNDO (round-2 #10) (engine ${BASE}) ==\n`);
  const overlays = [];

  try {
    const mx0 = await httpJson('GET', '/mixer');
    check(mx0.status === 200, 'GET /mixer reachable', `status=${mx0.status}`);
    // Clean slate: remove any existing overlays so id/order math is exact.
    for (const c of mx0.body.channels) await httpJson('DELETE', `/mixer/channels/${c.id}`);

    // ── 1. Empty-stack guard ─────────────────────────────────────────────
    // Drain any undo entries the cleanup deletes just pushed, so the ring is
    // empty for the guard assertion.
    let guard;
    do { guard = await httpJson('POST', '/mixer/undo'); } while (guard.status === 200);
    check(guard.status === 400 && guard.body && guard.body.code === 'UNDO_EMPTY',
      'empty ring: POST /mixer/undo → 400 UNDO_EMPTY (fail loud, not a no-op)',
      `status=${guard.status} body=${JSON.stringify(guard.body)}`);
    const g = await httpJson('GET', '/mixer/undo');
    check(g.status === 200 && g.body.depth === 0 && g.body.top === null,
      'empty ring: GET /mixer/undo → {depth:0, top:null}',
      `body=${JSON.stringify(g.body)}`);

    // ── 2. DELETE → undo restores the channel (id + pattern + fader + CPC) ─
    const a = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'EXT' });
    check(a.status === 200, 'add overlay A (test_const, lit)', `status=${a.status}`);
    const aId = a.body.channelId; overlays.push(aId);
    await httpJson('PATCH', `/mixer/channels/${aId}`, { fader: 0.73 });
    const beforeDel = await httpJson('GET', '/mixer');
    const aBefore = beforeDel.body.channels.find(c => c.id === aId);
    check(aBefore && Math.abs(aBefore.fader - 0.73) < 0.01, 'overlay A fader set to 0.73', `fader=${aBefore?.fader}`);

    const litBeforeDel = await captureMasterBrightness(900);

    const del = await httpJson('DELETE', `/mixer/channels/${aId}`);
    check(del.status === 200, 'DELETE overlay A → 200', `status=${del.status}`);
    const afterDel = await httpJson('GET', '/mixer');
    check(!afterDel.body.channels.some(c => c.id === aId), 'overlay A gone after delete');
    const depthAfterDel = await undoDepth();
    check(depthAfterDel === 1, 'undo depth = 1 after a delete (one destructive push)', `depth=${depthAfterDel}`);
    const topInfo = await httpJson('GET', '/mixer/undo');
    check(typeof topInfo.body.top === 'string' && topInfo.body.top.includes(aId),
      'GET /mixer/undo top label names the deleted channel', `top=${topInfo.body.top}`);

    const u1 = await httpJson('POST', '/mixer/undo');
    check(u1.status === 200, 'POST /mixer/undo (after delete) → 200', `status=${u1.status} body=${JSON.stringify(u1.body)}`);
    await sleep(150);
    const restored = await httpJson('GET', '/mixer');
    const aRestored = restored.body.channels.find(c => c.id === aId);
    check(!!aRestored, 'undo RESTORES the deleted overlay with the SAME id', `ids=${JSON.stringify(restored.body.channels.map(c => c.id))}`);
    check(aRestored && aRestored.pattern === aBefore.pattern, 'restored overlay keeps its pattern', `pattern=${aRestored?.pattern}`);
    check(aRestored && Math.abs(aRestored.fader - 0.73) < 0.01, 'restored overlay keeps its fader (0.73)', `fader=${aRestored?.fader}`);

    const litAfterUndo = await captureMasterBrightness(1200);
    check(litAfterUndo > 0, 'MISSION-CRITICAL: output renders NON-ZERO after delete-undo (CPC re-registered, never dark)', `brightness=${litAfterUndo}`);
    check(litBeforeDel > 0, '   (sanity: output was lit before the delete too)', `brightness=${litBeforeDel}`);

    // ── 3. RECALL → undo equals the pre-recall look ──────────────────────
    // Build a snapshot with a DIFFERENT look than the live mix, recall it (a
    // destructive whole-look swap), then undo — the live mix must equal the
    // look that existed at the instant of recall (what recall's pushUndo
    // captured), NOT the snapshot's contents.
    //
    // Step 3a: set A to the snapshot value, capture the snapshot.
    await httpJson('PATCH', `/mixer/channels/${aId}`, { fader: 0.20 });
    await sleep(40);
    const snap = await httpJson('POST', '/mixer/snapshots', { name: SNAP_NAME });
    check(snap.status === 200, 'capture snapshot of the current look', `status=${snap.status}`);

    // Step 3b: move the LIVE mix AWAY from the snapshot — THIS is the
    // pre-recall look undo must bring back. Capture it as the reference.
    await httpJson('PATCH', `/mixer/channels/${aId}`, { fader: 0.66 });
    await sleep(60);
    const preRecall = await httpJson('GET', '/mixer');
    const preMaster = preRecall.body.master;
    const preFaderById = Object.fromEntries(preRecall.body.channels.map(c => [c.id, c.fader]));

    const rec = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall`);
    check(rec.status === 200, 'recall the snapshot → 200', `status=${rec.status}`);
    const depthAfterRecall = await undoDepth();
    check(depthAfterRecall >= 1, 'recall pushed an undo entry', `depth=${depthAfterRecall}`);
    // Sanity: the recall actually moved A to the snapshot value (0.20), proving
    // the look really changed (so the undo below is meaningful).
    const afterRecall = await httpJson('GET', '/mixer');
    const aAfterRecall = afterRecall.body.channels.find(c => c.id === aId);
    check(aAfterRecall && Math.abs(aAfterRecall.fader - 0.20) < 0.02,
      'recall applied the snapshot look (A → 0.20)', `fader=${aAfterRecall?.fader}`);

    const u2 = await httpJson('POST', '/mixer/undo');
    check(u2.status === 200, 'POST /mixer/undo (after recall) → 200', `status=${u2.status}`);
    await sleep(150);
    const afterUndo2 = await httpJson('GET', '/mixer');
    const matchMaster = Math.abs(afterUndo2.body.master - preMaster) < 0.02;
    let matchFaders = true;
    for (const c of afterUndo2.body.channels) {
      if (preFaderById[c.id] === undefined) continue;
      if (Math.abs(c.fader - preFaderById[c.id]) > 0.02) matchFaders = false;
    }
    check(matchMaster, 'recall-undo restores the pre-recall MASTER', `master ${afterUndo2.body.master} vs ${preMaster}`);
    check(matchFaders, 'recall-undo restores the pre-recall per-channel FADERS (A → 0.66)',
      `A=${afterUndo2.body.channels.find(c => c.id === aId)?.fader} want 0.66`);

    const litAfterRecallUndo = await captureMasterBrightness(1000);
    check(litAfterRecallUndo > 0, 'deck never dark across recall-undo (output non-zero)', `brightness=${litAfterRecallUndo}`);

    // ── 4. REORDER → undo restores order ─────────────────────────────────
    // Need at least 2 overlays to reorder meaningfully.
    const b = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'EXT2' });
    if (b.status === 200) { overlays.push(b.body.channelId); }
    const beforeReorder = await httpJson('GET', '/mixer');
    const orderBefore = beforeReorder.body.channels.map(c => c.id);
    if (orderBefore.length >= 2) {
      const reversed = [...orderBefore].reverse();
      const ro = await httpJson('POST', '/mixer/channels/reorder', { order: reversed });
      check(ro.status === 200, 'reorder (reverse) → 200', `status=${ro.status}`);
      const afterReorder = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
      check(JSON.stringify(afterReorder) === JSON.stringify(reversed), 'live order reversed', `order=${JSON.stringify(afterReorder)}`);
      const u3 = await httpJson('POST', '/mixer/undo');
      check(u3.status === 200, 'POST /mixer/undo (after reorder) → 200', `status=${u3.status}`);
      await sleep(120);
      const orderRestored = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
      check(JSON.stringify(orderRestored) === JSON.stringify(orderBefore),
        'reorder-undo restores the original order', `got=${JSON.stringify(orderRestored)} want=${JSON.stringify(orderBefore)}`);
    } else {
      check(true, '   (skipped reorder-undo: fewer than 2 overlays)');
    }

    // ── 5. Non-destructive PATCH does NOT push ───────────────────────────
    const depthPrePatch = await undoDepth();
    const liveIds = (await httpJson('GET', '/mixer')).body.channels.map(c => c.id);
    if (liveIds.length > 0) {
      await httpJson('PATCH', `/mixer/channels/${liveIds[0]}`, { fader: 0.55 });
      await sleep(40);
      const depthPostPatch = await undoDepth();
      check(depthPostPatch === depthPrePatch,
        'a fader PATCH (non-destructive) does NOT push an undo entry',
        `depth ${depthPrePatch} → ${depthPostPatch}`);
    } else {
      check(true, '   (skipped non-destructive-PATCH check: no live overlays)');
    }

  } catch (e) {
    fail('unexpected error', e.stack || String(e));
  } finally {
    // Cleanup: delete the test snapshot (REST + the on-disk file) and overlays.
    try { await httpJson('DELETE', `/mixer/snapshots/${SNAP_NAME}`); } catch (_) {}
    try { if (fs.existsSync(path.join(SNAP_DIR, `${SNAP_NAME}.yaml`))) fs.unlinkSync(path.join(SNAP_DIR, `${SNAP_NAME}.yaml`)); } catch (_) {}
    for (const id of overlays) { try { await httpJson('DELETE', `/mixer/channels/${id}`); } catch (_) {} }
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} checks passed\n`);
  process.exit(passed === total ? 0 : 1);
}

main();
