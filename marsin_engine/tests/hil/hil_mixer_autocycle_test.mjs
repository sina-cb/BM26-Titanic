/**
 * hil_mixer_autocycle_test.mjs — HIL test for AUTO-CYCLE (round-2 #2).
 *
 * Proves a MIXER OVERLAY channel auto-advances its playlist on a timer when
 * its per-channel `playlist.autopilot` is armed via PATCH /mixer/channels/:id
 * — generalizing the deck Autopilot daemon to overlay channels. The advance
 * is driven by the engine render loop's wall-clock tick (no per-channel
 * timer), dispatched off the hot path.
 *
 *   - ARM + CYCLE: set an overlay autopilot {active:true, delay_s:1} → the
 *     channel's activeEntryId advances through >= 2 DISTINCT entries over ~3s.
 *   - TOGGLE OFF: set autopilot active:false → the activeEntryId stops
 *     changing (no further advance across >= 2 ticks).
 *   - BAD DELAY: PATCH delay_s <= 0 / non-finite → 400 AUTOCYCLE_BAD_DELAY.
 *   - MANUAL TAP RESETS BASELINE: a manual POST /mixer/channels/:id/playlist/
 *     entry mid-cycle re-anchors the timer (the next auto-advance lands a full
 *     delay_s after the manual tap, not immediately).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_mixer_autocycle_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine unreachable, test playlist not creatable)
 *
 * ── State it touches ──────────────────────────────────────────────────
 *   Creates a throwaway overlay channel + a throwaway playlist
 *   `hil_autocycle_test` (3 entries); both are deleted in restoreState()
 *   (also on SIGINT/SIGTERM and on throw). No pre-existing channel/playlist
 *   is repointed.
 */

import http from 'http';

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;

const TICK_S = 1;            // delay_s for the auto-cycle
const THREE_TICKS_MS = 3600; // generous window over 3 ticks
const TWO_TICKS_MS = 2400;

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

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

const cleanupState = {
  started: false,
  done: false,
  channelId: null,
  testPlaylist: 'hil_autocycle_test',
  createdPlaylist: false,
};

const E0 = 'e_hil_ac_0';
const E1 = 'e_hil_ac_1';
const E2 = 'e_hil_ac_2';
function buildEntries() {
  return [
    { id: E0, pattern: 'test_const', label: 'Alpha', defaults: {} },
    { id: E1, pattern: 'test_const', label: 'Bravo', defaults: {} },
    { id: E2, pattern: 'test_const', label: 'Charlie', defaults: {} },
  ];
}

async function getChannel(id) {
  const m = (await httpJson('GET', '/mixer')).body;
  const list = (m && m.channels) || [];
  return list.find(c => c.id === id) || null;
}
async function getActiveEntryId(id) {
  const c = await getChannel(id);
  return c && c.playlist ? c.playlist.activeEntryId : null;
}

async function restoreState() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    if (cleanupState.channelId) {
      // Disarm autopilot before removing (defensive) then delete the overlay.
      try {
        await httpJson('PATCH', `/mixer/channels/${cleanupState.channelId}`,
          { autopilot: { active: false } });
      } catch {}
      try {
        await httpJson('DELETE', `/mixer/channels/${cleanupState.channelId}`);
        console.log(`  deleted overlay channel: ${cleanupState.channelId}`);
      } catch (e) { console.warn(`  could not delete channel: ${e.message}`); }
    }
    if (cleanupState.createdPlaylist) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(cleanupState.testPlaylist)}`);
        console.log(`  deleted test playlist: ${cleanupState.testPlaylist}`);
      } catch (e) { console.warn(`  could not delete playlist: ${e.message}`); }
    }
  } catch (e) {
    console.warn(`  restore failed: ${e.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.error(`\nReceived ${sig}; cleaning up...`);
    try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
  });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_mixer_autocycle_test.mjs — overlay auto-cycle (round-2 #2)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  // Reachability.
  try { await httpJson('GET', '/mixer'); }
  catch {
    console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
    console.error('  Start with: node engine.js --pattern test_const --model test_bench --port ' + ENGINE_PORT);
    process.exit(2);
  }

  cleanupState.started = true;

  // Create the throwaway 3-entry playlist.
  const create = await httpJson('POST', '/playlists', { name: cleanupState.testPlaylist, entries: buildEntries() });
  if (create.status !== 200) {
    console.error(`  FATAL: could not create test playlist: ${create.status} ${JSON.stringify(create.body).slice(0,200)}`);
    process.exit(2);
  }
  cleanupState.createdPlaylist = true;

  // Add a throwaway overlay channel bound to the test playlist.
  const add = await httpJson('POST', '/mixer/channels', {
    playlist: cleanupState.testPlaylist, name: 'HIL AutoCycle', mode: 'blend_screen', fader: 1.0,
  });
  if (add.status !== 200 || !add.body.channelId) {
    console.error(`  FATAL: could not add overlay: ${add.status} ${JSON.stringify(add.body).slice(0,200)}`);
    process.exit(2);
  }
  cleanupState.channelId = add.body.channelId;
  const CH = cleanupState.channelId;
  console.log(`  overlay channel: ${CH}, playlist: ${cleanupState.testPlaylist}`);

  // Park on E0 as a known baseline.
  await httpJson('POST', `/mixer/channels/${CH}/playlist/entry`, { entryId: E0 });
  await sleep(300);

  // ── TEST 1: ARM + CYCLE through >= 2 distinct entries ──────────────
  console.log('\n[TEST 1] ARM autopilot delay_s=1 → advances >= 2 distinct entries');
  {
    const armed = await httpJson('PATCH', `/mixer/channels/${CH}`,
      { autopilot: { active: true, delay_s: TICK_S, shuffle: false } });
    check(armed.status === 200, `PATCH autopilot active delay_s=1 → 200`,
      `arm failed`, `status=${armed.status} body=${JSON.stringify(armed.body).slice(0,160)}`);

    // Sample the active entry every ~400ms across ~3s and collect distinct ids.
    const seen = new Set();
    const start = Date.now();
    while (Date.now() - start < THREE_TICKS_MS) {
      const id = await getActiveEntryId(CH);
      if (id) seen.add(id);
      await sleep(400);
    }
    check(seen.size >= 2,
      `auto-cycle advanced through >= 2 distinct entries (saw ${seen.size}: ${[...seen].join(',')})`,
      `auto-cycle did not advance enough`, `distinct=${seen.size}`);
  }

  // ── TEST 2: TOGGLE OFF stops the cycle ────────────────────────────
  console.log('\n[TEST 2] TOGGLE off → no further advance');
  {
    await httpJson('PATCH', `/mixer/channels/${CH}`, { autopilot: { active: false } });
    await sleep(300);
    const before = await getActiveEntryId(CH);
    await sleep(TWO_TICKS_MS);
    const after = await getActiveEntryId(CH);
    check(before === after,
      `active entry frozen after toggle off (${before} == ${after})`,
      `auto-cycle kept advancing after toggle off`, `before=${before} after=${after}`);
  }

  // ── TEST 3: BAD DELAY → 400 AUTOCYCLE_BAD_DELAY ──────────────
  console.log('\n[TEST 3] bad delay_s → 400 AUTOCYCLE_BAD_DELAY');
  {
    for (const bad of [0, -5, 'oops']) {
      const r = await httpJson('PATCH', `/mixer/channels/${CH}`,
        { autopilot: { active: true, delay_s: bad } });
      const isBad = r.status === 400 && r.body && r.body.code === 'AUTOCYCLE_BAD_DELAY';
      check(isBad, `delay_s=${JSON.stringify(bad)} → 400 AUTOCYCLE_BAD_DELAY`,
        `expected 400 AUTOCYCLE_BAD_DELAY`, `status=${r.status} body=${JSON.stringify(r.body).slice(0,160)}`);
    }
  }

  // ── TEST 4: MANUAL TAP mid-cycle RESETS the baseline ──────────────
  console.log('\n[TEST 4] manual entry tap mid-cycle re-anchors the timer');
  {
    // Park on E0, arm with a delay LONGER than our observation window so a
    // manual tap that resets the baseline is observable: after the tap, the
    // active entry must NOT auto-advance again for ~ < delay_s.
    await httpJson('POST', `/mixer/channels/${CH}/playlist/entry`, { entryId: E0 });
    await sleep(200);
    await httpJson('PATCH', `/mixer/channels/${CH}`,
      { autopilot: { active: true, delay_s: 3, shuffle: false } });
    // Let ~2s pass (under the 3s delay) so the timer is "almost due".
    await sleep(2000);
    const beforeTap = await getActiveEntryId(CH);
    // Manual tap to E2 — this re-seeds the wall-clock anchor.
    await httpJson('POST', `/mixer/channels/${CH}/playlist/entry`, { entryId: E2 });
    await sleep(200);
    const justAfterTap = await getActiveEntryId(CH);
    check(justAfterTap === E2, `manual tap moved active → E2`,
      `manual tap did not take effect`, `active=${justAfterTap}`);
    // Wait ~1.5s (well under the 3s delay measured from the tap). If the
    // baseline did NOT reset, the pre-tap 2s + 1.5s = 3.5s > 3s would have
    // fired an auto-advance off E2. A correct reset keeps us on E2.
    await sleep(1500);
    const afterWait = await getActiveEntryId(CH);
    check(afterWait === E2,
      `still on E2 ~1.5s after tap (baseline reset by the manual tap)`,
      `auto-advanced too soon — baseline was NOT reset by the manual tap`,
      `active=${afterWait}`);
    // Now confirm it DOES eventually advance off E2 once a full delay_s from
    // the tap elapses (timer is live, just re-anchored).
    await sleep(2200); // total ~3.7s since tap > 3s delay
    const eventual = await getActiveEntryId(CH);
    check(eventual !== E2,
      `auto-advanced off E2 once a full delay_s from the tap elapsed (timer still live)`,
      `timer did not resume after the reset`, `active=${eventual}`);
    await httpJson('PATCH', `/mixer/channels/${CH}`, { autopilot: { active: false } });
  }

  await restoreState();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { await restoreState(); } catch {}
  process.exit(2);
});
