/**
 * Tests for the LED-fixture generator catalog (src/fixtures/led_generator_catalog.js).
 *
 * The catalog is the SEAM: gui_builder iterates LED_GENERATORS to render one
 * "add" button per entry, and dispatches its generic click handler on each
 * entry's `target`. This suite pins:
 *   - the catalog shape + the single TE Sign entry's declared contract,
 *   - runLedGenerator building the A+B pair via buildTeSign (A≡B, shared group),
 *   - the output-contract guard (non-empty array, one shared group),
 *   - uniqueGroupName edge cases: fresh base, suffixing, collisions with
 *     existing groups AND trace groupNames (the config.js re-stamp hazard), and
 *     the reserved 'Ungrouped' bucket.
 *
 * Pure module — plain objects only, no DOM/THREE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LED_GENERATORS,
  LED_GENERATOR_TARGETS,
  RESERVED_GROUP_NAME,
  getLedGenerator,
  runLedGenerator,
  assertGeneratorFixtures,
  uniqueGroupName,
} from '../src/fixtures/led_generator_catalog.js';
import {
  TE_SIGN_TYPE_A,
  TE_SIGN_TYPE_B,
} from '../src/fixtures/te_sign_generator.js';

const TRANSFORM_KEYS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'];

function transformOf(cfg) {
  const t = {};
  for (const k of TRANSFORM_KEYS) t[k] = cfg[k];
  return t;
}

// ── Catalog shape ─────────────────────────────────────────────────────────

test('LED_GENERATORS: exactly one entry (TE Sign) with the declared contract', () => {
  assert.equal(LED_GENERATORS.length, 1);
  const [entry] = LED_GENERATORS;
  assert.equal(entry.id, 'te_sign');
  assert.equal(entry.label, '✨ + TE Sign (A+B)');
  assert.equal(entry.target, 'parLights');
  assert.equal(entry.defaultGroup, 'TE Sign');
  assert.equal(entry.bornLocked, true);
  assert.equal(typeof entry.build, 'function');
});

test('LED_GENERATORS: every entry targets a valid params array', () => {
  for (const entry of LED_GENERATORS) {
    assert.ok(LED_GENERATOR_TARGETS.includes(entry.target),
      `entry '${entry.id}' target '${entry.target}' must be a valid target`);
  }
});

test('LED_GENERATORS: catalog + entries are frozen (immutable seam)', () => {
  assert.ok(Object.isFrozen(LED_GENERATORS));
  assert.ok(Object.isFrozen(LED_GENERATORS[0]));
});

test('LED_GENERATORS: ids are unique', () => {
  const ids = LED_GENERATORS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ── getLedGenerator ─────────────────────────────────────────────────────────

test('getLedGenerator: returns the entry by id', () => {
  assert.equal(getLedGenerator('te_sign').id, 'te_sign');
});

test('getLedGenerator: unknown id throws (no silent null)', () => {
  assert.throws(() => getLedGenerator('nope'), /unknown generator id/);
  assert.throws(() => getLedGenerator(''), /unknown generator id/);
});

// ── runLedGenerator: te_sign builds the A+B pair via buildTeSign ────────────

test('runLedGenerator(te_sign): builds the A+B pair, A≡B transform, shared group', () => {
  const entry = getLedGenerator('te_sign');
  const fixtures = runLedGenerator(entry, { group: 'TE Sign' });
  assert.equal(fixtures.length, 2);
  const [a, b] = fixtures;
  assert.equal(a.fixtureType, TE_SIGN_TYPE_A);
  assert.equal(b.fixtureType, TE_SIGN_TYPE_B);
  // Both halves in the one requested group.
  assert.equal(a.group, 'TE Sign');
  assert.equal(b.group, 'TE Sign');
  // The load-bearing invariant: identical transforms.
  assert.deepEqual(transformOf(a), transformOf(b));
});

test('runLedGenerator(te_sign): honors a suffixed group name', () => {
  const entry = getLedGenerator('te_sign');
  const fixtures = runLedGenerator(entry, { group: 'TE Sign 2' });
  assert.equal(fixtures[0].group, 'TE Sign 2');
  assert.equal(fixtures[1].group, 'TE Sign 2');
});

test('runLedGenerator: propagates build validation failures (fail loud)', () => {
  const entry = getLedGenerator('te_sign');
  // buildTeSign rejects non-finite placement — must surface, not be swallowed.
  assert.throws(() => runLedGenerator(entry, { group: 'TE Sign', x: 'nope' }),
    /must be a finite number/);
});

test('runLedGenerator: a malformed entry throws', () => {
  assert.throws(() => runLedGenerator({ id: 'x', label: 'x', target: 'bogus' }),
    /unknown target/);
});

// ── assertGeneratorFixtures: output contract guard ──────────────────────────

test('assertGeneratorFixtures: accepts a non-empty single-group array', () => {
  const fixtures = [{ group: 'G' }, { group: 'G' }];
  assert.equal(assertGeneratorFixtures(fixtures, { id: 't' }), fixtures);
});

test('assertGeneratorFixtures: rejects empty / non-array', () => {
  assert.throws(() => assertGeneratorFixtures([], { id: 't' }), /non-empty array/);
  assert.throws(() => assertGeneratorFixtures('x', { id: 't' }), /non-empty array/);
});

test('assertGeneratorFixtures: rejects a split group', () => {
  assert.throws(() => assertGeneratorFixtures([{ group: 'A' }, { group: 'B' }], { id: 't' }),
    /must share ONE group/);
});

test('assertGeneratorFixtures: rejects a missing / empty group', () => {
  assert.throws(() => assertGeneratorFixtures([{ group: '' }], { id: 't' }), /non-empty group/);
  assert.throws(() => assertGeneratorFixtures([{}], { id: 't' }), /non-empty group/);
});

// ── uniqueGroupName ─────────────────────────────────────────────────────────

test('uniqueGroupName: fresh base returns the base unchanged', () => {
  assert.equal(uniqueGroupName([], 'TE Sign'), 'TE Sign');
  assert.equal(uniqueGroupName(['Other', 'Left Wall'], 'TE Sign'), 'TE Sign');
});

test('uniqueGroupName: first collision suffixes with " 2"', () => {
  assert.equal(uniqueGroupName(['TE Sign'], 'TE Sign'), 'TE Sign 2');
});

test('uniqueGroupName: walks up past existing suffixes', () => {
  assert.equal(uniqueGroupName(['TE Sign', 'TE Sign 2'], 'TE Sign'), 'TE Sign 3');
  assert.equal(uniqueGroupName(['TE Sign', 'TE Sign 2', 'TE Sign 3'], 'TE Sign'), 'TE Sign 4');
});

test('uniqueGroupName: fills the first gap in the suffix sequence', () => {
  // 'TE Sign 2' free even though 'TE Sign 3' is taken.
  assert.equal(uniqueGroupName(['TE Sign', 'TE Sign 3'], 'TE Sign'), 'TE Sign 2');
});

test('uniqueGroupName: dodges trace groupNames in the union set', () => {
  // Caller passes the UNION of target group names + params.traces[*].groupName.
  const union = new Set(['TE Sign', 'Bow Circle']); // 'Bow Circle' is a trace group
  assert.equal(uniqueGroupName(union, 'Bow Circle'), 'Bow Circle 2');
  assert.equal(uniqueGroupName(union, 'TE Sign'), 'TE Sign 2');
});

test('uniqueGroupName: accepts a Set as well as an array', () => {
  assert.equal(uniqueGroupName(new Set(['TE Sign']), 'TE Sign'), 'TE Sign 2');
});

test('uniqueGroupName: never yields the reserved "Ungrouped" bucket name', () => {
  // Reserved intrinsically even when the caller does not list it.
  assert.equal(RESERVED_GROUP_NAME, 'Ungrouped');
  assert.equal(uniqueGroupName([], 'Ungrouped'), 'Ungrouped 2');
  assert.equal(uniqueGroupName(['Ungrouped 2'], 'Ungrouped'), 'Ungrouped 3');
});

test('uniqueGroupName: trims the base name', () => {
  assert.equal(uniqueGroupName([], '  TE Sign  '), 'TE Sign');
});

test('uniqueGroupName: fail-loud on invalid inputs', () => {
  assert.throws(() => uniqueGroupName([], ''), /must be a non-empty string/);
  assert.throws(() => uniqueGroupName([], '   '), /must be a non-empty string/);
  assert.throws(() => uniqueGroupName([], 42), /must be a non-empty string/);
  assert.throws(() => uniqueGroupName('nope', 'TE Sign'), /must be an array or Set/);
  assert.throws(() => uniqueGroupName(null, 'TE Sign'), /must be an array or Set/);
});
