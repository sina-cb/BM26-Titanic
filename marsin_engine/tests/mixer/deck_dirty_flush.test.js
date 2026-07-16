// End-to-end: prove the DECK DIRTY-CAPTURE FLUSH (feature B). While saving is
// gated off (auto-save OFF or performance mode) every deck capture-on-switch
// that would have written the outgoing entry's tuned defaults is deferred in
// memory; when saving is re-enabled the pending captures FLUSH to their playlist
// files — plus the currently-loaded entry's live tuning. Performance RESTORE
// discards the pending captures (mid-show tuning must not reach disk).
// Run:  node --test tests/deck_dirty_flush.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'summer_camp_dome';
const PAT_A = '01_cylon_sweep';
const PAT_B = '13_sparkle';

const h = createEngineHarness({
  scene: SCENE,
  pattern: PAT_B,
  prefix: 'marsin-flush',
  portBase: 6740,
  portSpan: 60,
});
const { api, playlistsDir } = h;
const BASE = h.base;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadPlaylistFile(name) {
  const p = path.join(playlistsDir, `${name}.yaml`);
  return yaml.load(fs.readFileSync(p, 'utf8'));
}
function entryDefaults(name, entryId) {
  const pl = loadPlaylistFile(name);
  const e = pl.entries.find(x => x.id === entryId);
  return (e && e.defaults) || {};
}
async function pickDeckLocalSlider() {
  const deck = await api('GET', '/deck/channel');
  const exps = deck.data.channel.exports || [];
  const s = exps.find(e => typeof e.name === 'string' && e.name.startsWith('slider') && !e.cpcOwned) || exps[0];
  assert.ok(s, 'deck pattern must expose a non-CPC local slider');
  return s;
}

before(async () => { h.spawnEngine(); await h.waitForReady(); });
after(async () => { await h.teardown(); });

test('auto-save OFF: tune across multiple entries → POST /settings true flushes every dirty entry (untouched entries stay empty)', async () => {
  await api('POST', '/playlists', { name: 'flush1', entries: [
    { id: 'f_a', pattern: PAT_A, label: null, defaults: {} },
    { id: 'f_b', pattern: PAT_B, label: null, defaults: {} },
    { id: 'f_c', pattern: PAT_A, label: null, defaults: {} },
    { id: 'f_untouched', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/settings', { autoSave: false });
  await api('POST', '/deck/playlist', { name: 'flush1' }); // loads f_a
  await sleep(200);

  // Tune f_a, switch to f_b (defers f_a); tune f_b, switch to f_c (defers f_b);
  // tune f_c and leave it loaded (current entry — flushed live).
  const sa = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: sa.id, v0: 0.111, v1: 0, v2: 0 });
  await sleep(120);
  await api('POST', '/deck/playlist/entry', { entryId: 'f_b' });
  await sleep(180);
  const sb = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: sb.id, v0: 0.222, v1: 0, v2: 0 });
  await sleep(120);
  await api('POST', '/deck/playlist/entry', { entryId: 'f_c' });
  await sleep(180);
  const sc = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: sc.id, v0: 0.333, v1: 0, v2: 0 });
  await sleep(120);

  // Nothing written yet (auto-save OFF).
  assert.deepEqual(entryDefaults('flush1', 'f_a'), {}, 'f_a defaults must be empty before flush');
  assert.deepEqual(entryDefaults('flush1', 'f_c'), {}, 'f_c defaults must be empty before flush');

  // Re-enable auto-save → flush.
  const on = await api('POST', '/settings', { autoSave: true });
  assert.equal(on.status, 200);
  await sleep(250);

  assert.ok(Math.abs(entryDefaults('flush1', 'f_a')[sa.name] - 0.111) < 1e-6, 'f_a (deferred) flushed to disk');
  assert.ok(Math.abs(entryDefaults('flush1', 'f_b')[sb.name] - 0.222) < 1e-6, 'f_b (deferred) flushed to disk');
  assert.ok(Math.abs(entryDefaults('flush1', 'f_c')[sc.name] - 0.333) < 1e-6, 'f_c (current live) flushed to disk');
  assert.deepEqual(entryDefaults('flush1', 'f_untouched'), {}, 'untouched entry must stay empty (not flushed)');
});

test('performance KEEP & SAVE with stored auto-save ON flushes the deferred deck captures', async () => {
  await api('POST', '/settings', { autoSave: true });
  await api('POST', '/playlists', { name: 'flush_keep', entries: [
    { id: 'k_a', pattern: PAT_A, label: null, defaults: {} },
    { id: 'k_b', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'flush_keep' });
  await sleep(200);

  // Enter performance mode (effectiveAutoSave now false even though stored ON).
  await api('POST', '/performance-mode', { active: true });
  await sleep(150);
  const sa = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: sa.id, v0: 0.444, v1: 0, v2: 0 });
  await sleep(120);
  await api('POST', '/deck/playlist/entry', { entryId: 'k_b' }); // defers k_a (perf gate)
  await sleep(180);
  // Mid-show: nothing on disk yet.
  assert.deepEqual(entryDefaults('flush_keep', 'k_a'), {}, 'k_a must be empty mid-show');

  // Exit KEEP & SAVE → flush (the previous auto-flush-on-KEEP is now explicit).
  const keep = await api('POST', '/performance-mode', { active: false, exitAction: 'keep-save' });
  assert.equal(keep.status, 200);
  assert.equal(keep.data.exitAction, 'keep-save', 'exit echoes the keep-save action');
  await sleep(250);
  assert.ok(Math.abs(entryDefaults('flush_keep', 'k_a')[sa.name] - 0.444) < 1e-6, 'KEEP & SAVE must flush the deferred k_a capture');
});

test('performance KEEP WITHOUT SAVING discards the playlist backlog but keeps the session cache (A→B→A retains in-session)', async () => {
  await api('POST', '/settings', { autoSave: true });
  await api('POST', '/playlists', { name: 'flush_nosave', entries: [
    { id: 'n_a', pattern: PAT_A, label: null, defaults: {} },
    { id: 'n_b', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'flush_nosave' });
  await sleep(200);

  await api('POST', '/performance-mode', { active: true });
  await sleep(150);
  const sa = await pickDeckLocalSlider();
  const TUNED = 0.6789;
  await api('POST', '/deck/channel/control', { id: sa.id, v0: TUNED, v1: 0, v2: 0 });
  await sleep(120);
  await api('POST', '/deck/playlist/entry', { entryId: 'n_b' }); // defers n_a (perf gate)
  await sleep(180);

  // Exit KEEP WITHOUT SAVING → discards the backlog.
  const keep = await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  assert.equal(keep.status, 200);
  assert.equal(keep.data.exitAction, 'keep', 'exit echoes the keep action');
  await sleep(200);

  // The deferred n_a capture must NOT have reached the playlist file.
  const d = entryDefaults('flush_nosave', 'n_a');
  assert.ok(!(sa.name in d) || Math.abs(d[sa.name] - TUNED) > 1e-6,
    'KEEP WITHOUT SAVING must discard the deferred n_a capture (nothing hits the playlist file)');

  // But the SESSION CACHE survived: switching back to n_a in-session re-applies
  // the mid-show tuning (in-memory continuity, independent of the file backlog).
  await api('POST', '/deck/playlist/entry', { entryId: 'n_a' });
  await sleep(200);
  const deck = await api('GET', '/deck/channel');
  const live = (deck.data.channel.exports || []).find(e => e.name === sa.name);
  assert.ok(live, 'n_a re-exposes the same slider');
  assert.ok(Math.abs(live.v0 - TUNED) < 1e-6,
    'session cache must re-apply the mid-show tuning on A→B→A even though the file backlog was discarded');
});

test('performance RESTORE discards deferred captures — mid-show tuning never reaches the playlist file', async () => {
  await api('POST', '/settings', { autoSave: true });
  await api('POST', '/playlists', { name: 'flush_restore', entries: [
    { id: 'r_a', pattern: PAT_A, label: null, defaults: {} },
    { id: 'r_b', pattern: PAT_B, label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'flush_restore' });
  await sleep(200);

  await api('POST', '/performance-mode', { active: true });
  await sleep(150);
  const sa = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: sa.id, v0: 0.777, v1: 0, v2: 0 });
  await sleep(120);
  await api('POST', '/deck/playlist/entry', { entryId: 'r_b' }); // defers r_a
  await sleep(180);

  // POST /settings is blocked during a show (409) — proves auto-save cannot be
  // flipped mid-performance, so no flush can happen until exit.
  const gated = await api('POST', '/settings', { autoSave: true });
  assert.equal(gated.status, 409, 'POST /settings must 409 during performance mode');

  const restore = await api('POST', '/performance-mode', { active: false, exitAction: 'restore' });
  assert.equal(restore.status, 200);
  await sleep(300);
  // r_a must NOT carry the mid-show 0.777 — RESTORE dropped the pending capture.
  const d = entryDefaults('flush_restore', 'r_a');
  assert.ok(!(sa.name in d) || Math.abs(d[sa.name] - 0.777) > 1e-6,
    'RESTORE must discard the deferred capture (mid-show tuning must not hit the playlist file)');
});

test('flush includes the currently-loaded entry live tuning even with no switch after tuning', async () => {
  await api('POST', '/settings', { autoSave: false });
  await api('POST', '/playlists', { name: 'flush_live', entries: [
    { id: 'l_a', pattern: PAT_A, label: null, defaults: {} },
  ] });
  await api('POST', '/deck/playlist', { name: 'flush_live' });
  await sleep(200);
  const sa = await pickDeckLocalSlider();
  await api('POST', '/deck/channel/control', { id: sa.id, v0: 0.556, v1: 0, v2: 0 });
  await sleep(120);
  // No switch — just re-enable auto-save. The current entry's live tuning must land.
  await api('POST', '/settings', { autoSave: true });
  await sleep(250);
  assert.ok(Math.abs(entryDefaults('flush_live', 'l_a')[sa.name] - 0.556) < 1e-6,
    'enabling auto-save must capture the current entry live tuning without another switch');
});
