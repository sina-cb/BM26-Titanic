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

import { audioRegistryEntries, isLiveAudioSharedFnName } from '../audio/postproc/audio_signals.js';

// ── Shared Parameter Registry ─────────────────────────────────────────────
//
// The AUDIO signal family (mic bands + kick + flux, stems, their *Gain and
// *Raw mirrors, tempoBpm, and the 5 detector live keys) is NOT hand-listed
// here — it is generated from `lib/audio_signals.js`, the single source of
// truth that kills the old 5-place drift (registry / KNOWN_SIGNALS /
// DEFAULT_CHAINS / osc_listener maps / CaptainPad liveKeys). The audio block
// is spliced in below via `...audioRegistryEntries()`, BETWEEN the color
// params and the BPM→speed-sync params, preserving the exact registry order
// the schema / OSC bindings depend on. Every NON-audio entry stays
// hand-listed exactly as before.
const PARAM_REGISTRY = [
  {
    // `speed` and `size` are ENGINE-OWNED globals since May 2026.
    //
    // The engine reads their CPC value directly each tick and applies
    // it itself — speed accumulates a scaled `patternClockSeconds`
    // (see engine.js createRenderLoop), size rebuilds the WASM coord
    // buffer (see wasm_host.applySizeScale). They are deliberately
    // NOT injected as pattern variables, so patterns can't fight the
    // engine over the same knob. The `engineOwned: true` flag tells
    // `registerChannel` to skip the per-pattern function binding
    // even though the entries still appear in /param-center/schema
    // (so the CaptainPad UI, OSC, and persistence still work).
    key: 'speed', label: 'Speed', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    engineOwned: true,
    oscAddress: '/marsin/param/speed', sharedFnName: 'speed',
  },
  // `direction` and `count` were globals through May 2026 but ended up
  // being too pattern-specific to make sense as cross-pattern controls
  // (every pattern interpreted "count" differently and many had no
  // meaningful direction). They're now pattern-local only — declare
  // `sliderDirection` / `sliderCount` (or whatever fits) inside the
  // pattern and they'll surface in the per-channel local controls.
  // See report .agent/02_reports/202605/20260508_1 §6 for context.
  {
    // Engine-owned (see comment on `speed` above).
    key: 'size', label: 'Size', type: 'float',
    default: 0.5, range: [0, 1], clamp: true, persist: true,
    engineOwned: true,
    oscAddress: '/marsin/param/size', sharedFnName: 'size',
  },
  {
    key: 'rotate', label: 'Rotate', type: 'float',
    default: 0.0, range: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/rotate', sharedFnName: 'rotate',
  },
  {
    // `slew: true` opts these into the engine-side timed color
    // transition (docs/36). The canonical `value` stays the operator's
    // TARGET (UI/persist/broadcast see the new color instantly); a
    // parallel `_rendered` value ramps toward it over `colorTransitionMs`
    // and is what actually gets injected into the WASM VM each frame.
    key: 'colorPalette1', label: 'Color 1', type: 'hsv',
    default: { h: 0.0, s: 1.0, v: 1.0 }, range: [0, 1], clamp: true, persist: true,
    slew: true,
    oscAddress: '/marsin/param/colorPalette1', sharedFnName: 'colorPalette1',
  },
  {
    key: 'colorPalette2', label: 'Color 2', type: 'hsv',
    default: { h: 0.5, s: 1.0, v: 1.0 }, range: [0, 1], clamp: true, persist: true,
    slew: true,
    oscAddress: '/marsin/param/colorPalette2', sharedFnName: 'colorPalette2',
  },
  {
    // Duration (ms) of the global color crossfade applied to the two
    // colorPalette params above. 0 = instant (today's snap behavior).
    // Operator-tunable + persisted; NOT itself slewed. See docs/36.
    // No pattern exports `colorTransitionMs`, so it never binds to a
    // WASM control — it's read directly by tickColorTransitions().
    key: 'colorTransitionMs', label: 'Color Fade', type: 'float',
    default: 800, range: [0, 10000], clamp: true, persist: true,
    oscAddress: '/marsin/param/colorTransitionMs', sharedFnName: 'colorTransitionMs',
  },
  // ── Audio signal family (mic / stems / gains / raw mirrors / tempoBpm /
  //    structure-detector keys) — GENERATED from lib/audio_signals.js.
  //    Single source of truth; see the header comment on PARAM_REGISTRY
  //    above and lib/audio_signals.js for why this block is not hand-listed.
  ...audioRegistryEntries(),

  // ── BPM → speed sync (docs/25 §6) ──────────────────────────────────────
  // Operator-tunable, persistent. `bpmSpeedSync` is float-with-options
  // so the existing UI-toggle pattern (cf. `direction`) reuses without
  // adding a bool type to the CPC schema.
  {
    key: 'bpmSpeedSync', label: 'BPM → Speed', type: 'float',
    default: 0.0, range: [0, 1], options: [0, 1], clamp: true, persist: true,
    oscAddress: '/marsin/param/bpmSpeedSync', sharedFnName: 'bpmSpeedSync',
  },
  // bpmSpeedMin/Max range tightened from [30, 240] to [60, 180] on
  // 2026-05-25 per operator brief: those are the musically useful
  // bounds for EDM and "no values outside this allowed in the UI".
  // The CaptainPad slider also enforces `max > min` (each slider's
  // bound moves to keep them at least 1 BPM apart).
  {
    key: 'bpmSpeedMin', label: 'BPM Sync Min', type: 'int',
    default: 60, range: [60, 180], clamp: true, persist: true,
    oscAddress: '/marsin/param/bpmSpeedMin', sharedFnName: 'bpmSpeedMin',
  },
  {
    key: 'bpmSpeedMax', label: 'BPM Sync Max', type: 'int',
    default: 160, range: [60, 180], clamp: true, persist: true,
    oscAddress: '/marsin/param/bpmSpeedMax', sharedFnName: 'bpmSpeedMax',
  },
];

// Defaults applied to every registry entry when read by schema /
// throttle / persistence callers. Keeping these out of the literal
// entries lets the bulk of the registry stay terse.
const REGISTRY_DEFAULTS = {
  live: false,
  broadcastHz: 30,
  persist: false,
  portWatch: true,
};

function withDefaults(entry) {
  return {
    live: REGISTRY_DEFAULTS.live,
    broadcastHz: REGISTRY_DEFAULTS.broadcastHz,
    portWatch: REGISTRY_DEFAULTS.portWatch,
    ...entry,
  };
}

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

// ── Color-transition interpolation (docs/36) ───────────────────────────────

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smoothstep easing so the fade eases in/out instead of running linear.
function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// Hue lives on a circle (0..1 wraps). Interpolate the SHORTEST arc so
// e.g. 0.95 → 0.05 crosses red, not the entire spectrum.
function lerpHue(a, b, t) {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (a + d * t + 1) % 1;
}

function lerpFloat(a, b, t) {
  return a + (b - a) * t;
}

// Interpolate an {h,s,v} value: hue along the short arc, s/v linear.
function lerpHsv(from, to, t) {
  return {
    h: lerpHue(from.h ?? 0, to.h ?? 0, t),
    s: lerpFloat(from.s ?? 1, to.s ?? 1, t),
    v: lerpFloat(from.v ?? 1, to.v ?? 1, t),
  };
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
   * @param {object} [options]
   * @param {Record<string, { range?: [number, number], default?: number }>} [options.registryOverrides]
   *   Per-key overrides applied to the registry before lookup maps and
   *   the per-param store are built. Currently used to let
   *   `config.yaml`'s `osc.gainMax` reshape the range of the per-stem
   *   gain params at boot. The override `default` (if provided) is
   *   re-clamped to the (possibly overridden) range so a config
   *   change can't push a default outside its own range.
   */
  constructor(statePath, options = {}) {
    this._statePath = statePath;
    const overrides = (options && options.registryOverrides) || {};
    this._registry = PARAM_REGISTRY.map(withDefaults).map(entry => {
      const o = overrides[entry.key];
      if (!o) return entry;
      const next = { ...entry };
      if (Array.isArray(o.range) && o.range.length === 2) next.range = [...o.range];
      if (typeof o.default === 'number') next.default = o.default;
      // Re-clamp default into the (possibly new) range so we never
      // store a seed value the param itself would reject on write.
      next.default = clampValue(next.default, next);
      return next;
    });
    this._registryByKey = {};
    this._registryByFnName = {};

    // Build lookup maps
    for (const entry of this._registry) {
      this._registryByKey[entry.key] = entry;
      this._registryByFnName[entry.sharedFnName] = entry;
    }

    // Single fan-out hook for post-mutation work (persistence,
    // throttled WS broadcast, future MIDI/mic adapters). See
    // docs/24_osc_integration.md §7.2. Wired once by api_server.js.
    //
    // For additional listeners (BpmSpeedSync, future MIDI adapter, …)
    // use `subscribe(fn)` instead of stomping `onChange`. Subscribers
    // fire BEFORE the legacy `onChange` slot, in registration order.
    this.onChange = null;
    this._subscribers = [];

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

    // ── Color-transition ramp state (docs/36) ─────────────────────────
    // Built AFTER _loadFromDisk so `_rendered` seeds from the persisted
    // value — the rig boots AT the saved color, not fading up to it.
    //   _rendered[key]   — HSV last injected into the WASM VM
    //   _rampFrom[key]   — HSV at the moment the target last changed
    //                      (null === no active ramp)
    //   _rampStartMs[key]— clock at ramp start (null === start on next tick)
    this._slewKeys = this._registry.filter(e => e.slew).map(e => e.key);
    this._rendered = {};
    this._rampFrom = {};
    this._rampStartMs = {};
    for (const key of this._slewKeys) {
      this._rendered[key] = deepCopy(this._store[key].value);
      this._rampFrom[key] = null;
      this._rampStartMs[key] = null;
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
    const result = this._setNoFire(key, value, source, origin);
    if (result.status === 'ok') this._fireOnChange([key]);
    return result;
  }

  /**
   * Internal single-write that does NOT fire onChange. Used by both
   * the public set() (which fires after) and setMany() (which fires
   * once after the whole batch). Same return shape as set().
   * @private
   */
  _setNoFire(key, value, source, origin = null) {
    const entry = this._registryByKey[key];
    if (!entry) return { status: 'ignored', reason: 'unknown_key' };

    const lockResult = this._checkSourceLock(key, source);
    if (lockResult) return lockResult;

    const clamped = clampValue(value, entry);

    this._revision++;
    const slot = this._store[key];
    slot.value = deepCopy(clamped);
    slot.dirty = true;
    slot.lastSource = source;
    slot.lastOrigin = origin || source;
    slot.lastRevision = this._revision;

    // Slewed params (the color palettes): (re)arm the ramp from wherever
    // _rendered currently sits toward this new target. _rampStartMs=null
    // means "start timing on the next tick". docs/36.
    if (entry.slew) {
      this._rampFrom[key] = deepCopy(this._rendered[key]);
      this._rampStartMs[key] = null;
    }

    return { status: 'ok', revision: this._revision };
  }

  /**
   * Set one component of an HSV-typed param atomically. See
   * docs/24_osc_integration.md §7.1.
   * @param {string} key — HSV-typed CPC key
   * @param {'h'|'s'|'v'} field
   * @param {number} value
   * @param {string} source
   * @param {string} [origin]
   */
  setHsvField(key, field, value, source, origin = null) {
    const result = this._setHsvFieldNoFire(key, field, value, source, origin);
    if (result.status === 'ok') this._fireOnChange([key]);
    return result;
  }

  /** @private — see setHsvField; doesn't fire onChange. */
  _setHsvFieldNoFire(key, field, value, source, origin = null) {
    const entry = this._registryByKey[key];
    if (!entry || entry.type !== 'hsv') {
      return { status: 'ignored', reason: 'not_hsv' };
    }
    if (field !== 'h' && field !== 's' && field !== 'v') {
      return { status: 'ignored', reason: 'bad_field' };
    }
    const cur = this._store[key].value;
    return this._setNoFire(key, { ...cur, [field]: value }, source, origin);
  }

  /**
   * Apply N writes from a single source event (one OSC packet, one
   * future MIDI bundle) atomically. Fires onChange exactly once
   * with the union of changed keys so downstream broadcast + persist
   * see one batch. See docs/24_osc_integration.md §7.1.
   *
   * @param {Array<{kind:'scalar', key:string, value:*}
   *               | {kind:'hsv',  key:string, field:'h'|'s'|'v', value:number}>} writes
   * @param {string} source
   * @param {string} [origin]
   * @returns {{status:'ok', changedKeys:string[], revision:number}}
   */
  setMany(writes, source, origin = null) {
    const changedKeys = [];
    if (Array.isArray(writes)) {
      for (const w of writes) {
        if (!w || typeof w !== 'object') continue;
        const result = (w.kind === 'hsv')
          ? this._setHsvFieldNoFire(w.key, w.field, w.value, source, origin)
          : this._setNoFire(w.key, w.value, source, origin);
        if (result.status === 'ok') changedKeys.push(w.key);
      }
    }
    if (changedKeys.length > 0) this._fireOnChange(changedKeys);
    return { status: 'ok', changedKeys, revision: this._revision };
  }

  /**
   * Subscribe to post-mutation events. Returns an unsubscribe fn.
   * Subscribers fire in registration order, BEFORE the legacy
   * `onChange` slot. A throwing subscriber is logged and skipped
   * so it can never break the fan-out chain.
   *
   * @param {(ev: { changedKeys: string[], state: object }) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('paramCenter.subscribe requires a function');
    }
    this._subscribers.push(fn);
    return () => {
      this._subscribers = this._subscribers.filter(s => s !== fn);
    };
  }

  /** @private — emit onChange to every subscriber + the legacy slot. */
  _fireOnChange(changedKeys) {
    const ev = { changedKeys, state: this.getCanonicalState() };
    for (const fn of this._subscribers) {
      try { fn(ev); }
      catch (e) { console.warn(`[CPC] subscriber threw: ${e && e.message}`); }
    }
    if (this.onChange) {
      try { this.onChange(ev); }
      catch (e) { console.warn(`[CPC] onChange threw: ${e && e.message}`); }
    }
  }

  /**
   * Whether any of the given changedKeys references a registry entry
   * with persist:true. Used by the fan-out in api_server.js to skip
   * disk I/O for pure live-param batches. See docs/24 §7.2 / §7.4.
   */
  hasPersistentDirty(changedKeys) {
    if (!Array.isArray(changedKeys)) return false;
    for (const k of changedKeys) {
      const entry = this._registryByKey[k];
      if (entry && entry.persist) return true;
    }
    return false;
  }

  /**
   * Read a single param value by key. Codex P0 — no fallback behaviors:
   * an unknown key throws, never silently returns a default. Used by
   * hot-path consumers that need ONE value per frame (e.g. the
   * AudioAnalyzer reading per-band gains) and don't want to pay the
   * cost of `getAll()` deep-copying the entire store every hop.
   *
   * Returned value is a deep copy for HSV / object types so callers
   * cannot mutate the store. Scalars pass through unchanged.
   *
   * @param {string} key
   * @returns {*}
   * @throws {Error} if `key` is not a registered param
   */
  get(key) {
    const slot = this._store[key];
    if (!slot) throw new Error(`ParamCenter.get: unknown key ${key}`);
    return deepCopy(slot.value);
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
      // New live-param / fan-out fields — docs/24 §7.3.
      live: !!e.live,
      broadcastHz: e.broadcastHz ?? REGISTRY_DEFAULTS.broadcastHz,
      persist: !!e.persist,
      portWatch: e.portWatch !== false,
      // Surfaces engine-owned globals (e.g. `speed`, `size`) so
      // CaptainPad can render them with a small "ENGINE" annotation
      // and patterns can stop trying to bind them as pattern vars.
      engineOwned: !!e.engineOwned,
      // Runtime keys registered from the Audio Companion's signal
      // manifest (registerDynamicLiveParam). CaptainPad surfaces them
      // identically to built-in live keys; the flag lets the UI tag
      // them as Companion-provided if it wants.
      dynamic: !!e._dynamic,
    }));
  }

  // ── Dynamic LIVE params (Audio Companion manifest) ──────────────────────
  //
  // The Audio Companion is the sole analyzer and may stream signals the
  // static audio family doesn't know about (operator adds a new OUTPUT
  // signal in the Companion). Those become RUNTIME live CPC keys here:
  // non-persistent, live:true, broadcast at ~15 Hz, range chosen by the
  // signal type. They are NEVER written to disk (persist:false) and NEVER
  // shadow a built-in key — the caller (api_server) checks
  // `isRegisteredKey` first and only ever passes keys it created here to
  // `deregisterDynamicLiveParam`. See docs/24 §7 + the manifest endpoint.

  /** Whether `key` is a currently-registered CPC param (built-in OR dynamic). */
  isRegisteredKey(key) {
    return !!this._registryByKey[key];
  }

  /** Whether `key` was registered at runtime via registerDynamicLiveParam. */
  isDynamicLiveParam(key) {
    const e = this._registryByKey[key];
    return !!(e && e._dynamic === true);
  }

  /** Snapshot list of dynamic live-param keys (for diffing against a manifest). */
  getDynamicLiveParamKeys() {
    return this._registry.filter(e => e._dynamic === true).map(e => e.key);
  }

  /**
   * Register a non-persistent LIVE CPC key at runtime from a Companion
   * manifest entry. Adds the registry entry, lookup maps, and per-param
   * store slot so getSchema() / get() / set() see it immediately.
   *
   * Idempotent on the (key) — re-registering an existing dynamic key
   * with the same shape is a no-op; re-registering with a DIFFERENT
   * range/oscAddress updates them in place (the Companion is the source
   * of truth for its signals). Refuses to touch a built-in key — that
   * would be a silent override of curated metadata (Codex P0).
   *
   * @param {{ key: string, oscAddress: string, label?: string,
   *           range: [number, number], broadcastHz?: number }} spec
   * @returns {{ status: 'added' | 'updated' }}
   * @throws {Error} if `key` collides with a built-in (non-dynamic) entry.
   */
  registerDynamicLiveParam(spec) {
    const { key, oscAddress, label, range, broadcastHz = 15 } = spec;
    const existing = this._registryByKey[key];
    if (existing && existing._dynamic !== true) {
      throw new Error(
        `registerDynamicLiveParam: "${key}" is a built-in CPC key — refusing to override.`,
      );
    }
    const entry = {
      key,
      label: label || key,
      type: 'float',
      default: 0.0,
      range: [range[0], range[1]],
      clamp: true,
      persist: false,
      live: true,
      broadcastHz,
      portWatch: false,
      oscAddress,
      sharedFnName: key,
      _dynamic: true,
    };
    if (existing) {
      // Update in place — keep the same store slot / current value.
      const idx = this._registry.indexOf(existing);
      this._registry[idx] = entry;
      this._registryByKey[key] = entry;
      this._registryByFnName[entry.sharedFnName] = entry;
      return { status: 'updated' };
    }
    this._registry.push(entry);
    this._registryByKey[key] = entry;
    this._registryByFnName[entry.sharedFnName] = entry;
    this._store[key] = {
      value: deepCopy(entry.default),
      dirty: false,
      lastSource: null,
      lastOrigin: null,
      lastRevision: 0,
    };
    return { status: 'added' };
  }

  /**
   * Remove a dynamic live param previously added via
   * registerDynamicLiveParam. Drops the registry entry, lookup maps, and
   * store slot so getSchema() no longer surfaces it. Refuses to remove a
   * built-in key. No-op for an unknown key (already gone).
   *
   * @param {string} key
   * @returns {boolean} true if a dynamic key was removed.
   * @throws {Error} if `key` is a built-in (non-dynamic) registered key.
   */
  deregisterDynamicLiveParam(key) {
    const entry = this._registryByKey[key];
    if (!entry) return false;
    if (entry._dynamic !== true) {
      throw new Error(
        `deregisterDynamicLiveParam: "${key}" is a built-in CPC key — refusing to remove.`,
      );
    }
    this._registry = this._registry.filter(e => e.key !== key);
    delete this._registryByKey[key];
    if (this._registryByFnName[entry.sharedFnName]
        && this._registryByFnName[entry.sharedFnName].key === key) {
      delete this._registryByFnName[entry.sharedFnName];
    }
    delete this._store[key];
    return true;
  }

  // ── WASM Integration ──────────────────────────────────────────────────

  registerChannel(channelId, handle, exports) {
    this._channels = this._channels || {};
    const controlMap = {};
    const blockedIds = new Set();
    const sharedFnNames = new Set();

    // 1. Find shared* exports — but skip engine-owned entries (e.g.
    // `speed`, `size`). The engine reads those CPC values directly
    // each tick; injecting them as pattern variables would let a
    // pattern shadow the engine's authoritative value.
    //
    // MODULATORS-ONLY AUDIO POLICY (operator decision 2026-06-17): the
    // LIVE audio-family signals (mic bands/flux, dom freq+energy, tempoBpm,
    // structure detector + derived outputs) are NEVER bound into pattern
    // globals here, even when a pattern declares a matching `export var`
    // (e.g. `export var micDomEnergy1`). Audio reactivity must flow through
    // the MODULATION engine driving SLIDER params — patterns do not read
    // CPC audio signals natively. Persistent `*Gain` knobs are NOT in this
    // set (they're operator levels, not signals), so they still bind. All
    // non-audio slider/param exports keep their normal control-write path —
    // the ModulationController depends on it (see modulation_controller.js).
    for (const exp of exports) {
      if (isLiveAudioSharedFnName(exp.name)) continue;
      const entry = this._registryByFnName[exp.name];
      if (entry && !entry.engineOwned) {
        controlMap[entry.key] = { id: exp.id, fnName: exp.name };
        sharedFnNames.add(exp.name);
      }
    }

    // 2. Conflict detection — same engine-owned guard. We don't want
    // to block a `sliderSpeed` local just because `speed` exists in
    // the registry; the engine owns global speed, the pattern keeps
    // its local trim.
    for (const exp of exports) {
      if (sharedFnNames.has(exp.name)) continue;
      const lowerName = exp.name.toLowerCase();
      for (const entry of this._registry) {
        if (entry.engineOwned) continue;
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

  /**
   * Resolve the CPC key + human label for a pattern export, if the
   * export is being driven by the Central Parameter Center on this
   * channel. Returns `null` for purely local exports.
   *
   * Two flavours of "CPC-owned" are recognised — both are surfaced
   * by the CaptainPad UI as disabled "MATCHED" controls (instead of
   * the older behaviour, which hid them entirely):
   *
   *   1. Direct shared-fn match — the export's name is the canonical
   *      shared function (e.g. `colorPalette1`, `size`). These are
   *      what `applySnapshot`/`flushDirty` actively write into.
   *
   *   2. Conflict-blocked match — the export's id is in `blockedIds`
   *      because its name aliases a CPC variable via the
   *      `sliderX` / `hsvPickerX` / `toggleX` naming convention.
   *      The CPC owns the
   *      underlying variable; the local export still exists in the
   *      WASM module but never receives writes through the normal
   *      /control path.
   *
   * @param {string} channelId
   * @param {{ id: number, name: string }} exp — one entry from `wasmHost.getExports`
   * @returns {{ key: string, label: string } | null}
   */
  cpcKeyForExport(channelId, exp) {
    const ch = this._channels?.[channelId];
    if (!ch || !exp) return null;

    // Flavour 1 — direct shared-fn export. Skip engine-owned globals
    // (speed/size); they're never injected so a pattern that happens
    // to export `speed()` would just receive no writes, not be CPC-
    // matched. The MATCHED badge would be misleading.
    const direct = this._registryByFnName[exp.name];
    if (direct && !direct.engineOwned) return { key: direct.key, label: direct.label };

    // Flavour 2 — a blocked export that aliases a registered key
    // via the slider*/hsvPicker*/toggle* convention. Mirrors the
    // detection loop in registerChannel().
    if (ch.blockedIds.has(exp.id)) {
      const lowerName = exp.name.toLowerCase();
      for (const entry of this._registry) {
        const suffix = entry.key.toLowerCase();
        if (!ch.controlMap[entry.key]) continue;
        if (lowerName === `slider${suffix}` ||
            lowerName === `hsvpicker${suffix}` ||
            lowerName === `toggle${suffix}`) {
          return { key: entry.key, label: entry.label };
        }
      }
    }
    return null;
  }

  applySnapshot(wasmHost) {
    // Pattern swap: snap rendered color to the target (the PATTERN
    // changed, not the color — no fade), so the new pattern boots at
    // the current palette and any in-flight ramp is cancelled. docs/36.
    for (const key of this._slewKeys) {
      this._rendered[key] = deepCopy(this._store[key].value);
      this._rampFrom[key] = null;
      this._rampStartMs[key] = null;
    }
    for (const chId in this._channels) {
      this._applyToHandle(wasmHost, this._channels[chId]);
    }
    for (const key in this._store) {
      this._store[key].dirty = false;
    }
  }

  /**
   * Advance the color-transition ramps one frame and mark the slewed
   * params dirty while they're still moving so flushDirty() injects the
   * interpolated value. Call once per engine frame BEFORE flushDirty().
   * No-op (zero cost) once every ramp has settled. docs/36 §4.3.
   * @param {number} nowMs — monotonic clock (engine passes performance.now())
   */
  tickColorTransitions(nowMs) {
    const transSlot = this._store.colorTransitionMs;
    const transMs = transSlot ? transSlot.value : 0;
    for (const key of this._slewKeys) {
      const from = this._rampFrom[key];
      if (from === null) continue; // settled — nothing to do
      if (this._rampStartMs[key] === null) this._rampStartMs[key] = nowMs;
      const target = this._store[key].value;
      const t = transMs <= 0
        ? 1
        : clamp01((nowMs - this._rampStartMs[key]) / transMs);
      this._rendered[key] = lerpHsv(from, target, easeInOut(t));
      this._store[key].dirty = true; // force injection of _rendered
      if (t >= 1) {
        this._rendered[key] = deepCopy(target);
        this._rampFrom[key] = null;
        this._rampStartMs[key] = null;
      }
    }
  }

  /** @private — value to inject into WASM for a key (rendered if slewed). */
  _injectValue(entry, slot) {
    return entry.slew ? this._rendered[entry.key] : slot.value;
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
        const v = this._injectValue(entry, slot);
        wasmHost.setControl(ch.handle, mapping.id, v.h, v.s, v.v);
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
          const v = this._injectValue(entry, slot);
          wasmHost.setControl(ch.handle, mapping.id, v.h, v.s, v.v);
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
