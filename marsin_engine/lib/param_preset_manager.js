import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ── Named per-channel parameter presets (round-2 #9) ────────────────────
//
// A "param preset" captures the LIVE local-control parameter values of a
// single channel (the per-pattern slider/knob/color values it tracks in
// `channel.localControls`, keyed by export control id → {v0,v1,v2}) under a
// name, so the operator can recall the exact look of one channel's pattern
// later. This is NARROWER than a mixer snapshot (which captures the whole
// mixer + deck + groups + faders): a param preset is ONE channel's pattern
// param values, nothing else.
//
// SCOPING: a preset is pattern-scoped. The pattern name a preset was
// captured on is stamped into the preset. Recalling a preset onto a channel
// running a DIFFERENT pattern is a fail-loud error (the API layer 409s) —
// the control ids in `localControls` are pattern-specific export slots, so
// blindly replaying them onto another pattern would set the wrong knobs or
// silently no-op on missing exports. We refuse rather than degrade.
//
// Presets persist as YAML in `<stateDir>/param_presets/<name>.yaml`, written
// through the SAME atomic temp+fsync+rename writer the snapshot / state /
// playlist managers use (StateManager.writeFileAtomic) so a crash mid-save
// can never leave a torn preset on disk. This file mirrors snapshot_manager.js
// in structure and error discipline.
//
// Codex P0 (fail loud, no silent fallback): a malformed preset file (corrupt
// YAML, or a structurally-wrong payload) throws ParamPresetError rather than
// degrading to an empty/partial preset — mirrors SnapshotLoadError. A missing
// preset on load returns null so the caller can 404. A bad name throws so the
// caller 400s instead of writing junk.

const VALID_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Thrown when a preset file EXISTS but its YAML is corrupt or its shape is
// structurally invalid. Distinguishing "corrupt" from "missing" is a Codex P0
// concern — a corrupt file must never look like an absent one. HTTP callers
// translate this into a 400 carrying `.code`.
export class ParamPresetError extends Error {
  constructor(message, { name, cause } = {}) {
    super(message);
    this.name = 'ParamPresetError';
    this.code = 'PARAM_PRESET_MALFORMED';
    this.presetName = name;
    if (cause) this.cause = cause;
  }
}

export class ParamPresetManager {
  /**
   * @param {string} stateDir       the model's state directory (the same dir
   *                                 StateManager owns). Presets live in a
   *                                 `param_presets/` subdirectory of it.
   * @param {StateManager} stateManager used for its atomic write helper so
   *                                 presets share the torn-write guarantee.
   */
  constructor(stateDir, stateManager) {
    if (!stateDir) throw new Error('ParamPresetManager: stateDir is required');
    if (!stateManager || typeof stateManager.writeFileAtomic !== 'function') {
      throw new Error('ParamPresetManager: a StateManager with writeFileAtomic() is required');
    }
    this.presetsDir = path.join(stateDir, 'param_presets');
    this.stateManager = stateManager;
    if (!fs.existsSync(this.presetsDir)) {
      fs.mkdirSync(this.presetsDir, { recursive: true });
    }
  }

  // Normalize + validate a preset name. snake_case-friendly slug; rejects
  // path traversal and anything that wouldn't make a safe filename. Throws on
  // a bad name so the API layer 400s instead of writing junk.
  _safeName(name) {
    if (typeof name !== 'string' || !VALID_NAME.test(name)) {
      throw new Error(
        `Invalid param preset name '${name}': must match ${VALID_NAME} ` +
        '(lowercase letters, digits, _ and -, 1-64 chars)');
    }
    return name;
  }

  _filePath(name) {
    return path.join(this.presetsDir, `${this._safeName(name)}.yaml`);
  }

  /** List saved preset metadata (sorted by name): { name, pattern, savedAt }. */
  listParamPresets() {
    if (!fs.existsSync(this.presetsDir)) return [];
    return fs.readdirSync(this.presetsDir)
      .filter(f => f.endsWith('.yaml') && !f.startsWith('.'))
      .map(f => f.slice(0, -'.yaml'.length))
      .sort()
      .map((name) => {
        // Read each preset's header so the list carries the pattern it is
        // scoped to (the UI needs it to grey out recall onto a mismatched
        // channel). A corrupt file fails loud rather than vanishing from
        // the list — the operator must know a saved preset went bad.
        const preset = this._load(name);
        return { name, pattern: preset.pattern, savedAt: preset.savedAt };
      });
  }

  /** True iff a preset with this name exists on disk. */
  has(name) {
    return fs.existsSync(this._filePath(name));
  }

  /**
   * Capture a channel's current localControls under a name. Stamps the
   * channel's pattern (for recall scoping), the channel id it was captured
   * from (informational), and savedAt. Writes atomically. Returns the
   * on-disk shape.
   *
   * `channel` is a live PatternChannel. Its `localControls` is the
   * controlId → {v0,v1,v2} map (see pattern_channel.js). We deep-copy the
   * values so a later live edit of the channel can't mutate the saved
   * preset, and coerce every component to a finite number (a non-numeric
   * control value is a structural bug, not something to persist silently).
   */
  captureParamPreset(name, channel) {
    const safe = this._safeName(name);
    if (!channel || typeof channel !== 'object') {
      throw new Error('ParamPresetManager.captureParamPreset: a channel is required');
    }
    if (typeof channel.pattern !== 'string' || channel.pattern === '') {
      throw new Error('ParamPresetManager.captureParamPreset: channel has no pattern to scope the preset to');
    }
    const controls = {};
    const live = channel.localControls && typeof channel.localControls === 'object'
      ? channel.localControls
      : {};
    for (const [id, cv] of Object.entries(live)) {
      if (!cv || typeof cv !== 'object') {
        throw new Error(`ParamPresetManager.captureParamPreset: control '${id}' has a non-object value`);
      }
      controls[id] = {
        v0: Number(cv.v0) || 0,
        v1: Number(cv.v1) || 0,
        v2: Number(cv.v2) || 0,
      };
    }
    const out = {
      name: safe,
      pattern: channel.pattern,
      capturedFromChannel: channel.id,
      savedAt: new Date().toISOString(),
      controls,
    };
    this.stateManager.writeFileAtomic(this._filePath(safe), yaml.dump(out));
    return out;
  }

  /**
   * Internal load: returns the parsed, validated preset object. Throws
   * ParamPresetError when the file is corrupt or structurally invalid.
   * Assumes the file exists (callers gate on has()).
   */
  _load(name) {
    const filePath = this._filePath(name);
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      throw new ParamPresetError(
        `Param preset '${name}' is corrupt: ${err.message}`,
        { name, cause: err });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ParamPresetError(
        `Param preset '${name}' has an invalid shape (expected an object)`,
        { name });
    }
    if (typeof raw.pattern !== 'string' || raw.pattern === '') {
      throw new ParamPresetError(
        `Param preset '${name}' is missing its 'pattern' scope`,
        { name });
    }
    if (!raw.controls || typeof raw.controls !== 'object' || Array.isArray(raw.controls)) {
      throw new ParamPresetError(
        `Param preset '${name}' is missing a 'controls' object`,
        { name });
    }
    return raw;
  }

  /**
   * Load a named preset. Returns the parsed preset object, or null when the
   * file does not exist (caller 404s). Throws ParamPresetError when the file
   * exists but is corrupt or structurally invalid (caller 400s) — never a
   * silent empty preset.
   */
  loadParamPreset(name) {
    if (!fs.existsSync(this._filePath(name))) return null;
    return this._load(name);
  }

  /** Delete a named preset. Returns true iff a file was removed. */
  deleteParamPreset(name) {
    const filePath = this._filePath(name);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }
}
