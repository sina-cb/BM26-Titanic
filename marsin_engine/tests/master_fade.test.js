// Unit tests for the grand-master timed fade (F-B). The fade lives in
// PatternMixer: startMasterFade(target, durationMs) arms it, _tickMasterFade()
// (called every frame from renderAll6ch) advances `master` toward the target
// over wall-clock time, frame-rate independent, landing EXACTLY on the target.
// A direct setMaster() cancels any in-flight fade.
//
// These tests drive a no-channel mixer (renderAll6ch touches no WASM) and
// simulate elapsed time by rewinding the fade's internal startMs.
//
// Run:  node --test tests/master_fade.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';

const wasmHostStub = { destroy() {} };

function makeMixer() {
  const m = new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 4 });
  m.wantVisThisFrame = false;
  return m;
}

// Push the fade's start time `seconds` into the past, then tick one frame.
function tickSeconds(mixer, seconds) {
  if (mixer._masterFade) mixer._masterFade.startMs = Date.now() - seconds * 1000;
  mixer.renderAll6ch();
}

// Mid-ramp linear checks compare a WALL-CLOCK-derived value against an exact
// fraction. `_tickMasterFade()` re-reads Date.now() a few ms after tickSeconds()
// stamped startMs, so the real elapsed is always slightly past the target —
// under parallel test load that drift can reach tens of ms. A 1e-6 tolerance is
// therefore unwinnable (flaky); 0.05 (≤50ms over a 1s fade) still proves the
// ramp is roughly linear and not broken. Exact-landing/clamp checks stay exact.
const RAMP_TOL = 0.05;

test('startMasterFade ramps master toward the target over the duration', () => {
  const m = makeMixer();
  m.master = 1.0;
  m.startMasterFade(0.0, 1000); // full blackout over 1s
  // 0.25s elapsed → linear ~0.75.
  tickSeconds(m, 0.25);
  assert.ok(Math.abs(m.master - 0.75) < RAMP_TOL, `expected ~0.75, got ${m.master}`);
  // 0.5s elapsed → ~0.5.
  tickSeconds(m, 0.5);
  assert.ok(Math.abs(m.master - 0.5) < RAMP_TOL, `expected ~0.5, got ${m.master}`);
});

test('master fade lands EXACTLY on the target and clears the descriptor', () => {
  const m = makeMixer();
  m.master = 1.0;
  m.startMasterFade(0.0, 1000);
  tickSeconds(m, 1.0); // elapsed >= duration
  assert.equal(m.master, 0.0, 'master lands exactly on target');
  assert.equal(m.getMasterFade(), null, 'fade descriptor cleared once complete');
});

test('master fade can ramp UP (restore from blackout)', () => {
  const m = makeMixer();
  m.master = 0.0;
  m.startMasterFade(1.0, 2000);
  tickSeconds(m, 1.0); // halfway
  assert.ok(Math.abs(m.master - 0.5) < RAMP_TOL, `expected ~0.5, got ${m.master}`);
  tickSeconds(m, 2.0); // past end
  assert.equal(m.master, 1.0);
});

test('getMasterFade reports an in-flight fade and null when steady', () => {
  const m = makeMixer();
  assert.equal(m.getMasterFade(), null, 'no fade at rest');
  m.master = 1.0;
  m.startMasterFade(0.0, 1000);
  const snap = m.getMasterFade();
  assert.equal(snap.active, true);
  assert.equal(snap.from, 1.0);
  assert.equal(snap.to, 0.0);
  assert.equal(snap.durationMs, 1000);
});

test('a direct setMaster cancels an in-flight fade (operator hand wins)', () => {
  const m = makeMixer();
  m.master = 1.0;
  m.startMasterFade(0.0, 5000);
  assert.ok(m.getMasterFade(), 'fade armed');
  m.setMaster(0.6);
  assert.equal(m.getMasterFade(), null, 'setMaster cancels the fade');
  assert.equal(m.master, 0.6);
  // A subsequent tick must NOT resume the cancelled fade.
  m.renderAll6ch();
  assert.equal(m.master, 0.6);
});

test('startMasterFade rejects a non-finite / out-of-range target', () => {
  const m = makeMixer();
  assert.throws(() => m.startMasterFade(NaN, 1000), /target/);
  assert.throws(() => m.startMasterFade(Infinity, 1000), /target/);
  assert.throws(() => m.startMasterFade(1.5, 1000), /target/);
  assert.throws(() => m.startMasterFade(-0.1, 1000), /target/);
});

test('startMasterFade rejects a non-finite / non-positive durationMs', () => {
  const m = makeMixer();
  assert.throws(() => m.startMasterFade(0.0, 0), /durationMs/);
  assert.throws(() => m.startMasterFade(0.0, -100), /durationMs/);
  assert.throws(() => m.startMasterFade(0.0, NaN), /durationMs/);
});

test('a long frame stall does not overshoot the target', () => {
  const m = makeMixer();
  m.master = 1.0;
  m.startMasterFade(0.0, 1000);
  // Simulate a 10s stall — past the duration. Master clamps at the target,
  // never below it (wall-clock interpolation completes, then clears).
  tickSeconds(m, 10.0);
  assert.equal(m.master, 0.0);
});
