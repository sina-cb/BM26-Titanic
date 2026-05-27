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

/** Default analyzer config — matches the 2026-05-25 EDM-tuned
 *  config.yaml defaults. Tests can spread overrides to retune.
 *  Attack/release here are intentionally snappy (5 / 30 ms) so
 *  step-response tests don't need long sample feeds to settle. */
function makeAnalyzer(overrides = {}, results, nowFn) {
  const { bands: bandOverrides, kick: kickOverrides, ...rest } = overrides;
  return new AudioAnalyzer({
    sampleRate: SR,
    fftSize: 1024,
    hopSize: 512,
    bands: {
      lowMaxHz: 250, midMaxHz: 2000,
      attackMs: 5, releaseMs: 30, noiseGate: 0,
      ...(bandOverrides || {}),
    },
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
    bands: { lowMaxHz: 250, midMaxHz: 2000, attackMs: 8, releaseMs: 180, noiseGate: 0.04 },
    kick:  { minHz: 40, maxHz: 120, threshold: 1.6, refractoryMs: 200, decayMs: 120 },
    onAnalysis: () => {},
  }));
});

test('throws on inverted band edges', () => {
  const results = [];
  assert.throws(() => makeAnalyzer({ bands: { lowMaxHz: 3000, midMaxHz: 2000 } }, results));
});

test('throws on missing or out-of-range attack/release/noiseGate', () => {
  const results = [];
  // No fallbacks: each field must be present and within its range.
  assert.throws(() => makeAnalyzer({ bands: { attackMs: 0 } }, results));
  assert.throws(() => makeAnalyzer({ bands: { releaseMs: 0 } }, results));
  assert.throws(() => makeAnalyzer({ bands: { attackMs: 6000 } }, results));
  assert.throws(() => makeAnalyzer({ bands: { noiseGate: -0.01 } }, results));
  assert.throws(() => makeAnalyzer({ bands: { noiseGate: 1.0 } }, results));
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

// ── Envelope (attack / release) ──────────────────────────────────────────

test('shorter attackMs makes the band rise faster on a peak', () => {
  // Two analyzers, fast vs slow attack. Both have the same long
  // release so the difference we measure isolates the attack edge.
  const fast = [], slow = [];
  const aFast = makeAnalyzer({ bands: { attackMs: 2,  releaseMs: 200 } }, fast);
  const aSlow = makeAnalyzer({ bands: { attackMs: 50, releaseMs: 200 } }, slow);
  const quiet = new Int16Array(SR / 2);             // 0.5 s silence
  const loud  = sineInt16(100, 0.2, 0.9);           // 0.2 s loud sine
  aFast.pushSamples(quiet); aSlow.pushSamples(quiet);
  aFast.pushSamples(loud);  aSlow.pushSamples(loud);
  // First analysis frame after the transition: fast should be much higher.
  const firstHopAfterTransition = Math.floor(quiet.length / 512);
  const fastVal = fast[firstHopAfterTransition + 1]?.low ?? 0;
  const slowVal = slow[firstHopAfterTransition + 1]?.low ?? 0;
  assert.ok(fastVal > slowVal, `fast(${fastVal}) should exceed slow(${slowVal})`);
});

test('longer releaseMs holds the band higher after a peak', () => {
  // Same attack on both, different release. After the loud sine
  // ends, the long-release analyzer's LOW should still be above the
  // short-release one for the first few quiet hops.
  const longRel  = [], shortRel = [];
  const aLong  = makeAnalyzer({ bands: { attackMs: 5, releaseMs: 400 } }, longRel);
  const aShort = makeAnalyzer({ bands: { attackMs: 5, releaseMs: 30  } }, shortRel);
  const loud   = sineInt16(100, 0.3, 0.9);   // 0.3 s loud sine
  const quiet  = new Int16Array(Math.floor(SR * 0.1)); // 0.1 s silence
  aLong.pushSamples(loud);  aShort.pushSamples(loud);
  aLong.pushSamples(quiet); aShort.pushSamples(quiet);
  // Sample a hop a couple frames into the quiet section.
  const sampleIdx = Math.floor((loud.length + 512 * 2) / 512);
  const longVal  = longRel[sampleIdx]?.low ?? 0;
  const shortVal = shortRel[sampleIdx]?.low ?? 0;
  assert.ok(longVal > shortVal,
    `long-release(${longVal}) should hold above short-release(${shortVal})`);
});

// ── Noise gate ───────────────────────────────────────────────────────────

test('noiseGate suppresses quiet signals below the floor', () => {
  // A very low-amplitude 100 Hz sine should land just barely above 0
  // with no gate, but be fully suppressed with a 0.3 gate. We use
  // amplitude 0.02 — pre-clamp gain × softCompress yields a band
  // value < 0.3 but > 0, sitting squarely in the gate window.
  const noGate = [], withGate = [];
  const aNoGate   = makeAnalyzer({ bands: { noiseGate: 0.0 } }, noGate);
  const aWithGate = makeAnalyzer({ bands: { noiseGate: 0.3 } }, withGate);
  const tiny = sineInt16(100, 0.5, 0.02);
  aNoGate.pushSamples(tiny);
  aWithGate.pushSamples(tiny);
  const ungatedVal = lastResult(noGate).low;
  const gatedVal   = lastResult(withGate).low;
  assert.ok(ungatedVal > 0,    `ungated should be > 0; got ${ungatedVal}`);
  assert.equal(gatedVal,    0, `gated should be 0; got ${gatedVal}`);
});

test('noiseGate preserves dynamic range above the floor', () => {
  // Loud input should still produce a non-trivial reading with a
  // moderate gate; the gate only zeros sub-floor values. Values
  // above the floor are linearly rescaled into [0, 1] from
  // [gate, 1], so the meter shouldn't collapse to zero on a loud
  // signal just because the gate is enabled.
  const withGate = [];
  const aWithGate = makeAnalyzer({ bands: { noiseGate: 0.05 } }, withGate);
  const loud = sineInt16(100, 0.5, 0.4);
  aWithGate.pushSamples(loud);
  const gatedVal = lastResult(withGate).low;
  assert.ok(gatedVal > 0.3, `loud signal with gate should still ride > 0.3; got ${gatedVal}`);
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
    // Defaults from makeAnalyzer (snappy 5/30 ms, no gate) work fine.
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

test('kick detector survives sustained loud bass without drift', () => {
  // Regression for the EMA-drift bug documented in
  // .agent/02_reports/202605/20260526_1_audio_analysis_report.md
  // Concern 5: under sustained loud kick-band content (a heavy
  // bassline at high duty cycle) the original symmetric EMA tracked
  // the loud baseline UP and never decayed. The fire test
  // (instant > ema * threshold) became unreachable because the
  // baseline IS roughly the threshold; kicks stopped firing after
  // ~30 s of consistent loud bass.
  //
  // Test signal — high-duty kick-band pulses (250 ms loud + 50 ms
  // quiet at amplitude 0.85, 60 Hz, in-band for the kick detector,
  // ~3.3 Hz pulse rate). With the OLD symmetric coefficients +
  // unbounded EMA this drives the EMA up to ~0.28 within ~10 s and
  // kicks STOP firing for the remainder of the 60 s window. With
  // the asymmetric attack/release + ceiling clamp fix, the EMA
  // stays low enough that pulses continue to fire kicks throughout.
  const results = [];
  let now = 0;
  const an = makeAnalyzer({
    kick: { threshold: 1.5, refractoryMs: 100, decayMs: 80, minHz: 40, maxHz: 120 },
  }, results, () => now);

  // 60 seconds of high-duty 60 Hz pulses, bucketed into six 10-sec
  // windows so we can verify kicks continue firing late in the run.
  const firesByBucket = [0, 0, 0, 0, 0, 0];
  let wasHot = false;
  for (let sec = 0; sec < 60; sec++) {
    const before = results.length;
    for (let i = 0; i < 3; i++) {       // ~3.3 pulses per second
      an.pushSamples(sineInt16(60, 0.25, 0.85));
      now += 250;
      an.pushSamples(sineInt16(60, 0.05, 0.05));
      now += 50;
    }
    const bucket = Math.min(5, Math.floor(sec / 10));
    for (let j = before; j < results.length; j++) {
      if (results[j].kick > 0.9 && !wasHot) { firesByBucket[bucket]++; wasHot = true; }
      else if (results[j].kick < 0.5) wasHot = false;
    }
  }

  // The last bucket (seconds 50–60) is what matters: with OLD code
  // it sees 0 fires; with the fix it sees ~30. Require at least 5 to
  // leave headroom for coefficient retuning.
  const lateBucket = firesByBucket[5];
  assert.ok(
    lateBucket >= 5,
    `expected continued kick fires in the final 10 s of a 60 s ` +
    `sustained-bass run, saw ${lateBucket}; per-bucket = ` +
    `[${firesByBucket.join(', ')}]. EMA-drift regression — see ` +
    `audio_analysis_report.md Concern 5.`,
  );
});

test('kick refractory prevents two fires within refractoryMs', () => {
  const results = [];
  let now = 0;
  const an = makeAnalyzer({
    kick: { threshold: 1.5, refractoryMs: 1000, decayMs: 50, minHz: 40, maxHz: 120 },
    // Defaults from makeAnalyzer (snappy 5/30 ms, no gate) work fine.
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

// ── Per-band gain coverage now lives in signal_post_processor.test.js ──
//
// As of docs/29 Phase 2 (2026-05-26), per-band gain is the first op of
// the chain framework (`lib/signal_post_processor.js`), not analyzer-
// internal. The analyzer is back to being a pure data source emitting
// raw post-envelope band values; the engine's onAnalysis callback
// wraps each value through `signalPostProcessor.process()` before
// writing to CPC. Gain math + paramKey live-read + clamp behaviour
// is now covered by tests/signal_post_processor.test.js.
