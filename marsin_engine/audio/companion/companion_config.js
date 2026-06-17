/*
 * companion_config.js — load/save the Audio Companion's signal-designer
 * config (the persisted OUTPUT DESIGN).
 *
 * Per the 2026-06-17 companion signal-designer contract §"Output config":
 * the full design — the list of signals, each with
 *   { id, label, source, type, chain:[ops...], output:bool }
 * plus the engine OSC target — persists to `companion_config.yaml`
 * (sibling of this file), is LOADED on boot, and is written by the UI's
 * "Export config" action.
 *
 * Codex P0: every parse / shape error THROWS — no silent fallback to a
 * half-config. A missing file is the ONE non-error case: boot needs a
 * working default design, so `loadCompanionConfig` returns the built-in
 * default when the file is absent (and ONLY then).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { KNOWN_SIGNALS, validateChain } from '../postproc/signal_post_processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default on-disk location (sibling of this module).
export const COMPANION_CONFIG_PATH = path.join(__dirname, 'companion_config.yaml');

// ── Raw sources the operator can design a signal FROM (contract §types) ──────
// Each raw source maps to a value the analyzer produces every hop. Intensity
// sources are [0,1] band/kick/flux energies; frequency sources carry Hz.
export const RAW_SOURCES = Object.freeze({
  rawLow:  { type: 'intensity', label: 'LOW',  analyzer: 'low'  },
  rawMid:  { type: 'intensity', label: 'MID',  analyzer: 'mid'  },
  rawHigh: { type: 'intensity', label: 'HIGH', analyzer: 'high' },
  rawKick: { type: 'intensity', label: 'KICK', analyzer: 'kick' },
  rawFlux: { type: 'intensity', label: 'FLUX', analyzer: 'flux' },
  rawDom1: { type: 'frequency', label: 'DOM1', analyzer: 'domFreq1' },
  rawDom2: { type: 'frequency', label: 'DOM2', analyzer: 'domFreq2' },
});

export const SIGNAL_TYPES = Object.freeze(['intensity', 'frequency']);

// Ops a FREQUENCY signal may use (Hz-valid only — contract §types). Every
// other op is intensity-only. osc_out is valid for BOTH (it is a terminal
// tap, not a transform).
export const FREQUENCY_OPS = Object.freeze(['lpf', 'clamp', 'slew', 'kalman', 'osc_out']);

/**
 * Built-in default design — one OUTPUT signal per curated CPC key the
 * companion emits (contract §"CPC keys the Companion emits"). Each is a
 * raw source → osc_out tap. Intensity bands get a gentle smoothing LPF
 * before the tap so the engine receives a clean value; frequency signals
 * pass straight to the tap (the Hz is meaningful unsmoothed).
 */
export function defaultCompanionConfig() {
  const intensity = (id, label, source, address, cpcKey, smoothHz) => ({
    id, label, source, type: 'intensity', output: true,
    chain: [
      { id: `${id}_lpf`, type: 'lpf', enabled: true, params: { cutoffHz: smoothHz } },
      { id: `${id}_out`, type: 'osc_out', enabled: true, params: { address, cpcKey } },
    ],
  });
  const frequency = (id, label, source, address, cpcKey) => ({
    id, label, source, type: 'frequency', output: true,
    chain: [
      { id: `${id}_out`, type: 'osc_out', enabled: true, params: { address, cpcKey } },
    ],
  });
  return {
    osc: { host: '127.0.0.1', port: 10000 },
    signals: [
      intensity('low',  'LOW',  'rawLow',  '/marsin/mic/low',  'micLow',  5.5),
      intensity('mid',  'MID',  'rawMid',  '/marsin/mic/mid',  'micMid',  8.0),
      intensity('high', 'HIGH', 'rawHigh', '/marsin/mic/high', 'micHigh', 14.0),
      intensity('kick', 'KICK', 'rawKick', '/marsin/mic/kick', 'micKick', 18.0),
      frequency('dom1', 'DOM1', 'rawDom1', '/marsin/dom/freq1', 'micDomFreq1'),
      frequency('dom2', 'DOM2', 'rawDom2', '/marsin/dom/freq2', 'micDomFreq2'),
    ],
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate one designed signal. Returns { ok, error, normalized }.
 * A signal carries { id, label, source, type, chain, output }. The chain
 * is validated through the engine's own validateChain (against the signal's
 * source band so paramKey checks etc. apply) — the SAME validator the
 * engine uses, never a fork (companion HARD RULE). For type-awareness we
 * additionally reject Hz-invalid ops on frequency signals.
 */
export function validateSignal(sig) {
  if (!isPlainObject(sig)) return { ok: false, error: 'signal must be an object' };
  if (typeof sig.id !== 'string' || !sig.id.trim()) {
    return { ok: false, error: 'signal.id must be a non-empty string' };
  }
  if (typeof sig.label !== 'string' || !sig.label.trim()) {
    return { ok: false, error: `signal "${sig.id}".label must be a non-empty string` };
  }
  if (!RAW_SOURCES[sig.source]) {
    return { ok: false, error: `signal "${sig.id}".source "${sig.source}" is not a known raw source (${Object.keys(RAW_SOURCES).join(', ')})` };
  }
  if (!SIGNAL_TYPES.includes(sig.type)) {
    return { ok: false, error: `signal "${sig.id}".type must be one of ${SIGNAL_TYPES.join(', ')}` };
  }
  if (RAW_SOURCES[sig.source].type !== sig.type) {
    return { ok: false, error: `signal "${sig.id}": source "${sig.source}" is ${RAW_SOURCES[sig.source].type}, but type is "${sig.type}"` };
  }
  if (!Array.isArray(sig.chain)) {
    return { ok: false, error: `signal "${sig.id}".chain must be an array of ops` };
  }
  // Type-aware op gate: frequency signals may only carry Hz-valid ops.
  if (sig.type === 'frequency') {
    for (const op of sig.chain) {
      if (op && typeof op.type === 'string' && !FREQUENCY_OPS.includes(op.type)) {
        return { ok: false, error: `signal "${sig.id}": op "${op.type}" is intensity-only; frequency signals may only use ${FREQUENCY_OPS.join(', ')}` };
      }
    }
  }
  // Reuse the engine's chain validator. We borrow a mic signal key as the
  // validation context (the op SCHEMA + terminal-osc_out rules are signal-
  // agnostic; only paramKey existence checks are keyed, and designed signals
  // don't use paramKey gains). micLow is always in KNOWN_SIGNALS.
  // For a FREQUENCY signal we pass `hz: true` so the clamp op's min/max may be
  // Hz bounds (e.g. 40–4000 Hz) instead of [0,1] — the SAME validator, only
  // the accepted clamp range widens (companion contract 2026-06-17).
  const ctxKey = KNOWN_SIGNALS[0];
  const v = validateChain(ctxKey, sig.chain, { hz: sig.type === 'frequency' });
  if (!v.ok) return { ok: false, error: `signal "${sig.id}" chain: ${v.error}` };
  const output = sig.chain.some(op => op.type === 'osc_out');
  return {
    ok: true,
    normalized: {
      id: sig.id, label: sig.label, source: sig.source, type: sig.type,
      chain: v.normalized, output,
    },
  };
}

/**
 * Validate a full companion config object. Throws on any error (Codex P0).
 * Returns the normalized config.
 */
export function validateCompanionConfig(cfg) {
  if (!isPlainObject(cfg)) throw new Error('companion config must be an object');
  if (!isPlainObject(cfg.osc)) throw new Error('companion config.osc must be an object { host, port }');
  if (typeof cfg.osc.host !== 'string' || !cfg.osc.host.trim()) {
    throw new Error('companion config.osc.host must be a non-empty string');
  }
  if (!Number.isInteger(cfg.osc.port) || cfg.osc.port < 1 || cfg.osc.port > 65535) {
    throw new Error(`companion config.osc.port must be an integer in [1, 65535], got ${cfg.osc.port}`);
  }
  if (!Array.isArray(cfg.signals)) throw new Error('companion config.signals must be an array');
  const seen = new Set();
  const signals = [];
  for (const sig of cfg.signals) {
    const v = validateSignal(sig);
    if (!v.ok) throw new Error(`companion config: ${v.error}`);
    if (seen.has(v.normalized.id)) throw new Error(`companion config: duplicate signal id "${v.normalized.id}"`);
    seen.add(v.normalized.id);
    signals.push(v.normalized);
  }
  return { osc: { host: cfg.osc.host, port: cfg.osc.port }, signals };
}

// ── IO ────────────────────────────────────────────────────────────────────

/**
 * Load the companion config from disk. Returns the normalized config.
 * A MISSING file is the only non-error path → the built-in default design
 * (boot must always have a working set). Any present-but-broken file
 * throws (Codex P0: no silent fallback over a corrupt config).
 *
 * @param {string} [filePath]
 * @returns {{ osc, signals }}
 */
export function loadCompanionConfig(filePath = COMPANION_CONFIG_PATH) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return validateCompanionConfig(defaultCompanionConfig());
    throw new Error(`companion config read failed (${filePath}): ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new Error(`companion config parse failed (${filePath}): ${err.message}`);
  }
  return validateCompanionConfig(parsed);
}

/**
 * Write a config to disk (the UI's "Export config"). Validates BEFORE
 * writing — never persist an invalid design.
 *
 * @param {{ osc, signals }} cfg
 * @param {string} [filePath]
 */
export function saveCompanionConfig(cfg, filePath = COMPANION_CONFIG_PATH) {
  const normalized = validateCompanionConfig(cfg);
  const text = yaml.dump(normalized, { lineWidth: 100, noRefs: true });
  fs.writeFileSync(filePath, text, 'utf8');
  return normalized;
}

/** Serialize a config to YAML text (for the export modal) without writing. */
export function dumpCompanionConfig(cfg) {
  const normalized = validateCompanionConfig(cfg);
  return yaml.dump(normalized, { lineWidth: 100, noRefs: true });
}
