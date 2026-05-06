/**
 * Central Parameter Center (CPC)
 *
 * Server-authoritative shared parameter system for MarsinEngine.
 * Manages speed, direction, count, size, rotate, colorPalette1, colorPalette2
 * across all sources (CaptainPad, OSC, REST, MIDI).
 *
 * Design doc: docs/18_central_param_center.md
 */

import fs from 'fs';
import yaml from 'js-yaml';

// ── Shared Parameter Registry ─────────────────────────────────────────────
const PARAM_REGISTRY = [
  {
    key: 'speed', label: 'Speed', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/speed', sharedFnName: 'speed',
  },
  {
    key: 'direction', label: 'Direction', type: 'float',
    default: 1.0, range: [0, 1], options: [0, 0.5, 1.0], clamp: true, persist: true,
    oscAddress: '/marsin/param/direction', sharedFnName: 'direction',
  },
  {
    key: 'count', label: 'Count', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/count', sharedFnName: 'count',
  },
  {
    key: 'size', label: 'Size', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/size', sharedFnName: 'size',
  },
  {
    key: 'rotate', label: 'Rotate', type: 'float',
    default: 0.0, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/rotate', sharedFnName: 'rotate',
  },
  {
    key: 'colorPalette1', label: 'Color 1', type: 'hsv',
    default: { h: 0.0, s: 1.0, v: 1.0 }, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/colorPalette1', sharedFnName: 'colorPalette1',
  },
  {
    key: 'colorPalette2', label: 'Color 2', type: 'hsv',
    default: { h: 0.5, s: 1.0, v: 1.0 }, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/colorPalette2', sharedFnName: 'colorPalette2',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function clampFloat(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function clampHsv(v, min, max) {
  if (typeof v !== 'object' || v === null) return { h: 0, s: 1, v: 1 };
  return {
    h: clampFloat(v.h ?? 0, min, max),
    s: clampFloat(v.s ?? 0, min, max),
    v: clampFloat(v.v ?? 0, min, max),
  };
}

function clampValue(value, entry) {
  if (!entry.clamp) return value;
  const [min, max] = entry.range;
  if (entry.type === 'hsv') return clampHsv(value, min, max);
  if (entry.options) {
    const num = typeof value === 'number' ? value : 0;
    if (entry.type === 'int') {
      const rounded = Math.round(num);
      return entry.options.includes(rounded) ? rounded : entry.default;
    } else {
      let closest = entry.options[0];
      let minDist = Math.abs(num - closest);
      for (const opt of entry.options) {
        const dist = Math.abs(num - opt);
        if (dist < minDist) {
          closest = opt;
          minDist = dist;
        }
      }
      return closest;
    }
  }
  
  if (entry.type === 'int') {
    return Math.round(clampFloat(typeof value === 'number' ? value : 0, min, max));
  }
  return clampFloat(typeof value === 'number' ? value : 0, min, max);
}

function deepCopy(v) {
  if (typeof v === 'object' && v !== null) return { ...v };
  return v;
}

/**
 * Extract the semantic role from a shared function name.
 * e.g., 'speed' → 'speed', 'colorPalette1' → 'colorpalette1'
 */
function sharedSuffix(name) {
  return name.toLowerCase();
}

// ── ParamCenter Class ─────────────────────────────────────────────────────

export class ParamCenter {
  /**
   * @param {string} statePath — absolute path to param_center_state.yaml
   */
  constructor(statePath) {
    this._statePath = statePath;
    this._registry = PARAM_REGISTRY;
    this._registryByKey = {};
    this._registryByFnName = {};

    // Build lookup maps
    for (const entry of this._registry) {
      this._registryByKey[entry.key] = entry;
      this._registryByFnName[entry.sharedFnName] = entry;
    }

    // Global state
    this._revision = 0;
    this._sourceLock = null; // null = open, { mode: 'global', source: 'osc' }, { mode: 'per-param', leases: {} }

    // Per-param store
    this._store = {};
    for (const entry of this._registry) {
      this._store[entry.key] = {
        value: deepCopy(entry.default),
        dirty: false,
        lastSource: null,
        lastOrigin: null,
        lastRevision: 0,
      };
    }

    // WASM integration — populated by rebuildControlMap()
    this._controlMap = {};     // key → { id, fnName } — maps param keys to CRC32 control IDs
    this._blockedIds = new Set(); // control IDs blocked from normal /control path
    this._sharedFnNames = new Set(); // set of shared function names found in current pattern

    // Persistence: debounce timer
    this._saveTimer = null;

    // Restore from disk if file exists
    if (this._statePath) {
      this._loadFromDisk();
    }
  }

  // ── Core API ──────────────────────────────────────────────────────────

  /**
   * Set a shared parameter value.
   * @param {string} key — param key (e.g., 'speed')
   * @param {*} value — new value
   * @param {string} source — source adapter type ('ipad', 'osc', 'api')
   * @param {string} [origin] — client instance ID ('ipad-001')
   * @returns {{ status: 'ok', revision: number } | { status: 'ignored', reason: string, lockedTo?: string }}
   */
  set(key, value, source, origin = null) {
    const entry = this._registryByKey[key];
    if (!entry) return { status: 'ignored', reason: 'unknown_key' };

    // Source-lock check
    const lockResult = this._checkSourceLock(key, source);
    if (lockResult) return lockResult;

    // Validate and clamp
    const clamped = clampValue(value, entry);

    // Update store
    this._revision++;
    const slot = this._store[key];
    slot.value = deepCopy(clamped);
    slot.dirty = true;
    slot.lastSource = source;
    slot.lastOrigin = origin || source;
    slot.lastRevision = this._revision;

    return { status: 'ok', revision: this._revision };
  }

  /**
   * Flat values for quick reads.
   * @returns {Object} e.g., { speed: 0.7, direction: 1, ... }
   */
  getAll() {
    const out = {};
    for (const key in this._store) {
      out[key] = deepCopy(this._store[key].value);
    }
    return out;
  }

  /**
   * Full canonical state for broadcasts and HTTP responses.
   */
  getCanonicalState() {
    const params = {};
    for (const key in this._store) {
      const s = this._store[key];
      params[key] = {
        value: deepCopy(s.value),
        lastSource: s.lastSource,
        lastOrigin: s.lastOrigin,
        lastRevision: s.lastRevision,
      };
    }
    return {
      revision: this._revision,
      sourceLock: this._sourceLock ? { ...this._sourceLock } : null,
      params,
    };
  }

  /**
   * Schema for client UI rendering (CaptainPad, etc.)
   */
  getSchema() {
    return this._registry.map(e => ({
      key: e.key,
      label: e.label,
      type: e.type,
      range: e.range,
      default: deepCopy(e.default),
      oscAddress: e.oscAddress,
      options: e.options || undefined,
    }));
  }

  // ── WASM Integration ──────────────────────────────────────────────────

  registerChannel(channelId, handle, exports) {
    this._channels = this._channels || {};
    const controlMap = {};
    const blockedIds = new Set();
    const sharedFnNames = new Set();

    // 1. Find shared* exports
    for (const exp of exports) {
      const entry = this._registryByFnName[exp.name];
      if (entry) {
        controlMap[entry.key] = { id: exp.id, fnName: exp.name };
        sharedFnNames.add(exp.name);
      }
    }

    // 2. Conflict detection
    for (const exp of exports) {
      if (sharedFnNames.has(exp.name)) continue;
      const lowerName = exp.name.toLowerCase();
      for (const entry of this._registry) {
        const suffix = entry.key.toLowerCase();
        if (!controlMap[entry.key]) continue;
        if (lowerName === `slider${suffix}` || lowerName === `hsvpicker${suffix}` || lowerName === `toggle${suffix}`) {
          blockedIds.add(exp.id);
          // console.warn(`[ParamCenter] ⚠ Conflict on CH ${channelId}: '${exp.name}' blocked — '${entry.sharedFnName}' owns variable '${entry.key}'`);
        }
      }
    }

    this._channels[channelId] = { handle, controlMap, blockedIds, sharedFnNames };
  }

  unregisterChannel(channelId) {
    if (this._channels) delete this._channels[channelId];
  }

  isSharedExport(channelId, name) {
    const ch = this._channels?.[channelId];
    return ch ? ch.sharedFnNames.has(name) : false;
  }

  getBlockedIds(channelId) {
    const ch = this._channels?.[channelId];
    return ch ? ch.blockedIds : new Set();
  }

  /** Returns true if this numeric export ID is controlled by the CPC for the given channel */
  isSharedControlId(channelId, controlId) {
    const ch = this._channels?.[channelId];
    if (!ch) return false;
    for (const key in ch.controlMap) {
      if (ch.controlMap[key].id === controlId) return true;
    }
    return false;
  }

  applySnapshot(wasmHost) {
    for (const chId in this._channels) {
      this._applyToHandle(wasmHost, this._channels[chId]);
    }
    for (const key in this._store) {
      this._store[key].dirty = false;
    }
  }

  /**
   * Push current CPC values to a SINGLE channel only.
   * Use this after compiling a new pattern on one channel so that
   * other already-running channels are not disturbed.
   */
  applyToChannel(wasmHost, channelId) {
    const ch = this._channels?.[channelId];
    if (ch) this._applyToHandle(wasmHost, ch);
  }

  /** @private shared helper */
  _applyToHandle(wasmHost, ch) {
    if (!ch.handle) return;
    for (const key in ch.controlMap) {
      const mapping = ch.controlMap[key];
      const slot = this._store[key];
      const entry = this._registryByKey[key];
      if (entry.type === 'hsv') {
        wasmHost.setControl(ch.handle, mapping.id, slot.value.h, slot.value.s, slot.value.v);
      } else {
        wasmHost.setControl(ch.handle, mapping.id, slot.value, 0, 0);
      }
    }
  }

  flushDirty(wasmHost) {
    if (!this._channels) return;
    let anyDirty = false;
    for (const key in this._store) {
      if (this._store[key].dirty) { anyDirty = true; break; }
    }
    if (!anyDirty) return;

    for (const chId in this._channels) {
      const ch = this._channels[chId];
      if (!ch.handle) continue;
      for (const key in ch.controlMap) {
        const slot = this._store[key];
        if (!slot.dirty) continue;
        const mapping = ch.controlMap[key];
        const entry = this._registryByKey[key];
        if (entry.type === 'hsv') {
          wasmHost.setControl(ch.handle, mapping.id, slot.value.h, slot.value.s, slot.value.v);
        } else {
          wasmHost.setControl(ch.handle, mapping.id, slot.value, 0, 0);
        }
      }
    }
    
    for (const key in this._store) {
      this._store[key].dirty = false;
    }
  }

  // ── Source Arbitration ─────────────────────────────────────────────────

  /**
   * Set source-lock policy.
   * @param {{ mode: 'open' } | { mode: 'global', source: string } | { mode: 'per-param', leases: Object }} lock
   */
  setSourceLock(lock) {
    if (!lock || lock.mode === 'open') {
      this._sourceLock = null;
    } else if (lock.mode === 'global') {
      this._sourceLock = { mode: 'global', source: lock.source };
    } else if (lock.mode === 'per-param') {
      this._sourceLock = { mode: 'per-param', leases: { ...(lock.leases || {}) } };
    }
  }

  getSourceLock() {
    return this._sourceLock ? { ...this._sourceLock } : null;
  }

  /**
   * Check if a write from `source` to `key` is allowed under current lock policy.
   * @returns {null} if allowed, or { status: 'ignored', reason, lockedTo } if rejected.
   */
  _checkSourceLock(key, source) {
    if (!this._sourceLock) return null; // open mode

    if (this._sourceLock.mode === 'global') {
      if (this._sourceLock.source !== source) {
        return { status: 'ignored', reason: 'source_lock', lockedTo: this._sourceLock.source };
      }
    } else if (this._sourceLock.mode === 'per-param') {
      const leaseOwner = this._sourceLock.leases?.[key];
      if (leaseOwner && leaseOwner !== source) {
        return { status: 'ignored', reason: 'source_lock', lockedTo: leaseOwner };
      }
    }
    return null;
  }

  // ── Persistence ────────────────────────────────────────────────────────

  /**
   * Save current shared param values to disk (debounced).
   */
  save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._writeToDisk();
    }, 250);
  }

  _writeToDisk() {
    if (this.saveHook) {
      this.saveHook();
      return;
    }
    if (!this._statePath) return;
    try {
      const data = {};
      for (const entry of this._registry) {
        if (!entry.persist) continue;
        data[entry.key] = deepCopy(this._store[entry.key].value);
      }
      fs.writeFileSync(this._statePath, yaml.dump(data));
    } catch (e) {
      console.warn(`[ParamCenter] Failed to persist state: ${e.message}`);
    }
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this._statePath)) return;
      const raw = yaml.load(fs.readFileSync(this._statePath, 'utf8'));
      if (!raw || typeof raw !== 'object') return;

      for (const key in raw) {
        const entry = this._registryByKey[key];
        if (!entry) continue;
        const clamped = clampValue(raw[key], entry);
        this._store[key].value = deepCopy(clamped);
      }
      console.log(`  ✅ ParamCenter restored from ${this._statePath}`);
    } catch (e) {
      console.warn(`[ParamCenter] Failed to load state: ${e.message}`);
    }
  }
}
