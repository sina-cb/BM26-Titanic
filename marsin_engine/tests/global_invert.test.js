/**
 * Unit tests for the GLOBAL color Invert (docs/39 §F-invert).
 *
 * The per-channel invert feature was REMOVED in the channels-optimization
 * campaign and replaced by this single GLOBAL toggle.
 *
 * Contract:
 *   - effects/invert.js applyInvert({pixels, enabled}) inverts the RGB triad
 *     (1 - v) of model.pixels (floats 0..1) in place; W / A / UV are NEVER
 *     touched (mission-critical exterior whites must not be flipped dark).
 *   - enabled=false is a no-op (gated zero-cost).
 *   - GlobalEffectsController.setInvert coerces via !!; applyInvert delegates
 *     to the effect and is gated (no-op when off); getStatus reflects it;
 *     panicStop leaves it alone (like the group color-locks).
 *   - Serialize round-trip via globalsState.invert; a missing field defaults
 *     to false.
 *
 * (The old "pipeline order: global HUE then global INVERT" test was removed
 * with the global hue shifter — 2026-07, hue is per-channel only.)
 *
 * Run: node --test marsin_engine/tests/global_invert.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { applyInvert } from '../effects/invert.js';
import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { StateManager } from '../lib/state_manager.js';

function px(r, g, b, w = 0.2, a = 0.1, u = 0.05) {
  return { r, g, b, w, a, u };
}

// ── effects/invert.js (float, post-composite) ────────────────────────────

test('applyInvert flips RGB to 1-v and leaves W/A/U untouched', () => {
  const p = [px(1, 0, 0.25, 0.9, 0.8, 0.7)];
  applyInvert({ pixels: p, enabled: true });
  assert.ok(Math.abs(p[0].r - 0) < 1e-9);
  assert.ok(Math.abs(p[0].g - 1) < 1e-9);
  assert.ok(Math.abs(p[0].b - 0.75) < 1e-9);
  // W/A/U untouched (mission-critical whites safe).
  assert.equal(p[0].w, 0.9);
  assert.equal(p[0].a, 0.8);
  assert.equal(p[0].u, 0.7);
});

test('applyInvert is its own inverse (double-invert = identity)', () => {
  const p = [px(0.3, 0.6, 0.45)];
  applyInvert({ pixels: p, enabled: true });
  applyInvert({ pixels: p, enabled: true });
  assert.ok(Math.abs(p[0].r - 0.3) < 1e-9);
  assert.ok(Math.abs(p[0].g - 0.6) < 1e-9);
  assert.ok(Math.abs(p[0].b - 0.45) < 1e-9);
});

test('applyInvert disabled is a no-op (gated zero-cost)', () => {
  const p = [px(0.3, 0.6, 0.45, 0.9, 0.8, 0.7)];
  applyInvert({ pixels: p, enabled: false });
  assert.equal(p[0].r, 0.3);
  assert.equal(p[0].g, 0.6);
  assert.equal(p[0].b, 0.45);
  assert.equal(p[0].w, 0.9);
});

test('applyInvert throws on a missing pixels array (Codex P0, fail loud)', () => {
  assert.throws(() => applyInvert({ enabled: true }));
});

// ── GlobalEffectsController.setInvert / applyInvert ──────────────────────

test('invert defaults to false', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  assert.equal(c.invert, false);
});

test('setInvert coerces via !!', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setInvert(true);
  assert.equal(c.invert, true);
  c.setInvert(0);
  assert.equal(c.invert, false);
  c.setInvert('yes');
  assert.equal(c.invert, true);
  c.setInvert(null);
  assert.equal(c.invert, false);
});

test('applyInvert (controller) is a no-op when off and does not touch W/A/U', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  const p = [px(0.5, 0.4, 0.3, 0.2, 0.1, 0.05)];
  c.applyInvert(p);
  assert.equal(p[0].r, 0.5);
  assert.equal(p[0].w, 0.2);
});

test('applyInvert (controller) flips RGB when enabled, W/A/U untouched', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setInvert(true);
  const p = [px(0.5, 0.4, 0.3, 0.2, 0.1, 0.05)];
  c.applyInvert(p);
  assert.ok(Math.abs(p[0].r - 0.5) < 1e-9);
  assert.ok(Math.abs(p[0].g - 0.6) < 1e-9);
  assert.ok(Math.abs(p[0].b - 0.7) < 1e-9);
  assert.equal(p[0].w, 0.2);
  assert.equal(p[0].a, 0.1);
  assert.equal(p[0].u, 0.05);
});

test('panicStop leaves the global invert alone', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setInvert(true);
  c.panicStop();
  assert.equal(c.invert, true);
});

test('getStatus reflects the invert toggle', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  assert.equal(c.getStatus().invert, false);
  c.setInvert(true);
  assert.equal(c.getStatus().invert, true);
});

// ── Serialize round-trip via globalsState ────────────────────────────────

test('global invert round-trips through globalsState save/load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global_invert_'));
  const sm = new StateManager(dir);
  sm.saveGlobalsState({ blackout: false, effects: {}, params: {}, dimmers: {}, invert: true }, null);
  const loaded = sm.loadGlobalsState();
  assert.equal(loaded.invert, true);
});

test('a globals file with no invert key defaults to false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global_invert_'));
  const sm = new StateManager(dir);
  // No file written ⇒ loadGlobalsState returns its documented default.
  const loaded = sm.loadGlobalsState();
  assert.equal(loaded.invert, false);
});

test('applyGlobalsState restores invert through the controller', () => {
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global_invert_'));
  const sm = new StateManager(dir);
  sm.applyGlobalsState({ invert: true }, null, null, c);
  assert.equal(c.invert, true);
});

// (The "pipeline order: global hue THEN global invert" test was removed
// along with the global hue shifter — 2026-07, hue is per-channel only.
// Invert is now the only global chroma stage before group color-locks.)
