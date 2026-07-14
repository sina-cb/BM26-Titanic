// End-to-end: spawn the engine, prove the AUTO-SAVE toggle gates every
// automatic persistence trigger. Run:  node --test tests/autosave_gating.test.js
//
// Strategy mirrors playlist_api.test.js: pick a free port, spawn the engine
// with MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR redirected into throwaway temp
// dirs (the spawned engine must NEVER touch the tracked states/ tree), poll
// /status, exercise the HTTP API, then inspect the on-disk yamls directly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, '..');
const SCENE = 'summer_camp_dome';

const tmpStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-autosave-states-'));
const playlistsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-autosave-playlists-'));
const stateDir = path.join(tmpStateRoot, SCENE);

const DECK_FILE = () => path.join(stateDir, 'deck_state.yaml');
const MIXER_FILE = () => path.join(stateDir, 'mixer_state.yaml');
const GLOBALS_FILE = () => path.join(stateDir, 'globals_state.yaml');
const SETTINGS_FILE = () => path.join(stateDir, 'settings_state.yaml');

let proc = null;
let port = 6910 + Math.floor(Math.random() * 50);
const BASE = () => `http://127.0.0.1:${port}`;

function spawnEngine() {
  const child = spawn('node', ['engine.js', '--pattern', '13_sparkle', '--model', SCENE, '--port', String(port)], {
    cwd: engineDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BM26_DISABLE_TIMELINE: '1',
      MARSIN_STATE_DIR: tmpStateRoot,
      MARSIN_PLAYLISTS_DIR: playlistsDir,
    },
  });
  child.stdout.on('data', d => process.stderr.write('[engine] ' + d));
  child.stderr.on('data', d => process.stderr.write('[engine!] ' + d));
  return child;
}

async function waitForReady(url, timeoutMs = 25000) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url + '/status');
      if (res.ok) {
        const j = await res.json();
        if (j.service === 'marsin-engine') return j;
      }
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Engine never became ready: ' + (lastErr?.message || 'timeout'));
}

async function api(method, path_, body) {
  const res = await fetch(BASE() + path_, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function readBytes(p) {
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

async function pickDeckSlider() {
  const deck = await api('GET', '/deck/channel');
  const exps = deck.data.channel.exports || [];
  const slider = exps.find(e => typeof e.name === 'string' && e.name.startsWith('slider')) || exps[0];
  assert.ok(slider, 'deck pattern must expose at least one control');
  return slider;
}

// Open /ws/control, run `action()` once the socket is live, and resolve the
// first `deckParamsSaved` message seen within `timeoutMs` — or null on timeout
// (used for the negative "must NOT broadcast while auto-save is OFF" assertion).
function awaitDeckParamsSaved(action, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
    let done = false;
    const finish = (val) => { if (done) return; done = true; try { ws.close(); } catch { /* closing */ } resolve(val); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => { Promise.resolve(action()).catch((e) => { clearTimeout(timer); reject(e); }); });
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'deckParamsSaved') { clearTimeout(timer); finish(m); }
    });
    ws.on('error', (e) => { if (!done) { clearTimeout(timer); reject(e); } });
  });
}

before(async () => {
  proc = spawnEngine();
  await waitForReady(BASE());
});

after(async () => {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    if (!proc.killed) proc.kill('SIGKILL');
  }
});

test('auto-save ON (default): a deck control write mutates deck_state.yaml', async () => {
  const status = await api('GET', '/settings');
  assert.equal(status.status, 200);
  assert.equal(status.data.autoSave, true, 'autoSave defaults ON');

  const slider = await pickDeckSlider();
  const before = readBytes(DECK_FILE());
  const r = await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.611, v1: 0, v2: 0 });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 300));
  const after = readBytes(DECK_FILE());
  assert.ok(after, 'deck_state.yaml should exist after a control write');
  assert.ok(!before || !before.equals(after), 'deck_state.yaml must change when auto-save is ON');
});

test('deckParamsSaved broadcasts on a deck control write while auto-save is ON (drives the green "✓ SAVED" flash)', async () => {
  await api('POST', '/settings', { autoSave: true }); // explicit precondition
  const slider = await pickDeckSlider();
  const msg = await awaitDeckParamsSaved(
    () => api('POST', '/deck/channel/control', { id: slider.id, v0: 0.345, v1: 0, v2: 0 }),
  );
  assert.ok(msg, 'deckParamsSaved must broadcast when the deck write is persisted (auto-save ON)');
  assert.ok(typeof msg.channelId === 'string' && msg.channelId, 'deckParamsSaved carries the deck channelId');
});

test('toggle OFF: further control / mixer / blackout / playlist writes leave the three yamls byte-identical', async () => {
  // Ensure all three files exist while ON (so the OFF snapshot is a real baseline).
  const slider = await pickDeckSlider();
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.222, v1: 0, v2: 0 });
  await api('POST', '/mixer/channels', { pattern: '13_sparkle', name: 'GateOverlay', mode: 'blend_screen', fader: 0.5 });
  await api('POST', '/global-blackout', { state: true });
  await new Promise(res => setTimeout(res, 300));

  // Turn auto-save OFF.
  const off = await api('POST', '/settings', { autoSave: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.autoSave, false);
  await new Promise(res => setTimeout(res, 400));

  // Snapshot the three files at the moment auto-save went OFF.
  const deckSnap = readBytes(DECK_FILE());
  const mixerSnap = readBytes(MIXER_FILE());
  const globalsSnap = readBytes(GLOBALS_FILE());
  assert.ok(deckSnap && mixerSnap && globalsSnap, 'all three yamls should exist after the ON writes');

  // Now hammer every automatic-persistence trigger with auto-save OFF.
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.888, v1: 0, v2: 0 });
  await api('POST', '/mixer/channels', { pattern: '13_sparkle', name: 'GateOverlay2', mode: 'blend_screen', fader: 0.7 });
  await api('POST', '/global-blackout', { state: false });
  await api('POST', '/playlists', { name: 'gate_show', entries: [{ id: 'g_a', pattern: '13_sparkle', label: null, defaults: {} }] });
  await api('POST', '/deck/playlist', { name: 'gate_show' });
  await new Promise(res => setTimeout(res, 500));

  // The three STATE yamls must be byte-identical — zero automatic writes.
  assert.ok(readBytes(DECK_FILE()).equals(deckSnap), 'deck_state.yaml must not change while auto-save is OFF');
  assert.ok(readBytes(MIXER_FILE()).equals(mixerSnap), 'mixer_state.yaml must not change while auto-save is OFF');
  assert.ok(readBytes(GLOBALS_FILE()).equals(globalsSnap), 'globals_state.yaml must not change while auto-save is OFF');
});

test('deckParamsSaved is NOT broadcast while auto-save is OFF (no false "saved" claim)', async () => {
  const s = await api('GET', '/settings');
  assert.equal(s.data.autoSave, false, 'precondition: auto-save is OFF at this point');
  const slider = await pickDeckSlider();
  const msg = await awaitDeckParamsSaved(
    () => api('POST', '/deck/channel/control', { id: slider.id, v0: 0.456, v1: 0, v2: 0 }),
    1500,
  );
  assert.equal(msg, null, 'deckParamsSaved must NOT fire while auto-save is OFF (nothing was persisted)');
});

test('the auto-save toggle itself IS persisted even while auto-save is OFF', async () => {
  assert.ok(fs.existsSync(SETTINGS_FILE()), 'settings_state.yaml must exist');
  const onDisk = yaml.load(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  assert.equal(onDisk.autoSave, false, 'settings_state.yaml records autoSave:false');
});

test('POST /settings/save-now forces a write even while auto-save is OFF', async () => {
  const deckBefore = readBytes(DECK_FILE());
  const r = await api('POST', '/settings/save-now', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.saved, true);
  // save-now must not flip the persisted setting back on.
  assert.equal(r.data.autoSave, false);
  await new Promise(res => setTimeout(res, 300));
  const deckAfter = readBytes(DECK_FILE());
  assert.ok(!deckBefore.equals(deckAfter),
    'save-now should flush the in-memory deck tuning (0.888) that OFF had withheld');
  // And auto-save must still be OFF afterwards.
  const s = await api('GET', '/settings');
  assert.equal(s.data.autoSave, false);
});

test('POST /settings rejects a non-boolean autoSave with 400 (no coercion)', async () => {
  const r = await api('POST', '/settings', { autoSave: 'yes' });
  assert.equal(r.status, 400);
  assert.match(String(r.data.error || ''), /boolean/i);
  // The rejected write must not have mutated the setting.
  const s = await api('GET', '/settings');
  assert.equal(s.data.autoSave, false);
});
