// audio_mod_spec.test.mjs — the gate on the AUDIO_MODULATION_V1 header block.
//
// The block is the CANONICAL source of a pattern's audio-binding suggestions
// (report 20260806_184). `tools/audio_mod_spec.mjs` is the ONE parser of it —
// the offline gallery/harness tooling AND the engine's /mixer + /deck
// serializers both go through it. This file is what makes that safe:
//
//   - it parses EVERY pattern in the repo, so a malformed block can never
//     reach the engine (where the parse failure is logged and swallowed so a
//     header typo can't darken the rig — the loud refusal lives HERE);
//   - it pins the block's signal enum to the authoritative registry
//     (audio/postproc/audio_signals.js), so the offline harness, the parser
//     and the Companion's curated outputs can never disagree about the family
//     — the disagreement that hid the missing FLUX publisher;
//   - it pins that parsing NEVER renames a parameter: the slider token in the
//     header IS the runtime export name, and every token must resolve to a
//     real `export function slider*` in the same file.
//
// Run:  cd marsin_engine && node --test tests/tools/audio_mod_spec.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseAudioModSpec, audioSuggestionsBySlider, VALID_SIGNALS, BLOCK_VERSION,
  MODULATION_CURVE_BY_BLOCK_CURVE,
} from '../../tools/audio_mod_spec.mjs';
import {
  processedSignalKeys, micSignalShortNames,
} from '../../audio/postproc/audio_signals.js';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');

/** Every top-level show pattern's { name, source }. Read-only. */
function allPatterns() {
  return fs.readdirSync(PATTERNS_DIR)
    .filter(f => f.endsWith('.js'))
    .filter(f => !f.startsWith('_'))
    .sort()
    .map(f => ({
      name: f.replace(/\.js$/, ''),
      source: fs.readFileSync(path.join(PATTERNS_DIR, f), 'utf8'),
    }));
}

/** The kind-1 slider export names a pattern source declares, in order. */
function sliderExportNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]*)\s*\(/g)].map(m => m[1]);
}

// ── #11 · single-registry parity ────────────────────────────────────────────

test('VALID_SIGNALS is DERIVED from the authoritative registry, not hand-listed', () => {
  assert.deepEqual([...VALID_SIGNALS], processedSignalKeys());
  // The same derivation the offline harness's SIG_FIELD uses.
  assert.deepEqual([...VALID_SIGNALS], Object.keys(micSignalShortNames()));
  // The set the feature is specified against — micFlux included.
  assert.deepEqual(
    [...VALID_SIGNALS].slice().sort(),
    ['micFlux', 'micHigh', 'micKick', 'micLow', 'micMid'],
  );
});

test('the offline harness derives its synth-field map from the same call', async () => {
  // pattern_audio_harness.mjs is a CLI (it parses argv + loads a model at
  // import time), so we assert the SHARED derivation rather than importing it:
  // the harness's SIG_FIELD is literally `micSignalShortNames()`.
  const harness = fs.readFileSync(path.join(ENGINE_DIR, 'tools/pattern_audio_harness.mjs'), 'utf8');
  assert.match(harness, /const SIG_FIELD = micSignalShortNames\(\);/,
    'pattern_audio_harness.mjs must derive SIG_FIELD from micSignalShortNames(), not hand-list it');
  assert.deepEqual(micSignalShortNames(), {
    micLow: 'low', micMid: 'mid', micHigh: 'high', micKick: 'kick', micFlux: 'flux',
  });
});

// ── #1 · metadata parses and round-trips WITHOUT changing names ─────────────

test('a block parses to { version, mappings, modString, synth } and surfaces the note', () => {
  const src = [
    '/*', '  Doc prose.', '',
    'AUDIO_MODULATION_V1:',
    '  sliderLevel      <- micLow  range 0.30..1.00 curve linear # PRIMARY brightness',
    '  sliderStarCount  <- micFlux range 0.12..0.86 curve ease   # build reveals more stars',
    '  sliderQuiet      <- micMid  range 0.00..0.50 curve pow2',
    '  # STATIC: everything else',
    '*/',
    'export var level = 0.5;',
  ].join('\n');
  const spec = parseAudioModSpec(src, 'fixture');
  assert.equal(spec.version, BLOCK_VERSION);
  assert.deepEqual(spec.mappings, [
    { slider: 'sliderLevel', signal: 'micLow', min: 0.30, max: 1.00, curve: 'linear', note: 'PRIMARY brightness' },
    { slider: 'sliderStarCount', signal: 'micFlux', min: 0.12, max: 0.86, curve: 'ease', note: 'build reveals more stars' },
    { slider: 'sliderQuiet', signal: 'micMid', min: 0.00, max: 0.50, curve: 'pow2', note: '' },
  ]);
  // The harness modString is unchanged by the note surfacing.
  assert.equal(spec.modString,
    'micLow:sliderLevel:0.30:1.00:linear,micFlux:sliderStarCount:0.12:0.86:ease,micMid:sliderQuiet:0.00:0.50:pow2');
});

test('audioSuggestionsBySlider keys by the RUNTIME parameter name and omits an absent note', () => {
  const src = [
    'AUDIO_MODULATION_V1:',
    '  sliderLevel     <- micLow  range 0.30..1.00 curve linear # total elegance budget',
    '  sliderStarCount <- micFlux range 0.12..0.86 curve ease',
    '*/',
  ].join('\n');
  const map = audioSuggestionsBySlider(parseAudioModSpec(src, 'fixture'));
  assert.deepEqual(Object.keys(map), ['sliderLevel', 'sliderStarCount']);
  assert.deepEqual(map.sliderLevel, {
    version: BLOCK_VERSION, signal: 'micLow', range: [0.30, 1.00], curve: 'linear',
    modulationCurve: 'linear', note: 'total elegance budget',
  });
  // ABSENT means absent — never an inferred / empty-string placeholder.
  assert.deepEqual(map.sliderStarCount, {
    version: BLOCK_VERSION, signal: 'micFlux', range: [0.12, 0.86], curve: 'ease',
    modulationCurve: 'easeOut',
  });
  assert.equal('note' in map.sliderStarCount, false);
});

test('the block curve vocabulary maps onto REAL modulation-engine curves', async () => {
  // The block speaks linear|pow2|ease; the engine speaks linear|easeIn|easeOut|exp.
  // Both name the same three functions, and the translation is published once
  // so no client keeps a private copy of it.
  const { MODULATION_VALID_CURVES } = await import('../../lib/modulation_engine.js');
  assert.deepEqual(MODULATION_CURVE_BY_BLOCK_CURVE,
    { linear: 'linear', pow2: 'easeIn', ease: 'easeOut' });
  for (const target of Object.values(MODULATION_CURVE_BY_BLOCK_CURVE)) {
    assert.ok(MODULATION_VALID_CURVES.includes(target),
      `"${target}" must be a curve validateModulationMapping accepts`);
  }
  // Every curve token the parser accepts must have a translation.
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'tools/audio_mod_spec.mjs'), 'utf8');
  const tokens = /const CURVE_TOKENS = \{([^}]*)\}/.exec(src)[1]
    .split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
  for (const tok of tokens) {
    assert.ok(MODULATION_CURVE_BY_BLOCK_CURVE[tok], `block curve "${tok}" has no engine equivalent`);
  }
});

// ── #9 · a pattern WITHOUT metadata is untouched ────────────────────────────

test('no block => null => no suggestions (never inferred)', () => {
  assert.equal(parseAudioModSpec('export var level = 0.5;\n', 'plain'), null);
  assert.deepEqual(audioSuggestionsBySlider(null), {});
});

// ── #2 · invalid metadata fails LOUDLY, naming the pattern ──────────────────

test('an unknown signal is refused by name, quoting the bad token and the valid list', () => {
  const src = 'AUDIO_MODULATION_V1:\n  sliderLevel <- micBogus range 0..1 curve linear\n*/';
  assert.throws(() => parseAudioModSpec(src, '99_broken'), (err) => {
    assert.match(err.message, /\[99_broken\]/, 'names the pattern');
    assert.match(err.message, /micBogus/, 'quotes the bad token');
    for (const key of VALID_SIGNALS) assert.ok(err.message.includes(key), `lists ${key}`);
    return true;
  });
});

test('an unknown curve is refused by name with the valid list', () => {
  const src = 'AUDIO_MODULATION_V1:\n  sliderLevel <- micLow range 0..1 curve wobble\n*/';
  assert.throws(() => parseAudioModSpec(src, '99_broken'),
    /\[99_broken\].*unknown curve token "wobble".*linear, pow2, ease/s);
});

test('a malformed mapping line is refused, never silently dropped', () => {
  const src = 'AUDIO_MODULATION_V1:\n  sliderLevel <- micLow 0.3 to 1.0\n*/';
  assert.throws(() => parseAudioModSpec(src, '99_broken'),
    /\[99_broken\].*malformed AUDIO_MODULATION_V1 mapping line/s);
});

test('a block with no parseable mapping is refused (an empty suggestion set is a bug)', () => {
  const src = 'AUDIO_MODULATION_V1:\n  # STATIC: everything\n*/';
  assert.throws(() => parseAudioModSpec(src, '99_broken'), /no valid mapping lines parsed/);
});

test('two mappings on ONE slider are refused (the engine allows one per target)', () => {
  const src = [
    'AUDIO_MODULATION_V1:',
    '  sliderLevel <- micLow  range 0.0..1.0 curve linear',
    '  sliderLevel <- micHigh range 0.0..1.0 curve linear',
    '*/',
  ].join('\n');
  assert.throws(() => parseAudioModSpec(src, '99_broken'),
    /duplicate mapping for slider "sliderLevel"/);
});

test('audioSuggestionsBySlider refuses a spec from a different block version', () => {
  assert.throws(
    () => audioSuggestionsBySlider({ version: 'AUDIO_MODULATION_V2', mappings: [] }),
    /unsupported block version "AUDIO_MODULATION_V2"/);
});

// ── repo-wide gate: every pattern's block is valid and names REAL params ────

test('EVERY pattern in patterns/ has a parseable block (or none at all)', () => {
  const failures = [];
  for (const p of allPatterns()) {
    try {
      parseAudioModSpec(p.source, p.name);
    } catch (err) {
      failures.push(`${p.name}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, [], `malformed AUDIO_MODULATION_V1 block(s):\n${failures.join('\n')}`);
});

test('EVERY header slider token resolves to a declared slider export in the same pattern', () => {
  // This is the rename guard. The block's `slider<Name>` token IS the WASM
  // export name and IS `ModulationMapping.target.parameter`; a header that
  // drifts from the code would offer the operator a suggestion for a parameter
  // that does not exist.
  const failures = [];
  let checked = 0;
  for (const p of allPatterns()) {
    const spec = parseAudioModSpec(p.source, p.name);
    if (spec === null) continue;
    const declared = new Set(sliderExportNames(p.source));
    for (const m of spec.mappings) {
      checked++;
      if (!declared.has(m.slider)) {
        failures.push(`${p.name}: header names "${m.slider}", which is not an ` +
          `export function in that file (declared: ${[...declared].join(', ')})`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(checked > 100, `expected the repo to carry many mappings, saw ${checked}`);
});

test('EVERY declared signal across the repo is a live registry signal', () => {
  const seen = new Set();
  for (const p of allPatterns()) {
    const spec = parseAudioModSpec(p.source, p.name);
    if (spec === null) continue;
    for (const m of spec.mappings) seen.add(m.signal);
  }
  for (const sig of seen) {
    assert.ok(VALID_SIGNALS.has(sig), `pattern headers declare "${sig}", not in the registry`);
  }
  // micFlux is declared by a large share of the show — the reason its missing
  // publisher mattered so much (report 20260806_184 Part B).
  assert.ok(seen.has('micFlux'), 'the show declares micFlux; keep it in the family');
});

// ── the present-at-zero footgun this feature exists downstream of ───────────

test('a signal that is PRESENT AT ZERO still drives override mode to range[0]', async () => {
  // The FLUX regression class, pinned as behaviour rather than prose: a source
  // key that is ABSENT from the CPC frame makes applyModulations SKIP the
  // mapping (the slider keeps the operator's value), but a key PRESENT at 0 is
  // applied every frame — and in `override` mode that PINS the target at the
  // low end of the declared range. A silent publisher is therefore strictly
  // worse than a missing one, which is why missingCuratedOutputs() shouts.
  const { applyModulations } = await import('../../lib/modulation_engine.js');
  const mapping = {
    id: 'mod_sliderStarCount_micFlux', type: 'continuous', enabled: true,
    source: { scope: 'cpc', key: 'micFlux' },
    target: { scope: 'pattern', parameter: 'sliderStarCount' },
    mode: 'override', polarity: 'unipolar', range: [0.12, 0.86], curve: 'ease',
  };
  const args = (sourceValues) => ({
    baseParams: { sliderStarCount: 0.5 },
    targetDefs: [{ name: 'sliderStarCount', kind: 1, id: 3 }],
    modulations: [mapping],
    sourceValues,
  });

  // ABSENT source -> untouched (the operator's slider still rules).
  const absent = applyModulations(args({})).values.sliderStarCount;
  assert.equal(absent.modulated, 0.5);
  assert.equal(absent.source, undefined);

  // PRESENT at 0 -> pinned at range[0], operator's 0.5 ignored. THIS is the
  // failure the operator saw as "FLUX does nothing / my slider is stuck".
  const pinned = applyModulations(args({ micFlux: 0 })).values.sliderStarCount;
  assert.equal(pinned.modulated, 0.12);
  assert.equal(pinned.source, 'micFlux');

  // Publishing a real value restores the intended sweep.
  const driven = applyModulations(args({ micFlux: 1 })).values.sliderStarCount;
  assert.equal(driven.modulated, 0.86);
});
