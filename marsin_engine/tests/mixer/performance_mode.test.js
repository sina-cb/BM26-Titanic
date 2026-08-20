// End-to-end: spawn the engine, prove PERFORMANCE MODE behaves — enter
// snapshots the pre-show look+globals, the structural-change gate 409s the
// right routes (and leaves runtime/selection/safety routes open), auto-save is
// frozen while live, and the three exits (keep / restore / crash-restart) put
// disk + live state exactly where they belong.  Run:
//   node --test tests/performance_mode.test.js
//
// Harness mirrors autosave_gating.test.js / playlist_api.test.js: a spawned
// engine with MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR redirected into throwaway
// temp dirs (the spawned engine must NEVER touch the tracked states/ tree), poll
// /status, exercise the HTTP API, then inspect the on-disk yamls directly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(engineDir, '..');
const SCENE = 'summer_camp_dome';

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'marsin-perf',
  // Never overlap the operator stack (:6966-:6972). This suite restarts its
  // engine and the engine correctly claims its configured port, so a low range
  // here could kill a supervised live bridge before the test even begins.
  portBase: 31600,
  portSpan: 30,
});
const { api, stateDir, port } = h;
const BASE = h.base;

const DECK_FILE = () => path.join(stateDir, 'deck_state.yaml');
const MIXER_FILE = () => path.join(stateDir, 'mixer_state.yaml');
const GLOBALS_FILE = () => path.join(stateDir, 'globals_state.yaml');
const SNAPSHOT_FILE = () => path.join(stateDir, 'snapshots', 'performance-preshow.yaml');

// Tracked trees the spawned engines must never touch (byte-snapshot at module
// load, compared by the last test) — mirrors playlist_api.test.js.
const TRACKED_DIRS = [
  path.join(engineDir, 'states', SCENE),
  path.join(repoRoot, 'simulation', 'scenes', SCENE, 'playlists'),
];
function snapshotTrackedTrees() {
  const snap = {};
  for (const dir of TRACKED_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      const p = path.join(dir, String(f));
      if (fs.statSync(p).isFile()) snap[p] = fs.readFileSync(p, 'utf8');
    }
  }
  return snap;
}
const trackedBefore = snapshotTrackedTrees();

let proc = null;

function readYaml(p) {
  return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) : null;
}
function readBytes(p) {
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

async function firstMixerChannelId() {
  const m = await api('GET', '/mixer');
  const chans = (m.data && m.data.channels) || [];
  return chans.length ? chans[0].id : null;
}
// Ensure at least one mixer overlay exists (summer_camp_dome boots with none).
// MUST be called OUTSIDE performance mode — channel creation is gated.
async function ensureMixerChannel() {
  const existing = await firstMixerChannelId();
  if (existing) return existing;
  const r = await api('POST', '/mixer/channels', { pattern: '13_sparkle' });
  assert.equal(r.status, 200, 'created a mixer overlay for the test');
  return firstMixerChannelId();
}
async function pickDeckSlider() {
  const deck = await api('GET', '/deck/channel');
  const exps = (deck.data.channel && deck.data.channel.exports) || [];
  const slider = exps.find(e => typeof e.name === 'string' && e.name.startsWith('slider')) || exps[0];
  return slider;
}
async function firstSharedParamKey() {
  const pc = await api('GET', '/param-center');
  const params = (pc.data && pc.data.params) || {};
  return Object.keys(params)[0] || null;
}
function paramValue(canonical, key) {
  const params = (canonical && canonical.params) || {};
  const entry = params[key];
  return (entry && typeof entry === 'object' && entry.value !== undefined) ? entry.value : entry;
}

// Open /ws/control; resolve every message matching `predicate` seen within
// timeoutMs (or null on timeout). `action` runs once the socket is live.
function awaitWsMessage(predicate, action, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
    let done = false;
    const finish = (val) => { if (done) return; done = true; try { ws.close(); } catch { /* closing */ } resolve(val); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => { if (action) Promise.resolve(action()).catch((e) => { clearTimeout(timer); reject(e); }); });
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (predicate(m)) { clearTimeout(timer); finish(m); }
    });
    ws.on('error', (e) => { if (!done) { clearTimeout(timer); reject(e); } });
  });
}

async function enter() {
  return api('POST', '/performance-mode', { active: true });
}
async function exitKeep() {
  return api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
}
async function exitRestore() {
  return api('POST', '/performance-mode', { active: false, exitAction: 'restore' });
}
async function ensureInactive() {
  const st = await api('GET', '/performance-mode');
  if (st.data.active) await exitKeep();
}

before(async () => {
  proc = h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

// ── 1. boots inactive + /status carries performanceMode ────────────────────
test('boots inactive; /performance-mode and /status agree', async () => {
  const pm = await api('GET', '/performance-mode');
  assert.equal(pm.status, 200);
  assert.equal(pm.data.active, false);
  assert.equal(pm.data.enteredAt, null);

  const status = await api('GET', '/status');
  assert.ok(status.data.performanceMode, '/status must carry performanceMode');
  assert.equal(status.data.performanceMode.active, false);
});

// ── 2. enter → snapshot file (globals+deck+channels) + WS broadcast + replay ─
test('enter captures pre-show snapshot with globals/deck/channels, broadcasts + replays', async () => {
  await ensureInactive();
  assert.ok(!fs.existsSync(SNAPSHOT_FILE()), 'no pre-show snapshot before entry');

  const broadcast = await awaitWsMessage(
    (m) => m.type === 'performanceMode' && m.active === true,
    () => enter());
  assert.ok(broadcast, 'entering must broadcast performanceMode active:true');
  assert.ok(broadcast.enteredAt, 'broadcast carries enteredAt');

  // Snapshot file exists with the expected shape.
  const snap = readYaml(SNAPSHOT_FILE());
  assert.ok(snap, 'performance-preshow.yaml must exist after entry');
  assert.ok(Array.isArray(snap.channels), 'snapshot has channels array');
  assert.ok('deck' in snap, 'snapshot has a deck field');
  assert.ok(snap.globals && typeof snap.globals === 'object', 'snapshot has globals bucket');
  assert.ok(snap.globals.params, 'snapshot globals carry canonical params');

  // A fresh WS connection replays the active state on connect.
  const replay = await awaitWsMessage(
    (m) => m.type === 'performanceMode', null);
  assert.ok(replay, 'fresh connection replays performanceMode');
  assert.equal(replay.active, true);

  // /status agrees.
  const status = await api('GET', '/status');
  assert.equal(status.data.performanceMode.active, true);

  await exitKeep();
});

// ── 3. gating matrix ON: gated routes 409, allowed routes not-409 ──────────
test('while active: gated routes 409 PERFORMANCE_MODE; allowed routes pass', async () => {
  await ensureInactive();
  const chId = await ensureMixerChannel();
  const slider = await pickDeckSlider();
  await enter();

  // The gate is the FIRST line of each handler (before body validation), so a
  // route MATCH is enough — bodies here need not be otherwise valid.
  const gated = [
    ['POST', '/mixer/channels', { name: 'x' }],
    ['POST', '/mixer/channels/reorder', { order: [] }],
    ['POST', '/mixer/channels/ch_x/duplicate', {}],
    ['DELETE', '/mixer/channels/ch_x', null],
    ['POST', '/deck/overlays', { pattern: 'p' }],
    ['POST', '/deck/overlays/reorder', { order: [] }],
    ['DELETE', '/deck/overlays/ov_x', null],
    ['POST', '/playlists', { name: 'p' }],
    ['DELETE', '/playlists/whatever', null],
    ['PUT', '/api/playlists/p/items/i/midi-mappings/m', {}],
    // NOTE: POST /deck/playlist and POST /mixer/channels/:id/playlist left this
    // table on 2026-08-16 (report `_283`) — the operator opened playlist
    // CHANGING during a show. They are asserted OPEN below. The split-pane
    // BINDING route and both capture routes stay gated: binding a second pane
    // is structural, and capture writes to disk.
    ['POST', '/deck/playlist/secondary', { name: 'p' }],
    ['POST', '/deck/playlist/capture', {}],
    ['POST', '/mixer/channels/ch_x/playlist/capture', {}],
    ['POST', '/mixer/snapshots', { name: 'foo' }],
    ['POST', '/mixer/snapshots/foo/recall', {}],
    ['DELETE', '/mixer/snapshots/foo', null],
    ['POST', '/mixer/undo', {}],
    ['POST', '/mixer/channels/ch_x/param-presets', { name: 'q' }],
    ['POST', '/mixer/groups', { name: 'g' }],
    ['POST', '/settings', { autoSave: true }],
    ['POST', '/settings/save-now', {}],
    ['POST', '/scene', { scene: 'x' }],
    ['POST', '/save-pattern', { name: 'x', code: '' }],
    ['PATCH', '/global-effect-slots', { slots: [] }],
    ['POST', '/global-effects/deploy', {}],
  ];
  for (const [method, url, body] of gated) {
    const r = await api(method, url, body);
    assert.equal(r.status, 409, `${method} ${url} must 409 while active`);
    assert.equal(r.data.code, 'PERFORMANCE_MODE', `${method} ${url} code`);
  }

  // FIELD-level: viewSelection is gated, sibling fields on the SAME route pass.
  if (chId) {
    const vs = await api('PATCH', `/mixer/channels/${chId}`, { viewSelection: { type: 'all' } });
    assert.equal(vs.status, 409, 'viewSelection PATCH 409s while active');
    const sib = await api('PATCH', `/mixer/channels/${chId}`, { fader: 0.5 });
    assert.equal(sib.status, 200, 'sibling-field PATCH (fader) still 200s while active');
  }
  const deckVs = await api('PATCH', '/deck/channel', { viewSelection: { type: 'all' } });
  assert.equal(deckVs.status, 409, 'deck viewSelection PATCH 409s while active');
  const deckSib = await api('PATCH', '/deck/channel', { fader: 0.4 });
  assert.equal(deckSib.status, 200, 'deck sibling-field PATCH still 200s while active');

  // ALLOWED matrix (runtime / selection / safety) — must NOT 409.
  const allowed = [
    ['POST', '/deck/channel/control', slider ? { id: slider.id, v0: 0.3 } : { id: 'x', v0: 0 }],
    ['POST', '/mixer/tempo', { bpm: 120 }],
    ['POST', '/global-blackout', { enabled: false }],
    ['POST', '/mixer/panic', {}],
  ];
  for (const [method, url, body] of allowed) {
    const r = await api(method, url, body);
    assert.notEqual(r.status, 409, `${method} ${url} must NOT 409 (allowed)`);
  }
  if (chId) {
    const modeR = await api('PATCH', `/mixer/channels/${chId}`, { mode: 'add' });
    assert.notEqual(modeR.status, 409, 'blend-mode PATCH allowed while active');
    const grpPatch = await api('PATCH', '/mixer/groups/does_not_exist', { fader: 0.5 });
    assert.notEqual(grpPatch.status, 409, 'group PATCH allowed (404 not 409)');
  }

  await exitKeep();
});

// ── 3b. PLAYLIST CHANGING IS OPEN DURING A SHOW (report `_283`) ────────────
// Operator ruling 2026-08-16: "in the performance mode, allow playlist changing
// in the deck and mixer too." This pins BOTH halves — the switch is accepted
// and really takes effect, AND it stays non-persistent and non-structural, so
// the lock keeps meaning what it meant.
test('while active: deck + mixer playlist SWITCH is accepted, freezes disk, and RESTORE puts back the pre-show playlist', async () => {
  await ensureInactive();
  await api('POST', '/settings', { autoSave: true });
  const chId = await ensureMixerChannel();
  assert.ok(chId, 'need a mixer channel for the playlist swap probe');

  // Two playlists, built OUTSIDE the show — CRUD is still gated.
  await api('POST', '/playlists', { name: 'perf_swap_a', entries: [
    { id: 'psa_1', pattern: '01_cylon_sweep', label: 'A one', defaults: {} },
  ] });
  await api('POST', '/playlists', { name: 'perf_swap_b', entries: [
    { id: 'psb_1', pattern: '13_sparkle', label: 'B one', defaults: {} },
  ] });

  // Go live on A, on both surfaces.
  await api('POST', '/deck/playlist', { name: 'perf_swap_a' });
  await api('POST', `/mixer/channels/${chId}/playlist`, { name: 'perf_swap_a' });
  await new Promise((r) => setTimeout(r, 200));

  await enter();
  const deckBefore = readBytes(DECK_FILE());
  const mixerBefore = readBytes(MIXER_FILE());

  // THE OPERATOR ASK: change the playlist mid-show, on both surfaces.
  const deckSwap = await api('POST', '/deck/playlist', { name: 'perf_swap_b' });
  assert.equal(deckSwap.status, 200, 'deck playlist switch accepted while live');
  const mixSwap = await api('POST', `/mixer/channels/${chId}/playlist`, { name: 'perf_swap_b' });
  assert.equal(mixSwap.status, 200, 'mixer playlist switch accepted while live');
  await new Promise((r) => setTimeout(r, 250));

  // It really took effect on both.
  const deckNow = await api('GET', '/deck/playlist');
  assert.equal(deckNow.data && deckNow.data.name, 'perf_swap_b', 'deck is playing B');
  const mixNow = await api('GET', `/mixer/channels/${chId}/playlist`);
  assert.equal(mixNow.data && mixNow.data.name, 'perf_swap_b', 'mixer channel is playing B');

  // …and wrote NOTHING. The show lock still freezes disk (effectiveAutoSave),
  // which is exactly why opening this route does not weaken the lock.
  assert.deepEqual(readBytes(DECK_FILE()), deckBefore, 'deck_state frozen while live');
  assert.deepEqual(readBytes(MIXER_FILE()), mixerBefore, 'mixer_state frozen while live');

  // The targeted allowance is TARGETED: structural + persistent playlist work
  // on the very same surfaces is still refused.
  const create = await api('POST', '/playlists', { name: 'perf_swap_c' });
  assert.equal(create.status, 409, 'playlist CRUD still 409s while live');
  const cap = await api('POST', '/deck/playlist/capture', {});
  assert.equal(cap.status, 409, 'deck playlist capture still 409s while live');
  const sec = await api('POST', '/deck/playlist/secondary', { name: 'perf_swap_b' });
  assert.equal(sec.status, 409, 'split-pane binding still 409s while live');

  // RESTORE returns the rig to the playlist it went live with.
  await exitRestore();
  await new Promise((r) => setTimeout(r, 400));
  const deckAfter = await api('GET', '/deck/playlist');
  assert.equal(deckAfter.data && deckAfter.data.name, 'perf_swap_a',
    'RESTORE puts back the pre-show deck playlist');
});

// ── 4. same gated routes are non-409 after exit ────────────────────────────
test('after exit: gated routes no longer 409', async () => {
  await ensureInactive();
  const probes = [
    ['POST', '/mixer/snapshots', { name: 'after_exit_probe' }],
    ['POST', '/settings/save-now', {}],
    ['DELETE', '/playlists/nope', null],
  ];
  for (const [method, url, body] of probes) {
    const r = await api(method, url, body);
    assert.notEqual(r.status, 409, `${method} ${url} must not 409 after exit`);
  }
  // clean up the probe snapshot
  await api('DELETE', '/mixer/snapshots/after_exit_probe', null);
});

// ── 5. effective-save: autoSave ON + active → files frozen, no saved flash ──
test('while active with autoSave ON, param/fader writes freeze disk + no deckParamsSaved', async () => {
  await ensureInactive();
  // Ensure autoSave ON.
  await api('POST', '/settings', { autoSave: true });
  const slider = await pickDeckSlider();
  const chId = await ensureMixerChannel();
  await enter();

  const deckBefore = readBytes(DECK_FILE());
  const mixerBefore = readBytes(MIXER_FILE());
  const globalsBefore = readBytes(GLOBALS_FILE());

  // A deck control write over WS must NOT emit deckParamsSaved while frozen.
  const saved = await awaitWsMessage(
    (m) => m.type === 'deckParamsSaved',
    () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
      ws.on('open', () => {
        if (slider) ws.send(JSON.stringify({ type: 'setControl', id: slider.id, v0: 0.77 }));
        setTimeout(() => { try { ws.close(); } catch { /* */ } }, 800);
      });
    }, 2000);
  assert.equal(saved, null, 'no deckParamsSaved broadcast while performance mode active');

  // Fader writes too.
  if (chId) await api('PATCH', `/mixer/channels/${chId}`, { fader: 0.123 });
  if (slider) await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.44 });
  await new Promise(r => setTimeout(r, 400));

  assert.deepEqual(readBytes(DECK_FILE()), deckBefore, 'deck_state.yaml byte-frozen while active');
  assert.deepEqual(readBytes(MIXER_FILE()), mixerBefore, 'mixer_state.yaml byte-frozen while active');
  assert.deepEqual(readBytes(GLOBALS_FILE()), globalsBefore, 'globals_state.yaml byte-frozen while active');

  await exitKeep();
});

// ── 6. KEEP round-trip (autoSave ON, and again OFF) ────────────────────────
test('exit KEEP persists the live tweak; snapshot removed; stored autoSave preserved', async () => {
  for (const storedAutoSave of [true, false]) {
    await ensureInactive();
    await api('POST', '/settings', { autoSave: storedAutoSave });
    const chId = await ensureMixerChannel();
    assert.ok(chId, 'need a mixer channel for the KEEP test');

    await enter();
    const tweak = 0.271828;
    await api('PATCH', `/mixer/channels/${chId}`, { fader: tweak });
    await exitKeep();
    await new Promise(r => setTimeout(r, 300));

    const mixer = readYaml(MIXER_FILE());
    const ch = (mixer.channels || []).find(c => c.id === chId);
    assert.ok(ch, 'channel present in persisted mixer state');
    assert.ok(Math.abs(ch.fader - tweak) < 1e-6, `KEEP persisted the fader (autoSave=${storedAutoSave})`);
    assert.ok(!fs.existsSync(SNAPSHOT_FILE()), 'snapshot deleted after KEEP');

    const settings = await api('GET', '/settings');
    assert.equal(settings.data.autoSave, storedAutoSave, 'stored autoSave preference unchanged by KEEP');
  }
});

// ── 7. RESTORE round-trip: mixer + shared param + globals reverted ─────────
test('exit RESTORE reverts fader, shared param, and re-broadcasts mixer', async () => {
  await ensureInactive();
  await api('POST', '/settings', { autoSave: true });
  const chId = await ensureMixerChannel();
  const key = await firstSharedParamKey();
  assert.ok(chId && key, 'need a channel + a shared param for RESTORE test');

  // Baselines BEFORE entry.
  const mixerPre = await api('GET', '/mixer');
  const faderPre = (mixerPre.data.channels.find(c => c.id === chId) || {}).fader;
  const pcPre = await api('GET', '/param-center');
  const paramPre = paramValue(pcPre.data, key);

  await enter();

  // Mid-show tweaks.
  await api('PATCH', `/mixer/channels/${chId}`, { fader: (faderPre + 0.3) % 1 });
  const target = (typeof paramPre === 'number') ? ((paramPre + 0.25) % 1) : paramPre;
  await api('POST', '/param-center', { [key]: target });
  await new Promise(r => setTimeout(r, 200));

  // Exit restore — expect a mixer rebroadcast.
  const rebroadcast = await awaitWsMessage(
    (m) => m.type === 'mixer' || m.type === 'mixerState',
    () => exitRestore(), 3000);
  assert.ok(rebroadcast, 'RESTORE re-broadcasts mixer state');

  const mixerPost = await api('GET', '/mixer');
  const faderPost = (mixerPost.data.channels.find(c => c.id === chId) || {}).fader;
  assert.ok(Math.abs(faderPost - faderPre) < 1e-6, 'RESTORE reverted the fader');

  const pcPost = await api('GET', '/param-center');
  const paramPost = paramValue(pcPost.data, key);
  if (typeof paramPre === 'number') {
    assert.ok(Math.abs(paramPost - paramPre) < 1e-6, 'RESTORE reverted the shared param');
  }
  assert.ok(!fs.existsSync(SNAPSHOT_FILE()), 'snapshot deleted after RESTORE');
});

// ── 8. crash-restart: restore pre-show look but retain global lock ───────────
test('SIGKILL mid-performance → respawn restores look and resumes global lock', async () => {
  await ensureInactive();
  await api('POST', '/settings', { autoSave: true });
  const chId = await firstMixerChannelId();
  const slider = await pickDeckSlider();

  // Establish a known pre-show disk state.
  await api('POST', '/settings/save-now', {});
  await new Promise(r => setTimeout(r, 200));
  const deckPre = readBytes(DECK_FILE());
  const mixerPre = readBytes(MIXER_FILE());

  await enter();
  assert.ok(fs.existsSync(SNAPSHOT_FILE()), 'snapshot present while active');
  // Mid-show tweak (must NOT reach disk — frozen).
  if (chId) await api('PATCH', `/mixer/channels/${chId}`, { fader: 0.9013 });
  if (slider) await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.85 });
  await new Promise(r => setTimeout(r, 300));

  // Hard kill.
  proc.kill('SIGKILL');
  await new Promise(r => setTimeout(r, 600));

  // Respawn on the SAME dirs.
  proc = h.spawnEngine();
  await h.waitForReady();

  const pm = await api('GET', '/performance-mode');
  assert.equal(pm.data.active, true, 'crash-restart resumes the fail-safe global lock');
  assert.ok(fs.existsSync(SNAPSHOT_FILE()), 'pre-show snapshot retained for explicit operator exit');
  assert.deepEqual(readBytes(DECK_FILE()), deckPre, 'deck_state.yaml byte-equal pre-show after crash');
  assert.deepEqual(readBytes(MIXER_FILE()), mixerPre, 'mixer_state.yaml byte-equal pre-show after crash');
  const explicitExit = await exitKeep();
  assert.equal(explicitExit.status, 200, 'operator can deliberately end resumed Performance mode');
  assert.ok(!fs.existsSync(SNAPSHOT_FILE()), 'explicit exit removes the restart marker');
});

// ── 9. fail-loud 400s ──────────────────────────────────────────────────────
test('fail-loud 400s: double-enter, idle-exit, missing exitAction, reserved name', async () => {
  await ensureInactive();

  // reserved snapshot name OUTSIDE the mode → 400.
  const reserved = await api('POST', '/mixer/snapshots', { name: 'performance-preshow' });
  assert.equal(reserved.status, 400, 'reserved snapshot name rejected outside mode');
  assert.equal(reserved.data.code, 'SNAPSHOT_NAME_RESERVED');

  // idle exit → 400 NOT_ACTIVE.
  const idleExit = await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  assert.equal(idleExit.status, 400);
  assert.equal(idleExit.data.code, 'PERFORMANCE_MODE_NOT_ACTIVE');

  // non-boolean active → 400.
  const badBody = await api('POST', '/performance-mode', { active: 'yes' });
  assert.equal(badBody.status, 400);

  await enter();
  // double enter → 400 ALREADY_ACTIVE.
  const dbl = await enter();
  assert.equal(dbl.status, 400);
  assert.equal(dbl.data.code, 'PERFORMANCE_MODE_ALREADY_ACTIVE');

  // exit without valid exitAction → 400.
  const noAction = await api('POST', '/performance-mode', { active: false });
  assert.equal(noAction.status, 400);
  assert.equal(noAction.data.code, 'PERFORMANCE_MODE_INVALID_EXIT');

  await exitKeep();
});

// ── 10. dirty summary in GET + WS replay; invalid exitAction fails loud ─────
test('dirty deck tuning surfaces in GET + WS connect replay; invalid exitAction 400', async () => {
  await ensureInactive();
  await api('POST', '/settings', { autoSave: true });
  // A deck playlist with three entries; load it on the deck OUTSIDE perf, since
  // playlist CRUD is gated while a show is live. (The deck LOAD itself is open
  // during a show since report `_283` — this setup just predates the entry.)
  await api('POST', '/playlists', { name: 'dirty_probe', entries: [
    { id: 'dp_a', pattern: '01_cylon_sweep', label: 'Alpha', defaults: {} },
    { id: 'dp_b', pattern: '13_sparkle', label: 'Bravo', defaults: {} },
    { id: 'dp_c', pattern: '01_cylon_sweep', label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'dirty_probe' });
  await new Promise((r) => setTimeout(r, 200));
  const slider = await pickDeckSlider();
  assert.ok(slider, 'need a deck slider for the dirty probe');

  await enter();
  // GET at entry → clean (nothing tuned yet).
  const clean = await api('GET', '/performance-mode');
  assert.equal(clean.data.dirtyCount, 0, 'no dirty tuning at entry');
  assert.deepEqual(clean.data.dirtyEntries, [], 'empty dirty list at entry');

  // Tune dp_a, switch to dp_b (defers dp_a), tune dp_b and stay live on it.
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.321 });
  await new Promise((r) => setTimeout(r, 120));
  await api('POST', '/deck/playlist/entry', { entryId: 'dp_b' });
  await new Promise((r) => setTimeout(r, 180));
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.654 });
  await new Promise((r) => setTimeout(r, 120));

  // GET now reports two dirty entries (deferred dp_a + live-touched dp_b), each
  // with its resolved label + playlist so the exit sheet can name them.
  const dirty = await api('GET', '/performance-mode');
  assert.equal(dirty.data.dirtyCount, 2, 'two entries carry unsaved tuning');
  const byId = Object.fromEntries((dirty.data.dirtyEntries || []).map((e) => [e.entryId, e]));
  assert.ok(byId.dp_a && byId.dp_b, 'dirty list names both tuned entries');
  assert.equal(byId.dp_a.label, 'Alpha', 'dp_a label surfaced');
  assert.equal(byId.dp_a.playlist, 'dirty_probe', 'dp_a playlist surfaced');

  // A fresh WS connect replay carries the same dirty summary.
  const replay = await awaitWsMessage((m) => m.type === 'performanceMode', null);
  assert.ok(replay, 'fresh connection replays performanceMode');
  assert.equal(replay.dirtyCount, 2, 'connect replay carries dirtyCount');
  assert.ok(Array.isArray(replay.dirtyEntries) && replay.dirtyEntries.length === 2,
    'connect replay carries dirtyEntries');

  // Invalid exitAction → 400 (fail loud, never a silent keep).
  const bad = await api('POST', '/performance-mode', { active: false, exitAction: 'bogus' });
  assert.equal(bad.status, 400, 'invalid exitAction rejected');
  assert.equal(bad.data.code, 'PERFORMANCE_MODE_INVALID_EXIT');

  // Clean up: exit keeping the live look (session cache retained, backlog dropped).
  await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
});

// ── tracked-tree byte guard (must be the LAST test) ────────────────────────
test('spawned engine never wrote into the tracked states/ tree', () => {
  const after = snapshotTrackedTrees();
  assert.deepEqual(after, trackedBefore, 'tracked trees must be byte-identical');
});
