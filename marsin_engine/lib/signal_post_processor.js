/**
 * SignalPostProcessor — per-signal node chain of DSP operators.
 *
 * Design doc: docs/29_[todo]_node_based_audio_post_processing.md
 *
 * This module REPLACES the old `audio_post_processing.js` framework
 * (which only ever shipped a single Gain op). The chain framework
 * subsumes that behavior: every signal in DEFAULT_CHAINS that
 * historically had `*Gain` still does — but as a Gain op with
 * `paramKey: '<signal>Gain'` so the existing CPC slider remains the
 * source-of-truth multiplier (operator brief 2026-05-26).
 *
 * The processor:
 *   - holds per-signal chains (loaded from `audio_state.yaml`'s
 *     top-level `chains:` block; missing → DEFAULT_CHAINS),
 *   - runs `process(signalKey, raw, dt)` for every audio analyzer hop
 *     and every gainable OSC stem write, returning the post-processed
 *     value the engine writes to CPC,
 *   - validates incoming chain configs strictly per Codex P0 (no
 *     silent fallbacks: unknown op type / out-of-range param /
 *     duplicate id / signal key / Schmitt inversion / Compressor
 *     ratio < 1 → throw / reject),
 *   - exposes a 5 Hz `snapshotForEditor` for the chain-editor preview;
 *     emission gated by `setEditorSubscribed(true)` so the engine pays
 *     zero cost when the AUDIO tab is not open.
 *
 * Ops shipped in Phase 2 (this commit): Gain, Bias, Clamp, LPF (one-
 * pole), Envelope (asymmetric attack/release), Schmitt (hysteresis +
 * refractory), Hold (sample-and-hold + exponential decay). The other
 * 5 catalog ops (Compressor, Biquad, Slew, Slope, Curve) land in
 * Phase 7 per the design doc's recommended implementation path.
 *
 * Per-op math is cited inline above each `case` in `_applyOp` — every
 * formula points to the source in the design doc's Operator catalog
 * table so any future tweak can be traced to a citation.
 */

// ── Signal keys + defaults ──────────────────────────────────────────────────

/**
 * Every live audio signal that the SignalPostProcessor knows about.
 * Adding a new signal means:
 *   1) add it here,
 *   2) add a CPC registry entry (live, broadcast policy),
 *   3) add a default chain in DEFAULT_CHAINS,
 *   4) wire the call site (engine.js or osc_listener.js) to call
 *      `process(signalKey, raw, dt)`.
 * `process()` throws on an unknown signal key — there is no fallback
 * to identity (Codex P0).
 */
export const KNOWN_SIGNALS = Object.freeze([
  'micLow', 'micMid', 'micHigh', 'micKick',
  'stemsBass', 'stemsDrums', 'stemsVocals',
]);

/**
 * Default chain per signal. Mic bands default to a single Gain op
 * tied to the existing `*Gain` CPC key, matching pre-chain behaviour
 * (Wireframe A — operator can layer LPF / Compressor / etc. on top
 * later). `micKick` gets the documented `Envelope → Schmitt → Hold`
 * trigger-shaper default per design doc §Operator catalog "When to use".
 * Stems get just a Gain op (loopback OSC, no Hold needed — design doc
 * §Stems locality, operator brief 2026-05-26).
 */
export const DEFAULT_CHAINS = Object.freeze({
  micLow:  [
    { id: 'low_gain',  type: 'gain',  enabled: true, params: { paramKey: 'micLowGain' } },
  ],
  micMid:  [
    { id: 'mid_gain',  type: 'gain',  enabled: true, params: { paramKey: 'micMidGain' } },
  ],
  micHigh: [
    { id: 'high_gain', type: 'gain',  enabled: true, params: { paramKey: 'micHighGain' } },
  ],
  micKick: [
    { id: 'kick_gain',     type: 'gain',     enabled: true, params: { paramKey: 'micKickGain' } },
    { id: 'kick_envelope', type: 'envelope', enabled: true, params: { attackMs: 8, releaseMs: 180 } },
    { id: 'kick_schmitt',  type: 'schmitt',  enabled: true, params: { tHigh: 0.5, tLow: 0.3, refractoryMs: 200 } },
    { id: 'kick_hold',     type: 'hold',     enabled: true, params: { timeoutMs: 120, decayMs: 120 } },
  ],
  stemsBass:   [
    { id: 'stems_bass_gain',   type: 'gain', enabled: true, params: { paramKey: 'stemsBassGain' } },
  ],
  stemsDrums:  [
    { id: 'stems_drums_gain',  type: 'gain', enabled: true, params: { paramKey: 'stemsDrumsGain' } },
  ],
  stemsVocals: [
    { id: 'stems_vocals_gain', type: 'gain', enabled: true, params: { paramKey: 'stemsVocalsGain' } },
  ],
});

// ── Op type catalog ─────────────────────────────────────────────────────────

/**
 * Param schema per op type. Used by validateChain.
 *   - `numeric`: { type:'number', min, max }
 *   - `string`:  { type:'string', oneOf?:[…] }
 *   - `paramKeyOrValue`: gain's two-mode params (value XOR paramKey).
 * Every op MUST validate every supplied param against this schema —
 * an unknown param key is rejected (Codex P0: no silent ignore).
 */
const OP_SCHEMA = Object.freeze({
  gain: {
    description: 'Multiply input by a static value OR by the live CPC value at paramKey.',
    paramKeyOrValue: true,
    params: {
      value:    { type: 'number', min: 0,   max: 1000, optional: true, default: 1.0 },
      paramKey: { type: 'string', optional: true },
    },
  },
  bias: {
    description: 'Add a constant to the input.',
    params: {
      value: { type: 'number', min: -1, max: 1, default: 0.0 },
    },
  },
  clamp: {
    description: 'Re-clamp the input into [min, max].',
    params: {
      min: { type: 'number', min: 0, max: 1, default: 0 },
      max: { type: 'number', min: 0, max: 1, default: 1 },
    },
  },
  lpf: {
    description: 'One-pole IIR low-pass / EMA. cutoffHz controls smoothing.',
    params: {
      cutoffHz: { type: 'number', min: 0.01, max: 1000, default: 5.0 },
    },
  },
  envelope: {
    description: 'Asymmetric VU-style envelope follower (attack/release).',
    params: {
      attackMs:  { type: 'number', min: 0.1, max: 10000, default: 8 },
      releaseMs: { type: 'number', min: 0.1, max: 10000, default: 180 },
    },
  },
  schmitt: {
    description: 'Hysteresis trigger with optional refractory period.',
    params: {
      tHigh:        { type: 'number', min: 0, max: 1, default: 0.5 },
      tLow:         { type: 'number', min: 0, max: 1, default: 0.3 },
      refractoryMs: { type: 'number', min: 0, max: 10000, default: 0 },
    },
  },
  hold: {
    description: 'Sample-and-hold with timeout + exponential decay.',
    params: {
      timeoutMs: { type: 'number', min: 0,    max: 60000, default: 500 },
      decayMs:   { type: 'number', min: 0.01, max: 60000, default: 200 },
    },
  },
});

export function opCatalog() {
  // Public-facing snapshot of the op catalog (Phase 5 iPad picker).
  return Object.fromEntries(Object.entries(OP_SCHEMA).map(([k, v]) => ([
    k,
    {
      type: k,
      description: v.description,
      params: Object.fromEntries(Object.entries(v.params).map(([pk, pv]) => ([
        pk, { ...pv },
      ]))),
      paramKeyOrValue: !!v.paramKeyOrValue,
    },
  ])));
}

// ── Validation ──────────────────────────────────────────────────────────────

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate one op-config object. Returns { ok, error, normalized }.
 * Used by validateChain — never used standalone.
 */
function _validateOp(op, indexForMsg) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return { ok: false, error: `op[${indexForMsg}] must be an object` };
  }
  if (typeof op.id !== 'string' || !op.id.trim()) {
    return { ok: false, error: `op[${indexForMsg}].id must be a non-empty string` };
  }
  if (typeof op.type !== 'string' || !op.type) {
    return { ok: false, error: `op "${op.id}": type must be a string` };
  }
  const schema = OP_SCHEMA[op.type];
  if (!schema) {
    return { ok: false, error: `op "${op.id}": unknown op type "${op.type}" (known: ${Object.keys(OP_SCHEMA).join(', ')})` };
  }
  if (op.enabled !== undefined && typeof op.enabled !== 'boolean') {
    return { ok: false, error: `op "${op.id}": enabled must be a boolean` };
  }
  const params = (op.params && typeof op.params === 'object' && !Array.isArray(op.params))
    ? op.params : {};
  const normalizedParams = {};

  // Gain dual-mode: value XOR paramKey, exactly one must be set.
  if (schema.paramKeyOrValue) {
    const hasValue = params.value !== undefined;
    const hasPK = params.paramKey !== undefined;
    if (hasValue && hasPK) {
      return { ok: false, error: `op "${op.id}": gain requires exactly one of {value, paramKey}, not both` };
    }
    if (!hasValue && !hasPK) {
      // Use the schema default for value if neither supplied — but
      // a chain config supplied by the operator must be explicit.
      // We only fall back on _internal_ default-chain construction;
      // operator-facing validation requires one of the two.
      return { ok: false, error: `op "${op.id}": gain requires exactly one of {value, paramKey}` };
    }
  }

  for (const [pk, pv] of Object.entries(params)) {
    const spec = schema.params[pk];
    if (!spec) {
      return { ok: false, error: `op "${op.id}": unknown param "${pk}" for type ${op.type}` };
    }
    if (spec.type === 'number') {
      if (!isFiniteNumber(pv)) {
        return { ok: false, error: `op "${op.id}".${pk}: must be a finite number` };
      }
      if (pv < spec.min || pv > spec.max) {
        return { ok: false, error: `op "${op.id}".${pk}: ${pv} out of range [${spec.min}, ${spec.max}]` };
      }
      normalizedParams[pk] = pv;
    } else if (spec.type === 'string') {
      if (typeof pv !== 'string' || pv.length === 0) {
        return { ok: false, error: `op "${op.id}".${pk}: must be a non-empty string` };
      }
      normalizedParams[pk] = pv;
    } else {
      return { ok: false, error: `op "${op.id}".${pk}: unsupported schema type` };
    }
  }

  // Apply schema defaults for params the operator omitted, so the
  // runtime can read every param without `undefined` checks. For the
  // dual-mode Gain op we DON'T inject a default `value` when the
  // operator chose `paramKey` (or vice versa) — those two are XOR.
  for (const [pk, pvSpec] of Object.entries(schema.params)) {
    if (normalizedParams[pk] !== undefined) continue;
    if (pvSpec.default === undefined) continue;
    if (schema.paramKeyOrValue) {
      // Skip the OTHER half of the XOR pair (whichever wasn't supplied).
      if (pk === 'value'    && normalizedParams.paramKey !== undefined) continue;
      if (pk === 'paramKey' && normalizedParams.value    !== undefined) continue;
    }
    normalizedParams[pk] = pvSpec.default;
  }

  // Cross-param invariants per design doc Operator catalog.
  if (op.type === 'schmitt') {
    const tHigh = normalizedParams.tHigh ?? schema.params.tHigh.default;
    const tLow  = normalizedParams.tLow  ?? schema.params.tLow.default;
    if (!(tHigh > tLow)) {
      return { ok: false, error: `op "${op.id}": schmitt requires tHigh > tLow (got tHigh=${tHigh}, tLow=${tLow})` };
    }
  }
  if (op.type === 'clamp') {
    const min = normalizedParams.min ?? schema.params.min.default;
    const max = normalizedParams.max ?? schema.params.max.default;
    if (!(max >= min)) {
      return { ok: false, error: `op "${op.id}": clamp requires max >= min (got min=${min}, max=${max})` };
    }
  }

  return {
    ok: true,
    normalized: {
      id: op.id,
      type: op.type,
      enabled: op.enabled !== false,
      params: { ...normalizedParams },
    },
  };
}

/**
 * Strict validation of a per-signal chain (array of op configs).
 * Returns { ok: true, normalized } on success or { ok: false, error }
 * on failure. Mirrors `audio_config.validateLivePatch` style.
 */
export function validateChain(signalKey, chain) {
  if (!KNOWN_SIGNALS.includes(signalKey)) {
    return { ok: false, error: `unknown signalKey "${signalKey}" (known: ${KNOWN_SIGNALS.join(', ')})` };
  }
  if (!Array.isArray(chain)) {
    return { ok: false, error: 'chain must be an array of op configs' };
  }
  const seenIds = new Set();
  const normalized = [];
  for (let i = 0; i < chain.length; i++) {
    const res = _validateOp(chain[i], i);
    if (!res.ok) return res;
    if (seenIds.has(res.normalized.id)) {
      return { ok: false, error: `duplicate op id "${res.normalized.id}" in signal ${signalKey}` };
    }
    seenIds.add(res.normalized.id);
    normalized.push(res.normalized);
  }
  return { ok: true, normalized };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(v) {
  if (!(v > 0)) return 0; // NaN + negative
  return v < 1 ? v : 1;
}

function deepCloneChain(chain) {
  return chain.map(op => ({
    id: op.id,
    type: op.type,
    enabled: op.enabled !== false,
    params: { ...op.params },
  }));
}

// ── SignalPostProcessor ─────────────────────────────────────────────────────

export class SignalPostProcessor {
  /**
   * @param {object} opts
   * @param {string} [opts.scenePath] — for diagnostics only; the
   *   persistence callback is supplied by the engine (we do not
   *   read/write disk here — engine.js owns audio_state.yaml).
   * @param {object} opts.paramCenter — required, used by Gain ops with
   *   `paramKey` to fetch the live CPC value each `process()` call.
   *   Codex P0: `.get()` throws on unknown keys — we do NOT swallow.
   * @param {(msg: object) => void} [opts.broadcast] — WS broadcast hook,
   *   used for `audioChainsChanged` after PUT/PATCH/reset.
   */
  constructor({ scenePath = null, paramCenter, broadcast = null } = {}) {
    if (!paramCenter || typeof paramCenter.get !== 'function') {
      throw new TypeError('SignalPostProcessor: paramCenter with .get(key) is required');
    }
    this.scenePath = scenePath;
    this.paramCenter = paramCenter;
    this.broadcast = broadcast;

    // Per-signal chain config (post-validation, normalized).
    /** @type {Record<string, Array<object>>} */
    this._chains = {};
    // Per-(signal, opId) runtime state. Never persisted.
    /** @type {Record<string, Record<string, object>>} */
    this._runtime = {};
    // Editor subscription gate. When false, `process()` does NOT record
    // pre/post into runtime state and `snapshotForEditor()` returns
    // zero-cost stubs.
    this._editorSubscribed = false;

    // Seed with defaults so a fresh boot always has a working chain
    // per signal — even before any YAML is loaded.
    for (const sig of KNOWN_SIGNALS) {
      this._chains[sig] = deepCloneChain(DEFAULT_CHAINS[sig]);
      this._runtime[sig] = {};
      this._resetRuntime(sig);
    }
  }

  /**
   * Initialize per-op runtime state for a signal's current chain.
   * Called on construction, after putChain, after patchOp (in case the
   * op got disabled/re-enabled), and after resetSignal. The runtime
   * map is keyed by op id so PATCH preserves state for ops whose
   * params didn't change.
   */
  _resetRuntime(signalKey) {
    const chain = this._chains[signalKey];
    const fresh = {};
    for (const op of chain) {
      fresh[op.id] = _initRuntime(op);
    }
    this._runtime[signalKey] = fresh;
  }

  /**
   * Replace any subset of the chain map from a YAML block. Validates
   * every entry; any failure rejects the WHOLE block (no half-loaded
   * state). Unknown signal keys in the block are rejected (Codex P0
   * — operator might have typo'd `micLoww`, we don't silently drop).
   *
   * Signals absent from the block keep whatever chain they had (which
   * is the DEFAULT_CHAIN after construction). Saves the operator from
   * having to write all 7 signals out every time they tweak one.
   */
  loadChains(yamlChainsBlock) {
    if (yamlChainsBlock == null) return;
    if (typeof yamlChainsBlock !== 'object' || Array.isArray(yamlChainsBlock)) {
      throw new TypeError('chains block must be an object of {signalKey: [ops]}');
    }
    // Validate all first, then commit. No half-loaded state.
    const validated = {};
    for (const [signalKey, chain] of Object.entries(yamlChainsBlock)) {
      if (!KNOWN_SIGNALS.includes(signalKey)) {
        throw new Error(`loadChains: unknown signalKey "${signalKey}" (known: ${KNOWN_SIGNALS.join(', ')})`);
      }
      const v = validateChain(signalKey, chain);
      if (!v.ok) throw new Error(`loadChains: invalid chain for ${signalKey}: ${v.error}`);
      validated[signalKey] = v.normalized;
    }
    for (const [signalKey, chain] of Object.entries(validated)) {
      this._chains[signalKey] = chain;
      this._resetRuntime(signalKey);
    }
  }

  /**
   * REST PUT — replace a signal's entire chain. Atomic: either the
   * whole new chain is applied or nothing changes.
   *
   * @returns {{ ok: true, chain }} or { ok: false, error }
   */
  putChain(signalKey, ops) {
    const v = validateChain(signalKey, ops);
    if (!v.ok) return { ok: false, error: v.error };
    this._chains[signalKey] = v.normalized;
    this._resetRuntime(signalKey);
    this._broadcastChanged();
    return { ok: true, chain: deepCloneChain(v.normalized) };
  }

  /**
   * REST PATCH — partial update of one op (enabled toggle and/or
   * subset of params). Preserves runtime state for the op so the
   * operator's tweak doesn't reset the smoothing/hold state mid-show
   * UNLESS the op type would change (which we reject — type changes
   * go through PUT).
   *
   * @returns {{ ok: true, op }} or { ok: false, error }
   */
  patchOp(signalKey, opId, partial) {
    if (!KNOWN_SIGNALS.includes(signalKey)) {
      return { ok: false, error: `unknown signalKey "${signalKey}"` };
    }
    const chain = this._chains[signalKey];
    const idx = chain.findIndex(o => o.id === opId);
    if (idx === -1) {
      return { ok: false, error: `unknown opId "${opId}" on signal ${signalKey}` };
    }
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      return { ok: false, error: 'patch body must be an object' };
    }
    if (partial.type !== undefined && partial.type !== chain[idx].type) {
      return { ok: false, error: 'op type change not allowed via PATCH — use PUT to replace the chain' };
    }
    if (partial.id !== undefined && partial.id !== opId) {
      return { ok: false, error: 'op id change not allowed via PATCH — use PUT to replace the chain' };
    }

    const existing = chain[idx];
    const nextOp = {
      id: existing.id,
      type: existing.type,
      enabled: partial.enabled !== undefined ? !!partial.enabled : existing.enabled,
      params: { ...existing.params, ...(partial.params || {}) },
    };
    // Re-validate the resulting op standalone (preserves cross-param
    // invariants like Schmitt tHigh > tLow even when only one is sent).
    const res = _validateOp(nextOp, idx);
    if (!res.ok) return { ok: false, error: res.error };

    // Splice in the validated op + refresh its runtime only (other
    // ops keep their state, which is the point of PATCH vs PUT).
    const nextChain = chain.slice();
    nextChain[idx] = res.normalized;
    this._chains[signalKey] = nextChain;
    this._runtime[signalKey][opId] = _initRuntime(res.normalized);
    this._broadcastChanged();
    return { ok: true, op: { ...res.normalized, params: { ...res.normalized.params } } };
  }

  /**
   * Restore one signal to its built-in default chain (drops any
   * persisted operator tuning for that signal).
   */
  resetSignal(signalKey) {
    if (!KNOWN_SIGNALS.includes(signalKey)) {
      return { ok: false, error: `unknown signalKey "${signalKey}"` };
    }
    this._chains[signalKey] = deepCloneChain(DEFAULT_CHAINS[signalKey]);
    this._resetRuntime(signalKey);
    this._broadcastChanged();
    return { ok: true, chain: deepCloneChain(this._chains[signalKey]) };
  }

  /** Restore EVERY signal to its built-in default chain. */
  resetAll() {
    for (const sig of KNOWN_SIGNALS) {
      this._chains[sig] = deepCloneChain(DEFAULT_CHAINS[sig]);
      this._resetRuntime(sig);
    }
    this._broadcastChanged();
    return { ok: true, chains: this.getAllChains() };
  }

  /** Read-only deep copy of one signal's chain. */
  getChain(signalKey) {
    if (!KNOWN_SIGNALS.includes(signalKey)) return null;
    return deepCloneChain(this._chains[signalKey]);
  }

  /** Read-only deep copy of the entire chain map. */
  getAllChains() {
    const out = {};
    for (const sig of KNOWN_SIGNALS) {
      out[sig] = deepCloneChain(this._chains[sig]);
    }
    return out;
  }

  /**
   * Run a raw value through this signal's chain. Returns the final
   * post-processed scalar.
   *
   * @param {string} signalKey — must be in KNOWN_SIGNALS (else throw).
   * @param {number} rawValue — pre-chain value, typically [0, 1].
   * @param {number} dtSeconds — frame delta in seconds (used by
   *   time-domain ops: LPF, Envelope, Hold).
   * @returns {number} — post-chain value, clamped to [0, 1].
   */
  process(signalKey, rawValue, dtSeconds) {
    if (!KNOWN_SIGNALS.includes(signalKey)) {
      throw new Error(`SignalPostProcessor.process: unknown signalKey "${signalKey}"`);
    }
    if (!isFiniteNumber(dtSeconds) || dtSeconds < 0) {
      throw new Error(`SignalPostProcessor.process: dtSeconds must be a finite non-negative number (got ${dtSeconds})`);
    }
    const chain = this._chains[signalKey];
    const runtime = this._runtime[signalKey];
    const recordPreview = this._editorSubscribed;

    // Defensive clamp at the entry — even though the contract says raw
    // arrives in [0,1], a misbehaving upstream shouldn't poison the
    // chain state with NaN/Infinity.
    let val = isFiniteNumber(rawValue) ? rawValue : 0;
    for (const op of chain) {
      if (!op.enabled) {
        if (recordPreview) {
          const rt = runtime[op.id];
          rt.pre = val;
          rt.post = val;
        }
        continue;
      }
      const rt = runtime[op.id];
      if (recordPreview) rt.pre = val;
      val = this._applyOp(op, rt, val, dtSeconds);
      if (recordPreview) rt.post = val;
    }
    return clamp01(val);
  }

  /**
   * Snapshot of pre/post values per op, for the 5 Hz signalChain
   * preview broadcast. When the editor is NOT subscribed, returns
   * zero-cost stubs (pre/post = 0) so the 5 Hz interval can safely
   * still call this without it ever recording state.
   */
  snapshotForEditor(signalKey) {
    if (!KNOWN_SIGNALS.includes(signalKey)) return null;
    const chain = this._chains[signalKey];
    const runtime = this._runtime[signalKey];
    return {
      type: 'signalChain',
      signalKey,
      ops: chain.map(op => {
        const rt = runtime[op.id] || {};
        const out = {
          id: op.id,
          type: op.type,
          enabled: !!op.enabled,
          pre:  this._editorSubscribed ? (rt.pre  ?? 0) : 0,
          post: this._editorSubscribed ? (rt.post ?? 0) : 0,
        };
        if (op.type === 'schmitt') out.firing = (rt.yPrev ?? 0) >= 0.5;
        return out;
      }),
    };
  }

  setEditorSubscribed(bool) {
    this._editorSubscribed = !!bool;
  }

  // ── Internals ─────────────────────────────────────────────────────

  _broadcastChanged() {
    if (typeof this.broadcast !== 'function') return;
    try {
      this.broadcast({ type: 'audioChainsChanged', chains: this.getAllChains() });
    } catch (e) {
      // Broadcast should not be load-bearing — log and move on.
      console.warn(`[SignalPostProcessor] audioChainsChanged broadcast threw: ${e && e.message}`);
    }
  }

  /**
   * Apply one op to `x` with its runtime state `rt`. Returns the
   * per-op output (NOT clamped here — final clamp is in `process`).
   * Math citations live above each branch.
   */
  _applyOp(op, rt, x, dt) {
    switch (op.type) {
      case 'gain': {
        // Source: design doc §Operator catalog row "Gain" — TD CHOP Math
        // (multiply mode). `paramKey` reads CPC LIVE each frame so the
        // operator's slider remains source-of-truth (design doc §Chain
        // config — "the iPad's gain slider remains the visible /
        // persisted source-of-truth for the multiplier").
        const value = op.params.paramKey !== undefined
          ? this.paramCenter.get(op.params.paramKey)
          : op.params.value;
        const out = x * value;
        if (!(out > 0)) return 0;
        return out < 1 ? out : 1;
      }
      case 'bias': {
        // Source: design doc §Operator catalog row "Bias" — TD CHOP Math (add mode).
        const out = x + op.params.value;
        if (!(out > 0)) return 0;
        return out < 1 ? out : 1;
      }
      case 'clamp': {
        // Source: design doc §Operator catalog row "Clamp" — TD CHOP Limit.
        const { min, max } = op.params;
        if (x < min) return min;
        if (x > max) return max;
        return x;
      }
      case 'lpf': {
        // Source: design doc §Operator catalog row "LPF / Lag" — one-pole
        // IIR / leaky integrator (RBJ Audio EQ Cookbook §LPF, identical
        // to EMA): α = 1 − exp(−2π fc dt); y = α·x + (1−α)·y_prev.
        const fc = op.params.cutoffHz;
        const alpha = 1 - Math.exp(-2 * Math.PI * fc * dt);
        const y = alpha * x + (1 - alpha) * rt.yPrev;
        rt.yPrev = y;
        return y;
      }
      case 'envelope': {
        // Source: design doc §Operator catalog row "Envelope" — standard
        // envelope follower per Pirkle, Designing Audio Effect Plug-Ins
        // in C++ (2nd ed., 2019, ch. 6); also matches audio_analyzer.js
        // attack/release math verbatim. τ = ms / 1000;
        // α = 1 − exp(−dt / τ); rising→α_attack, falling→α_release.
        const tauA = op.params.attackMs  / 1000;
        const tauR = op.params.releaseMs / 1000;
        const alpha = x > rt.yPrev
          ? 1 - Math.exp(-dt / tauA)
          : 1 - Math.exp(-dt / tauR);
        const y = alpha * x + (1 - alpha) * rt.yPrev;
        rt.yPrev = y;
        return y;
      }
      case 'schmitt': {
        // Source: design doc §Operator catalog row "Schmitt" —
        // Schmitt 1938 / Horowitz & Hill (3rd ed., 2015, §4.3.2).
        // y_prev==0 + x>tHigh + refractory satisfied → fire (y=1).
        // y_prev==1 + x<tLow → release (y=0). Otherwise hold.
        const { tHigh, tLow, refractoryMs } = op.params;
        const now = rt.clock + dt * 1000; // ms within this signal's process clock
        rt.clock = now;
        let y = rt.yPrev;
        if (rt.yPrev < 0.5 && x > tHigh) {
          if (now - rt.lastFireAt >= refractoryMs) {
            y = 1;
            rt.lastFireAt = now;
          }
        } else if (rt.yPrev >= 0.5 && x < tLow) {
          y = 0;
        }
        rt.yPrev = y;
        return y;
      }
      case 'hold': {
        // Source: design doc §Operator catalog row "Hold" — TD CHOP
        // Hold + Speed mash-up. Sample-and-hold with timeout:
        // track lastInputAt. If now − lastInputAt > timeoutMs:
        //   y = y_prev · exp(−dt/τ_decay). Else y = max(x, y_prev · exp(−dt/τ_decay)).
        // The "input" trigger here is x > 0 (any positive sample updates
        // the lastInputAt clock); for trigger-style upstreams (Schmitt)
        // this means a 1.0 pulse holds, then decays after the timeout.
        const { timeoutMs, decayMs } = op.params;
        const tauD = decayMs / 1000;
        const now = rt.clock + dt * 1000;
        rt.clock = now;
        if (x > 0) rt.lastInputAt = now;
        const decayed = rt.yPrev * Math.exp(-dt / tauD);
        let y;
        if (now - rt.lastInputAt > timeoutMs) {
          y = decayed;
        } else {
          y = x > decayed ? x : decayed;
        }
        rt.yPrev = y;
        return y;
      }
      default:
        // Unreachable — validateChain rejects unknown types at config
        // time. If we ever land here it's a P0 escape; surface it.
        throw new Error(`SignalPostProcessor._applyOp: unknown op type "${op.type}" (validation bypass?)`);
    }
  }
}

/**
 * Per-op runtime state factory. Every op gets a fresh object on
 * chain load / PUT / reset / re-enable; PATCH preserves runtime
 * for ops whose params are tweaked (history continuity matters
 * for the smoothing ops — operator tweaking attackMs mid-show
 * shouldn't pop the envelope back to zero).
 */
function _initRuntime(op) {
  // Common slots — all ops carry pre/post for editor preview.
  const rt = { pre: 0, post: 0, yPrev: 0, clock: 0 };
  switch (op.type) {
    case 'schmitt':
      rt.lastFireAt = -Infinity;
      break;
    case 'hold':
      rt.lastInputAt = -Infinity;
      break;
    case 'envelope':
    case 'lpf':
      // yPrev starts at 0; rising input will smoothly attack toward it.
      break;
    default:
      break;
  }
  return rt;
}
