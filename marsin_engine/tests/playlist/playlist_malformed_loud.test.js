// Codex P0 — playlist load must FAIL LOUDLY on a corrupt file.
//
// Before this slice, PlaylistManager.load() collapsed BOTH "file missing"
// and "file exists but YAML is corrupt" into `return null`. That silent
// fallback hid an operator's bad save: the corrupt playlist looked exactly
// like an absent one and was dropped without a word. These tests pin the
// new contract:
//   - genuinely-missing file → null (NOT an error)
//   - corrupt YAML / non-mapping top-level → throws PlaylistLoadError
//     (with .code === 'PLAYLIST_MALFORMED') so HTTP callers can 400
//   - tryLoad() degrades a corrupt file to null (for the render/restore
//     paths that must never crash) but still surfaces the corruption.
//
// Run:  node --test tests/playlist_malformed_loud.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { PlaylistManager, PlaylistLoadError } from '../../lib/playlist_manager.js';

function tmpdirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playlist_loud_test_'));
  const playlistsDir = path.join(root, 'playlists');
  const patternsDir = path.join(root, 'patterns');
  fs.mkdirSync(playlistsDir, { recursive: true });
  fs.mkdirSync(patternsDir, { recursive: true });
  fs.writeFileSync(path.join(patternsDir, '13_sparkle.js'), `export var foo = 0;\n`);
  return { root, playlistsDir, patternsDir };
}

// Silence the expected console.error/warn so the test output stays clean.
function quietConsole(fn) {
  const e = console.error, w = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.error = e; console.warn = w; }
}

test('load: genuinely-missing playlist returns null (NOT an error)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  assert.equal(pm.load('does_not_exist'), null);
});

test('load: corrupt YAML throws PlaylistLoadError (no silent null)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  // Tab-indented + unterminated flow map = invalid YAML.
  fs.writeFileSync(path.join(playlistsDir, 'broken.yaml'), 'name: broken\nentries: [ {id: \n');
  quietConsole(() => {
    assert.throws(
      () => pm.load('broken'),
      (err) => {
        assert.ok(err instanceof PlaylistLoadError, 'should be PlaylistLoadError');
        assert.equal(err.code, 'PLAYLIST_MALFORMED');
        assert.equal(err.playlistName, 'broken');
        return true;
      },
    );
  });
});

test('load: non-mapping top-level (a bare list) throws PlaylistLoadError', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  fs.writeFileSync(path.join(playlistsDir, 'listy.yaml'), '- a\n- b\n- c\n');
  quietConsole(() => {
    assert.throws(() => pm.load('listy'), PlaylistLoadError);
  });
});

test('tryLoad: corrupt YAML degrades to null (render/restore-safe)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  fs.writeFileSync(path.join(playlistsDir, 'broken.yaml'), 'name: broken\nentries: [ {id: \n');
  quietConsole(() => {
    assert.equal(pm.tryLoad('broken'), null);
  });
});

test('tryLoad: valid playlist loads normally', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.save({ name: 'good', entries: [{ id: 'e1', pattern: '13_sparkle' }] });
  const pl = pm.tryLoad('good');
  assert.ok(pl);
  assert.equal(pl.entries.length, 1);
});
