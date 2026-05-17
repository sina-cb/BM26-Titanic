// Unit tests for PlaylistManager — uses node:test.
// Run:  node --test tests/playlist_manager.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { PlaylistManager } from '../lib/playlist_manager.js';

function tmpdirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playlist_test_'));
  const playlistsDir = path.join(root, 'playlists');
  const patternsDir = path.join(root, 'patterns');
  fs.mkdirSync(playlistsDir, { recursive: true });
  fs.mkdirSync(patternsDir, { recursive: true });
  // Drop a few placeholder pattern files so existence checks pass.
  for (const name of ['13_sparkle', '08_ocean_liner', '25_heartbeat']) {
    fs.writeFileSync(path.join(patternsDir, `${name}.js`), `// stub\nexport var foo = 0;\n`);
  }
  return { root, playlistsDir, patternsDir };
}

test('validateName rejects invalid names', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  assert.throws(() => pm.validateName('../etc/passwd'));
  assert.throws(() => pm.validateName('foo/bar'));
  assert.throws(() => pm.validateName('FooBar'));
  assert.throws(() => pm.validateName(''));
  // Valid
  pm.validateName('my_playlist-1');
  pm.validateName('default');
});

test('generateDefault creates an entry per pattern', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const pl = pm.generateDefault();
  assert.equal(pl.name, 'default');
  assert.equal(pl.entries.length, 3);
  const ids = new Set(pl.entries.map(e => e.id));
  assert.equal(ids.size, 3); // unique
  // Round-trip via disk
  const reloaded = pm.load('default');
  assert.equal(reloaded.entries.length, 3);
  for (const e of reloaded.entries) {
    assert.ok(e.id);
    assert.ok(e.pattern);
    assert.deepEqual(e.defaults, {});
  }
});

test('save rejects duplicate entry ids', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  assert.throws(() => pm.save({
    name: 'dup',
    entries: [
      { id: 'a', pattern: '13_sparkle' },
      { id: 'a', pattern: '08_ocean_liner' },
    ],
  }));
});

test('save round-trips entry defaults including HSV picker values', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const written = pm.save({
    name: 'show',
    entries: [
      { id: 'e1', pattern: '13_sparkle', label: 'Sparkle slow',
        defaults: { speed: 0.005, density: 0.2, baseColor: { h: 0.55, s: 1, v: 1 } } },
      { id: 'e2', pattern: '13_sparkle', label: 'Sparkle fast',
        defaults: { speed: 0.04, density: 0.8 } },
    ],
  });
  assert.equal(written.entries[0].label, 'Sparkle slow');
  const loaded = pm.load('show');
  assert.equal(loaded.entries[0].defaults.speed, 0.005);
  assert.deepEqual(loaded.entries[0].defaults.baseColor, { h: 0.55, s: 1, v: 1 });
});

test('load flags missing patterns', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.save({
    name: 'mix',
    entries: [
      { id: 'a', pattern: '13_sparkle' },
      { id: 'b', pattern: 'nope_does_not_exist' },
    ],
  });
  const loaded = pm.load('mix');
  assert.equal(loaded.entries[0]._missing, undefined);
  assert.equal(loaded.entries[1]._missing, true);
});

test('delete refuses default; works for others', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.generateDefault();
  pm.save({ name: 'spare', entries: [{ id: 'a', pattern: '13_sparkle' }] });
  assert.throws(() => pm.delete('default'));
  assert.ok(pm.list().includes('spare'));
  pm.delete('spare');
  assert.ok(!pm.list().includes('spare'));
});

test('captureDefaults uses fake wasmHost + paramCenter contract', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const fakeWasm = {
    getExports: () => [
      { id: 100, name: 'sliderSpeed', kind: 1, v0: 0.5 },          // local slider
      { id: 200, name: 'sharedSpeed', kind: 4, v0: 0.3 },          // CPC-owned (kind 4)
      { id: 300, name: 'sliderTail',  kind: 1, v0: 0.6 },          // local slider, will be live-edited
      { id: 400, name: 'triggerStrobe', kind: 3, v0: 0.0 },        // trigger — EXCLUDED
      { id: 500, name: 'hsvBase',     kind: 6, v0: 0.1, v1: 0.5, v2: 0.7 },
    ],
  };
  const fakeChannel = {
    id: 'ch_test',
    handle: 1,
    localControls: { 300: { v0: 0.42, v1: 0, v2: 0 } },
  };
  const fakeCpc = {
    isSharedExport: (cid, n) => n === 'sharedSpeed',
    getBlockedIds: () => new Set(),
  };
  const captured = pm.captureDefaults(fakeChannel, fakeWasm, fakeCpc);
  assert.equal(captured.sliderSpeed, 0.5);    // default from export
  assert.equal(captured.sliderTail, 0.42);    // live-edited value
  assert.equal(captured.sharedSpeed, undefined); // CPC-owned excluded
  assert.equal(captured.triggerStrobe, undefined); // trigger excluded
  assert.deepEqual(captured.hsvBase, { h: 0.1, s: 0.5, v: 0.7 });
});

test('applyEntryDefaults skips stale names and CPC-owned exports', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const fakeWasm = {
    getExports: () => [
      { id: 100, name: 'sliderSpeed', kind: 1 },
      { id: 200, name: 'sharedSpeed', kind: 4 },
    ],
  };
  const writes = [];
  const fakeRouter = {
    setChannelControl: (cid, controlId, v0, v1, v2) => writes.push({ controlId, v0, v1, v2 }),
  };
  const fakeCpc = {
    isSharedExport: (cid, n) => n === 'sharedSpeed',
    getBlockedIds: () => new Set(),
  };
  pm.applyEntryDefaults(
    { id: 'ch', handle: 1 },
    { id: 'e1', pattern: '13_sparkle', defaults: { sliderSpeed: 0.8, sharedSpeed: 0.9, doesNotExist: 0.4 } },
    fakeWasm, fakeRouter, fakeCpc
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].controlId, 100);
  assert.equal(writes[0].v0, 0.8);
});
