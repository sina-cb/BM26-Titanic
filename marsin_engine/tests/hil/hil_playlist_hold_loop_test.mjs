/**
 * hil_playlist_hold_loop_test.mjs — HIL test for per-entry Hold/Loop (#12).
 *
 * Proves the DECK autopilot advance gate honors the per-entry `hold` and
 * `loop` flags added to the playlist schema, and that a manual entry tap
 * overrides a hold (the release mechanism):
 *
 *   - HOLD: with autopilot active (delay_s=1) on a held entry, the active
 *     entry does NOT change across >= 3 autopilot ticks. Clearing the flag
 *     (re-save without hold) releases it and the autopilot advances.
 *   - LOOP: a looping entry repeats every tick and overrides shuffle — the
 *     active entry stays the looping one even with shuffle enabled.
 *   - MANUAL TAP OVERRIDES HOLD: while parked on a held entry, a manual
 *     POST /deck/playlist/entry to a DIFFERENT entry succeeds and moves the
 *     active entry (the autopilot gate must NOT block manual taps).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_playlist_hold_loop_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine unreachable, test playlist not creatable)
 *
 * ── State it touches ──────────────────────────────────────────────────
 *   Re-points the deck playlist + autopilot; both are snapshotted on entry
 *   and restored in restoreState() (also on SIGINT/SIGTERM and on throw).
 *   Creates + deletes a throwaway playlist `hil_hold_loop_test`.
 */

import http from 'http';

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;

// One autopilot tick = delay_s seconds. We drive it fast (1s) and wait a
// few ticks to observe park / advance behavior. TICK_WINDOW_MS gives a
// generous margin over 3 ticks so a slow transition doesn't false-fail.
const TICK_S = 1;
const THREE_TICKS_MS = 3600;
const ADVANCE_WAIT_MS = 3600;

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

async function getActiveEntryId() {
  const r = await httpJson('GET', '/deck/playlist');
  return r.body && r.body.activeEntryId ? r.body.activeEntryId : null;
}

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
  snapshotDeckAssignment: null,
  snapshotAutopilot: null,
  testPlaylist: 'hil_hold_loop_test',
  createdPlaylist: false,
};

async function restoreState() {
  if (!cleanupState.started || cleanupState.done) return;
  cleanupState.done = true;
  console.log('\n── Cleanup ──');
  try {
    // Always stop the autopilot we may have started before re-pointing.
    await httpJson('POST', '/deck/playlist/autopilot', { active: false, delay_s: 30, shuffle: false });
    const prev = cleanupState.snapshotDeckAssignment;
    if (prev && prev.name) {
      await httpJson('POST', '/deck/playlist', { name: prev.name });
      if (prev.activeEntryId) {
        try { await httpJson('POST', '/deck/playlist/entry', { entryId: prev.activeEntryId }); } catch {}
      }
      console.log(`  restored deck playlist: ${prev.name} entry=${prev.activeEntryId || '(none)'}`);
    } else {
      await httpJson('POST', '/deck/playlist', { name: null });
      console.log('  restored deck playlist: <none>');
    }
    if (cleanupState.snapshotAutopilot) {
      await httpJson('POST', '/deck/playlist/autopilot', cleanupState.snapshotAutopilot);
    }
    if (cleanupState.createdPlaylist) {
      try {
        await httpJson('DELETE', `/playlists/${encodeURIComponent(cleanupState.testPlaylist)}`);
        console.log(`  deleted test playlist: ${cleanupState.testPlaylist}`);
      } catch (e) {
        console.warn(`  could not delete ${cleanupState.testPlaylist}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  restore failed: ${e.message}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.error(`\nReceived ${sig}; restoring deck state...`);
    try { await restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
  });
}

// Save the throwaway playlist with the given per-entry hold/loop flags.
const E0 = 'e_hil_hl_0';
const E1 = 'e_hil_hl_1';
const E2 = 'e_hil_hl_2';
function buildEntries({ holdOn0 = false, loopOn0 = false } = {}) {
  return [
    { id: E0, pattern: 'test_const', label: 'Alpha', defaults: {}, hold: holdOn0, loop: loopOn0 },
    { id: E1, pattern: 'test_const', label: 'Bravo', defaults: {} },
    { id: E2, pattern: 'test_const', label: 'Charlie', defaults: {} },
  ];
}
async function saveTest(entries) {
  return httpJson('POST', '/playlists', { name: cleanupState.testPlaylist, entries });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_playlist_hold_loop_test.mjs — per-entry hold/loop (#12)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  cleanupState.started = true;

  // Snapshot deck state.
  let deckResp;
  try { deckResp = (await httpJson('GET', '/deck/channel')).body; }
  catch { console.error('  FATAL: engine unreachable at ' + ENGINE_BASE); process.exit(2); }
  const deckChannel = deckResp && deckResp.channel;
  if (!deckChannel || !deckChannel.id) {
    console.error('  FATAL: GET /deck/channel returned no channel');
    process.exit(2);
  }
  cleanupState.snapshotDeckAssignment = deckChannel.playlist ? JSON.parse(JSON.stringify(deckChannel.playlist)) : null;
  cleanupState.snapshotAutopilot = deckChannel.playlist && deckChannel.playlist.autopilot
    ? JSON.parse(JSON.stringify(deckChannel.playlist.autopilot)) : null;

  // ── TEST 1: HOLD parks the autopilot ──────────────────────────────
  console.log('\n[TEST 1] HOLD parks autopilot >= 3 ticks, release advances');
  {
    const create = await saveTest(buildEntries({ holdOn0: true }));
    if (create.status !== 200) {
      console.error(`  FATAL: could not create test playlist: ${create.status} ${JSON.stringify(create.body).slice(0,200)}`);
      process.exit(2);
    }
    cleanupState.createdPlaylist = true;

    await httpJson('POST', '/deck/playlist', { name: cleanupState.testPlaylist });
    // Park on the held entry (E0).
    await httpJson('POST', '/deck/playlist/entry', { entryId: E0 });
    await sleep(300);
    const before = await getActiveEntryId();
    check(before === E0, `parked on held entry E0 before ticks`, `not on E0 (got ${before})`);

    // Enable autopilot fast. The held entry must NOT advance.
    await httpJson('POST', '/deck/playlist/autopilot', { active: true, delay_s: TICK_S, shuffle: false });
    await sleep(THREE_TICKS_MS); // >= 3 ticks
    const afterHold = await getActiveEntryId();
    check(
      afterHold === E0,
      `HOLD: active entry stayed E0 across >= 3 ticks`,
      `HOLD failed — autopilot advanced off the held entry`,
      `active=${afterHold}`,
    );

    // Release: re-save with hold cleared on E0. Autopilot should advance.
    await saveTest(buildEntries({ holdOn0: false }));
    await sleep(ADVANCE_WAIT_MS);
    const afterRelease = await getActiveEntryId();
    check(
      afterRelease !== E0,
      `RELEASE: autopilot advanced off E0 after clearing hold`,
      `release failed — still parked on E0`,
      `active=${afterRelease}`,
    );

    // Park again before next test to get a clean baseline.
    await httpJson('POST', '/deck/playlist/autopilot', { active: false, delay_s: 30, shuffle: false });
  }

  // ── TEST 2: LOOP repeats + overrides shuffle ──────────────────────
  console.log('\n[TEST 2] LOOP repeats the entry and overrides shuffle');
  {
    // E0 loops; shuffle ON. Loop must win — active stays E0.
    await saveTest([
      { id: E0, pattern: 'test_const', label: 'Alpha', defaults: {}, loop: true },
      { id: E1, pattern: 'test_const', label: 'Bravo', defaults: {} },
      { id: E2, pattern: 'test_const', label: 'Charlie', defaults: {} },
    ]);
    await httpJson('POST', '/deck/playlist/entry', { entryId: E0 });
    await sleep(300);
    const before = await getActiveEntryId();
    check(before === E0, `on looping entry E0 before ticks`, `not on E0 (got ${before})`);

    await httpJson('POST', '/deck/playlist/autopilot', { active: true, delay_s: TICK_S, shuffle: true });
    await sleep(THREE_TICKS_MS); // >= 3 ticks
    const afterLoop = await getActiveEntryId();
    check(
      afterLoop === E0,
      `LOOP: active stayed E0 across >= 3 ticks despite shuffle ON`,
      `LOOP failed — advanced off the looping entry`,
      `active=${afterLoop}`,
    );
    await httpJson('POST', '/deck/playlist/autopilot', { active: false, delay_s: 30, shuffle: false });
  }

  // ── TEST 3: manual tap overrides HOLD (release mechanism) ─────────
  console.log('\n[TEST 3] manual entry tap overrides a hold');
  {
    await saveTest(buildEntries({ holdOn0: true }));
    await httpJson('POST', '/deck/playlist/entry', { entryId: E0 });
    await sleep(300);
    const before = await getActiveEntryId();
    check(before === E0, `parked on held entry E0`, `not on E0 (got ${before})`);

    // Manual tap to E1 — the gate is autopilot-only, so this must succeed
    // even with autopilot active and parked. Enable autopilot first to
    // prove the manual tap isn't blocked by the parked state.
    await httpJson('POST', '/deck/playlist/autopilot', { active: true, delay_s: TICK_S, shuffle: false });
    await sleep(1200); // one tick parked
    const stillParked = await getActiveEntryId();
    check(stillParked === E0, `still parked on E0 (autopilot honored hold)`, `unexpectedly advanced`, `active=${stillParked}`);

    const tap = await httpJson('POST', '/deck/playlist/entry', { entryId: E1 });
    const okTap = tap.status === 200 || tap.status === 409;
    check(okTap, `manual tap → ${tap.status} (200 or 409 EBUSY)`, `manual tap rejected`, `body=${JSON.stringify(tap.body).slice(0,200)}`);
    // Stop the autopilot immediately so it can't advance E1→E2 before we
    // read (E1 is not held, so the autopilot would legitimately keep
    // cycling). The thing we are proving is that the manual tap RELEASED
    // the hold and moved the active entry OFF the held E0 — autopilot is
    // gated only on its OWN advance, not on operator taps.
    await sleep(300);
    await httpJson('POST', '/deck/playlist/autopilot', { active: false, delay_s: 30, shuffle: false });
    await sleep(200);
    const afterTap = await getActiveEntryId();
    check(
      afterTap !== E0,
      `MANUAL OVERRIDE: active moved off the held E0 (manual tap is the release)`,
      `manual tap did not override the hold`,
      `active=${afterTap}`,
    );
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
