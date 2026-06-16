// Unit tests for AudioAnalyzer. We synthesise pure sine waves and
// impulse trains, push them through, and assert per-band energy
// + kick behaviour.
//
// Run:  cd marsin_engine && node --test tests/audio_analyzer.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';

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

test('bands.inputGain lifts a quiet signal above the noise gate', () => {
  // A quiet 100 Hz sine that the noise gate would otherwise zero. At unity
  // gain LOW stays gated near 0; raising inputGain lifts it above the gate.
  const quiet = sineInt16(100, 0.2, 0.02); // 100 Hz, 200 ms, amplitude 0.02
  const r1 = []; makeAnalyzer({ bands: { noiseGate: 0.04, inputGain: 1 } }, r1).pushSamples(quiet);
  const r8 = []; makeAnalyzer({ bands: { noiseGate: 0.04, inputGain: 8 } }, r8).pushSamples(quiet);
  assert.ok(lastResult(r1).low < 0.05, `unity gain should leave the quiet band gated, got ${lastResult(r1).low}`);
  assert.ok(lastResult(r8).low > lastResult(r1).low + 0.1, `inputGain=8 should lift LOW well above unity, got ${lastResult(r8).low}`);
});

test('bands.inputGain out of range throws (codex P0)', () => {
  assert.throws(() => makeAnalyzer({ bands: { inputGain: -1 } }, []), /inputGain/);
  assert.throws(() => makeAnalyzer({ bands: { inputGain: 100 } }, []), /inputGain/);
});

test('kick prominence is input-gain-invariant (no softCompress saturation)', () => {
  // The kick fires on the LINEAR energy ratio, so the SAME signal fires the
  // kick the same way regardless of inputGain (was broken when the ratio ran
  // on the saturating softCompressed value). Build a sub + periodic kick.
  function countKicks(inputGain) {
    const results = []; let clock = 0;
    const an = makeAnalyzer({ bands: { noiseGate: 0.04, inputGain } }, results, () => clock);
    const buf = new Int16Array(512);
    for (let i = 0; i < SR * 3; i += 512) {
      for (let j = 0; j < 512; j++) {
        const t = (i + j) / SR;
        let s = Math.sin(2 * Math.PI * 60 * t) * 0.04;
        if ((i + j) % 22050 < 1500) s += Math.sin(2 * Math.PI * 90 * t) * 0.08;
        buf[j] = Math.round(Math.max(-1, Math.min(1, s)) * 32767);
      }
      clock += (512 / SR) * 1000; an.pushSamples(buf);
    }
    return results.filter(r => r.kick >= 0.999).length; // fresh fires (==1.0)
  }
  const k2 = countKicks(2), k8 = countKicks(8);
  assert.ok(k2 > 0, `expected kicks at inputGain=2, got ${k2}`);
  assert.equal(k2, k8, `kick count must be gain-invariant: inputGain2=${k2} vs inputGain8=${k8}`);
});

test('kick does NOT fire on a quiet room at calibrated (unity) gain', () => {
  // Input gain is now a SOURCE stage (applied to the PCM before the FFT), so
  // the kick reads the same conditioned signal as every other band — it is no
  // longer specially decoupled from inputGain (operator design: "kick
  // shouldn't be a different situation"). At unity / calibrated gain the noise
  // gate + ratio detector still keep a quiet room silent. NOTE the trade-off:
  // at EXTREME gain on a quiet room, amplified hiss can now fire — that's the
  // operator's responsibility (calibration sets a healthy gain; the optional
  // source smoothing suppresses HF noise). Low-amplitude white noise here.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  function noiseKicks(inputGain) {
    const results = []; let clock = 0;
    const an = makeAnalyzer({ bands: { noiseGate: 0.04, inputGain } }, results, () => clock);
    const buf = new Int16Array(512);
    for (let i = 0; i < SR * 3; i += 512) {
      for (let j = 0; j < 512; j++) buf[j] = Math.round(rnd() * 0.01 * 32767);
      clock += (512 / SR) * 1000; an.pushSamples(buf);
    }
    return results.filter(r => r.kick >= 0.999).length;
  }
  assert.equal(noiseKicks(1), 0, 'quiet room must not fire kicks at unity gain');
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

// ── Spectral flux (micFlux primitive, docs/30 / research memo §A2) ──────
//
// The analyzer emits a fifth field `flux` on each onAnalysis callback:
// half-wave-rectified spectral flux, normalized to the bands' [0,1]
// scale. SuperFlux-lite (Böck & Widmer 2013). These tests pin: (1) the
// field is present and finite, (2) it's ~0 on a steady tone across hops
// (no spectral change → no rising energy), (3) it spikes on a sudden
// broadband change (a quiet tone followed by loud white noise).

test('onAnalysis emits a finite `flux` field in [0,1]', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(sineInt16(440, 0.1, 0.5));
  assert.ok(results.length > 0, 'expected at least one analysis');
  for (const r of results) {
    assert.ok(typeof r.flux === 'number' && Number.isFinite(r.flux),
      `flux must be a finite number; got ${r.flux}`);
    assert.ok(r.flux >= 0 && r.flux <= 1, `flux must be in [0,1]; got ${r.flux}`);
  }
});

test('flux is ~0 on a steady tone across hops', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  // A long steady tone — after the spectrum settles, consecutive hops
  // have near-identical magnitude spectra so rising-only flux → ~0.
  an.pushSamples(sineInt16(440, 0.5, 0.5));
  // Skip the first few hops (ring buffer still filling / spectrum
  // ramping in) and check the tail is quiet.
  const tail = results.slice(Math.floor(results.length / 2));
  assert.ok(tail.length > 0);
  for (const r of tail) {
    assert.ok(r.flux < 0.05, `steady-tone flux should be ~0; got ${r.flux}`);
  }
});

test('flux spikes on a sudden broadband change', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  // Settle on a quiet tone, capture the steady flux, then hit it with
  // loud broadband noise — the magnitude spectrum jumps across many
  // bins so half-wave-rectified flux spikes.
  an.pushSamples(sineInt16(440, 0.4, 0.2));
  const steadyTail = results.slice(-3);
  const steadyMax = Math.max(...steadyTail.map(r => r.flux));
  const beforeCount = results.length;
  an.pushSamples(whiteNoiseInt16(0.1, 0.7));
  const afterNoise = results.slice(beforeCount);
  const spikeMax = Math.max(...afterNoise.map(r => r.flux));
  assert.ok(spikeMax > steadyMax + 0.05,
    `flux should spike on broadband change; steadyMax=${steadyMax} spikeMax=${spikeMax}`);
});

test('reset() clears the prev-spectrum so flux settles back to ~0', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  // Run loud noise (high flux), reset, then a steady tone. After reset
  // the stored prev-spectrum is cleared (null) and re-allocated zeroed,
  // so the first post-reset hop diffs against an empty spectrum — but
  // once the spectrum settles, consecutive steady hops produce ~0 flux.
  // We assert the tail of the steady run is quiet, proving reset didn't
  // leave stale prev-spectrum state bleeding in.
  an.pushSamples(whiteNoiseInt16(0.2, 0.6));
  an.reset();
  const before = results.length;
  an.pushSamples(sineInt16(440, 0.4, 0.5));
  const fresh = results.slice(before);
  assert.ok(fresh.length >= 3, 'expected several analyses after reset');
  const tail = fresh.slice(Math.floor(fresh.length / 2));
  for (const r of tail) {
    assert.ok(r.flux < 0.05, `post-reset steady flux should settle to ~0; got ${r.flux}`);
  }
});

// ── Dominant-frequency tracking (dom1/dom2 + energy) ─────────────────────

test('dominant-frequency tracker locks onto a pure tone', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  // A strong, steady 440 Hz tone — dom1 should lock onto it with energy > 0.
  an.pushSamples(sineInt16(440, 0.6, 0.7));
  const r = lastResult(results);
  // New payload fields exist and are finite.
  for (const k of ['domFreq1', 'domEnergy1', 'domFreq2', 'domEnergy2']) {
    assert.ok(Number.isFinite(r[k]), `${k} should be a finite number; got ${r[k]}`);
  }
  // dom1 ≈ 440 Hz (parabolic interp → within a couple of bins at fftSize 1024).
  assert.ok(Math.abs(r.domFreq1 - 440) < 25,
    `dom1 should lock near 440 Hz; got ${r.domFreq1.toFixed(1)} Hz`);
  assert.ok(r.domEnergy1 > 0 && r.domEnergy1 <= 1,
    `dom1 energy should be in (0, 1]; got ${r.domEnergy1}`);
  // Single tone → dom2 has nothing strong to lock (energy stays low).
  assert.ok(r.domEnergy2 <= r.domEnergy1,
    'dom2 energy should not exceed dom1 for a single tone');
});

test('dominant-frequency tracker follows a frequency change', () => {
  const results = [];
  const an = makeAnalyzer({}, results);
  an.pushSamples(sineInt16(300, 0.5, 0.7));
  const lowF = lastResult(results).domFreq1;
  an.pushSamples(sineInt16(1200, 0.5, 0.7));
  const highF = lastResult(results).domFreq1;
  assert.ok(Math.abs(lowF - 300) < 30, `dom1 should track 300 Hz; got ${lowF.toFixed(1)}`);
  assert.ok(Math.abs(highF - 1200) < 40, `dom1 should re-lock to 1200 Hz; got ${highF.toFixed(1)}`);
});
