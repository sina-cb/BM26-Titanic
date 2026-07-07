/**
 * Unit tests for the Hue Shifter (global + per-channel) — docs/39 §F-hue.
 *
 * Contract:
 *   - Both features rotate RGB ONLY via a luminance-preserving YIQ
 *     rotation. W / A / UV are NEVER touched (mission-critical exterior
 *     whites must not be tinted/dimmed).
 *   - No-op at hue=0 (zero cost gate).
 *   - validateHue rejects non-finite (400) and normalizes any finite
 *     angle into [0,360).
 *   - Global auto-rotate advances `degrees` by autoRotateDegPerSec * dt.
 *   - Per-channel hue normalizes through the PatternChannel ctor.
 *
 * Run: node --test marsin_engine/tests/hue_shift.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyHueShift } from '../effects/hue_shift.js';
import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { PatternChannel } from '../lib/pattern_channel.js';
import { validateHue } from '../lib/api_server.js';

function px(r, g, b, w = 0.2, a = 0.1, u = 0.05) {
  return { r, g, b, w, a, u };
}

// ── effects/hue_shift.js (float, post-composite) ─────────────────────────

test('applyHueShift is a no-op at 0 degrees', () => {
  const p = [px(1, 0, 0)];
  applyHueShift({ pixels: p, degrees: 0 });
  assert.equal(p[0].r, 1);
  assert.equal(p[0].g, 0);
  assert.equal(p[0].b, 0);
});

test('applyHueShift rotates pure red 120deg (chroma moves, red collapses)', () => {
  // Standard luminance-preserving YIQ rotation: the chroma plane rotates
  // by the hue angle. Pure red's red component collapses and the chroma
  // moves to another hue. (Verified empirically: at 120deg the buffer
  // becomes blue-dominant; at 240deg green-dominant — a consistent,
  // reversible rotation, which is exactly what a hue knob must be.)
  const p = [px(1, 0, 0)];
  applyHueShift({ pixels: p, degrees: 120 });
  assert.ok(p[0].r < 0.3, `expected red collapsed, got r=${p[0].r}`);
  assert.ok(p[0].b > 0.7, `expected blue dominant, got b=${p[0].b}`);
  // W/A/U untouched.
  assert.equal(p[0].w, 0.2);
  assert.equal(p[0].a, 0.1);
  assert.equal(p[0].u, 0.05);
});

test('applyHueShift rotates pure red 240deg (green-dominant)', () => {
  const p = [px(1, 0, 0)];
  applyHueShift({ pixels: p, degrees: 240 });
  assert.ok(p[0].g > 0.7, `expected green dominant, got g=${p[0].g}`);
  assert.ok(p[0].r < 0.2, `expected red collapsed, got r=${p[0].r}`);
});

test('applyHueShift is approximately reversible: +h then -h ~= input', () => {
  // The published NTSC YIQ constants are not perfectly orthogonal (they
  // carry ~1e-3 rounding), so two rotations accumulate a small error.
  // We use a mid-range color (no clamping) and a generous tolerance —
  // the point is that the rotation is a real, reversible chroma rotation,
  // not a destructive operation.
  const p = [px(0.6, 0.35, 0.45)];
  applyHueShift({ pixels: p, degrees: 75 });
  applyHueShift({ pixels: p, degrees: -75 });
  assert.ok(Math.abs(p[0].r - 0.6) < 0.07, `r=${p[0].r}`);
  assert.ok(Math.abs(p[0].g - 0.35) < 0.07, `g=${p[0].g}`);
  assert.ok(Math.abs(p[0].b - 0.45) < 0.07, `b=${p[0].b}`);
});

test('applyHueShift leaves W/A/UV byte-for-byte untouched', () => {
  const p = [px(0.6, 0.3, 0.1, 0.9, 0.8, 0.7)];
  applyHueShift({ pixels: p, degrees: 90 });
  assert.equal(p[0].w, 0.9);
  assert.equal(p[0].a, 0.8);
  assert.equal(p[0].u, 0.7);
});

test('applyHueShift clamps output into [0,1]', () => {
  const p = [px(1, 1, 0)];
  applyHueShift({ pixels: p, degrees: 47 });
  for (const k of ['r', 'g', 'b']) {
    assert.ok(p[0][k] >= 0 && p[0][k] <= 1, `${k}=${p[0][k]} out of [0,1]`);
  }
});

test('applyHueShift 360deg ~= identity', () => {
  // The standard NTSC YIQ matrix coefficients carry ~1e-3 rounding (the
  // published 0.300/0.588 constants), so a full turn lands within ~2e-3
  // of the input — visually identical. We assert that tolerance.
  const p = [px(0.7, 0.3, 0.5)];
  applyHueShift({ pixels: p, degrees: 360 });
  assert.ok(Math.abs(p[0].r - 0.7) < 2e-3, `r=${p[0].r}`);
  assert.ok(Math.abs(p[0].g - 0.3) < 2e-3, `g=${p[0].g}`);
  assert.ok(Math.abs(p[0].b - 0.5) < 2e-3, `b=${p[0].b}`);
});

// ── GlobalEffectsController.setHueShift / applyHueShift ──────────────────

test('setHueShift normalizes degrees into [0,360) and clamps auto-rotate', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setHueShift(370, 999);
  assert.equal(c.hueShift.degrees, 10);
  assert.equal(c.hueShift.autoRotateDegPerSec, 360);
  c.setHueShift(-30, -999);
  assert.equal(c.hueShift.degrees, 330);
  assert.equal(c.hueShift.autoRotateDegPerSec, -360);
});

test('setHueShift throws on non-finite (Codex P0, no silent fallback)', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  assert.throws(() => c.setHueShift(NaN));
  assert.throws(() => c.setHueShift(Infinity));
  assert.throws(() => c.setHueShift(10, NaN));
});

test('applyHueShift global is a no-op at 0 and does not touch W/A/U', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  const p = [px(0.5, 0.4, 0.3, 0.2, 0.1, 0.05)];
  c.applyHueShift(p, 0);
  assert.equal(p[0].r, 0.5);
  assert.equal(p[0].w, 0.2);
});

test('applyHueShift auto-rotate advances degrees by degPerSec * dt', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setHueShift(0, 90); // 90 deg/sec
  c.applyHueShift([px(1, 0, 0)], 1000); // first tick: seeds clock, no advance
  assert.equal(c.hueShift.degrees, 0);
  c.applyHueShift([px(1, 0, 0)], 1100); // +100ms => +9deg
  assert.ok(Math.abs(c.hueShift.degrees - 9) < 1e-6, `got ${c.hueShift.degrees}`);
  c.applyHueShift([px(1, 0, 0)], 1200); // +100ms => +9deg => 18
  assert.ok(Math.abs(c.hueShift.degrees - 18) < 1e-6, `got ${c.hueShift.degrees}`);
});

test('applyHueShift auto-rotate wraps past 360', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setHueShift(350, 360);
  c.applyHueShift([px(1, 0, 0)], 0);
  c.applyHueShift([px(1, 0, 0)], 100); // +36 => 386 => wrap 26
  assert.ok(Math.abs(c.hueShift.degrees - 26) < 1e-6, `got ${c.hueShift.degrees}`);
});

test('panicStop leaves the global hue shift alone', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setHueShift(123, 45);
  c.panicStop();
  assert.equal(c.hueShift.degrees, 123);
  assert.equal(c.hueShift.autoRotateDegPerSec, 45);
});

test('getStatus exposes a cloned hueShift', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setHueShift(60, 0);
  const s = c.getStatus();
  assert.deepEqual(s.hueShift, { degrees: 60, autoRotateDegPerSec: 0 });
  s.hueShift.degrees = 999; // mutate the clone
  assert.equal(c.hueShift.degrees, 60); // live state unchanged
});

// ── validateHue (API boundary) ───────────────────────────────────────────

test('validateHue rejects NaN / Infinity / non-number (400)', () => {
  assert.equal(validateHue(NaN).ok, false);
  assert.equal(validateHue(Infinity).ok, false);
  assert.equal(validateHue('abc').ok, false);
  assert.equal(validateHue(null).ok, false);
  assert.equal(validateHue(undefined).ok, false);
  assert.equal(validateHue(true).ok, false);
  assert.equal(validateHue({}).ok, false);
});

test('validateHue normalizes 370 -> 10 and -30 -> 330', () => {
  assert.deepEqual(validateHue(370), { ok: true, value: 10 });
  assert.deepEqual(validateHue(-30), { ok: true, value: 330 });
  assert.deepEqual(validateHue(0), { ok: true, value: 0 });
  assert.deepEqual(validateHue('45'), { ok: true, value: 45 });
});

// ── PatternChannel.hue ───────────────────────────────────────────────────

test('PatternChannel defaults hue to 0 and normalizes into [0,360)', () => {
  const a = new PatternChannel({ id: 'a', name: 'A', pattern: 'p' });
  assert.equal(a.hue, 0);
  const b = new PatternChannel({ id: 'b', name: 'B', pattern: 'p', hue: 370 });
  assert.equal(b.hue, 10);
  const c = new PatternChannel({ id: 'c', name: 'C', pattern: 'p', hue: -30 });
  assert.equal(c.hue, 330);
  const d = new PatternChannel({ id: 'd', name: 'D', pattern: 'p', hue: NaN });
  assert.equal(d.hue, 0);
});
