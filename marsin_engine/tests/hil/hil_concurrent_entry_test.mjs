/**
 * hil_concurrent_entry_test.mjs — concurrency / state-integrity HIL test.
 *
 * Goal: prove that the engine does not corrupt deck/mixer state and returns
 * COHERENT responses when an operator (or a flaky network) fires rapid,
 * concurrent control requests:
 *
 *   - bursts of POST /deck/playlist/entry  (entry switches; 200 or 409 EBUSY)
 *   - bursts of PATCH /mixer/channels/:id   (fader nudges; 200 or 404)
 *
 * The invariants asserted:
 *   1. Every response is a well-formed JSON object with a sane status code
 *      (200 / 409 EBUSY / 404 — never a 5xx, never a torn/half body).
 *   2. After the storm settles, GET /deck/channel + GET /mixer still return
 *      coherent state: the deck channel id is unchanged, its playlist is one
 *      of the entries we asked for, and the deck id never appears in the
 *      mixer overlay list (the channel-split invariant survives the storm).
 *   3. The on-disk states/test_bench/*.yaml files remain VALID YAML the whole
 *      time (no half-written/corrupt file from a save racing a crash) and are
 *      restored to their pre-test bytes in finally.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_concurrent_entry_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine unreachable, test playlist not creatable)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

import { assertDisposableEngine } from './hil_guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', '..', 'states', 'test_bench');
const STATE_FILES = ['deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml'];

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '31268', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;

function httpJson(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, ENGINE_BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let parsed; let parseOk = true;
        try { parsed = data ? JSON.parse(data) : null; } catch { parseOk = false; parsed = data; }
        resolve({ status: res.statusCode, body: parsed, parseOk });
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

// ── State snapshot/restore (HIL discipline: leave no tracked residue) ──
const snapshot = {};
function snapshotState() {
  for (const f of STATE_FILES) {
    const p = path.join(STATE_DIR, f);
    snapshot[f] = fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
}
function restoreState() {
  for (const f of STATE_FILES) {
    const p = path.join(STATE_DIR, f);
    if (snapshot[f] === null) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } else if (snapshot[f] !== undefined) {
      fs.writeFileSync(p, snapshot[f]);
    }
  }
  console.log('  restored states/test_bench/*.yaml to pre-test bytes');
}

function stateFilesAreValidYaml() {
  for (const f of STATE_FILES) {
    const p = path.join(STATE_DIR, f);
    if (!fs.existsSync(p)) continue;
    try {
      yaml.load(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      return { ok: false, file: f, err: e.message };
    }
  }
  return { ok: true };
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    console.error(`\nReceived ${sig}; restoring state...`);
    try { restoreState(); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); }
  });
}

const TEST_PLAYLIST = 'hil_concurrent_entry_test';

(async function main() {
  console.log('==========================================================');
  console.log('hil_concurrent_entry_test.mjs — concurrent control storm');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  snapshotState();
  let createdPlaylist = false;

  try {
    // 0. Engine reachable?
    let status;
    try {
      status = await httpJson('GET', '/status');
    } catch (e) {
      console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
      process.exit(2);
    }
    if (status.status !== 200) {
      console.error(`  FATAL: /status returned ${status.status}`);
      process.exit(2);
    }

    // Refuse to mutate a non-disposable engine BEFORE any /set-pattern or write.
    await assertDisposableEngine(ENGINE_BASE);

    // 1. Ensure a deck channel exists, then snapshot its identity.
    //    A fresh boot whose saved deck_state.yaml references a pattern that
    //    isn't present in this checkout leaves the deck channel null (the
    //    restore fails loudly and is skipped — codex no-fallback). That is
    //    a valid engine state, so the test installs a known-good deck
    //    channel via /set-pattern (the same path /pattern uses) before the
    //    storm. test_const is the lightest pattern the engine ships.
    let deckChannel = ((await httpJson('GET', '/deck/channel')).body || {}).channel;
    if (!deckChannel || !deckChannel.id) {
      const sp = await httpJson('POST', '/set-pattern', { pattern: 'test_const' });
      if (sp.status !== 200) {
        console.error(`  FATAL: could not install a deck channel via /set-pattern: status=${sp.status}`);
        process.exit(2);
      }
      deckChannel = ((await httpJson('GET', '/deck/channel')).body || {}).channel;
    }
    if (!deckChannel || !deckChannel.id) {
      console.error('  FATAL: GET /deck/channel returned no channel after /set-pattern');
      process.exit(2);
    }
    const deckId = deckChannel.id;
    console.log(`  deck channel id: ${deckId}`);

    // 2. Create a throwaway playlist with several light entries.
    const testEntries = Array.from({ length: 5 }, (_, i) => ({
      id: `e_hil_cc_${i}`, pattern: 'test_const', label: `E${i}`, defaults: {},
    }));
    const createRes = await httpJson('POST', '/playlists', { name: TEST_PLAYLIST, entries: testEntries });
    if (createRes.status !== 200) {
      console.error(`  FATAL: could not create test playlist: status=${createRes.status}`);
      process.exit(2);
    }
    createdPlaylist = true;
    await httpJson('POST', '/deck/playlist', { name: TEST_PLAYLIST });

    // 3. Discover a mixer channel id to nudge (may be none — that's fine).
    const mixerResp = (await httpJson('GET', '/mixer')).body;
    const mixerChannels = (mixerResp && Array.isArray(mixerResp.channels)) ? mixerResp.channels : [];
    const mixerId = mixerChannels.length > 0 ? mixerChannels[0].id : null;
    console.log(`  mixer overlay to nudge: ${mixerId || '(none present)'}`);

    // ── TEST 1: storm of concurrent /deck/playlist/entry requests ──────
    console.log('\n[TEST 1] concurrent deck entry switches return coherent responses');
    const ROUNDS = 6;
    const allResponses = [];
    for (let r = 0; r < ROUNDS; r++) {
      const burst = [];
      for (const e of testEntries) {
        burst.push(httpJson('POST', '/deck/playlist/entry', { entryId: e.id }));
        if (mixerId) {
          burst.push(httpJson('PATCH', `/mixer/channels/${encodeURIComponent(mixerId)}`,
            { fader: Math.random() }));
        }
      }
      const settled = await Promise.all(burst);
      allResponses.push(...settled);
      await sleep(20);
    }

    // Every response well-formed: parseable JSON object, expected status set.
    const ALLOWED = new Set([200, 404, 409]);
    let malformed = 0; let badStatus = 0;
    for (const resp of allResponses) {
      if (!resp.parseOk || typeof resp.body !== 'object' || resp.body === null) malformed++;
      if (!ALLOWED.has(resp.status)) badStatus++;
    }
    check(malformed === 0,
      `all ${allResponses.length} responses were well-formed JSON objects`,
      `${malformed} torn/non-JSON responses`,
    );
    check(badStatus === 0,
      `all responses had an expected status (200/404/409), none 5xx`,
      `${badStatus} responses had an unexpected status code`,
    );
    // Every 409 must carry the EBUSY contract marker.
    const conflicts = allResponses.filter(r => r.status === 409);
    const ebusyOk = conflicts.every(r => r.body && r.body.code === 'EBUSY');
    check(ebusyOk,
      `all ${conflicts.length} 409 responses carry code='EBUSY'`,
      `a 409 was missing the EBUSY marker`,
    );

    // Let any in-flight deck transition land before snapshotting state.
    await sleep(600);

    // ── TEST 2: post-storm deck state is coherent ──────────────────────
    console.log('\n[TEST 2] deck identity + playlist coherent after the storm');
    const after = (await httpJson('GET', '/deck/channel')).body;
    const afterCh = after && after.channel;
    check(afterCh && afterCh.id === deckId,
      `deck channel id unchanged (${deckId})`,
      `deck channel id changed under concurrent load`,
      `got=${afterCh && afterCh.id}`,
    );
    const validEntryIds = new Set(testEntries.map(e => e.id));
    const activeEntry = afterCh && afterCh.playlist && afterCh.playlist.activeEntryId;
    check(afterCh && afterCh.playlist && validEntryIds.has(activeEntry),
      `deck activeEntryId is one of the requested entries (${activeEntry})`,
      `deck settled on an unknown/torn entry`,
      `activeEntryId=${activeEntry}`,
    );

    // ── TEST 3: channel-split invariant survived ───────────────────────
    console.log('\n[TEST 3] deck id never leaked into the mixer overlay stack');
    const mixerAfter = (await httpJson('GET', '/mixer')).body;
    const overlayIds = (mixerAfter && Array.isArray(mixerAfter.channels))
      ? mixerAfter.channels.map(c => c.id) : [];
    check(!overlayIds.includes(deckId),
      `mixer overlay list does not contain deck id`,
      `deck id leaked into mixer overlays`,
      `overlayIds=${JSON.stringify(overlayIds)}`,
    );

    // ── TEST 4: on-disk state files are valid YAML (no corrupt save) ───
    console.log('\n[TEST 4] states/test_bench/*.yaml are valid YAML after the storm');
    const yamlOk = stateFilesAreValidYaml();
    check(yamlOk.ok,
      `all state files parse as valid YAML`,
      `a state file was left corrupt`,
      yamlOk.ok ? '' : `${yamlOk.file}: ${yamlOk.err}`,
    );
  } finally {
    console.log('\n── Cleanup ──');
    if (createdPlaylist) {
      try { await httpJson('DELETE', `/playlists/${encodeURIComponent(TEST_PLAYLIST)}`); } catch {}
    }
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total ? 0 : 1);
})().catch(e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { restoreState(); } catch {}
  process.exit(2);
});
