// Unit tests for round-2 #1 — SNAPSHOT CROSSFADE / MORPH (docs/39 §10.8).
//
// These tests exercise the MIXER-level primitives the morph rides on:
//   - startGroupFade / _tickGroupFades: a group's fader ramps current→target,
//     lands EXACTLY on the target, self-clears, frame-rate independent.
//   - beginMorph / _tickMorph / onMorphComplete: the wall-clock completion
//     window fires the finalizer EXACTLY once with the fade-out id set.
//   - fadeChannel M/T/C level ramps: M lerps a channel's fader to the target
//     (midpoint ≈ smoothstep(0.5)); T ramps 0→target; C ramps →0 and is
//     removed (destroyOnComplete); the C id is reported for CPC cleanup.
//   - Operator-hand-wins: a direct updateMixGroup fader write cancels an
//     in-flight group fade.
//   - Validation: durationMs <= 0 / non-finite / missing reject pre-mutation;
//     unknown group / bad target throw.
//
// The full route-level morphToLook (build T channels + CPC + over-cap UNION)
// is covered by the HIL test (tests/hil/hil_snapshot_morph_test.mjs) because
// it needs a real WASM host + ParamCenter. Here we drive a fake-host mixer so
// the math is asserted numerically with zero compile cost.
//
// Run:  cd marsin_engine && node --test tests/snapshot_morph.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';

const wasmHostStub = { destroy() {} };

function makeMixer() {
  const m = new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 4 });
  m.wantVisThisFrame = false;
  return m;
}

// smoothstep(0.5) = 0.5*0.5*(3 - 2*0.5) = 0.25*2 = 0.5. The fadeChannel ramp
// uses smoothstep by default, so the exact midpoint value is 0.5 of the way —
// but because the curve is symmetric, the midpoint of a 0→1 ramp is 0.5.
function smoothstep(t) { return t * t * (3 - 2 * t); }

// Push a transition's startTime `ms` into the past, then run updateTransitions.
function advanceTransitions(mixer, ms) {
  const past = performance.now() - ms;
  for (const t of mixer.transitions) t.startTime = past;
  mixer.updateTransitions(performance.now());
}

// Push every group fade's startMs into the past, then tick them.
function advanceGroupFades(mixer, ms) {
  const past = Date.now() - ms;
  for (const gf of mixer._groupFades) gf.startMs = past;
  mixer._tickGroupFades();
}

// ── Group fades (ramp gang-fader levels) ────────────────────────────────────

test('startGroupFade ramps a group fader toward the target and lands exactly', () => {
  const m = makeMixer();
  const g = m.createMixGroup({ name: 'A' });
  g.fader = 0.2;
  m.startGroupFade(g.id, 1.0, 1000);
  // Halfway: linear ≈ 0.6 (0.2 + 0.8*0.5). _tickGroupFades uses linear time.
  advanceGroupFades(m, 500);
  assert.ok(Math.abs(g.fader - 0.6) < 0.05, `expected ~0.6, got ${g.fader}`);
  // Past the end: lands EXACTLY on target, descriptor cleared.
  advanceGroupFades(m, 1000);
  assert.equal(g.fader, 1.0, 'group fader lands exactly on target');
  assert.equal(m._groupFades.length, 0, 'group fade descriptor cleared on completion');
});

test('a direct updateMixGroup fader write cancels an in-flight group fade', () => {
  const m = makeMixer();
  const g = m.createMixGroup({ name: 'A' });
  g.fader = 0.0;
  m.startGroupFade(g.id, 1.0, 5000);
  assert.equal(m._groupFades.length, 1, 'fade armed');
  m.updateMixGroup(g.id, { fader: 0.4 });
  assert.equal(m._groupFades.length, 0, 'direct fader write cancels the fade');
  assert.equal(g.fader, 0.4);
  // A subsequent tick must NOT resume the cancelled fade.
  advanceGroupFades(m, 10000);
  assert.equal(g.fader, 0.4, 'cancelled fade does not resume');
});

test('startGroupFade rejects bad duration / target / unknown group', () => {
  const m = makeMixer();
  const g = m.createMixGroup({ name: 'A' });
  assert.throws(() => m.startGroupFade(g.id, 0.5, 0), /durationMs/);
  assert.throws(() => m.startGroupFade(g.id, 0.5, -5), /durationMs/);
  assert.throws(() => m.startGroupFade(g.id, 0.5, NaN), /durationMs/);
  assert.throws(() => m.startGroupFade(g.id, 1.5, 1000), /target/);
  assert.throws(() => m.startGroupFade(g.id, NaN, 1000), /target/);
  assert.throws(() => m.startGroupFade('mg_ghost', 0.5, 1000), /unknown group/);
});

test('deleteMixGroup drops any in-flight fade for that group', () => {
  const m = makeMixer();
  const g = m.createMixGroup({ name: 'A' });
  m.startGroupFade(g.id, 1.0, 1000);
  assert.equal(m._groupFades.length, 1);
  m.deleteMixGroup(g.id);
  assert.equal(m._groupFades.length, 0, 'fade dropped with the group');
});

// ── Per-channel level ramps (M / T / C semantics) ───────────────────────────

test('M: fadeChannel lerps a channel fader to the target (midpoint ≈ smoothstep)', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'm1', pattern: 'p', handle: {}, fader: 0.0, enabled: true });
  m.fadeChannel('m1', 1.0, 1000, { curve: 'smoothstep' });
  advanceTransitions(m, 500); // halfway
  const ch = m.getMixerChannel('m1');
  assert.ok(Math.abs(ch.fader - smoothstep(0.5)) < 0.05,
    `midpoint should be ≈ smoothstep(0.5)=0.5, got ${ch.fader}`);
  advanceTransitions(m, 1000); // past end
  assert.equal(ch.fader, 1.0, 'M channel lands exactly on the target fader');
  assert.equal(m.transitions.length, 0, 'transition cleared on completion');
});

test('T: fadeChannel ramps a freshly-built channel 0 → target', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 't1', pattern: 'p', handle: {}, fader: 0.0, enabled: true });
  m.fadeChannel('t1', 0.8, 1000, { curve: 'smoothstep' });
  const ch = m.getMixerChannel('t1');
  assert.equal(ch.fader, 0.0, 'starts dark');
  advanceTransitions(m, 1000);
  assert.equal(ch.fader, 0.8, 'T channel lands exactly on the target fader');
});

test('C: fadeChannel →0 with destroyOnComplete removes the channel', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', pattern: 'p', handle: {}, fader: 1.0, enabled: true });
  m.fadeChannel('c1', 0, 1000, { curve: 'smoothstep', destroyOnComplete: true });
  assert.ok(m.getMixerChannel('c1'), 'present mid-fade');
  advanceTransitions(m, 1000);
  assert.equal(m.getMixerChannel('c1'), undefined, 'C channel removed on completion');
});

test('same-id changed pattern: structural snap (rebuild) + level ramp model', () => {
  // The morph rebuilds an M channel (structural snap) then ramps its fader.
  // Here we simulate that at the mixer level: remove + re-add at the start
  // fader, then fadeChannel to target.
  const m = makeMixer();
  m.addMixerChannel({ id: 'm1', pattern: 'old', handle: {}, mode: 'blend_screen', fader: 0.3, enabled: true });
  const startFader = m.getMixerChannel('m1').fader;
  m.removeMixerChannel('m1');
  m.addMixerChannel({ id: 'm1', pattern: 'new', handle: {}, mode: 'blend_add', fader: startFader, enabled: true });
  const rebuilt = m.getMixerChannel('m1');
  assert.equal(rebuilt.pattern, 'new', 'structural field (pattern) snapped immediately');
  assert.equal(rebuilt.mode, 'blend_add', 'structural field (mode) snapped immediately');
  assert.equal(rebuilt.fader, 0.3, 'fader anchored at the pre-morph start level');
  m.fadeChannel('m1', 0.9, 1000, { curve: 'smoothstep' });
  advanceTransitions(m, 1000);
  assert.equal(m.getMixerChannel('m1').fader, 0.9, 'fader ramped to the target');
});

// ── Morph descriptor + finalizer ────────────────────────────────────────────

test('beginMorph arms a descriptor; _tickMorph fires onMorphComplete once after the window', () => {
  const m = makeMixer();
  let calls = 0;
  let seenIds = null;
  m.onMorphComplete = ({ fadeOutIds }) => { calls++; seenIds = fadeOutIds; };
  m.beginMorph(1000, ['c1', 'c2']);
  assert.ok(m.getMorph(), 'morph armed');
  assert.deepEqual(m.getMorph().fadeOutIds, ['c1', 'c2']);
  // Before the window elapses → no finalizer.
  m._tickMorph();
  assert.equal(calls, 0, 'finalizer not fired mid-window');
  // Rewind start past the window → finalizer fires once.
  m._morph.startMs = Date.now() - 1001;
  m._tickMorph();
  assert.equal(calls, 1, 'finalizer fired exactly once');
  assert.deepEqual(seenIds, ['c1', 'c2'], 'finalizer received the fade-out id set');
  assert.equal(m.getMorph(), null, 'morph descriptor cleared on completion');
  // A second tick must NOT re-fire (no orphan / double-free).
  m._tickMorph();
  assert.equal(calls, 1, 'finalizer never fires twice');
});

test('beginMorph rejects a non-finite / non-positive durationMs', () => {
  const m = makeMixer();
  assert.throws(() => m.beginMorph(0, []), /durationMs/);
  assert.throws(() => m.beginMorph(-10, []), /durationMs/);
  assert.throws(() => m.beginMorph(NaN, []), /durationMs/);
});

test('cancelMorph drops the descriptor WITHOUT firing the finalizer (replace mid-flight)', () => {
  const m = makeMixer();
  let calls = 0;
  m.onMorphComplete = () => { calls++; };
  m.beginMorph(5000, ['c1']);
  assert.ok(m.getMorph());
  assert.equal(m.cancelMorph(), true);
  assert.equal(m.getMorph(), null, 'descriptor cleared');
  assert.equal(calls, 0, 'cancel does NOT fire the finalizer (no double-free of CPC)');
  // Re-arm a fresh morph (the replace case) — it runs cleanly.
  m.beginMorph(1000, ['c9']);
  m._morph.startMs = Date.now() - 1001;
  m._tickMorph();
  assert.equal(calls, 1, 'replacement morph completes normally');
});
