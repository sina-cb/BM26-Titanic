// Unit tests for the per-channel phase-clock cluster (docs/39 §F-phase):
//   #3  per-channel SPEED
//   #4  TAP-TEMPO (global, opt-in via followsTempo)
//   #11 CHASE / phase-offset
//
// The key invariant: the VM consumes ABSOLUTE per-handle time, so a speed
// change must NEVER jump the phase — the per-channel accumulator stays
// continuous; only the future rate changes. These tests pin that, the
// offset/tempo/clamp behavior, the validators, the serialize round-trip
// (and that the transient _phaseSeconds is NEVER serialized), and
// orthogonality with the fader-transition path.
//
// Run:  cd marsin_engine && node --test tests/phase_clock.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../lib/pattern_channel.js';
import { PatternMixer } from '../lib/pattern_mixer.js';
import { serializeChannel } from '../lib/state_manager.js';
import { validateSpeed, validatePhaseOffsetMs } from '../lib/api_server.js';

// A fake wasm host that records the absolute phase each beginFrame got.
function fakeHost() {
  const calls = [];
  return {
    calls,
    beginFrame(handle, phase) { calls.push({ handle, phase }); },
  };
}

function ch(extra = {}) {
  return new PatternChannel({ id: 'c1', name: 'C', pattern: 'p', handle: 1, ...extra });
}

// ── Constructor defaults ──────────────────────────────────────────────
test('phase-clock fields default to 1.0 / 0 / false', () => {
  const c = ch();
  assert.equal(c.speed, 1.0);
  assert.equal(c.phaseOffsetMs, 0);
  assert.equal(c.followsTempo, false);
});

test('speed clamps to [0.05,8]; 0/negative floored to 0.05', () => {
  assert.equal(ch({ speed: 0 }).speed, 0.05);
  assert.equal(ch({ speed: -3 }).speed, 0.05);
  assert.equal(ch({ speed: 100 }).speed, 8);
  assert.equal(ch({ speed: 2.5 }).speed, 2.5);
  assert.equal(ch({ speed: NaN }).speed, 1.0);
  assert.equal(ch({ speed: 'oops' }).speed, 1.0);
});

test('phaseOffsetMs clamps to ±10000', () => {
  assert.equal(ch({ phaseOffsetMs: 50000 }).phaseOffsetMs, 10000);
  assert.equal(ch({ phaseOffsetMs: -50000 }).phaseOffsetMs, -10000);
  assert.equal(ch({ phaseOffsetMs: 250 }).phaseOffsetMs, 250);
  assert.equal(ch({ phaseOffsetMs: NaN }).phaseOffsetMs, 0);
});

test('transient accumulator starts at 0 / null', () => {
  const c = ch();
  assert.equal(c._phaseSeconds, 0);
  assert.equal(c._lastPhaseElapsed, null);
});

// ── Accumulation ──────────────────────────────────────────────────────
test('phase accumulates monotonically at 1x from the global elapsed', () => {
  const c = ch();
  const h = fakeHost();
  c.beginFrame(h, 0.0, true, 1);    // first frame: dt=0
  c.beginFrame(h, 0.1, true, 1);    // +0.1
  c.beginFrame(h, 0.2, true, 1);    // +0.1
  assert.equal(h.calls.length, 3);
  assert.ok(Math.abs(h.calls[0].phase - 0.0) < 1e-9);
  assert.ok(Math.abs(h.calls[1].phase - 0.1) < 1e-9);
  assert.ok(Math.abs(h.calls[2].phase - 0.2) < 1e-9);
});

test('first frame contributes dt=0 (no cold-accumulator jump)', () => {
  const c = ch({ speed: 4 });
  const h = fakeHost();
  c.beginFrame(h, 5.0, true, 4);    // elapsed jumps in at 5.0 — still dt=0
  assert.ok(Math.abs(h.calls[0].phase - 0.0) < 1e-9);
});

test('speed change does NOT jump phase — only the future rate changes', () => {
  // Accumulate at 1x to 0.2s, then switch to 4x. The phase at 0.3 global
  // must equal phase@0.2 + (0.3-0.2)*4 = 0.2 + 0.4 = 0.6. Continuous.
  const c = ch();
  const h = fakeHost();
  c.beginFrame(h, 0.0, true, 1);
  c.beginFrame(h, 0.1, true, 1);
  c.beginFrame(h, 0.2, true, 1);    // phase = 0.2
  const before = c._phaseSeconds;
  assert.ok(Math.abs(before - 0.2) < 1e-9);
  c.speed = 4;
  c.beginFrame(h, 0.3, true, 4);    // +0.1*4 = +0.4 → 0.6
  const after = h.calls[h.calls.length - 1].phase;
  assert.ok(Math.abs(after - (before + 0.1 * 4)) < 1e-9, `expected 0.6, got ${after}`);
  // It did NOT reset / jump backwards.
  assert.ok(after > before);
});

test('negative global dt is floored to 0 (no phase rewind)', () => {
  const c = ch();
  const h = fakeHost();
  c.beginFrame(h, 1.0, true, 1);
  c.beginFrame(h, 0.5, true, 1);   // backwards — dt clamped to 0
  assert.ok(Math.abs(c._phaseSeconds - 0) < 1e-9);
});

test('phaseOffsetMs is a constant added to the emitted phase', () => {
  const a = ch({ phaseOffsetMs: 0 });
  const b = ch({ phaseOffsetMs: 500 });
  const ha = fakeHost(); const hb = fakeHost();
  for (const t of [0, 0.1, 0.2, 0.3]) {
    a.beginFrame(ha, t, true, 1);
    b.beginFrame(hb, t, true, 1);
  }
  // At every frame, b's emitted phase = a's emitted phase + 0.5 (constant).
  for (let i = 0; i < ha.calls.length; i++) {
    const diff = hb.calls[i].phase - ha.calls[i].phase;
    assert.ok(Math.abs(diff - 0.5) < 1e-9, `offset diff at ${i} = ${diff}`);
  }
});

// ── Mixer: effective speed + tap-tempo ────────────────────────────────
function fakeMixer() {
  // Construct a PatternMixer without a real wasm host — we only exercise
  // _effectiveSpeed / setTempoBpm, which don't touch the host.
  return new PatternMixer({ wasmHost: fakeHost(), pixelCount: 4, maxChannels: 8 });
}

test('mixer tempo defaults: tempoBpm null, multiplier 1', () => {
  const m = fakeMixer();
  assert.equal(m.tempoBpm, null);
  assert.equal(m._tempoMultiplier, 1);
});

test('setTempoBpm(60) → 0.5x (120 BPM = 1x)', () => {
  const m = fakeMixer();
  m.setTempoBpm(60);
  assert.equal(m.tempoBpm, 60);
  assert.ok(Math.abs(m._tempoMultiplier - 0.5) < 1e-9);
});

test('tempo affects ONLY followsTempo channels', () => {
  const m = fakeMixer();
  m.setTempoBpm(60);
  const follower = ch({ speed: 1, followsTempo: true });
  const fixed = ch({ speed: 1, followsTempo: false });
  assert.ok(Math.abs(m._effectiveSpeed(follower) - 0.5) < 1e-9);
  assert.ok(Math.abs(m._effectiveSpeed(fixed) - 1.0) < 1e-9);
});

test('effective speed = speed * tempoMult, clamped to 8', () => {
  const m = fakeMixer();
  m.setTempoBpm(400);                 // 400/120 = 3.333x
  const c = ch({ speed: 6, followsTempo: true }); // 6*3.333 = 20 → clamp 8
  assert.equal(m._effectiveSpeed(c), 8);
});

test('setTempoBpm clamps the derived multiplier into [0.05,8]', () => {
  const m = fakeMixer();
  m.setTempoBpm(20);                  // 20/120 = 0.1667
  assert.ok(Math.abs(m._tempoMultiplier - 20 / 120) < 1e-9);
  m.setTempoBpm(400);                 // 3.333 (within window)
  assert.ok(Math.abs(m._tempoMultiplier - 400 / 120) < 1e-9);
});

test('setTempoBpm rejects non-finite (defensive, codex P0)', () => {
  const m = fakeMixer();
  assert.throws(() => m.setTempoBpm(NaN));
  assert.throws(() => m.setTempoBpm('fast'));
});

// ── Validators (API boundary) ─────────────────────────────────────────
test('validateSpeed rejects non-finite (→400), clamps finite', () => {
  assert.equal(validateSpeed(NaN).ok, false);
  assert.equal(validateSpeed(Infinity).ok, false);
  assert.equal(validateSpeed(null).ok, false);
  assert.equal(validateSpeed(true).ok, false);
  assert.equal(validateSpeed('').ok, false);
  assert.equal(validateSpeed(0).value, 0.05);
  assert.equal(validateSpeed(-5).value, 0.05);
  assert.equal(validateSpeed(100).value, 8);
  assert.equal(validateSpeed(2).value, 2);
  assert.equal(validateSpeed('3.5').value, 3.5);
});

test('validatePhaseOffsetMs rejects non-finite (→400), clamps finite', () => {
  assert.equal(validatePhaseOffsetMs(NaN).ok, false);
  assert.equal(validatePhaseOffsetMs(null).ok, false);
  assert.equal(validatePhaseOffsetMs('').ok, false);
  assert.equal(validatePhaseOffsetMs(99999).value, 10000);
  assert.equal(validatePhaseOffsetMs(-99999).value, -10000);
  assert.equal(validatePhaseOffsetMs(250).value, 250);
  assert.equal(validatePhaseOffsetMs('-500').value, -500);
});

// ── Serialization round-trip ──────────────────────────────────────────
test('serializeChannel emits speed/phaseOffsetMs/followsTempo', () => {
  const c = ch({ speed: 2.5, phaseOffsetMs: 300, followsTempo: true });
  const s = serializeChannel(c);
  assert.equal(s.speed, 2.5);
  assert.equal(s.phaseOffsetMs, 300);
  assert.equal(s.followsTempo, true);
});

test('serializeChannel NEVER emits the transient _phaseSeconds / _lastPhaseElapsed', () => {
  const c = ch();
  const h = fakeHost();
  c.beginFrame(h, 0.5, true, 1); // dirty the accumulator
  c.beginFrame(h, 1.5, true, 1);
  assert.ok(c._phaseSeconds > 0);
  const s = serializeChannel(c);
  assert.equal('_phaseSeconds' in s, false);
  assert.equal('_lastPhaseElapsed' in s, false);
  assert.equal('phaseSeconds' in s, false);
});

test('missing fields restore to documented defaults (1.0 / 0 / false)', () => {
  // An old state file with no phase-clock keys.
  const old = { id: 'x', name: 'X', pattern: 'p' };
  const c = new PatternChannel(old);
  assert.equal(c.speed, 1.0);
  assert.equal(c.phaseOffsetMs, 0);
  assert.equal(c.followsTempo, false);
  // And a serialized old channel round-trips to the defaults too.
  const s = serializeChannel(c);
  assert.equal(s.speed, 1.0);
  assert.equal(s.phaseOffsetMs, 0);
  assert.equal(s.followsTempo, false);
});

test('serialize clamps out-of-range speed/offset (defensive)', () => {
  const c = ch();
  c.speed = 99;          // bypass ctor clamp to test serializer clamp
  c.phaseOffsetMs = 99999;
  const s = serializeChannel(c);
  assert.equal(s.speed, 8);
  assert.equal(s.phaseOffsetMs, 10000);
});

// ── Orthogonality ─────────────────────────────────────────────────────
test('a speed change does not touch fader/faderMax/hue (level/chroma orthogonal)', () => {
  const c = ch({ fader: 0.7, faderMax: 0.9, hue: 120 });
  c.speed = 4;
  c.beginFrame(fakeHost(), 0.1, true, 4);
  assert.equal(c.fader, 0.7);
  assert.equal(c.faderMax, 0.9);
  assert.equal(c.hue, 120);
});
