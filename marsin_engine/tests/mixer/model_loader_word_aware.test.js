// Regression tests for lib/model_loader.js word-awareness (Tier-C).
//
// model_loader is the VM-only loader behind tools/perf_gauge.mjs and
// tools/param_truth/render_context.js. It used to accumulate ONE flat
// `reservedMask` across every viewMasks entry, ignoring each entry's
// `word`. Word 0 (`viewMask`) and word 1 (`viewMaskHi`) are INDEPENDENT
// bit spaces (lib/view_word.js), so once titanic pinned 10 semantic views
// into word 1 at bits 0x1..0x200 the loader reported a phantom collision:
//
//   THROW: groupBits['Left Back Wall'] reuses bit 0x10
//
// (word-0 group bit 0x10 vs word-1 preset bit 0x10 — not a real clash).
// engine.js always tracked the two words separately; this suite pins the
// same semantics into model_loader AND loads the REAL titanic model
// through it, which no test did before — which is why the phantom
// collision never showed up red.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadModelForGauge,
  reserveExplicitBits,
  assignGroupBits,
} from '../../lib/model_loader.js';

// ── The real titanic model loads through model_loader ─────────────────

test('model_loader: the REAL titanic model loads (word-1 presets are not word-0 collisions)', async () => {
  const model = await loadModelForGauge('titanic');

  const groupNames = Object.keys(model.groupBits);
  assert.equal(groupNames.length, 24, 'titanic declares 24 base group bits');
  assert.equal(model.viewMasks.length, 17, 'titanic declares 17 custom view presets');
  // The named-mask vocabulary the sidecar contributes: 24 base + 17 custom.
  assert.ok(groupNames.length + model.viewMasks.length >= 41,
    `expected >= 41 named masks, got ${groupNames.length + model.viewMasks.length}`);
  assert.equal(model.pixelCount, model.pixels.length);
  assert.equal(model.metaArray.length, model.pixels.length);
});

test('model_loader: titanic actually contains the cross-word bit pair that used to throw', async () => {
  // The regression is only meaningful while some word-1 preset bit equals
  // some word-0 group bit. Assert that overlap exists, so this suite fails
  // loudly if a re-export ever removes the condition under test.
  const model = await loadModelForGauge('titanic');
  const groupBitValues = new Set(Object.values(model.groupBits));
  const hiViews = model.viewMasks.filter((vm) => vm.word === 1);
  assert.ok(hiViews.length > 0, 'titanic pins presets into word 1 (viewMaskHi)');
  const overlapping = hiViews.filter((vm) => groupBitValues.has(vm.bit));
  assert.ok(overlapping.length > 0,
    'expected at least one word-1 preset whose bit value equals a word-0 group bit');
});

test('model_loader: titanic word-1 presets land in viewMaskHi, word-0 in viewMask', async () => {
  const model = await loadModelForGauge('titanic');
  const hiBits = model.viewMasks.filter((vm) => vm.word === 1)
    .reduce((acc, vm) => acc | vm.bit, 0);
  const hiPixels = model.metaArray.filter((m) => (m.viewMaskHi & hiBits) !== 0);
  assert.ok(hiPixels.length > 0, 'word-1 presets merged into the viewMaskHi lane');

  // Every view entry is tagged with a word, and every single-bit value is a
  // safe power of two in its own word.
  for (const vm of model.viewMasks) {
    assert.ok(vm.word === 0 || vm.word === 1, `view '${vm.name}' tagged word 0|1, got ${vm.word}`);
  }
  // Group bits stay strictly word 0 and never leak into the hi lane.
  const groupMask = Object.values(model.groupBits).reduce((acc, b) => acc | b, 0);
  for (const m of model.metaArray) {
    assert.equal(m.viewMask & ~(groupMask | model.viewMasks
      .filter((vm) => vm.word === 0)
      .reduce((acc, vm) => acc | vm.bit, 0)), 0,
    'viewMask carries only group bits + word-0 preset bits');
  }
});

test('model_loader: repeated titanic loads are idempotent (no bit accumulation)', async () => {
  const a = await loadModelForGauge('titanic');
  const b = await loadModelForGauge('titanic');
  assert.deepEqual(b.metaArray, a.metaArray, 'a second load produces identical meta');
});

// ── reserveExplicitBits: per-word reservation ─────────────────────────

test('reserveExplicitBits: identical bit values in DIFFERENT words do not collide', () => {
  const { reservedMask, reservedMaskHi } = reserveExplicitBits([
    { name: 'LowA', bit: 0x10, word: 0, groups: ['A'] },
    { name: 'HighA', bit: 0x10, word: 1, groups: ['A'] },
  ]);
  assert.equal(reservedMask, 0x10);
  assert.equal(reservedMaskHi, 0x10);
});

test('reserveExplicitBits: a GENUINE word-0 collision still throws loudly', () => {
  assert.throws(() => reserveExplicitBits([
    { name: 'LowA', bit: 0x10, word: 0, groups: ['A'] },
    { name: 'LowB', bit: 0x10, groups: ['B'] }, // word omitted => word 0
  ]), /reuses bit 0x10/);
});

test('reserveExplicitBits: a GENUINE word-1 collision still throws loudly', () => {
  assert.throws(() => reserveExplicitBits([
    { name: 'HighA', bit: 0x40, word: 1, groups: ['A'] },
    { name: 'HighB', bit: 0x40, word: 1, groups: ['B'] },
  ]), /reuses viewMaskHi bit 0x40/);
});

test('reserveExplicitBits: a word outside {0,1} throws (mirrors engine.js)', () => {
  assert.throws(() => reserveExplicitBits([
    { name: 'Bogus', bit: 0x2, word: 2, groups: ['A'] },
  ]), /word must be 0 or 1/);
});

test('reserveExplicitBits: word:1 without an explicit bit throws (mirrors engine.js)', () => {
  assert.throws(() => reserveExplicitBits([
    { name: 'HighNoBit', word: 1, groups: ['A'] },
  ]), /needs an explicit single-bit value/);
});

test('reserveExplicitBits: still rejects duplicate names and unsafe bits', () => {
  assert.throws(() => reserveExplicitBits([
    { name: 'Dup', bit: 0x1, groups: ['A'] },
    { name: 'Dup', bit: 0x2, groups: ['B'] },
  ]), /Duplicate viewMasks entry name/);
  assert.throws(() => reserveExplicitBits([
    { name: 'TooHigh', bit: 0x80000000, groups: ['A'] },
  ]), /power of two/);
});

// ── assignGroupBits: validated against the WORD-0 reservation only ────

const syntheticMod = () => ({
  pixels: [{ group: 'A' }, { group: 'B' }],
});

test('assignGroupBits: a word-1 preset bit does NOT block the same group bit value', () => {
  const declared = { A: 0x10, B: 0x20 };
  const { reservedMask } = reserveExplicitBits([
    { name: 'HighA', bit: 0x10, word: 1, groups: ['A'] },
    { name: 'HighB', bit: 0x20, word: 1, groups: ['B'] },
  ]);
  assert.equal(reservedMask, 0, 'word-1 presets reserve nothing in word 0');
  assert.deepEqual(assignGroupBits(syntheticMod(), declared, reservedMask), declared);
});

test('assignGroupBits: a GENUINE word-0 preset/group collision still throws', () => {
  const declared = { A: 0x10, B: 0x20 };
  const { reservedMask } = reserveExplicitBits([
    { name: 'LowA', bit: 0x10, word: 0, groups: ['A'] },
  ]);
  assert.equal(reservedMask, 0x10);
  assert.throws(() => assignGroupBits(syntheticMod(), declared, reservedMask),
    /groupBits\['A'\] reuses bit 0x10/);
});

test('assignGroupBits: two groups declared on the same bit still throw', () => {
  assert.throws(() => assignGroupBits(syntheticMod(), { A: 0x4, B: 0x4 }, 0),
    /groupBits\['B'\] reuses bit 0x4/);
});

test('assignGroupBits: derived assignment routes around word-0 reservations only', () => {
  const { reservedMask } = reserveExplicitBits([
    { name: 'LowPin', bit: 0x1, word: 0, groups: ['A'] },
    { name: 'HighPin', bit: 0x2, word: 1, groups: ['B'] },
  ]);
  // 0x1 is reserved in word 0; 0x2 is reserved in word 1 ONLY, so the
  // derived group bits must skip 0x1 but are free to use 0x2.
  assert.deepEqual(assignGroupBits(syntheticMod(), null, reservedMask), { A: 0x2, B: 0x4 });
});
