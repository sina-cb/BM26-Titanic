/**
 * scene_backup.cjs — pre-save snapshots + recovery for scene state.
 *
 * Every save-server write (/save, /save-cameras, /save-model) can silently
 * clobber good on-disk state — a bad autosave, a botched export, a crash
 * mid-edit. This module snapshots the exact files a write is about to
 * overwrite BEFORE the overwrite lands, so the operator can roll any scene
 * back to a known-good point from the in-sim "Recover scene" UI.
 *
 * Kept in its own CommonJS module (like scene_duplicate.cjs) so the pure
 * filesystem logic can be unit-tested without standing up the HTTP server.
 * The Node test runner imports it via an ESM default import (ESM can
 * require CJS).
 *
 * Backups live in the gitignored simulation/.scene_backups/<scene>/<id>/
 * tree. <id> is a local-time stamp `YYYYMMDD_HHMMSS_mmm`. Inside each id
 * dir: manifest.json {scene, createdAt, trigger, files[]} plus the backed-up
 * files mirrored under their repo-relative paths (scenes/<scene>/*.yaml,
 * scenes/common.yaml, models/<scene>*.js).
 *
 * Codex P0: fail loud, never write live state without a backup. If a
 * snapshot cannot be taken the caller must abort the save (HTTP 500), not
 * proceed. Scene names and backup ids are VALIDATED against a strict
 * grammar and REJECTED (never sanitized) — a raw request value must never
 * become a path segment (path-traversal defense).
 */

const fs = require('fs');
const path = require('path');

const { isValidSceneName } = require('./scene_duplicate.cjs');

// A backup id is a fixed-width local-time stamp. Fixed width means a plain
// lexical sort is chronological. Validated on the way in from /restore-backup
// so a crafted id (e.g. "20250101_000000_000/../..") can never escape the
// scene's backup dir.
const BACKUP_ID_RE = /^\d{8}_\d{6}_\d{3}$/;

// Reuse the newest snapshot dir if it is younger than this — a burst of
// writes (the three-file model export, or an autosave landing next to it)
// coalesces into ONE snapshot instead of three near-identical ones.
const COALESCE_WINDOW_MS = 10_000;

// Keep at most this many snapshot dirs per scene; prune the oldest after
// every snapshot so .scene_backups never grows without bound.
const MAX_BACKUPS = 20;

// The triggers a snapshot can be tagged with. pre-restore always gets a
// fresh dir (it must never coalesce into the snapshot it is about to
// overwrite from).
const VALID_TRIGGERS = new Set(['save', 'save-cameras', 'save-model', 'pre-restore']);

// ── Roots ────────────────────────────────────────────────────────────────
// Derived from this file's location (server/ lives under the simulation
// root), exactly like save-server.js resolves its own paths. Injectable via
// a trailing `roots` arg on the public functions so the unit tests can point
// everything at a temp dir.
function deriveRoots(simRoot) {
  return {
    scenesRoot: path.join(simRoot, 'scenes'),
    modelsRoot: path.join(simRoot, '..', 'marsin_engine', 'models'),
    backupsRoot: path.join(simRoot, '.scene_backups'),
  };
}

const DEFAULT_ROOTS = deriveRoots(path.join(__dirname, '..'));

// Atomic + durable write: write to a sibling temp file, fsync it, then
// rename over the target. A crash mid-write can no longer leave a truncated
// yaml/model/manifest behind. This is the ONE definition in the codebase —
// save-server.js imports it from here rather than keeping its own copy.
function writeFileAtomic(targetPath, contents) {
  const tmpPath = `${targetPath}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, contents);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

// ── id <-> Date (local time) ───────────────────────────────────────────────
function _pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function generateId(date) {
  return `${date.getFullYear()}${_pad(date.getMonth() + 1)}${_pad(date.getDate())}_` +
    `${_pad(date.getHours())}${_pad(date.getMinutes())}${_pad(date.getSeconds())}_` +
    `${_pad(date.getMilliseconds(), 3)}`;
}

function parseId(id) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})$/.exec(id);
  if (!m) throw new Error(`Malformed backup id: ${JSON.stringify(id)}`);
  const [, y, mo, d, h, mi, s, ms] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s, ms);
}

// ── Path mapping ───────────────────────────────────────────────────────────
// A backup-relative path ("scenes/<scene>/scene_config.yaml", "models/x.js")
// maps to a live absolute path under the injected roots. Reject any '..'
// segment — the callers only ever build these from a validated scene name +
// fixed filenames, but this is defense in depth against a crafted rel path.
function livePathForRel(roots, rel) {
  const parts = rel.split('/');
  if (parts.includes('..') || parts.includes('')) {
    throw new Error(`Unsafe backup-relative path: ${JSON.stringify(rel)}`);
  }
  if (parts[0] === 'scenes') return path.join(roots.scenesRoot, ...parts.slice(1));
  if (parts[0] === 'models') return path.join(roots.modelsRoot, ...parts.slice(1));
  throw new Error(`Unknown backup-relative root in ${JSON.stringify(rel)}`);
}

// ── File lists per write type ──────────────────────────────────────────────
// The exact files each save-server endpoint may overwrite. Over-inclusive is
// safe (a not-yet-existing file is skipped at snapshot time); missing a file
// is NOT — it would let an overwrite escape the backup.
function filesForSave(scene) {
  return [
    `scenes/${scene}/scene_config.yaml`,
    `scenes/${scene}/patches.yaml`,
    `scenes/${scene}/views.yaml`,
    `scenes/${scene}/controllers.yaml`,
    'scenes/common.yaml',
  ];
}

function filesForCameras(scene) {
  return [`scenes/${scene}/cameras.yaml`];
}

function filesForModel(scene, type) {
  const suffix = type === 'effects' ? '.effects.js'
    : type === 'viewmasks' ? '.viewmasks.js'
    : '.js';
  return [`models/${scene}${suffix}`];
}

// ── Backup dir discovery / pruning ─────────────────────────────────────────
function _sceneBackupDir(roots, scene) {
  return path.join(roots.backupsRoot, scene);
}

function _listIdDirs(roots, scene) {
  const dir = _sceneBackupDir(roots, scene);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && BACKUP_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort(); // fixed-width ids → lexical sort is chronological (oldest first)
}

function newestBackupId(roots, scene) {
  const ids = _listIdDirs(roots, scene);
  return ids.length ? ids[ids.length - 1] : null;
}

// Pick a free fresh id at "now"; bump by 1ms on the (rare) same-millisecond
// collision so pre-restore always lands in its own dir.
function freshId(roots, scene) {
  const dir = _sceneBackupDir(roots, scene);
  let d = new Date();
  let id = generateId(d);
  while (fs.existsSync(path.join(dir, id))) {
    d = new Date(d.getTime() + 1);
    id = generateId(d);
  }
  return id;
}

function pruneBackups(scene, roots = DEFAULT_ROOTS) {
  const ids = _listIdDirs(roots, scene);
  const excess = ids.length - MAX_BACKUPS;
  const dir = _sceneBackupDir(roots, scene);
  for (let i = 0; i < excess; i++) {
    fs.rmSync(path.join(dir, ids[i]), { recursive: true, force: true });
  }
}

// ── Snapshot ───────────────────────────────────────────────────────────────
/**
 * Copy the current on-disk versions of `fileList` into a snapshot dir BEFORE
 * the caller overwrites them. Files that do not yet exist are skipped. On any
 * failure this THROWS so the caller aborts the save (codex P0: never write
 * live state without a backup).
 *
 * Burst coalescing: unless `trigger` is 'pre-restore', reuse the scene's
 * newest snapshot dir if it is younger than COALESCE_WINDOW_MS, adding only
 * files not already captured there (first-write-wins). pre-restore always
 * gets a fresh dir.
 *
 * @returns {string} the snapshot id (dir name)
 */
function snapshotBeforeWrite(scene, fileList, trigger, roots = DEFAULT_ROOTS) {
  if (!isValidSceneName(scene)) {
    throw new Error(`Invalid scene name: ${JSON.stringify(scene)}`);
  }
  if (!VALID_TRIGGERS.has(trigger)) {
    throw new Error(`Invalid backup trigger: ${JSON.stringify(trigger)}`);
  }
  const sceneDir = _sceneBackupDir(roots, scene);

  // Decide the target dir: coalesce into the newest recent one, or open a
  // fresh one. pre-restore never coalesces.
  let id = null;
  if (trigger !== 'pre-restore') {
    const newest = newestBackupId(roots, scene);
    if (newest && (Date.now() - parseId(newest).getTime()) < COALESCE_WINDOW_MS) {
      id = newest;
    }
  }
  if (!id) {
    id = freshId(roots, scene);
    fs.mkdirSync(path.join(sceneDir, id), { recursive: true });
  }
  const targetDir = path.join(sceneDir, id);

  // Load or initialize the manifest. When coalescing we keep the original
  // createdAt/trigger and only grow the files[] union.
  const manifestPath = path.join(targetDir, 'manifest.json');
  let manifest;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.files)) manifest.files = [];
  } else {
    manifest = { scene, createdAt: new Date().toISOString(), trigger, files: [] };
  }
  const captured = new Set(manifest.files);

  for (const rel of fileList) {
    if (captured.has(rel)) continue; // first-write-wins across a burst
    const live = livePathForRel(roots, rel);
    if (!fs.existsSync(live)) continue; // not-yet-existing → nothing to back up
    const dest = path.join(targetDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    writeFileAtomic(dest, fs.readFileSync(live));
    manifest.files.push(rel);
    captured.add(rel);
  }

  writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  pruneBackups(scene, roots);
  return id;
}

// ── List ───────────────────────────────────────────────────────────────────
/**
 * List a scene's snapshots, newest-first. Returns [] when the scene has no
 * backup dir yet. Dirs without a readable manifest are skipped (logged).
 *
 * @returns {Array<{id:string, createdAt:string, trigger:string, files:string[]}>}
 */
function listBackups(scene, roots = DEFAULT_ROOTS) {
  if (!isValidSceneName(scene)) {
    throw new Error(`Invalid scene name: ${JSON.stringify(scene)}`);
  }
  const out = [];
  for (const id of _listIdDirs(roots, scene)) {
    const manifestPath = path.join(_sceneBackupDir(roots, scene), id, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let m;
    try {
      m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      console.error(`[scene_backup] Skipping bad manifest ${manifestPath}: ${err.message}`);
      continue;
    }
    out.push({ id, createdAt: m.createdAt, trigger: m.trigger, files: m.files || [] });
  }
  // _listIdDirs returns oldest-first; reverse for newest-first.
  out.reverse();
  return out;
}

// ── Restore ─────────────────────────────────────────────────────────────────
/**
 * Restore a scene to a given snapshot. Validates the id grammar (rejects,
 * never sanitizes), snapshots the CURRENT live versions of the backed-up
 * files first (a 'pre-restore' backup, always its own dir — so a restore is
 * itself reversible), then atomically writes the backed-up bytes over the
 * live paths.
 *
 * Throws with err.statusCode 400 on a bad id and 404 on a missing snapshot
 * dir so the HTTP layer can map them.
 *
 * @returns {{restored: string[], preRestoreId: string}}
 */
function restoreBackup(scene, id, roots = DEFAULT_ROOTS) {
  if (!isValidSceneName(scene)) {
    const err = new Error(`Invalid scene name: ${JSON.stringify(scene)}`);
    err.statusCode = 400;
    throw err;
  }
  if (typeof id !== 'string' || !BACKUP_ID_RE.test(id)) {
    const err = new Error(`Invalid backup id: ${JSON.stringify(id)}`);
    err.statusCode = 400;
    throw err;
  }
  const backupDir = path.join(_sceneBackupDir(roots, scene), id);
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const err = new Error(`Backup not found: ${scene}/${id}`);
    err.statusCode = 404;
    throw err;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];

  // Back up the current live state of exactly these files BEFORE overwriting,
  // so a wrong-restore is recoverable too.
  const preRestoreId = snapshotBeforeWrite(scene, files, 'pre-restore', roots);

  const restored = [];
  for (const rel of files) {
    const src = path.join(backupDir, ...rel.split('/'));
    if (!fs.existsSync(src)) continue; // manifest lists it but bytes are gone
    const live = livePathForRel(roots, rel);
    fs.mkdirSync(path.dirname(live), { recursive: true });
    writeFileAtomic(live, fs.readFileSync(src));
    restored.push(rel);
  }
  return { restored, preRestoreId };
}

module.exports = {
  BACKUP_ID_RE,
  COALESCE_WINDOW_MS,
  MAX_BACKUPS,
  deriveRoots,
  writeFileAtomic,
  generateId,
  parseId,
  filesForSave,
  filesForCameras,
  filesForModel,
  snapshotBeforeWrite,
  listBackups,
  restoreBackup,
  pruneBackups,
};
