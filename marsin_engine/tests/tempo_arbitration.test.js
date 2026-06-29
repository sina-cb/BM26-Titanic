// Unit tests for the TEMPO ARBITER (docs/39 §tempo-arbitration).
//
// Behaviour under test ("OSC auto-drives, tap overrides"):
//   (a) OSC live drives mixer.tempoBpm to the (clamped) OSC value.
//   (b) a manual tap arms the override hold; OSC does NOT overwrite during it.
//   (c) after the window, with OSC still live, OSC reclaims.
//   (d) OSC stale/off ⇒ the last (tapped) value holds — no overwrite.
//   (e) clearOverride() (the /mixer/tempo/sync route) drops the override so
//       OSC reclaims on the next tick.
//   (f) tempoSource derivation: 'osc' / 'manual' / 'held'.
//   (g) OSC-driven values are clamped into [20,400].
//   (h) no churn: setTempoBpm is only called when the value actually changes.
//
// Uses a fake/injected clock and a fake ParamCenter + mixer modelled on the
// real subscribe/getCanonicalState event shape.
//
// Run:  cd marsin_engine && node --test tests/tempo_arbitration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TempoArbiter,
  MANUAL_HOLD_MS,
  OSC_STALENESS_MS,
} from '../lib/tempo_arbiter.js';

// ── Fakes ──────────────────────────────────────────────────────────────

// Minimal mixer: records setTempoBpm calls so we can assert no-churn.
function fakeMixer() {
  return {
    tempoBpm: null,
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

test('(a) OSC live drives tempoBpm to the OSC value', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128);
  assert.deepEqual(mixer.setCalls, [128]);
});

// ── (b) tap overrides for the hold window ──────────────────────────────

test('(b) a tap arms the hold; OSC does NOT overwrite during it', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  // Operator taps 100 (caller sets the mixer itself; arbiter just arms hold).
  mixer.setTempoBpm(100);
  arbiter.noteManualTap(clock());
  // OSC is streaming a different tempo.
  pc.emitAudioBpm(128);
  // Tick mid-window — must NOT overwrite the tapped 100.
  clock.advance(MANUAL_HOLD_MS - 1);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 100);
  // setTempoBpm was called once (the tap), never by the arbiter.
  assert.deepEqual(mixer.setCalls, [100]);
});

// ── (c) after the window OSC reclaims (if still live) ──────────────────

test('(c) after the hold window with OSC still live, OSC reclaims', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  mixer.setTempoBpm(100);
  arbiter.noteManualTap(clock());
  // Keep OSC fresh AFTER the window expires so it is still live at reclaim.
  clock.advance(MANUAL_HOLD_MS + 1);
  pc.emitAudioBpm(140); // fresh now
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 140);
});

// ── (d) OSC stale/off ⇒ tapped value holds ─────────────────────────────

test('(d) OSC stale ⇒ tapped value holds, no overwrite', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  // An OSC value arrives, then the feed goes silent.
  pc.emitAudioBpm(128);
  // Operator taps 100 well after.
  clock.advance(5000);
  mixer.setTempoBpm(100);
  arbiter.noteManualTap(clock());
  // Let the override expire AND let OSC go stale (no new emit).
  clock.advance(MANUAL_HOLD_MS + OSC_STALENESS_MS + 1);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 100); // held — OSC stale, no reclaim
  assert.deepEqual(mixer.setCalls, [100]);
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

// ── (e) sync drops the override ────────────────────────────────────────

test('(e) clearOverride() drops the hold so OSC reclaims next tick', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  mixer.setTempoBpm(100);
  arbiter.noteManualTap(clock());
  pc.emitAudioBpm(128);
  // Still inside the window — without sync, OSC would be blocked.
  assert.equal(arbiter.isManualOverrideActive(clock()), true);
  arbiter.clearOverride();
  assert.equal(arbiter.isManualOverrideActive(clock()), false);
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128); // OSC reclaimed immediately
});

// ── (f) tempoSource derivation ─────────────────────────────────────────

test('(f) tempoSource: osc when live + no override', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  assert.equal(arbiter.deriveSource(clock()), 'osc');
});

test('(f) tempoSource: manual inside the override window', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  arbiter.noteManualTap(clock());
  assert.equal(arbiter.deriveSource(clock()), 'manual');
  // manual wins even while OSC is live
});

test('(f) tempoSource: held when OSC stale/off', () => {
  const { pc, arbiter, clock } = makeArbiter();
  assert.equal(arbiter.deriveSource(clock()), 'held'); // never seen OSC
  pc.emitAudioBpm(128);
  clock.advance(OSC_STALENESS_MS + 1); // go stale
  assert.equal(arbiter.deriveSource(clock()), 'held');
});

test('(f) tempoSource flips osc → manual → osc across a tap + window', () => {
  const { pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  assert.equal(arbiter.deriveSource(clock()), 'osc');
  arbiter.noteManualTap(clock());
  assert.equal(arbiter.deriveSource(clock()), 'manual');
  clock.advance(MANUAL_HOLD_MS + 1);
  pc.emitAudioBpm(128); // keep fresh
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

test('(h) a tap that matches the live OSC value ⇒ no extra setTempoBpm on reclaim', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128);
  // Operator taps the SAME value 128.
  mixer.setTempoBpm(128);
  arbiter.noteManualTap(clock());
  assert.deepEqual(mixer.setCalls, [128]);
  // After the window, OSC reclaims — but the value already matches, so the
  // arbiter must NOT call setTempoBpm again.
  clock.advance(MANUAL_HOLD_MS + 1);
  pc.emitAudioBpm(128);
  arbiter.tick(clock());
  assert.deepEqual(mixer.setCalls, [128], 'no redundant set when value unchanged');
});

// ── stability deadband (jitter rejection) ─────────────────────────────

test('deadband: small OSC jitter around the held tempo does NOT churn', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128); arbiter.tick(clock());            // snap to 128
  assert.deepEqual(mixer.setCalls, [128]);
  for (const j of [129, 127, 130, 126, 128.4]) {          // all within 3 BPM of 128
    clock.advance(25); pc.emitAudioBpm(j); arbiter.tick(clock());
  }
  assert.deepEqual(mixer.setCalls, [128], 'jitter within the deadband is ignored');
});

test('deadband: a genuine tempo move (>= deadband) follows', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(120); arbiter.tick(clock());            // snap 120
  clock.advance(25); pc.emitAudioBpm(124); arbiter.tick(clock()); // +4 >= 3
  assert.deepEqual(mixer.setCalls, [120, 124]);
});

test('OSC bpm is rounded to an integer (no sub-BPM churn)', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(127.6); arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128);
});

test('sync (clearOverride) snaps to the live OSC even within the deadband', () => {
  const { mixer, pc, arbiter, clock } = makeArbiter();
  pc.emitAudioBpm(128); arbiter.tick(clock());            // following 128
  mixer.setTempoBpm(127); arbiter.noteManualTap(clock()); // tap to 127 (within deadband)
  pc.emitAudioBpm(128);
  arbiter.clearOverride();                                 // sync → snap to OSC
  arbiter.tick(clock());
  assert.equal(mixer.tempoBpm, 128, 'sync snaps to OSC even though |128-127| < deadband');
});

// ── Constants are sane named values ────────────────────────────────────

test('MANUAL_HOLD_MS default is 12000ms; OSC_STALENESS_MS is 1500ms', () => {
  assert.equal(MANUAL_HOLD_MS, 12000);
  assert.equal(OSC_STALENESS_MS, 1500);
});
