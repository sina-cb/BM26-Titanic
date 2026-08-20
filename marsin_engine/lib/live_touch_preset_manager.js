import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ── Live Touch preset playlist (docs/70 W4, item 3) ─────────────────────
//
// One ordered playlist of Live Touch presets, PER SCENE, engine-side,
// server-authoritative. Unlike ParamPresetManager (one file per preset,
// filename-alphabetical order, no rename/reorder) and SnapshotManager (one
// file per named look), this store is a SINGLE file holding an explicitly
// ordered `entries` array — docs/70 §5.2's contract shape:
//
//   { schemaVersion: 1, entries: [ { id, name, capturedAt, state: {...} } ] }
//
// `state` is an OPAQUE blob owned by the Live Touch panel (palette, scheme,
// follow-note, groups, fx, spatial block, mode, background selection, main
// colour config — whatever the panel's capture set covers this wave). The
// engine stores and returns it byte-for-byte. It never interprets,
// validates the interior of, or migrates it — that is deliberately the
// panel's concern, not this manager's. We DO validate the outer envelope
// (id/name/capturedAt are strings, state is present) the same way
// SnapshotManager validates `channels` is an array without reaching inside
// each channel's fields.
//
// Home: `<stateDir>/live_touch_presets.yaml` — a third sibling of
// `snapshots/` and `param_presets/` under `states/<scene>/`. Every mutation
// is a WHOLE-FILE write through StateManager.writeFileAtomic (the same
// temp+fsync+rename writer snapshots/param-presets use), so a crash mid-
// save can never leave a torn store on disk.
//
// autoSave-INDEPENDENT (codex P0 / docs/70 §5.2): this manager never routes
// through saveAllState. It writes directly on every create/rename/delete/
// reorder, unconditionally — the live titanic scene runs `autoSave:false`,
// so anything gated behind saveAllState would silently never persist.
//
// Fail LOUD on a bad store (codex P0 — no fallback behaviours): a missing
// file is the ONE benign case (first run — never saved a preset yet) and
// returns an empty playlist. An UNREADABLE or malformed file throws
// LiveTouchPresetStoreError — never a silent empty list. The API layer
// translates that into a 400 carrying `.code`.

const VALID_NAME_ARG = (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 128;

// Thrown ONLY when the store file EXISTS but is corrupt YAML or
// structurally invalid — never for a caller's bad argument (that's a plain
// Error, below). Distinguishing "corrupt" from "missing" is the Codex P0
// concern here — a corrupt file must never look like an absent one, and a
// bad-argument 400 must never be confused with a corrupt-store 400 (the API
// layer keys its error `.code` off `instanceof LiveTouchPresetStoreError`).
export class LiveTouchPresetStoreError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'LiveTouchPresetStoreError';
    this.code = 'LIVE_TOUCH_PRESET_STORE_MALFORMED';
    if (cause) this.cause = cause;
  }
}

const SCHEMA_VERSION = 1;

export class LiveTouchPresetManager {
  /**
   * @param {string} stateDir        the scene's state directory (the same
   *                                  dir StateManager owns). The store file
   *                                  lives directly in it.
   * @param {StateManager} stateManager used for its atomic write helper so
   *                                  this store shares the torn-write
   *                                  guarantee snapshots/param-presets have.
   */
  constructor(stateDir, stateManager) {
    if (!stateDir) throw new Error('LiveTouchPresetManager: stateDir is required');
    if (!stateManager || typeof stateManager.writeFileAtomic !== 'function') {
      throw new Error('LiveTouchPresetManager: a StateManager with writeFileAtomic() is required');
    }
    this.filePath = path.join(stateDir, 'live_touch_presets.yaml');
    this.stateManager = stateManager;
    // Per-instance monotonic counter so two creates landing in the same
    // millisecond still mint distinct ids.
    this._idCounter = 0;
  }

  _mintId() {
    this._idCounter += 1;
    return `ltp_${Date.now()}_${this._idCounter}`;
  }

  /**
   * Internal load: returns the parsed, validated store object
   * `{ schemaVersion, entries }`. A MISSING file is the one benign case —
   * returns a fresh empty store, no error. An existing-but-corrupt or
   * structurally-invalid file throws LiveTouchPresetStoreError.
   */
  _load() {
    if (!fs.existsSync(this.filePath)) {
      return { schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      throw new LiveTouchPresetStoreError(
        `Live Touch preset store is corrupt: ${err.message}`, { cause: err });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LiveTouchPresetStoreError(
        'Live Touch preset store has an invalid shape (expected an object)');
    }
    if (!Array.isArray(raw.entries)) {
      throw new LiveTouchPresetStoreError(
        "Live Touch preset store is missing an 'entries' array");
    }
    raw.entries.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new LiveTouchPresetStoreError(
          `Live Touch preset store entry #${i} is not an object`);
      }
      if (typeof entry.id !== 'string' || entry.id === '') {
        throw new LiveTouchPresetStoreError(
          `Live Touch preset store entry #${i} is missing a string 'id'`);
      }
      if (typeof entry.name !== 'string' || entry.name === '') {
        throw new LiveTouchPresetStoreError(
          `Live Touch preset store entry '${entry.id}' is missing a string 'name'`);
      }
      if (typeof entry.capturedAt !== 'string' || entry.capturedAt === '') {
        throw new LiveTouchPresetStoreError(
          `Live Touch preset store entry '${entry.id}' is missing a string 'capturedAt'`);
      }
      // `state` is opaque — we only assert it is PRESENT and is an object
      // envelope (the outer container the contract's `state: {...}` shape
      // promises). We never look inside it.
      if (!entry.state || typeof entry.state !== 'object' || Array.isArray(entry.state)) {
        throw new LiveTouchPresetStoreError(
          `Live Touch preset store entry '${entry.id}' is missing a 'state' object`);
      }
    });
    return { schemaVersion: SCHEMA_VERSION, entries: raw.entries };
  }

  _save(store) {
    const out = { schemaVersion: SCHEMA_VERSION, entries: store.entries };
    this.stateManager.writeFileAtomic(this.filePath, yaml.dump(out));
    return out;
  }

  /** List the ordered preset playlist. Throws on a corrupt store. */
  list() {
    return this._load().entries;
  }

  /**
   * Capture a new preset (snapshot now) and append it to the end of the
   * playlist. `state` is stored byte-for-byte, opaque. Returns the created
   * entry. Writes atomically; throws on a bad name/state or a corrupt
   * pre-existing store.
   */
  create(name, state) {
    if (!VALID_NAME_ARG(name)) {
      throw new Error('Live Touch preset name must be a non-empty string (max 128 chars)');
    }
    if (state === undefined || state === null || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('Live Touch preset state must be an object (the panel-owned capture blob)');
    }
    const store = this._load();
    const entry = {
      id: this._mintId(),
      name: name.trim(),
      capturedAt: new Date().toISOString(),
      state,
    };
    store.entries.push(entry);
    this._save(store);
    return entry;
  }

  /** Rename a preset in place (order untouched). Returns the updated entry, or null if unknown. */
  rename(id, name) {
    if (!VALID_NAME_ARG(name)) {
      throw new Error('Live Touch preset name must be a non-empty string (max 128 chars)');
    }
    const store = this._load();
    const entry = store.entries.find(e => e.id === id);
    if (!entry) return null;
    entry.name = name.trim();
    this._save(store);
    return entry;
  }

  /** Delete a preset. Returns true iff an entry was removed. */
  delete(id) {
    const store = this._load();
    const idx = store.entries.findIndex(e => e.id === id);
    if (idx < 0) return false;
    store.entries.splice(idx, 1);
    this._save(store);
    return true;
  }

  /**
   * Reorder the whole playlist. `order` must be an array containing EXACTLY
   * the current entries' ids, each exactly once — a new permutation, not a
   * partial reorder. An unknown id, a missing existing id, or a duplicate
   * throws a plain Error (caller 400s, LIVE_TOUCH_PRESET_INVALID — this is
   * a bad ARGUMENT, not a corrupt store) and the store is left UNCHANGED —
   * no partial reorder is ever written.
   */
  reorder(order) {
    if (!Array.isArray(order) || order.length === 0) {
      throw new Error('reorder requires a non-empty array of preset ids');
    }
    const seen = new Set();
    for (const id of order) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('reorder ids must be non-empty strings');
      }
      if (seen.has(id)) {
        throw new Error(`reorder lists duplicate id '${id}'`);
      }
      seen.add(id);
    }
    const store = this._load();
    const byId = new Map(store.entries.map(e => [e.id, e]));
    const unknown = order.filter(id => !byId.has(id));
    if (unknown.length > 0) {
      throw new Error(`reorder references unknown preset id(s): ${unknown.join(', ')}`);
    }
    const missing = [...byId.keys()].filter(id => !seen.has(id));
    if (missing.length > 0) {
      throw new Error(`reorder is missing existing preset id(s): ${missing.join(', ')}`);
    }
    store.entries = order.map(id => byId.get(id));
    this._save(store);
    return store.entries;
  }
}
