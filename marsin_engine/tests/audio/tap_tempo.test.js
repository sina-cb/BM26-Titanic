// Unit tests for the per-channel phase-clock TAP-TEMPO core (docs/39 §F-phase #4).
//
// The per-channel SPEED (#3) and CHASE/phaseOffsetMs (#11) features were
// REMOVED in the channels-optimization campaign; only the minimal tap-tempo
// core remains: the per-channel `_phaseSeconds` accumulator, the per-channel
// `followsTempo` opt-in, the global `_tempoMultiplier` / `setTempoBpm`, and
// `_effectiveSpeed(ch)` (which is now TEMPO-ONLY — a follower runs at the
// tempo multiplier, every other channel at 1×).
//
// The key invariant: the VM consumes ABSOLUTE per-handle time, so a tempo
// change must NEVER jump the phase — the per-channel accumulator stays
// continuous; only the future rate changes. These tests pin that, the
// tempo behavior/clamp, the serialize round-trip (and that the transient
// _phaseSeconds is NEVER serialized), and orthogonality with the fader path.
//
// Run:  cd marsin_engine && node --test tests/tap_tempo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../../lib/pattern_channel.js';
import { PatternMixer } from '../../lib/pattern_mixer.js';
import { serializeChannel } from '../../lib/state_manager.js';

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
test('followsTempo defaults to false', () => {
  assert.equal(ch().followsTempo, false);
});

test('followsTempo coerces via !!', () => {
  assert.equal(ch({ followsTempo: true }).followsTempo, true);
  assert.equal(ch({ followsTempo: 1 }).followsTempo, true);
  assert.equal(ch({ followsTempo: 0 }).followsTempo, false);
  assert.equal(ch({ followsTempo: 'yes' }).followsTempo, true);
});

test('the removed per-channel speed / phaseOffsetMs fields are gone', () => {
  const c = ch();
  assert.equal('speed' in c, false, 'per-channel speed must be removed');
  assert.equal('phaseOffsetMs' in c, false, 'phaseOffsetMs must be removed');
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
  const c = ch();
  const h = fakeHost();
  c.beginFrame(h, 5.0, true, 2);    // elapsed jumps in at 5.0 — still dt=0
  assert.ok(Math.abs(h.calls[0].phase - 0.0) < 1e-9);
});

test('tempo change does NOT jump phase — only the future rate changes', () => {
  // Accumulate at 1x to 0.2s, then a tap-tempo change bumps effectiveSpeed to
  // 4x. The phase at 0.3 global must equal phase@0.2 + (0.3-0.2)*4 = 0.6.
  // Continuous across the change (the accumulator is never re-scaled).
  const c = ch({ followsTempo: true });
  const h = fakeHost();
  c.beginFrame(h, 0.0, true, 1);
  c.beginFrame(h, 0.1, true, 1);
  c.beginFrame(h, 0.2, true, 1);    // phase = 0.2
  const before = c._phaseSeconds;
  assert.ok(Math.abs(before - 0.2) < 1e-9);
  c.beginFrame(h, 0.3, true, 4);    // tempo bumped effectiveSpeed to 4 → +0.4
  const after = h.calls[h.calls.length - 1].phase;
  assert.ok(Math.abs(after - (before + 0.1 * 4)) < 1e-9, `expected 0.6, got ${after}`);
  assert.ok(after > before); // did NOT reset / jump backwards
});

test('negative global dt is floored to 0 (no phase rewind)', () => {
  const c = ch();
  const h = fakeHost();
  c.beginFrame(h, 1.0, true, 1);
  c.beginFrame(h, 0.5, true, 1);   // backwards — dt clamped to 0
  assert.ok(Math.abs(c._phaseSeconds - 0) < 1e-9);
});

// ── Mixer: effective speed (tempo-only) + tap-tempo ───────────────────
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

test('effective speed is TEMPO-ONLY: follower=mult, non-follower=1x', () => {
  const m = fakeMixer();
  m.setTempoBpm(60);
  const follower = ch({ followsTempo: true });
  const fixed = ch({ followsTempo: false });
  assert.ok(Math.abs(m._effectiveSpeed(follower) - 0.5) < 1e-9);
  assert.ok(Math.abs(m._effectiveSpeed(fixed) - 1.0) < 1e-9);
});

test('effective speed clamps the tempo multiplier into [0.05,8]', () => {
  const m = fakeMixer();
  m.setTempoBpm(400);                 // 400/120 = 3.333x
  const c = ch({ followsTempo: true });
  assert.ok(Math.abs(m._effectiveSpeed(c) - 400 / 120) < 1e-9);
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

// ── Serialization round-trip ──────────────────────────────────────────
test('serializeChannel emits followsTempo (and NOT speed/phaseOffsetMs)', () => {
  const c = ch({ followsTempo: true });
  const s = serializeChannel(c);
  assert.equal(s.followsTempo, true);
  assert.equal('speed' in s, false);
  assert.equal('phaseOffsetMs' in s, false);
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

test('missing followsTempo restores to documented default (false)', () => {
  // An old state file with no phase-clock keys.
  const old = { id: 'x', name: 'X', pattern: 'p' };
  const c = new PatternChannel(old);
  assert.equal(c.followsTempo, false);
  const s = serializeChannel(c);
  assert.equal(s.followsTempo, false);
});

// ── Orthogonality ─────────────────────────────────────────────────────
test('a tempo-driven phase advance does not touch fader/faderMax/hue', () => {
  const c = ch({ fader: 0.7, faderMax: 0.9, hue: 120, followsTempo: true });
  c.beginFrame(fakeHost(), 0.1, true, 4);
  assert.equal(c.fader, 0.7);
  assert.equal(c.faderMax, 0.9);
  assert.equal(c.hue, 120);
});
