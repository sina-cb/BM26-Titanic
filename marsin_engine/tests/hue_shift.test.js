/**
 * Unit tests for the Hue Shifter (PER-CHANNEL ONLY) — docs/39 §F-hue.
 *
 * Contract (2026-07, operator decision — the GLOBAL post-mixer hue
 * shifter was REMOVED end to end; hue is per-channel only):
 *   - The float rotation (effects/hue_shift.js, kept as the reference
 *     implementation for pattern_mixer's applyHueShift6chU8) rotates RGB
 *     ONLY via a luminance-preserving YIQ rotation. W / A / UV are NEVER
 *     touched (mission-critical exterior whites must not be tinted/dimmed).
 *   - No-op at hue=0 (zero cost gate).
 *   - validateHue rejects non-finite (400) and normalizes any finite
 *     angle into [0,360).
 *   - Per-channel hue normalizes through the PatternChannel ctor.
 *   - REMOVAL contract: GlobalEffectsController carries NO global hue
 *     state/methods, getStatus has no hueShift, and a persisted legacy
 *     globals_state.yaml hueShift key is DISCARDED at load (never
 *     silently re-applied).
 *
 * Run: node --test marsin_engine/tests/hue_shift.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyHueShift } from '../effects/hue_shift.js';
import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { PatternChannel } from '../lib/pattern_channel.js';
import { StateManager } from '../lib/state_manager.js';
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

// ── REMOVAL contract: no global hue shifter anywhere ─────────────────────

test('GlobalEffectsController carries NO global hue state or methods', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  assert.equal(c.hueShift, undefined, 'hueShift state must not exist');
  assert.equal(typeof c.setHueShift, 'undefined', 'setHueShift must not exist');
  assert.equal(typeof c.applyHueShift, 'undefined', 'applyHueShift must not exist');
});

test('getStatus exposes NO hueShift key', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  const s = c.getStatus();
  assert.ok(!('hueShift' in s), 'getStatus must not carry hueShift');
});

test('loadGlobalsState DISCARDS a persisted legacy hueShift (with a log line)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hue_migration_'));
  const sm = new StateManager(dir);
  fs.writeFileSync(path.join(dir, 'globals_state.yaml'), [
    'blackout: false',
    'effects: {}',
    'params: {}',
    'dimmers: {}',
    'hueShift:',
    '  degrees: 131.5',
    '  autoRotateDegPerSec: 20',
    'invert: false',
    '',
  ].join('\n'));
  const loaded = sm.loadGlobalsState();
  assert.ok(!('hueShift' in loaded), 'legacy hueShift must be dropped on load');
  // Everything else survives the migration untouched.
  assert.equal(loaded.blackout, false);
  assert.equal(loaded.invert, false);
});

test('loadGlobalsState default carries no hueShift key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hue_migration_'));
  const sm = new StateManager(dir);
  const loaded = sm.loadGlobalsState(); // no file → documented defaults
  assert.ok(!('hueShift' in loaded));
});

test('applyGlobalsState never re-applies a hueShift (defence in depth)', () => {
  // Even if a caller hand-feeds a globalsState still carrying the legacy
  // key (bypassing loadGlobalsState), applyGlobalsState must ignore it —
  // there is no controller surface left to apply it to.
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hue_migration_'));
  const sm = new StateManager(dir);
  sm.applyGlobalsState({ hueShift: { degrees: 90, autoRotateDegPerSec: 5 } }, null, null, c);
  assert.equal(c.hueShift, undefined, 'controller must stay hue-free');
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
