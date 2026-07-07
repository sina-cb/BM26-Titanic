/**
 * hil_audio_reactive_profile_test.mjs — HIL test for the audio_reactive
 * autopilot profile (E2).
 *
 * Proves, against a live engine, by INJECTING synthetic Companion CPC via
 * `POST /param-center` (the audio signal keys are registered at boot when audio
 * is enabled — test_bench boots with the mic analyzer):
 *   1. Arming audio_reactive sets `bpmSpeedSync=1` (speed follows tempo).
 *   2. A `audioSwitchPattern` pulse (with silence=0, party=1) ADVANCES the deck.
 *   3. A bare `audioSwitchColor` transient does NOT recolour (must hold).
 *   4. A STABLE descriptor change held past the dwell DOES recolour the palette.
 *   5. ENERGY ARC — a sustained calm SAGS the bpmSpeedMax ceiling; a sustained
 *      rise RECOVERS it (the energy→speed-scale that layers on bpmSpeedSync).
 *   6. ENERGY PICKUP — a fast energy rise after a calm dip ADVANCES the deck.
 *   7. Under `audioSilence=1` a pattern pulse is SUPPRESSED (no advance).
 *   8. Switching back to `random` RESTORES bpmSpeedSync to its prior value.
 *
 * DETERMINISM: test_bench boots the live mic analyzer, which continuously writes
 * the audio CPC keys (~86 hops/s) — on an idle mic it correctly sets
 * audioSilence=1, which would clobber our injected gate values. So we take a
 * PER-PARAM source-lock leasing the keys we inject to source `'api'`, freezing
 * the analyzer out of those specific keys for the duration of the test.
 *
 * (maxDwell forcing an advance after 300 s is proven at the unit level in
 * tests/audio_reactive_profile.test.js — a HIL can't wait 5 minutes.)
 *
 * Owns the engine lifecycle (snapshot state → boot on 31068 → run → stop →
 * restore) so it leaves ZERO tracked-state side effects.
 *
 * ── Run ───────────────────────────────────────────────────────────────
 *     cd marsin_engine
 *     node tests/hil/hil_audio_reactive_profile_test.mjs
 *
 * ── Exit ──────────────────────────────────────────────────────────────
 *   0 pass · 1 assertion fail · 2 setup error
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ENGINE_DIR, 'states', 'test_bench');
const CONFIG_FILE = path.join(ENGINE_DIR, 'config.yaml');

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '31068', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const STATE_FILES = [
  'deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml', 'audio_state.yaml',
];
const TEST_PLAYLIST = 'hil_audio_reactive';

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
function fail(label, detail) { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, passLabel, failLabel, failDetail) { if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail); }

// Read one CPC value via the schema+values GET.
async function cpc(key) {
  const r = await httpJson('GET', '/param-center');
  const params = r.body && (r.body.params || r.body);
  const slot = params && params[key];
  if (slot === undefined) return undefined;
  return typeof slot === 'object' && slot !== null && 'value' in slot ? slot.value : slot;
}
async function setCpc(obj) { return httpJson('POST', '/param-center', obj); }
async function deckActiveEntry() {
  const r = await httpJson('GET', '/deck/channel');
  return r.body && r.body.channel && r.body.channel.playlist
    ? r.body.channel.playlist.activeEntryId : null;
}

// ── engine lifecycle ───────────────────────────────────────────────────────
const snapshots = new Map();
function snapshotState() {
  for (const f of STATE_FILES) {
    const full = path.join(STATE_DIR, f);
    if (fs.existsSync(full)) snapshots.set(full, fs.readFileSync(full));
  }
  if (fs.existsSync(CONFIG_FILE)) snapshots.set(CONFIG_FILE, fs.readFileSync(CONFIG_FILE));
}
function restoreState() {
  for (const [full, buf] of snapshots) {
    try { fs.writeFileSync(full, buf); } catch (e) { console.warn(`  restore ${full}: ${e.message}`); }
  }
}
let engineProc = null;
async function bootEngine() {
  engineProc = spawn('node', [
    'engine.js', '--pattern', 'test_const', '--model', 'test_bench', '--port', String(ENGINE_PORT),
  ], { cwd: ENGINE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  engineProc.stdout.on('data', () => {});
  engineProc.stderr.on('data', () => {});
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const r = await httpJson('GET', '/status'); if (r.status === 200) return true; } catch {}
    await sleep(500);
  }
  return false;
}
function stopEngine() {
  return new Promise((resolve) => {
    if (!engineProc) return resolve();
    const proc = engineProc; engineProc = null;
    let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch { finish(); }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} finish(); }, 4000);
  });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_audio_reactive_profile_test.mjs — audio_reactive (E2)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  snapshotState();
  if (!(await bootEngine())) {
    console.error('  FATAL: engine did not become ready');
    await stopEngine(); restoreState(); process.exit(2);
  }

  let createdPlaylist = false;
  try {
    // Multi-entry playlist so an advance visibly moves the active entry.
    const entries = [
      { id: 'e_ar_0', pattern: 'test_const', label: 'A', defaults: {} },
      { id: 'e_ar_1', pattern: 'test_const', label: 'B', defaults: {} },
      { id: 'e_ar_2', pattern: 'test_const', label: 'C', defaults: {} },
    ];
    const cr = await setPlaylist(entries);
    if (cr.status !== 200) { console.error('  FATAL: playlist create failed', cr.status); throw new Error('setup'); }
    createdPlaylist = true;
    await httpJson('POST', '/deck/playlist', { name: TEST_PLAYLIST });
    // Transitions OFF so advances are instant + deterministic (no EBUSY races).
    await httpJson('POST', '/deck/transition-config', { enabled: false });
    // Freeze the live analyzer out of the keys we inject (per-param source-lock
    // leased to 'api'), so an idle-mic audioSilence=1 can't clobber our gates.
    await httpJson('POST', '/param-center/source-lock', {
      mode: 'per-param',
      leases: {
        audioSilence: 'api', audioParty: 'api', audioSwitchPattern: 'api',
        audioSwitchColor: 'api', audioNoteHue: 'api', audioNote: 'api',
        audioEnergyRatio: 'api', audioSlowZone: 'api', audioStructure: 'api',
        audioDropPulse: 'api',
      },
    });

    // ── TEST 1: arm audio_reactive → bpmSpeedSync becomes 1 ───────────────
    console.log('\n[TEST 1] arm audio_reactive → bpmSpeedSync = 1');
    const priorSync = await cpc('bpmSpeedSync');
    const arm = await httpJson('POST', '/deck/playlist/autopilot',
      { active: true, profile: 'audio_reactive' });
    check(arm.status === 200, `arm → 200 (got ${arm.status})`, 'arm failed',
      `body=${JSON.stringify(arm.body).slice(0, 200)}`);
    await sleep(200);
    check((await cpc('bpmSpeedSync')) == 1, 'bpmSpeedSync == 1 after arm',
      'bpmSpeedSync not armed', `got=${await cpc('bpmSpeedSync')}`);

    // ── TEST 2: a switchPattern pulse advances the deck ───────────────────
    console.log('\n[TEST 2] audioSwitchPattern pulse advances the deck pattern');
    await setCpc({ audioSilence: 0, audioParty: 1, audioSwitchPattern: 0 });
    const before = await deckActiveEntry();
    // arm sets _lastAdvanceMs=now, so wait out the 6 s minInterval re-guard.
    await sleep(6100);
    await setCpc({ audioSwitchPattern: 1 });   // rising to >0 → triggers advance
    await sleep(500);
    const after = await deckActiveEntry();
    check(after !== null && after !== before,
      `active entry advanced (${before} → ${after})`,
      'switchPattern pulse did not advance the deck',
      `before=${before} after=${after}`);

    // ── TEST 3: a bare switchColor transient does NOT recolour ────────────
    console.log('\n[TEST 3] a bare switchColor transient does NOT recolour');
    // Establish a steady descriptor, capture the palette, then fire a raw pulse
    // WITHOUT a sustained descriptor change — the palette must not move.
    await setCpc({ audioEnergyRatio: 0.4, audioSlowZone: 0.1, audioStructure: 1, audioNote: 4, audioNoteHue: 0.5 });
    await sleep(1500);   // let the descriptor settle across several ticks
    const palBefore = JSON.stringify(await cpc('colorPalette1'));
    await setCpc({ audioSwitchColor: 0 }); await sleep(100);
    await setCpc({ audioSwitchColor: 1 });   // a raw transient — must NOT recolour
    await sleep(800);
    const palAfterTransient = JSON.stringify(await cpc('colorPalette1'));
    check(palAfterTransient === palBefore,
      'a raw switchColor transient left the palette unchanged',
      'a bare transient recoloured (should require a held descriptor)',
      `before=${palBefore} after=${palAfterTransient}`);

    // ── TEST 4: a STABLE descriptor change held past the dwell DOES recolour ─
    console.log('\n[TEST 4] a held descriptor change recolours the palette');
    // Shift the SLOW situation (energy band, note class) to a NEW settled state
    // and HOLD it well past both energySlowTau (~10 s, so the band stabilises)
    // AND colorHoldMs (6 s) so the descriptor settles then recolours.
    await setCpc({ audioNoteHue: 0.05, audioEnergyRatio: 0.98, audioSlowZone: 0.05, audioStructure: 2, audioNote: 9 });
    await sleep(16000);  // > energySlowTau + colorHoldMs so the band settles + holds
    const palAfterHold = JSON.stringify(await cpc('colorPalette1'));
    check(palAfterHold !== palBefore,
      `a held descriptor change recoloured (${palBefore} → ${palAfterHold})`,
      'a sustained descriptor change did not recolour',
      `before=${palBefore} after=${palAfterHold}`);

    // ── TEST 5: energy ARC — sustained calm sags the speed ceiling; rise lifts ─
    console.log('\n[TEST 5] energy arc sags then recovers the bpmSpeedMax ceiling');
    await setCpc({ audioEnergyRatio: 0.95 });
    await sleep(2500);   // hold high → ceiling rides near the armed max (160)
    const ceilHigh = Number(await cpc('bpmSpeedMax'));
    await setCpc({ audioEnergyRatio: 0.03 });
    await sleep(4000);   // sustained calm → ceiling sags toward the floor (80)
    const ceilLow = Number(await cpc('bpmSpeedMax'));
    check(Number.isFinite(ceilHigh) && Number.isFinite(ceilLow) && ceilLow < ceilHigh - 5,
      `ceiling sagged on a calm (high=${ceilHigh} → low=${ceilLow})`,
      'speed ceiling did not sag on a sustained calm',
      `high=${ceilHigh} low=${ceilLow}`);
    await setCpc({ audioEnergyRatio: 0.95 });
    await sleep(4000);   // stable recovery → ceiling climbs back up
    const ceilBack = Number(await cpc('bpmSpeedMax'));
    check(Number.isFinite(ceilBack) && ceilBack > ceilLow + 5,
      `ceiling recovered on a rise (low=${ceilLow} → back=${ceilBack})`,
      'speed ceiling did not recover on a sustained rise',
      `low=${ceilLow} back=${ceilBack}`);

    // ── TEST 6: energy PICKUP after a calm dip advances the pattern ───────
    console.log('\n[TEST 6] a fast energy pickup after a calm dip advances the deck');
    // Clear the minInterval guard, hold a calm to arm, then jump energy up.
    await setCpc({ audioSilence: 0, audioParty: 1, audioSwitchPattern: 0, audioDropPulse: 0 });
    await setCpc({ audioEnergyRatio: 0.08 });
    await sleep(6200);   // clear minInterval AND arm the pickup (calm dip)
    const beforeP = await deckActiveEntry();
    await setCpc({ audioEnergyRatio: 0.95, audioDropPulse: 1 });  // sudden pickup
    await sleep(900);
    const afterP = await deckActiveEntry();
    check(afterP !== null && afterP !== beforeP,
      `energy pickup advanced the deck (${beforeP} → ${afterP})`,
      'energy pickup did not advance the deck',
      `before=${beforeP} after=${afterP}`);

    // ── TEST 7: silence suppresses the advance ────────────────────────────
    console.log('\n[TEST 7] audioSilence=1 suppresses a pattern advance');
    await setCpc({ audioSilence: 1, audioSwitchPattern: 0 });
    await sleep(6200);   // clear minInterval so ONLY the silence gate matters
    const beforeS = await deckActiveEntry();
    await setCpc({ audioSwitchPattern: 1 });   // rising, but silence gate is shut
    await sleep(600);
    const afterS = await deckActiveEntry();
    check(afterS === beforeS,
      `silence suppressed the advance (stayed on ${beforeS})`,
      'advance fired despite silence',
      `before=${beforeS} after=${afterS}`);

    // ── TEST 8: switching to random restores bpmSpeedSync ─────────────────
    console.log('\n[TEST 8] switch to random → bpmSpeedSync restored');
    const r = await httpJson('POST', '/deck/playlist/autopilot',
      { profile: 'random', active: false });
    check(r.status === 200, `→ 200 (got ${r.status})`, 'switch to random failed');
    await sleep(200);
    check((await cpc('bpmSpeedSync')) == priorSync,
      `bpmSpeedSync restored to prior value (${priorSync})`,
      'bpmSpeedSync not restored on detach',
      `prior=${priorSync} now=${await cpc('bpmSpeedSync')}`);
  } catch (e) {
    if (e.message !== 'setup') fail('unexpected error', e && e.message);
  } finally {
    try { await httpJson('POST', '/param-center/source-lock', { mode: 'open' }); } catch {}
    try { await httpJson('POST', '/deck/playlist/autopilot', { profile: 'random', active: false }); } catch {}
    if (createdPlaylist) { try { await httpJson('DELETE', `/playlists/${encodeURIComponent(TEST_PLAYLIST)}`); } catch {} }
    await stopEngine();
    await sleep(300);
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total && total > 0 ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  try { await stopEngine(); await sleep(300); restoreState(); } catch {}
  process.exit(2);
});

async function setPlaylist(entries) {
  return httpJson('POST', '/playlists', { name: TEST_PLAYLIST, entries });
}
