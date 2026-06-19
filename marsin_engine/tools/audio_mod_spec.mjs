/*
  audio_mod_spec.mjs — parse a show pattern's AUDIO_MODULATION_V1 header block.

  SHARED SPEC PARSER for the offline tooling (gallery variation generator +
  pattern audio harness). Node built-ins only — no deps, no I/O of its own
  (the caller passes the pattern SOURCE string). Pure + offline-safe.

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
    mappings: [{ slider, signal, min, max, curve }],   // declaration order
    modString,                                          // harness --mod string
    synth,                                              // musical synth to drive it
  }

  - slider : the pattern's slider export name, e.g. "sliderLevel".
  - signal : one of micLow|micMid|micHigh|micKick|micFlux.
  - min,max: the override range floats (a..b), min may exceed max (allowed —
             the engine lerps regardless; we only reject non-numbers).
  - curve  : 'linear' | 'pow2' | 'ease' (token map below; unknown -> error).
  - modString: comma list of `<signal>:<slider>:<min>:<max>:<curve>` tokens, the
             exact grammar pattern_audio_harness.mjs --mod accepts (with ranges).
             e.g. "micLow:sliderLevel:0.30:1.00:linear,micKick:sliderKick:0.00:1.00:pow2".
  - synth  : a musical synth (from audio/synth/test_synths.js) chosen to EXERCISE
             the PRIMARY mapping — see pickSynth() for the rule. Default
             'full_track'; beat/kick-gated patterns -> 'kick_4floor'.

  If the source has NO AUDIO_MODULATION_V1 block, returns null (the caller
  decides what to do — the gallery skips the sound clip and reports it).
*/

// Curve tokens accepted in the block -> the canonical harness curve name.
const CURVE_TOKENS = { linear: 'linear', pow2: 'pow2', ease: 'ease' };
// Valid synth signal sources (mic<Sig>); mirrors the harness SIG_FIELD keys.
const VALID_SIGNALS = new Set(['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux']);

const BLOCK_HEADER = 'AUDIO_MODULATION_V1:';
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
// Returns { mappings, modString, synth } or null when there is no block.
// THROWS on a malformed mapping line (fail loud — never drop a mapping).
//
// patternName (optional) is used only by pickSynth's beat-name heuristic; pass
// the source basename without extension when you have it.
export function parseAudioModSpec(patternSource, patternName = '') {
  if (typeof patternSource !== 'string') {
    throw new Error('parseAudioModSpec: patternSource must be a string');
  }
  const lines = patternSource.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(BLOCK_HEADER)) { start = i; break; }
  }
  if (start === -1) return null;

  const mappings = [];
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
        'parseAudioModSpec: malformed AUDIO_MODULATION_V1 mapping line: "' + trimmed + '"');
    }
    const [, slider, signal, minS, maxS, curveTok, noteRaw] = m;
    if (!VALID_SIGNALS.has(signal)) {
      throw new Error('parseAudioModSpec: unknown signal "' + signal +
        '" in line: "' + trimmed + '" (valid: ' + [...VALID_SIGNALS].join(', ') + ')');
    }
    const curve = CURVE_TOKENS[curveTok];
    if (!curve) {
      throw new Error('parseAudioModSpec: unknown curve token "' + curveTok +
        '" in line: "' + trimmed + '" (valid: linear, pow2, ease)');
    }
    const min = parseFloat(minS);
    const max = parseFloat(maxS);
    if (!isFinite(min) || !isFinite(max)) {
      throw new Error('parseAudioModSpec: non-numeric range in line: "' + trimmed + '"');
    }
    const note = (noteRaw || '').trim();
    mappings.push({ slider, signal, min, max, curve, note });
  }

  if (!mappings.length) {
    throw new Error('parseAudioModSpec: AUDIO_MODULATION_V1 block present but no valid mapping lines parsed');
  }

  const modString = mappings
    .map((mp) => [mp.signal, mp.slider, fmt(mp.min), fmt(mp.max), mp.curve].join(':'))
    .join(',');
  const synth = pickSynth(mappings, patternName);

  // Strip the internal `note` field from the public mappings (the contract is
  // { slider, signal, min, max, curve }); keep it only for the synth heuristic.
  const publicMappings = mappings.map(({ slider, signal, min, max, curve }) =>
    ({ slider, signal, min, max, curve }));

  return { mappings: publicMappings, modString, synth };
}
