/*
 * timeline_assertions.test.js — tools/timeline_assertions.mjs (docs/77 §9,
 * §11 G2). Unit-tests each of the 8 assertion classes against the synthetic
 * fixtures under tests/fixtures/timeline/ (assert_clean.yaml — passes every
 * class; assert_violations_*.yaml — each deliberately trips specific
 * findings), `parseAssertSpec`'s strictness, and one CLI-level smoke test
 * driving the real `tools/timeline_dryrun.mjs --assert` end to end.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/timeline_assertions.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadShowPlan } from '../../lib/timeline/show_plan.js';
import {
  parseAssertSpec, runAssertions, renderAssertionReport,
  assertContiguity, assertMasterAuthorship, assertEligibilityWindow,
  assertShufflePinning, assertEventResume, assertSolarDrift, assertLintClean,
  assertRestartResume,
} from '../../tools/timeline_assertions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const FIXTURES_DIR = path.join(ENGINE_DIR, 'tests', 'fixtures', 'timeline');
const DRYRUN_TOOL = path.join(ENGINE_DIR, 'tools', 'timeline_dryrun.mjs');

function fixturePlan(name) {
  return loadShowPlan(path.join(FIXTURES_DIR, `${name}.yaml`));
}

function fixtureSpec(name) {
  const specPath = path.join(FIXTURES_DIR, `${name}_spec.yaml`);
  return parseAssertSpec(yaml.load(fs.readFileSync(specPath, 'utf8')), specPath);
}

// ── parseAssertSpec strictness (codex P0 — unknown keys throw) ──────────────

test('parseAssertSpec rejects an unknown top-level key', () => {
  assert.throws(() => parseAssertSpec({ notAKey: 1 }, 'x'), /unknown key "notAKey"/);
});

test('parseAssertSpec rejects an empty/non-mapping document', () => {
  assert.throws(() => parseAssertSpec(null, 'x'), /file is empty/);
  assert.throws(() => parseAssertSpec([1, 2], 'x'), /must be a YAML mapping/);
});

test('parseAssertSpec defaults every optional field', () => {
  const spec = parseAssertSpec({}, 'x');
  assert.deepEqual(spec.masterWriters, []);
  assert.deepEqual(spec.directedCues, []);
  assert.equal(spec.eventCues, null);
  assert.deepEqual(spec.restartProbes, ['02:00', '07:30']);
  assert.equal(spec.nightStart, undefined);
  assert.equal(spec.solarSweep, undefined);
});

test('parseAssertSpec validates nightStart/nightEnd anchors', () => {
  assert.throws(() => parseAssertSpec({ nightStart: { clock: '9pm' } }, 'x'), /clock must be a 24h/);
  assert.throws(() => parseAssertSpec({ nightStart: { sun: 'nope' } }, 'x'), /sun must be one of/);
  assert.throws(() => parseAssertSpec({ nightStart: { clock: '21:00', sun: 'sunset' } }, 'x'), /exactly one of/);
  const spec = parseAssertSpec({ nightEnd: { sun: 'sunrise', offsetMin: -120 } }, 'x');
  assert.deepEqual(spec.nightEnd, { sun: 'sunrise', offsetMin: -120 });
});

test('parseAssertSpec validates solarSweep, eligibility, expectedOrder, restartProbes/Expect', () => {
  assert.throws(() => parseAssertSpec({ solarSweep: { days: 0 } }, 'x'), /days must be an integer/);
  assert.throws(() => parseAssertSpec({ solarSweep: { bogus: 1 } }, 'x'), /unknown key "bogus"/);
  assert.throws(() => parseAssertSpec({ eligibility: { start: { clock: '21:00' } } }, 'x'), /both anchors required/);
  assert.throws(() => parseAssertSpec({ expectedOrder: [1] }, 'x'), /must be a non-empty string/);
  assert.throws(() => parseAssertSpec({ restartProbes: [] }, 'x'), /non-empty array/);
  assert.throws(() => parseAssertSpec({ restartProbes: ['9pm'] }, 'x'), /must be "HH:MM"/);
  assert.throws(() => parseAssertSpec({ restartExpect: { '9pm': 'c_x' } }, 'x'), /key "9pm" must be "HH:MM"/);
  assert.throws(() => parseAssertSpec({ restartExpect: { '02:00': '' } }, 'x'), /non-empty string cue id/);

  const spec = parseAssertSpec({
    solarSweep: { startDate: '2026-08-20', days: 10 },
    eligibility: { start: { clock: '21:30' }, end: { sun: 'sunrise', offsetMin: -120 } },
    expectedOrder: ['a', 'b'],
    restartExpect: { '02:00': 'c_x' },
  }, 'x');
  assert.equal(spec.solarSweep.days, 10);
  assert.deepEqual(spec.expectedOrder, ['a', 'b']);
  assert.equal(spec.restartExpect['02:00'], 'c_x');
});

// ── the clean fixture passes every class, with every optional sub-check ─────

test('assert_clean.yaml passes all 8 classes against assert_clean_spec.yaml', () => {
  const plan = fixturePlan('assert_clean');
  const spec = fixtureSpec('assert_clean');
  const result = runAssertions({
    plan, spec, dayKeys: ['2026-08-25'], runDateKey: '2026-08-25',
  });
  const report = renderAssertionReport(result).join('\n');
  assert.equal(result.pass, true, report);
  assert.equal(result.totalViolations, 0, report);
  for (const key of Object.keys(result.classes)) {
    assert.equal(result.classes[key].status, 'PASS', `${key} was not PASS:\n${report}`);
  }
  // class 8 leaves an informational note even on a clean pass.
  assert.ok(result.classes.restartResume.notes.some((n) => n.includes('c_morning_watch')));
});

test('without --assert-spec, classes 2 and 4 SKIP loudly rather than pass silently', () => {
  const plan = fixturePlan('assert_clean');
  const result = runAssertions({
    plan, spec: null, dayKeys: ['2026-08-25'], runDateKey: '2026-08-25',
  });
  assert.equal(result.classes.masterAuthorship.status, 'SKIP');
  assert.match(result.classes.masterAuthorship.reason, /needs a masterWriters whitelist/);
  assert.equal(result.classes.shufflePinning.status, 'SKIP');
  assert.match(result.classes.shufflePinning.reason, /needs a directedCues whitelist/);
  // every other class still runs on its own defaults.
  assert.equal(result.classes.contiguity.status, 'PASS');
  assert.equal(result.classes.lint.status, 'PASS');
  assert.equal(result.classes.restartResume.status, 'PASS');
  // a SKIPped class never counts toward pass/fail.
  assert.equal(result.pass, true);
});

// ── class 1: full-night contiguity ──────────────────────────────────────────

test('class 1 flags the cross-midnight gap when the midnight-bridge cue is missing', () => {
  const plan = fixturePlan('assert_violations_contiguity_master');
  const violations = assertContiguity({ plan, dayKeys: ['2026-08-25'], spec: null });
  assert.ok(violations.some((v) => v.includes('[contiguity]') && v.includes('00:00') && v.includes('"c_sunrise_bloom"')));
});

test('class 1 reports zero gaps on the clean fixture', () => {
  const plan = fixturePlan('assert_clean');
  const violations = assertContiguity({ plan, dayKeys: ['2026-08-25'], spec: null });
  assert.deepEqual(violations, []);
});

// ── class 2: master-authorship ──────────────────────────────────────────────

test('class 2 flags an unwhitelisted writer, a stale whitelist entry, and a wrong masterZeroCue', () => {
  const plan = fixturePlan('assert_violations_contiguity_master');
  const spec = fixtureSpec('assert_violations_contiguity_master');
  const violations = assertMasterAuthorship({ plan, spec });
  assert.ok(violations.some((v) => v.includes('"c_ignition"') && v.includes('not in masterWriters whitelist')));
  assert.ok(violations.some((v) => v.includes('"c_nonexistent_cue"') && v.includes('stale whitelist entry')));
  assert.ok(violations.some((v) => v.includes('masterZeroCue "c_ignition"') && v.includes('does not author globals.master=0')));
  assert.ok(violations.some((v) => v.includes('"c_day_off"') && v.includes('also authors globals.master=0')));
});

test('class 2 passes clean with an exact whitelist and correct masterZeroCue', () => {
  const plan = fixturePlan('assert_clean');
  const spec = fixtureSpec('assert_clean');
  assert.deepEqual(assertMasterAuthorship({ plan, spec }), []);
});

// ── class 3: eligibility-window sanity ──────────────────────────────────────

test('class 3 flags a missing whenPhase, an empty phase window, and an eligibility mismatch', () => {
  const plan = fixturePlan('assert_violations_eligibility_shuffle');
  const spec = fixtureSpec('assert_violations_eligibility_shuffle');
  const violations = assertEligibilityWindow({ plan, dayKeys: ['2026-08-25'], spec });
  assert.ok(violations.some((v) => v.includes('"c_mood_no_gate"') && v.includes('party eligible 24h')));
  assert.ok(violations.some((v) => v.includes('"c_mood_bad_phase"') && v.includes('window is empty')));
  assert.ok(violations.some((v) => v.includes('"c_mood_real"') && v.includes('does not match spec eligibility')));
});

test('class 3 passes clean with a matching eligibility spec', () => {
  const plan = fixturePlan('assert_clean');
  const spec = fixtureSpec('assert_clean');
  assert.deepEqual(assertEligibilityWindow({ plan, dayKeys: ['2026-08-25'], spec }), []);
});

// ── class 4: shuffle-pinning ─────────────────────────────────────────────────

test('class 4 flags a directed cue with shuffle:true and a directedCues id that does not exist', () => {
  const plan = fixturePlan('assert_violations_eligibility_shuffle');
  const spec = fixtureSpec('assert_violations_eligibility_shuffle');
  const violations = assertShufflePinning({ plan, spec });
  assert.ok(violations.some((v) => v.includes('"c_shuffle_bad"') && v.includes('shuffle is not false')));
  assert.ok(violations.some((v) => v.includes('"c_missing_directed_cue"') && v.includes('no such cue exists')));
});

test('class 4 passes clean, including an explicit active:false freeze', () => {
  const plan = fixturePlan('assert_clean');
  const spec = fixtureSpec('assert_clean');
  assert.deepEqual(assertShufflePinning({ plan, spec }), []);
});

// ── class 5: event-resume coverage ──────────────────────────────────────────

test('class 5 flags a no-hold event cue resuming into the day_off dead zone', () => {
  const plan = fixturePlan('assert_violations_event_lint_restart');
  const spec = fixtureSpec('assert_violations_event_lint_restart');
  const violations = assertEventResume({ plan, dayKeys: ['2026-08-25'], spec });
  assert.ok(violations.some((v) => v.includes('[event-resume]') && v.includes('"c_event_no_hold"') && v.includes('no hold')));
});

test('class 5 passes clean (event resumes owned at all three representative fire times)', () => {
  const plan = fixturePlan('assert_clean');
  const violations = assertEventResume({ plan, dayKeys: ['2026-08-25'], spec: null });
  assert.deepEqual(violations, []);
});

// ── class 6: solar-drift sweep ──────────────────────────────────────────────

test('class 6 catches a genuine cue-order seam inversion across the sweep', () => {
  const plan = fixturePlan('assert_violations_solar');
  const spec = fixtureSpec('assert_violations_solar');
  const violations = assertSolarDrift({ plan, spec, runDateKey: '2026-08-20' });
  assert.ok(violations.some((v) => v.includes('cue order seam') && v.includes('"c_clock_1930"') && v.includes('"c_sunset_0"')));
  assert.ok(violations.some((v) => v.includes('expectedOrder mismatch')));
});

test('class 6 passes clean across its spec\'d sweep', () => {
  const plan = fixturePlan('assert_clean');
  const spec = fixtureSpec('assert_clean');
  assert.deepEqual(assertSolarDrift({ plan, spec, runDateKey: '2026-08-25' }), []);
});

// ── class 7: lint clean ──────────────────────────────────────────────────────

test('class 7 flags a program cue with no autopilot block', () => {
  const plan = fixturePlan('assert_violations_event_lint_restart');
  const violations = assertLintClean({ plan });
  assert.ok(violations.some((v) => v.includes('"c_no_autopilot_program"') && v.includes('FREEZE')));
});

test('class 7 passes clean', () => {
  const plan = fixturePlan('assert_clean');
  assert.deepEqual(assertLintClean({ plan }), []);
});

// ── class 8: restart/resume probes ──────────────────────────────────────────

test('class 8 flags an ownerless restart probe and a restartExpect mismatch', () => {
  const plan = fixturePlan('assert_violations_event_lint_restart');
  const spec = fixtureSpec('assert_violations_event_lint_restart');
  const { violations } = assertRestartResume({ plan, dayKeys: ['2026-08-25'], spec });
  assert.ok(violations.some((v) => v.includes('restart probe 00:30') && v.includes('resumes ownerless')));
  assert.ok(violations.some((v) => v.includes('restart probe 07:30') && v.includes('expected "c_totally_wrong_cue"')));
});

test('class 8 passes clean and names the resolved cue in a PASS note', () => {
  const plan = fixturePlan('assert_clean');
  const spec = fixtureSpec('assert_clean');
  const { violations, notes } = assertRestartResume({ plan, dayKeys: ['2026-08-25'], spec });
  assert.deepEqual(violations, []);
  assert.ok(notes.some((n) => n.includes('02:00') && n.includes('c_midnight_refresh')));
  assert.ok(notes.some((n) => n.includes('07:30') && n.includes('c_morning_watch')));
});

// ── CLI-level smoke: the real tool, spawned, exit codes + output ────────────

function runDryRunCli(args) {
  return spawnSync(process.execPath, [DRYRUN_TOOL, ...args], {
    cwd: ENGINE_DIR,
    encoding: 'utf8',
  });
}

test('CLI: --assert on a violating fixture exits 1 and prints ASSERT RESULT: FAIL', () => {
  const specPath = path.join(FIXTURES_DIR, 'assert_violations_contiguity_master_spec.yaml');
  const planPath = path.join(FIXTURES_DIR, 'assert_violations_contiguity_master.yaml');
  const res = runDryRunCli([
    '--plan', planPath, '--date', '2026-08-25', '--step', '60', '--events-only',
    '--assert', '--assert-spec', specPath,
  ]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /ASSERT RESULT: FAIL \(\d+ violations?\)/);
  assert.match(res.stdout, /\[contiguity\]/);
});

test('CLI: --assert on the clean fixture exits 0 and prints ASSERT RESULT: PASS', () => {
  const specPath = path.join(FIXTURES_DIR, 'assert_clean_spec.yaml');
  const planPath = path.join(FIXTURES_DIR, 'assert_clean.yaml');
  const res = runDryRunCli([
    '--plan', planPath, '--date', '2026-08-25', '--step', '60', '--events-only',
    '--assert', '--assert-spec', specPath,
  ]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ASSERT RESULT: PASS \(0 violations\)/);
});

test('CLI: --assert with no --assert-spec SKIPs classes 2 and 4 loudly', () => {
  const planPath = path.join(FIXTURES_DIR, 'assert_clean.yaml');
  const res = runDryRunCli([
    '--plan', planPath, '--date', '2026-08-25', '--step', '60', '--events-only', '--assert',
  ]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /2 master-authorship\s+SKIP/);
  assert.match(res.stdout, /4 shuffle-pinning\s+SKIP/);
});

test('CLI: --assert-spec without --assert is a usage error (exit 2)', () => {
  const specPath = path.join(FIXTURES_DIR, 'assert_clean_spec.yaml');
  const res = runDryRunCli(['--assert-spec', specPath]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--assert-spec requires --assert/);
});
