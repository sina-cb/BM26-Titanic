import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const VALID_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const VALID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})?$/;

export class PlaylistManager {
  constructor(playlistsDir, patternsDir) {
    this.playlistsDir = playlistsDir;
    this.patternsDir = patternsDir;
    if (!fs.existsSync(this.playlistsDir)) {
      fs.mkdirSync(this.playlistsDir, { recursive: true });
    }
  }

  validateName(name) {
    if (typeof name !== 'string') throw new Error(`Invalid playlist name (non-string)`);
    if (!VALID_NAME.test(name)) throw new Error(`Invalid playlist name: "${name}"`);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`Path traversal rejected: "${name}"`);
    }
  }

  list() {
    if (!fs.existsSync(this.playlistsDir)) return [];
    return fs.readdirSync(this.playlistsDir)
      .filter(f => f.endsWith('.yaml'))
      .map(f => f.replace(/\.yaml$/, ''));
  }

  patternExists(patternName) {
    // Hardened: an older / malformed playlist may have null / number /
    // missing pattern field. Anything non-string is just "doesn't
    // exist" — caller marks the entry _missing and moves on. Throwing
    // here would explode every load() chain (api_server.js calls this
    // from ~10 places, most without their own try/catch).
    if (typeof patternName !== 'string' || !patternName) return false;
    const safe = patternName.replace(/\\/g, '/');
    if (!VALID_PATTERN.test(safe)) return false;
    const p = path.join(this.patternsDir, `${safe}.js`);
    return fs.existsSync(p);
  }

  /**
   * Load a playlist from disk and coerce it into the current schema.
   *
   * Resilience contract: a malformed YAML file or an older format must
   * NEVER crash the engine. The user reported "I chose fast playlist
   * and it seems like it crashed" — that was this method throwing on
   * a stale-format file and bubbling a 500 through the iPad. Now:
   *
   *   - bad YAML       → warn + return null (caller treats as missing)
   *   - missing entries → coerced to []
   *   - non-object entry → dropped + warned
   *   - entry without a string pattern → kept as _missing (visible in
   *     the UI as the "⚠" badge) so the operator can heal the file
   *     instead of guessing why a row disappeared
   */
  load(name) {
    this.validateName(name);
    const filePath = path.join(this.playlistsDir, `${name}.yaml`);
    if (!fs.existsSync(filePath)) return null;
    let raw = {};
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
      if (typeof raw !== 'object') raw = {};
    } catch (err) {
      console.warn(`[Playlist] malformed YAML in "${name}.yaml" — treating as missing: ${err.message}`);
      return null;
    }
    const data = {
      name: typeof raw.name === 'string' ? raw.name : name,
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
      entries: [],
    };
    const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
    for (const entry of rawEntries) {
      if (!entry || typeof entry !== 'object') {
        console.warn(`[Playlist] "${name}" — dropping non-object entry`);
        continue;
      }
      // Force a sane shape so downstream consumers (mixer, autopilot,
      // applyEntryDefaults) don't need their own per-field guards.
      const coerced = {
        id: typeof entry.id === 'string' && entry.id ? entry.id : this.generateEntryId(),
        pattern: typeof entry.pattern === 'string' ? entry.pattern : null,
        label: typeof entry.label === 'string' ? entry.label : null,
        defaults: (entry.defaults && typeof entry.defaults === 'object') ? entry.defaults : {},
        notes: typeof entry.notes === 'string' ? entry.notes : null,
      };
      if (!this.patternExists(coerced.pattern)) coerced._missing = true;
      data.entries.push(coerced);
    }
    return data;
  }

  save(playlist) {
    if (!playlist || !playlist.name) throw new Error('Playlist requires a name');
    this.validateName(playlist.name);
    const entries = Array.isArray(playlist.entries) ? playlist.entries : [];

    const ids = new Set();
    const clean = {
      schemaVersion: 1,
      name: playlist.name,
      entries: entries.map((e, i) => {
        if (!e.id) throw new Error(`Entry ${i} missing id`);
        if (ids.has(e.id)) throw new Error(`Duplicate entry id: ${e.id}`);
        ids.add(e.id);
        if (!VALID_PATTERN.test(e.pattern || '')) {
          throw new Error(`Invalid pattern name in entry ${e.id}: "${e.pattern}"`);
        }
        return {
          id: e.id,
          pattern: e.pattern,
          label: e.label || null,
          defaults: e.defaults && typeof e.defaults === 'object' ? e.defaults : {},
          notes: e.notes || null,
        };
      }),
    };

    const filePath = path.join(this.playlistsDir, `${playlist.name}.yaml`);
    fs.writeFileSync(filePath, yaml.dump(clean));
    return clean;
  }

  delete(name) {
    this.validateName(name);
    if (name === 'default') throw new Error('Cannot delete the default playlist');
    const filePath = path.join(this.playlistsDir, `${name}.yaml`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  generateEntryId() {
    return `e_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  /**
   * Scan patternsDir (non-recursive top-level only) and create `default.yaml`
   * containing one entry per pattern with no labels and empty defaults.
   */
  generateDefault() {
    let patterns = [];
    if (fs.existsSync(this.patternsDir)) {
      patterns = fs.readdirSync(this.patternsDir)
        .filter(f => f.endsWith('.js'))
        .filter(f => !f.startsWith('test'))
        .filter(f => !f.startsWith('_'))
        .map(f => f.replace(/\.js$/, ''))
        .sort();
    }
    const playlist = {
      schemaVersion: 1,
      name: 'default',
      entries: patterns.map((p, i) => ({
        id: `e_default_${i}_${p}`,
        pattern: p,
        label: null,
        defaults: {},
        notes: null,
      })),
    };
    return this.save(playlist);
  }

  /**
   * Capture current local controls of `channel` as a defaults object keyed
   * by export name. Filters out:
   *   - kinds outside {1=slider, 2=toggle, 6=hsv}  (triggers excluded)
   *   - CPC-owned (shared) exports
   *   - CPC-blocked exports (e.g. sliderSpeed when sharedSpeed is in play)
   */
  captureDefaults(channel, wasmHost, paramCenter) {
    const exports = wasmHost.getExports(channel.handle) || [];
    const out = {};
    const localKinds = new Set([1, 2, 6]);
    for (const exp of exports) {
      if (!localKinds.has(exp.kind)) continue;
      if (paramCenter && paramCenter.isSharedExport(channel.id, exp.name)) continue;
      if (paramCenter && paramCenter.getBlockedIds(channel.id).has(exp.id)) continue;
      const cv = channel.localControls && channel.localControls[exp.id];
      if (exp.kind === 6) {
        out[exp.name] = {
          h: cv ? cv.v0 : (exp.v0 ?? 0),
          s: cv ? cv.v1 : (exp.v1 ?? 1),
          v: cv ? cv.v2 : (exp.v2 ?? 1),
        };
      } else {
        out[exp.name] = cv ? cv.v0 : (exp.v0 ?? 0);
      }
    }
    return out;
  }

  /**
   * Apply entry.defaults to a channel's WASM handle by mapping export-name
   * → control-id. Skips CPC-owned and stale names.
   */
  applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter) {
    if (!entry || !entry.defaults) return;
    if (Object.keys(entry.defaults).length === 0) return;
    const exports = wasmHost.getExports(channel.handle) || [];
    const byName = {};
    for (const e of exports) byName[e.name] = e;
    for (const [name, value] of Object.entries(entry.defaults)) {
      const exp = byName[name];
      if (!exp) {
        console.warn(`[Playlist] Stale default "${name}" in entry ${entry.id} (${entry.pattern}) — skipping`);
        continue;
      }
      if (paramCenter && paramCenter.isSharedExport(channel.id, exp.name)) continue;
      if (paramCenter && paramCenter.getBlockedIds(channel.id).has(exp.id)) continue;
      if (typeof value === 'object' && value !== null) {
        paramRouter.setChannelControl(channel.id, exp.id, value.h ?? 0, value.s ?? 0, value.v ?? 0);
      } else {
        paramRouter.setChannelControl(channel.id, exp.id, value, 0, 0);
      }
    }
  }
}
