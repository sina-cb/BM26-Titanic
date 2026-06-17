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

import { KNOWN_SIGNALS, validateChain, slug } from '../postproc/signal_post_processor.js';

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

// ── Custom VIEWS (2026-06-17 contract §"Companion custom VIEWS") ──────────────
// A VIEW mixes/overlays a chosen subset of the signals into one plot in the
// VISUALIZERS sidebar. A view = { id, label, type, signals:[signalId...] }.
// Two viz TYPES ship:
//   - 'dancing-balls': the dom-dance orbs (DanceMaker spring); fed FREQUENCY
//     signals (the legacy DOM DANCE is now an instance fed dom1+dom2).
//   - 'trace-overlay': fed ANY signals → overlaid colour-per-signal traces.
// Each type declares the SIGNAL TYPE it accepts so the UI can filter the
// multi-select; null = any type. Reuses the existing dance + trace renderers
// (no new viz engines). Views persist alongside signals in companion_config.yaml
// and travel in Export.
export const VIEW_TYPES = Object.freeze({
  'dancing-balls': { label: 'dancing balls', accepts: 'frequency' },
  'trace-overlay': { label: 'trace overlay', accepts: null },
});

// ── Dom signal = freq + energy (2026-06-17 contract §"Dom signal = freq + energy") ──
// A dom SOURCE produces BOTH a frequency (Hz) and an energy [0,1] every hop. A
// frequency signal designed from a dom source is therefore a freq+energy PAIR:
// the chain shapes the Hz (the value that flows through the SignalPostProcessor),
// and the paired ENERGY rides alongside it — read from the analyzer's raw dom
// energy field. When the signal is an OUTPUT, the osc_out tap emits the freq to
// its own address AND the paired energy to the dom-energy address below.
//
// This is a Companion-side pairing (no op-schema fork): the osc_out op stays
// `{ address, cpcKey }`; the energy address/key/field are DERIVED from the dom
// source via this frozen map. The energy keys (micDomEnergy1/2) are the engine's
// canonical raw-mirror CPC keys (audio/postproc/audio_signals.js) and the engine
// must bind /marsin/dom/energy1·2 → micDomEnergy1/2 for the emit to land in CPC.
export const DOM_ENERGY = Object.freeze({
  rawDom1: { field: 'domEnergy1', address: '/marsin/dom/energy1', cpcKey: 'micDomEnergy1' },
  rawDom2: { field: 'domEnergy2', address: '/marsin/dom/energy2', cpcKey: 'micDomEnergy2' },
});

/** The dom-energy pairing for a frequency signal's source, or null. */
export function domEnergyFor(source) {
  return DOM_ENERGY[source] || null;
}

// ── osc_out NAME → cpcKey / address (single-name rehaul) ──────────────────────
// The osc_out op carries ONE operator-facing `name`. cpcKey + address are
// DERIVED from it (the operator never edits them directly):
//   cpcKey  = slug(name)            address = /marsin/audio/<cpcKey>
//
// EXCEPTION — the CURATED built-in outputs. The engine binds a fixed set of
// canonical addresses (/marsin/mic/low → micLow, /marsin/dom/freq1 →
// micDomFreq1, …) and the rest of the show (AudioStructureDetector,
// DerivedSignals, every pattern's modulation source) reads those EXACT keys.
// They must NOT be slug-mangled (e.g. micLow → "miclow" would orphan the
// mission-critical audio→light path). So a name that EQUALS a curated CPC key
// keeps that key + its canonical address; every OTHER name slug-derives. The
// operator still edits only the name; these are derivation rules, not editable
// fields. Curated map mirrors audio/postproc/audio_signals.js oscAddress fields.
export const CURATED_OUTPUTS = Object.freeze({
  micLow:      '/marsin/mic/low',
  micMid:      '/marsin/mic/mid',
  micHigh:     '/marsin/mic/high',
  micKick:     '/marsin/mic/kick',
  micDomFreq1: '/marsin/dom/freq1',
  micDomFreq2: '/marsin/dom/freq2',
});

/**
 * Resolve an osc_out `name` → its derived { name, cpcKey, address }.
 *   - a CURATED name keeps its canonical cpcKey + engine-bound address,
 *   - any other name derives cpcKey = slug(name), address = /marsin/audio/<cpcKey>.
 * Throws when slug(name) is empty (Codex P0: fail loud, never substitute a
 * silent fallback key). Callers that want a soft check use slug() directly.
 */
export function resolveOscOut(name) {
  if (CURATED_OUTPUTS[name]) {
    return { name, cpcKey: name, address: CURATED_OUTPUTS[name] };
  }
  const cpcKey = slug(name);
  if (!cpcKey) {
    throw new Error(`osc_out name "${name}" has no usable letters/digits (slug is empty)`);
  }
  return { name, cpcKey, address: `/marsin/audio/${cpcKey}` };
}

/**
 * The terminal osc_out tap of a (validated) signal, or null. The tap is the
 * LAST op when it is an osc_out (validateChain guarantees terminal position).
 */
export function oscOutTapOf(sig) {
  const last = sig && Array.isArray(sig.chain) && sig.chain.length > 0
    ? sig.chain[sig.chain.length - 1] : null;
  return last && last.type === 'osc_out' ? last : null;
}

/**
 * The cpcKey an OUTPUT signal resolves to (from its osc_out name), or null for
 * a non-output signal. Throws via resolveOscOut if the name slugs to empty.
 */
export function outputCpcKeyOf(sig) {
  const tap = oscOutTapOf(sig);
  if (!tap) return null;
  return resolveOscOut(tap.params.name).cpcKey;
}

// ── Source-mode ↔ capture.device mapping (2026-06-17 contract §"Source-mode
// sync CaptainPad↔Companion") ────────────────────────────────────────────────
// CaptainPad/engine carry the SOURCE as a single `capture.device` string:
//   'test'          → the synthetic test generator,
//   'file:<path>'   → file replay of <path>,
//   <device-id>/''  → live mic on that ffmpeg device ('' / null = default input).
// These two pure functions are the single source of truth for that mapping so
// the Companion can read it (engine → Companion mode) and write it (Companion
// mode → engine) symmetrically, and so the round-trip is unit-testable without
// booting the server.

/** Parse a `capture.device` value → a Companion source target. */
export function parseCaptureDevice(device) {
  if (device === 'test') return { mode: 'test' };
  if (typeof device === 'string' && device.startsWith('file:')) {
    return { mode: 'file', file: device.slice('file:'.length) };
  }
  // mic: '' / null / undefined all mean "default input" (device: null).
  return { mode: 'mic', device: (device == null || device === '') ? null : device };
}

/**
 * The inverse: a Companion source state → its `capture.device` string. mic
 * with no device → '' (CaptainPad's "default input" convention).
 * @param {{ mode: string, file?: string, device?: (string|null) }} src
 */
export function captureDeviceString(src) {
  if (!src || src.mode === 'test') return 'test';
  if (src.mode === 'file') return `file:${src.file || ''}`;
  return src.device == null ? '' : src.device;
}

// Ops a FREQUENCY signal may use (Hz-valid only — contract §types). Every
// other op is intensity-only. osc_out is valid for BOTH (it is a terminal
// tap, not a transform).
export const FREQUENCY_OPS = Object.freeze(['lpf', 'clamp', 'slew', 'kalman', 'danceMaker', 'osc_out']);

// Ops that are FREQUENCY-ONLY — meaningful only on a Hz value and rejected on an
// intensity signal. `danceMaker` is the dom-dance spring (a freqWindow→freqWindow
// smoother, docs/37 §2.2): it produces the gliding dom orbs and has no place in
// the [0,1] intensity palette. (lpf/clamp/slew are shared with intensity, so they
// are NOT here.)
export const FREQUENCY_ONLY_OPS = Object.freeze(['danceMaker']);

/**
 * Built-in default design — one OUTPUT signal per curated CPC key the
 * companion emits (contract §"CPC keys the Companion emits"). Each is a
 * raw source → osc_out tap. Intensity bands get a gentle smoothing LPF
 * before the tap so the engine receives a clean value; frequency signals
 * pass straight to the tap (the Hz is meaningful unsmoothed).
 *
 * Single-name rehaul: each osc_out carries ONE `name`. The curated defaults
 * are named for their canonical CPC key (micLow, micDomFreq1, …) so
 * resolveOscOut maps them back to the engine-bound address (CURATED_OUTPUTS) —
 * the mission-critical audio→light path keeps its exact keys. label = name.
 */
export function defaultCompanionConfig() {
  const intensity = (id, name, source, smoothHz) => ({
    id, label: name, source, type: 'intensity', output: true,
    chain: [
      { id: `${id}_lpf`, type: 'lpf', enabled: true, params: { cutoffHz: smoothHz } },
      { id: `${id}_out`, type: 'osc_out', enabled: true, params: { name } },
    ],
  });
  const frequency = (id, name, source) => ({
    id, label: name, source, type: 'frequency', output: true,
    chain: [
      { id: `${id}_out`, type: 'osc_out', enabled: true, params: { name } },
    ],
  });
  return {
    osc: { host: '127.0.0.1', port: 10000 },
    signals: [
      intensity('low',  'micLow',      'rawLow',  5.5),
      intensity('mid',  'micMid',      'rawMid',  8.0),
      intensity('high', 'micHigh',     'rawHigh', 14.0),
      intensity('kick', 'micKick',     'rawKick', 18.0),
      frequency('dom1', 'micDomFreq1', 'rawDom1'),
      frequency('dom2', 'micDomFreq2', 'rawDom2'),
    ],
    // The legacy DOM DANCE is now a dancing-balls VIEW instance fed BOTH dom
    // signals (not a hardcoded one-off) — contract §"dancing-balls".
    views: [
      { id: 'dance', label: '✦ DOM DANCE', type: 'dancing-balls', signals: ['dom1', 'dom2'] },
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
// Back-compat: an OLD persisted osc_out op carried `{ address, cpcKey }` (no
// `name`). The single-name rehaul replaces those with one `name`. Migrate an
// old op to the new shape IN PLACE of the chain (without mutating the caller's
// object) — derive `name` from the existing cpcKey, falling back to the
// signal's label. NEW-shape ops (already carrying `name`) pass through. This is
// the ONLY non-error path for a name-less osc_out: a fresh op must always have
// a name (validateChain rejects one without).
function migrateOscOutOp(op, fallbackLabel) {
  if (!op || op.type !== 'osc_out' || !isPlainObject(op.params)) return op;
  if (typeof op.params.name === 'string') return op;   // already new shape
  const p = op.params;
  const legacyName = (typeof p.cpcKey === 'string' && p.cpcKey.trim())
    ? p.cpcKey.trim()
    : (typeof fallbackLabel === 'string' && fallbackLabel.trim() ? fallbackLabel.trim() : '');
  // Drop the old address/cpcKey params; carry the derived name forward.
  return { id: op.id, type: op.type, enabled: op.enabled, params: { name: legacyName } };
}

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
  // Single-name rehaul: migrate any OLD-shape osc_out ({address,cpcKey}) to the
  // new {name} shape before validation (back-compat load, Codex P0 no crash).
  const chain = sig.chain.map(op => migrateOscOutOp(op, sig.label));
  // Type-aware op gate: frequency signals may only carry Hz-valid ops;
  // intensity signals may not carry frequency-only ops (e.g. danceMaker).
  if (sig.type === 'frequency') {
    for (const op of chain) {
      if (op && typeof op.type === 'string' && !FREQUENCY_OPS.includes(op.type)) {
        return { ok: false, error: `signal "${sig.id}": op "${op.type}" is intensity-only; frequency signals may only use ${FREQUENCY_OPS.join(', ')}` };
      }
    }
  } else {
    for (const op of chain) {
      if (op && typeof op.type === 'string' && FREQUENCY_ONLY_OPS.includes(op.type)) {
        return { ok: false, error: `signal "${sig.id}": op "${op.type}" is frequency-only; intensity signals may not use ${FREQUENCY_ONLY_OPS.join(', ')}` };
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
  const v = validateChain(ctxKey, chain, { hz: sig.type === 'frequency' });
  if (!v.ok) return { ok: false, error: `signal "${sig.id}" chain: ${v.error}` };
  const output = v.normalized.some(op => op.type === 'osc_out');
  // ONE NAME EVERYWHERE: the signal's display label IS the osc_out name (the
  // operator-facing name shown in the Companion AND sent as the manifest label
  // → CaptainPad). Collapse label + osc_out identity into the single name.
  // A signal whose chain has no osc_out tap keeps its own label.
  const tap = v.normalized.length > 0 && v.normalized[v.normalized.length - 1].type === 'osc_out'
    ? v.normalized[v.normalized.length - 1] : null;
  const label = tap ? tap.params.name : sig.label;
  return {
    ok: true,
    normalized: {
      id: sig.id, label, source: sig.source, type: sig.type,
      chain: v.normalized, output,
    },
  };
}

/**
 * Validate one VIEW against the design's signals. Returns { ok, error,
 * normalized }. A view = { id, label, type, signals:[signalId...] }. The type
 * must be a known VIEW_TYPE; each referenced signal must exist; and when the
 * type declares an accepted signal TYPE (e.g. dancing-balls wants frequency),
 * every referenced signal must match it. `signalsById` maps id → signal type.
 */
export function validateView(view, signalsById) {
  if (!isPlainObject(view)) return { ok: false, error: 'view must be an object' };
  if (typeof view.id !== 'string' || !view.id.trim()) {
    return { ok: false, error: 'view.id must be a non-empty string' };
  }
  if (typeof view.label !== 'string' || !view.label.trim()) {
    return { ok: false, error: `view "${view.id}".label must be a non-empty string` };
  }
  const spec = VIEW_TYPES[view.type];
  if (!spec) {
    return { ok: false, error: `view "${view.id}".type must be one of ${Object.keys(VIEW_TYPES).join(', ')}` };
  }
  if (!Array.isArray(view.signals)) {
    return { ok: false, error: `view "${view.id}".signals must be an array of signal ids` };
  }
  const ids = [];
  for (const sid of view.signals) {
    if (typeof sid !== 'string' || !signalsById.has(sid)) {
      return { ok: false, error: `view "${view.id}": references unknown signal "${sid}"` };
    }
    if (spec.accepts && signalsById.get(sid) !== spec.accepts) {
      return { ok: false, error: `view "${view.id}": ${view.type} accepts ${spec.accepts} signals, but "${sid}" is ${signalsById.get(sid)}` };
    }
    ids.push(sid);
  }
  return { ok: true, normalized: { id: view.id, label: view.label, type: view.type, signals: ids } };
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
  const seenCpcKeys = new Map();   // cpcKey → signal id (output uniqueness)
  const signals = [];
  const signalsById = new Map();
  for (const sig of cfg.signals) {
    const v = validateSignal(sig);
    if (!v.ok) throw new Error(`companion config: ${v.error}`);
    if (seen.has(v.normalized.id)) throw new Error(`companion config: duplicate signal id "${v.normalized.id}"`);
    // Codex P0 — two OUTPUT signals must not resolve to the same cpcKey (it
    // would shadow/clobber each other at the engine). Fail loud, never mangle.
    const cpcKey = outputCpcKeyOf(v.normalized);
    if (cpcKey !== null) {
      if (seenCpcKeys.has(cpcKey)) {
        throw new Error(`companion config: signals "${seenCpcKeys.get(cpcKey)}" and "${v.normalized.id}" both resolve to cpcKey "${cpcKey}" (name collision)`);
      }
      seenCpcKeys.set(cpcKey, v.normalized.id);
    }
    seen.add(v.normalized.id);
    signalsById.set(v.normalized.id, v.normalized.type);
    signals.push(v.normalized);
  }
  // Views are OPTIONAL (a legacy config without a `views:` key is fine — the
  // designer just has no custom views). When present they must be an array of
  // valid view objects referencing existing signals.
  const views = [];
  if (cfg.views !== undefined) {
    if (!Array.isArray(cfg.views)) throw new Error('companion config.views must be an array');
    const seenViews = new Set();
    for (const view of cfg.views) {
      const v = validateView(view, signalsById);
      if (!v.ok) throw new Error(`companion config: ${v.error}`);
      if (seenViews.has(v.normalized.id)) throw new Error(`companion config: duplicate view id "${v.normalized.id}"`);
      seenViews.add(v.normalized.id);
      views.push(v.normalized);
    }
  }
  return { osc: { host: cfg.osc.host, port: cfg.osc.port }, signals, views };
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
