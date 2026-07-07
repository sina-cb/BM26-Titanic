// Tests for the test SYNTHESIZER bank (audio/synth/test_synths.js) wired into
// the Audio Companion's 'test' source. Two layers:
//   1. fillFrame() produces FINITE Int16 samples in range for EVERY synth.
//   2. Each synth drives the engine's REAL AudioAnalyzer the way it claims:
//      kick_4floor fires kicks, bassline is low-heavy, hats are high-heavy,
//      silence stays silent (the noise gate holds — no phantom kicks).
//
// The analyzer is the engine's real DSP, run here exactly as the Companion runs
// it (same config) so these synths are proven against the same code path that
// drives audio-reactive patterns.
//
// Run:  cd marsin_engine && node --test tests/companion_test_synths.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SYNTHS, SYNTH_NAMES, fillFrame } from '../audio/synth/test_synths.js';
import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';

const SR = 44100, FFT = 1024, HOP = 512;

// The Companion's analyzer config (companion_server.js) — one source of truth.
const ANALYZER_CFG = {
  sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
};

// ── 1) fillFrame fills a valid Int16 frame for EVERY synth ────────────────────
test('fillFrame yields finite in-range Int16 samples for every synth', () => {
  assert.ok(SYNTH_NAMES.length > 0, 'expected at least one synth');
  for (const name of SYNTH_NAMES) {
    const buf = new Int16Array(HOP);
    // Fill several frames so we exercise different absolute sample offsets
    // (beat phases, sweeps, loop sections).
    for (let cursor = 0; cursor < HOP * 8; cursor += HOP) {
      fillFrame(buf, name, cursor, SR, SYNTHS[name].defaults);
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        assert.ok(Number.isFinite(v), `${name}: non-finite sample ${v}`);
        assert.ok(v >= -32767 && v <= 32767, `${name}: sample ${v} out of [-32767,32767]`);
      }
    }
  }
});

// ── 2) drive the REAL analyzer with each synth ────────────────────────────────

/**
 * Run a synth through the real AudioAnalyzer for ~`seconds` of audio and
 * collect per-hop band means + the number of kick FIRES (rising edges of the
 * kick envelope). `nowFn` advances a manual clock so the kick refractory works.
 */
function runSynth(name, seconds, params = {}) {
  let clockMs = 0;
  let kickFires = 0, prevKick = 0;
  let lowSum = 0, midSum = 0, highSum = 0, hops = 0;
  const analyzer = new AudioAnalyzer({
    ...ANALYZER_CFG,
    nowFn: () => clockMs,
    onAnalysis: (r) => {
      hops++;
      lowSum += r.low; midSum += r.mid; highSum += r.high;
      // A FIRE = the kick envelope jumping up to (near) 1.0 from a lower value.
      if (r.kick > 0.9 && prevKick <= 0.9) kickFires++;
      prevKick = r.kick;
    },
  });
  const totalSamples = Math.floor(seconds * SR);
  const buf = new Int16Array(HOP);
  for (let cursor = 0; cursor < totalSamples; cursor += HOP) {
    fillFrame(buf, name, cursor, SR, { ...SYNTHS[name].defaults, ...params });
    clockMs += (HOP / SR) * 1000;
    analyzer.pushSamples(buf);
  }
  return {
    kickFires,
    meanLow: lowSum / (hops || 1),
    meanMid: midSum / (hops || 1),
    meanHigh: highSum / (hops || 1),
    hops,
  };
}

test('kick_4floor produces multiple kick fires', () => {
  const r = runSynth('kick_4floor', 2.0);
  assert.ok(r.kickFires >= 2, `expected >=2 kick fires, got ${r.kickFires}`);
});

test('bassline is low-heavy (mean low > mean high)', () => {
  const r = runSynth('bassline', 2.0);
  assert.ok(r.meanLow > r.meanHigh, `expected meanLow(${r.meanLow.toFixed(3)}) > meanHigh(${r.meanHigh.toFixed(3)})`);
});

test('hats are high-heavy (mean high > mean low)', () => {
  const r = runSynth('hats', 2.0);
  assert.ok(r.meanHigh > r.meanLow, `expected meanHigh(${r.meanHigh.toFixed(3)}) > meanLow(${r.meanLow.toFixed(3)})`);
});

test('silence produces no kick fires (noise gate holds)', () => {
  const r = runSynth('silence', 2.0);
  assert.equal(r.kickFires, 0, `expected 0 kick fires from silence, got ${r.kickFires}`);
});
