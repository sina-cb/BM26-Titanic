/**
 * hil_groups_solo_test.mjs — HIL test for WAVE 15: channel groups (gang-faders)
 * + server-authoritative solo / solo-safe.
 *
 * Drives the FULL engine path (REST + WS + the 40 Hz render loop + the vis
 * broadcast) on a live engine. The render proof reads the `master` vis buffer
 * (the composed output, pre-dimmer) over /ws/viz and asserts actual lit /
 * dark pixels — not just API echoes.
 *
 * Assertions:
 *   1. Group CRUD: create → 201 w/ mg_* id; appears in GET /mixer/groups +
 *      serializeMixerState.mixGroups.
 *   2. Single membership: add channel to a 2nd group → 400.
 *   3. No deck in a group: add the deck id → 400 (WRONG_ROLE).
 *   4. MISSION-CRITICAL (#10): a soloSafe channel stays LIT in the rendered
 *      `master` output when ANOTHER channel is soloed.
 *   5. group-mute beats member-solo: a group-muted, soloed channel renders DARK.
 *   6. /mixer broadcasts soloedChannelIds; it survives a fresh WS reconnect
 *      (server-authoritative).
 *   7. Transition clears solo.
 *   8. Validation: solo unknown id → 404; add member missing channelId → 400;
 *      PATCH unknown group → 404; group fader NaN → 400.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern test_const --model test_bench --port 31268
 *   (test_const paints a constant non-black field so a lit channel is visible.)
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_groups_solo_test.mjs [--port 31268]
 *
 * Exit code: 0 = all passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';

import { assertDisposableEngine } from './hil_guard.mjs';

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

// Sum of all bytes in the latest `master` vis buffer (proxy for "how lit is the
// composed output"). Captures frames over /ws/viz for `ms`, returns the max.
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

async function main() {
  console.log(`\n== HIL: groups + solo (engine ${BASE}) ==\n`);

  const created = []; // group ids to clean up
  const overlays = []; // overlay channel ids to clean up
  let deckId = null;

  try {
    const deck = await httpJson('GET', '/deck/channel');
    deckId = deck.body?.channel?.id || null;

    // Refuse to mutate a non-disposable engine BEFORE adding any channel.
    await assertDisposableEngine(BASE);

    // Add two overlays we can solo / group. test_const paints a constant
    // field so a lit channel shows up in the master vis.
    const a = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'EXT' });
    const b = await httpJson('POST', '/mixer/channels', { pattern: 'test_const', name: 'INT' });
    check(a.status === 200 && b.status === 200, 'added two overlays', `a=${a.status} b=${b.status}`);
    const extId = a.body.channelId, intId = b.body.channelId;
    overlays.push(extId, intId);

    // 1. Group CRUD.
    const g1 = await httpJson('POST', '/mixer/groups', { name: 'Starboard' });
    check(g1.status === 201 && /^mg_/.test(g1.body.group?.id), 'POST /mixer/groups → 201 with mg_* id', `status=${g1.status} body=${JSON.stringify(g1.body)}`);
    const gid1 = g1.body.group.id; created.push(gid1);
    const list = await httpJson('GET', '/mixer/groups');
    check(list.status === 200 && list.body.mixGroups.some(g => g.id === gid1), 'GET /mixer/groups lists the new group');
    const mx = await httpJson('GET', '/mixer');
    check(Array.isArray(mx.body.mixGroups) && mx.body.mixGroups.some(g => g.id === gid1), 'GET /mixer carries mixGroups[]');
    check(Array.isArray(mx.body.soloedChannelIds), 'GET /mixer carries soloedChannelIds[]');

    // 2. Single membership: add ext to g1, then to a 2nd group → 400.
    const m1 = await httpJson('POST', `/mixer/groups/${gid1}/members`, { channelId: extId });
    check(m1.status === 200, 'add ext to group 1 → 200', `status=${m1.status}`);
    const g2 = await httpJson('POST', '/mixer/groups', { name: 'Port' });
    const gid2 = g2.body.group.id; created.push(gid2);
    const m2 = await httpJson('POST', `/mixer/groups/${gid2}/members`, { channelId: extId });
    check(m2.status === 400, 'add ext to a SECOND group → 400 (single membership)', `status=${m2.status}`);

    // 3. No deck in a group.
    if (deckId) {
      const md = await httpJson('POST', `/mixer/groups/${gid1}/members`, { channelId: deckId });
      check(md.status === 400, 'add the DECK channel to a group → 400 (WRONG_ROLE)', `status=${md.status}`);
    } else {
      ok('no deck channel present — skipping deck-in-group check');
    }

    // 4. MISSION-CRITICAL #10: mark ext soloSafe, solo int, ext must stay LIT.
    await httpJson('PATCH', `/mixer/channels/${extId}`, { soloSafe: true });
    // Drop int to a non-overlapping fixture is not possible here (test_bench
    // paints all pixels), so we instead MUTE int (enabled=false) so the only
    // thing that could be lit is ext — proving the soloSafe survives the solo.
    await httpJson('PATCH', `/mixer/channels/${intId}`, { enabled: false });
    const solo = await httpJson('POST', '/mixer/solo', { channelId: intId });
    check(solo.status === 200, 'POST /mixer/solo (int) → 200', `status=${solo.status}`);
    await sleep(150);
    const litSafe = await captureMasterBrightness();
    check(litSafe > 0, 'MISSION-CRITICAL: soloSafe channel stays LIT while another is soloed', `master brightness=${litSafe}`);
    // Re-enable int + clear solo for the next checks.
    await httpJson('PATCH', `/mixer/channels/${intId}`, { enabled: true });
    await httpJson('DELETE', '/mixer/solo');

    // 5. group-mute beats member-solo → DARK. Mute g1 (ext's group), disable
    //    int so ONLY ext could be lit, then solo ext. Group-mute must win.
    await httpJson('PATCH', `/mixer/channels/${intId}`, { enabled: false });
    await httpJson('PATCH', `/mixer/groups/${gid1}`, { muted: true });
    await httpJson('POST', '/mixer/solo', { channelId: extId });
    await sleep(150);
    const darkMute = await captureMasterBrightness();
    check(darkMute === 0, 'group-mute beats member-solo: output is DARK', `master brightness=${darkMute}`);
    // Restore.
    await httpJson('PATCH', `/mixer/groups/${gid1}`, { muted: false });
    await httpJson('PATCH', `/mixer/channels/${intId}`, { enabled: true });
    await httpJson('DELETE', '/mixer/solo');

    // 6. Solo survives a fresh WS reconnect (server-authoritative).
    await httpJson('POST', '/mixer/solo', { channelId: extId });
    const reconnectSolo = await new Promise((resolve) => {
      const ws = new WebSocket(WS_CTRL);
      let seen = null;
      ws.on('message', m => {
        try { const d = JSON.parse(m.toString()); if (d.type === 'mixer' && Array.isArray(d.soloedChannelIds)) seen = d.soloedChannelIds; } catch (_) {}
      });
      ws.on('error', () => resolve(null));
      setTimeout(() => { ws.close(); resolve(seen); }, 1200);
    });
    check(Array.isArray(reconnectSolo) && reconnectSolo.includes(extId), 'solo survives a fresh WS reconnect (broadcast carries soloedChannelIds)', `seen=${JSON.stringify(reconnectSolo)}`);

    // 7. Transition clears solo.
    const tr = await httpJson('POST', '/mixer/snapshots', { name: 'hil_gs_tmp' }); // no-op warmup ok
    await httpJson('DELETE', '/mixer/snapshots/hil_gs_tmp');
    // Use the WS transition path (mirrors the iPad).
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_CTRL);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'triggerMixerTransition', targetChannelId: intId, durationMs: 200 })));
      setTimeout(() => { ws.close(); resolve(); }, 600);
    });
    const afterTr = await httpJson('GET', '/mixer');
    check(afterTr.body.soloedChannelIds.length === 0, 'transition clears the solo set', `soloed=${JSON.stringify(afterTr.body.soloedChannelIds)}`);

    // 8. Validation.
    const v1 = await httpJson('POST', '/mixer/solo', { channelId: 'ch_does_not_exist' });
    check(v1.status === 404, 'solo unknown channel → 404', `status=${v1.status}`);
    const v2 = await httpJson('POST', `/mixer/groups/${gid1}/members`, {});
    check(v2.status === 400, 'add member without channelId → 400', `status=${v2.status}`);
    const v3 = await httpJson('PATCH', '/mixer/groups/mg_nope', { fader: 0.5 });
    check(v3.status === 404, 'PATCH unknown group → 404', `status=${v3.status}`);
    const v4 = await httpJson('PATCH', `/mixer/groups/${gid1}`, { fader: 'abc' });
    check(v4.status === 400, 'PATCH group fader NaN → 400', `status=${v4.status}`);
    const v5 = await httpJson('DELETE', '/mixer/solo/ch_does_not_exist');
    check(v5.status === 404, 'un-solo unknown channel → 404', `status=${v5.status}`);

  } finally {
    // Cleanup: clear solo, delete groups + overlays.
    await httpJson('DELETE', '/mixer/solo');
    for (const gid of created) await httpJson('DELETE', `/mixer/groups/${gid}`);
    for (const id of overlays) await httpJson('DELETE', `/mixer/channels/${id}`);
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  if (results.some(r => !r)) process.exit(1);
  process.exit(0);
}

main().catch(e => { console.error('Test crashed:', e); process.exit(1); });
