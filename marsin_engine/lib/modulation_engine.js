// ModulationEngine — Phase 0 contract module.
//
// Pure-math + schema-validation surface for the Dynamic Audio Parameter
// Mapping feature (docs/26_[todo]_audio_params_playlist.md).
//
// This module intentionally has ZERO engine dependencies. It exports:
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

/**
 * @typedef {('cpc')} ModulationSourceScope
 *   v1 source scope. Future: 'lfo', 'global', 'tempo'.
 *
 * @typedef {Object} ModulationSource
 * @property {ModulationSourceScope} scope
 * @property {string} key                One of: micLow, micMid, micHigh, micKick,
 *                                       stemsBass, stemsDrums, stemsVocals.
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
 * @typedef {('offset'|'scale')} ModulationMode
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

// Mic-band keys are populated by the AudioCapture pipeline (when audio
// analysis is ENABLED). OSC stems keys are populated by the OscListener
// from external `/marsin/stems/*` packets (when OSC is ENABLED). When
// either pipeline is disabled, the corresponding key is simply absent
// from the ParamCenter snapshot — `resolveModulationSources` defaults
// the missing key to 0, which makes the modulation a no-op (operator-
// requested behavior: "default behavior is no change" with the source
// pipeline dark, rather than spuriously moving the slider).
const VALID_SOURCE_KEYS = new Set([
  'micLow', 'micMid', 'micHigh', 'micKick',
  'stemsBass', 'stemsDrums', 'stemsVocals',
]);
const VALID_TYPES = new Set(['continuous']);
const VALID_SOURCE_SCOPES = new Set(['cpc']);
const VALID_TARGET_SCOPES = new Set(['pattern']);
const VALID_MODES = new Set(['offset', 'scale']);
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
  const baseClamped = clamp01(baseNorm);
  const sClamped = clamp01(sourceNorm);
  const [minDelta, maxDelta] = range;

  let delta;
  if (polarity === 'bipolar') {
    // Bipolar uses a symmetric-curve formulation: compute the
    // signed deviation from the source's neutral point (0.5)
    // FIRST, then apply the curve to the magnitude only, then
    // re-attach the sign. This preserves the "source=0.5 → no
    // movement" invariant for every curve (otherwise easeIn/exp
    // would shift the no-move point off 0.5, surprising the
    // operator). The scale factor `2 * max(|min|, |max|)` is the
    // peak swing; the magnitude-only curve shapes the response
    // toward the peak without breaking symmetry.
    const bipolarS = (sClamped - 0.5) * 2.0;
    const sign = bipolarS < 0 ? -1 : 1;
    const curvedMag = applyCurve(Math.abs(bipolarS), curve);
    delta = sign * curvedMag * Math.max(Math.abs(minDelta), Math.abs(maxDelta));
  } else {
    const sCurved = applyCurve(sClamped, curve);
    delta = minDelta + sCurved * (maxDelta - minDelta);
  }

  if (mode === 'scale') {
    return clamp01(baseClamped * (1.0 + delta));
  }
  return clamp01(baseClamped + delta);
}

/**
 * Pull active modulation source values from a CPC snapshot. Missing keys
 * resolve to 0 (a disabled source MUST NOT crash a render frame; the
 * mapping evaluates as a no-op which is exactly the operator-requested
 * behavior when the audio or OSC pipeline is OFF).
 * @param {{ paramCenterSnapshot: Record<string, number> }} args
 */
export function resolveModulationSources({ paramCenterSnapshot }) {
  const sources = {
    micLow: 0, micMid: 0, micHigh: 0, micKick: 0,
    stemsBass: 0, stemsDrums: 0, stemsVocals: 0,
  };
  if (!paramCenterSnapshot) return sources;
  for (const key of VALID_SOURCE_KEYS) {
    const v = paramCenterSnapshot[key];
    if (typeof v === 'number' && Number.isFinite(v)) sources[key] = v;
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
  if (!VALID_SOURCE_KEYS.has(src.key)) {
    throw new Error(`Modulation ${mod.id}: source.key must be one of ${[...VALID_SOURCE_KEYS].join(', ')}`);
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
  if (!VALID_MODES.has(mod.mode)) {
    throw new Error(`Modulation ${mod.id}: mode must be 'offset' or 'scale'`);
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
  if (lo < -1 || lo > 1 || hi < -1 || hi > 1) {
    throw new Error(`Modulation ${mod.id}: range values must be within [-1, 1]`);
  }
  return /** @type {ModulationMapping} */ (mod);
}

export const MODULATION_VALID_SOURCE_KEYS = [...VALID_SOURCE_KEYS];
export const MODULATION_VALID_CURVES = [...VALID_CURVES];
