/**
 * dominant_freq_tracker_retarget.test.js — guards the dom2 RETARGET smoothing.
 *
 * Background (adversary-1 P3): when dom2's smoothed centroid collapses inside
 * dom1's cluster window, `_emit` retargets dom2 to a distinct RAW peak. Before
 * the fix that substitution snapped the emitted dom2 freq to the raw peak value
 * outright → a discontinuous `micDomFreq2` jump on the retarget hop. The fix
 * low-passes the substituted freq toward the PREVIOUS emitted dom2 freq (when
 * the prior is a plausible continuation, i.e. it falls inside the new peak's
 * cluster window), controlled by `retargetBlend` (1 = old raw behaviour).
 *
 * These tests drive the `_emit` retarget branch deterministically by setting up
 * the tracker's internal track/peak state to the exact collapse condition, so
 * the proof is not hostage to fragile end-to-end synth dynamics.
 *
 * Run:  cd marsin_engine && node --test tests/dominant_freq_tracker_retarget.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DominantFreqTracker } from '../../audio/analyzer/dominant_freq_tracker.js';

const BASE = {
  sampleRate: 48000, fftSize: 1024, numTracks: 2, numPeaks: 8,
  relFloor: 0.06, absFloor: 1e-4, maxJumpHz: 90, minFreqHz: 30, maxFreqHz: 8000,
  energyGain: 8.0, clusterThresh: 0.35, clusterMaxHz: 500,
  deathEnergy: 0.02, deathHops: 20, birthEnergy: 0.035,
  useKalman: true, kfFreqQ: 4, kfFreqR: 80, kfEnergyQ: 0.02, kfEnergyR: 0.02, rankAlpha: 0.03,
};

// Arrange the tracker into the exact retarget condition and run _emit().
//   - track[0] (dom1) strong, cluster window [100, 400].
//   - track[1] (dom2) smoothed centroid 250 — INSIDE dom1's window (collapse).
//   - one distinct out-of-window raw peak at `peakFreq`.
//   - the previous emitted dom2 freq is `prevD2`.
function emitRetarget({ retargetBlend, prevD2, peakFreq, peakLo, peakHi }) {
  const tr = new DominantFreqTracker({ ...BASE, retargetBlend });
  const t0 = tr._tracks[0], t1 = tr._tracks[1];
  t0.active = true; t0.freqHz = 200; t0.energy = 0.9; t0.rankEnergy = 0.9;
  t0.loHz = 100; t0.hiHz = 400;
  t1.active = true; t1.freqHz = 250; t1.energy = 0.5; t1.rankEnergy = 0.5; // inside dom1 window
  t1.loHz = 220; t1.hiHz = 280;
  // One distinct candidate peak OUTSIDE dom1's window.
  tr._peakCount = 1;
  tr._peakFreq[0] = peakFreq; tr._peakEner[0] = 0.6;
  tr._peakLo[0] = peakLo; tr._peakHi[0] = peakHi;
  tr._prevD2Freq = prevD2;
  const out = tr._emit();
  return out[1].freqHz;
}

test('retarget: blend=1 reproduces the OLD raw-peak behaviour (no smoothing)', () => {
  // Continuation case: prevD2 (880) sits inside the new peak's window — even so,
  // blend=1 must take the raw peak (900) outright, matching pre-fix behaviour.
  const f = emitRetarget({ retargetBlend: 1, prevD2: 880, peakFreq: 900, peakLo: 820, peakHi: 980 });
  assert.equal(f, 900, `blend=1 should emit the raw peak; got ${f}`);
});

test('retarget: blend<1 low-passes toward the previous dom2 (gentler micDomFreq2)', () => {
  // The raw peak is 900 but the previous emitted dom2 was 880, and 880 is a
  // plausible continuation (inside the new peak's window) → blend halfway.
  const raw = 900, prev = 880;
  const f = emitRetarget({ retargetBlend: 0.5, prevD2: prev, peakFreq: raw, peakLo: 820, peakHi: 980 });
  const expected = 0.5 * raw + 0.5 * prev; // 890
  assert.ok(Math.abs(f - expected) < 1e-9, `blend=0.5 should emit ${expected}; got ${f}`);
  // And the emitted value must be a STRICTLY smaller step from the prior than
  // the raw snap would have been — the whole point of the fix.
  assert.ok(Math.abs(f - prev) < Math.abs(raw - prev),
    `blended step ${Math.abs(f - prev)} should be < raw step ${Math.abs(raw - prev)}`);
});

test('retarget: a DISTANT peak is NOT dragged toward a stale dom2 (guard)', () => {
  // prevD2 (250) is far from the new peak (900) — NOT inside its window — so the
  // blend must be skipped and the raw peak taken (don't smear a genuinely new
  // partial toward an unrelated stale value).
  const f = emitRetarget({ retargetBlend: 0.5, prevD2: 250, peakFreq: 900, peakLo: 820, peakHi: 980 });
  assert.equal(f, 900, `distant retarget should take the raw peak; got ${f}`);
});

test('retarget: with no prior (prevD2=0) the raw peak is taken (first-emit safety)', () => {
  const f = emitRetarget({ retargetBlend: 0.5, prevD2: 0, peakFreq: 900, peakLo: 820, peakHi: 980 });
  assert.equal(f, 900, `prevD2=0 should take the raw peak; got ${f}`);
});

test('default retargetBlend is 0.5 (gentle low-pass shipped)', () => {
  const tr = new DominantFreqTracker(BASE);
  assert.equal(tr.retargetBlend, 0.5);
});
