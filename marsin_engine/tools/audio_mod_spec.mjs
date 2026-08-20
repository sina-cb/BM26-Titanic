/*
  audio_mod_spec.mjs — parse a show pattern's AUDIO_MODULATION_V1 header block.

  SHARED SPEC PARSER — the ONE parser of the block. Consumed by the offline
  tooling (gallery variation generator + pattern audio harness) AND, since
  2026-08-06, by the ENGINE (api_server stamps each slider export with its
  declared suggestion — see `audioSuggestionsForPattern`). Node built-ins +
  the pure audio-signal registry only — no third-party deps, no I/O of its
  own (the caller passes the pattern SOURCE string). Pure + offline-safe.

  ── The block ──────────────────────────────────────────────────────────────
  Every show pattern carries one parseable header block declaring which synth
  audio signals drive which sliders, plus the sane override range + curve:

    AUDIO_MODULATION_V1:
      sliderLevel  <- micLow  range 0.30..1.00 curve linear   # PRIMARY ...
      sliderKick   <- micKick range 0.00..1.00 curve pow2     # ...
      ...

  One mapping per line, strict format:
    slider<Name> <- mic<Sig> range <a>..<b> curve <linear|pow2|ease>  # note
  The `# note` is optional. Blank lines, lines that are ONLY a comment
  (`# STATIC ...`, `# sliderScale static ...`), and the parenthetical
  "(static, omit ...)" prose lines are IGNORED. A line that LOOKS like a
  mapping (has `<-`) but is malformed is a HARD ERROR (codex P0: fail loud,
  never silently drop a mapping).

  The deployed engine applies each mapping as an OVERRIDE modulation:
    param = lerp(min, max, curve(signal))   with signal in [0,1]
  so the gallery's sound-reactive clip must drive sliders the same way — that
  is exactly what `modString` encodes for the harness (see below).

  ── Contract ────────────────────────────────────────────────────────────────
  parseAudioModSpec(patternSource) -> {
    version,                                             // 'AUDIO_MODULATION_V1'
    mappings: [{ slider, signal, min, max, curve, note }],  // declaration order
    modString,                                          // harness --mod string
    synth,                                              // musical synth to drive it
  }

  - slider : the pattern's slider export name, e.g. "sliderLevel".
  - signal : one of micLow|micMid|micHigh|micKick|micFlux — DERIVED from the
             authoritative registry (audio/postproc/audio_signals.js), never
             hand-listed here.
  - min,max: the override range floats (a..b), min may exceed max (allowed —
             the engine lerps regardless; we only reject non-numbers).
  - curve  : 'linear' | 'pow2' | 'ease' (token map below; unknown -> error).
  - note   : the trailing `# ...` short explanation, '' when the line has none.
             SURFACED as of 2026-08-06 (report 20260806_184) — it is the
             operator-facing "why this mapping" text CaptainPad shows next to
             the parameter. It used to be parsed and then STRIPPED here.

  ── Version ─────────────────────────────────────────────────────────────────
  The block tag stays AUDIO_MODULATION_V1. The 2026-08-06 metadata work
  ADDED no syntax: `range`, `curve` and the `# note` were already part of the
  V1 grammar — the note was simply discarded by the parser. Every existing
  header parses byte-identically, so a version bump would have been a lie.
  `version` is returned so downstream schema validation (engine + CaptainPad)
  can assert what it is reading rather than assume.
  - modString: comma list of `<signal>:<slider>:<min>:<max>:<curve>` tokens, the
             exact grammar pattern_audio_harness.mjs --mod accepts (with ranges).
             e.g. "micLow:sliderLevel:0.30:1.00:linear,micKick:sliderKick:0.00:1.00:pow2".
  - synth  : a musical synth (from audio/synth/test_synths.js) chosen to EXERCISE
             the PRIMARY mapping — see pickSynth() for the rule. Default
             'full_track'; beat/kick-gated patterns -> 'kick_4floor'.

  If the source has NO AUDIO_MODULATION_V1 block, returns null (the caller
  decides what to do — the gallery skips the sound clip and reports it).
*/

import { micSignalShortNames } from '../audio/postproc/audio_signals.js';

// Curve tokens accepted in the block -> the canonical harness curve name.
const CURVE_TOKENS = { linear: 'linear', pow2: 'pow2', ease: 'ease' };
// Valid signal sources (mic<Sig>). DERIVED from the authoritative registry
// (audio/postproc/audio_signals.js) — this was a hand-typed 5-element Set and
// the ONLY place in the repo that rejects an unknown signal name, so the
// hand-listing was the exact drift hazard the registry exists to remove
// (recon 20260806_183 §"places the signal list is hard-coded MORE THAN ONCE").
// The harness's SIG_FIELD map derives from the SAME call.
export const VALID_SIGNALS = new Set(Object.keys(micSignalShortNames()));

export const BLOCK_VERSION = 'AUDIO_MODULATION_V1';
const BLOCK_HEADER = `${BLOCK_VERSION}:`;

// The block's curve vocabulary (the offline harness's names) mapped onto the
// ENGINE's ModulationCurve vocabulary (`VALID_CURVES` in modulation_engine.js).
// They were always the same functions under different names:
//     linear  x              == engine 'linear'
//     pow2    x²             == engine 'easeIn'
//     ease    1 - (1 - x)²   == engine 'easeOut'
// Publishing the translation HERE means no consumer re-derives it — the
// suggestion metadata carries both the declared token and the modulation-engine
// token, so CaptainPad can prefill a mapping without a private lookup table
// (that kind of hand-copied table is exactly what hid the FLUX gap).
// `tests/tools/audio_mod_spec.test.mjs` pins the targets against
// MODULATION_VALID_CURVES.
export const MODULATION_CURVE_BY_BLOCK_CURVE = Object.freeze({
  linear: 'linear',
  pow2: 'easeIn',
  ease: 'easeOut',
});
// A mapping line: `slider<Name> <- mic<Sig> range a..b curve <tok>  # note`.
// Captures: 1=slider 2=signal 3=min 4=max 5=curve 6=note(optional).
const MAPPING_RE =
  /^(slider[A-Za-z0-9_]+)\s*<-\s*(mic[A-Za-z0-9_]+)\s+range\s+(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)\s+curve\s+([A-Za-z0-9_]+)\s*(?:#(.*))?$/;

// Pick the musical synth that best EXERCISES the block's PRIMARY mapping.
//
// Rule (kept simple + documented):
//   - Default: 'full_track' — a broad mix that lifts micLow/mid/high/flux, so
//     the usual micLow->level PRIMARY (continuous brightness) reads well.
//   - 'kick_4floor' when the pattern is BEAT-DRIVEN: the PRIMARY is kick-gated
//     (a micKick mapping is flagged PRIMARY, or full_track's low band would be
//     too constant to show the headline event), or the pattern name suggests a
//     beat (heartbeat / kick / shockwave / strobe). full_track's low band is
//     near-constant, so kick-gated patterns need the 4-on-the-floor kick to
//     make the headline event fire.
//   - POSITIONAL / swipe patterns (e.g. 27_swipe: micLow->sliderSwipePos drives
//     POSITION, not brightness) still use 'full_track' — the low band sweeps the
//     position, which full_track exercises fine.
//
// patternName is the source basename (no extension) when known, else ''.
function pickSynth(mappings, patternName) {
  const name = (patternName || '').toLowerCase();
  const beatName = /heartbeat|kick|shockwave|strobe/.test(name);

  // Is the PRIMARY kick-gated? PRIMARY is the mapping flagged `# PRIMARY` in its
  // note, else the conventional micLow->slider*Level. If that PRIMARY rides
  // micKick (or there is an explicitly-PRIMARY micKick mapping), it's beat-gated.
  let primaryKick = false;
  const flaggedPrimary = mappings.filter((m) => /\bPRIMARY\b/i.test(m.note || ''));
  if (flaggedPrimary.length) {
    primaryKick = flaggedPrimary.some((m) => m.signal === 'micKick');
  } else {
    // No explicit flag: the conventional PRIMARY is micLow -> a *Level slider.
    const conv = mappings.find((m) => m.signal === 'micLow' && /level/i.test(m.slider));
    if (!conv) {
      // No micLow->level PRIMARY at all and a micKick mapping present -> the
      // headline event is the kick (e.g. a pure beat trigger).
      primaryKick = mappings.some((m) => m.signal === 'micKick') &&
        !mappings.some((m) => m.signal === 'micLow');
    }
  }

  return (beatName || primaryKick) ? 'kick_4floor' : 'full_track';
}

// Format a float for the modString the way the block writes it (2 decimals is
// the block convention, e.g. 0.30, 1.00). Keeps the harness token readable.
// FAIL LOUD if a range value needs more than 2 decimals: toFixed(2) would
// SILENTLY round it (0.305 -> 0.30), so the harness would drive a different
// range than the block declared. The block convention is 2 decimals; anything
// finer is a mistake we surface rather than quietly truncate.
function fmt(n) {
  const s = n.toFixed(2);
  if (Number(s) !== n) {
    throw new Error('audio_mod_spec: range value ' + n + ' needs >2 decimals; ' +
      'the modString is 2-decimal and would lose precision — widen it to 2 ' +
      'decimals in the AUDIO_MODULATION_V1 block.');
  }
  return s;
}

// Parse the AUDIO_MODULATION_V1 block out of a pattern's SOURCE string.
// Returns { version, mappings, modString, synth } or null when there is no
// block. THROWS on a malformed mapping line (fail loud — never drop a mapping).
//
// patternName (optional) feeds pickSynth's beat-name heuristic AND every error
// message, so a bad header is refused BY NAME (the engine parses arbitrary
// patterns now — "malformed mapping line" with no pattern name is unactionable
// on a rig at night). Pass the source basename without extension.
export function parseAudioModSpec(patternSource, patternName = '') {
  // Names the offender in every throw: `parseAudioModSpec[13_sparkle]: ...`.
  const who = patternName ? `parseAudioModSpec[${patternName}]` : 'parseAudioModSpec';
  if (typeof patternSource !== 'string') {
    throw new Error(`${who}: patternSource must be a string`);
  }
  const lines = patternSource.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(BLOCK_HEADER)) { start = i; break; }
  }
  if (start === -1) return null;

  const mappings = [];
  const seenSliders = new Set();
  // The block runs from the header line until the comment block closes (`*/`),
  // the pattern code begins (a line with `export`), or a blank-after-content
  // boundary. We scan forward and pick out mapping lines; we stop at `*/` or
  // `export var` which always end the header comment.
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // End of the header comment / start of code -> stop scanning.
    if (trimmed.includes('*/') || /^export\s+var\b/.test(trimmed)) break;
    if (trimmed === '') continue;
    // A line that is ONLY a comment (block prose like the "(static, omit ...)"
    // note, or a `# STATIC ...` / `# slider* static ...` line) is ignored.
    if (trimmed.startsWith('#') || trimmed.startsWith('(')) continue;
    // Anything without a mapping arrow is non-mapping prose -> ignore.
    if (!trimmed.includes('<-')) continue;

    const m = MAPPING_RE.exec(trimmed);
    if (!m) {
      throw new Error(
        `${who}: malformed ${BLOCK_VERSION} mapping line: "` + trimmed + '"');
    }
    const [, slider, signal, minS, maxS, curveTok, noteRaw] = m;
    if (!VALID_SIGNALS.has(signal)) {
      throw new Error(`${who}: unknown signal "` + signal +
        '" in line: "' + trimmed + '" (valid: ' + [...VALID_SIGNALS].join(', ') + ')');
    }
    const curve = CURVE_TOKENS[curveTok];
    if (!curve) {
      throw new Error(`${who}: unknown curve token "` + curveTok +
        '" in line: "' + trimmed + '" (valid: ' + Object.keys(CURVE_TOKENS).join(', ') + ')');
    }
    const min = parseFloat(minS);
    const max = parseFloat(maxS);
    if (!isFinite(min) || !isFinite(max)) {
      throw new Error(`${who}: non-numeric range in line: "` + trimmed + '"');
    }
    if (seenSliders.has(slider)) {
      // The engine enforces ONE modulation per target parameter
      // (modulation_engine.js v1 policy), so two header lines claiming the
      // same slider cannot both be honoured — the second would silently win
      // in a Map-keyed consumer. Refuse instead (Codex P0).
      throw new Error(`${who}: duplicate mapping for slider "` + slider +
        '" — one audio suggestion per parameter');
    }
    seenSliders.add(slider);
    const note = (noteRaw || '').trim();
    mappings.push({ slider, signal, min, max, curve, note });
  }

  if (!mappings.length) {
    throw new Error(`${who}: ${BLOCK_VERSION} block present but no valid mapping lines parsed`);
  }

  const modString = mappings
    .map((mp) => [mp.signal, mp.slider, fmt(mp.min), fmt(mp.max), mp.curve].join(':'))
    .join(',');
  const synth = pickSynth(mappings, patternName);

  // The `note` rides the PUBLIC contract as of 2026-08-06 — it is the short
  // operator-facing explanation CaptainPad renders beside the parameter. It
  // used to be stripped here, which is why the explanation the patterns have
  // always carried was invisible to every consumer but pickSynth.
  return { version: BLOCK_VERSION, mappings, modString, synth };
}

/**
 * The block's mappings as an AUDIO SUGGESTION map, keyed by the runtime
 * parameter name (the slider export name — the same identifier the WASM host
 * reports and `ModulationMapping.target.parameter` stores, so no lookup table
 * is needed anywhere).
 *
 *   { sliderStarCount: {
 *       version, signal, range: [min, max], curve, modulationCurve, note?
 *   } }
 *
 * `curve` is the token the header declared (linear|pow2|ease);
 * `modulationCurve` is the SAME curve named in the modulation engine's
 * vocabulary (linear|easeIn|easeOut), so a client can prefill a mapping
 * without owning a translation table.
 *
 * CONTRACT (report 20260806_184):
 *   - This is METADATA ONLY. A suggestion never changes a parameter's name or
 *     its value; it is a hint the operator may accept, and nothing acts on it
 *     automatically.
 *   - `note` is OMITTED when the header line carried no `# ...` explanation —
 *     absent means absent. Nothing is ever inferred to fill a gap.
 *   - A pattern with no block has NO suggestions (parseAudioModSpec → null →
 *     `{}` here). A pattern with a MALFORMED block throws out of the parser and
 *     never reaches this function.
 *
 * @param {object|null} spec — a parseAudioModSpec result, or null.
 * @returns {object} slider name → suggestion (empty object when spec is null)
 */
export function audioSuggestionsBySlider(spec) {
  if (spec === null || spec === undefined) return {};
  if (spec.version !== BLOCK_VERSION) {
    throw new Error(`audioSuggestionsBySlider: unsupported block version "${spec.version}" ` +
      `(this parser speaks ${BLOCK_VERSION})`);
  }
  const out = {};
  for (const m of spec.mappings) {
    const modulationCurve = MODULATION_CURVE_BY_BLOCK_CURVE[m.curve];
    if (!modulationCurve) {
      throw new Error(`audioSuggestionsBySlider: no modulation-engine curve for block curve "${m.curve}"`);
    }
    const suggestion = {
      version: BLOCK_VERSION,
      signal: m.signal,
      range: [m.min, m.max],
      curve: m.curve,
      modulationCurve,
    };
    if (m.note) suggestion.note = m.note;
    out[m.slider] = suggestion;
  }
  return out;
}
