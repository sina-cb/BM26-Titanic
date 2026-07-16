/**
 * Unit tests for E9 Ocean Breath (effects/ocean_breath.js).
 *
 * Contract:
 *   - applyOceanBreath({pixels, nowMs, periodMs, depth, warmth}) scales
 *     R/G/B/W/U by a slow cosine swell b ∈ [1-depth, 1], and breathes the
 *     amber floor (px.a) UP at the swell trough, in place.
 *   - Self-clocked (nowMs/periodMs); no signals bag needed.
 *   - At phase 0 (nowMs=0): b == 1-depth (dimmest), amber warmth == 0.
 *   - At the half-period trough of cos: b == 1 (brightest), warmth peaks.
 *   - depth<=0 & warmth<=0 is a no-op; periodMs<=0 throws (fail loud).
 *   - Missing pixels array throws.
 *
 * Run: node --test marsin_engine/tests/ocean_breath.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyOceanBreath, oceanBreathPhase } from '../../effects/ocean_breath.js';

function px(r, g, b, w = 0.5, a = 0.2, u = 0.3) {
  return { r, g, b, w, a, u };
}

test('at nowMs=0 the swell is at its dimmest (b = 1-depth) and warmth is 0', () => {
  const { b, warm } = oceanBreathPhase({ nowMs: 0, periodMs: 8000, depth: 0.6, warmth: 0.4 });
  // cos(0)=1 → swell=1 → b = 1 - 0.6 = 0.4
  assert.ok(Math.abs(b - 0.4) < 1e-9);
  // warm = warmth*(0.5 - 0.5*cos(0)) = 0.4*0 = 0
  assert.ok(Math.abs(warm - 0) < 1e-9);
});

test('at the half period the swell is brightest (b=1) and warmth peaks', () => {
  const period = 8000;
  const { b, warm } = oceanBreathPhase({ nowMs: period / 2, periodMs: period, depth: 0.6, warmth: 0.4 });
  // cos(π)=-1 → swell=0 → b=1; warm = 0.4*(0.5+0.5)=0.4
  assert.ok(Math.abs(b - 1) < 1e-9);
  assert.ok(Math.abs(warm - 0.4) < 1e-9);
});

test('swell b always stays within [1-depth, 1] across a full period', () => {
  const period = 6000;
  const depth = 0.5;
  for (let t = 0; t <= period; t += period / 32) {
    const { b } = oceanBreathPhase({ nowMs: t, periodMs: period, depth, warmth: 0.3 });
    assert.ok(b >= 1 - depth - 1e-9, `b=${b} below floor at t=${t}`);
    assert.ok(b <= 1 + 1e-9, `b=${b} above 1 at t=${t}`);
  }
});

test('applyOceanBreath dims R/G/B/W/U by b at nowMs=0', () => {
  const p = [px(1, 0.8, 0.6, 0.4, 0.2, 0.5)];
  applyOceanBreath({ pixels: p, nowMs: 0, periodMs: 8000, depth: 0.5, warmth: 0 });
  const b = 0.5; // 1 - 0.5
  assert.ok(Math.abs(p[0].r - 1 * b) < 1e-9);
  assert.ok(Math.abs(p[0].g - 0.8 * b) < 1e-9);
  assert.ok(Math.abs(p[0].b - 0.6 * b) < 1e-9);
  assert.ok(Math.abs(p[0].w - 0.4 * b) < 1e-9);
  assert.ok(Math.abs(p[0].u - 0.5 * b) < 1e-9);
});

test('amber floor breathes UP at the trough (a = a*b + warm) and clamps to 1', () => {
  const period = 8000;
  // At half period: b=1, warm=0.5 → a = 0.2*1 + 0.5 = 0.7
  const p = [px(0.1, 0.1, 0.1, 0.1, 0.2, 0.1)];
  applyOceanBreath({ pixels: p, nowMs: period / 2, periodMs: period, depth: 0.6, warmth: 0.5 });
  assert.ok(Math.abs(p[0].a - 0.7) < 1e-9);

  // Clamp: a already high + big warmth ⇒ capped at 1.
  const q = [px(0, 0, 0, 0, 0.9, 0)];
  applyOceanBreath({ pixels: q, nowMs: period / 2, periodMs: period, depth: 0.6, warmth: 0.8 });
  assert.equal(q[0].a, 1);
});

test('depth=0 and warmth=0 is a no-op', () => {
  const p = [px(0.3, 0.4, 0.5, 0.6, 0.7, 0.8)];
  applyOceanBreath({ pixels: p, nowMs: 1234, periodMs: 8000, depth: 0, warmth: 0 });
  assert.equal(p[0].r, 0.3);
  assert.equal(p[0].a, 0.7);
  assert.equal(p[0].u, 0.8);
});

test('warmth alone (depth=0) leaves R/G/B/W/U alone but lifts amber', () => {
  const period = 8000;
  const p = [px(0.5, 0.5, 0.5, 0.5, 0.1, 0.5)];
  // depth=0 → b=1 (no dimming); at half period warm=0.3.
  applyOceanBreath({ pixels: p, nowMs: period / 2, periodMs: period, depth: 0, warmth: 0.3 });
  assert.ok(Math.abs(p[0].r - 0.5) < 1e-9);
  assert.ok(Math.abs(p[0].w - 0.5) < 1e-9);
  assert.ok(Math.abs(p[0].u - 0.5) < 1e-9);
  assert.ok(Math.abs(p[0].a - (0.1 + 0.3)) < 1e-9);
});

test('periodMs <= 0 throws (fail loud, no NaN freeze)', () => {
  assert.throws(() => oceanBreathPhase({ nowMs: 0, periodMs: 0, depth: 0.5, warmth: 0 }));
  assert.throws(() =>
    applyOceanBreath({ pixels: [px(1, 1, 1)], nowMs: 0, periodMs: -5, depth: 0.5, warmth: 0 })
  );
});

test('throws on missing pixels array (Codex P0)', () => {
  assert.throws(() => applyOceanBreath({ nowMs: 0, periodMs: 8000, depth: 0.5, warmth: 0 }));
});
