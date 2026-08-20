/*
 * input_gain.js — the INPUT-GAIN APPLY read-back + copy for the Audio
 * Companion's MIC TUNE page (follow-up to report 202607/20260725_129 §4: the
 * gain calibration's "✓ Apply gain" still fired a `setInputGain` and forgot
 * about it — a rejected apply looked exactly like a successful one).
 *
 * ░░ WHY A SEPARATE MODULE ░░
 * Same split as noise_floor.js / party_tuning.js: companion_server.js is the
 * live analyzer + WS server and its handlers can't be unit-tested without a
 * socket, so the arithmetic that decides "did the gain actually land, and what
 * does the operator get told" is PURE and lives here. Pinned by
 * tests/companion/companion_input_gain.test.js.
 *
 * ░░ READ-BACK DISCIPLINE (identical to noise_floor.js) ░░
 * The confirmation the operator sees is NEVER an echo of the value the UI
 * sent. The server applies, then reads the AUTHORITATIVE post-apply gain — the
 * engine's own post-PATCH `/audio/config` body when the engine link is up
 * (the engine persists it and rebroadcasts it to CaptainPad), otherwise the
 * companion's live analyzer gain, labelled `local only` — and `verifyGainApply`
 * compares that read-back against what was requested. A rejected PATCH, a
 * read-back that throws, or a value that came back different are all reported
 * LOUDLY; there is no success-looking state for an apply that didn't land
 * (codex P0).
 *
 * ░░ UNITS ░░
 * `inputGain` is a linear software preamp multiplier on the captured PCM, NOT
 * dB. The engine's PATCH validator and the analyzer both bound it to
 * [GAIN_MIN, GAIN_MAX]; a read-back outside that range means something
 * upstream is broken and THROWS rather than being displayed as fact.
 */
import { sourceLabel } from './apply_readback.js';

/** The bounds the engine's PATCH validator + the analyzer enforce on inputGain. */
export const GAIN_MIN = 0;
export const GAIN_MAX = 64;

/**
 * Requested vs. read-back are compared at the precision the gain calibration
 * recommends at (`recommendedGain` is rounded to 2 dp in companion_server.js's
 * finishCalibration), so a pure rounding difference is not a mismatch.
 */
export const GAIN_EPSILON = 5e-3;

/**
 * Validate a gain the OPERATOR asked for (a UI message value). Out of range or
 * non-numeric is a malformed request, not something to clamp into a distorting
 * value — it throws so the apply is refused loudly and nothing is written.
 *
 * @param {number} value
 * @returns {number}
 */
export function normalizeGainRequest(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`input gain apply: requested gain must be a finite number (got ${JSON.stringify(value)})`);
  }
  if (value < GAIN_MIN || value > GAIN_MAX) {
    throw new Error(`input gain apply: requested gain ${value} is outside [${GAIN_MIN}, ${GAIN_MAX}]`);
  }
  return +value;
}

/**
 * Read the gain out of a `bands`-shaped object — an engine `/audio/config`
 * bands block or the companion's own live analyzer bands. Missing, non-finite
 * or out-of-range THROWS (codex P0: never invent a number to display, and
 * never present a broken read-back as the truth).
 *
 * @param {object} bands
 * @returns {number}
 */
export function normalizeInputGain(bands) {
  if (!bands || typeof bands !== 'object') {
    throw new Error(`input gain read-back: expected a bands object, got ${JSON.stringify(bands)}`);
  }
  const v = bands.inputGain;
  if (v === null || v === undefined) {
    throw new Error('input gain read-back: bands.inputGain is missing');
  }
  if (!Number.isFinite(v)) {
    throw new Error(`input gain read-back: bands.inputGain is not finite (got ${JSON.stringify(v)})`);
  }
  if (v < GAIN_MIN || v > GAIN_MAX) {
    throw new Error(`input gain read-back: bands.inputGain ${v} is outside [${GAIN_MIN}, ${GAIN_MAX}]`);
  }
  return +v;
}

/**
 * The always-visible one-liner: what the input gain IS right now. Rendered
 * under the gain-calibration control and re-sent with every `inputGain` frame
 * + on hello, so it is correct after an app reload (server state, never client
 * memory). 2 dp so an engine clamp is visible instead of being rounded away.
 *
 * @param {number} gain
 * @returns {string} e.g. "×2.50"
 */
export function formatGainSummary(gain) {
  if (!Number.isFinite(gain)) {
    throw new Error(`formatGainSummary: gain must be a finite number (got ${JSON.stringify(gain)})`);
  }
  return `×${(+gain).toFixed(2)}`;
}

/**
 * Compare what the operator asked for against what the authoritative read-back
 * says is now in force.
 *
 * @param {object} opts
 * @param {number} opts.requested
 * @param {number} opts.applied  the read-back gain
 * @param {number} [opts.epsilon]
 * @returns {{ok:boolean, mismatch:null|{requested:number, applied:number}}}
 */
export function verifyGainApply({ requested, applied, epsilon = GAIN_EPSILON }) {
  if (!Number.isFinite(requested)) {
    throw new Error(`verifyGainApply: requested is not finite (got ${JSON.stringify(requested)})`);
  }
  if (!Number.isFinite(applied)) {
    throw new Error(`verifyGainApply: applied is not finite (got ${JSON.stringify(applied)})`);
  }
  const ok = Math.abs(applied - requested) <= epsilon;
  return { ok, mismatch: ok ? null : { requested: +requested, applied: +applied } };
}

/**
 * Build the ONE-LINE apply confirmation (operator directive: keep it quiet —
 * one line, no banners). Success carries the READ-BACK number, so the text can
 * only ever state what is genuinely in force. An incoherent outcome throws
 * instead of rendering a reassuring sentence.
 *
 * @param {object} opts
 * @param {boolean} opts.ok
 * @param {'engine'|'analyzer'} opts.source
 * @param {number} [opts.applied]  the read-back gain (required when ok)
 * @param {null|{requested:number, applied:number}} [opts.mismatch]
 * @param {string} [opts.error]
 * @returns {string}
 */
export function formatGainApplyMessage({ ok, source, applied, mismatch, error }) {
  const label = sourceLabel(source, 'formatGainApplyMessage');
  if (error) return `✗ input gain NOT set — ${error}`;
  if (mismatch) {
    return `✗ input gain MISMATCH (${label}) — asked ${formatGainSummary(mismatch.requested)}`
      + ` got ${formatGainSummary(mismatch.applied)}`;
  }
  if (!ok) throw new Error('formatGainApplyMessage: ok=false requires an error or a mismatch');
  if (applied === undefined || applied === null) {
    throw new Error('formatGainApplyMessage: ok=true requires the read-back gain');
  }
  return `✓ input gain set (${label}) — ${formatGainSummary(applied)}`;
}

/**
 * THE APPLY PATH itself, with every side effect injected so the ORDER — which
 * is the whole point of this change — is testable without a socket, a live
 * analyzer or an engine:
 *
 *   validate the request (refuse out-of-range, write nothing)
 *     → apply locally (analysis never blocks on the engine)
 *     → AWAIT the engine PATCH
 *     → read the AUTHORITATIVE post-apply gain back (the engine's own config
 *       when it is up — including after it REFUSED the write; the live
 *       analyzer only when there is no engine to be authoritative)
 *     → reconcile the local value to it (the engine may clamp, or may have
 *       kept its own — what is shown must be the engine's number, not ours)
 *     → verify requested vs. read-back
 *     → one line saying what actually landed.
 *
 * @param {object} opts
 * @param {number} opts.requested  the gain the operator asked for
 * @param {(gain:number) => void} opts.applyLocal  apply + echo to UI clients
 * @param {null|{connected:boolean, patch:(partial:object)=>Promise<object>,
 *               fetchConfig?:()=>Promise<object|null>}} opts.engineLink
 * @param {() => number} opts.readAnalyzerGain  the gain the live analyzer runs
 * @returns {Promise<{ok:boolean, source:'engine'|'analyzer', gain:number|null,
 *                    mismatch:null|object, error:string|null, text:string}>}
 */
export async function runGainApply({ requested, applyLocal, engineLink, readAnalyzerGain }) {
  if (typeof applyLocal !== 'function') throw new Error('runGainApply: applyLocal must be a function');
  if (typeof readAnalyzerGain !== 'function') throw new Error('runGainApply: readAnalyzerGain must be a function');
  const value = normalizeGainRequest(requested);
  applyLocal(value);

  let patchResult = null;
  let error = null;
  if (engineLink && engineLink.connected) {
    try {
      patchResult = await engineLink.patch({ bands: { inputGain: value } });
    } catch (e) {
      error = `engine PATCH failed: ${e && e.message}`;
    }
  }
  // A REFUSED write leaves the engine on its OWN value — and the engine is the
  // truth that persists (its next `audioConfig` broadcast overwrites our
  // optimistic local apply anyway). So re-read it and reconcile to THAT, rather
  // than leaving the operator staring at a red "NOT set" next to the number
  // nothing upstream ever agreed to. Not a retry: one authoritative read.
  if (error && engineLink && typeof engineLink.fetchConfig === 'function') {
    try {
      const config = await engineLink.fetchConfig();
      if (config && config.bands && typeof config.bands === 'object') patchResult = config;
    } catch (e) {
      error = `${error}; engine re-read failed: ${e && e.message}`;
    }
  }
  const fromEngine = !!(patchResult && patchResult.bands && typeof patchResult.bands === 'object');
  let source = fromEngine ? 'engine' : 'analyzer';
  let gain = null;
  try {
    gain = fromEngine
      ? normalizeInputGain(patchResult.bands)
      : normalizeInputGain({ inputGain: readAnalyzerGain() });
  } catch (e) {
    error = error || `read-back failed: ${e && e.message}`;
    gain = null;
  }
  if (gain !== null && gain !== value) applyLocal(gain);
  const verdict = (!error && gain !== null)
    ? verifyGainApply({ requested: value, applied: gain })
    : { ok: false, mismatch: null };
  const ok = !error && verdict.ok;
  return {
    ok,
    source,
    gain,
    mismatch: verdict.mismatch,
    error: error || null,
    text: formatGainApplyMessage({
      ok, source, applied: gain === null ? undefined : gain,
      mismatch: verdict.mismatch, error,
    }),
  };
}
