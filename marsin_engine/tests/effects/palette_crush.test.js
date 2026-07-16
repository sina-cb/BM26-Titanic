/**
 * Unit tests for E6 Palette Crush (effects/palette_crush.js).
 *
 * Contract:
 *   - applyPaletteCrush({pixels, levels, amount}) posterizes the RGB triad
 *     to `levels` discrete steps and blends back by `amount`, in place.
 *   - CHROMA op: W / A / UV are NEVER touched.
 *   - levels=2 at amount=1 snaps each RGB channel to 0 or 1.
 *   - amount=0 (or <=0) is a no-op; levels clamp to [2..8].
 *   - Missing pixels array throws (Codex P0, fail loud).
 *
 * Run: node --test marsin_engine/tests/palette_crush.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyPaletteCrush, paletteCrushEffect } from '../../effects/palette_crush.js';

function px(r, g, b, w = 0.2, a = 0.1, u = 0.05) {
  return { r, g, b, w, a, u };
}

test('levels=2, amount=1 snaps each RGB channel to 0 or 1', () => {
  const p = [px(0.2, 0.5, 0.8)];
  applyPaletteCrush({ pixels: p, levels: 2, amount: 1 });
  // round(0.2)=0, round(0.5)=1 (banker's? no — Math.round(0.5)=1), round(0.8)=1
  assert.equal(p[0].r, 0);
  assert.equal(p[0].g, 1);
  assert.equal(p[0].b, 1);
});

test('levels=2 boundary: just below 0.5 → 0, at/above 0.5 → 1', () => {
  const p = [px(0.49, 0.5, 0.51)];
  applyPaletteCrush({ pixels: p, levels: 2, amount: 1 });
  assert.equal(p[0].r, 0);
  assert.equal(p[0].g, 1);
  assert.equal(p[0].b, 1);
});

test('levels=4 quantizes to {0, 1/3, 2/3, 1}', () => {
  const p = [px(0.1, 0.4, 0.9)];
  applyPaletteCrush({ pixels: p, levels: 4, amount: 1 });
  assert.ok(Math.abs(p[0].r - 0) < 1e-9);       // round(0.1*3)=0 → 0
  assert.ok(Math.abs(p[0].g - 1 / 3) < 1e-9);   // round(0.4*3=1.2)=1 → 1/3
  assert.ok(Math.abs(p[0].b - 1) < 1e-9);       // round(0.9*3=2.7)=3 → 1
});

test('W / A / UV are never touched (chroma-only)', () => {
  const p = [px(0.3, 0.6, 0.9, 0.77, 0.66, 0.55)];
  applyPaletteCrush({ pixels: p, levels: 3, amount: 1 });
  assert.equal(p[0].w, 0.77);
  assert.equal(p[0].a, 0.66);
  assert.equal(p[0].u, 0.55);
});

test('amount=0 is a no-op', () => {
  const p = [px(0.234, 0.567, 0.891)];
  applyPaletteCrush({ pixels: p, levels: 2, amount: 0 });
  assert.equal(p[0].r, 0.234);
  assert.equal(p[0].g, 0.567);
  assert.equal(p[0].b, 0.891);
});

test('amount=0.5 blends halfway between original and quantized', () => {
  const p = [px(0.2, 0, 0)];
  // quantize(0.2, levels=2) = 0. mix(0.2, 0, 0.5) = 0.1.
  applyPaletteCrush({ pixels: p, levels: 2, amount: 0.5 });
  assert.ok(Math.abs(p[0].r - 0.1) < 1e-9);
});

test('levels clamps below 2 up to 2 and above 8 down to 8', () => {
  // levels=1 → clamped to 2 → same as the 0/1 snap.
  const lo = [px(0.2, 0.8, 0.5)];
  applyPaletteCrush({ pixels: lo, levels: 1, amount: 1 });
  assert.equal(lo[0].r, 0);
  assert.equal(lo[0].g, 1);
  assert.equal(lo[0].b, 1);
  // levels=99 → clamped to 8 (7 steps). A value already on an 8-level grid
  // stays put: 3/7 ≈ 0.428571.
  const hi = [px(3 / 7, 0, 0)];
  applyPaletteCrush({ pixels: hi, levels: 99, amount: 1 });
  assert.ok(Math.abs(hi[0].r - 3 / 7) < 1e-9);
});

test('non-integer levels are rounded (levels=2.4 → 2)', () => {
  const p = [px(0.8, 0, 0)];
  applyPaletteCrush({ pixels: p, levels: 2.4, amount: 1 });
  assert.equal(p[0].r, 1); // round(2.4)=2 → 2-level snap of 0.8 → 1
});

test('throws on missing pixels array (Codex P0)', () => {
  assert.throws(() => applyPaletteCrush({ levels: 2, amount: 1 }));
});

test('exported quantize helper and level bounds are correct', () => {
  assert.equal(paletteCrushEffect.MIN_LEVELS, 2);
  assert.equal(paletteCrushEffect.MAX_LEVELS, 8);
  // quantize(v, steps=1, inv=1): 0.4→0, 0.6→1
  assert.equal(paletteCrushEffect.quantize(0.4, 1, 1), 0);
  assert.equal(paletteCrushEffect.quantize(0.6, 1, 1), 1);
});
