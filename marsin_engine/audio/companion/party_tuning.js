/*
 * party_tuning.js — the pure half of the Audio Companion's PARTY tab
 * (report 20260725_19). Three jobs, no IO except the one explicit
 * read-modify-write in `persistPartyConfig`:
 *
 *   1. PARTY_TUNABLES — the operator-facing spec of every `party:` threshold
 *      from report 20260725_12 §2 (label, unit, editor range, what it does).
 *      One source of truth for the UI editors AND the persist whitelist.
 *
 *   2. SURGICAL PERSIST — write edited values back into config.yaml's `party:`
 *      block by replacing the individual `key: value` LINES.
 *
 *      ░░ WHY NOT yaml.load + yaml.dump ░░
 *      Round-tripping config.yaml through js-yaml STRIPS EVERY COMMENT. It has
 *      already cost us once (the colorPalettes comments were destroyed by a
 *      well-meaning writer). config.yaml is an OPERATOR document: the comments
 *      are the calibration notes. So we never re-serialize it — we locate the
 *      exact line for each key inside the `party:` block and swap the scalar,
 *      leaving indentation, key order, trailing comments and every byte outside
 *      the changed values untouched. If a key line cannot be located EXACTLY,
 *      we THROW and write nothing (codex P0: fail loudly, never rewrite the
 *      whole file "to be safe").
 *
 *   3. CALIBRATION MATH — the percentile + suggestion arithmetic behind report
 *      20260725_12 §6.2 (ambient P95 → `ambientFloor`, party P5 → `marginX`).
 */
import fs from 'node:fs';

/**
 * The `party:` tunables the operator edits, in the order report 20260725_12 §2
 * lists them. `kind` drives the editor widget; `min`/`max`/`step` are UI ranges
 * (the detector itself validates types, and rejects unknown keys outright).
 */
export const PARTY_TUNABLES = Object.freeze([
  { key: 'ambientFloor', kind: 'number', min: 0, max: 1, step: 0.001, unit: 'audioLoudness',
    label: 'ambient floor',
    hint: 'the venue quiet-night baseline — CALIBRATE on playa (P95 of ambient loudness)' },
  { key: 'marginX', kind: 'number', min: 1, max: 20, step: 0.1, unit: '×',
    label: 'margin',
    hint: 'party must be this many × the floor — raise if a loud neighbour trips it' },
  { key: 'kickRateMin', kind: 'number', min: 0, max: 8, step: 0.1, unit: 'kicks/s',
    label: 'kick rate min', hint: 'below this it is not a dance beat (~72 BPM 4-on-floor)' },
  { key: 'kickRateMax', kind: 'number', min: 0, max: 8, step: 0.1, unit: 'kicks/s',
    label: 'kick rate max', hint: 'above this it is noise, not a kick (~192 BPM)' },
  { key: 'kickRegMin', kind: 'number', min: 0, max: 1, step: 0.01, unit: '1−CV',
    label: 'kick regularity min', hint: 'loose by design — requireBpmLock is its co-guard' },
  { key: 'requireBpmLock', kind: 'boolean',
    label: 'require BPM lock', hint: 'demand the BPM tracker LOCKED state' },
  { key: 'shapeLowMin', kind: 'number', min: 0, max: 1, step: 0.01, unit: 'share',
    label: 'low share min', hint: 'minimum bass share' },
  { key: 'shapeHighMin', kind: 'number', min: 0, max: 1, step: 0.01, unit: 'share',
    label: 'high share min',
    hint: 'THE far-camp rejector — raise this FIRST if a camp across the playa trips the gate' },
  { key: 'silenceMax', kind: 'number', min: 0, max: 1, step: 0.05, unit: '—',
    label: 'silence max', hint: 'audioSilence ≥ this ⇒ disqualified' },
  { key: 'onSustainMs', kind: 'number', min: 0, max: 120000, step: 500, unit: 'ms',
    label: 'ON sustain', hint: 'continuous qualification before the gate latches ON' },
  { key: 'offConfirmMs', kind: 'number', min: 0, max: 180000, step: 500, unit: 'ms',
    label: 'OFF confirm (release sustain)',
    hint: 'continuous disqualification before the gate releases — this IS the '
      + 'follow-the-music release sustain: in that session mode the show ends when this expires' },
]);

/** Just the keys, for validation. */
export const PARTY_TUNABLE_KEYS = Object.freeze(PARTY_TUNABLES.map((t) => t.key));

const TUNABLE_BY_KEY = new Map(PARTY_TUNABLES.map((t) => [t.key, t]));

/**
 * Render a JS value as the YAML scalar we write back. Only the two shapes the
 * `party:` block holds are legal; anything else — and any number that would
 * serialize in exponent form (`1e-7`, which reads back as a STRING in YAML 1.1)
 * — throws rather than corrupting the operator's config.
 *
 * @param {string} key
 * @param {number|boolean} value
 * @returns {string}
 */
export function formatYamlScalar(key, value) {
  const spec = TUNABLE_BY_KEY.get(key);
  if (!spec) throw new Error(`party persist: "${key}" is not a party tunable`);
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`party persist: ${key} must be a boolean, got ${JSON.stringify(value)}`);
    }
    return value ? 'true' : 'false';
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`party persist: ${key} must be a finite number, got ${JSON.stringify(value)}`);
  }
  const text = String(value);
  if (text.includes('e') || text.includes('E')) {
    throw new RangeError(
      `party persist: ${key} = ${text} serializes in exponent form, which YAML 1.1 reads back as a `
      + 'string — refusing to write it');
  }
  return text;
}

/**
 * Locate the top-level `party:` block in a config.yaml text.
 * @param {string} text
 * @returns {{start:number, end:number}} character offsets of the block BODY
 *          (everything after the `party:` line, up to the next top-level key)
 */
function locatePartyBlock(text) {
  const header = /^party:[ \t]*(?:#[^\n]*)?$/gm;
  const matches = [...text.matchAll(header)];
  if (matches.length === 0) {
    throw new Error('party persist: no top-level "party:" block in config.yaml — refusing to write');
  }
  if (matches.length > 1) {
    throw new Error(
      `party persist: ${matches.length} top-level "party:" blocks in config.yaml — ambiguous, refusing to write`);
  }
  const m = matches[0];
  const lineEnd = text.indexOf('\n', m.index + m[0].length);
  if (lineEnd === -1) {
    throw new Error('party persist: "party:" block has no body (end of file) — refusing to write');
  }
  const start = lineEnd + 1;
  // The body runs until the first line that is neither blank nor indented —
  // i.e. the next top-level key (or EOF).
  let cursor = start;
  let end = text.length;
  while (cursor < text.length) {
    let nl = text.indexOf('\n', cursor);
    if (nl === -1) nl = text.length;
    const line = text.slice(cursor, nl);
    const isBlank = line.trim() === '';
    const isIndented = /^[ \t]/.test(line);
    if (!isBlank && !isIndented) { end = cursor; break; }
    cursor = nl + 1;
  }
  if (end === text.length && cursor >= text.length) end = text.length;
  return { start, end };
}

/**
 * Surgically replace `key: value` lines inside config.yaml's `party:` block.
 *
 * Everything outside the replaced SCALARS is preserved byte-for-byte —
 * comments, blank lines, key order, indentation, trailing comments, line
 * endings. A key that is not present in the block THROWS (nothing is written):
 * silently appending it would be a fallback, and getting it wrong would corrupt
 * an operator document.
 *
 * @param {string} text — the whole config.yaml
 * @param {object} edits — { tunableKey: number|boolean }
 * @returns {string} the new text
 */
export function patchPartyBlock(text, edits) {
  if (typeof text !== 'string') throw new TypeError('party persist: config text must be a string');
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) {
    throw new TypeError('party persist: edits must be an object of { key: value }');
  }
  const keys = Object.keys(edits);
  if (keys.length === 0) throw new Error('party persist: no edits given');
  for (const k of keys) {
    if (!TUNABLE_BY_KEY.has(k)) {
      throw new Error(
        `party persist: "${k}" is not a party tunable (known: ${PARTY_TUNABLE_KEYS.join(', ')})`);
    }
  }
  const { start, end } = locatePartyBlock(text);
  let block = text.slice(start, end);
  for (const k of keys) {
    // indent + key + colon + scalar + optional trailing comment. The scalar is
    // everything up to a ` #` comment or the end of the line.
    const line = new RegExp(
      `^([ \\t]+${k}:[ \\t]*)([^\\r\\n#]*?)([ \\t]*(?:#[^\\r\\n]*)?)$`, 'gm');
    const hits = [...block.matchAll(line)];
    if (hits.length === 0) {
      throw new Error(
        `party persist: key "${k}" not found in the party: block of config.yaml — `
        + 'refusing to rewrite the file. Add the key by hand, then retry.');
    }
    if (hits.length > 1) {
      throw new Error(
        `party persist: key "${k}" appears ${hits.length} times in the party: block — `
        + 'ambiguous, refusing to write.');
    }
    const hit = hits[0];
    const scalar = formatYamlScalar(k, edits[k]);
    block = block.slice(0, hit.index)
      + hit[1] + scalar + hit[3]
      + block.slice(hit.index + hit[0].length);
  }
  return text.slice(0, start) + block + text.slice(end);
}

/**
 * Read config.yaml, patch the `party:` block surgically, write it back.
 * Throws (having written NOTHING) on any location/format failure.
 *
 * @param {string} configPath
 * @param {object} edits
 * @returns {{path:string, keys:string[]}}
 */
export function persistPartyConfig(configPath, edits) {
  const text = fs.readFileSync(configPath, 'utf8');
  const next = patchPartyBlock(text, edits);
  fs.writeFileSync(configPath, next, 'utf8');
  return { path: configPath, keys: Object.keys(edits) };
}

// ── calibration math (report 20260725_12 §6.2) ───────────────────────────────

/**
 * Linear-interpolated percentile of a sample list. `p` is in PERCENT (0..100).
 * Throws on an empty sample — "the capture recorded nothing" must be visible,
 * not silently reported as 0.
 *
 * @param {number[]} values
 * @param {number} p
 * @returns {number}
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('percentile: no samples — the capture recorded nothing');
  }
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new RangeError(`percentile: p must be 0..100, got ${JSON.stringify(p)}`);
  }
  for (const v of values) {
    if (!Number.isFinite(v)) throw new TypeError(`percentile: non-finite sample ${JSON.stringify(v)}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * The report's suggestion arithmetic:
 *
 *   ambientFloor = P95(ambient loudness)
 *   marginX      = 0.5 × ( P5(party loudness) / P95(ambient) )   — halfway, in ratio terms
 *   kickRegMin   = min(0.45, 0.8 × typical party kickReg)        — only if the real reg is low
 *
 * Both captures are required; with one missing there is no honest suggestion
 * and this returns null rather than half-guessing.
 *
 * @param {{ambientP95:number|null, partyP5:number|null, partyKickReg?:number|null}} inputs
 * @returns {{ambientFloor:number, marginX:number, kickRegMin?:number}|null}
 */
export function calibrationSuggestions({ ambientP95, partyP5, partyKickReg = null }) {
  if (!Number.isFinite(ambientP95) || !Number.isFinite(partyP5)) return null;
  if (!(ambientP95 > 0)) {
    throw new RangeError(
      `calibrationSuggestions: ambient P95 must be > 0 to form a ratio, got ${ambientP95}`);
  }
  const out = {
    ambientFloor: ambientP95,
    marginX: 0.5 * (partyP5 / ambientP95),
  };
  if (Number.isFinite(partyKickReg) && partyKickReg > 0) {
    out.kickRegMin = Math.min(0.45, 0.8 * partyKickReg);
  }
  return out;
}
