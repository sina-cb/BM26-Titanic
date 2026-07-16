/**
 * scene_duplicate.test.js — pure-logic contract tests for the save-server's
 * /scene/duplicate helpers (simulation/server/scene_duplicate.cjs).
 *
 * Exercises name validation, manifest insertion, self-reference rewriting,
 * and the atomic recursive copy (including partial-copy cleanup). No HTTP
 * server, no DOM. The module is CommonJS; ESM imports it via default import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sceneDuplicate from '../server/scene_duplicate.cjs';

const {
  isValidSceneName,
  updateManifest,
  rewriteSelfReferences,
  duplicateSceneDir,
} = sceneDuplicate;

// ── Name validation ──────────────────────────────────────────────────────

test('isValidSceneName accepts snake_case, hyphens and digits', () => {
  assert.equal(isValidSceneName('bow_deck'), true);
  assert.equal(isValidSceneName('titanic'), true);
  assert.equal(isValidSceneName('scene-2'), true);
  assert.equal(isValidSceneName('a'), true);
  assert.equal(isValidSceneName('9lives'), true);
});

test('isValidSceneName rejects path traversal, spaces and empties', () => {
  assert.equal(isValidSceneName('../titanic'), false);
  assert.equal(isValidSceneName('foo/bar'), false);
  assert.equal(isValidSceneName('foo bar'), false);
  assert.equal(isValidSceneName('_leading'), false);
  assert.equal(isValidSceneName('-leading'), false);
  assert.equal(isValidSceneName(''), false);
  assert.equal(isValidSceneName('.'), false);
  assert.equal(isValidSceneName('foo.bar'), false);
  assert.equal(isValidSceneName(null), false);
  assert.equal(isValidSceneName(42), false);
});

// ── Manifest insertion ───────────────────────────────────────────────────

test('updateManifest inserts and keeps the list sorted', () => {
  const before = ['studio_top_loft', 'test_bench', 'titanic'];
  const after = updateManifest(before, 'bow_deck');
  assert.deepEqual(after, ['bow_deck', 'studio_top_loft', 'test_bench', 'titanic']);
});

test('updateManifest does not mutate the input array', () => {
  const before = ['titanic'];
  const after = updateManifest(before, 'bow_deck');
  assert.deepEqual(before, ['titanic']);
  assert.notEqual(after, before);
});

test('updateManifest de-duplicates an already-present name', () => {
  const before = ['titanic', 'test_bench'];
  const after = updateManifest(before, 'titanic');
  assert.deepEqual(after, ['test_bench', 'titanic']);
});

test('updateManifest rejects an invalid new name', () => {
  assert.throws(() => updateManifest(['titanic'], '../evil'), /Invalid scene name/);
});

test('updateManifest rejects a non-array scenes argument', () => {
  assert.throws(() => updateManifest('titanic', 'bow_deck'), TypeError);
});

// ── Self-reference rewriting ─────────────────────────────────────────────

test('rewriteSelfReferences rewrites a bare standalone token', () => {
  const src = 'scene: titanic\nlabel: The titanic hull';
  const out = rewriteSelfReferences(src, 'titanic', 'titanic_copy');
  assert.equal(out, 'scene: titanic_copy\nlabel: The titanic_copy hull');
});

test('rewriteSelfReferences leaves pattern-name substrings intact', () => {
  // The real scenes/ tree only mentions "titanic" inside PATTERN tokens
  // like 48_titanic_sos_beacon — those must be preserved verbatim.
  const src = 'pattern: 48_titanic_sos_beacon\nid: e_default_43_48_titanic_sos_beacon';
  const out = rewriteSelfReferences(src, 'titanic', 'titanic_copy');
  assert.equal(out, src);
});

test('rewriteSelfReferences is a no-op when names are equal', () => {
  const src = 'scene: titanic';
  assert.equal(rewriteSelfReferences(src, 'titanic', 'titanic'), src);
});

test('rewriteSelfReferences handles start-of-string and adjacency', () => {
  assert.equal(rewriteSelfReferences('titanic', 'titanic', 'foo'), 'foo');
  // Trailing identifier char blocks the rewrite (substring guard).
  assert.equal(rewriteSelfReferences('titanicX', 'titanic', 'foo'), 'titanicX');
  assert.equal(rewriteSelfReferences('Xtitanic', 'titanic', 'foo'), 'Xtitanic');
});

// ── Recursive copy + cleanup ─────────────────────────────────────────────

function makeTmpScenesRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-dup-test-'));
  const src = path.join(root, 'titanic');
  fs.mkdirSync(path.join(src, 'playlists'), { recursive: true });
  fs.writeFileSync(path.join(src, 'scene_config.yaml'), 'scene: titanic\nfoo: 1\n');
  fs.writeFileSync(path.join(src, 'cameras.yaml'), '# titanic cameras\n');
  fs.writeFileSync(
    path.join(src, 'playlists', 'default.yaml'),
    'pattern: 48_titanic_sos_beacon\n',
  );
  return { root, src };
}

test('duplicateSceneDir copies the full tree and rewrites self-refs', () => {
  const { root, src } = makeTmpScenesRoot();
  try {
    const dest = path.join(root, 'titanic_copy');
    duplicateSceneDir(src, dest, 'titanic', 'titanic_copy');

    // Structural copy: nested files present.
    assert.ok(fs.existsSync(path.join(dest, 'scene_config.yaml')));
    assert.ok(fs.existsSync(path.join(dest, 'playlists', 'default.yaml')));

    // Bare self-reference rewritten...
    assert.match(
      fs.readFileSync(path.join(dest, 'scene_config.yaml'), 'utf8'),
      /scene: titanic_copy/,
    );
    // ...but the pattern token is preserved.
    assert.equal(
      fs.readFileSync(path.join(dest, 'playlists', 'default.yaml'), 'utf8'),
      'pattern: 48_titanic_sos_beacon\n',
    );

    // Source is untouched.
    assert.match(
      fs.readFileSync(path.join(src, 'scene_config.yaml'), 'utf8'),
      /scene: titanic\n/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicateSceneDir refuses when the destination already exists', () => {
  const { root, src } = makeTmpScenesRoot();
  try {
    const dest = path.join(root, 'titanic_copy');
    fs.mkdirSync(dest);
    assert.throws(
      () => duplicateSceneDir(src, dest, 'titanic', 'titanic_copy'),
      /already exists/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicateSceneDir refuses when the source is missing', () => {
  const { root } = makeTmpScenesRoot();
  try {
    const missing = path.join(root, 'nope');
    const dest = path.join(root, 'titanic_copy');
    assert.throws(
      () => duplicateSceneDir(missing, dest, 'nope', 'titanic_copy'),
      /not found/,
    );
    assert.equal(fs.existsSync(dest), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicateSceneDir cleans up a partial copy when rewrite fails', () => {
  const { root, src } = makeTmpScenesRoot();
  try {
    const dest = path.join(root, 'titanic_copy');
    // Force the post-copy rewrite step to throw by passing an invalid new
    // name (rewriteSelfReferences validates its names). The copy will have
    // already landed on disk; duplicateSceneDir must remove it before
    // rethrowing so no half-scene lingers.
    assert.throws(
      () => duplicateSceneDir(src, dest, 'titanic', '../evil'),
      /valid scene names|Invalid/,
    );
    assert.equal(fs.existsSync(dest), false, 'partial copy must be cleaned up');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
