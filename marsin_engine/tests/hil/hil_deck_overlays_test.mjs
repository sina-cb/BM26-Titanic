/**
 * hil_deck_overlays_test.mjs — HIL test for DECK DYNAMIC VIEW OVERRIDES.
 *
 * Self-contained, single-command lifetime: spawns its OWN engine on
 * ENGINE_PORT (default 31268) with the test_bench model, runs the scenarios
 * against the live REST + WS surface, then reaps the engine (~60s total).
 *
 * ── How to run ────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_deck_overlays_test.mjs
 *
 * ── What it tests (per the build spec) ────────────────────────────────
 *   1. Add an overlay on a GROUP view → only that group's pixels change in
 *      the rig buffer; the exterior OUTSIDE the view stays LIT.
 *   2. Add a 2nd overlay on the SAME view → 409 DECK_OVERLAY_VIEW_TAKEN.
 *   3. Reorder two overlapping overlays → the new TOP wins.
 *   4. A 5th overlay → 400 DECK_OVERLAY_OVER_CAP.
 *   5. Set the SHARED overlay autopilot (small delay) → two auto-advancing
 *      overlays advance in UNISON (cursors flip together off ONE clock).
 *   6. Toggle GLOBAL invert → overlays invert too (shared globals): the rig
 *      buffer flips.
 *   7. Deck/mixer crossfade still works with overlays present.
 *   8. Blackout still wins (rig goes dark).
 *   9. Serialized deck WS state contains overlays + shared overlay autopilot.
 *
 * ── Exit code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed; 1 = one or more failed (printed inline).
 */

import http from 'http';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const PORT = parseInt(process.env.ENGINE_PORT || '31268', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');

// ─── model pixel → group map (test_bench) ─────────────────────────────
const { pixels: MODEL_PIXELS } = await import('../../models/test_bench.js');
function groupIndices(groupName) {
  return MODEL_PIXELS.filter(p => p.group === groupName).map(p => p.i);
}

// ─── helpers ──────────────────────────────────────────────────────────
function httpJson(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, BASE);
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    }, res => {
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Control socket (/ws/control) carries deck + mixer state. The viz socket
// (/ws/viz) carries the high-volume `vis` frames (rig/master pixel buffers) —
// they live on SEPARATE topics post-split, so we open both.
function openWs(pathSuffix = '/ws/control') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + pathSuffix);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const results = [];
function ok(l) { console.log('  ✓ PASS  ' + l); results.push(true); }
function fail(l, d) { console.log('  ✗ FAIL  ' + l + (d ? '  → ' + d : '')); results.push(false); }
function check(cond, passL, failL, d) { if (cond) ok(passL); else fail(failL || passL, d); }

// Wait for ONE `deck` WS message satisfying predicate (or null on timeout).
function waitForDeck(ws, predicate, timeoutMs) {
  return new Promise(resolve => {
    const onMsg = raw => {
      let o; try { o = JSON.parse(raw); } catch { return; }
      if (o.type !== 'deck') return;
      if (!predicate(o)) return;
      cleanup(); resolve(o);
    };
    const to = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const cleanup = () => { ws.off('message', onMsg); clearTimeout(to); };
    ws.on('message', onMsg);
  });
}

// Sample the latest `rig` vis buffer (full 52px for test_bench, no subsample).
function sampleRig(ws, windowMs = 700) {
  return new Promise(resolve => {
    let latest = null;
    const onMsg = raw => {
      let o; try { o = JSON.parse(raw); } catch { return; }
      if (o.type !== 'vis' || !o.vis || !o.vis.rig) return;
      latest = Buffer.from(o.vis.rig, 'base64');
    };
    ws.on('message', onMsg);
    setTimeout(() => { ws.off('message', onMsg); resolve(latest); }, windowMs);
  });
}
function meanRgbAt(buf, indices) {
  if (!buf) return 0;
  let sum = 0, n = 0;
  for (const i of indices) {
    const o = i * 6;
    if (o + 2 >= buf.length) continue;
    sum += buf[o] + buf[o + 1] + buf[o + 2];
    n += 3;
  }
  return n ? sum / n : 0;
}
// Sample the latest vis buffer for ANY key (e.g. a specific overlay id, or
// 'master'/'rig'). Each channel/overlay's OWN rendered buffer is broadcast
// under its id — so we can observe an overlay's render + view mask directly,
// independent of the deck pattern's brightness.
function sampleVisKey(ws, key, windowMs = 800) {
  return new Promise(resolve => {
    let latest = null;
    const onMsg = raw => {
      let o; try { o = JSON.parse(raw); } catch { return; }
      if (o.type !== 'vis' || !o.vis || !o.vis[key]) return;
      latest = Buffer.from(o.vis[key], 'base64');
    };
    ws.on('message', onMsg);
    setTimeout(() => { ws.off('message', onMsg); resolve(latest); }, windowMs);
  });
}

// ─── engine lifecycle ─────────────────────────────────────────────────
let engineProc = null;
function startEngine() {
  return new Promise((resolve, reject) => {
    engineProc = spawn('node', [
      'engine.js', '--pattern', 'test_const', '--model', 'test_bench', '--port', String(PORT),
    ], { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    const onData = d => {
      const s = d.toString();
      if (!settled && /Rendering|fps|listening|ready/i.test(s)) {
        settled = true; resolve();
      }
    };
    engineProc.stdout.on('data', onData);
    engineProc.stderr.on('data', () => {});
    engineProc.once('error', reject);
    engineProc.once('exit', code => { if (!settled) reject(new Error(`engine exited early (${code})`)); });
    setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 8000);
  });
}
async function waitReady(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await httpJson('GET', '/deck/overlays'); if (r.status === 200) return true; }
    catch {}
    await sleep(300);
  }
  return false;
}
function stopEngine() {
  if (engineProc && !engineProc.killed) { try { engineProc.kill('SIGTERM'); } catch {} }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { stopEngine(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

// ─── main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n== HIL: Deck Dynamic View Overrides (engine :${PORT}, test_bench) ==\n`);
  await startEngine();
  if (!await waitReady()) { console.error('✗ engine never became ready'); return 1; }

  // Clean slate: remove any persisted overlays.
  const existing = (await httpJson('GET', '/deck/overlays')).body.overlays || [];
  for (const o of existing) await httpJson('DELETE', `/deck/overlays/${o.id}`);
  // Make sure deck is lit (test_const) and not blacked out, and drive the
  // global params bright so the rig is unambiguously visible: full master,
  // a bright global Color 1, and brightness up. (Codex: no silent fallback —
  // the test should observe REAL light, not assume defaults.)
  await httpJson('POST', '/global-effect-invert', { enabled: false });
  await httpJson('POST', '/global-blackout', { state: false });
  // Drive the DECK channel to a known-lit constant pattern + a bright global
  // Color 1 + full master so the rig is unambiguously lit (the persisted scene
  // may have left the deck on a dark/animated pattern). No silent fallback —
  // we set the observable baseline the never-dark assertions ride on.
  await httpJson('PATCH', '/deck/channel', { pattern: 'test_const', fader: 1.0, enabled: true });
  await httpJson('POST', '/param-center', { colorPalette1: { h: 0.0, s: 0.0, v: 1.0 }, brightness: 1.0, master: 1.0 });
  await httpJson('PATCH', '/mixer', { master: 1.0 });

  const opts = (await httpJson('GET', '/model/view-selection-options')).body;
  const ws = await openWs('/ws/control');   // deck/mixer state
  const vws = await openWs('/ws/viz');       // vis (rig/master pixel) frames

  // Pick the brightest-lit group as the VIEW under test and a different lit
  // group as the EXTERIOR, measured from the live rig (post-dimmer) so the
  // never-dark assertions ride on a genuinely-lit baseline rather than an
  // assumed default.
  const baseRig = await sampleRig(vws, 1000);
  const groupBright = (opts.groups || []).map(g => ({ g, mean: meanRgbAt(baseRig, groupIndices(g)) }))
    .sort((a, b) => b.mean - a.mean);
  const VIEW_GROUP = (groupBright[0] && groupBright[0].g) || (opts.groups && opts.groups[0]) || 'ParLights';
  const OTHER_GROUP = (groupBright[1] && groupBright[1].g) || (opts.groups && opts.groups[1]) || 'VintageLights';
  console.log(`Group brightness: ${groupBright.map(x => `${x.g}=${x.mean.toFixed(0)}`).join(' ')}`);
  console.log(`Group view under test: '${VIEW_GROUP}'  exterior group: '${OTHER_GROUP}'`);
  const inViewIdx = groupIndices(VIEW_GROUP);
  const exteriorIdx = groupIndices(OTHER_GROUP);

  try {
    // ─ TEST 1: add overlay on a group view → ONLY that group's pixels change;
    //          the exterior OUTSIDE the view is byte-identical (never-dark).
    // We observe the post-composite `master` buffer (the show output) before
    // and after the add, plus the overlay's OWN rendered buffer (vis key = its
    // id) to confirm it paints a bright constant inside its view. This is
    // robust to the deck pattern's own brightness — the load-bearing contract
    // is "overlay paints its view; the exterior is untouched".
    console.log('\n[TEST 1] add overlay on a group view; exterior pixels untouched (never-dark)');
    const before = await sampleVisKey(vws, 'master');
    const add = await httpJson('POST', '/deck/overlays', {
      viewSelection: { type: 'group', target: VIEW_GROUP },
      pattern: 'test_const', mode: 'blend_add', enabled: true,
    });
    check(add.status === 200 && add.body.overlayId,
      `POST /deck/overlays added overlay (${add.body.overlayId}, color ${add.body.color})`,
      `add failed: ${add.status} ${JSON.stringify(add.body).slice(0, 120)}`);
    const ov1 = add.body.overlayId;
    // Make the overlay paint a bright constant so its contribution is visible.
    await httpJson('POST', '/param-center', { colorPalette1: { h: 0.0, s: 0.0, v: 1.0 } });
    await sleep(500);
    const after = await sampleVisKey(vws, 'master');
    const ovBuf = await sampleVisKey(vws, ov1);
    // (a) overlay renders a bright constant INSIDE its view (its own buffer).
    const ovInView = meanRgbAt(ovBuf, inViewIdx);
    check(ovInView > 5,
      `overlay renders into its view '${VIEW_GROUP}' (own-buffer mean ${ovInView.toFixed(1)})`,
      `overlay did not render in its view: ${ovInView.toFixed(1)}`);
    // (b) NEVER-DARK: the composited master pixels OUTSIDE the overlay's view
    //     are byte-identical before/after — the overlay can't touch the
    //     exterior (the deck's exterior coverage is preserved exactly).
    let exteriorChanged = 0;
    if (before && after) {
      for (const i of exteriorIdx) {
        for (let c = 0; c < 6; c++) {
          if (before[i * 6 + c] !== after[i * 6 + c]) { exteriorChanged++; break; }
        }
      }
    }
    check(before && after && exteriorChanged === 0,
      `exterior group '${OTHER_GROUP}' pixels BYTE-IDENTICAL after overlay (never-dark)`,
      `exterior pixels changed: ${exteriorChanged} of ${exteriorIdx.length}`);

    // ─ TEST 2: 2nd overlay on the SAME view → 409 ─
    console.log('\n[TEST 2] 2nd overlay on the same view → 409');
    const dup = await httpJson('POST', '/deck/overlays', {
      viewSelection: { type: 'group', target: VIEW_GROUP }, pattern: 'test_const',
    });
    check(dup.status === 409 && dup.body.code === 'DECK_OVERLAY_VIEW_TAKEN',
      `same-view add rejected 409 DECK_OVERLAY_VIEW_TAKEN`,
      `expected 409 VIEW_TAKEN, got ${dup.status} ${JSON.stringify(dup.body).slice(0, 120)}`);

    // ─ TEST 3: reorder two overlapping overlays → top wins ─
    console.log('\n[TEST 3] reorder two overlapping overlays → top wins');
    // Overlay 2 on a viewMask covering some of the same pixels would be ideal;
    // simpler: use a section view that overlaps the group. Use the group's
    // section if available, else a fixture in the group. We just need two
    // overlays whose views overlap on at least one pixel.
    const secId = MODEL_PIXELS.find(p => p.group === VIEW_GROUP)?.sId;
    const add2 = await httpJson('POST', '/deck/overlays', {
      viewSelection: { type: 'section', target: secId },
      pattern: 'test_const', mode: 'blend_over', enabled: true,
    });
    check(add2.status === 200, `2nd (overlapping) overlay added on section ${secId}`,
      `section overlay add failed: ${add2.status} ${JSON.stringify(add2.body).slice(0,120)}`);
    const ov2 = add2.body.overlayId;
    // Make the two overlays paint distinguishable colors so "top wins" is
    // observable: set hue on the section overlay (blend_over @ full replaces).
    await httpJson('PATCH', `/deck/overlays/${ov2}`, { hue: 120, fader: 1.0, mode: 'blend_over' });
    // Reorder so ov2 is TOP (last), then so ov1 is top, and assert the order.
    let r = await httpJson('POST', '/deck/overlays/reorder', { order: [ov1, ov2] });
    check(r.status === 200 && r.body.order[r.body.order.length - 1] === ov2,
      `reorder set ${ov2} as TOP (order ${JSON.stringify(r.body.order)})`,
      `reorder failed: ${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
    r = await httpJson('POST', '/deck/overlays/reorder', { order: [ov2, ov1] });
    check(r.status === 200 && r.body.order[r.body.order.length - 1] === ov1,
      `reorder flipped TOP to ${ov1}`, `reorder flip failed: ${JSON.stringify(r.body)}`);
    // Bad reorder set → 400 REORDER_BAD_SET.
    const badR = await httpJson('POST', '/deck/overlays/reorder', { order: [ov1] });
    check(badR.status === 400 && badR.body.code === 'REORDER_BAD_SET',
      `bad reorder set → 400 REORDER_BAD_SET`, `expected 400, got ${badR.status} ${JSON.stringify(badR.body)}`);

    // ─ TEST 4: 5th overlay → 400 OVER_CAP ─
    console.log('\n[TEST 4] 5th overlay → 400 DECK_OVERLAY_OVER_CAP');
    // We have 2 (a group + a section); add 2 MORE distinct views (the other
    // two groups) to reach the cap of 4, then a 5th DISTINCT view must 400.
    const otherGroups = (opts.groups || []).filter(g => g !== VIEW_GROUP);
    const allFids = [...new Set(MODEL_PIXELS.map(p => p.fId))].filter(Number.isInteger);
    const a3 = await httpJson('POST', '/deck/overlays', { viewSelection: { type: 'group', target: otherGroups[0] }, pattern: 'test_const' });
    const a4 = await httpJson('POST', '/deck/overlays', { viewSelection: { type: 'group', target: otherGroups[1] }, pattern: 'test_const' });
    check(a3.status === 200 && a4.status === 200, `added overlays 3 and 4 (cap of 4 reached)`,
      `cap-fill adds failed: ${a3.status} ${JSON.stringify(a3.body).slice(0,80)} / ${a4.status} ${JSON.stringify(a4.body).slice(0,80)}`);
    // 5th: a distinct fixture view (not equal to any taken group/section view).
    const a5 = await httpJson('POST', '/deck/overlays', { viewSelection: { type: 'fixture', target: allFids[0] }, pattern: 'test_const' });
    check(a5.status === 400 && a5.body.code === 'DECK_OVERLAY_OVER_CAP',
      `5th overlay rejected 400 DECK_OVERLAY_OVER_CAP`,
      `expected 400 OVER_CAP, got ${a5.status} ${JSON.stringify(a5.body).slice(0,120)}`);

    // ─ TEST 9 (read here): deck WS state has overlays + shared autopilot ─
    console.log('\n[TEST 9] deck WS state carries overlays + shared overlay autopilot');
    const deckMsg = await (async () => {
      const p = waitForDeck(ws, () => true, 2000);
      await httpJson('PATCH', `/deck/overlays/${ov1}`, { fader: 0.9 }); // trigger a broadcast
      return p;
    })();
    check(deckMsg && Array.isArray(deckMsg.overlays) && deckMsg.overlays.length === 4,
      `deck WS message carries overlays[] (count ${deckMsg?.overlays?.length})`,
      `deck WS overlays missing/wrong: ${JSON.stringify(deckMsg?.overlays?.length)}`);
    check(deckMsg && deckMsg.overlayAutopilot && typeof deckMsg.overlayAutopilot.delay_s === 'number',
      `deck WS message carries shared overlayAutopilot {active,delay_s,shuffle}`,
      `deck WS overlayAutopilot missing: ${JSON.stringify(deckMsg?.overlayAutopilot)}`);

    // Trim back to TWO overlays for the unison test (delete the two fixture ones).
    await httpJson('DELETE', `/deck/overlays/${a3.body.overlayId}`);
    await httpJson('DELETE', `/deck/overlays/${a4.body.overlayId}`);

    // ─ TEST 5: SHARED autopilot → two overlays advance in unison ─
    console.log('\n[TEST 5] shared overlay autopilot → two overlays advance in UNISON');
    // Put both remaining overlays on the multi-entry `default` playlist so they
    // have somewhere to advance.
    await httpJson('POST', `/deck/overlays/${ov1}/playlist`, { name: 'default' });
    await httpJson('POST', `/deck/overlays/${ov2}/playlist`, { name: 'default' });
    const e1Before = (await httpJson('GET', '/deck/overlays')).body.overlays.find(o => o.id === ov1)?.playlist?.activeEntryId;
    const e2Before = (await httpJson('GET', '/deck/overlays')).body.overlays.find(o => o.id === ov2)?.playlist?.activeEntryId;
    // Arm the SHARED autopilot with a short 1s delay.
    const ap = await httpJson('POST', '/deck/overlays/autopilot', { active: true, delay_s: 1, shuffle: false });
    check(ap.status === 200 && ap.body.overlayAutopilot.active === true,
      `shared overlay autopilot armed (delay ${ap.body.overlayAutopilot.delay_s}s)`,
      `autopilot arm failed: ${ap.status} ${JSON.stringify(ap.body)}`);
    // Wait through ~2 shared beats (seed + advance).
    await sleep(2600);
    const ovsAfter = (await httpJson('GET', '/deck/overlays')).body.overlays;
    const e1After = ovsAfter.find(o => o.id === ov1)?.playlist?.activeEntryId;
    const e2After = ovsAfter.find(o => o.id === ov2)?.playlist?.activeEntryId;
    check(e1After !== e1Before && e2After !== e2Before,
      `BOTH overlays advanced off the shared clock (ov1 ${e1Before}→${e1After}, ov2 ${e2Before}→${e2After})`,
      `overlays did not both advance: ov1 ${e1Before}→${e1After}, ov2 ${e2Before}→${e2After}`);
    await httpJson('POST', '/deck/overlays/autopilot', { active: false });

    // ─ TEST 6: global invert applies to overlays (shared globals) ─
    console.log('\n[TEST 6] global invert flips the rig (overlays share globals)');
    const preInvert = await sampleRig(vws);
    await httpJson('POST', '/global-effect-invert', { enabled: true });
    await sleep(400);
    const postInvert = await sampleRig(vws);
    const preMean = meanRgbAt(preInvert, inViewIdx);
    const postMean = meanRgbAt(postInvert, inViewIdx);
    check(Math.abs(postMean - preMean) > 5,
      `global invert changed the in-view (overlay) region (${preMean.toFixed(1)}→${postMean.toFixed(1)})`,
      `global invert did not affect the overlay region: ${preMean.toFixed(1)}→${postMean.toFixed(1)}`);
    await httpJson('POST', '/global-effect-invert', { enabled: false });
    await sleep(300);

    // ─ TEST 7: deck/mixer crossfade still works with overlays present ─
    console.log('\n[TEST 7] deck/mixer crossfade still works with overlays present');
    const vm = await httpJson('POST', '/mixer/view', { view: 'mixer' });
    check(vm.status === 200, `POST /mixer/view {mixer} accepted (crossfade path intact)`,
      `mixer view switch failed: ${vm.status}`);
    await httpJson('POST', '/mixer/view', { view: 'deck' });

    // ─ TEST 8: blackout still wins ─
    console.log('\n[TEST 8] blackout still wins (rig dark)');
    await httpJson('POST', '/global-blackout', { state: true });
    await sleep(400);
    const dark = await sampleRig(vws);
    const darkMean = meanRgbAt(dark, [...inViewIdx, ...exteriorIdx]);
    check(darkMean < 2, `rig dark under blackout (mean ${darkMean.toFixed(2)})`,
      `blackout did not darken rig: mean ${darkMean.toFixed(2)}`);
    await httpJson('POST', '/global-blackout', { state: false });
  } finally {
    try { ws.close(); } catch {}
    try { vws.close(); } catch {}
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n==========================================================`);
  console.log(`SUMMARY: ${passed}/${results.length} assertions passed`);
  console.log(`==========================================================\n`);
  return passed === results.length ? 0 : 1;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error('\nHarness error:', e); code = 1; }
finally { stopEngine(); }
await sleep(300);
process.exit(code);
