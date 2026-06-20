// Unit tests for the playlist Tags (#11) and per-entry Hold/Loop (#12)
// additive schema fields on PlaylistManager. Run:
//   node --test tests/playlist_tags_holdloop.test.js
//
// Contract under test (see docs/19 §2 + the load()/save() coercion
// precedent for `defaults`/`modulations`):
//   - Playlist-level `tags: string[]` — trimmed, lowercased, empties
//     dropped on load; same + Set-deduped on save; non-array junk → [].
//   - Per-entry `hold`/`loop: boolean` — strict `=== true` in BOTH load
//     and save (absent / null / 0 / "false" → false). This keeps an OLD
//     playlist byte-compatible: no tags → [], entries → hold/loop false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { PlaylistManager } from '../lib/playlist_manager.js';

function tmpdirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playlist_tags_test_'));
  const playlistsDir = path.join(root, 'playlists');
  const patternsDir = path.join(root, 'patterns');
  fs.mkdirSync(playlistsDir, { recursive: true });
  fs.mkdirSync(patternsDir, { recursive: true });
  for (const name of ['13_sparkle', '08_ocean_liner', '25_heartbeat']) {
    fs.writeFileSync(path.join(patternsDir, `${name}.js`), `// stub\nexport var foo = 0;\n`);
  }
  return { root, playlistsDir, patternsDir };
}

test('tags round-trip: lowercase + trim + dedupe + drop empties', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const written = pm.save({
    name: 'tagged',
    tags: ['  Chill ', 'AMBIENT', 'chill', 'ambient ', '', '   ', 'Night'],
    entries: [{ id: 'a', pattern: '13_sparkle' }],
  });
  // save() normalizes: lowercase, trim, dedupe, drop empties. Order is
  // first-seen (Set preserves insertion order).
  assert.deepEqual(written.tags, ['chill', 'ambient', 'night']);
  const reloaded = pm.load('tagged');
  assert.deepEqual(reloaded.tags, ['chill', 'ambient', 'night']);
});

test('tags: non-array junk coerces to [] (lenient, never throws)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  // save with object junk
  const a = pm.save({ name: 'junk_a', tags: { not: 'an array' }, entries: [] });
  assert.deepEqual(a.tags, []);
  // save with scalar junk
  const b = pm.save({ name: 'junk_b', tags: 'chill', entries: [] });
  assert.deepEqual(b.tags, []);
  // save with null
  const c = pm.save({ name: 'junk_c', tags: null, entries: [] });
  assert.deepEqual(c.tags, []);
  // mixed array: non-string members are filtered out
  const d = pm.save({ name: 'junk_d', tags: ['ok', 5, null, { x: 1 }, 'two'], entries: [] });
  assert.deepEqual(d.tags, ['ok', 'two']);
});

test('tags: load coerces malformed on-disk tags without throwing', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  // Hand-write a file with a scalar `tags` (not an array) + dirty members.
  fs.writeFileSync(
    path.join(playlistsDir, 'dirty.yaml'),
    yaml.dump({ schemaVersion: 1, name: 'dirty', tags: 'oops', entries: [] }),
  );
  const a = pm.load('dirty');
  assert.deepEqual(a.tags, []);

  fs.writeFileSync(
    path.join(playlistsDir, 'dirty2.yaml'),
    yaml.dump({ schemaVersion: 1, name: 'dirty2', tags: ['  Foo', 7, 'BAR  '], entries: [] }),
  );
  const b = pm.load('dirty2');
  assert.deepEqual(b.tags, ['foo', 'bar']);
});

test('hold/loop round-trip: true persists, strict === true coercion', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const written = pm.save({
    name: 'flags',
    entries: [
      { id: 'a', pattern: '13_sparkle', hold: true, loop: false },
      { id: 'b', pattern: '08_ocean_liner', hold: false, loop: true },
      { id: 'c', pattern: '25_heartbeat', hold: true, loop: true },
    ],
  });
  assert.equal(written.entries[0].hold, true);
  assert.equal(written.entries[0].loop, false);
  assert.equal(written.entries[1].hold, false);
  assert.equal(written.entries[1].loop, true);
  assert.equal(written.entries[2].hold, true);
  assert.equal(written.entries[2].loop, true);
  const reloaded = pm.load('flags');
  assert.equal(reloaded.entries[0].hold, true);
  assert.equal(reloaded.entries[0].loop, false);
  assert.equal(reloaded.entries[1].loop, true);
  assert.equal(reloaded.entries[2].hold, true);
  assert.equal(reloaded.entries[2].loop, true);
});

test('hold/loop: truthy-but-not-true values coerce to false', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  const written = pm.save({
    name: 'coerce',
    entries: [
      // 1, "true", "false", 0, null are all NOT === true → false
      { id: 'a', pattern: '13_sparkle', hold: 1, loop: 'true' },
      { id: 'b', pattern: '08_ocean_liner', hold: 'false', loop: 0 },
      { id: 'c', pattern: '25_heartbeat', hold: null, loop: undefined },
    ],
  });
  for (const e of written.entries) {
    assert.equal(e.hold, false);
    assert.equal(e.loop, false);
  }
});

test('OLD playlist coercion: no tags → [], entries → hold/loop false (byte-compat)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  // Hand-write a pre-feature file: NO tags key, entries with NO hold/loop.
  // This is exactly what an existing on-disk playlist looks like.
  fs.writeFileSync(
    path.join(playlistsDir, 'legacy.yaml'),
    yaml.dump({
      schemaVersion: 1,
      name: 'legacy',
      entries: [
        { id: 'e_1', pattern: '13_sparkle', label: 'Old One', defaults: {}, notes: null },
        { id: 'e_2', pattern: '08_ocean_liner', label: null, defaults: { foo: 0.5 } },
      ],
    }),
  );
  const loaded = pm.load('legacy');
  assert.deepEqual(loaded.tags, []);
  for (const e of loaded.entries) {
    assert.equal(e.hold, false);
    assert.equal(e.loop, false);
  }
  // Pre-existing fields untouched.
  assert.equal(loaded.entries[0].label, 'Old One');
  assert.deepEqual(loaded.entries[1].defaults, { foo: 0.5 });
});

test('save preserves tags + flags through a load→save→load cycle', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.save({
    name: 'cycle',
    tags: ['Show', 'finale'],
    entries: [{ id: 'a', pattern: '13_sparkle', hold: true, loop: true }],
  });
  const first = pm.load('cycle');
  // Re-save the loaded object verbatim (what the API POST does on edit).
  const resaved = pm.save(first);
  assert.deepEqual(resaved.tags, ['show', 'finale']);
  assert.equal(resaved.entries[0].hold, true);
  assert.equal(resaved.entries[0].loop, true);
  const second = pm.load('cycle');
  assert.deepEqual(second.tags, ['show', 'finale']);
  assert.equal(second.entries[0].hold, true);
  assert.equal(second.entries[0].loop, true);
});
