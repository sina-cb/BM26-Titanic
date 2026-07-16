// Unit + integration tests for the per-band onset shaper (band_onsets.js) and
// the sub-bass chest-hit shaper (sub_bass.js), and an end-to-end pass driving
// the REAL analyzer with the synth bank → the shapers (the deployed path).
//
// Run:  cd marsin_engine && node --test tests/band_onsets.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BandOnsetBank } from '../../audio/signals/band_onsets.js';
import { SubBass } from '../../audio/signals/sub_bass.js';
import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import { fillFrame } from '../../audio/synth/test_synths.js';

const SR = 44100, FFT = 1024, HOP = 512, HOP_MS = (HOP / SR) * 1000;

// ── BandOnset shaper (unit) ───────────────────────────────────────────────

test('band onset fires on a sharp rise, holds, then decays', () => {
  const bank = new BandOnsetBank();
  let now = 0;
  // Warmup with quiet onsets (no fire during warmup). Bank signature is
  // (onsetLow, onsetMid, onsetHigh, dtMs, nowMs).
  for (let i = 0; i < 40; i++) { bank.update(0.0, 0.0, 0.0, HOP_MS, now); now += HOP_MS; }
  // One sharp low onset.
  const r = bank.update(0.6, 0.0, 0.0, HOP_MS, now);
  assert.equal(r.firedLow, true, 'a sharp rise should fire');
  assert.ok(r.low > 0.9, `pulse should snap high; got ${r.low}`);
  now += HOP_MS;
  // Next hop quiet → decays, no new fire.
  const r2 = bank.update(0.0, 0.0, 0.0, HOP_MS, now);
  assert.equal(r2.firedLow, false);
  assert.ok(r2.low < r.low, `pulse should decay; got ${r2.low}`);
});

test('band onset does NOT fire on silence (gate holds)', () => {
  const bank = new BandOnsetBank();
  let now = 0, fires = 0;
  for (let i = 0; i < 300; i++) {
    const r = bank.update(0.0, 0.0, 0.0, HOP_MS, now);
    if (r.firedLow || r.firedMid || r.firedHigh) fires++;
    now += HOP_MS;
  }
  assert.equal(fires, 0, 'silence must never fire an onset');
});

test('band onset respects the refractory window', () => {
  const bank = new BandOnsetBank({ refractoryMs: 200 });
  let now = 0;
  for (let i = 0; i < 40; i++) { bank.update(0.0, 0.0, 0.0, HOP_MS, now); now += HOP_MS; }
  let fires = 0;
  // Two rises 50 ms apart (< 200 ms refractory) → only one fires.
  if (bank.update(0.6, 0.0, 0.0, HOP_MS, now).firedLow) fires++;
  now += 50;
  if (bank.update(0.6, 0.0, 0.0, HOP_MS, now).firedLow) fires++;
  assert.equal(fires, 1, `refractory should suppress the second fire; got ${fires}`);
});

// ── SubBass shaper (unit) ─────────────────────────────────────────────────

test('chest hit fires on a sub transient over the drone floor', () => {
  const sub = new SubBass();
  let now = 0;
  // Warmup at a moderate sustained level (the "drone").
  for (let i = 0; i < 40; i++) { sub.update(0.15, HOP_MS / 1000, HOP_MS, now); now += HOP_MS; }
  // A slam well above the drone.
  const r = sub.update(0.6, HOP_MS / 1000, HOP_MS, now);
  assert.equal(r.fired, true, 'a slam over the drone should fire');
  assert.ok(r.pulse > 0.9, `chest pulse should snap high; got ${r.pulse}`);
});

test('chest hit does NOT fire on a steady drone (no transient)', () => {
  const sub = new SubBass();
  let now = 0, fires = 0;
  for (let i = 0; i < 300; i++) {
    const r = sub.update(0.4, HOP_MS / 1000, HOP_MS, now);  // constant — no rising edge
    if (r.fired) fires++;
    now += HOP_MS;
  }
  // At most one fire while the drone EMA catches up, then none.
  assert.ok(fires <= 1, `steady drone should not repeatedly fire; got ${fires}`);
});

test('chest hit does NOT fire on silence', () => {
  const sub = new SubBass();
  let now = 0, fires = 0;
  for (let i = 0; i < 300; i++) {
    if (sub.update(0.0, HOP_MS / 1000, HOP_MS, now).fired) fires++;
    now += HOP_MS;
  }
  assert.equal(fires, 0, 'silence must never fire a chest hit');
});

// ── End-to-end: synth → analyzer → shapers (the deployed DSP path) ────────

function driveSynth(synth, seconds) {
  let clock = 0;
  const sig = { onsetLow: 0, onsetMid: 0, onsetHigh: 0, micSub: 0 };
  const analyzer = new AudioAnalyzer({
    sampleRate: SR, fftSize: FFT, hopSize: HOP,
    bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
    kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
    sub:  { minHz: 30, maxHz: 60 },
    nowFn: () => clock,
    onAnalysis: (a) => { sig.onsetLow = a.onsetLow; sig.onsetMid = a.onsetMid; sig.onsetHigh = a.onsetHigh; sig.micSub = a.micSub; },
  });
  const onsets = new BandOnsetBank();
  const sub = new SubBass();
  const buf = new Int16Array(HOP);
  let cursor = 0, prevMs = 0;
  const totalHops = Math.floor((seconds * SR) / HOP);
  const c = { low: 0, mid: 0, high: 0, chest: 0 };
  for (let h = 0; h < totalHops; h++) {
    fillFrame(buf, synth, cursor, SR, {}); cursor += HOP; clock += HOP_MS;
    analyzer.pushSamples(buf);
    const dtMs = h === 0 ? 0 : (clock - prevMs); const dt = dtMs / 1000; prevMs = clock;
    const ob = onsets.update(sig.onsetLow, sig.onsetMid, sig.onsetHigh, dtMs, clock);
    const sb = sub.update(sig.micSub, dt, dtMs, clock);
    if (ob.firedLow) c.low++; if (ob.firedMid) c.mid++; if (ob.firedHigh) c.high++; if (sb.fired) c.chest++;
  }
  return c;
}

test('kick_4floor fires micOnsetLow + audioChestHit, not micOnsetHigh', () => {
  const c = driveSynth('kick_4floor', 6);
  assert.ok(c.low >= 8, `kick should fire onsetLow repeatedly; got ${c.low}`);
  assert.ok(c.chest >= 6, `kick should fire chest hits; got ${c.chest}`);
  assert.equal(c.high, 0, `a pure kick should not fire onsetHigh; got ${c.high}`);
});

test('hats fire micOnsetHigh (dominant over low/chest)', () => {
  const c = driveSynth('hats', 6);
  assert.ok(c.high >= 20, `hats should fire onsetHigh repeatedly; got ${c.high}`);
  assert.ok(c.high > c.low, `high onsets should dominate low; high=${c.high} low=${c.low}`);
  assert.equal(c.chest, 0, `hats have no sub energy → no chest hit; got ${c.chest}`);
});

test('chord_stab fires micOnsetMid (its dominant band)', () => {
  const c = driveSynth('chord_stab', 6);
  assert.ok(c.mid >= 8, `chord stabs should fire onsetMid; got ${c.mid}`);
  assert.ok(c.mid >= c.high, `mid should be at least as active as high; mid=${c.mid} high=${c.high}`);
});

test('edm_drop fires a chest hit on the drop', () => {
  // The drop lands ~7.5 s in (16 build beats @128 BPM), so use a 9 s window.
  const c = driveSynth('edm_drop', 9);
  assert.ok(c.chest >= 1, `the drop should fire at least one chest hit; got ${c.chest}`);
  assert.ok(c.low >= 1, `the drop has kicks → onsetLow fires; got ${c.low}`);
});

test('silence fires nothing through the whole chain', () => {
  const c = driveSynth('silence', 6);
  assert.equal(c.low + c.mid + c.high + c.chest, 0,
    `silence must fire nothing; got low=${c.low} mid=${c.mid} high=${c.high} chest=${c.chest}`);
});
