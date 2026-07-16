/**
 * scene_backup.test.js — contract tests for the pre-save snapshot + recovery
 * helpers (simulation/server/scene_backup.cjs).
 *
 * Exercises snapshot creation, burst coalescing, retention pruning, listing,
 * the restore round-trip (incl. the pre-restore safety snapshot), and
 * path-traversal validation. No HTTP server, no DOM — roots are injected as
 * temp dirs under ~/tmp (repo convention: scratch never touches the tree).
 * The module is CommonJS; ESM imports it via default import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sceneBackup from '../server/scene_backup.cjs';

const {
  filesForSave,
  filesForModel,
  snapshotBeforeWrite,
  listBackups,
  restoreBackup,
  MAX_BACKUPS,
} = sceneBackup;

// ── Temp fixture ───────────────────────────────────────────────────────────
// Honor the repo convention: scratch lives under ~/tmp, not the source tree.
const TMP_BASE = path.join(os.homedir(), 'tmp');

function makeRoots() {
  fs.mkdirSync(TMP_BASE, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_BASE, 'scene-backup-test-'));
  const roots = {
    scenesRoot: path.join(dir, 'scenes'),
    modelsRoot: path.join(dir, 'models'),
    backupsRoot: path.join(dir, '.scene_backups'),
  };
  return { dir, roots };
}

function seedScene(roots, scene, { config = 'v1', common = 'common-v1', model = 'model-v1' } = {}) {
  fs.mkdirSync(path.join(roots.scenesRoot, scene), { recursive: true });
  fs.mkdirSync(roots.modelsRoot, { recursive: true });
  fs.writeFileSync(path.join(roots.scenesRoot, scene, 'scene_config.yaml'), config);
  fs.writeFileSync(path.join(roots.scenesRoot, 'common.yaml'), common);
  fs.writeFileSync(path.join(roots.modelsRoot, `${scene}.js`), model);
}

function readManifest(roots, scene, id) {
  return JSON.parse(
    fs.readFileSync(path.join(roots.backupsRoot, scene, id, 'manifest.json'), 'utf8'),
  );
}

// ── Snapshot creation ───────────────────────────────────────────────────────

test('snapshotBeforeWrite creates a dir + manifest capturing existing files', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio');
    const id = snapshotBeforeWrite('studio', filesForSave('studio'), 'save', roots);

    assert.match(id, /^\d{8}_\d{6}_\d{3}$/);
    const snapDir = path.join(roots.backupsRoot, 'studio', id);
    assert.ok(fs.existsSync(path.join(snapDir, 'manifest.json')));

    const m = readManifest(roots, 'studio', id);
    assert.equal(m.scene, 'studio');
    assert.equal(m.trigger, 'save');
    assert.ok(typeof m.createdAt === 'string' && m.createdAt.length > 0);
    // Only the two files that exist on disk were captured; the not-yet-
    // existing patches/views/controllers were skipped.
    assert.deepEqual(
      [...m.files].sort(),
      ['scenes/common.yaml', 'scenes/studio/scene_config.yaml'],
    );
    // The backed-up bytes match the live file.
    assert.equal(
      fs.readFileSync(path.join(snapDir, 'scenes', 'studio', 'scene_config.yaml'), 'utf8'),
      'v1',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Burst coalescing ─────────────────────────────────────────────────────────

test('snapshotBeforeWrite coalesces a <10s burst, first-write-wins', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio', { model: 'model-v1' });
    // First model write in the burst.
    const id1 = snapshotBeforeWrite('studio', filesForModel('studio'), 'save-model', roots);
    // Mutate the model on disk, then add the effects file and re-snapshot the
    // model too — it must NOT be re-copied (first-write-wins), and both land
    // in the SAME dir.
    fs.writeFileSync(path.join(roots.modelsRoot, 'studio.js'), 'model-v2');
    fs.writeFileSync(path.join(roots.modelsRoot, 'studio.effects.js'), 'effects-v1');
    const id2 = snapshotBeforeWrite(
      'studio',
      [...filesForModel('studio'), ...filesForModel('studio', 'effects')],
      'save-model',
      roots,
    );

    assert.equal(id1, id2, 'burst writes coalesce into one snapshot dir');
    const snapDir = path.join(roots.backupsRoot, 'studio', id1);
    // First-write-wins: the model backup keeps the ORIGINAL v1 bytes.
    assert.equal(fs.readFileSync(path.join(snapDir, 'models', 'studio.js'), 'utf8'), 'model-v1');
    assert.equal(
      fs.readFileSync(path.join(snapDir, 'models', 'studio.effects.js'), 'utf8'),
      'effects-v1',
    );
    const m = readManifest(roots, 'studio', id1);
    assert.deepEqual([...m.files].sort(), ['models/studio.effects.js', 'models/studio.js']);
    // Exactly one snapshot dir exists for the scene.
    assert.equal(fs.readdirSync(path.join(roots.backupsRoot, 'studio')).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Retention prune ──────────────────────────────────────────────────────────

test('snapshotBeforeWrite prunes to the newest MAX_BACKUPS dirs', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio');
    // pre-restore always opens a fresh dir (never coalesces), so a tight loop
    // produces distinct snapshots we can count against the retention cap.
    const ids = [];
    for (let i = 0; i < MAX_BACKUPS + 5; i++) {
      ids.push(snapshotBeforeWrite('studio', filesForSave('studio'), 'pre-restore', roots));
    }
    const remaining = fs.readdirSync(path.join(roots.backupsRoot, 'studio')).sort();
    assert.equal(remaining.length, MAX_BACKUPS);
    // The newest MAX_BACKUPS ids survived; the oldest 5 were pruned.
    const keptNewest = ids.slice(-MAX_BACKUPS).sort();
    assert.deepEqual(remaining, keptNewest);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Listing ──────────────────────────────────────────────────────────────────

test('listBackups returns [] for a scene with no backups', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio');
    assert.deepEqual(listBackups('studio', roots), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listBackups returns snapshots newest-first with manifest fields', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio');
    const a = snapshotBeforeWrite('studio', filesForSave('studio'), 'pre-restore', roots);
    const b = snapshotBeforeWrite('studio', filesForSave('studio'), 'pre-restore', roots);
    const c = snapshotBeforeWrite('studio', filesForSave('studio'), 'pre-restore', roots);

    const list = listBackups('studio', roots);
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((e) => e.id), [c, b, a]); // newest-first
    for (const entry of list) {
      assert.equal(entry.trigger, 'pre-restore');
      assert.ok(Array.isArray(entry.files));
      assert.ok(typeof entry.createdAt === 'string');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Restore round-trip ───────────────────────────────────────────────────────

test('restoreBackup rolls files back and snapshots the pre-restore state', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio', { config: 'good-v1', common: 'common-v1' });
    // Back up the good state.
    const goodId = snapshotBeforeWrite('studio', filesForSave('studio'), 'save', roots);

    // Simulate a bad save clobbering the live files.
    fs.writeFileSync(path.join(roots.scenesRoot, 'studio', 'scene_config.yaml'), 'CORRUPT');
    fs.writeFileSync(path.join(roots.scenesRoot, 'common.yaml'), 'CORRUPT-common');

    const result = restoreBackup('studio', goodId, roots);

    // Live files match the good backup again.
    assert.equal(
      fs.readFileSync(path.join(roots.scenesRoot, 'studio', 'scene_config.yaml'), 'utf8'),
      'good-v1',
    );
    assert.equal(fs.readFileSync(path.join(roots.scenesRoot, 'common.yaml'), 'utf8'), 'common-v1');
    assert.deepEqual(
      [...result.restored].sort(),
      ['scenes/common.yaml', 'scenes/studio/scene_config.yaml'],
    );

    // The pre-restore snapshot captured the CORRUPT bytes so a wrong restore
    // is itself reversible.
    assert.match(result.preRestoreId, /^\d{8}_\d{6}_\d{3}$/);
    const preDir = path.join(roots.backupsRoot, 'studio', result.preRestoreId);
    assert.equal(
      fs.readFileSync(path.join(preDir, 'scenes', 'studio', 'scene_config.yaml'), 'utf8'),
      'CORRUPT',
    );
    assert.equal(readManifest(roots, 'studio', result.preRestoreId).trigger, 'pre-restore');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restoreBackup throws 404 for an unknown (well-formed) id', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio');
    assert.throws(
      () => restoreBackup('studio', '20250101_000000_000', roots),
      (err) => err.statusCode === 404,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Path-traversal validation ────────────────────────────────────────────────

test('snapshotBeforeWrite rejects an invalid scene name (no traversal)', () => {
  const { dir, roots } = makeRoots();
  try {
    assert.throws(
      () => snapshotBeforeWrite('../evil', filesForSave('../evil'), 'save', roots),
      /Invalid scene name/,
    );
    // Nothing escaped the backups root.
    assert.equal(fs.existsSync(roots.backupsRoot), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restoreBackup rejects traversal in scene name and id', () => {
  const { dir, roots } = makeRoots();
  try {
    seedScene(roots, 'studio');
    assert.throws(
      () => restoreBackup('../evil', '20250101_000000_000', roots),
      (err) => err.statusCode === 400,
    );
    // A crafted id that tries to climb out of the scene dir is rejected by the
    // grammar, never used as a path.
    assert.throws(
      () => restoreBackup('studio', '20250101_000000_000/../..', roots),
      (err) => err.statusCode === 400,
    );
    assert.throws(
      () => restoreBackup('studio', '../x', roots),
      (err) => err.statusCode === 400,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
