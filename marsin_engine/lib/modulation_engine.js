// ModulationEngine — Phase 0 contract module.
//
// Pure-math + schema-validation surface for the Dynamic Audio Parameter
// Mapping feature (docs/26_[todo]_audio_params_playlist.md).
//
// This module has ZERO engine RUNTIME dependencies (no param_center, wasm, or
// I/O). Its ONE import is the STATIC audio descriptor registry — used purely to
// read a builtin source key's curated range so resolveModulationSources can
// normalize a wide-range Hz/bpm source into [0,1]. It still exports:
//
//   - applyCurve / applyContinuousModulation : per-mapping math (§4.3)
//   - resolveModulationSources               : snapshot → source values
//   - applyModulations                       : batch evaluator (§6.1)
//   - validateModulationMapping              : schema check used by
//                                              playlist_manager and the
//                                              REST CRUD endpoints
//   - JSDoc typedefs for ModulationMapping and ModulationStateFrame —
//     the frozen contract that Phase 1 sub-agents build against
//
// WS topic decision (Phase 0): the modulationState frame is broadcast
// on /ws/params alongside sharedParams + liveParams. Rationale: it is
// the "values changing live" socket; vis is too volume-restricted for
// 15–30 Hz fanout; control must stay UI-priority. Slot 0 (render loop)
// owns the broadcast call site; do not re-route without re-freezing
// the contract.

import { descriptorByKey } from '../audio/postproc/audio_signals.js';

/**
 * @typedef {('cpc')} ModulationSourceScope
 *   v1 source scope. Future: 'lfo', 'global', 'tempo'.
 *
 * @typedef {Object} ModulationSource
 * @property {ModulationSourceScope} scope
 * @property {string} key                A built-in [0,1] audio source key
 *                                       (mic bands/flux, dom energies, the
 *                                       [0,1] detector/derived keys — see
 *                                       BUILTIN_SOURCE_KEYS) or a runtime
 *                                       Companion key (DYNAMIC_SOURCE_KEYS).
 * @property {string} [label]            UI hint only, never used for routing.
 *
 * @typedef {('pattern')} ModulationTargetScope
 *   v1 target scope. Future: 'global', 'mixer'.
 *
 * @typedef {Object} ModulationTarget
 * @property {ModulationTargetScope} scope
 * @property {string} parameter          WASM export name on the active pattern.
 *
 * @typedef {('continuous')} ModulationType
 *   v1 type. 'trigger' reserved (§3.2 of the design doc).
 *
 * @typedef {('offset'|'multiply'|'override')} ModulationMode
 *   offset   — add the scaled signal to the static param value.
 *   multiply — use the scaled signal as a MULTIPLIER over the static value
 *              (default range [1.0, 1.2]).
 *   override — drive the param DIRECTLY from the scaled signal, ignoring the
 *              static UI value (the `!` override). ('scale' is accepted as a
 *              legacy alias for 'multiply' on load.)
 * @typedef {('unipolar'|'bipolar')} ModulationPolarity
 * @typedef {('linear'|'easeIn'|'easeOut'|'exp')} ModulationCurve
 *
 * @typedef {Object} ModulationMapping
 * @property {string} id                 Stable id, scoped per playlist item.
 * @property {ModulationType} type
 * @property {boolean} enabled
 * @property {ModulationSource} source
 * @property {ModulationTarget} target
 * @property {ModulationMode} mode
 * @property {ModulationPolarity} polarity
 * @property {[number, number]} range    [minDelta, maxDelta] in normalized space.
 * @property {ModulationCurve} curve
 *
 * @typedef {Object} ModulationStateParam
 * @property {number} base               Normalized base value (0..1).
 * @property {number} modulated          Normalized modulated value (0..1).
 * @property {string} [source]           Source key if a mapping was applied.
 * @property {string} [mappingId]        Id of the mapping that produced this.
 *
 * @typedef {Object} ModulationStateFrame
 * @property {'modulationState'} type
 * @property {string} deckId
 * @property {string} pattern
 * @property {Record<string, ModulationStateParam>} parameters
 */

// Modulation SOURCES are NOT allow-listed. Any CPC key the analysis pipeline
// (the Companion, the sole analyzer, over OSC → CPC) feeds in is a valid
// source — `resolveModulationSources` passes the live snapshot straight
// through, and a mapping whose source key isn't present this frame is simply
// skipped by `applyModulations` (a no-op, which is the operator-requested
// "default behavior is no change" when a source is dark). No registration, no
// gate: a new Companion signal is immediately assignable.
const VALID_TYPES = new Set(['continuous']);
const VALID_SOURCE_SCOPES = new Set(['cpc']);
const VALID_TARGET_SCOPES = new Set(['pattern']);
const VALID_MODES = new Set(['offset', 'multiply', 'override']);
// Range bounds. The output is always clamp01'd, so the range only needs to be
// generous enough for an offset (±) and a multiplier (multiply default is
// [1.0, 1.2]; a boost up to a few × is plenty). Negative ranges are allowed
// (e.g. an inverting [-1, 0]).
const RANGE_MIN = -4;
const RANGE_MAX = 4;
const VALID_POLARITIES = new Set(['unipolar', 'bipolar']);
const VALID_CURVES = new Set(['linear', 'easeIn', 'easeOut', 'exp']);

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function applyCurve(value, curve) {
  if (curve === 'easeIn') return value * value;
  if (curve === 'easeOut') return 1 - (1 - value) * (1 - value);
  if (curve === 'exp') return value * value * value;
  return value;
}

/**
 * Math for one continuous mapping. All values in normalized [0, 1] space.
 * @param {{
 *   baseNorm: number,
 *   sourceNorm: number,
 *   mode?: ModulationMode,
 *   polarity?: ModulationPolarity,
 *   range?: [number, number],
 *   curve?: ModulationCurve,
 * }} args
 * @returns {number} modulated value clamped to [0, 1]
 */
export function applyContinuousModulation({
  baseNorm,
  sourceNorm,
  mode = 'offset',
  polarity = 'unipolar',
  range = [0, 0],
  curve = 'linear',
}) {
  const base = clamp01(baseNorm);
  // CURVE IS APPLIED TO THE SIGNAL ITSELF — we shape the [0,1] source through
  // the curve function, then feed the SHAPED signal into the range/mode math
  // below. (Per operator: "add the signal through a curve function, not the
  // application of the signal in the param update".)
  const sc = applyCurve(clamp01(sourceNorm), curve);
  const [min, max] = range;
  // The "scaled signal": the curved [0,1] signal mapped linearly into the
  // operator's range. The range may be negative / inverted (e.g. [-1, 0]).
  const scaled = min + sc * (max - min);

  // OVERRIDE — drive the parameter directly from the scaled signal, ignoring
  // the static UI value entirely (the `!` override).
  if (mode === 'override') {
    return clamp01(scaled);
  }

  // MULTIPLY — the scaled signal is a MULTIPLIER over the static value
  // (default range [1.0, 1.2]). Polarity does not apply to a multiplier.
  if (mode === 'multiply') {
    return clamp01(base * scaled);
  }

  // OFFSET — add to the static value.
  if (polarity === 'bipolar') {
    // SYMMETRIC ±swing around the static value: the signal's CENTRE (0.5) =
    // static, and it swings symmetrically by mag = max(|min|, |max|). signal
    // 0 → static-mag, 0.5 → static, 1 → static+mag. (The UI stores bipolar as a
    // symmetric [-mag, mag] range; an asymmetric REST range is treated by its
    // larger magnitude so the swing stays symmetric. Curve already shaped the
    // signal, so 0.5-neutral holds under linear.)
    const bs = sc * 2 - 1;                       // [-1, 1]
    const mag = Math.max(Math.abs(min), Math.abs(max));
    return clamp01(base + bs * mag);
  }
  // OFFSET / unipolar — a one-sided offset: static + scaled signal. At signal
  // rest (0) the offset is `min` (0 for the usual [0, x] range, so the param
  // sits at its static value); as the signal rises it adds up to `max`.
  return clamp01(base + scaled);
}

/**
 * Pull active modulation source values from a CPC snapshot. Missing keys
 * resolve to 0 (a disabled source MUST NOT crash a render frame; the
 * mapping evaluates as a no-op which is exactly the operator-requested
 * behavior when the audio or OSC pipeline is OFF).
 * @param {{ paramCenterSnapshot: Record<string, number> }} args
 */
export function resolveModulationSources({ paramCenterSnapshot }) {
  const sources = {};
  if (!paramCenterSnapshot) return sources;
  // Every finite numeric value the pipeline fed in is a usable source — no
  // allow-list. A mapping referencing a key that isn't present this frame is
  // skipped by applyModulations (no-op), so a dark/absent source never crashes
  // a render frame and never spuriously moves the slider.
  //
  // NORMALIZE a BUILTIN source whose curated range is wider than [0,1] into
  // [0,1] so it drives the modulation across its FULL range instead of pinning
  // the target at 1.0: a Hz dom-freq ([0, 22050]), a bpm ([0, 300]), note
  // ([0,11]), structure ([0,2]), beat-in-bar ([0,4]). A [0,1] descriptor is an
  // identity. DYNAMIC Companion keys are NOT in the descriptor registry, so
  // they pass through RAW — a frequency the operator wants as a source should
  // be normalized in the Companion (the normalizer op), which is exactly why
  // we key off the BUILTIN registry here and never double-normalize a
  // source-normalized dynamic signal.
  for (const key of Object.keys(paramCenterSnapshot)) {
    const v = paramCenterSnapshot[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const d = descriptorByKey(key);
    if (d && Array.isArray(d.range) && d.range.length === 2 && d.range[1] > d.range[0]) {
      sources[key] = clamp01((v - d.range[0]) / (d.range[1] - d.range[0]));
    } else {
      sources[key] = v;
    }
  }
  return sources;
}

/**
 * Batch-evaluate modulations for the active pattern's exports.
 *
 * v1 policy (design §3.2): at most one continuous mapping per target.
 * Duplicates beyond the first are dropped with a warning. The first
 * entry in the modulations array wins because validateModulationMapping
 * already de-duped on PUT; this is the runtime safety net.
 *
 * @param {{
 *   baseParams?: Record<string, number>,
 *   targetDefs?: Array<{ name: string, kind?: number, id?: number }>,
 *   modulations?: ModulationMapping[],
 *   sourceValues?: Record<string, number>,
 * }} args
 * @returns {{ values: Record<string, ModulationStateParam> }}
 */
export function applyModulations({
  baseParams = {},
  targetDefs = [],
  modulations = [],
  sourceValues = {},
}) {
  const values = {};
  const targetMap = new Map();
  for (const exp of targetDefs) {
    if (!exp || typeof exp.name !== 'string') continue;
    targetMap.set(exp.name, exp);
    const base = clamp01(baseParams[exp.name] ?? 0);
    values[exp.name] = { base, modulated: base };
  }

  const appliedTargets = new Set();
  for (const mod of modulations) {
    if (!mod || !mod.enabled || mod.type !== 'continuous') continue;
    const targetParam = mod.target?.parameter;
    if (!targetParam || !targetMap.has(targetParam)) continue;
    if (appliedTargets.has(targetParam)) {
      console.warn(
        `[ModulationEngine] Duplicate mapping for target '${targetParam}' ignored (v1 one-per-target policy).`,
      );
      continue;
    }
    const sourceKey = mod.source?.key;
    const sourceVal = sourceValues[sourceKey];
    if (typeof sourceVal !== 'number') continue;

    const baseVal = values[targetParam].base;
    const modulatedVal = applyContinuousModulation({
      baseNorm: baseVal,
      sourceNorm: sourceVal,
      mode: mod.mode,
      polarity: mod.polarity,
      range: mod.range,
      curve: mod.curve,
    });
    values[targetParam].modulated = modulatedVal;
    values[targetParam].source = sourceKey;
    values[targetParam].mappingId = mod.id;
    appliedTargets.add(targetParam);
  }

  return { values };
}

/**
 * Validate a single mapping object. Throws on the first failure with a
 * specific message suitable for surfacing as a 400 Bad Request from the
 * REST CRUD endpoints.
 *
 * @param {unknown} m
 * @returns {ModulationMapping} the input, narrowed.
 */
export function validateModulationMapping(m) {
  if (!m || typeof m !== 'object') {
    throw new Error('Modulation: must be an object');
  }
  const mod = /** @type {Record<string, unknown>} */ (m);
  if (typeof mod.id !== 'string' || mod.id.length === 0) {
    throw new Error('Modulation: id must be a non-empty string');
  }
  if (!VALID_TYPES.has(mod.type)) {
    throw new Error(`Modulation ${mod.id}: type must be 'continuous'`);
  }
  if (typeof mod.enabled !== 'boolean') {
    throw new Error(`Modulation ${mod.id}: enabled must be boolean`);
  }
  const src = mod.source;
  if (!src || typeof src !== 'object') {
    throw new Error(`Modulation ${mod.id}: source required`);
  }
  if (!VALID_SOURCE_SCOPES.has(src.scope)) {
    throw new Error(`Modulation ${mod.id}: source.scope must be 'cpc'`);
  }
  // No source-key allow-list: any non-empty CPC key is a valid source (all
  // incoming signals are assignable). An absent key just no-ops at apply time.
  if (typeof src.key !== 'string' || src.key.length === 0) {
    throw new Error(`Modulation ${mod.id}: source.key must be a non-empty string`);
  }
  const tgt = mod.target;
  if (!tgt || typeof tgt !== 'object') {
    throw new Error(`Modulation ${mod.id}: target required`);
  }
  if (!VALID_TARGET_SCOPES.has(tgt.scope)) {
    throw new Error(`Modulation ${mod.id}: target.scope must be 'pattern'`);
  }
  if (typeof tgt.parameter !== 'string' || tgt.parameter.length === 0) {
    throw new Error(`Modulation ${mod.id}: target.parameter must be a non-empty string`);
  }
  // Back-compat: 'scale' was the old name for the multiply mode — migrate it.
  if (mod.mode === 'scale') mod.mode = 'multiply';
  if (!VALID_MODES.has(mod.mode)) {
    throw new Error(`Modulation ${mod.id}: mode must be 'offset', 'multiply', or 'override'`);
  }
  if (!VALID_POLARITIES.has(mod.polarity)) {
    throw new Error(`Modulation ${mod.id}: polarity must be 'unipolar' or 'bipolar'`);
  }
  if (!VALID_CURVES.has(mod.curve)) {
    throw new Error(`Modulation ${mod.id}: curve must be one of ${[...VALID_CURVES].join(', ')}`);
  }
  if (!Array.isArray(mod.range) || mod.range.length !== 2
      || !Number.isFinite(mod.range[0]) || !Number.isFinite(mod.range[1])) {
    throw new Error(`Modulation ${mod.id}: range must be [min, max] of finite numbers`);
  }
  const [lo, hi] = mod.range;
  if (lo < RANGE_MIN || lo > RANGE_MAX || hi < RANGE_MIN || hi > RANGE_MAX) {
    throw new Error(`Modulation ${mod.id}: range values must be within [${RANGE_MIN}, ${RANGE_MAX}]`);
  }
  return /** @type {ModulationMapping} */ (mod);
}

export const MODULATION_VALID_CURVES = [...VALID_CURVES];
