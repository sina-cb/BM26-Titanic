/**
 * hil_flash_bump_test.mjs — HIL test for round-2 #5: FLASH / BUMP
 * (momentary full-while-held accent). docs/39 §10.7.
 *
 * Drives the FULL engine path (REST + WS + the 40 Hz render loop + the vis
 * broadcast) on a live engine. The render proof reads the per-channel
 * effective-output `levels` map in the /ws/viz `vis` frame and asserts the
 * bumped channel's level jumps to FULL while a SIBLING stays at its parked
 * level — not just API echoes.
 *
 * Assertions:
 *   1. POST /mixer/channels/:id/bump {on:true} → 200, GET /mixer carries the id
 *      in bumpedChannelIds[].
 *   2. RENDER: the bumped (parked-low) channel's effective level jumps to ~full
 *      while a sibling parked-low channel STAYS low (per-channel isolation).
 *   3. Release {on:false} → bumpedChannelIds empties; the channel's level
 *      returns to its parked-low value (fader untouched).
 *   4. WS bump/unbump low-latency path mirrors the REST path.
 *   5. AUTO-RELEASE on WS close: bump over a socket, close it → the channel
 *      auto-releases (ws-close path), bumpedChannelIds empties.
 *   6. AUTO-RELEASE on lease expiry: REST-bump (no renew), wait out the lease
 *      → the sweep auto-releases, bumpedChannelIds empties.
 *   7. faderMax safety ceiling: a CAP-protected channel's bump level does NOT
 *      exceed its faderMax.
 *   8. Validation: bump unknown id → 404; bump the deck id → 400; missing/
 *      non-boolean `on` → 400.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern test_const --model test_bench --port 31268
 *   (test_const paints a constant non-black field so a lit channel is visible.)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_flash_bump_test.mjs [--port 31268]
 *
 * Exit code: 0 = all passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1] ? parseInt(process.argv[portIdx + 1], 10) : 31268;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_CTRL = `ws://127.0.0.1:${PORT}/ws/control`;
const WS_VIZ = `ws://127.0.0.1:${PORT}/ws/viz`;

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
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
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, label, detail) { if (cond) ok(label); else fail(label, detail); }

// NOTE on `levels`: the engine's per-channel vis level is
// `_bufferMeanLevel(channelBuffer) * effFader` (engine.js / pattern_mixer.js
// :2119) — i.e. the pattern's MEAN brightness scaled by the effective fader,
// NOT the raw effFader. test_const's mean is well below 1.0, so even a
// full-bumped channel reads ~0.12, not ~1.0. We therefore assert RELATIVELY:
// a bump must lift a channel's level toward its OWN full-fader level (≈ 5×
// over a 0.2 parked level), and the faderMax test checks the bumped level is
// ~half the unclamped bump. This is the right invariant — the override changes
// the effFader, and the mean-brightness factor is constant per pattern.

// Capture per-channel effective `levels` over /ws/viz for `ms`, return the MAX
// level seen for `channelId` (proxy for "how lit is this channel's output").
function captureChannelLevel(channelId, ms = 1200) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_VIZ);
    let maxLvl = -1;
    ws.on('message', m => {
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'vis' && d.levels && typeof d.levels[channelId] === 'number') {
          if (d.levels[channelId] > maxLvl) maxLvl = d.levels[channelId];
        }
      } catch (_) {}
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(maxLvl); }, ms);
  });
}

// Capture MAX levels for two channels in ONE viz window (so a lease lapse
// can't skew a bumped-vs-sibling comparison taken across two windows).
function captureTwoLevels(idA, idB, ms = 1000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_VIZ);
    const max = { [idA]: -1, [idB]: -1 };
    ws.on('message', m => {
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'vis' && d.levels) {
          if (typeof d.levels[idA] === 'number') max[idA] = Math.max(max[idA], d.levels[idA]);
          if (typeof d.levels[idB] === 'number') max[idB] = Math.max(max[idB], d.levels[idB]);
        }
      } catch (_) {}
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(max); }, ms);
  });
}

async function bumpedIds() {
  const mx = await httpJson('GET', '/mixer');
  return Array.isArray(mx.body.bumpedChannelIds) ? mx.body.bumpedChannelIds : null;
}

async function main() {
  console.log(`\n== HIL: FLASH / BUMP (engine ${BASE}) ==\n`);

  const overlays = [];
  let deckId = null;

  try {
    const deck = await httpJson('GET', '/deck/channel');
    deckId = deck.body?.channel?.id || null;

    // Two overlays parked LOW (fader 0.2) so a bump-to-full is unmistakable.
    const a = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'ACCENT' });
    const b = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'OTHER' });
    check(a.status === 200 && b.status === 200, 'added two overlays', `a=${a.status} b=${b.status}`);
    const accId = a.body.channelId, othId = b.body.channelId;
    overlays.push(accId, othId);
    await httpJson('PATCH', `/mixer/channels/${accId}`, { fader: 0.2 });
    await httpJson('PATCH', `/mixer/channels/${othId}`, { fader: 0.2 });

    // GET /mixer carries bumpedChannelIds[] (empty to start).
    const init = await bumpedIds();
    check(Array.isArray(init) && init.length === 0, 'GET /mixer carries bumpedChannelIds[] (empty)', `seen=${JSON.stringify(init)}`);

    // Baseline render: both channels parked low.
    const baseAcc = await captureChannelLevel(accId);
    const baseOth = await captureChannelLevel(othId);
    check(baseAcc > 0 && baseAcc < 0.6, 'baseline: ACCENT renders at its parked-low level', `level=${baseAcc}`);

    // 1. REST bump ACCENT.
    const bumpRes = await httpJson('POST', `/mixer/channels/${accId}/bump`, { on: true });
    check(bumpRes.status === 200 && bumpRes.body.bumpedChannelIds.includes(accId), 'POST bump {on:true} → 200, id in bumpedChannelIds', `status=${bumpRes.status} body=${JSON.stringify(bumpRes.body)}`);
    const got1 = await bumpedIds();
    check(got1.includes(accId) && !got1.includes(othId), 'GET /mixer shows ONLY ACCENT bumped', `seen=${JSON.stringify(got1)}`);

    // 2. RENDER PROOF: ACCENT jumps toward FULL (≈ 5× its 0.2-parked level —
    // bump forces effFader 1.0 over 0.2), OTHER stays at its parked level.
    // A REST bump renews the 2 s lease but never re-renews, so we measure the
    // bumped + sibling levels CONCURRENTLY in one short capture, well inside
    // the lease window. The sibling is captured in the SAME window so a lapse
    // can't skew the comparison.
    const concurrent = await captureTwoLevels(accId, othId, 1000);
    const bumpedAcc = concurrent[accId];
    const stillLowOth = concurrent[othId];
    check(bumpedAcc > baseAcc * 3, 'RENDER: bumped ACCENT level lifts to ~full (≈5× its parked-low)', `bumped=${bumpedAcc} parked=${baseAcc}`);
    check(stillLowOth < baseOth * 1.5 + 0.01, 'RENDER: sibling OTHER stays at its parked-low level (isolation)', `oth=${stillLowOth} parkedOth=${baseOth}`);

    // 3. Release → returns to parked-low.
    const rel = await httpJson('POST', `/mixer/channels/${accId}/bump`, { on: false });
    check(rel.status === 200 && rel.body.bumpedChannelIds.length === 0, 'POST bump {on:false} releases → bumpedChannelIds empty', `body=${JSON.stringify(rel.body)}`);
    const releasedAcc = await captureChannelLevel(accId);
    check(releasedAcc > 0 && releasedAcc < 0.6, 'RENDER: released ACCENT returns to parked-low (fader untouched)', `level=${releasedAcc}`);
    const chk = await httpJson('GET', '/mixer');
    const accCh = chk.body.channels.find(c => c.id === accId);
    check(accCh && Math.abs(accCh.fader - 0.2) < 0.01, 'parked fader (0.2) is sacred — bump never wrote it', `fader=${accCh?.fader}`);

    // 4. WS bump/unbump low-latency path.
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_CTRL);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'bump', channelId: accId })));
      setTimeout(() => { ws.send(JSON.stringify({ type: 'unbump', channelId: accId })); setTimeout(() => { ws.close(); resolve(); }, 200); }, 300);
    });
    const afterWs = await bumpedIds();
    check(afterWs.length === 0, 'WS bump then unbump leaves the set empty', `seen=${JSON.stringify(afterWs)}`);

    // 5. AUTO-RELEASE on WS close: bump over a socket, then close it WITHOUT
    //    unbumping. The ws-close handler must release the held bump.
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_CTRL);
      ws.on('open', () => { ws.send(JSON.stringify({ type: 'bump', channelId: accId })); setTimeout(() => { ws.terminate(); resolve(); }, 300); });
    });
    await sleep(400); // let the close handler + broadcast settle
    const afterClose = await bumpedIds();
    check(afterClose.length === 0, 'AUTO-RELEASE: closing the bumping socket releases the bump', `seen=${JSON.stringify(afterClose)}`);

    // 6. AUTO-RELEASE on lease expiry: REST-bump (no socket, no renew), wait
    //    out the 2 s lease — the sweep must auto-release it.
    await httpJson('POST', `/mixer/channels/${accId}/bump`, { on: true });
    const heldBeforeExpiry = await bumpedIds();
    check(heldBeforeExpiry.includes(accId), 'lease test: REST bump held before expiry', `seen=${JSON.stringify(heldBeforeExpiry)}`);
    await sleep(3000); // > BUMP_LEASE_MS (2000) + sweep interval (500)
    const afterExpiry = await bumpedIds();
    check(afterExpiry.length === 0, 'AUTO-RELEASE: an un-renewed REST bump lapses via the lease sweep', `seen=${JSON.stringify(afterExpiry)}`);

    // 7. faderMax safety ceiling: bump OTHER UNCAPPED (faderMax 1.0) to get the
    //    full-bump reference, then CAP it at 0.5 and bump again — the capped
    //    bump level must be ≈ half the uncapped (a CAP fixture is never over-
    //    driven even on a bump: bump = min(1.0, faderMax)).
    await httpJson('PATCH', `/mixer/channels/${othId}`, { faderMax: 1.0 });
    await httpJson('POST', `/mixer/channels/${othId}/bump`, { on: true });
    const fullBumpOth = await captureChannelLevel(othId, 900);
    await httpJson('POST', `/mixer/channels/${othId}/bump`, { on: false });
    await httpJson('PATCH', `/mixer/channels/${othId}`, { faderMax: 0.5 });
    await httpJson('POST', `/mixer/channels/${othId}/bump`, { on: true });
    const cappedLvl = await captureChannelLevel(othId, 900);
    const ratio = fullBumpOth > 0 ? cappedLvl / fullBumpOth : 0;
    check(ratio > 0.4 && ratio < 0.6, 'faderMax ceiling holds on a bump (capped ≈ 0.5× the uncapped bump, not over-driven)', `capped=${cappedLvl} full=${fullBumpOth} ratio=${ratio.toFixed(3)}`);
    await httpJson('POST', `/mixer/channels/${othId}/bump`, { on: false });

    // 8. Validation (fail-loud, no silent fallback).
    const v1 = await httpJson('POST', '/mixer/channels/ch_nope/bump', { on: true });
    check(v1.status === 404, 'bump unknown channel → 404', `status=${v1.status}`);
    if (deckId) {
      const v2 = await httpJson('POST', `/mixer/channels/${deckId}/bump`, { on: true });
      check(v2.status === 400, 'bump the DECK id → 400 (WRONG_ROLE)', `status=${v2.status}`);
    }
    const v3 = await httpJson('POST', `/mixer/channels/${accId}/bump`, {});
    check(v3.status === 400, 'bump with missing `on` → 400', `status=${v3.status}`);
    const v4 = await httpJson('POST', `/mixer/channels/${accId}/bump`, { on: 'yes' });
    check(v4.status === 400, 'bump with non-boolean `on` → 400', `status=${v4.status}`);

  } finally {
    // Cleanup: release all bumps, delete overlays.
    for (const id of overlays) {
      await httpJson('POST', `/mixer/channels/${id}/bump`, { on: false });
      await httpJson('DELETE', `/mixer/channels/${id}`);
    }
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  if (results.some(r => !r)) process.exit(1);
  process.exit(0);
}

main().catch(e => { console.error('Test crashed:', e); process.exit(1); });
