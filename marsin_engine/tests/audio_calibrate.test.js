// Unit tests for tools/audio_calibrate.js pure helpers.
//
// Live audio capture can't run reliably in CI/headless, so the analysis
// math lives in pure helpers (summarizeBandSamples, parseArgs) that we
// exercise here without touching a microphone.
//
// Run:  cd marsin_engine && node --test tests/audio_calibrate.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeBandSamples, parseArgs } from '../audio/calibrate/audio_calibrate.js';

function approxEqual(actual, expected, eps = 1e-9, msg = '') {
  assert.ok(Math.abs(actual - expected) < eps,
    `${msg} expected ≈${expected}, got ${actual}`);
}

// ── summarizeBandSamples ─────────────────────────────────────────────────────

test('summarizeBandSamples: min/median/max per band on a known set', () => {
  const samples = [
    { low: 0.1, mid: 0.2, high: 0.3 },
    { low: 0.3, mid: 0.4, high: 0.5 },
    { low: 0.5, mid: 0.6, high: 0.7 },
  ];
  const s = summarizeBandSamples(samples);
  assert.equal(s.hops, 3);
  approxEqual(s.perBand.low.min, 0.1);
  approxEqual(s.perBand.low.median, 0.3); // middle of {0.1,0.3,0.5}
  approxEqual(s.perBand.low.max, 0.5);
  approxEqual(s.perBand.high.min, 0.3);
  approxEqual(s.perBand.high.median, 0.5);
  approxEqual(s.perBand.high.max, 0.7);
});

test('summarizeBandSamples: median interpolates for even counts (type-7)', () => {
  // Four values {0.0, 0.2, 0.4, 0.6}; type-7 median = 0.3 (between 0.2,0.4).
  const samples = [
    { low: 0.0, mid: 0, high: 0 },
    { low: 0.2, mid: 0, high: 0 },
    { low: 0.4, mid: 0, high: 0 },
    { low: 0.6, mid: 0, high: 0 },
  ];
  const s = summarizeBandSamples(samples);
  approxEqual(s.perBand.low.median, 0.3, 1e-9);
});

test('summarizeBandSamples: suggestedNoiseGate is p90 of per-hop loudest band', () => {
  // loudest-per-hop = [0.1, 0.2, ..., 1.0] for 10 hops. p90 (type-7) over
  // a sorted 10-element list lands at index 0.9*9 = 8.1 → interp between
  // sorted[8]=0.9 and sorted[9]=1.0 → 0.9 + 0.1*0.1 = 0.91. But the gate
  // is clamped below 1, and 0.91 < 1 so it passes through.
  const samples = [];
  for (let i = 1; i <= 10; i++) {
    const v = i / 10;
    // Put the loudest value in a rotating band so "loudest per hop" == v.
    samples.push({ low: v, mid: 0, high: 0 });
  }
  const s = summarizeBandSamples(samples);
  approxEqual(s.suggestedNoiseGate, 0.91, 1e-9);
});

test('summarizeBandSamples: a near-silent quiet room yields a small gate', () => {
  // Simulate HVAC floor — tiny values with one occasional blip.
  const samples = [];
  for (let i = 0; i < 100; i++) {
    samples.push({ low: 0.02, mid: 0.01, high: 0.015 });
  }
  const s = summarizeBandSamples(samples);
  // loudest-per-hop is a constant 0.02 → p90 is 0.02.
  approxEqual(s.suggestedNoiseGate, 0.02, 1e-9);
  // And the suggested gate is a legal noiseGate ([0, 1)).
  assert.ok(s.suggestedNoiseGate >= 0 && s.suggestedNoiseGate < 1);
});

test('summarizeBandSamples: all-ones capture clamps gate below 1 (legal noiseGate)', () => {
  const samples = Array.from({ length: 20 }, () => ({ low: 1, mid: 1, high: 1 }));
  const s = summarizeBandSamples(samples);
  assert.ok(s.suggestedNoiseGate < 1, 'gate must stay below 1 to be a legal noiseGate');
  approxEqual(s.suggestedNoiseGate, 0.99);
});

test('summarizeBandSamples: throws on empty sample set (loud, no misleading zeros)', () => {
  assert.throws(() => summarizeBandSamples([]), /no samples/);
});

test('summarizeBandSamples: throws on non-array', () => {
  assert.throws(() => summarizeBandSamples(null), /must be an array/);
});

test('summarizeBandSamples: throws on a non-finite band value (Codex P0 fail loud)', () => {
  assert.throws(
    () => summarizeBandSamples([{ low: Number.NaN, mid: 0.1, high: 0.2 }]),
    /non-finite/,
  );
});

// ── parseArgs ────────────────────────────────────────────────────────────────

test('parseArgs: defaults when no flags', () => {
  const cfg = parseArgs([]);
  assert.equal(cfg.seconds, 10);
  assert.equal(cfg.sampleRate, 44100);
  assert.equal(cfg.fftSize, 1024);
  assert.equal(cfg.hopSize, 512);
  assert.equal(cfg.device, null);
});

test('parseArgs: --seconds / --device / --mic / --sample-rate / --fft / --hop', () => {
  const cfg = parseArgs(['--seconds', '5', '--device', ':2', '--sample-rate', '48000', '--fft', '2048', '--hop', '1024']);
  assert.equal(cfg.seconds, 5);
  assert.equal(cfg.device, ':2');
  assert.equal(cfg.sampleRate, 48000);
  assert.equal(cfg.fftSize, 2048);
  assert.equal(cfg.hopSize, 1024);
  // --mic is an alias for --device.
  assert.equal(parseArgs(['--mic', 'default']).device, 'default');
});

test('parseArgs: --help sets help flag', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: rejects unknown flag (Codex P0 — no silent default-on-typo)', () => {
  assert.throws(() => parseArgs(['--secondz', '5']), /unknown flag/);
});

test('parseArgs: rejects a flag missing its value', () => {
  assert.throws(() => parseArgs(['--seconds']), /requires a value/);
});

test('parseArgs: rejects non-positive --seconds and non-integer --fft', () => {
  assert.throws(() => parseArgs(['--seconds', '0']), /positive number/);
  assert.throws(() => parseArgs(['--seconds', 'abc']), /positive number/);
  assert.throws(() => parseArgs(['--fft', '1024.5']), /positive integer/);
});
