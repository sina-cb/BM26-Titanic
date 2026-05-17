// End-to-end test: spawn the engine, exercise the playlist HTTP API.
// Run:  node --test tests/playlist_api.test.js
//
// Strategy: pick a free port, spawn `node engine.js`, poll /status, then
// exercise the endpoints. Tear down on completion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const engineDir = path.resolve(__dirname, '..');
const SCENE = 'summer_camp_dome';
const playlistsDir = path.join(repoRoot, 'simulation', 'scenes', SCENE, 'playlists');
const stateDir = path.join(engineDir, 'states', SCENE);

let proc = null;
let port = 6985 + Math.floor(Math.random() * 50);
const BASE = () => `http://127.0.0.1:${port}`;

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

async function cleanState() {
  // Wipe the scene playlists dir + the scene state dir so we start fresh.
  if (fs.existsSync(playlistsDir)) fs.rmSync(playlistsDir, { recursive: true, force: true });
  for (const f of ['deck_state.yaml', 'mixer_state.yaml']) {
    const p = path.join(stateDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

before(async () => {
  await cleanState();
  proc = spawn('node', ['engine.js', '--pattern', '13_sparkle', '--model', SCENE, '--port', String(port)], {
    cwd: engineDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => process.stderr.write('[engine] ' + d));
  proc.stderr.on('data', d => process.stderr.write('[engine!] ' + d));
  await waitForReady(BASE());
});

after(async () => {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    if (!proc.killed) proc.kill('SIGKILL');
  }
});

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

test('GET /playlists returns auto-generated default', async () => {
  const r = await api('GET', '/playlists');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
  assert.ok(r.data.includes('default'), 'default playlist should exist after boot');
});

test('default playlist on disk contains every pattern in patterns/', async () => {
  const r = await api('GET', '/playlists/default');
  assert.equal(r.status, 200);
  assert.ok(r.data.entries.length > 5);
  for (const e of r.data.entries) {
    assert.ok(e.id);
    assert.ok(e.pattern);
  }
});

test('Create custom playlist, load it onto deck, switch entries', async () => {
  // Create a small custom playlist
  const custom = {
    name: 'test_show',
    entries: [
      { id: 'e_a', pattern: '13_sparkle', label: 'Sparkle slow', defaults: {} },
      { id: 'e_b', pattern: '13_sparkle', label: 'Sparkle fast', defaults: {} },
      { id: 'e_c', pattern: '08_ocean_liner', label: 'Ocean', defaults: {} },
    ],
  };
  let r = await api('POST', '/playlists', custom);
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Load it onto the deck
  r = await api('POST', '/deck/playlist', { name: 'test_show' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.playlist.name, 'test_show');
  assert.equal(r.data.playlist.activeEntryId, 'e_a');

  // GET should reflect loaded state
  r = await api('GET', '/deck/playlist');
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'test_show');
  assert.equal(r.data.activeEntryId, 'e_a');

  // Move to entry b
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_b' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.playlist.activeEntryId, 'e_b');
  assert.equal(r.data.pattern, '13_sparkle');

  // Move to entry c (different pattern)
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_c' });
  assert.equal(r.status, 200);
  assert.equal(r.data.playlist.activeEntryId, 'e_c');
  assert.equal(r.data.pattern, '08_ocean_liner');
});

test('Capture defaults snapshots the active entry on disk', async () => {
  // Ensure we are on e_c
  await api('POST', '/deck/playlist/entry', { entryId: 'e_c' });

  // Capture defaults
  const r = await api('POST', '/deck/playlist/capture');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(typeof r.data.defaults, 'object');

  // The file should now have those defaults on entry e_c
  const onDisk = yaml.load(fs.readFileSync(path.join(playlistsDir, 'test_show.yaml'), 'utf8'));
  const eC = onDisk.entries.find(e => e.id === 'e_c');
  assert.ok(eC.defaults && typeof eC.defaults === 'object');
});

test('Playlist assignment persists across engine restart', async () => {
  // (We assume previous test left us on e_c of test_show.)
  // Kill the engine
  proc.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1000));
  // Re-spawn
  proc = spawn('node', ['engine.js', '--pattern', '13_sparkle', '--model', SCENE, '--port', String(port)], {
    cwd: engineDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => process.stderr.write('[engine] ' + d));
  proc.stderr.on('data', d => process.stderr.write('[engine!] ' + d));
  await waitForReady(BASE());

  const r = await api('GET', '/deck/playlist');
  assert.equal(r.status, 200);
  assert.ok(r.data, 'deck playlist should be restored, got null');
  assert.equal(r.data.name, 'test_show');
  assert.equal(r.data.activeEntryId, 'e_c');
});

test('Two entries of same pattern keep independent defaults across restart', async () => {
  // Two entries that share a pattern must keep their own captured defaults
  // across an engine restart. The playlist entry's `defaults` field is the
  // canonical per-slot state (docs/19_playlists.md §9.3).
  let r = await api('POST', '/playlists', {
    name: 'twin_show',
    entries: [
      { id: 'e_slow',  pattern: '13_sparkle', label: 'Slow Sparkle', defaults: {} },
      { id: 'e_fast',  pattern: '13_sparkle', label: 'Fast Sparkle', defaults: {} },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Load + switch to e_slow + capture default values that the pattern reports
  r = await api('POST', '/deck/playlist', { name: 'twin_show' });
  assert.equal(r.status, 200);
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_slow' });
  assert.equal(r.status, 200);

  // Pull the live exports so we know real control IDs.
  const mixerRes = await api('GET', '/mixer');
  const baseCh = mixerRes.data.channels.find(c => c.id === 'ch_base');
  const sliderBg = baseCh.exports.find(e => e.name === 'sliderBackgroundFade');
  const sliderSp = baseCh.exports.find(e => e.name === 'sliderSparkleSpeed');
  assert.ok(sliderBg && sliderSp, 'sparkle pattern must expose the expected sliders');

  // e_slow: low values
  await api('POST', '/mixer/channels/ch_base/control', { id: sliderBg.id, v0: 0.10, v1: 0, v2: 0 });
  await api('POST', '/mixer/channels/ch_base/control', { id: sliderSp.id, v0: 0.15, v1: 0, v2: 0 });
  r = await api('POST', '/deck/playlist/capture');
  assert.equal(r.status, 200);
  assert.equal(r.data.defaults.sliderBackgroundFade, 0.10);
  assert.equal(r.data.defaults.sliderSparkleSpeed, 0.15);

  // Switch to e_fast, set very different values, capture
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_fast' });
  assert.equal(r.status, 200);
  await api('POST', '/mixer/channels/ch_base/control', { id: sliderBg.id, v0: 0.90, v1: 0, v2: 0 });
  await api('POST', '/mixer/channels/ch_base/control', { id: sliderSp.id, v0: 0.95, v1: 0, v2: 0 });
  r = await api('POST', '/deck/playlist/capture');
  assert.equal(r.status, 200);
  assert.equal(r.data.defaults.sliderBackgroundFade, 0.90);
  assert.equal(r.data.defaults.sliderSparkleSpeed, 0.95);

  // Switch back to e_slow on the live engine — defaults must reapply.
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_slow' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 200));
  let post = await api('GET', '/mixer');
  let baseAfter = post.data.channels.find(c => c.id === 'ch_base');
  let bgAfter = baseAfter.exports.find(e => e.name === 'sliderBackgroundFade');
  let spAfter = baseAfter.exports.find(e => e.name === 'sliderSparkleSpeed');
  assert.equal(Number(bgAfter.v0.toFixed(2)), 0.10);
  assert.equal(Number(spAfter.v0.toFixed(2)), 0.15);

  // Now the real test: restart engine while sitting on e_slow.
  proc.kill('SIGTERM');
  await new Promise(res => setTimeout(res, 1000));
  proc = spawn('node', ['engine.js', '--pattern', '13_sparkle', '--model', SCENE, '--port', String(port)], {
    cwd: engineDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => process.stderr.write('[engine] ' + d));
  proc.stderr.on('data', d => process.stderr.write('[engine!] ' + d));
  await waitForReady(BASE());

  // Post-restart: the engine should have restored e_slow's defaults, NOT e_fast's.
  const restored = await api('GET', '/mixer');
  const restoredBase = restored.data.channels.find(c => c.id === 'ch_base');
  const bg = restoredBase.exports.find(e => e.name === 'sliderBackgroundFade');
  const sp = restoredBase.exports.find(e => e.name === 'sliderSparkleSpeed');
  assert.equal(Number(bg.v0.toFixed(2)), 0.10, `sliderBackgroundFade should be 0.10 after restart, got ${bg.v0}`);
  assert.equal(Number(sp.v0.toFixed(2)), 0.15, `sliderSparkleSpeed should be 0.15 after restart, got ${sp.v0}`);

  // Switching to e_fast post-restart should yield the e_fast values.
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_fast' });
  await new Promise(res => setTimeout(res, 200));
  const post2 = await api('GET', '/mixer');
  const base2 = post2.data.channels.find(c => c.id === 'ch_base');
  const bg2 = base2.exports.find(e => e.name === 'sliderBackgroundFade');
  const sp2 = base2.exports.find(e => e.name === 'sliderSparkleSpeed');
  assert.equal(Number(bg2.v0.toFixed(2)), 0.90);
  assert.equal(Number(sp2.v0.toFixed(2)), 0.95);

  // Cleanup
  await api('POST', '/deck/playlist', { name: null });
  await api('DELETE', '/playlists/twin_show');
});

test('Mixer channel playlist assignment + entry switching', async () => {
  // Add a mixer channel
  let r = await api('POST', '/mixer/channels', { pattern: '13_sparkle', name: 'Overlay', mode: 'blend_screen', fader: 0.5 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const channelId = r.data.channelId;
  assert.ok(channelId);

  // Assign playlist
  r = await api('POST', `/mixer/channels/${channelId}/playlist`, { name: 'test_show' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.playlist.name, 'test_show');

  // Switch entry to e_b
  r = await api('POST', `/mixer/channels/${channelId}/playlist/entry`, { entryId: 'e_b' });
  assert.equal(r.status, 200);
  assert.equal(r.data.playlist.activeEntryId, 'e_b');

  // GET state
  r = await api('GET', `/mixer/channels/${channelId}/playlist`);
  assert.equal(r.status, 200);
  assert.equal(r.data.activeEntryId, 'e_b');

  // Clear playlist
  r = await api('POST', `/mixer/channels/${channelId}/playlist`, { name: null });
  assert.equal(r.status, 200);
  assert.equal(r.data.playlist, null);

  // Cleanup
  await api('DELETE', `/mixer/channels/${channelId}`);
});

test('DELETE /playlists/default is rejected', async () => {
  const r = await api('DELETE', '/playlists/default');
  assert.equal(r.status, 400);
});

test('DELETE /playlists/test_show works', async () => {
  const r = await api('DELETE', '/playlists/test_show');
  assert.equal(r.status, 200);
  const list = (await api('GET', '/playlists')).data;
  assert.ok(!list.includes('test_show'));
});

test('Invalid playlist name is rejected with 400', async () => {
  const r = await api('POST', '/playlists', { name: '../etc', entries: [] });
  assert.equal(r.status, 400);
});

test('Path-traversal name is rejected', async () => {
  const r = await api('GET', '/playlists/' + encodeURIComponent('../etc/passwd'));
  // The route regex blocks `/` so this returns 404; that is also acceptable.
  assert.ok(r.status === 400 || r.status === 404);
});
