// Unit tests for AudioAnalyzer. We synthesise pure sine waves and
// impulse trains, push them through, and assert per-band energy
// + kick behaviour.
//
// Run:  cd marsin_engine && node --test tests/audio_analyzer.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioAnalyzer } from '../lib/audio_analyzer.js';

const SR = 44100;

function sineInt16(freqHz, durationS, amplitude = 0.6) {
  const N = Math.floor(SR * durationS);
  const a = Math.max(0, Math.min(1, amplitude));
  const out = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freqHz * i) / SR) * a * 32767);
  }
  return out;
}

function whiteNoiseInt16(durationS, amplitude = 0.3) {
  const N = Math.floor(SR * durationS);
  const out = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = Math.round((Math.random() * 2 - 1) * amplitude * 32767);
  }
  return out;
}

/** Default analyzer config — matches docs/25 §7 defaults. */
function makeAnalyzer(overrides = {}, results, nowFn) {
  const { bands: bandOverrides, kick: kickOverrides, ...rest } = overrides;
  return new AudioAnalyzer({
    sampleRate: SR,
    fftSize: 1024,
    hopSize: 512,
    bands: { lowMaxHz: 250, midMaxHz: 2000, smoothingAlpha: 0.9, ...(bandOverrides || {}) },
    kick:  { minHz: 40, maxHz: 120, threshold: 1.6, refractoryMs: 200, decayMs: 80, ...(kickOverrides || {}) },
    onAnalysis: (r) => results.push(r),
    nowFn,
    ...rest,
  });
}

function lastResult(results) {
  return results[results.length - 1];
}

// ── Construction validation ──────────────────────────────────────────────

test('throws on non-power-of-two fftSize', () => {
  assert.throws(() => new AudioAnalyzer({
    sampleRate: SR, fftSize: 1000,
    bands: { lowMaxHz: 250, midMaxHz: 2000, smoothingAlpha: 0.5 },
    kick:  { minHz: 40, maxHz: 120, threshold: 1.6, refractoryMs: 200, decayMs: 120 },
    onAnalysis: () => {},
  }));
});

test('throws on inverted band edges', () => {
  const results = [];
  assert.throws(() => makeAnalyzer({ bands: { lowMaxHz: 3000, midMaxHz: 2000 } }, results));
});

test('throws on out-of-range smoothingAlpha', () => {
  const results = [];
  assert.throws(() => makeAnalyzer({ bands: { smoothingAlpha: 0 } }, results));
  assert.throws(() => makeAnalyzer({ bands: { smoothingAlpha: 1.5 } }, results));
});

test('throws on kick threshold <= 1', () => {
  const results = [];
  assert.throws(() => makeAnalyzer({ kick: { threshold: 1.0 } }, results));
});

// ── Band-energy steering ─────────────────────────────────────────────────

test('100 Hz sine lights up LOW, leaves MID and HIGH quiet', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(sineInt16(100, 1.0));
  const r = lastResult(results);
  assert.ok(r.low > 0.4,  `low should be loud, got ${r.low}`);
  assert.ok(r.mid < 0.1,  `mid should be quiet, got ${r.mid}`);
  assert.ok(r.high < 0.1, `high should be quiet, got ${r.high}`);
});

test('1000 Hz sine lights up MID', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(sineInt16(1000, 1.0));
  const r = lastResult(results);
  assert.ok(r.mid > 0.4,  `mid should be loud, got ${r.mid}`);
  assert.ok(r.low < 0.1,  `low should be quiet, got ${r.low}`);
  assert.ok(r.high < 0.1, `high should be quiet, got ${r.high}`);
});

test('8000 Hz sine lights up HIGH', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(sineInt16(8000, 1.0));
  const r = lastResult(results);
  assert.ok(r.high > 0.4, `high should be loud, got ${r.high}`);
  assert.ok(r.low < 0.1,  `low should be quiet, got ${r.low}`);
  assert.ok(r.mid < 0.1,  `mid should be quiet, got ${r.mid}`);
});

test('white noise produces non-trivial energy in all three bands', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(whiteNoiseInt16(1.0, 0.5));
  const r = lastResult(results);
  assert.ok(r.low > 0.05);
  assert.ok(r.mid > 0.05);
  assert.ok(r.high > 0.05);
});

test('silence keeps all bands at zero', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(new Int16Array(SR));   // all zeros
  const r = lastResult(results);
  assert.equal(r.low, 0);
  assert.equal(r.mid, 0);
  assert.equal(r.high, 0);
  assert.equal(r.kick, 0);
});

// ── Smoothing ────────────────────────────────────────────────────────────

test('lower smoothingAlpha makes transient response slower', () => {
  // Run two analyzers in parallel: snappy (alpha=0.9) and smooth (alpha=0.1).
  // Feed quiet → loud transition; the smooth one should still lag below the
  // snappy one after a short burst.
  const snappy = [], smooth = [];
  const aSnappy = makeAnalyzer({ bands: { smoothingAlpha: 0.9 } }, snappy);
  const aSmooth = makeAnalyzer({ bands: { smoothingAlpha: 0.1 } }, smooth);
  const quiet = new Int16Array(SR / 2);             // 0.5 s silence
  const loud  = sineInt16(100, 0.2, 0.9);           // 0.2 s loud sine
  aSnappy.pushSamples(quiet); aSmooth.pushSamples(quiet);
  aSnappy.pushSamples(loud);  aSmooth.pushSamples(loud);
  // First analysis frame after the transition: snap should be much higher.
  const firstHopAfterTransition = Math.floor(quiet.length / 512); // index
  const snappyVal = snappy[firstHopAfterTransition + 1]?.low ?? 0;
  const smoothVal = smooth[firstHopAfterTransition + 1]?.low ?? 0;
  assert.ok(snappyVal > smoothVal, `snappy(${snappyVal}) should exceed smooth(${smoothVal})`);
});

// ── Kick detector ────────────────────────────────────────────────────────

test('repeated kick-band impulses fire kicks with refractory respected', () => {
  // Synthesize a quiet bed of low-freq noise + sharp 60 Hz pulses every 0.3s.
  // refractoryMs is 200 → 0.3s spacing → each pulse should fire.
  // We use a synthetic clock so we don't depend on wall time.
  const results = [];
  let now = 0;
  const nowFn = () => now;
  const an = makeAnalyzer({
    kick: { threshold: 1.5, refractoryMs: 200, decayMs: 80, minHz: 40, maxHz: 120 },
    bands: { smoothingAlpha: 0.9 },
  }, results, nowFn);

  // 5 seconds of quiet 60 Hz bed at low amplitude to establish EMA.
  const bed = sineInt16(60, 5.0, 0.05);
  an.pushSamples(bed); now += 5000;

  // Now: 5 loud 60 Hz bursts spaced 300 ms apart.
  let kicks = 0;
  let lastKickWasNew = false;
  const prevKicks = results.length;
  for (let i = 0; i < 5; i++) {
    const burst = sineInt16(60, 0.05, 0.95);     // 50 ms loud burst
    const gap   = sineInt16(60, 0.25, 0.05);     // 250 ms quiet
    an.pushSamples(burst);
    now += 50;
    an.pushSamples(gap);
    now += 250;
  }
  // Count how many analyses had kick > 0.9 (= a fresh kick fire).
  for (let i = prevKicks; i < results.length; i++) {
    if (results[i].kick > 0.9) {
      if (!lastKickWasNew) { kicks++; lastKickWasNew = true; }
    } else if (results[i].kick < 0.1) {
      lastKickWasNew = false;
    }
  }
  assert.ok(kicks >= 4 && kicks <= 5, `expected ~5 kick fires, saw ${kicks}`);
});

test('kick refractory prevents two fires within refractoryMs', () => {
  const results = [];
  let now = 0;
  const an = makeAnalyzer({
    kick: { threshold: 1.5, refractoryMs: 1000, decayMs: 50, minHz: 40, maxHz: 120 },
    bands: { smoothingAlpha: 0.9 },
  }, results, () => now);
  // Long bed to build EMA.
  an.pushSamples(sineInt16(60, 5.0, 0.05));
  now += 5000;
  // Two loud bursts 100ms apart (well below 1000ms refractory).
  an.pushSamples(sineInt16(60, 0.05, 0.95));
  now += 50;
  an.pushSamples(sineInt16(60, 0.05, 0.05));
  now += 50;
  an.pushSamples(sineInt16(60, 0.05, 0.95));
  now += 50;
  // Count fresh fires (kick > 0.9 after a low).
  let fires = 0, wasHot = false;
  for (const r of results) {
    if (r.kick > 0.9 && !wasHot) { fires++; wasHot = true; }
    else if (r.kick < 0.5) wasHot = false;
  }
  assert.equal(fires, 1, `refractory should suppress second fire; got ${fires}`);
});

// ── reconfigure ──────────────────────────────────────────────────────────

test('reconfigure rebinds bands without dropping the stream', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  // 1000 Hz lands in MID with default cutoffs.
  an.pushSamples(sineInt16(1000, 0.5));
  const beforeMid = lastResult(results).mid;

  // Reconfigure so 1000 Hz is now LOW (lowMaxHz raised to 1500).
  // Note: band energy is RMS-per-bin then soft-compressed, so wider
  // bands report lower absolute values. We assert _relative_ band
  // ordering rather than an absolute threshold to stay robust to
  // band-width-driven normalization.
  an.reconfigure({ bands: { lowMaxHz: 1500 } });
  an.reset();
  an.pushSamples(sineInt16(1000, 0.5));
  const r = lastResult(results);
  assert.ok(r.low > r.mid * 2, `after rebin, LOW should dominate MID; got low=${r.low} mid=${r.mid}`);
  assert.ok(r.low > r.high * 2, `after rebin, LOW should dominate HIGH; got low=${r.low} high=${r.high}`);
  // Sanity: MID is much smaller than it used to be when 1000Hz lived there.
  assert.ok(r.mid < beforeMid * 0.2, `MID should drop after rebin; got ${r.mid} vs ${beforeMid}`);
});

test('reconfigure rejects invalid bands', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  assert.throws(() => an.reconfigure({ bands: { lowMaxHz: 5000, midMaxHz: 2000 } }));
});
