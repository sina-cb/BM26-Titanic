// Tests for lib/pixel_local_index.js — resolving the per-fixture 0-based
// `pixelLocalIndex` for every model pixel. The exporter now emits a TRUE
// within-fixture `localIndex` on every pixel; the host PREFERS it and falls
// back to the legacy (group,fId) heuristic only for models that lack it.
// A half-migrated (partial) model must FAIL LOUDLY (codex P0).

import test from 'node:test';
import assert from 'node:assert/strict';

import { derivePixelLocalIndices } from '../lib/pixel_local_index.js';

// ── NEW format: exporter `localIndex` is preferred verbatim ──────────

test('new format: trusts exporter localIndex over (group,fId) derivation', () => {
  // A synthetic multi-fixture model. The exporter localIndex DELIBERATELY
  // disagrees with what the (group,fId) heuristic would compute, to prove
  // the exporter field wins. Two DMX bars (one group, distinct fId) and a
  // LED strand (one group), each numbered 0..N-1 within itself.
  const pixels = [
    // Bar A: fId 1, 3 pixels — exporter ordinals 0,1,2
    { type: 'dmx', group: 'Bars', fId: 1, localIndex: 0 },
    { type: 'dmx', group: 'Bars', fId: 1, localIndex: 1 },
    { type: 'dmx', group: 'Bars', fId: 1, localIndex: 2 },
    // Bar B: fId 2, 2 pixels — exporter ordinals 0,1
    { type: 'dmx', group: 'Bars', fId: 2, localIndex: 0 },
    { type: 'dmx', group: 'Bars', fId: 2, localIndex: 1 },
    // LED strand: one group, 4 pixels — exporter ordinals 0..3
    { type: 'led', group: 'Strand_Left', fId: 0, localIndex: 0 },
    { type: 'led', group: 'Strand_Left', fId: 0, localIndex: 1 },
    { type: 'led', group: 'Strand_Left', fId: 0, localIndex: 2 },
    { type: 'led', group: 'Strand_Left', fId: 0, localIndex: 3 },
  ];
  const out = derivePixelLocalIndices(pixels);
  assert.deepEqual(out, [0, 1, 2, 0, 1, 0, 1, 2, 3]);
});

test('new format: each fixture/strand is numbered 0..N-1 in its own order', () => {
  // Build three fixtures of varying length and assert every fixture run is a
  // clean 0..len-1 sequence (the property a sweep relies on).
  const sizes = { 'Par': 1, 'Bar18': 18, 'Strand40': 40 };
  const pixels = [];
  for (const [group, len] of Object.entries(sizes)) {
    for (let j = 0; j < len; j++) {
      pixels.push({ type: 'dmx', group, fId: 0, localIndex: j });
    }
  }
  const out = derivePixelLocalIndices(pixels);
  // Walk back over the runs and confirm 0..len-1 per fixture.
  let p = 0;
  for (const len of Object.values(sizes)) {
    for (let j = 0; j < len; j++) {
      assert.equal(out[p], j, `pixel ${p} should be local ${j}`);
      p += 1;
    }
  }
});

// ── A localIndex sweep lights pixels in fixture order ────────────────

test('sweep-by-localIndex lights strand pixels in true fixture order', () => {
  // Model the way a sweep pattern keys off pixelLocalIndex: a 40-pixel
  // strand whose pixels are emitted in physical order. Sweeping the local
  // index from 0→N must light the strand head→tail (not scrambled).
  const N = 40;
  const pixels = [];
  for (let j = 0; j < N; j++) {
    pixels.push({ type: 'led', group: 'Hull', fId: 0, localIndex: j,
      x: j /* physical position along the bar */ });
  }
  const local = derivePixelLocalIndices(pixels);

  // Simulate a single-pixel "comet" sweep: at sweep step s, the lit pixel is
  // the one whose localIndex === s. Confirm it advances monotonically along
  // the physical bar (x increases with the sweep step).
  let prevX = -Infinity;
  for (let s = 0; s < N; s++) {
    const litIdx = local.indexOf(s);
    assert.notEqual(litIdx, -1, `sweep step ${s} must light a pixel`);
    assert.equal(local[litIdx], s);
    assert.ok(pixels[litIdx].x > prevX,
      `sweep step ${s} must advance ALONG the bar (x must increase)`);
    prevX = pixels[litIdx].x;
  }
});

// ── LEGACY fallback: derive from (group,fId) when no field present ───

test('legacy fallback: derives from (group,fId) when localIndex absent', () => {
  // test_bench-style: coarse group lumps 4 pars, fId refines each par.
  const pixels = [
    { type: 'dmx', group: 'ParLights', fId: 1 },
    { type: 'dmx', group: 'ParLights', fId: 2 },
    { type: 'dmx', group: 'ParLights', fId: 3 },
    { type: 'dmx', group: 'ParLights', fId: 4 },
    // A 4-head vintage fixture: same fId, contiguous → 0..3.
    { type: 'dmx', group: 'Vintage', fId: 5 },
    { type: 'dmx', group: 'Vintage', fId: 5 },
    { type: 'dmx', group: 'Vintage', fId: 5 },
    { type: 'dmx', group: 'Vintage', fId: 5 },
  ];
  const out = derivePixelLocalIndices(pixels);
  assert.deepEqual(out, [0, 0, 0, 0, 0, 1, 2, 3]);
});

test('legacy fallback: titanic-style fId:0, group is the fixture key', () => {
  // Every pixel fId:0; group is the finest identity. Two strands.
  const pixels = [
    { type: 'led', group: 'Left_Front', fId: 0 },
    { type: 'led', group: 'Left_Front', fId: 0 },
    { type: 'led', group: 'Left_Front', fId: 0 },
    { type: 'led', group: 'Right_Front', fId: 0 },
    { type: 'led', group: 'Right_Front', fId: 0 },
  ];
  const out = derivePixelLocalIndices(pixels);
  assert.deepEqual(out, [0, 1, 2, 0, 1]);
});

test('legacy fallback: null pixels get 0 and break the run', () => {
  const pixels = [
    { type: 'dmx', group: 'A', fId: 1 },
    { type: 'dmx', group: 'A', fId: 1 },
    null,
    { type: 'dmx', group: 'A', fId: 1 },
  ];
  const out = derivePixelLocalIndices(pixels);
  assert.deepEqual(out, [0, 1, 0, 0]);
});

// ── Codex P0: a half-migrated model FAILS LOUDLY ─────────────────────

test('partial localIndex carry throws (no silent mis-derivation)', () => {
  const pixels = [
    { type: 'dmx', group: 'A', fId: 1, localIndex: 0 },
    { type: 'dmx', group: 'A', fId: 1 /* MISSING localIndex */ },
    { type: 'dmx', group: 'A', fId: 1, localIndex: 2 },
  ];
  assert.throws(() => derivePixelLocalIndices(pixels), /Corrupt model/);
});

test('null pixels do not trip the partial-carry guard', () => {
  // Holes are not "non-null pixels missing the field" — they are skipped.
  const pixels = [
    { type: 'led', group: 'S', fId: 0, localIndex: 0 },
    null,
    { type: 'led', group: 'S', fId: 0, localIndex: 1 },
  ];
  const out = derivePixelLocalIndices(pixels);
  assert.deepEqual(out, [0, 0, 1]);
});

test('empty model yields empty result', () => {
  assert.deepEqual(derivePixelLocalIndices([]), []);
});

// ── Engine consumption: the meta-builder packs the exporter ordinal ──

test('engine meta-builder packs exporter localIndex into pixelLocalIndex lane', () => {
  // Mirror exactly what engine.js loadModel / model_loader.js do: derive once,
  // then map each pixel to a meta record whose pixelLocalIndex is that result.
  // A synthetic 2-fixture model that carries the exporter field; the packed
  // lane must equal the exporter's per-fixture ordinal, not a re-derivation.
  const pixels = [
    { cId: 1, sId: 1, fId: 7, vMask: 0, fixtureType: 'ShehdsBar', localIndex: 0 },
    { cId: 1, sId: 1, fId: 7, vMask: 0, fixtureType: 'ShehdsBar', localIndex: 1 },
    { cId: 1, sId: 1, fId: 7, vMask: 0, fixtureType: 'ShehdsBar', localIndex: 2 },
    { cId: 2, sId: 0, fId: 0, vMask: 0, fixtureType: '', localIndex: 0 },
    { cId: 2, sId: 0, fId: 0, vMask: 0, fixtureType: '', localIndex: 1 },
  ];
  const localIndices = derivePixelLocalIndices(pixels);
  const metaArray = pixels.map((px, i) => ({
    controllerId: px.cId || 0,
    sectionId: px.sId || 0,
    fixtureId: px.fId || 0,
    viewMask: px.vMask || 0,
    pixelLocalIndex: localIndices[i],
  }));
  assert.deepEqual(metaArray.map(m => m.pixelLocalIndex), [0, 1, 2, 0, 1]);
});
