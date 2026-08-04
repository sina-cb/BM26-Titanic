/*
 * noise_floor.js — the NOISE-FLOOR APPLY read-back + copy for the Audio
 * Companion's MIC TUNE page (operator request 2026-08-03: "calibrate → apply
 * gives NO feedback — nothing shows the noise level was actually set").
 *
 * ░░ WHY A SEPARATE MODULE ░░
 * companion_server.js is the live analyzer + WS server; its handlers can't be
 * unit-tested without a socket. The arithmetic that decides "did the apply
 * actually land, and what does the operator get told" is PURE, so it lives
 * here (same split as party_tuning.js) and is pinned by
 * tests/companion/companion_noise_floor.test.js.
 *
 * ░░ READ-BACK DISCIPLINE ░░
 * The confirmation the operator sees is NEVER an echo of the value the UI
 * sent. The server applies, then reads the AUTHORITATIVE post-apply state —
 * the engine's own post-PATCH `/audio/config` body when the engine link is up
 * (the engine is the single source of truth + what persists), otherwise the
 * live analyzer's own `bands` (the only thing actually gating audio when the
 * engine is offline) — and `verifyGateApply` compares that read-back against
 * what was requested. A mismatch or a failed PATCH is reported LOUDLY; there
 * is no success-looking state for an apply that didn't land (codex P0).
 *
 * ░░ EFFECTIVE vs. STORED GATES ░░
 * A per-band gate of null/absent is not a missing value — it is the documented
 * "this band uses the global noiseGate" semantic (companion_server.js
 * applyGates, audio_config.js AUDIO_LIVE_FIELDS). `effectiveGates` resolves
 * that inheritance so the operator is shown the number that is actually
 * gating each band. Anything non-finite that ISN'T that documented null throws.
 *
 * The read-back PROVENANCE vocabulary (engine / local only) is shared with the
 * input-gain apply path — it lives in apply_readback.js so both confirmation
 * lines name their source with the same word.
 */
import { sourceLabel } from './apply_readback.js';

/** The three gated bands, in the order the UI shows them. */
export const NOISE_BANDS = Object.freeze(['low', 'mid', 'high']);

/** Gate values are compared at the precision the calibration rounds to (3 dp). */
export const GATE_EPSILON = 5e-4;

/**
 * Read one gate field out of a bands-shaped object.
 * @param {object} bands  an analyzer `bands` object or an engine config `bands` block
 * @param {string} field  e.g. 'noiseGate' | 'lowGate'
 * @param {boolean} inheritable  true for per-band gates (null/absent → inherit)
 * @returns {number|null} the gate, or null when the band inherits the global one
 */
function readGateField(bands, field, inheritable) {
  const v = bands[field];
  if (v === null || v === undefined) {
    if (inheritable) return null;
    throw new Error(`noise floor read-back: bands.${field} is missing`);
  }
  if (!Number.isFinite(v)) {
    throw new Error(`noise floor read-back: bands.${field} is not finite (got ${JSON.stringify(v)})`);
  }
  return +v;
}

/**
 * Normalize an analyzer/engine `bands` object into the companion's gate state
 * shape. Throws (never guesses) when the global gate is absent or non-numeric —
 * a read-back we cannot trust must fail loudly, not report a plausible number.
 *
 * @param {object} bands
 * @returns {{noiseGate:number, lowGate:number|null, midGate:number|null, highGate:number|null}}
 */
export function normalizeGateBundle(bands) {
  if (!bands || typeof bands !== 'object') {
    throw new Error(`noise floor read-back: expected a bands object, got ${JSON.stringify(bands)}`);
  }
  return {
    noiseGate: readGateField(bands, 'noiseGate', false),
    lowGate: readGateField(bands, 'lowGate', true),
    midGate: readGateField(bands, 'midGate', true),
    highGate: readGateField(bands, 'highGate', true),
  };
}

/**
 * Resolve per-band inheritance into the gate each band is ACTUALLY running.
 * @param {{noiseGate:number, lowGate:?number, midGate:?number, highGate:?number}} gates
 * @returns {{low:number, mid:number, high:number, global:number}}
 */
export function effectiveGates(gates) {
  const g = normalizeGateBundle(gates);
  const eff = (v) => (v === null ? g.noiseGate : v);
  return { low: eff(g.lowGate), mid: eff(g.midGate), high: eff(g.highGate), global: g.noiseGate };
}

/**
 * The always-visible one-liner: what the noise floor IS right now. Rendered
 * next to the calibrate control and re-sent on every gate change + on hello,
 * so it is correct after an app reload (server state, not client memory).
 *
 * @param {object} gates  companion gate state (global + per-band, null = inherit)
 * @returns {string} e.g. "low 0.061 · mid 0.043 · high 0.180 · global 0.040"
 */
export function formatGateSummary(gates) {
  const e = effectiveGates(gates);
  return `low ${e.low.toFixed(3)} · mid ${e.mid.toFixed(3)} · high ${e.high.toFixed(3)}`
    + ` · global ${e.global.toFixed(3)}`;
}

/**
 * Compare what the operator asked for against what the authoritative read-back
 * says is now in force.
 *
 * @param {object} opts
 * @param {{low?:number, mid?:number, high?:number}} opts.requested  only the bands that were sent
 * @param {{low:number, mid:number, high:number, global:number}} opts.applied  read-back (effective)
 * @param {number} [opts.epsilon]
 * @returns {{ok:boolean, mismatches:Array<{band:string, requested:number, applied:number}>}}
 */
export function verifyGateApply({ requested, applied, epsilon = GATE_EPSILON }) {
  if (!requested || typeof requested !== 'object') {
    throw new Error(`verifyGateApply: requested must be an object, got ${JSON.stringify(requested)}`);
  }
  if (!applied || typeof applied !== 'object') {
    throw new Error(`verifyGateApply: applied must be an object, got ${JSON.stringify(applied)}`);
  }
  const mismatches = [];
  for (const band of NOISE_BANDS) {
    const want = requested[band];
    if (want === undefined || want === null) continue;   // band not part of this apply
    if (!Number.isFinite(want)) {
      throw new Error(`verifyGateApply: requested.${band} is not finite (got ${JSON.stringify(want)})`);
    }
    const got = applied[band];
    if (!Number.isFinite(got)) {
      throw new Error(`verifyGateApply: applied.${band} is not finite (got ${JSON.stringify(got)})`);
    }
    if (Math.abs(got - want) > epsilon) mismatches.push({ band, requested: want, applied: got });
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Build the ONE-LINE apply confirmation (operator directive: keep it quiet —
 * one line, no banners). Success carries the READ-BACK numbers, so the text
 * can only ever state what is genuinely in force.
 *
 * @param {object} opts
 * @param {boolean} opts.ok
 * @param {'engine'|'analyzer'} opts.source
 * @param {{low:number, mid:number, high:number, global:number}} [opts.applied]
 * @param {Array<{band:string, requested:number, applied:number}>} [opts.mismatches]
 * @param {string} [opts.error]
 * @returns {string}
 */
export function formatApplyMessage({ ok, source, applied, mismatches, error }) {
  const label = sourceLabel(source, 'formatApplyMessage');
  if (error) return `✗ noise floor NOT set — ${error}`;
  if (mismatches && mismatches.length) {
    const detail = mismatches
      .map((m) => `${m.band} asked ${m.requested.toFixed(3)} got ${m.applied.toFixed(3)}`)
      .join(', ');
    return `✗ noise floor MISMATCH (${label}) — ${detail}`;
  }
  if (!ok) throw new Error('formatApplyMessage: ok=false requires an error or mismatches');
  if (!applied) throw new Error('formatApplyMessage: ok=true requires the read-back gates');
  return `✓ noise floor set (${label}) — low ${applied.low.toFixed(3)}`
    + ` · mid ${applied.mid.toFixed(3)} · high ${applied.high.toFixed(3)}`;
}

/**
 * Resolve the AUTHORITATIVE post-apply gate state, INCLUDING the refused-write
 * case (report 20260725_132, ported from input_gain.js's `runGainApply`).
 *
 * Engine took the write → its own post-PATCH `/audio/config` body: the single
 * source of truth and the thing that persists.
 *
 * Engine REFUSED the write → the engine is still up and still authoritative,
 * and it is sitting on its OWN gates; its next `audioConfig` broadcast would
 * overwrite the companion's optimistic local apply anyway. So re-read its
 * config ONCE and reconcile to that, instead of leaving the operator with a red
 * "NOT set" above a readout showing gates nothing upstream ever accepted. This
 * is one authoritative read, not a retry — and a re-read that itself fails is
 * APPENDED to the error, never swallowed.
 *
 * No engine at all → the live analyzer's own bands, which is genuinely all that
 * is gating audio then (reported to the operator as *local only*).
 *
 * @param {object} opts
 * @param {object|null} opts.patchResult  the body PATCH /audio/config returned
 * @param {string|null} [opts.error]  a PATCH failure already recorded
 * @param {null|{connected:boolean, fetchConfig?:()=>Promise<object|null>}} [opts.engineLink]
 * @param {() => object} opts.readAnalyzerBands  the live analyzer's `bands`
 * @returns {Promise<{source:'engine'|'analyzer', gates:object|null,
 *                    effective:object|null, error:string|null}>}
 */
export async function resolveGateReadBack({ patchResult, error = null, engineLink, readAnalyzerBands }) {
  if (typeof readAnalyzerBands !== 'function') {
    throw new Error('resolveGateReadBack: readAnalyzerBands must be a function');
  }
  let body = patchResult;
  let err = error;
  if (err && engineLink && typeof engineLink.fetchConfig === 'function') {
    try {
      const config = await engineLink.fetchConfig();
      if (config && config.bands && typeof config.bands === 'object') body = config;
    } catch (e) {
      err = `${err}; engine re-read failed: ${e && e.message}`;
    }
  }
  const fromEngine = !!(body && body.bands && typeof body.bands === 'object');
  const source = fromEngine ? 'engine' : 'analyzer';
  try {
    const gates = normalizeGateBundle(fromEngine ? body.bands : readAnalyzerBands());
    return { source, gates, effective: effectiveGates(gates), error: err };
  } catch (e) {
    return { source, gates: null, effective: null, error: err || `read-back failed: ${e && e.message}` };
  }
}
