// End-to-end: spawn the engine, prove the DECK auto-captures live tuning into
// the OUTGOING playlist entry on an entry switch (the "a night of deck tuning
// lost on pattern switch" fix), and that this capture is scoped to the deck +
// gated by the auto-save toggle. Run: node --test tests/deck_entry_autocapture.test.js
//
// Same isolation posture as playlist_api.test.js — the spawned engine writes
// ALL state into throwaway temp dirs via MARSIN_STATE_DIR/MARSIN_PLAYLISTS_DIR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, '..');
const SCENE = 'summer_camp_dome';

const tmpStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-autocap-states-'));
const playlistsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-autocap-playlists-'));

let proc = null;
let port = 6960 + Math.floor(Math.random() * 40);
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

function readPlaylist(name) {
  return fs.readFileSync(path.join(playlistsDir, `${name}.yaml`), 'utf8');
}
function entryDefaults(name, entryId) {
  const pl = yaml.load(readPlaylist(name));
  return pl.entries.find(e => e.id === entryId).defaults;
}

async function deckSlider() {
  const deck = await api('GET', '/deck/channel');
  const exps = deck.data.channel.exports || [];
  const s = exps.find(e => typeof e.name === 'string' && e.name.startsWith('slider')) || exps[0];
  assert.ok(s, 'deck pattern must expose a slider control');
  return s;
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

test('tweaking the deck then switching entry auto-captures the OUTGOING entry defaults', async () => {
  let r = await api('POST', '/playlists', {
    name: 'auto_show',
    entries: [
      { id: 'a', pattern: '13_sparkle', label: null, defaults: {} },
      { id: 'b', pattern: '13_sparkle', label: null, defaults: {} },
      { id: 'c', pattern: '13_sparkle', label: null, defaults: {} },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await api('POST', '/deck/playlist', { name: 'auto_show' });
  assert.equal(r.status, 200);
  assert.equal(r.data.playlist.activeEntryId, 'a');

  const slider = await deckSlider();
  // Tweak entry a's slider (marks the deck touched).
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.123, v1: 0, v2: 0 });

  // Switch away to entry b — this must auto-capture a's live tuning to disk.
  r = await api('POST', '/deck/playlist/entry', { entryId: 'b' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 250));

  const aDefaults = entryDefaults('auto_show', 'a');
  assert.equal(Number((aDefaults[slider.name]).toFixed(3)), 0.123,
    `outgoing entry a should have captured ${slider.name}=0.123, got ${JSON.stringify(aDefaults)}`);
  // Entry b (freshly loaded, untouched) has no captured defaults yet.
  assert.deepEqual(entryDefaults('auto_show', 'b'), {},
    'the freshly-loaded entry b must not have been captured');
});

test('switching WITHOUT tweaking writes nothing to the playlist file', async () => {
  // We are on entry b (untouched). Snapshot, switch b→c, compare bytes.
  const before = readPlaylist('auto_show');
  const r = await api('POST', '/deck/playlist/entry', { entryId: 'c' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 250));
  const after = readPlaylist('auto_show');
  assert.equal(after, before, 'an untouched entry switch must not rewrite the playlist file');
});

test('with auto-save OFF, a tweak + switch does NOT capture', async () => {
  const off = await api('POST', '/settings', { autoSave: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.autoSave, false);

  const slider = await deckSlider();
  // Currently on entry c. Tweak it, then switch back to a.
  await api('POST', '/deck/channel/control', { id: slider.id, v0: 0.777, v1: 0, v2: 0 });
  const before = readPlaylist('auto_show');
  const r = await api('POST', '/deck/playlist/entry', { entryId: 'a' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 250));
  const after = readPlaylist('auto_show');
  assert.equal(after, before, 'no capture may happen while auto-save is OFF');
  assert.deepEqual(entryDefaults('auto_show', 'c'), {},
    'entry c must NOT have captured the 0.777 tweak while auto-save was OFF');

  // Restore ON for the mixer isolation test.
  const on = await api('POST', '/settings', { autoSave: true });
  assert.equal(on.data.autoSave, true);
});

test('a MIXER channel tweak + entry switch NEVER auto-captures (isolation preserved)', async () => {
  // Separate playlist so this test is independent of the deck's auto_show.
  let r = await api('POST', '/playlists', {
    name: 'mix_show',
    entries: [
      { id: 'm1', pattern: '13_sparkle', label: null, defaults: {} },
      { id: 'm2', pattern: '13_sparkle', label: null, defaults: {} },
    ],
  });
  assert.equal(r.status, 200);

  r = await api('POST', '/mixer/channels', { pattern: '13_sparkle', name: 'CapOverlay', mode: 'blend_screen', fader: 0.6 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const chId = r.data.channelId;
  r = await api('POST', `/mixer/channels/${chId}/playlist`, { name: 'mix_show' });
  assert.equal(r.status, 200);

  // Same pattern → deterministic export ids, so the deck slider id addresses
  // the same control on the mixer channel's handle.
  const slider = await deckSlider();
  await api('POST', `/mixer/channels/${chId}/control`, { id: slider.id, v0: 0.456, v1: 0, v2: 0 });

  const before = readPlaylist('mix_show');
  r = await api('POST', `/mixer/channels/${chId}/playlist/entry`, { entryId: 'm2' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 250));
  const after = readPlaylist('mix_show');
  assert.equal(after, before, 'a mixer entry switch must NEVER auto-capture (shared-preset isolation)');
  assert.deepEqual(entryDefaults('mix_show', 'm1'), {},
    'mixer entry m1 must not have captured the tweak');
});
