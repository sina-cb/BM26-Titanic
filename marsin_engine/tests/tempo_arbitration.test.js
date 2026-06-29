// Unit tests for the TEMPO ARBITER (docs/39 §tempo-arbitration).
//
// Behaviour under test — STICKY SOURCE SWITCH (operator request 2026-06-29).
// The OSC/TAP selection is a sticky preference (`mixer.tempoSourcePref`) that
// governs the ONE system-wide tempo (mixer.tempoBpm); it does NOT auto-revert:
//   (a) pref 'osc' (default) + OSC live ⇒ OSC drives mixer.tempoBpm (clamped).
//   (b) a manual tap makes TAP the sticky source; OSC NEVER overwrites it
//       (no time window — it holds until the operator selects OSC).
//   (c) selecting OSC (clearOverride / setSourcePref('osc')) lets OSC reclaim.
//   (d) OSC stale/off ⇒ the last value holds — no overwrite.
//   (e) setSourcePref('tap') suppresses OSC auto-follow even with OSC live.
//   (f) tempoSource derivation: 'osc' / 'manual' / 'held'; sourcePref tracks
//       the sticky selection and does NOT flap with OSC liveness.
//   (g) OSC-driven values are clamped into [20,400].
//   (h) no churn: setTempoBpm is only called when the value actually changes.
//
// Uses a fake/injected clock and a fake ParamCenter + mixer modelled on the
// real subscribe/getCanonicalState event shape. The fake mixer carries a
// `tempoSourcePref` field (the persisted home the arbiter reads/writes).
//
// Run:  cd marsin_engine && node --test tests/tempo_arbitration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TempoArbiter,
  OSC_STALENESS_MS,
  TEMPO_SOURCE_PREFS,
  DEFAULT_TEMPO_SOURCE_PREF,
} from '../lib/tempo_arbiter.js';

// ── Fakes ──────────────────────────────────────────────────────────────

// Minimal mixer: records setTempoBpm calls so we can assert no-churn. Carries
// `tempoSourcePref` (the persisted sticky selection the arbiter owns).
function fakeMixer() {
  return {
    tempoBpm: null,
    tempoSourcePref: 'osc',
    setCalls: [],
    setTempoBpm(bpm) {
      this.tempoBpm = bpm;
      this.setCalls.push(bpm);
      return bpm / 120;
    },
  };
}

// Minimal ParamCenter matching the real subscribe() event shape:
//   ev = { changedKeys: string[], state: { params: { key: { value } } } }
function fakeParamCenter() {
  const subs = [];
  return {
    subscribe(fn) {
      subs.push(fn);
      return () => {
        const i = subs.indexOf(fn);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    // Test helper: emit an audioBpm change to every subscriber.
    emitAudioBpm(value) {
      const ev = {
        changedKeys: ['audioBpm'],
        state: { params: { audioBpm: { value } } },
      };
      for (const fn of subs) fn(ev);
    },
    subCount() { return subs.length; },
  };
}

// A controllable wall clock.
function fakeClock(start = 1000) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; };
  fn.set = (ms) => { t = ms; };
  return fn;
}

function makeArbiter(startMs = 1000) {
  const mixer = fakeMixer();
  const pc = fakeParamCenter();
  const clock = fakeClock(startMs);
  const arbiter = new TempoArbiter({ mixer, paramCenter: pc, clock });
  arbiter.attach();
  return { mixer, pc, clock, arbiter };
}

// ── Construction / guards ──────────────────────────────────────────────

test('constructor rejects a missing mixer', () => {
  assert.throws(() => new TempoArbiter({ paramCenter: fakeParamCenter() }), TypeError);
});

test('constructor rejects a paramCenter without subscribe()', () => {
  assert.throws(() => new TempoArbiter({ mixer: fakeMixer(), paramCenter: {} }), TypeError);
});

test('constructor seeds a default sticky pref when the mixer has none', () => {
  const mixer = fakeMixer();
  delete mixer.tempoSourcePref;
  const arbiter = new TempoArbiter({ mixer, paramCenter: fakeParamCenter() });
  assert.equal(mixer.tempoSourcePref, 'osc');
  assert.equal(arbiter.sourcePref(), 'osc');
});

test('attach subscribes to the CPC; detach unsubscribes (idempotent)', () => {
  const { pc, arbiter } = makeArbiter();
  assert.equal(pc.subCount(), 1);
  arbiter.attach(); // idempotent
  assert.equal(pc.subCount(), 1);
  arbiter.detach();
  assert.equal(pc.subCount(), 0);
  arbiter.detach(); // idempotent
  assert.equal(pc.subCount(), 0);
});

// ── (a) OSC live drives tempoBpm ───────────────────────────────────────

test('(a) OSC live (default pref) drives tempoBpm to the OSC value', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128);
  assert.deepEqual(mixer.setCalls, [128]);
});

// ── (b) a tap makes TAP the sticky source; OSC NEVER overwrites ─────────

test('(b) a tap makes TAP sticky; OSC does NOT overwrite (no auto-revert)', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  // Operator taps 100 (caller sets the mixer itself; arbiter flips the pref).
  mixer.setTempoBpm(100);
  arbiter.noteManualTap();
  assert.equal(arbiter.sourcePref(), 'tap');
  assert.equal(mixer.tempoSourcePref, 'tap');
  // OSC is streaming a different tempo — and STAYS streaming for a long time.
  pc.emitAudioBpm(128);
  clock.advance(60000); // a full minute later
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  // Must NOT overwrite the tapped 100 — TAP is sticky.
  assert.equal(mixer.tempoBpm, 100);
  assert.deepEqual(mixer.setCalls, [100]);
});

// ── (c) selecting OSC lets OSC reclaim ─────────────────────────────────

test('(c) selecting OSC (after a tap) lets OSC reclaim immediately', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  mixer.setTempoBpm(100);
  arbiter.noteManualTap();
  pc.emitAudioBpm(140);
  // Operator selects OSC — drops the sticky tap.
  arbiter.setSourcePref('osc');
  assert.equal(arbiter.sourcePref(), 'osc');
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 140);
});

// ── (d) OSC stale/off ⇒ value holds ────────────────────────────────────

test('(d) OSC stale (pref osc) ⇒ last value holds, no overwrite', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128); arbiter.tick(clock()); // follow 128
  assert.deepEqual(mixer.setCalls, [128]);
  // Feed goes silent — OSC goes stale.
  clock.advance(OSC_STALENESS_MS + 1);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128); // held — OSC stale, no reclaim
  assert.deepEqual(mixer.setCalls, [128]);
});

test('(d2) OSC never seen ⇒ tick is a no-op', () => {
  const { mixer, arbiter, clock } = makeArbiter();
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, null);
  assert.equal(mixer.setCalls.length, 0);
});

test('(d3) a 0 / non-finite OSC bpm is treated as "no signal" (fail safe)', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(0);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, null);
  pc.emitAudioBpm(NaN);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, null);
  assert.equal(mixer.setCalls.length, 0);
});

// ── (e) TAP pref suppresses OSC auto-follow ────────────────────────────

test('(e) setSourcePref("tap") suppresses OSC even with OSC live', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  mixer.setTempoBpm(95);
  arbiter.setSourcePref('tap');
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 95); // OSC suppressed in tap mode
  assert.deepEqual(mixer.setCalls, [95]);
});

test('(e2) clearOverride() selects OSC so it reclaims next tick', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  mixer.setTempoBpm(100);
  arbiter.noteManualTap();
  pc.emitAudioBpm(128);
  assert.equal(arbiter.isManualOverrideActive(), true);
  arbiter.clearOverride();
  assert.equal(arbiter.isManualOverrideActive(), false);
  assert.equal(arbiter.sourcePref(), 'osc');
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128); // OSC reclaimed immediately
});

test('(e3) setSourcePref rejects an invalid source (fail loud)', () => {
  const { arbiter } = makeArbiter();
  assert.throws(() => arbiter.setSourcePref('audio'), /requires 'osc' \| 'tap'/);
  assert.throws(() => arbiter.setSourcePref(null), /requires 'osc' \| 'tap'/);
});

// ── (f) tempoSource + sourcePref derivation ────────────────────────────

test('(f) tempoSource: osc when pref osc + live', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  assert.equal(arbiter.deriveSource(clock()), 'osc');
  assert.equal(arbiter.sourcePref(), 'osc');
});

test('(f) tempoSource: manual whenever the sticky pref is tap', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  arbiter.noteManualTap();
  assert.equal(arbiter.deriveSource(clock()), 'manual');
  assert.equal(arbiter.sourcePref(), 'tap');
  // manual wins even while OSC is live
});

test('(f) tempoSource: held when pref osc but OSC stale/off — pref STAYS osc', () => {
  const { pc, arbiter, clock } = makeArbiter();
  assert.equal(arbiter.deriveSource(clock()), 'held'); // never seen OSC
  pc.emitAudioBpm(128);
  clock.advance(OSC_STALENESS_MS + 1); // go stale
  assert.equal(arbiter.deriveSource(clock()), 'held');
  // The SELECTOR stays on OSC through the dropout — it does NOT flip to tap.
  assert.equal(arbiter.sourcePref(), 'osc');
});

test('(f) sourcePref is sticky: osc → tap (on tap) → osc (on select)', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  assert.equal(arbiter.sourcePref(), 'osc');
  arbiter.noteManualTap();
  assert.equal(arbiter.sourcePref(), 'tap');
  assert.equal(arbiter.deriveSource(clock()), 'manual');
  arbiter.setSourcePref('osc');
  pc.emitAudioBpm(128); // keep fresh
  assert.equal(arbiter.sourcePref(), 'osc');
  assert.equal(arbiter.deriveSource(clock()), 'osc');
});

// ── (g) clamp [20,400] on OSC-driven values ────────────────────────────

test('(g) OSC bpm above 400 clamps to 400', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(600);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 400);
  assert.equal(arbiter.oscTempoBpm(clock()), 400);
});

test('(g) OSC bpm below 20 (but >0) clamps to 20', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(5);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 20);
  assert.equal(arbiter.oscTempoBpm(clock()), 20);
});

test('(g) oscTempoBpm is null when stale', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  clock.advance(OSC_STALENESS_MS + 1);
  assert.equal(arbiter.oscTempoBpm(clock()), null);
});

// ── (h) no churn: setTempoBpm only on change ───────────────────────────

test('(h) steady OSC value ⇒ setTempoBpm called exactly once (no churn)', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  // Many more ticks at the same fresh value — keep it fresh, no change.
  for (let i = 0; i < 50; i++) {
    clock.advance(25); // 40 fps
    pc.emitAudioBpm(128); // still 128, still fresh
    arbiter.tick(clock());
  }
  assert.deepEqual(mixer.setCalls, [128], 'only one setTempoBpm for a steady tempo');
});

test('(h) changing OSC value drives a new setTempoBpm each change', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(120); arbiter.tick(clock());
  clock.advance(25);
  pc.emitAudioBpm(130); arbiter.tick(clock());
  clock.advance(25);
  pc.emitAudioBpm(140); arbiter.tick(clock());
  assert.deepEqual(mixer.setCalls, [120, 130, 140]);
});

test('(h) selecting OSC after a matching tap ⇒ no redundant setTempoBpm', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  // Operator taps the SAME value 128 (sticky tap).
  mixer.setTempoBpm(128);
  arbiter.noteManualTap();
  assert.deepEqual(mixer.setCalls, [128]);
  // Select OSC — value already matches, so the arbiter must NOT set again.
  arbiter.setSourcePref('osc');
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  assert.deepEqual(mixer.setCalls, [128], 'no redundant set when value unchanged');
});

// ── RAW OSC fidelity (no deadband) ────────────────────────────────────
// With OSC selected the system tempo IS the raw OSC value (operator request
// 2026-06-29). There is NO deadband: every distinct OSC integer is applied, so
// mixer.tempoBpm never lags or differs from the OSC readout. (Stability comes
// from the Companion's Kalman-smoothed integer emit, not from the arbiter.)

test('raw fidelity: every distinct OSC value is applied (no deadband)', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128); arbiter.tick(clock());            // 128
  for (const j of [129, 127, 130, 126]) {                 // ±1..2 BPM moves
    clock.advance(25); pc.emitAudioBpm(j); arbiter.tick(clock());
  }
  assert.deepEqual(mixer.setCalls, [128, 129, 127, 130, 126],
    'each OSC value is applied verbatim — no deadband suppression');
});

test('raw fidelity: a genuine tempo move follows', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(120); arbiter.tick(clock());
  clock.advance(25); pc.emitAudioBpm(124); arbiter.tick(clock());
  assert.deepEqual(mixer.setCalls, [120, 124]);
});

test('a non-integer OSC bpm is rounded (safety no-op for the integer emit)', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(127.6); arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128);
});

test('selecting OSC applies the raw live OSC value immediately', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128); arbiter.tick(clock());            // following 128
  mixer.setTempoBpm(127); arbiter.noteManualTap();        // tap to 127
  pc.emitAudioBpm(128);
  arbiter.clearOverride();                                 // select OSC
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128, 'select-OSC applies the raw OSC value (128)');
});

// ── Constants are sane named values ────────────────────────────────────

test('OSC_STALENESS_MS is 1500ms; source prefs are osc/tap (default osc)', () => {
  assert.equal(OSC_STALENESS_MS, 1500);
  assert.deepEqual(TEMPO_SOURCE_PREFS, ['osc', 'tap']);
  assert.equal(DEFAULT_TEMPO_SOURCE_PREF, 'osc');
});
