// PARITY GATE — the note-tracking evidence is published in TWO places and they
// must never drift apart.
//
//   1. docs/AUDIO_SIGNALS.md            — the operator/designer prose
//   2. marsin_engine/config.yaml        — the `derivedSignals.noteTracking`
//                                         comment block, right next to the
//                                         knobs the figures describe
//
// Twice now the second surface has been retuned or re-measured while the first
// kept quoting the old envelope, which is worse than no documentation: a
// programmer reads "99.17% root-change recall" and designs a pattern around a
// number nothing defends. There is no single machine-readable home for these
// figures (they are prose in one file and YAML comments in the other), so this
// test makes the DUPLICATION safe instead: it parses both surfaces and refuses
// to pass unless every figure matches, naming both file paths when it fails.
//
// It also checks the published moderate-tier figures actually CLEAR the floors
// the checked-in gate asserts (parsed out of note_estimator_noisy.test.mjs), so
// the docs can never advertise a number the gate would not catch losing.
//
// This test does NOT re-run the corpus — that is
// tests/audio/note_estimator_noisy.test.mjs, which owns the measurement and is
// hermetic (tracked config.yaml only, no scene-state overlay). This file only
// guarantees the two published copies say the same thing.
//
// ── HOW TO CHANGE A FIGURE ──────────────────────────────────────────────────
//   1. run   node --test tests/audio/note_estimator_noisy.test.mjs
//   2. read  the `[note-noise] joined-house-roots` line it prints
//   3. edit  BOTH surfaces to the new numbers, keeping the label wording below
//   4. update EXPECTED_FIGURES here — it is the third witness, so a typo in a
//      surface cannot be "fixed" by copying the same typo into the other.

import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');

const CONFIG_PATH = path.join(ENGINE_DIR, 'config.yaml');
const DOCS_PATH = path.join(REPO_ROOT, 'docs', 'AUDIO_SIGNALS.md');
const HOLDOUT_TEST_PATH = path.join(__dirname, 'note_estimator_noisy.test.mjs');

/**
 * The published figures, as `<value><unit> <label>` phrases that must appear
 * VERBATIM (modulo markdown bold and YAML comment markers) in both surfaces.
 *
 * No label may be a substring of another — the parser demands exactly one hit
 * per label per file, so an overlapping label would report a phantom conflict.
 * The `heavy-tier …` labels are worded to stay disjoint from the moderate ones
 * for that reason.
 */
const EXPECTED_FIGURES = Object.freeze([
  { label: 'mean settled-window accuracy', unit: '%', value: 93.43, tier: 'moderate' },
  { label: 'mean full-segment accuracy', unit: '%', value: 51.09, tier: 'moderate' },
  { label: 'mean expected root-change recall', unit: '%', value: 99.17, tier: 'moderate' },
  { label: 'clean committed sequences', unit: ' of 24', value: 18, tier: 'moderate' },
  { label: 'typical change latency', unit: ' ms', value: 451, tier: 'moderate' },
  { label: 'p90 run-level p95 latency', unit: ' ms', value: 853.6, tier: 'moderate' },
  { label: 'worst run-level p95 latency', unit: ' ms', value: 934.8, tier: 'moderate' },
  { label: 'heavy-tier settled accuracy', unit: '%', value: 11.22, tier: 'heavy' },
  { label: 'heavy-tier full-segment score', unit: '%', value: 9.81, tier: 'heavy' },
  { label: 'heavy-tier root-change recall', unit: '%', value: 13.33, tier: 'heavy' },
]);

/**
 * Flatten a surface to one whitespace-normalised line so a figure that wraps
 * across two comment lines or two prose lines still reads as one phrase.
 * Markdown emphasis and YAML/markdown comment markers are stripped; nothing
 * else is touched, so the numbers themselves are untouched.
 */
function flattenSurface(text) {
  return text
    .replace(/\*\*/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[#>]+\s?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ');
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every value published against `label` in `flattened`. Returns an array so the
 * caller can distinguish "missing" from "said twice, differently".
 */
function findFigures(flattened, { label, unit }) {
  const pattern = new RegExp(
    `(\\d+(?:\\.\\d+)?)${escapeForRegex(unit)}\\s+${escapeForRegex(label)}`,
    'g',
  );
  return [...flattened.matchAll(pattern)].map((match) => Number(match[1]));
}

/** Parse one numeric field out of the holdout gate's HOLDOUT_POLICY literal. */
function holdoutPolicyValue(source, field) {
  const match = new RegExp(`${escapeForRegex(field)}:\\s*(\\d+(?:\\.\\d+)?)`).exec(source);
  assert.ok(match, `HOLDOUT_POLICY.${field} not found in ${HOLDOUT_TEST_PATH}`
    + ' — the parity gate can no longer prove the published figures clear the floors');
  return Number(match[1]);
}

const CONFIG_TEXT = fs.readFileSync(CONFIG_PATH, 'utf8');
const DOCS_TEXT = fs.readFileSync(DOCS_PATH, 'utf8');
const SURFACES = Object.freeze([
  { path: CONFIG_PATH, flattened: flattenSurface(CONFIG_TEXT) },
  { path: DOCS_PATH, flattened: flattenSurface(DOCS_TEXT) },
]);

test('every note-evidence figure is published exactly once per surface', () => {
  for (const figure of EXPECTED_FIGURES) {
    for (const surface of SURFACES) {
      const found = findFigures(surface.flattened, figure);
      assert.equal(found.length, 1,
        `"${figure.label}" must appear exactly once in ${surface.path}, found ${found.length}`
        + ` (${JSON.stringify(found)}). Expected the phrase`
        + ` "${figure.value}${figure.unit} ${figure.label}".`);
    }
  }
});

test('config.yaml and docs/AUDIO_SIGNALS.md publish identical note-evidence figures', () => {
  const drifted = [];
  for (const figure of EXPECTED_FIGURES) {
    const [config] = findFigures(SURFACES[0].flattened, figure);
    const [docs] = findFigures(SURFACES[1].flattened, figure);
    if (config !== docs) {
      drifted.push(`  ${figure.label}: config.yaml says ${config}${figure.unit},`
        + ` AUDIO_SIGNALS.md says ${docs}${figure.unit}`);
    }
  }
  assert.equal(drifted.length, 0,
    'note-tracking evidence has DRIFTED between its two published surfaces:\n'
    + `${drifted.join('\n')}\n`
    + `  fix BOTH: ${CONFIG_PATH}\n`
    + `        and ${DOCS_PATH}\n`
    + '  re-measure with tests/audio/note_estimator_noisy.test.mjs first.');
});

test('the published figures match the values this repo last measured', () => {
  // The third witness. Without it, "make them agree" could be satisfied by
  // pasting the same wrong number into both files.
  const wrong = [];
  for (const figure of EXPECTED_FIGURES) {
    for (const surface of SURFACES) {
      const [found] = findFigures(surface.flattened, figure);
      if (found !== figure.value) {
        wrong.push(`  ${surface.path}: ${figure.label} = ${found}, expected ${figure.value}`);
      }
    }
  }
  assert.equal(wrong.length, 0,
    'published note evidence does not match EXPECTED_FIGURES in this test:\n'
    + `${wrong.join('\n')}\n`
    + '  if the tracker was legitimately re-measured, update all three.');
});

test('the published moderate-tier figures clear the floors the holdout gate asserts', () => {
  const source = fs.readFileSync(HOLDOUT_TEST_PATH, 'utf8');
  const published = new Map(EXPECTED_FIGURES.map((figure) => [figure.label, figure.value]));
  const checks = [
    ['mean settled-window accuracy', 'meanSteadyAccuracyPct', 1],
    ['mean full-segment accuracy', 'meanFullChordAccuracyPct', 1],
    ['mean expected root-change recall', 'meanTransitionRecallPct', 1],
    // cleanSequenceFraction is a fraction of the 24-seed holdout, not a percent.
    ['clean committed sequences', 'cleanSequenceFraction', 24],
  ];
  for (const [label, field, scale] of checks) {
    const floor = holdoutPolicyValue(source, field) * scale;
    const value = published.get(label);
    assert.ok(value >= floor,
      `docs/config publish ${value} for "${label}" but the gate's floor`
      + ` (HOLDOUT_POLICY.${field}) is ${floor} — the published figure is one the`
      + ' gate would not defend. Re-measure, or fix the floor.');
  }
});

test('the heavy tier stays labelled report-only on both surfaces', () => {
  // Heavy-tier evidence is reproducible but NOT gated. It must never read as a
  // supported envelope, and it must never be promoted into a threshold.
  for (const surface of SURFACES) {
    assert.match(surface.flattened, /report[- ]only/i,
      `${surface.path} publishes heavy-tier note figures without marking them report-only`);
  }
});
