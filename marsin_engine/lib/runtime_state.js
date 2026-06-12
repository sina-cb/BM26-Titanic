import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_ROOT = path.join(__dirname, '..');

/**
 * Runtime/defaults split for the engine's per-model YAML state
 * (docs: .agent/02_reports/202606/20260612_2_runtime_config_separation_plan.md).
 *
 * Layout:
 *   marsin_engine/state_defaults/<model>/   tracked defaults — read-only
 *                                           at runtime, the git-reviewed
 *                                           "show state" (incl. playlists/)
 *   marsin_engine/states/<model>/           gitignored runtime cache —
 *                                           every live write lands here
 *                                           and survives engine restarts
 *
 * Boot seeds the runtime per-file from defaults (existing runtime files
 * are NEVER overwritten — that's the cache contract). Promote mirrors
 * runtime → defaults so the operator's current live state becomes the
 * new tracked defaults; the resulting git diff is the review artifact.
 * Reset mirrors defaults → runtime (restart required to re-apply).
 *
 * All paths are anchored to this module's location, never the cwd —
 * running the engine from the repo root used to spray a stray
 * /states/ directory at the top of the repo.
 */

export function stateDefaultsDir(modelName) {
  return path.join(ENGINE_ROOT, 'state_defaults', modelName);
}

export function runtimeStateDir(modelName) {
  return path.join(ENGINE_ROOT, 'states', modelName);
}

// Recursive *.yaml inventory as paths relative to `root`. Skips the
// atomic-write residue (`*.tmp-*`) that a crash mid-rename can leave.
function listYamlFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.name.endsWith('.yaml') && !entry.name.includes('.tmp-')) {
        out.push(childRel);
      }
    }
  };
  walk('');
  return out.sort();
}

// Write-tmp-then-rename so a crash mid-write can't leave a torn YAML
// behind (same pattern as scheduled_tasks.js / audio_config_store.js).
// The `.tmp-<pid>` suffix matches the repo-wide `*.tmp-*` gitignore.
function writeFileAtomic(targetPath, contents) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, targetPath);
}

/**
 * Seed the runtime dir from the tracked defaults: copy every defaults
 * file the runtime is missing. Per-file (not dir-exists) so a default
 * added later still lands in an existing runtime cache. Existing
 * runtime files are never touched. Returns the seeded relative paths.
 */
export function seedRuntimeState(modelName) {
  const defaults = stateDefaultsDir(modelName);
  const runtime = runtimeStateDir(modelName);
  const seeded = [];
  for (const rel of listYamlFiles(defaults)) {
    const dst = path.join(runtime, rel);
    if (fs.existsSync(dst)) continue;
    writeFileAtomic(dst, fs.readFileSync(path.join(defaults, rel)));
    seeded.push(rel);
  }
  return seeded;
}

/**
 * Compare runtime vs defaults. Returns
 *   { model, files: [{ file, inRuntime, inDefaults, differs }], dirty }
 * where `dirty` is true when a promote would change the tracked
 * defaults in any way. CaptainPad renders this as the "runtime differs
 * from defaults" status in the CONFIG tab.
 */
export function runtimeStateStatus(modelName) {
  const defaults = stateDefaultsDir(modelName);
  const runtime = runtimeStateDir(modelName);
  const defaultFiles = listYamlFiles(defaults);
  const runtimeFiles = listYamlFiles(runtime);
  const union = [...new Set([...defaultFiles, ...runtimeFiles])].sort();
  const files = union.map(rel => {
    const inDefaults = defaultFiles.includes(rel);
    const inRuntime = runtimeFiles.includes(rel);
    const differs = inDefaults && inRuntime
      && !fs.readFileSync(path.join(defaults, rel)).equals(fs.readFileSync(path.join(runtime, rel)));
    return { file: rel, inRuntime, inDefaults, differs };
  });
  return {
    model: modelName,
    files,
    dirty: files.some(f => f.differs || !f.inDefaults || !f.inRuntime),
  };
}

/**
 * Promote: mirror the runtime state onto the tracked defaults. Copies
 * every runtime file over (atomic per file) and REMOVES defaults files
 * that no longer exist in the runtime — without the removal half, a
 * playlist deleted mid-show would resurrect at the next boot's seed.
 * Throws on any filesystem error (codex P0: fail loudly, no half-done
 * promote reported as success). Returns { written, removed, unchanged }.
 */
export function promoteRuntimeState(modelName) {
  const defaults = stateDefaultsDir(modelName);
  const runtime = runtimeStateDir(modelName);
  if (!fs.existsSync(runtime)) {
    throw new Error(`No runtime state to promote for model '${modelName}' (${runtime} missing)`);
  }
  return mirrorYamlTree(runtime, defaults);
}

/**
 * Reset: mirror the tracked defaults back onto the runtime. The engine
 * keeps running on its in-memory state — the caller must surface
 * `restartRequired` so the operator knows the files only take effect
 * on the next boot. Returns { written, removed, unchanged }.
 */
export function resetRuntimeState(modelName) {
  const defaults = stateDefaultsDir(modelName);
  const runtime = runtimeStateDir(modelName);
  if (!fs.existsSync(defaults)) {
    throw new Error(`No tracked defaults to reset from for model '${modelName}' (${defaults} missing)`);
  }
  return mirrorYamlTree(defaults, runtime);
}

function mirrorYamlTree(srcRoot, dstRoot) {
  const srcFiles = listYamlFiles(srcRoot);
  const dstFiles = listYamlFiles(dstRoot);
  const written = [];
  const unchanged = [];
  for (const rel of srcFiles) {
    const srcBuf = fs.readFileSync(path.join(srcRoot, rel));
    const dstPath = path.join(dstRoot, rel);
    if (fs.existsSync(dstPath) && srcBuf.equals(fs.readFileSync(dstPath))) {
      unchanged.push(rel);
      continue;
    }
    writeFileAtomic(dstPath, srcBuf);
    written.push(rel);
  }
  const removed = [];
  for (const rel of dstFiles) {
    if (srcFiles.includes(rel)) continue;
    fs.unlinkSync(path.join(dstRoot, rel));
    removed.push(rel);
  }
  return { written, removed, unchanged };
}
