// BpmTracker tempo-octave (half/double) tests.
//
// Drives the REAL AudioAnalyzer with deterministic test synths at known tempos
// and asserts the BpmTracker reports the correct metrical level — guarding the
// half/double-tempo (octave) disambiguation:
//   - a known-90 BPM 4-on-floor synth is NOT octave-doubled (~90, not ~180);
//   - a known-128 BPM synth reads ~128;
//   - genuine fast EDM tempos (120..174) are NOT octave-HALVED (the slow-tempo
//     recovery must not regress 4/4 dance tempos);
//   - genuinely FAST material (psytrance ~140-150, DnB ~170-174 — Burning Man
//     runs fast) is recovered, NOT halved: full_track @160/@170 reads ~160/~170,
//     guarding the skewed octave-preference fast-tempo fix (Adv-A report 22 P1-D);
//   - the two-sided tension holds: a slow 4-on-floor groove (kick_4floor @75,
//     the synthetic downtempo proxy) is NOT doubled to ~150;
//   - the histogram fold boundary (kick_4floor @80, just above histFoldLo=80) is
//     preserved (reads ~80, not folded up).
//
// Run:  cd marsin_engine && node --test tests/bpm_tracker_octave.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import { BpmTracker } from '../audio/signals/bpm_tracker.js';
import { SYNTHS } from '../audio/synth/test_synths.js';

const SR = 44100;
const HOP = 512;
const FFT = 2048; // config.yaml audio.fftSize (deployed)
const BANDS = { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04 };
const KICK = { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 70 };
const SUB = { minHz: 30, maxHz: 60 };

/** Render `durSec` of a named synth at `bpm`, return the mean BpmTracker bpm
 *  over the steady tail (last 8 s). */
function measureBpm(synthName, bpm, durSec = 28) {
  const synth = SYNTHS[synthName];
  const tracker = new BpmTracker();
  let clockMs = 0;
  let lastMs = 0;
  const hopMs = (HOP / SR) * 1000;
  const reports = [];
  const analyzer = new AudioAnalyzer({
    sampleRate: SR, fftSize: FFT, hopSize: HOP, bands: BANDS, kick: KICK, sub: SUB,
    nowFn: () => clockMs,
    onAnalysis: ({ flux, kick }) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000;
      lastMs = clockMs;
      const r = tracker.update(flux, kick, dt);
      reports.push({ tMs: clockMs, bpm: r.bpm });
    },
  });
  const buf = new Float32Array(HOP);
  for (let n = 0; n < durSec * SR; n += HOP) {
    for (let i = 0; i < HOP; i++) {
      buf[i] = Math.max(-1, Math.min(1, synth.sample(n + i, SR, { ...synth.defaults, bpm })));
    }
    clockMs += hopMs;
    analyzer.pushSamples(buf);
  }
  const tail = reports.filter((r) => r.tMs >= (durSec - 8) * 1000);
  return tail.reduce((s, r) => s + r.bpm, 0) / tail.length;
}

test('a known-90 BPM 4-on-floor synth is not octave-doubled', () => {
  const meas = measureBpm('kick_4floor', 90);
  // Must read ~90, not ~180 (double) or ~45 (half).
  assert.ok(Math.abs(meas - 90) / 90 <= 0.06,
    `expected ~90 BPM, got ${meas.toFixed(1)} (octave error)`);
});

test('a known-128 BPM synth reads ~128', () => {
  const meas = measureBpm('full_track', 128);
  assert.ok(Math.abs(meas - 128) / 128 <= 0.05,
    `expected ~128 BPM, got ${meas.toFixed(1)}`);
});

test('genuine fast EDM tempos (120..174) are not octave-halved', () => {
  // The slow-tempo recovery must NOT pull a real fast dance tempo down an
  // octave. Sweep the EDM band on both a kick-only and a full-mix synth.
  for (const synth of ['kick_4floor', 'full_track']) {
    for (const bpm of [120, 124, 128, 132, 140, 150, 174]) {
      const meas = measureBpm(synth, bpm);
      assert.ok(Math.abs(meas - bpm) / bpm <= 0.05,
        `${synth} @ ${bpm}: got ${meas.toFixed(1)} (octave/metric error)`);
    }
  }
});

test('genuinely FAST material (160, 170) is recovered, not halved', () => {
  // Burning Man runs fast (psytrance ~140-150, DnB ~170-174). The skewed
  // octave-preference (octaveSigmaHi 0.60 / centre 128) must let a fast tempo
  // win its ×2 contest against the half so full_track @170 reads ~170, NOT ~85
  // (the pre-existing halving Adv-A flagged in report 22 P1-D).
  for (const bpm of [160, 170]) {
    const meas = measureBpm('full_track', bpm);
    assert.ok(Math.abs(meas - bpm) / bpm <= 0.05,
      `full_track @ ${bpm}: got ${meas.toFixed(1)} (fast tempo HALVED — octave-preference regression)`);
  }
});

test('a slow 4-on-floor groove is NOT doubled (downtempo recovery holds)', () => {
  // The fast-tempo fix must not re-break the slow side: a genuinely slow ~75 BPM
  // 4-on-floor (the synthetic proxy for the corpus downtempo DWK217→72 recovery)
  // must stay ~75, not double to ~150. The protection is the octaveAcRatio gate
  // (the autocorr at the double is far below the slow peak, so the perceptual
  // preference never gets to tip it).
  const meas = measureBpm('kick_4floor', 75);
  assert.ok(Math.abs(meas - 75) / 75 <= 0.06,
    `expected ~75 BPM (not doubled), got ${meas.toFixed(1)}`);
});

test('the histogram fold boundary (80, just above histFoldLo) is preserved', () => {
  // histFoldLo=80: a tempo at the fold boundary keeps its own octave and reads
  // ~80, not folded up. Guards the 95→80 boundary lowering from report 19.
  const meas = measureBpm('kick_4floor', 80);
  assert.ok(Math.abs(meas - 80) / 80 <= 0.05,
    `expected ~80 BPM at the fold boundary, got ${meas.toFixed(1)}`);
});

test('update() FAILS LOUD on non-finite flux/kick/dt (codex P0, no silent poison)', () => {
  // A NaN/Inf input must throw, not silently corrupt the whitening EMA /
  // autocorrelation ring / Kalman for the rest of the session.
  const tracker = new BpmTracker();
  assert.throws(() => tracker.update(NaN, 0, 0.01), /non-finite/);
  assert.throws(() => tracker.update(0, Infinity, 0.01), /non-finite/);
  assert.throws(() => tracker.update(0, 0, NaN), /non-finite/);
  // A finite hop still works after the guard rejects bad input.
  assert.doesNotThrow(() => tracker.update(0.2, 0.1, 0.01));
});
