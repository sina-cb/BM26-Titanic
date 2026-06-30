/**
 * party_mode.test.js — the loud-music gate (audio/signals/party_mode.js).
 * Covers the warmup gate (a lone opening spike must NOT latch party), the
 * hysteresis/hold (a 1-bar dip inside a loud section stays ON), and the
 * sustained-quiet OFF path. The module previously had ZERO unit tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PartyMode } from '../audio/signals/party_mode.js';

const HOPS = 86.13;
const DT = 1 / HOPS;

// Run `seconds` of constant band levels, returning the final state + clock.
function run(pm, { seconds, low, mid, high }, startMs = 0) {
  let now = startMs, out = { party: pm.party, loudness: pm.loudness };
  for (let i = 0; i < Math.round(seconds * HOPS); i++) {
    now += DT * 1000;
    out = pm.update(low, mid, high, DT, now);
  }
  return { ...out, now };
}

test('warmup gate: a loud spike in the first warmupMs does NOT latch party', () => {
  const pm = new PartyMode();
  // Full-band loud from t=0; loudness crosses onThresh in ~0.1 s, but the
  // default warmupMs (1500) must suppress the ON latch.
  const r = run(pm, { seconds: 1.0, low: 1, mid: 1, high: 1 });
  assert.equal(r.party, false, 'party must not latch during the warmup window');
  assert.ok(r.loudness > 0.22, 'loudness did cross the on-threshold (gate, not level, suppressed it)');
});

test('sustained loud past warmup → party ON', () => {
  const pm = new PartyMode();
  const r = run(pm, { seconds: 2.2, low: 1, mid: 1, high: 1 });
  assert.equal(r.party, true, 'sustained loud music past warmup turns party ON');
});

test('hold: a brief (<offConfirmMs) dip inside a loud section stays ON', () => {
  const pm = new PartyMode();
  let s = run(pm, { seconds: 2.2, low: 1, mid: 1, high: 1 });   // ON
  assert.equal(s.party, true);
  // 0.4 s of silence (< offConfirmMs 0.8 s) → must stay ON.
  s = run(pm, { seconds: 0.4, low: 0, mid: 0, high: 0 }, s.now);
  assert.equal(s.party, true, 'a short breakdown must not drop party');
});

test('OFF only after sustained quiet past the hold time', () => {
  const pm = new PartyMode();
  let s = run(pm, { seconds: 3.0, low: 1, mid: 1, high: 1 });   // ON, well past holdMs
  assert.equal(s.party, true);
  // 2.5 s of silence → loudness decays below offThresh, then offConfirmMs → OFF.
  s = run(pm, { seconds: 2.5, low: 0, mid: 0, high: 0 }, s.now);
  assert.equal(s.party, false, 'sustained quiet past the hold time turns party OFF');
});
