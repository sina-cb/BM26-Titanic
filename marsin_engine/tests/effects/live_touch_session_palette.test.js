import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertExactFiveHsv,
  buildCrossfadeLivePalettes,
  candidatePaletteFromOutput,
  outputPaletteFromSelection,
  overlayFrameFromPairParams,
  overlayFrameFromTransition,
  overlayFrameFromTransitionState,
} from '../../lib/live_touch_session_palette.js';

const ring = [
  { h: 0.1, s: 0.9, v: 0.8 },
  { h: 0.6, s: 0.9, v: 0.8 },
  { h: 0.2, s: 0.7, v: 0.7 },
  { h: 0.3, s: 0.6, v: 0.6 },
  { h: 0.4, s: 0.5, v: 0.5 },
];
const sel = [0, 1];

test('assertExactFiveHsv rejects wrong counts and shapes', () => {
  assert.throws(() => assertExactFiveHsv(ring.slice(0, 2)), /exactly 5 HSV colors/);
  assert.throws(
    () => assertExactFiveHsv([...ring.slice(0, 4), { h: 2, s: 0.5, v: 0.5 }]),
    /must be finite in \[0,1\]/,
  );
  assert.equal(assertExactFiveHsv(ring).length, 5);
});

test('two-colour crossfade builds parallel livePalettes and pair overlay frames', () => {
  const palettes = [{ c1: ring[0], c2: ring[1] }, { c1: ring[1], c2: ring[0] }];
  const livePalettes = buildCrossfadeLivePalettes(ring, sel, palettes);
  assert.equal(livePalettes.length, 2);
  livePalettes.forEach((state) => assert.equal(assertExactFiveHsv(state).length, 5));

  const midpoint = overlayFrameFromPairParams(ring, sel, {
    colorPalette1: { h: 0.35, s: 0.9, v: 0.8 },
    colorPalette2: { h: 0.35, s: 0.9, v: 0.8 },
  });
  assert.deepEqual(midpoint[0], { h: 0.35, s: 0.9, v: 0.8 });
  assert.deepEqual(midpoint[1], { h: 0.35, s: 0.9, v: 0.8 });
  assert.deepEqual(midpoint.slice(2), ring.slice(2));
});

test('non-default A/B choices lead two-colour output while preserving all five samples', () => {
  const picked = [1, 4];
  const output = outputPaletteFromSelection(ring, picked);
  assert.deepEqual(output, [ring[1], ring[4], ring[0], ring[2], ring[3]]);
  assert.deepEqual(candidatePaletteFromOutput(output, picked), ring);

  const palettes = [{ c1: ring[1], c2: ring[4] }, { c1: ring[4], c2: ring[1] }];
  const livePalettes = buildCrossfadeLivePalettes(ring, picked, palettes);
  assert.deepEqual(livePalettes[0], [ring[1], ring[4], ring[0], ring[2], ring[3]]);
  assert.deepEqual(livePalettes[1], [ring[4], ring[1], ring[0], ring[2], ring[3]]);
});

test('transition frames keep slots 3-5 stable while A/B interpolate', () => {
  const fromFive = buildCrossfadeLivePalettes(ring, sel, [{ c1: ring[0], c2: ring[1] }])[0];
  const toFive = buildCrossfadeLivePalettes(ring, sel, [{ c1: ring[1], c2: ring[0] }])[0];
  const mid = overlayFrameFromTransition(ring, sel, fromFive, toFive, 0.5);
  assert.equal(assertExactFiveHsv(mid).length, 5);
  assert.deepEqual(mid.slice(2), ring.slice(2));
  assert.ok(Math.abs(mid[0].h - 0.35) < 0.01, `slot 0 midpoint hue ${mid[0].h}`);
});

test('overlayFrameFromTransitionState resolves running, terminal, and interrupted frames', () => {
  const params = {
    colorPalette1: { h: 0.12, s: 0.9, v: 0.8 },
    colorPalette2: { h: 0.62, s: 0.9, v: 0.8 },
  };
  const running = overlayFrameFromTransitionState({ status: 'running', params }, ring, sel);
  assert.equal(assertExactFiveHsv(running).length, 5);

  const settled = overlayFrameFromTransitionState({
    status: 'settled',
    progress: 1,
    params: {
      colorPalette1: ring[1],
      colorPalette2: ring[0],
    },
  }, ring, sel);
  assert.deepEqual(settled[0], ring[1]);
  assert.deepEqual(settled[1], ring[0]);

  const interrupted = overlayFrameFromTransitionState({
    status: 'cancelled',
    progress: 0.4,
    fromParams: {
      colorPalette1: ring[0],
      colorPalette2: ring[1],
    },
    targetParams: {
      colorPalette1: ring[1],
      colorPalette2: ring[0],
    },
  }, ring, sel);
  assert.equal(assertExactFiveHsv(interrupted).length, 5);
});
