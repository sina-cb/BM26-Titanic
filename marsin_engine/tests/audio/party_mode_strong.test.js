// Unit tests for audio/signals/party_mode_strong.js — the HARD party gate
// (`audioPartyStrong`, report 20260725_10 §4.1).
//
// The gate exists because the old `audioParty` latches on room noise (live
// evidence: micKickRaw = 0, micLowRaw ≈ 0, audioParty = 1 sustained). These
// tests drive synthetic hop traces through the shaper and pin the four
// behaviours the show depends on:
//   1. room noise / voices NEVER qualify (no kick train, no BPM lock)
//   2. distant camp (bass-only, HF absorbed by air) NEVER qualifies
//   3. real music qualifies but only turns the gate ON after onSustainMs
//   4. the gate holds through a breakdown and drops only after offConfirmMs
//
// Run:  cd marsin_engine && node --test tests/audio/party_mode_strong.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PartyModeStrong, PARTY_MODE_STRONG_DEFAULTS } from '../../audio/signals/party_mode_strong.js';

const HOP_MS = 1000 / 86.13;   // the analyzer's real hop cadence
const DT = HOP_MS / 1000;

/**
 * Drive `seconds` of hops through the shaper.
 * `frame(tMs)` returns { low, mid, high, kick, silence, bpmLocked }.
 * Returns the last result.
 */
function run(p, state, seconds, frame) {
  let last = null;
  const endMs = state.ms + seconds * 1000;
  while (state.ms < endMs) {
    const f = frame(state.ms);
    last = p.update({
      low: f.low, mid: f.mid, high: f.high, kick: f.kick,
      silence: f.silence === undefined ? 0 : f.silence,
      bpmLocked: f.bpmLocked === undefined ? false : f.bpmLocked,
      dt: DT, nowMs: state.ms,
    });
    state.ms += HOP_MS;
  }
  return last;
}

/** A 4-on-the-floor kick pulse at `bpm` — 1 on the hop that lands on a beat. */
function kickAt(bpm, tMs, jitterMs = 0) {
  const periodMs = 60000 / bpm;
  const phase = ((tMs + jitterMs) % periodMs);
  return phase < HOP_MS ? 1 : 0;
}

/** A real, loud, full-band dance-music frame at 128 BPM (~2.13 kicks/s). */
function musicFrame(tMs, jitterMs = 0) {
  return {
    low: 0.55, mid: 0.45, high: 0.30,
    kick: kickAt(128, tMs, jitterMs),
    silence: 0, bpmLocked: true,
  };
}

test('room noise (voices/generator: mid+high, no kick, no lock) NEVER qualifies', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  // The literal live sample from the show machine, report 20260725_10 §2.2:
  // micLowRaw ≈ 0, micMidRaw ≈ 0.27, micHighRaw ≈ 0.20, micKickRaw = 0.
  const r = run(p, state, 120, () => ({
    low: 0.0, mid: 0.27, high: 0.20, kick: 0, silence: 0, bpmLocked: false,
  }));
  assert.equal(r.party, false, 'gate must stay OFF on 2 minutes of room noise');
  assert.equal(r.qualify, false);
  assert.equal(r.beatOk, false, 'no kick train ⇒ beat evidence must be false');
  assert.equal(r.kickRate, 0);
  assert.ok(r.lowShare < PARTY_MODE_STRONG_DEFAULTS.shapeLowMin,
    `low share ${r.lowShare} should fail the shape test (mid/high-only noise)`);
});

test('distant camp (bass-only, HF absorbed by air) NEVER qualifies', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  // Real dance music, real kick train, BPM locked — but the high band is gone,
  // which is exactly what a camp hundreds of metres away sounds like.
  const r = run(p, state, 120, (t) => ({
    low: 0.60, mid: 0.12, high: 0.01, kick: kickAt(128, t), silence: 0, bpmLocked: true,
  }));
  assert.equal(r.party, false, 'bass-only far music must not start a party session');
  assert.equal(r.beatOk, true, 'the beat evidence IS real here — that is the point');
  assert.equal(r.shapeOk, false, 'the SHAPE test is what rejects distant music');
  assert.ok(r.highShare < PARTY_MODE_STRONG_DEFAULTS.shapeHighMin,
    `high share ${r.highShare} must be under shapeHighMin`);
});

test('level below the calibrated floor × margin never qualifies (quiet real music)', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  const r = run(p, state, 90, (t) => ({
    low: 0.06, mid: 0.05, high: 0.04, kick: kickAt(128, t), silence: 0, bpmLocked: true,
  }));
  assert.equal(r.levelOk, false, 'loudness must be under ambientFloor × marginX');
  assert.equal(r.party, false);
});

test('real music qualifies immediately but the gate waits onSustainMs to latch ON', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };

  // 10 s in: qualifying, but well short of the 20 s sustain window.
  const at10 = run(p, state, 10, (t) => musicFrame(t));
  assert.equal(at10.qualify, true, 'the four terms should all hold on real music');
  assert.equal(at10.levelOk, true);
  assert.equal(at10.beatOk, true);
  assert.equal(at10.shapeOk, true);
  assert.equal(at10.quietOk, true);
  assert.equal(at10.party, false, 'must NOT latch before onSustainMs (20 s)');

  // 18 s total: still short.
  const at18 = run(p, state, 8, (t) => musicFrame(t));
  assert.equal(at18.party, false, 'still inside the sustain window at 18 s');

  // 25 s total: latched.
  const at25 = run(p, state, 7, (t) => musicFrame(t));
  assert.equal(at25.party, true, 'gate must be ON past onSustainMs of continuous qualification');
  assert.ok(at25.kickRate > 1.9 && at25.kickRate < 2.4,
    `128 BPM ⇒ ~2.13 kicks/s, got ${at25.kickRate}`);
  assert.ok(at25.kickReg > 0.9, `metronomic kick ⇒ high regularity, got ${at25.kickReg}`);
});

test('a 30 s art car passing by never latches the gate (sustain + re-arm)', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  // 15 s of real music (under the 20 s sustain), then 15 s of nothing, twice.
  // The sustain anchor must RESET on the gap so the two bursts do not add up.
  for (let i = 0; i < 2; i++) {
    run(p, state, 15, (t) => musicFrame(t));
    run(p, state, 15, () => ({ low: 0.0, mid: 0.05, high: 0.03, kick: 0, silence: 1, bpmLocked: false }));
  }
  assert.equal(p.party, false, 'two sub-threshold bursts must not accumulate into a latch');
});

test('the gate HOLDS through a breakdown and drops only after offConfirmMs', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  run(p, state, 30, (t) => musicFrame(t));
  assert.equal(p.party, true, 'precondition: gate is ON');

  // A 20 s breakdown (no kick, quiet) — shorter than offConfirmMs (30 s).
  const inBreak = run(p, state, 20, () => ({
    low: 0.20, mid: 0.10, high: 0.08, kick: 0, silence: 0, bpmLocked: false,
  }));
  assert.equal(inBreak.qualify, false, 'the breakdown does not qualify…');
  assert.equal(inBreak.party, true, '…but the session must NOT drop inside offConfirmMs');

  // Music returns — the off timer must re-arm, not carry over.
  run(p, state, 20, (t) => musicFrame(t));
  assert.equal(p.party, true, 'gate still ON after the music returns');

  // Now the music really stops, for longer than offConfirmMs.
  const after = run(p, state, 35, () => ({
    low: 0.0, mid: 0.03, high: 0.02, kick: 0, silence: 1, bpmLocked: false,
  }));
  assert.equal(after.party, false, 'gate must release past offConfirmMs of silence');
});

test('kick rate + regularity collapse to 0 when the beat stops (no stale mean)', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  run(p, state, 20, (t) => musicFrame(t));
  assert.ok(p.kickRate > 0 && p.kickReg > 0.5, 'precondition: a live beat is measured');
  run(p, state, 6, () => ({ low: 0.5, mid: 0.4, high: 0.3, kick: 0, silence: 0, bpmLocked: true }));
  assert.equal(p.kickRate, 0, 'idle past kickIdleMs ⇒ rate 0, never a frozen mean');
  assert.equal(p.kickReg, 0);
  assert.equal(p.beatOk, false);
});

test('bursty non-musical onsets (speech / applause) fail kickReg', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  // Speech and applause are BURSTY: clusters of rapid transients separated by
  // gaps, i.e. a bimodal interval distribution (~150 ms / ~1400 ms here). Its
  // mean interval lands inside the musical kick-rate band, so this is precisely
  // the case kickRate alone cannot reject — kickReg is what does it.
  let nextAt = 200, shortNext = true;
  const r = run(p, state, 60, (t) => {
    let kick = 0;
    if (t >= nextAt) {
      kick = 1;
      nextAt = t + (shortNext ? 250 : 1200);
      shortNext = !shortNext;
    }
    return { low: 0.5, mid: 0.4, high: 0.3, kick, silence: 0, bpmLocked: true };
  });
  assert.ok(r.kickRate >= PARTY_MODE_STRONG_DEFAULTS.kickRateMin
    && r.kickRate <= PARTY_MODE_STRONG_DEFAULTS.kickRateMax,
  `mean rate ${r.kickRate} sits INSIDE the musical band — rate alone cannot reject this`);
  assert.ok(r.kickReg < PARTY_MODE_STRONG_DEFAULTS.kickRegMin,
    `bursty onsets ⇒ kickReg ${r.kickReg} must be under kickRegMin`);
  assert.equal(r.beatOk, false);
  assert.equal(r.party, false);
});

test('kickRegMin is a LOOSE guard by design — a real beat with DROPPED onsets survives', () => {
  // The detector reality (report 20260725_10 §4.1): the analyzer's kick detector
  // MISSES onsets, which doubles an interval and craters the naive CV. So
  // kickRegMin is deliberately forgiving (0.45) and `requireBpmLock` is its
  // co-guard. This test PINS that intent, so a future "tidy" cannot quietly
  // tighten the threshold and start dropping real parties — the pairing is the
  // design, not an accident.
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  const periodMs = 60000 / 128;
  let nextAt = 300, n = 0;
  const r = run(p, state, 60, (t) => {
    let kick = 0;
    if (t >= nextAt) {
      n++;
      // Drop every 4th onset: the interval ring sees 3 × period then 2 × period.
      const skip = (n % 4) === 0;
      kick = 1;
      nextAt = t + periodMs * (skip ? 2 : 1);
    }
    return { low: 0.55, mid: 0.45, high: 0.30, kick, silence: 0, bpmLocked: true };
  });
  assert.ok(r.kickReg >= PARTY_MODE_STRONG_DEFAULTS.kickRegMin,
    `a real beat with 25 % dropped onsets ⇒ kickReg ${r.kickReg} must still clear kickRegMin`);
  assert.equal(r.beatOk, true, 'a real party with a lossy kick detector must still qualify');
});

test('requireBpmLock gates the beat term', () => {
  const p = new PartyModeStrong();
  const state = { ms: 0 };
  const r = run(p, state, 40, (t) => ({ ...musicFrame(t), bpmLocked: false }));
  assert.equal(r.beatOk, false, 'no BPM lock ⇒ no beat evidence');
  assert.equal(r.party, false);
});

test('setParams: known keys apply, unknown key / bad value THROW (no silent default)', () => {
  const p = new PartyModeStrong();
  p.setParams({ ambientFloor: 0.2, marginX: 3, requireBpmLock: false });
  assert.equal(p.p.ambientFloor, 0.2);
  assert.equal(p.p.marginX, 3);
  assert.equal(p.p.requireBpmLock, false);
  assert.throws(() => p.setParams({ ambeintFloor: 0.2 }), /unknown tunable "ambeintFloor"/);
  assert.throws(() => p.setParams({ marginX: 'loud' }), /must be a finite number/);
  assert.throws(() => p.setParams({ requireBpmLock: 1 }), /must be a boolean/);
});

test('a lowered ambientFloor makes previously-quiet music qualify (calibration works)', () => {
  const quiet = (t) => ({ low: 0.06, mid: 0.05, high: 0.04, kick: kickAt(128, t), silence: 0, bpmLocked: true });
  const stock = new PartyModeStrong();
  assert.equal(run(stock, { ms: 0 }, 40, quiet).levelOk, false);
  const tuned = new PartyModeStrong({ ambientFloor: 0.01 });
  const r = run(tuned, { ms: 0 }, 40, quiet);
  assert.equal(r.levelOk, true, 'calibrating the floor down must open the level term');
  assert.equal(r.party, true, 'and the gate then latches on the same audio');
});

test('non-finite input throws (fail loud, never poison the EMA)', () => {
  const p = new PartyModeStrong();
  assert.throws(() => p.update({
    low: NaN, mid: 0, high: 0, kick: 0, silence: 0, bpmLocked: false, dt: 0.01, nowMs: 0,
  }), /non-finite input/);
});
