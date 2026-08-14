// End-to-end test: spawn the engine, exercise the playlist HTTP API.
// Run:  node --test tests/playlist_api.test.js
//
// Strategy: pick a free port, spawn `node engine.js`, poll /status, then
// exercise the endpoints. Tear down on completion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const engineDir = path.resolve(__dirname, '..', '..');
const SCENE = 'summer_camp_dome';

// ── State isolation (incident 2026-07-08) ────────────────────────────────
// The spawned engines write ALL runtime state (states/<scene>/*.yaml +
// playlists) into throwaway temp dirs via the MARSIN_STATE_DIR /
// MARSIN_PLAYLISTS_DIR overrides (lib/state_paths.js). This test must
// NEVER mutate the tracked states/ or simulation/scenes/ trees — a
// previous run left bogus runtime state in tracked files and the next
// real engine boot restored it (full dev-stack outage). The final test
// in this file pins that guarantee with a byte-level before/after check.
const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'marsin-playlist-api',
  portBase: 6985,
  portSpan: 50,
});
const { api, stateDir, playlistsDir } = h;
const BASE = h.base;

// Tracked trees the spawned engines must never touch (byte-snapshot at
// module load, compared by the last test).
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

before(async () => {
  // Fresh mkdtemp dirs at module load ARE the clean state — the tracked
  // playlists/state trees are never wiped (or written) by this test.
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

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
  h.proc.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1000));
  // Re-spawn
  h.spawnEngine();
  await h.waitForReady();

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

  // Pull the live exports so we know real control IDs. Post-channel-
  // split the deck channel lives at /deck/channel, NOT in
  // /mixer.channels — so we ask for it directly here.
  //
  // The two slider names used below (`sliderLocalSpeed`,
  // `sliderStarCount`) match the actual exports declared by
  // patterns/13_sparkle.js. An earlier version of this test looked
  // for `sliderBackgroundFade` + `sliderSparkleSpeed` and silently
  // failed once the pattern was refactored — the test was the bug,
  // not the engine. Updated again 2026-08-06 (report 20260806_184):
  // the pattern's "First-Class Constellations" rewrite retired
  // `sliderStarCount`, and the parameter rename then dropped the signal
  // prefixes, so the second probe slider is now `sliderStarCount`
  // (was `sliderFLUX_StarCount`, was `sliderStarCount`).
  const deckRes = await api('GET', '/deck/channel');
  const baseCh = deckRes.data.channel;
  assert.ok(baseCh && baseCh.id === 'ch_base', 'deck channel should be ch_base');
  const sliderA = baseCh.exports.find(e => e.name === 'sliderLocalSpeed');
  const sliderB = baseCh.exports.find(e => e.name === 'sliderStarCount');
  assert.ok(sliderA && sliderB,
    `sparkle pattern must expose sliderLocalSpeed + sliderStarCount; ` +
    `got exports=${baseCh.exports.map(e => e.name).join(',')}`);

  // e_slow: low values. Writes go through the deck control route now
  // (mixer routes refuse the deck id with 400 WRONG_ROLE).
  await api('POST', '/deck/channel/control', { id: sliderA.id, v0: 0.10, v1: 0, v2: 0 });
  await api('POST', '/deck/channel/control', { id: sliderB.id, v0: 0.15, v1: 0, v2: 0 });
  r = await api('POST', '/deck/playlist/capture');
  assert.equal(r.status, 200);
  assert.equal(r.data.defaults.sliderLocalSpeed, 0.10);
  assert.equal(r.data.defaults.sliderStarCount, 0.15);

  // Switch to e_fast, set very different values, capture
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_fast' });
  assert.equal(r.status, 200);
  await api('POST', '/deck/channel/control', { id: sliderA.id, v0: 0.90, v1: 0, v2: 0 });
  await api('POST', '/deck/channel/control', { id: sliderB.id, v0: 0.95, v1: 0, v2: 0 });
  r = await api('POST', '/deck/playlist/capture');
  assert.equal(r.status, 200);
  assert.equal(r.data.defaults.sliderLocalSpeed, 0.90);
  assert.equal(r.data.defaults.sliderStarCount, 0.95);

  // Switch back to e_slow on the live engine — defaults must reapply.
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_slow' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 200));
  let post = await api('GET', '/deck/channel');
  let baseAfter = post.data.channel;
  let aAfter = baseAfter.exports.find(e => e.name === 'sliderLocalSpeed');
  let bAfter = baseAfter.exports.find(e => e.name === 'sliderStarCount');
  assert.equal(Number(aAfter.v0.toFixed(2)), 0.10);
  assert.equal(Number(bAfter.v0.toFixed(2)), 0.15);

  // Now the real test: restart engine while sitting on e_slow.
  h.proc.kill('SIGTERM');
  await new Promise(res => setTimeout(res, 1000));
  h.spawnEngine();
  await h.waitForReady();

  // Post-restart: the engine should have restored e_slow's defaults, NOT e_fast's.
  const restored = await api('GET', '/deck/channel');
  const restoredBase = restored.data.channel;
  const a1 = restoredBase.exports.find(e => e.name === 'sliderLocalSpeed');
  const b1 = restoredBase.exports.find(e => e.name === 'sliderStarCount');
  assert.equal(Number(a1.v0.toFixed(2)), 0.10, `sliderLocalSpeed should be 0.10 after restart, got ${a1.v0}`);
  assert.equal(Number(b1.v0.toFixed(2)), 0.15, `sliderStarCount should be 0.15 after restart, got ${b1.v0}`);

  // Switching to e_fast post-restart should yield the e_fast values.
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_fast' });
  await new Promise(res => setTimeout(res, 200));
  const post2 = await api('GET', '/deck/channel');
  const base2 = post2.data.channel;
  const a2 = base2.exports.find(e => e.name === 'sliderLocalSpeed');
  const b2 = base2.exports.find(e => e.name === 'sliderStarCount');
  assert.equal(Number(a2.v0.toFixed(2)), 0.90);
  assert.equal(Number(b2.v0.toFixed(2)), 0.95);

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

test('Reorder: POST /playlists with new entry order persists and preserves activeEntryId', async () => {
  // Operator request (slot 5, May 2026): re-sequence entries mid-show
  // without going back to YAML. Load test_show onto the deck, switch
  // to its middle entry, then send back the SAME entries in a new
  // order. The reorder must:
  //   (1) persist to disk (next GET returns the new order),
  //   (2) leave activeEntryId untouched,
  //   (3) update the channel.cursor to reflect the active entry's
  //       new index in the reordered list.
  let r = await api('POST', '/playlists', {
    name: 'test_show',
    entries: [
      { id: 'e_a', pattern: '13_sparkle', label: 'Sparkle slow', defaults: {} },
      { id: 'e_b', pattern: '13_sparkle', label: 'Sparkle fast', defaults: {} },
      { id: 'e_c', pattern: '08_ocean_liner', label: 'Ocean', defaults: {} },
    ],
  });
  assert.equal(r.status, 200);
  r = await api('POST', '/deck/playlist', { name: 'test_show' });
  assert.equal(r.status, 200);
  // Activate the middle entry so we can prove cursor tracking later.
  r = await api('POST', '/deck/playlist/entry', { entryId: 'e_b' });
  assert.equal(r.status, 200);
  assert.equal(r.data.playlist.activeEntryId, 'e_b');
  // Pre-reorder cursor: e_b is at index 1.
  let deck = await api('GET', '/deck/playlist');
  assert.equal(deck.data.cursor, 1);

  // Reorder: move e_b to the END. New order: [e_a, e_c, e_b].
  r = await api('POST', '/playlists', {
    name: 'test_show',
    entries: [
      { id: 'e_a', pattern: '13_sparkle', label: 'Sparkle slow', defaults: {} },
      { id: 'e_c', pattern: '08_ocean_liner', label: 'Ocean', defaults: {} },
      { id: 'e_b', pattern: '13_sparkle', label: 'Sparkle fast', defaults: {} },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // (1) Order persists on disk.
  r = await api('GET', '/playlists/test_show');
  assert.deepEqual(r.data.entries.map(e => e.id), ['e_a', 'e_c', 'e_b']);
  // (2) Active entry id is unchanged.
  deck = await api('GET', '/deck/playlist');
  assert.equal(deck.data.activeEntryId, 'e_b');
  // (3) Cursor moved to the new index (was 1, now 2).
  assert.equal(deck.data.cursor, 2);
});

test('Reorder: 1-entry playlist accepts a same-order save (no-op semantics)', async () => {
  let r = await api('POST', '/playlists', {
    name: 'mini_show',
    entries: [{ id: 'only', pattern: '13_sparkle', label: 'only', defaults: {} }],
  });
  assert.equal(r.status, 200);
  r = await api('POST', '/playlists', {
    name: 'mini_show',
    entries: [{ id: 'only', pattern: '13_sparkle', label: 'only', defaults: {} }],
  });
  assert.equal(r.status, 200);
  r = await api('GET', '/playlists/mini_show');
  assert.equal(r.data.entries.length, 1);
  await api('DELETE', '/playlists/mini_show');
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

// ── "Load directory" support (patterns/ sub-folders) ───────────────────
test('GET /pattern-dirs lists default + the patterns/ sub-directories', async () => {
  const r = await api('GET', '/pattern-dirs');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
  // `default` (the synthetic top-level folder) leads the list.
  assert.equal(r.data[0], 'default', `expected default first in ${JSON.stringify(r.data)}`);
  // `transitions` is a known sub-folder shipped in patterns/.
  assert.ok(r.data.includes('transitions'), `expected transitions in ${JSON.stringify(r.data)}`);
  // No top-level pattern files leak into the directory list.
  assert.ok(!r.data.includes('13_sparkle'));
});

test('GET /pattern-dirs/default lists bare top-level pattern slugs', async () => {
  const r = await api('GET', '/pattern-dirs/default');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data) && r.data.length > 5);
  // Bare slugs (no dir prefix) and no test*/_ helpers.
  assert.ok(r.data.includes('13_sparkle'), `expected 13_sparkle in ${JSON.stringify(r.data.slice(0, 5))}…`);
  assert.ok(r.data.every(p => !p.includes('/')), 'top-level slugs must not be dir-prefixed');
  assert.ok(r.data.every(p => !p.startsWith('test')), 'test* patterns excluded from default');
});

test('GET /pattern-dirs/:dir lists prefixed pattern slugs', async () => {
  const r = await api('GET', '/pattern-dirs/transitions');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data) && r.data.length > 0);
  for (const p of r.data) {
    assert.ok(p.startsWith('transitions/'), `slug should be dir-prefixed: ${p}`);
  }
});

test('Loading a directory bulk-adds its patterns as valid playlist entries', async () => {
  const dir = (await api('GET', '/pattern-dirs/transitions')).data;
  assert.ok(dir.length > 0);
  const entries = dir.map((pattern, i) => ({ id: `e_dir_${i}`, pattern, label: null, defaults: {} }));
  let r = await api('POST', '/playlists', { name: 'dir_show', entries });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // The saved playlist round-trips with the dir-prefixed patterns intact.
  r = await api('GET', '/playlists/dir_show');
  assert.equal(r.status, 200);
  assert.equal(r.data.entries.length, dir.length);
  assert.ok(r.data.entries.every(e => e.pattern.startsWith('transitions/')));
  // None should be flagged _missing — the patterns really exist on disk.
  assert.ok(r.data.entries.every(e => !e._missing));
  await api('DELETE', '/playlists/dir_show');
});

test('GET /pattern-dirs/:dir rejects a traversal directory name', async () => {
  const r = await api('GET', '/pattern-dirs/' + encodeURIComponent('..'));
  assert.ok(r.status === 400 || r.status === 404);
});

// ── Regression: state isolation (incident 2026-07-08) ──────────────────
test('spawned engines wrote state to the temp dirs, never the tracked trees', () => {
  // The isolated engine really used the override dirs…
  assert.ok(
    fs.existsSync(path.join(stateDir, 'deck_state.yaml')),
    `expected deck_state.yaml under MARSIN_STATE_DIR (${stateDir})`,
  );
  assert.ok(
    fs.existsSync(path.join(playlistsDir, 'default.yaml')),
    `expected default.yaml under MARSIN_PLAYLISTS_DIR (${playlistsDir})`,
  );
  // …and the tracked states/ + playlists/ trees are byte-identical to
  // before the run. A failure here means a spawned engine leaked runtime
  // state into git-tracked files — exactly the pollution that restored a
  // bogus capture.device into a real boot and took the dev stack down.
  const trackedAfter = snapshotTrackedTrees();
  assert.deepEqual(
    Object.keys(trackedAfter).sort(), Object.keys(trackedBefore).sort(),
    'tracked state/playlist file SET changed during the test run',
  );
  for (const [p, bytes] of Object.entries(trackedBefore)) {
    assert.equal(trackedAfter[p], bytes, `tracked file mutated during test run: ${p}`);
  }
});
