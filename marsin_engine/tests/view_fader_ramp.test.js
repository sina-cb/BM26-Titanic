// Unit tests for the deck↔mixer viewFader ramp interpolation (item E).
// The ramp lives inside PatternMixer.renderAll6ch(): each frame it steps
// `viewFader` toward `targetViewFader` at `viewFaderRampPerSec`, time-based
// (dt from Date.now()) and frame-rate independent, with dt clamped so a
// stall can't fast-forward the fade. These tests drive it with no channels
// (so no WASM is needed) and simulate elapsed time by rewinding the mixer's
// internal last-tick timestamp.
//
// Run:  node --test tests/view_fader_ramp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';

const wasmHostStub = { destroy() {} };

function makeMixer() {
  // No deck / mixer channels → renderAll6ch touches no WASM.
  const m = new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 4 });
  m.wantVisThisFrame = false; // keep _visData out of it for these tests
  return m;
}

// Advance the ramp by `seconds` of simulated time. The ramp reads Date.now()
// and diffs against _lastViewFaderTickMs; we set the last tick into the past
// so the next render sees `seconds` of elapsed time.
function tickSeconds(mixer, seconds) {
  mixer._lastViewFaderTickMs = Date.now() - seconds * 1000;
  mixer.renderAll6ch();
}

// NOTE: the ramp clamps dt to a 0.25s max per frame (a GC stall must not
// fast-forward the fade), so each render advances at most rate*0.25.
test('viewFader ramps DOWN toward target at the configured rate', () => {
  const m = makeMixer();
  m.viewFader = 1.0;
  m.targetViewFader = 0.0;
  m.viewFaderRampPerSec = 1.0; // full sweep in 1s
  // Prime the tick clock with a first render (delta ~0, no movement).
  m.renderAll6ch();
  // 0.2s elapsed (< dt clamp) → should move ~0.2 toward 0.
  tickSeconds(m, 0.2);
  assert.ok(Math.abs(m.viewFader - 0.8) < 1e-6, `expected ~0.8, got ${m.viewFader}`);
  // Another 0.2s → ~0.6.
  tickSeconds(m, 0.2);
  assert.ok(Math.abs(m.viewFader - 0.6) < 1e-6, `expected ~0.6, got ${m.viewFader}`);
});

test('viewFader ramps UP toward target and never overshoots', () => {
  const m = makeMixer();
  m.viewFader = 0.9;
  m.targetViewFader = 1.0;
  m.viewFaderRampPerSec = 2.0; // 0.2s elapsed × 2/s = +0.4, but target is 0.1 away
  m.renderAll6ch();
  // A single step would add 0.4 — must clamp exactly at the target (1.0).
  tickSeconds(m, 0.2);
  assert.equal(m.viewFader, 1.0, 'must clamp at target, not overshoot past 1');
});

test('viewFader holds steady once it reaches the target', () => {
  const m = makeMixer();
  m.viewFader = 0.5;
  m.targetViewFader = 0.5;
  m.viewFaderRampPerSec = 1.0;
  m.renderAll6ch();
  tickSeconds(m, 1.0);
  assert.equal(m.viewFader, 0.5, 'no movement when already at target');
});

test('a long frame stall is clamped (dt capped at 0.25s) — no fast-forward', () => {
  const m = makeMixer();
  m.viewFader = 1.0;
  m.targetViewFader = 0.0;
  m.viewFaderRampPerSec = 1.0;
  m.renderAll6ch();
  // Simulate a 5s GC pause. dt is clamped to 0.25s, so the fader should
  // move at most 0.25, NOT jump to (or past) the target.
  tickSeconds(m, 5.0);
  assert.ok(Math.abs(m.viewFader - 0.75) < 1e-6,
    `expected dt-clamped ~0.75, got ${m.viewFader}`);
});
