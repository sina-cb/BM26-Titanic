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
 * Ops shipped in Phase 2: Gain, Bias, Clamp, LPF (one-pole),
 * Envelope (asymmetric attack/release), Schmitt (hysteresis +
 * refractory), Hold (sample-and-hold + exponential decay).
 *
 * Ops shipped in Phase 7 (closes docs/29 Phase 7 — full 12-op catalog
 * for operator chain authoring): Curve, Slew Limiter, Compressor,
 * Biquad LPF, Slope. Each cites its source formula in a comment above
 * its `_applyOp` case (Katz / RBJ EQ Cookbook / TD CHOP / matches
 * `modulation_engine.js applyCurve()`).
 *
 * Op shipped in Phase 8 (this commit): Normalizer — a per-sample causal
 * AGC built from a dual floor/peak envelope follower (Pirkle / Zölzer
 * DAFX adaptive level) so a new venue/mic auto-levels without hand
 * re-tuning PRE_CLAMP_GAIN / bands.noiseGate. See docs/34 for the
 * calibration-tool companion.
 *
 * Per-op math is cited inline above each `case` in `_applyOp` — every
 * formula points to the source in the design doc's Operator catalog
 * table so any future tweak can be traced to a citation.
 */

import {
  processedSignalKeys,
  defaultGainChainFor,
  gainOpIdFor,
} from './audio_signals.js';

// ── DanceMaker spring (ONE source of truth) ──────────────────────────────────
// The critically-damped spring that turns a jumpy dom freq into the smooth
// "dance" (the gliding orbs). Historically lived inline in companion_server.js
// (`springStep`, `DANCE_OMEGA`). Promoted here so BOTH the legacy dom-dance
// visualizer AND the `danceMaker` op call the EXACT same math — no fork
// (codex P0; docs/37 §2.2 "Must reproduce the current dance exactly").
//
// Default stiffness ω = 7 rad/s → ~0.4 s settle, no overshoot (critically
// damped: k = ω², damping c = 2ω). One explicit-Euler integration step:
//   v += (k·(target − x) − c·v)·dt ;  x += v·dt
export const DANCE_OMEGA = 7;
// Forward (explicit) Euler is only stable while ω is small vs the hop rate; at
// the analyzer hop (and worse on a frame hiccup) a high ω makes the spring
// DIVERGE to huge finite values that slip past the non-finite guard and get
// emitted over OSC. Cap ω at 40 — both here (defence-in-depth for any caller)
// and in the danceMaker op validator. See review 20260618_8 (P1).
export const DANCE_OMEGA_MAX = 40;
export function danceSpringStep(x, v, target, dt, omega = DANCE_OMEGA) {
  if (!(omega >= 0)) omega = DANCE_OMEGA;     // NaN/negative → default
  if (omega > DANCE_OMEGA_MAX) omega = DANCE_OMEGA_MAX;
  const k = omega * omega, c = 2 * omega;
  v += (k * (target - x) - c * v) * dt;
  x += v * dt;
  return [x, v];
}

// ── Signal keys + defaults ──────────────────────────────────────────────────

/**
 * Every live audio signal that the SignalPostProcessor knows about.
 * This is DERIVED from `lib/audio_signals.js` (the single source of
 * truth for the audio signal family) — NOT hand-listed. Adding a new
 * audio signal is now a one-line descriptor edit there; this set, the
 * CPC registry, DEFAULT_CHAINS, the osc_listener maps, and CaptainPad's
 * live-key set all follow automatically.
 * `process()` throws on an unknown signal key — there is no fallback
 * to identity (Codex P0).
 */
export const KNOWN_SIGNALS = Object.freeze(processedSignalKeys());

/**
 * Default chain per signal. Mic bands + stems default to a single Gain
 * op tied to the existing `*Gain` CPC key, matching pre-chain behaviour
 * (Wireframe A — operator can layer LPF / Compressor / etc. on top
 * later). Those gain-only defaults are DERIVED from `audio_signals.js`
 * via `defaultGainChainFor(key)` so the gain paramKey + op id stay in
 * lockstep with the registry.
 *
 * `micKick` is the ONE exception: it gets the documented
 * `Envelope → Schmitt → Hold` trigger-shaper default (design doc
 * §Operator catalog "When to use"). That chain carries DSP-tuning params
 * (attack/release/hysteresis/decay) that are post-processing BEHAVIOUR,
 * not family metadata, so it stays hand-written HERE — `audio_signals.js`
 * only flags micKick as `defaultChainKind: 'kickTrigger'` and leaves the
 * params to this module. Its leading Gain op id (`kick_gain`) and paramKey
 * still come from `gainOpIdFor`/the descriptor so even that stays in sync.
 */
// Per-signal LPF smoothing cutoff (Hz), tuned against the miced real-EDM
// corpus (report 202606/..._audio_corpus_tuning.md §Task C). The non-kick
// signals shipped GAIN-ONLY (no smoothing → visible flicker on the lights);
// a one-pole LPF tuned to each signal's musical character makes low/mid/high
// dance-smooth while preserving the beat-locked pulse, and gives flux a
// gentle build-up glow. Measured on miced real audio: e.g. micLow flicker
// 6.5→4.2 Hz, micFlux 54.6→34.8 Hz, pulse depth preserved.
// Per-signal smoothing-LPF cutoffs. mic bands raised to 5.5/8/14 Hz (was
// 3.5/5.5/10) — EDM corpus tuning: ~30% faster band rise (low 73→52 ms, mid
// 50→38 ms) with flicker essentially unchanged. The LPF, not the analyzer
// envelope, is the band responsiveness lever. micFlux kept gentle for a
// build-up glow. (report 202606 audio tuning.)
const SMOOTHING_HZ = Object.freeze({
  micLow: 5.5, micMid: 8.0, micHigh: 14.0, micFlux: 4.5,
});

export const DEFAULT_CHAINS = Object.freeze(buildDefaultChains());

function buildDefaultChains() {
  const out = {};
  for (const key of KNOWN_SIGNALS) {
    if (key === 'micKick') {
      // PULSE-SHAPER (not a de-bouncer). With the analyzer's refractory now at
      // 220 ms the RAW kick is already one clean pulse per hit, so this chain
      // only SHAPES it: schmitt latches the decaying pulse into a crisp 0/1
      // square (tHigh 0.6 so only true fires pass), hold gives a visible
      // minimum LED width. envelope/hold shortened to 50 ms for a crisp flash.
      // (EDM corpus tuning, report 202606.)
      out[key] = [
        { id: gainOpIdFor('micKick'), type: 'gain',     enabled: true, params: { paramKey: 'micKickGain' } },
        { id: 'kick_envelope',        type: 'envelope', enabled: true, params: { attackMs: 4, releaseMs: 50 } },
        { id: 'kick_schmitt',         type: 'schmitt',  enabled: true, params: { tHigh: 0.6, tLow: 0.3, refractoryMs: 180 } },
        { id: 'kick_hold',            type: 'hold',     enabled: true, params: { timeoutMs: 50, decayMs: 50 } },
      ];
      continue;
    }
    const chain = defaultGainChainFor(key);
    if (!chain) {
      throw new Error(`SignalPostProcessor: no default chain for processed signal "${key}"`);
    }
    // Append the tuned smoothing LPF after the gain op.
    const cutoffHz = SMOOTHING_HZ[key];
    if (cutoffHz === undefined) {
      throw new Error(`SignalPostProcessor: no smoothing cutoff for processed signal "${key}"`);
    }
    const lpfId = gainOpIdFor(key).replace(/_gain$/, '_lpf');
    out[key] = [...chain, { id: lpfId, type: 'lpf', enabled: true, params: { cutoffHz } }];
  }
  return out;
}

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
  // ── FREQUENCY-MODE clamp bounds ──────────────────────────────────────────
  // The clamp op is range-AGNOSTIC math (lo/hi pass-through). When a chain
  // runs in frequency (Hz) mode, the operator must be able to bound the dom
  // value to a musical Hz window (e.g. 40–4000 Hz), which the default [0,1]
  // bounds would forbid. We DO NOT fork the op or its math — only the
  // VALIDATION range for clamp's min/max widens to the audible band when the
  // chain is Hz-typed. See `HZ_CLAMP_BOUND` + the `hz` flag threaded through
  // validateChain/_validateOp. (2026-06-17 companion contract: "clamp's
  // min/max must be allowed to be Hz, not [0,1]".)
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
  curve: {
    // Phase 7 — TD CHOP Lookup; matches modulation_engine.js applyCurve().
    description: 'Per-sample shape lookup (linear / easeIn / easeOut / exp). `gamma` applies to exp only.',
    params: {
      shape: { type: 'string', oneOf: ['linear', 'easeIn', 'easeOut', 'exp'], default: 'linear' },
      gamma: { type: 'number', min: 0.1, max: 10, default: 2.0 },
    },
  },
  slew: {
    // Phase 7 — TD CHOP Limit (step mode). Rate-limits how fast y can change.
    description: 'Slew-rate limiter: y is clamped within ±(maxStepPerSec·dt) of y_prev.',
    params: {
      maxStepPerSec: { type: 'number', min: 0.001, max: 1000, default: 4.0 },
    },
  },
  danceMaker: {
    // 2026-06-17 companion contract / docs/37 §2.2 "DanceMaker". A FREQUENCY-
    // domain op: a critically-damped spring on the input value (Hz). Promotes
    // the legacy companion_server.js dom-dance spring (springStep/DANCE_OMEGA)
    // into a selectable op so the operator can place "the dance" anywhere in a
    // frequency chain. Output is the spring-smoothed Hz (runs in 'frequency'
    // output mode — no [0,1] clamp). Math is shared with the visualizer via
    // `danceSpringStep` (one source of truth, no fork — codex P0). A step in
    // Hz GLIDES to target with no overshoot; lower omega = slower settle.
    description: 'Critically-damped spring smoother (the "dance"). Glides the input toward its target with no overshoot. Frequency-domain.',
    params: {
      omega: { type: 'number', min: 0.1, max: DANCE_OMEGA_MAX, default: DANCE_OMEGA },
    },
  },
  compressor: {
    // Phase 7 — Bob Katz, Mastering Audio (3rd ed. 2014, ch. 7); RBJ-cookbook
    // smoothing constants. Soft-knee not implemented (hard knee at threshold).
    description: 'dB-domain dynamics compressor (hard knee). ratio ≥ 1.',
    params: {
      threshold: { type: 'number', min: 0.001, max: 1,     default: 0.5 },
      ratio:     { type: 'number', min: 1,     max: 100,   default: 4.0 },
      attackMs:  { type: 'number', min: 0.1,   max: 10000, default: 5 },
      releaseMs: { type: 'number', min: 0.1,   max: 10000, default: 80 },
    },
  },
  biquad: {
    // Phase 7 — RBJ EQ Cookbook (W3C-Note, 2021) §LPF, Direct-Form-1.
    description: 'Biquad low-pass filter (RBJ EQ Cookbook LPF, Direct-Form-1).',
    params: {
      cutoffHz: { type: 'number', min: 0.01, max: 1000, default: 8.0 },
      Q:        { type: 'number', min: 0.01, max: 50,   default: 0.707 },
    },
  },
  slope: {
    // Phase 7 — TD CHOP Slope. Discrete derivative, scaled. Bipolar mode
    // outputs (x − x_prev) / dt / scale clamped to [-1, 1] (so negative
    // outputs are preserved); unipolar (default) clamps to [0, 1] so falling
    // input reads 0 (use bipolar:true if you need the negative half).
    description: 'Discrete derivative (per-second), scaled. Bipolar mode preserves negative output.',
    params: {
      scale:   { type: 'number',  min: 0.001, max: 1000, default: 4.0 },
      bipolar: { type: 'boolean', default: false },
    },
  },
  normalizer: {
    // Phase 8 (this commit) — automatic-gain-control / adaptive level.
    // Per-sample causal envelope-follower AGC: a slow-rising floor and a
    // slow-falling peak estimate, both with time constant `windowSec`,
    // map the input to a venue/mic-independent [0, 1] range. This lets a
    // new room work without re-tuning PRE_CLAMP_GAIN / bands.noiseGate by
    // hand. Source: adaptive-level / dual-envelope follower per Pirkle,
    // *Designing Audio Effect Plug-Ins in C++* (2nd ed., 2019, ch. 6) and
    // Zölzer, *DAFX* (2nd ed., 2011, §4.3 adaptive level / normalization).
    // O(1) per sample — two scalar envelope words, NO sample-history
    // buffer (keeping the framework's O(1)-per-op convention; a true
    // percentile over a windowSec history would be O(window) and against
    // the hot-path budget — design doc §Performance note).
    description: 'Auto-level (AGC) to [0,1] via a sliding floor/peak envelope follower. On a frequency signal this is the smooth moving-window auto-range that maps Hz to a well-distributed [0,1] for spatial (x/y/z) use.',
    params: {
      windowSec: { type: 'number', min: 1, max: 120, default: 30 },
      strength:  { type: 'number', min: 0, max: 1,   default: 1.0 },
    },
  },
  osc_out: {
    // 2026-06-17 companion signal-designer contract §"The osc_out op".
    // UNIFIED-NAME REHAUL (operator brief): the tap now carries ONE operator-
    // facing `name`. The CPC key and OSC address are DERIVED from it — the
    // operator never edits them directly:
    //   cpcKey  = slug(name)
    //   address = /marsin/audio/<cpcKey>
    // A TERMINAL TAP: it does NOT modify the signal value (identity in
    // process()) — it MARKS the chain as an OUTPUT. The Companion reads
    // osc_out ops off the chain to know what to emit each analyzer hop, and
    // sends each OUTPUT signal's POST value to the derived address; the
    // engine's own process() treats it as a no-op so a chain with osc_out
    // behaves identically whether or not OSC sending is wired.
    description: 'Terminal OSC output tap: send this signal\'s POST value to the engine. The single editable `name` derives cpcKey=slug(name) and address=/marsin/audio/<cpcKey>. Identity in the DSP chain.',
    params: {
      name: { type: 'string', default: 'out' },
    },
  },
});

/**
 * Derive the engine CPC key from an operator-facing signal NAME.
 *   trim → lowercase → collapse any run of non-[a-z0-9] to a single '_'
 *   → strip leading/trailing '_'.
 * Returns '' when nothing survives (e.g. name was all punctuation) — the
 * CALLER must treat '' as an ERROR and reject the rename (Codex P0: fail
 * loud, never silently substitute a fallback key).
 */
export function slug(name) {
  if (typeof name !== 'string') return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The OSC address an osc_out `name` routes to: /marsin/audio/<slug(name)>. */
export function oscAddressForName(name) {
  return `/marsin/audio/${slug(name)}`;
}

// Upper bound for clamp min/max in Hz mode — the Nyquist of the engine's
// 44.1 kHz analyzer (22050 Hz), matching `sourceSmoothHz`'s ceiling in the
// companion. A dom freq can never exceed Nyquist, so this is a true upper
// bound, not an arbitrary cap. The lower bound stays 0 (a 0 Hz floor is the
// natural "no low bound").
const HZ_CLAMP_BOUND = 22050;

// Output modes a SignalPostProcessor can run in.
//   'intensity' (default): the historical behavior — process() clamps the
//     final value to [0, 1] and clamp ops are bounded to [0, 1]. Byte-
//     identical to pre-frequency behavior.
//   'frequency': the chain carries Hz. The final [0, 1] output clamp is
//     SKIPPED (a Hz value must survive), and clamp ops may use Hz bounds.
//     All op MATH is unchanged — lpf/clamp/slew are range-agnostic — so this
//     reuses the exact same `_applyOp` code path (no DSP fork; codex P0).
export const OUTPUT_MODES = Object.freeze(['intensity', 'frequency']);

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
 * Best-effort check that `key` is a known CPC param. Uses whatever
 * discovery surface the paramCenter exposes:
 *   1. `.has(key)` — direct boolean probe (cheapest).
 *   2. `.getSchema()` — returns [{ key, ... }] (real ParamCenter).
 *   3. `.get(key)` — fall back to a try/catch; the real ParamCenter
 *      throws on unknown keys per its contract.
 * Returns true on a known key, false on a clearly-unknown one. If
 * the paramCenter offers none of these surfaces (defensive: shouldn't
 * happen — constructor guarantees `.get`), we return true so we don't
 * block PUTs on an under-featured stub.
 */
function _paramCenterHasKey(paramCenter, key) {
  if (typeof paramCenter.has === 'function') {
    return !!paramCenter.has(key);
  }
  if (typeof paramCenter.getSchema === 'function') {
    try {
      const schema = paramCenter.getSchema();
      if (Array.isArray(schema)) return schema.some(e => e && e.key === key);
    } catch { /* fall through */ }
  }
  // Final fallback: probe with .get and treat a throw as "unknown".
  try {
    paramCenter.get(key);
    return true;
  } catch {
    return false;
  }
}

/** Append a short hint pointing operators at the discovery surface. */
function _paramCenterKeyHint(paramCenter) {
  if (typeof paramCenter.getSchema === 'function') {
    return ' (see GET /param-center/schema for valid keys)';
  }
  return '';
}

/**
 * Validate one op-config object. Returns { ok, error, normalized }.
 * Used by validateChain — never used standalone.
 *
 * `paramCenter` is optional. When supplied, Gain ops that use
 * `paramKey` have the key looked up against the CPC schema NOW, so
 * a typo like `micLowGainX` fails at PUT/PATCH time with a clear
 * 400 instead of throwing on the first audio-hot-path process()
 * call (Codex P0 — fail loudly early).
 */
function _validateOp(op, indexForMsg, paramCenter = null, hz = false) {
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
    // Early paramKey validation (Codex P0: fail loudly EARLY). When a
    // paramCenter is wired in (the PUT/PATCH path always wires it),
    // reject a typo like `micLowGainX` here instead of letting it
    // sail through and crash on the first audio-hot-path process()
    // call. Skipped when paramCenter is null (free-standing
    // validateChain() callers, e.g. unit tests for the validator).
    if (hasPK && paramCenter) {
      const candidate = params.paramKey;
      if (typeof candidate !== 'string' || candidate.length === 0) {
        return { ok: false, error: `op "${op.id}".paramKey: must be a non-empty string` };
      }
      const known = _paramCenterHasKey(paramCenter, candidate);
      if (!known) {
        const hint = _paramCenterKeyHint(paramCenter);
        return {
          ok: false,
          error: `op "${op.id}".paramKey: unknown CPC key "${candidate}"${hint}`,
        };
      }
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
      // In frequency (Hz) mode some op params operate in the Hz DOMAIN of the
      // signal value, not [0,1], so their validated UPPER bound widens to the
      // Nyquist ceiling. Same op, same math; only the accepted range widens
      // (codex P0: no fork). The Hz-domain params:
      //   - clamp.min / clamp.max : Hz bounds on the value (e.g. 40–4000 Hz).
      //   - slew.maxStepPerSec    : Hz/second rate limit (a dom freq can jump
      //     thousands of Hz/s; the intensity cap of 1000 is far too slow).
      // (lpf.cutoffHz is NOT widened: it's the smoothing FILTER cutoff, not the
      // signal value — its [0.01,1000] Hz range is already appropriate.)
      let loBound = spec.min;
      let hiBound = spec.max;
      if (hz) {
        if (op.type === 'clamp' && (pk === 'min' || pk === 'max')) hiBound = HZ_CLAMP_BOUND;
        else if (op.type === 'slew' && pk === 'maxStepPerSec') hiBound = HZ_CLAMP_BOUND;
      }
      if (pv < loBound || pv > hiBound) {
        return { ok: false, error: `op "${op.id}".${pk}: ${pv} out of range [${loBound}, ${hiBound}]` };
      }
      normalizedParams[pk] = pv;
    } else if (spec.type === 'string') {
      if (typeof pv !== 'string' || pv.length === 0) {
        return { ok: false, error: `op "${op.id}".${pk}: must be a non-empty string` };
      }
      if (Array.isArray(spec.oneOf) && !spec.oneOf.includes(pv)) {
        // Codex P0: unknown shape strings throw (not silently coerced).
        return { ok: false, error: `op "${op.id}".${pk}: "${pv}" not in [${spec.oneOf.join(', ')}]` };
      }
      normalizedParams[pk] = pv;
    } else if (spec.type === 'boolean') {
      if (typeof pv !== 'boolean') {
        return { ok: false, error: `op "${op.id}".${pk}: must be a boolean` };
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
  if (op.type === 'osc_out') {
    // The single editable identity is `name`; cpcKey/address are DERIVED from
    // it. `name` must be a non-empty string whose slug is non-empty — an
    // all-punctuation name would slug to '' and route nothing (Codex P0: fail
    // loud, never silently substitute a fallback key).
    const name = normalizedParams.name;
    if (typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: `op "${op.id}": osc_out name must be a non-empty string` };
    }
    if (slug(name) === '') {
      return { ok: false, error: `op "${op.id}": osc_out name "${name}" has no usable letters/digits (slug is empty)` };
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
 *
 * `opts.paramCenter` is optional. When provided, Gain ops with
 * `paramKey` get the key existence-checked against CPC at validation
 * time (Codex P0 — fail loudly EARLY, before the audio hot path).
 * Free-standing callers (unit tests, schema introspection) may omit
 * it; the instance methods always wire it.
 */
export function validateChain(signalKey, chain, opts = {}) {
  const paramCenter = opts && opts.paramCenter ? opts.paramCenter : null;
  // `hz: true` validates the chain for a FREQUENCY (Hz) signal — relaxes the
  // clamp op's min/max bounds to the audible/Nyquist range. Default false
  // keeps intensity validation byte-identical.
  const hz = !!(opts && opts.hz);
  if (!KNOWN_SIGNALS.includes(signalKey)) {
    return { ok: false, error: `unknown signalKey "${signalKey}" (known: ${KNOWN_SIGNALS.join(', ')})` };
  }
  if (!Array.isArray(chain)) {
    return { ok: false, error: 'chain must be an array of op configs' };
  }
  const seenIds = new Set();
  const normalized = [];
  for (let i = 0; i < chain.length; i++) {
    const res = _validateOp(chain[i], i, paramCenter, hz);
    if (!res.ok) return res;
    if (seenIds.has(res.normalized.id)) {
      return { ok: false, error: `duplicate op id "${res.normalized.id}" in signal ${signalKey}` };
    }
    seenIds.add(res.normalized.id);
    normalized.push(res.normalized);
  }
  // osc_out is a TERMINAL tap: at most one, and only as the LAST op in the
  // chain (it marks the chain as an output; nothing may run after the tap).
  const oscOutIdxs = normalized.map((o, i) => (o.type === 'osc_out' ? i : -1)).filter(i => i >= 0);
  if (oscOutIdxs.length > 1) {
    return { ok: false, error: `signal ${signalKey}: at most one osc_out op per chain (found ${oscOutIdxs.length})` };
  }
  if (oscOutIdxs.length === 1 && oscOutIdxs[0] !== normalized.length - 1) {
    return { ok: false, error: `signal ${signalKey}: osc_out must be the LAST op in the chain (it is a terminal output tap)` };
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
   * @param {'intensity'|'frequency'} [opts.outputMode='intensity'] — output
   *   range mode. 'intensity' (default) clamps the chain's final value to
   *   [0,1] (the engine's CPC contract) and bounds clamp ops to [0,1].
   *   'frequency' carries Hz: the final [0,1] clamp is SKIPPED so a Hz value
   *   survives, and clamp ops may use Hz bounds. The same `_applyOp` math runs
   *   in BOTH modes (lpf/clamp/slew are range-agnostic) — there is no DSP fork
   *   (codex P0: one source of truth). The Audio Companion runs its frequency
   *   signals (dom1/dom2) through a 'frequency'-mode instance so operator ops
   *   (lpf/clamp/slew) actually apply to the Hz value before the osc_out tap.
   */
  constructor({ scenePath = null, paramCenter, broadcast = null, outputMode = 'intensity' } = {}) {
    if (!paramCenter || typeof paramCenter.get !== 'function') {
      throw new TypeError('SignalPostProcessor: paramCenter with .get(key) is required');
    }
    if (!OUTPUT_MODES.includes(outputMode)) {
      // Codex P0 — fail loud on misuse, no silent fallback to a default mode.
      throw new TypeError(`SignalPostProcessor: outputMode must be one of ${OUTPUT_MODES.join(', ')} (got "${outputMode}")`);
    }
    this.scenePath = scenePath;
    this.paramCenter = paramCenter;
    this.broadcast = broadcast;
    this.outputMode = outputMode;
    // Hz mode relaxes clamp bounds at validation time (threaded into every
    // validateChain call this instance makes).
    this._validateOpts = outputMode === 'frequency' ? { hz: true } : {};

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
      const v = validateChain(signalKey, chain, { paramCenter: this.paramCenter, ...this._validateOpts });
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
    const v = validateChain(signalKey, ops, { paramCenter: this.paramCenter, ...this._validateOpts });
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
    // Pass paramCenter so a typo'd paramKey is caught here, not in the
    // audio hot path.
    const res = _validateOp(nextOp, idx, this.paramCenter, this.outputMode === 'frequency');
    if (!res.ok) return { ok: false, error: res.error };

    // Splice in the validated op. CRITICALLY, the runtime state for
    // this op is PRESERVED — we already rejected `type` changes above,
    // so the runtime shape is correct for the new op and the smoothing
    // history (yPrev, clock, lastFireAt, lastInputAt) stays continuous.
    // This is the entire point of PATCH vs PUT: the operator can nudge
    // attackMs / cutoffHz / tHigh mid-show without the chain "snapping
    // back to zero" while history rebuilds — i.e. no visible LED-wall
    // pop. See docstrings above and at _initRuntime for the full
    // contract. If a future op type ever needs to invalidate runtime
    // on a specific param transition, add that case explicitly here.
    const nextChain = chain.slice();
    nextChain[idx] = res.normalized;
    this._chains[signalKey] = nextChain;
    // Defensive: if for any reason the runtime slot is missing (e.g.
    // an op id was somehow patched before its runtime was seeded),
    // fall back to a fresh init so process() never sees `undefined`.
    if (!this._runtime[signalKey][opId]) {
      this._runtime[signalKey][opId] = _initRuntime(res.normalized);
    }
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
   * @param {number} rawValue — pre-chain value. [0,1] in intensity mode; a Hz
   *   value in frequency mode.
   * @param {number} dtSeconds — frame delta in seconds (used by
   *   time-domain ops: LPF, Envelope, Hold).
   * @returns {number} — post-chain value. Clamped to [0, 1] in intensity mode;
   *   in frequency mode the [0,1] clamp is skipped (the Hz value survives) but
   *   a non-finite result is still floored to 0 (a NaN must never reach OSC).
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
    // Intensity mode: clamp to the engine's [0,1] CPC contract (unchanged).
    // Frequency mode: a Hz value must NOT be clamped to [0,1] — that was the
    // whole reason frequency signals bypassed this processor. We still guard
    // against a non-finite result (a NaN/Infinity must never reach OSC).
    if (this.outputMode === 'frequency') {
      return isFiniteNumber(val) ? val : 0;
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
        // Sample-and-hold with a FLAT hold window, THEN exponential decay.
        // A new peak (x rising to/above the held value) latches the value and
        // (re)arms the hold; while x stays below it, the value is held FLAT for
        // `timeoutMs`, after which it decays with `decayMs`. For a trigger-style
        // upstream (Schmitt) a 1.0 pulse latches, holds flat for the timeout,
        // then fades. (Fixes the old no-op `timeoutMs`: the previous code decayed
        // INSIDE the window too, so the two branches were algebraically identical
        // and the timeout never changed the output — see ops_synthetic.test.js.)
        const { timeoutMs, decayMs } = op.params;
        const tauD = decayMs / 1000;
        const now = rt.clock + dt * 1000;
        rt.clock = now;
        let y;
        if (x >= rt.yPrev) {                          // new/equal peak → S&H + (re)arm
          y = x;
          rt.lastInputAt = now;
        } else if (now - rt.lastInputAt <= timeoutMs) {
          y = rt.yPrev;                               // inside the flat hold window — no decay
        } else {
          y = rt.yPrev * Math.exp(-dt / tauD);        // window expired — exponential decay
        }
        rt.yPrev = y;
        return y;
      }
      case 'curve': {
        // Source: design doc §Operator catalog row "Curve" — TD CHOP
        // Lookup. Shape table:
        //   linear  : y = x
        //   easeIn  : y = x^2                  (matches modulation_engine.js applyCurve)
        //   easeOut : y = 1 − (1 − x)^2        (matches modulation_engine.js applyCurve)
        //   exp     : y = x^gamma              (modulation_engine uses fixed x^3; the
        //                                       design doc's Curve op exposes gamma so
        //                                       the operator can dial the shape — default
        //                                       gamma=2.0; gamma=3.0 reproduces the legacy
        //                                       modulation_engine 'exp' shape)
        // Codex P0: unknown shape strings throw at validateChain; defaults
        // already injected so op.params.shape is always one of the four.
        const shape = op.params.shape;
        // Clamp x into [0, 1] before the shape so a hot upstream Gain that
        // emits 1.1 doesn't pass an unbounded value into pow().
        const xc = x < 0 ? 0 : (x > 1 ? 1 : x);
        if (shape === 'linear')  return xc;
        if (shape === 'easeIn')  return xc * xc;
        if (shape === 'easeOut') return 1 - (1 - xc) * (1 - xc);
        if (shape === 'exp')     return Math.pow(xc, op.params.gamma);
        // Defensive — _validateOp rejects unknown shapes; this is unreachable.
        throw new Error(`SignalPostProcessor: unknown curve shape "${shape}"`);
      }
      case 'slew': {
        // Source: design doc §Operator catalog row "Slew Limiter" —
        // TD CHOP Limit (step mode). step = maxStepPerSec * dt;
        // y = clamp(x, y_prev − step, y_prev + step).
        const step = op.params.maxStepPerSec * dt;
        const lo = rt.yPrev - step;
        const hi = rt.yPrev + step;
        let y = x;
        if (y < lo) y = lo;
        else if (y > hi) y = hi;
        rt.yPrev = y;
        return y;
      }
      case 'danceMaker': {
        // Source: docs/37 §2.2 "DanceMaker" — the critically-damped spring that
        // produces the dom-dance glide. Reuses `danceSpringStep` VERBATIM (the
        // same code the legacy visualizer calls) so promoting it to an op did
        // not change the dance (parity-tested). `rt.yPrev` is the spring
        // position x; `rt.danceVel` is its velocity v. Target = the input x.
        const [pos, vel] = danceSpringStep(rt.yPrev, rt.danceVel, x, dt, op.params.omega);
        rt.danceVel = vel;
        rt.yPrev = pos;
        return pos;
      }
      case 'compressor': {
        // Source: design doc §Operator catalog row "Compressor" —
        // Bob Katz, *Mastering Audio* (3rd ed. 2014, ch. 7), with
        // RBJ-cookbook smoothing constants for the attack/release
        // envelope on the gain-reduction signal.
        //
        // Per sample x in [0, 1]:
        //   x_dB        = 20·log10(x + ε)              (ε = 1e-9 to avoid log(0))
        //   thresh_dB   = 20·log10(threshold)
        //   over_dB     = max(0, x_dB − thresh_dB)
        //   targetGR_dB = −over_dB · (1 − 1/ratio)     (≤ 0; negative = gain reduction)
        //   α (attack/release) = 1 − exp(−dt / τ),     where τ = ms/1000
        //     — attack used when targetGR_dB is BELOW current state (more
        //       reduction needed, i.e. signal got louder); release used
        //       when targetGR_dB is ABOVE current (less reduction, signal
        //       quieted). This is the standard "compressor envelope chases
        //       the reduction" topology — attack = how fast we clamp down,
        //       release = how fast we let go.
        //   gr_dB ← gr_dB + α · (targetGR_dB − gr_dB)
        //   y     = clamp01(x · 10^(gr_dB/20))
        const { threshold, ratio, attackMs, releaseMs } = op.params;
        const eps = 1e-9;
        const xDb = 20 * Math.log10(x + eps);
        const threshDb = 20 * Math.log10(threshold);
        const overDb = xDb - threshDb;
        const targetGrDb = overDb > 0 ? -overDb * (1 - 1 / ratio) : 0;
        // Pick attack vs release. targetGrDb < gr_dB ⇒ MORE reduction
        // needed ⇒ attack phase (clamp down faster). targetGrDb > gr_dB
        // ⇒ LESS reduction ⇒ release phase (let go slower, typically).
        const tau = (targetGrDb < rt.grDb ? attackMs : releaseMs) / 1000;
        const alpha = 1 - Math.exp(-dt / tau);
        rt.grDb = rt.grDb + alpha * (targetGrDb - rt.grDb);
        const gainLinear = Math.pow(10, rt.grDb / 20);
        const y = x * gainLinear;
        if (!(y > 0)) return 0;
        return y < 1 ? y : 1;
      }
      case 'biquad': {
        // Source: design doc §Operator catalog row "Biquad LPF" —
        // RBJ EQ Cookbook (W3C-Note, 2021) §LPF, Direct-Form-1.
        //   ω₀ = 2π · fc · dt           (rad/sample)
        //   α  = sin(ω₀) / (2 · Q)
        //   b0 = (1 − cos ω₀) / 2
        //   b1 =  1 − cos ω₀
        //   b2 = (1 − cos ω₀) / 2
        //   a0 =  1 + α
        //   a1 = −2 · cos ω₀
        //   a2 =  1 − α
        //   y[n] = (b0·x[n] + b1·x[n−1] + b2·x[n−2]
        //          − a1·y[n−1] − a2·y[n−2]) / a0
        //
        // Note: we recompute coefficients every sample because `dt` (the
        // audio-analyzer hop) can vary by a few ms; the cookbook assumes a
        // fixed sample rate but on a varying-dt source the only stable
        // choice is to re-derive ω₀ from the current dt. Cost: a sin/cos
        // per sample on micKick (~86 Hz). Negligible per the design doc
        // §Performance note.
        const w0 = 2 * Math.PI * op.params.cutoffHz * dt;
        const cosW0 = Math.cos(w0);
        const sinW0 = Math.sin(w0);
        const alpha = sinW0 / (2 * op.params.Q);
        const b0 = (1 - cosW0) / 2;
        const b1 =  1 - cosW0;
        const b2 = (1 - cosW0) / 2;
        const a0 =  1 + alpha;
        const a1 = -2 * cosW0;
        const a2 =  1 - alpha;
        const y = (b0 * x + b1 * rt.xPrev1 + b2 * rt.xPrev2
                   - a1 * rt.yPrev1 - a2 * rt.yPrev2) / a0;
        // Shift sample-history words.
        rt.xPrev2 = rt.xPrev1;
        rt.xPrev1 = x;
        rt.yPrev2 = rt.yPrev1;
        rt.yPrev1 = y;
        // Mirror yPrev for the editor snapshot's `firing`-style consumers
        // (Schmitt uses yPrev; other ops can ignore but we keep it set so
        // snapshotForEditor doesn't see `undefined`).
        rt.yPrev = y;
        return y;
      }
      case 'slope': {
        // Source: design doc §Operator catalog row "Slope" — TD CHOP Slope.
        // First-difference / dt, scaled. With bipolar:false (default) the
        // output is clamped to [0, 1] so a falling input reads 0; with
        // bipolar:true it's clamped to [-1, 1] (the design doc note: "can
        // output negative if bipolar:true"). The final per-process clamp01
        // in process() will additionally clamp negative output to 0 for
        // CPC; bipolar ops should be followed by Bias+Gain or used in a
        // chain whose downstream consumer accepts negatives. (Documented
        // behavior — operator brief.)
        //
        // dt floor: the discrete derivative is undefined at dt=0, and at
        // very tiny dt the (x − x_prev) / dt term explodes. The framework
        // already rejects dt<0 in process(), but dt=0 is technically
        // allowed; we floor to 1e-6 here so a zero-dt frame yields 0 rather
        // than NaN/Infinity (defensive).
        const safeDt = dt > 1e-6 ? dt : 1e-6;
        const raw = (x - rt.xPrev) / safeDt / op.params.scale;
        rt.xPrev = x;
        let y;
        if (op.params.bipolar) {
          if (raw < -1) y = -1;
          else if (raw > 1) y = 1;
          else y = raw;
        } else {
          if (raw < 0) y = 0;
          else if (raw > 1) y = 1;
          else y = raw;
        }
        rt.yPrev = y;
        return y;
      }
      case 'normalizer': {
        // Source: design doc §Operator catalog row "Normalizer" — adaptive
        // level / dual-envelope follower (Pirkle, *Designing Audio Effect
        // Plug-Ins in C++* 2nd ed. 2019 ch. 6; Zölzer *DAFX* 2nd ed. 2011
        // §4.3 adaptive level). Two one-pole envelopes both with time
        // constant τ = windowSec track the signal's running floor and peak:
        //
        //   floor : tracks DOWN fast (αFast on a falling sample so a new,
        //           lower quiet level is adopted quickly) and UP slow
        //           (αSlow so a transient can't drag the floor up).
        //   peak  : tracks UP fast (αFast on a rising sample so transients
        //           set the ceiling) and DOWN slow (αSlow so the peak
        //           sags back gently when the room quiets).
        //
        //   norm  = clamp01((x − floor) / max(peak − floor, ε))
        //   out   = strength·norm + (1 − strength)·x   (dial AGC in gradually)
        //
        // αSlow is the windowSec time constant; αFast is a fixed-fraction
        // faster follower (τ/8) so the floor/peak "grab" transients within
        // the window but only relax over the full window. ε guards the
        // divide so a flat input (peak == floor) can't emit NaN/Infinity —
        // it converges to 0 (x sits on the floor) rather than blowing up.
        const eps = 1e-6;
        const tauSlow = op.params.windowSec;
        const tauFast = tauSlow / 8;
        const aSlow = 1 - Math.exp(-dt / tauSlow);
        const aFast = 1 - Math.exp(-dt / tauFast);
        // Floor: fast on the way down, slow on the way up.
        const aFloor = x < rt.floor ? aFast : aSlow;
        rt.floor = rt.floor + aFloor * (x - rt.floor);
        // Peak: fast on the way up, slow on the way down.
        const aPeak = x > rt.peak ? aFast : aSlow;
        rt.peak = rt.peak + aPeak * (x - rt.peak);
        const span = rt.peak - rt.floor;
        const denom = span > eps ? span : eps;
        let norm = (x - rt.floor) / denom;
        if (!(norm > 0)) norm = 0;
        else if (norm > 1) norm = 1;
        const strength = op.params.strength;
        // Dry/wet blend. Intensity: blend the adaptive [0,1] `norm` with the raw
        // (already-[0,1]) input. Frequency: the raw input is Hz — blending it in
        // would blow the output out of [0,1], so blend toward the neutral CENTRE
        // (0.5) instead. strength=1 ⇒ full adaptive travel; lower strength ⇒
        // travel compressed around centre, always in [0,1] (a smooth spatial
        // coordinate with no hotspots/jumps when fed to a pattern x/y/z).
        const dry = this.outputMode === 'frequency' ? 0.5 : x;
        const out = strength * norm + (1 - strength) * dry;
        rt.yPrev = out;
        return out;
      }
      case 'osc_out': {
        // Terminal OSC output tap — IDENTITY in the DSP chain. The op only
        // carries the operator-facing `name` (cpcKey/address are derived from
        // it); the Audio Companion reads it off the chain to send this
        // signal's POST value over UDP OSC. process() must not alter the value
        // (so a chain reads the same with or without OSC wired) — return x.
        return x;
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
    case 'slew':
      // yPrev starts at 0; first sample rises through the limit/EMA.
      break;
    case 'compressor':
      // gain-reduction state (dB, ≤ 0). 0 = unity (no reduction yet).
      rt.grDb = 0;
      break;
    case 'biquad':
      // Direct-Form-1 sample history: two x and two y words.
      rt.xPrev1 = 0;
      rt.xPrev2 = 0;
      rt.yPrev1 = 0;
      rt.yPrev2 = 0;
      break;
    case 'slope':
      // Discrete derivative needs the previous input sample.
      rt.xPrev = 0;
      break;
    case 'danceMaker':
      // Spring position is yPrev (starts 0); velocity starts at rest.
      rt.danceVel = 0;
      break;
    case 'normalizer':
      // Dual envelope follower state. floor/peak both start at 0 so the
      // first samples set the span; with a [0,1] input the floor stays at
      // 0 until a quiet stretch and the peak rises to the first transient.
      rt.floor = 0;
      rt.peak = 0;
      break;
    default:
      break;
  }
  return rt;
}
