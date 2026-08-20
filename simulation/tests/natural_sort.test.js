/**
 * natural_sort.test.js — the ONE numeric-aware name comparator
 * (src/core/natural_sort.js) that every name-sorted list in the sim UI uses.
 *
 *  G1 — the numeric trap is pinned: "… 2" sorts before "… 10", for the exact
 *       `"<group> <n>"` shape every generated fixture carries. This is the
 *       defect that already bit the pixel-map lanes view (report
 *       20260725_44 §2, D1) and would have bitten the mapping tray next.
 *  G2 — it is a TOTAL order and null-safe, so sorts stay deterministic and one
 *       malformed name never takes a panel down.
 *  G3 — it is genuinely SHARED (operator constraint: "make sure it's fast",
 *       and one comparator so two "sorted by name" lists cannot disagree):
 *       one cached Intl.Collator, and both consumers import it rather than
 *       rolling a second copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareNatural, sortNamesNatural, sortByNameNatural } from '../src/core/natural_sort.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');
/** Source with comments stripped — these assertions are about CODE, not prose. */
const code = (...p) => read(...p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── G1: the numeric trap ─────────────────────────────────────────────────

test('a 2 sorts before a 10 within the same group (the whole point)', () => {
  assert.ok(compareNatural('Left Back Wall 2', 'Left Back Wall 10') < 0);
  assert.ok(compareNatural('Left Back Wall 10', 'Left Back Wall 2') > 0);
});

test('a full 1..11 run stacks in numeric order, not lexicographic', () => {
  const names = ['Left Back Wall 10', 'Left Back Wall 2', 'Left Back Wall 1',
    'Left Back Wall 11', 'Left Back Wall 9'];
  assert.deepEqual(sortNamesNatural(names), [
    'Left Back Wall 1', 'Left Back Wall 2', 'Left Back Wall 9',
    'Left Back Wall 10', 'Left Back Wall 11',
  ]);
});

test('group name still wins over the number', () => {
  assert.deepEqual(
    sortNamesNatural(['Right Front Wall 1', 'Left Back Wall 10', 'Left Back Wall 2']),
    ['Left Back Wall 2', 'Left Back Wall 10', 'Right Front Wall 1'],
  );
});

test('mixed real-scene names sort the way an operator would scan them', () => {
  const names = ['TE Sign V3 B', 'Right SmokeStacks 10', 'Left_Front_Left',
    'Right SmokeStacks 2', 'TE Sign V3 A', 'Fogger 1'];
  assert.deepEqual(sortNamesNatural(names), [
    'Fogger 1', 'Left_Front_Left', 'Right SmokeStacks 2', 'Right SmokeStacks 10',
    'TE Sign V3 A', 'TE Sign V3 B',
  ]);
});

// ── G2: total order, null-safe, non-mutating ─────────────────────────────

test('identical names compare equal, distinct names never do', () => {
  assert.equal(compareNatural('Par 1', 'Par 1'), 0);
  assert.notEqual(compareNatural('Par 1', 'par 1'), 0); // total order, not folded
});

test('null/undefined sort as empty rather than throwing', () => {
  assert.equal(compareNatural(null, ''), 0);
  assert.equal(compareNatural(undefined, null), 0);
  assert.ok(compareNatural(null, 'A') < 0);
});

test('sortNamesNatural returns a new array and leaves the input alone', () => {
  const input = ['B 2', 'A 10', 'A 2'];
  const out = sortNamesNatural(input);
  assert.deepEqual(input, ['B 2', 'A 10', 'A 2']);
  assert.deepEqual(out, ['A 2', 'A 10', 'B 2']);
  assert.notEqual(out, input);
});

test('sortByNameNatural sorts objects by a derived name without mutating', () => {
  const input = [{ n: 'Bar 10' }, { n: 'Bar 2' }, { n: 'Aft 1' }];
  const out = sortByNameNatural(input, (o) => o.n);
  assert.deepEqual(out.map((o) => o.n), ['Aft 1', 'Bar 2', 'Bar 10']);
  assert.deepEqual(input.map((o) => o.n), ['Bar 10', 'Bar 2', 'Aft 1']);
  assert.notEqual(out, input);
  assert.equal(out[0], input[2]); // same objects, new array
});

test('sortByNameNatural refuses a missing accessor rather than sorting blind', () => {
  // No fallback (codex P0): without `nameOf` every item keys on '' and the list
  // silently comes out in an arbitrary order that LOOKS sorted.
  assert.throws(() => sortByNameNatural([{ n: 'B' }, { n: 'A' }]), /nameOf must be a function/);
});

// ── G3: shared, and built for speed ──────────────────────────────────────

test('the comparator is backed by ONE cached collator, not per-call localeCompare', () => {
  // `localeCompare(a, undefined, opts)` builds a fresh collator on every call
  // and dominates the cost of sorting a few hundred names — the operator's
  // explicit "make sure it's fast" constraint.
  const src = code('src', 'core', 'natural_sort.js');
  assert.match(src, /new Intl\.Collator\(undefined, \{ numeric: true \}\)/);
  assert.equal((src.match(/new Intl\.Collator/g) || []).length, 1);
  assert.doesNotMatch(src, /localeCompare\(/);
});

test('both name-sorted surfaces import the shared comparator', () => {
  for (const file of [
    ['src', 'gui', 'controller_map_editor.js'],
    ['src', 'gui', 'pixel_map', 'pixel_map_layout.js'],
  ]) {
    const src = code(...file);
    assert.match(src, /import \{ compareNatural \} from '.*natural_sort\.js'/,
      `${file.join('/')} must use the shared comparator`);
    assert.doesNotMatch(src, /localeCompare\([^)]*numeric/,
      `${file.join('/')} must not roll its own numeric compare`);
  }
});

test('sorting the whole rig is cheap', () => {
  // ~90 fixtures today; 2 000 is a wide margin. This is a smoke guard against
  // someone swapping the collator back for per-call localeCompare, not a
  // benchmark — the bar is deliberately loose so it cannot flake on CI.
  const names = [];
  for (let i = 0; i < 2000; i++) names.push(`Left Back Wall ${2000 - i}`);
  const t0 = performance.now();
  const out = sortNamesNatural(names);
  const ms = performance.now() - t0;
  assert.equal(out[0], 'Left Back Wall 1');
  assert.equal(out[1], 'Left Back Wall 2');
  assert.ok(ms < 500, `sorting 2000 names took ${ms.toFixed(1)}ms`);
});
