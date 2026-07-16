import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ── Named mixer snapshots / look recall (F-A) ───────────────────────────
//
// A "snapshot" (a.k.a. a saved "look") is the FULL mixer state at a moment
// in time: the grand-master value plus every channel's serialized core
// (id / name / pattern / fader / faderMax / color / mode / enabled / locked
// / faderLocked / viewSelection / playlist+activeEntry). The deck channel
// and every mixer overlay are captured so a recall reproduces the exact
// layered show the operator saved.
//
// Snapshots persist as YAML in `<stateDir>/snapshots/<name>.yaml`, written
// through the SAME atomic temp+fsync+rename writer the playlist / state
// managers use (via StateManager.writeFileAtomic) so a crash mid-save can
// never leave a torn snapshot on disk.
//
// Codex P0 (fail loud, no silent fallback): a malformed snapshot file
// (corrupt YAML, or a structurally-wrong payload) throws SnapshotLoadError
// rather than degrading to an empty/partial look — mirrors PlaylistLoadError.
// A missing snapshot on load returns null so the caller can 404.

const VALID_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Thrown when a snapshot file EXISTS but its YAML is corrupt or its shape
// is structurally invalid. Distinguishing "corrupt" from "missing" is a
// Codex P0 concern — a corrupt file must never look like an absent one.
// HTTP callers translate this into a 400 carrying `.code`.
export class SnapshotLoadError extends Error {
  constructor(message, { name, cause } = {}) {
    super(message);
    this.name = 'SnapshotLoadError';
    this.code = 'SNAPSHOT_MALFORMED';
    this.snapshotName = name;
    if (cause) this.cause = cause;
  }
}

export class SnapshotManager {
  /**
   * @param {string} stateDir       the model's state directory (the same
   *                                 dir StateManager owns). Snapshots live
   *                                 in a `snapshots/` subdirectory of it.
   * @param {StateManager} stateManager used for its atomic write helper so
   *                                 snapshots share the torn-write guarantee.
   */
  constructor(stateDir, stateManager) {
    if (!stateDir) throw new Error('SnapshotManager: stateDir is required');
    if (!stateManager || typeof stateManager.writeFileAtomic !== 'function') {
      throw new Error('SnapshotManager: a StateManager with writeFileAtomic() is required');
    }
    this.snapshotsDir = path.join(stateDir, 'snapshots');
    this.stateManager = stateManager;
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  // Normalize + validate a snapshot name. snake_case-friendly slug; rejects
  // path traversal and anything that wouldn't make a safe filename. Throws
  // on a bad name so the API layer 400s instead of writing junk.
  _safeName(name) {
    if (typeof name !== 'string' || !VALID_NAME.test(name)) {
      throw new Error(
        `Invalid snapshot name '${name}': must match ${VALID_NAME} ` +
        '(lowercase letters, digits, _ and -, 1-64 chars)');
    }
    return name;
  }

  _filePath(name) {
    return path.join(this.snapshotsDir, `${this._safeName(name)}.yaml`);
  }

  /** List saved snapshot names (sorted), reading the snapshots directory. */
  list() {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    return fs.readdirSync(this.snapshotsDir)
      .filter(f => f.endsWith('.yaml') && !f.startsWith('.'))
      .map(f => f.slice(0, -'.yaml'.length))
      .sort();
  }

  /** True iff a snapshot with this name exists on disk. */
  has(name) {
    return fs.existsSync(this._filePath(name));
  }

  /**
   * Save (or overwrite) a named snapshot. `look` is the captured shape
   * `{ master, masterFade?, deck, channels, mixGroups }` produced by the API
   * layer (it owns serializeChannel). Stamps `name` + `savedAt` and writes
   * atomically. Returns the on-disk shape.
   */
  save(name, look) {
    const safe = this._safeName(name);
    if (!look || typeof look !== 'object') {
      throw new Error(`SnapshotManager.save: look payload must be an object`);
    }
    const out = {
      name: safe,
      savedAt: new Date().toISOString(),
      master: typeof look.master === 'number' ? look.master : 1.0,
      // The deck channel (singleton) and the overlay stack. Either may be
      // null / empty (a rig with no deck or no overlays is still a valid
      // look to capture).
      deck: look.deck || null,
      channels: Array.isArray(look.channels) ? look.channels : [],
      // WAVE 15: the gang-fader GROUP registry. Persisted so a recalled look
      // reproduces the groups (faders + membership), not just the per-channel
      // mixGroupId pointers — without this the saved channels point at groups
      // that no longer exist on recall and the gang-faders vanish. Empty array
      // when the look has no groups (or an older capture omitted them).
      mixGroups: Array.isArray(look.mixGroups) ? look.mixGroups : [],
      // PERFORMANCE MODE: the globals bucket (shared ParamCenter params +
      // effects/dimmers/blackout/invert/group-colors) captured on mode ENTRY
      // so EXIT/restore can put the whole rig back, not just the mixer look.
      // Additive + optional — a normal mixer snapshot omits it (null), and
      // load() passes it through untouched, so this stays backward compatible
      // with every pre-existing on-disk snapshot.
      globals: (look.globals && typeof look.globals === 'object') ? look.globals : null,
    };
    this.stateManager.writeFileAtomic(this._filePath(safe), yaml.dump(out));
    return out;
  }

  /**
   * Load a named snapshot. Returns the parsed look object, or null when the
   * file does not exist (caller 404s). Throws SnapshotLoadError when the
   * file exists but is corrupt or structurally invalid (caller 400s) —
   * never a silent empty look.
   */
  load(name) {
    const filePath = this._filePath(name);
    if (!fs.existsSync(filePath)) return null;
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      throw new SnapshotLoadError(
        `Snapshot '${name}' is corrupt: ${err.message}`,
        { name, cause: err });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SnapshotLoadError(
        `Snapshot '${name}' has an invalid shape (expected an object)`,
        { name });
    }
    if (!Array.isArray(raw.channels)) {
      throw new SnapshotLoadError(
        `Snapshot '${name}' is missing a 'channels' array`,
        { name });
    }
    if (raw.master !== undefined &&
        (typeof raw.master !== 'number' || !Number.isFinite(raw.master))) {
      throw new SnapshotLoadError(
        `Snapshot '${name}' has a non-finite 'master' value`,
        { name });
    }
    return raw;
  }

  /** Delete a named snapshot. Returns true iff a file was removed. */
  delete(name) {
    const filePath = this._filePath(name);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }
}
