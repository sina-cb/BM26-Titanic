/**
 * Unit tests for E4 Freeze Frame (effects/freeze_frame.js).
 *
 * Contract:
 *   - createFreezeState() → explicit state holder (lazy buffer + timestamps).
 *   - applyFreezeFrame({pixels, state, active, nowMs, holdFadeMs}):
 *       * active + first frame → captures the live frame, output unchanged.
 *       * active + subsequent frames → replays the captured frame (all 6 ch),
 *         even as the live buffer changes underneath.
 *       * holdFadeMs>0 → the frozen frame fades linearly to black.
 *       * active=false → releases (next engage re-captures); no-op on pixels.
 *   - Freeze REPLACES all 6 channels (it replays a real composited frame).
 *   - Missing pixels/state throws (Codex P0).
 *
 * Run: node --test marsin_engine/tests/freeze_frame.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFreezeFrame, createFreezeState } from '../effects/freeze_frame.js';

function px(r, g, b, w = 0.2, a = 0.1, u = 0.05) {
  return { r, g, b, w, a, u };
}

// The freeze snapshot lives in a Float32Array, so replayed values carry
// float32 rounding (0.2 → 0.20000000298…). Compare within a float32 epsilon.
const F32 = 1e-6;
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < F32, msg || `${actual} ≉ ${expected}`);
}

test('captures on first active frame; output equals the live frame', () => {
  const st = createFreezeState();
  const p = [px(0.5, 0.4, 0.3, 0.2, 0.1, 0.05)];
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 0 });
  near(p[0].r, 0.5);
  near(p[0].g, 0.4);
  near(p[0].b, 0.3);
  near(p[0].w, 0.2);
  near(p[0].a, 0.1);
  near(p[0].u, 0.05);
  assert.equal(st.captured, true);
});

test('holds the captured frame while the live buffer changes underneath', () => {
  const st = createFreezeState();
  const p = [px(0.5, 0.4, 0.3, 0.2, 0.1, 0.05)];
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 0 }); // capture 0.5/0.4/0.3...

  // Simulate the pattern moving on: mutate the live pixel.
  p[0].r = 0.9; p[0].g = 0.9; p[0].b = 0.9; p[0].w = 0.9; p[0].a = 0.9; p[0].u = 0.9;

  // Held frame with no fade → snaps back to the captured values.
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 25 });
  near(p[0].r, 0.5);
  near(p[0].g, 0.4);
  near(p[0].b, 0.3);
  near(p[0].w, 0.2);
  near(p[0].a, 0.1);
  near(p[0].u, 0.05);
});

test('holdFadeMs fades the frozen frame linearly to black', () => {
  const st = createFreezeState();
  const p = [px(1, 0.8, 0.6, 0.4, 0.2, 0.1)];
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 1000, holdFadeMs: 1000 });
  // Freshly captured at t=1000: fade = 1 - 0/1000 = 1 → unchanged.
  near(p[0].r, 1);

  // Halfway through the fade: fade = 0.5.
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 1500, holdFadeMs: 1000 });
  near(p[0].r, 0.5);
  near(p[0].g, 0.4);
  near(p[0].w, 0.2);

  // Past the fade: fully black.
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 3000, holdFadeMs: 1000 });
  assert.equal(p[0].r, 0);
  assert.equal(p[0].g, 0);
  assert.equal(p[0].b, 0);
  assert.equal(p[0].w, 0);
  assert.equal(p[0].a, 0);
  assert.equal(p[0].u, 0);
});

test('release (active=false) is a no-op on pixels and clears capture', () => {
  const st = createFreezeState();
  const p = [px(0.5, 0.4, 0.3)];
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 0 }); // capture
  assert.equal(st.captured, true);

  const q = [px(0.9, 0.8, 0.7)];
  applyFreezeFrame({ pixels: q, state: st, active: false, nowMs: 100 });
  assert.equal(q[0].r, 0.9); // untouched
  assert.equal(st.captured, false);
});

test('re-engage after release captures the NEW frame', () => {
  const st = createFreezeState();
  applyFreezeFrame({ pixels: [px(0.5, 0.4, 0.3)], state: st, active: true, nowMs: 0 });
  applyFreezeFrame({ pixels: [px(0.5, 0.4, 0.3)], state: st, active: false, nowMs: 10 });

  const p = [px(0.1, 0.2, 0.3, 0.4, 0.5, 0.6)];
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 20 }); // captures NEW frame
  p[0].r = 0.99;
  applyFreezeFrame({ pixels: p, state: st, active: true, nowMs: 45 }); // replays NEW frame
  near(p[0].r, 0.1);
  near(p[0].u, 0.6);
});

test('reallocates + recaptures when the pixel count changes', () => {
  const st = createFreezeState();
  applyFreezeFrame({ pixels: [px(0.5, 0.5, 0.5)], state: st, active: true, nowMs: 0 });
  assert.equal(st.pixelCount, 1);

  const p2 = [px(0.1, 0.1, 0.1), px(0.2, 0.2, 0.2)];
  applyFreezeFrame({ pixels: p2, state: st, active: true, nowMs: 10 });
  assert.equal(st.pixelCount, 2);
  // Second pixel replays correctly on the next held frame.
  p2[1].r = 0.9;
  applyFreezeFrame({ pixels: p2, state: st, active: true, nowMs: 35 });
  near(p2[1].r, 0.2);
});

test('throws on missing pixels or state (Codex P0)', () => {
  const st = createFreezeState();
  assert.throws(() => applyFreezeFrame({ state: st, active: true, nowMs: 0 }));
  assert.throws(() => applyFreezeFrame({ pixels: [px(0, 0, 0)], active: true, nowMs: 0 }));
});
