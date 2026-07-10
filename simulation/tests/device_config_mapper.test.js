/**
 * device_config_mapper.test.js — golden + edge tests for the firmware linear
 * layout (docs/41 §3, plan P2). No I/O. computeLinearLayout reproduces the
 * firmware's contiguous sACN channel walk byte-for-byte so the sim's patches,
 * the engine model, and the hardware agree. (The device push itself is
 * per-output now — its plan derivation is covered in per_output_push.test.js.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLinearLayout } from '../src/dmx/led/device_config_mapper.js';

// ── Builders ─────────────────────────────────────────────────────────────────

function rgbwStrand(count, enabled = true, pinData = 35) {
  return {
    type: 'WS281X_RGBW', count, pinData, pinClock: 0, colorOrder: 'RGBW',
    rgbwMode: 'exact', enabled, deadPixels: 0, deadPixelIndices: [],
  };
}

function cfg(strands, universe, startAddress = 1) {
  return { strands, dmx: { enabled: true, protocol: 0, universe, startAddress, timeoutMs: 3000 } };
}

// ── computeLinearLayout: firmware algorithm ─────────────────────────────────

test('computeLinearLayout — golden: 2×40 RGBW → U3 ch1–160 / ch161–320', () => {
  const layout = computeLinearLayout(
    cfg([rgbwStrand(40), rgbwStrand(40, true, 36), rgbwStrand(40, false, 37), rgbwStrand(40, false, 38)], 3),
  );
  assert.equal(layout.length, 4);

  assert.deepEqual(
    { u: layout[0].universe, s: layout[0].startChannel, e: layout[0].endChannel, span: layout[0].pixelSpan },
    { u: 3, s: 1, e: 160, span: 160 },
  );
  assert.deepEqual(
    { u: layout[1].universe, s: layout[1].startChannel, e: layout[1].endChannel, span: layout[1].pixelSpan },
    { u: 3, s: 161, e: 320, span: 160 },
  );
  assert.equal(layout[2].enabled, false);
  assert.equal(layout[2].universe, null);
  assert.equal(layout[3].enabled, false);
});

test('computeLinearLayout — disabled middle output does not consume channels', () => {
  const layout = computeLinearLayout(
    cfg([rgbwStrand(40), rgbwStrand(40, false, 36), rgbwStrand(40, true, 37)], 3),
  );
  assert.deepEqual([layout[0].startChannel, layout[0].endChannel], [1, 160]);
  assert.equal(layout[1].enabled, false);
  // Output 2 continues right after output 0 — the disabled middle is skipped.
  assert.deepEqual([layout[2].universe, layout[2].startChannel, layout[2].endChannel], [3, 161, 320]);
});

test('computeLinearLayout — >128px spills into U+1, no straddling', () => {
  const layout = computeLinearLayout(cfg([rgbwStrand(130)], 3));
  const out = layout[0];
  assert.equal(out.universe, 3);
  assert.equal(out.startChannel, 1);
  assert.equal(out.endUniverse, 4);
  assert.equal(out.endChannel, 8);            // 2 spilled px × 4ch = ch1–8 in U4
  assert.equal(out.pixelSpan, 520);
  assert.equal(out.segments.length, 2);
  assert.deepEqual(
    out.segments.map((s) => [s.universe, s.startChannel, s.endChannel, s.pixelCount]),
    [[3, 1, 512, 128], [4, 1, 8, 2]],
  );
});

test('computeLinearLayout — startAddress≠1 shifts the first universe', () => {
  const layout = computeLinearLayout(cfg([rgbwStrand(40)], 3, 5));
  assert.deepEqual(
    [layout[0].universe, layout[0].startChannel, layout[0].endChannel],
    [3, 5, 164],
  );
});

test('computeLinearLayout — startAddress near the boundary spills correctly', () => {
  // startAddress 509: pixel0 occupies ch509–512 (fits), pixel1 rolls to U+1.
  const layout = computeLinearLayout(cfg([rgbwStrand(2)], 3, 509));
  assert.deepEqual(
    layout[0].segments.map((s) => [s.universe, s.startChannel, s.endChannel, s.pixelCount]),
    [[3, 509, 512, 1], [4, 1, 4, 1]],
  );
});

test('computeLinearLayout — layout past the sACN universe ceiling throws (cap)', () => {
  // At universe 63999 a 129th RGBW pixel would roll to 64000 (> ceiling).
  assert.throws(() => computeLinearLayout(cfg([rgbwStrand(129)], 63999)),
    /spills past the sACN universe ceiling/);
});

test('computeLinearLayout — bad dmx bounds throw', () => {
  assert.throws(() => computeLinearLayout(cfg([rgbwStrand(40)], 0)), /dmx\.universe/);
  assert.throws(() => computeLinearLayout(cfg([rgbwStrand(40)], 3, 700)), /dmx\.startAddress/);
});

test('computeLinearLayout — unknown colorOrder on an enabled strand throws', () => {
  const bad = { ...rgbwStrand(40), colorOrder: 'ZZZ' };
  assert.throws(() => computeLinearLayout(cfg([bad], 3)), /unknown colorOrder/);
});
