// Unit tests for the global color-transition ramp (docs/35).
//
// Run:  cd marsin_engine && node --test tests/color_transition.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ParamCenter } from '../lib/param_center.js';

function tmpStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colortrans_test_'));
  return path.join(dir, 'state.yaml');
}

// Fake wasmHost that records the last HSV injected per control id.
function fakeHost() {
  const last = {};
  return {
    last,
    setControl(_handle, id, a, b, c) { last[id] = { h: a, s: b, v: c }; },
  };
}

// Register one channel exporting colorPalette1 (id 11) + colorPalette2 (id 12).
function registerColors(pc) {
  pc.registerChannel('deck', { __h: true }, [
    { id: 11, name: 'colorPalette1' },
    { id: 12, name: 'colorPalette2' },
  ]);
}

test('colorTransitionMs registered, persistent, default 800, range [0,10000]', () => {
  const pc = new ParamCenter(tmpStatePath());
  const e = pc.getSchema().find(s => s.key === 'colorTransitionMs');
  assert.ok(e, 'colorTransitionMs present in schema');
  assert.equal(e.persist, true);
  assert.equal(e.default, 800);
  assert.deepEqual(e.range, [0, 10000]);
});

test('colorPalette1/2 are flagged slew in the schema-backing registry', () => {
  const pc = new ParamCenter(tmpStatePath());
  // _slewKeys is the runtime projection of `slew: true` entries.
  assert.deepEqual(pc._slewKeys.sort(), ['colorPalette1', 'colorPalette2']);
});

test('transitionMs=0 snaps to target on the first tick', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerColors(pc);
  pc.set('colorTransitionMs', 0, 'api');
  pc.set('colorPalette1', { h: 0.25, s: 1, v: 1 }, 'api');
  const host = fakeHost();
  pc.tickColorTransitions(1000);
  pc.flushDirty(host);
  assert.equal(host.last[11].h, 0.25, 'snaps straight to target hue');
});

test('mid-ramp injects an eased interpolant, not the target', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerColors(pc);
  pc.set('colorTransitionMs', 1000, 'api');
  // Settle rendered at h=0 first.
  pc.set('colorPalette1', { h: 0.0, s: 1, v: 1 }, 'api');
  pc.tickColorTransitions(0);
  pc.applySnapshot(fakeHost()); // force settle to target h=0
  // New target h=0.5; ramp over 1000ms. Halfway in time.
  pc.set('colorPalette1', { h: 0.5, s: 1, v: 1 }, 'api');
  const host = fakeHost();
  pc.tickColorTransitions(0);      // t=0 start
  pc.tickColorTransitions(500);    // t=0.5
  pc.flushDirty(host);
  const h = host.last[11].h;
  assert.ok(h > 0.0 && h < 0.5, `mid-ramp hue ${h} strictly between endpoints`);
  // smoothstep(0.5) = 0.5, so hue ≈ 0.25 at the time-midpoint.
  assert.ok(Math.abs(h - 0.25) < 1e-6, `eased hue ${h} ≈ 0.25`);
});

test('ramp completes and stops dirtying after the duration', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerColors(pc);
  pc.set('colorTransitionMs', 1000, 'api');
  pc.set('colorPalette1', { h: 0.5, s: 1, v: 1 }, 'api');
  pc.tickColorTransitions(0);
  pc.tickColorTransitions(1000); // t=1 → complete
  // After completion the ramp is cleared; another tick must not re-dirty.
  pc._store.colorPalette1.dirty = false;
  pc.tickColorTransitions(2000);
  assert.equal(pc._store.colorPalette1.dirty, false, 'settled ramp does not re-dirty');
  assert.equal(pc._rendered.colorPalette1.h, 0.5, 'rendered settled at target');
});

test('hue ramp takes the shortest arc across the 0/1 wrap', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerColors(pc);
  pc.set('colorTransitionMs', 1000, 'api');
  // Settle at h=0.95.
  pc.set('colorPalette1', { h: 0.95, s: 1, v: 1 }, 'api');
  pc.applySnapshot(fakeHost());
  // Target h=0.05 — short way crosses 1.0/0.0, so the interpolant should
  // be just below 1 or just above 0, never down near 0.5.
  pc.set('colorPalette1', { h: 0.05, s: 1, v: 1 }, 'api');
  const host = fakeHost();
  pc.tickColorTransitions(0);
  pc.tickColorTransitions(500); // halfway → expected ~0.0 (wrap midpoint)
  pc.flushDirty(host);
  const h = host.last[11].h;
  assert.ok(h > 0.9 || h < 0.1, `wrap-midpoint hue ${h} stayed near the seam, not ~0.5`);
});

test('pattern swap (applySnapshot) snaps rendered to target — no fade across swaps', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerColors(pc);
  pc.set('colorTransitionMs', 5000, 'api');
  pc.set('colorPalette1', { h: 0.8, s: 1, v: 1 }, 'api');
  const host = fakeHost();
  pc.applySnapshot(host); // simulates onPatternCompiled
  assert.equal(host.last[11].h, 0.8, 'snapshot injects the target immediately');
  assert.equal(pc._rampFrom.colorPalette1, null, 'ramp cancelled on swap');
});

test('boot restore seeds rendered from persisted value (no fade-up on boot)', () => {
  const p = tmpStatePath();
  fs.writeFileSync(p, 'colorPalette1: { h: 0.42, s: 1, v: 1 }\n');
  const pc = new ParamCenter(p);
  registerColors(pc);
  const host = fakeHost();
  pc.applySnapshot(host);
  assert.equal(host.last[11].h, 0.42, 'rendered seeded at persisted hue, not default');
  assert.equal(pc._rampFrom.colorPalette1, null, 'no active ramp at boot');
});
