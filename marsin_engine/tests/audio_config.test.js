// Unit tests for audio_config.js — merge, validate, round-trip YAML.
//
// Run:  cd marsin_engine && node --test tests/audio_config.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  loadAudioConfig, saveAudioConfig,
  mergeAudioConfig, pickLiveFields, validateLivePatch,
  AUDIO_LIVE_FIELDS,
} from '../audio/config/audio_config.js';

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-audio-cfg-'));
  return d;
}

const FULL_CFG = {
  enabled: true,
  capture: { backend: 'ffmpeg', device: ':0', sampleRate: 44100, channels: 1 },
  fftSize: 1024, hopSize: 512,
  bands:   { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04 },
  kick:    { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 120 },
};

test('loadAudioConfig returns {} when the override file is missing', () => {
  const d = tmpDir();
  assert.deepEqual(loadAudioConfig(d), {});
});

test('saveAudioConfig + loadAudioConfig round-trip the live subset', () => {
  const d = tmpDir();
  const live = { bands: { lowMaxHz: 300 }, kick: { threshold: 2.0 } };
  saveAudioConfig(d, live);
  const back = loadAudioConfig(d);
  assert.deepEqual(back, live);
  // File starts with a do-not-edit header.
  const raw = fs.readFileSync(path.join(d, 'audio_config.yaml'), 'utf8');
  assert.ok(raw.startsWith('# Auto-written'), 'header preserved');
});

test('mergeAudioConfig: later layers override earlier; nested objects merge', () => {
  const a = { bands: { lowMaxHz: 250, midMaxHz: 2000 } };
  const b = { bands: { lowMaxHz: 300 } };
  const c = { enabled: false };
  const m = mergeAudioConfig(a, b, c);
  assert.deepEqual(m.bands, { lowMaxHz: 300, midMaxHz: 2000 });
  assert.equal(m.enabled, false);
});

test('mergeAudioConfig: undefined and null layers are skipped', () => {
  const m = mergeAudioConfig(null, undefined, { fftSize: 1024 }, undefined);
  assert.deepEqual(m, { fftSize: 1024 });
});

test('pickLiveFields keeps scene-level scalars + bands + kick + mic-selection subset', () => {
  // pickLiveFields is what the engine writes to
  // states/<scene>/audio_state.yaml on every PATCH /audio/config. As
  // of the iPad mic picker, it ALSO includes the operator's mic
  // selection (capture mic-identity fields). Runtime knobs like
  // backend/sampleRate/channels stay sourced from config.yaml and
  // never leak into the per-scene file.
  const out = pickLiveFields({
    ...FULL_CFG,
    capture: {
      backend: 'ffmpeg', sampleRate: 44100, channels: 1,                  // dropped
      platform: 'darwin', inputFormat: 'avfoundation',                    // kept
      device: ':1', deviceId: 'avfoundation-audio-1', deviceLabel: 'MBP', // kept
    },
  });
  assert.deepEqual(out, {
    enabled: true,
    fftSize: 1024,
    hopSize: 512,
    bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04 },
    kick:  { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 120 },
    capture: {
      platform: 'darwin', inputFormat: 'avfoundation',
      device: ':1', deviceId: 'avfoundation-audio-1', deviceLabel: 'MBP',
    },
  });
});

test('pickLiveFields omits capture entirely when no mic-identity fields are set', () => {
  // backend / sampleRate / channels are runtime fields, not mic
  // identity — they must not produce an empty `capture:` block.
  const out = pickLiveFields({
    ...FULL_CFG,
    capture: { backend: 'ffmpeg', sampleRate: 44100, channels: 1 },
  });
  assert.equal(out.capture, undefined);
});

test('validateLivePatch accepts a well-formed bands+kick PATCH', () => {
  const v = validateLivePatch({ bands: { lowMaxHz: 200 }, kick: { threshold: 1.8 } });
  assert.ok(v.ok);
  assert.deepEqual(v.live, { bands: { lowMaxHz: 200 }, kick: { threshold: 1.8 } });
  assert.equal(v.requiresCaptureRestart, false);
});

test('validateLivePatch accepts mic-identity capture changes (iPad mic picker)', () => {
  const v = validateLivePatch({
    capture: { device: ':2', deviceLabel: 'USB Mic', deviceId: 'avfoundation-audio-2', inputFormat: 'avfoundation', platform: 'darwin' },
  });
  assert.ok(v.ok, v.error);
  assert.equal(v.requiresCaptureRestart, true);
  assert.deepEqual(v.live.capture.device, ':2');
});

test('validateLivePatch accepts an `enabled` toggle (iPad master switch)', () => {
  const v = validateLivePatch({ enabled: false });
  assert.ok(v.ok);
  assert.equal(v.live.enabled, false);
  assert.equal(v.requiresCaptureRestart, true);
});

test('validateLivePatch rejects non-mic-identity capture fields', () => {
  // backend, sampleRate, channels still require an engine restart —
  // surface a clear error so the iPad doesn't silently fail.
  const v = validateLivePatch({ capture: { sampleRate: 48000 } });
  assert.equal(v.ok, false);
  assert.match(v.error, /capture\.sampleRate.+not live-tunable/);
});

test('validateLivePatch rejects config-only top-level fields', () => {
  const v = validateLivePatch({ fftSize: 2048 });
  assert.equal(v.ok, false);
  assert.match(v.error, /not live-tunable/);
});

test('validateLivePatch rejects non-boolean enabled', () => {
  const v = validateLivePatch({ enabled: 'yes' });
  assert.equal(v.ok, false);
  assert.match(v.error, /"enabled" must be a boolean/);
});

test('validateLivePatch rejects unknown fields inside a known group', () => {
  const v = validateLivePatch({ bands: { mysteryHz: 100 } });
  assert.equal(v.ok, false);
  assert.match(v.error, /bands\.mysteryHz/);
});

test('validateLivePatch rejects non-numeric values', () => {
  const v = validateLivePatch({ bands: { lowMaxHz: 'high' } });
  assert.equal(v.ok, false);
  assert.match(v.error, /finite number/);
});

test('validateLivePatch rejects non-object payloads', () => {
  assert.equal(validateLivePatch(null).ok, false);
  assert.equal(validateLivePatch('').ok, false);
  assert.equal(validateLivePatch({ bands: 5 }).ok, false);
});

test('AUDIO_LIVE_FIELDS is the contract surface', () => {
  // Lock in the live-tunable contract; changing this is a doc + UI change.
  // Bands lost `smoothingAlpha` in favour of asymmetric attack/release
  // + a noise gate (2026-05-25 retune); gained `inputGain` (2026-06-14
  // software preamp). `kickEma` was REMOVED 2026-06-14 — it was advertised
  // live-tunable but never wired into the analyzer (silent no-op); the kick
  // EMA coefficients are hardcoded in audio_analyzer.js. `structureDetector`
  // is the build/drop/sustain detector group (docs/30).
  assert.deepEqual(AUDIO_LIVE_FIELDS, {
    bands:   ['lowMaxHz', 'midMaxHz', 'attackMs', 'releaseMs', 'noiseGate', 'inputGain', 'sourceSmoothHz'],
    kick:    ['minHz', 'maxHz', 'threshold', 'refractoryMs', 'decayMs'],
    structureDetector: [
      'enabled', 'buildThreshold', 'dropEnergyJump', 'dropEdgeMode', 'dropDeltaWindowMs',
      'dropNisThreshold', 'dropKalmanQ', 'dropCoWindowMs', 'slowZoneRef',
      'stemsTimeoutMs', 'eventRefractoryMs', 'falseFireCount', 'falseFireWindowMs', 'falseFireQuietMs',
    ],
  });
});

test('validateLivePatch accepts dropEdgeMode enum + dropDeltaWindowMs, rejects bad values', () => {
  const ok = validateLivePatch({ structureDetector: { dropEdgeMode: 'windowed', dropDeltaWindowMs: 350 } });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.live.structureDetector.dropEdgeMode, 'windowed');
  assert.equal(ok.live.structureDetector.dropDeltaWindowMs, 350);
  const badEnum = validateLivePatch({ structureDetector: { dropEdgeMode: 'sideways' } });
  assert.equal(badEnum.ok, false);
  const badWin = validateLivePatch({ structureDetector: { dropDeltaWindowMs: 10 } });
  assert.equal(badWin.ok, false);
  // 'kalman' is the adopted default edge — must validate.
  const kal = validateLivePatch({ structureDetector: { dropEdgeMode: 'kalman', dropNisThreshold: 6.63, slowZoneRef: 0.5 } });
  assert.equal(kal.ok, true, kal.error);
  assert.equal(kal.live.structureDetector.dropEdgeMode, 'kalman');
  const badNis = validateLivePatch({ structureDetector: { dropNisThreshold: 0.5 } });
  assert.equal(badNis.ok, false);
  // kalman re-tune knobs (exposed 2026-06-16): dropKalmanQ ∈ (0,1], dropCoWindowMs ∈ [0,2000].
  const tune = validateLivePatch({ structureDetector: { dropKalmanQ: 0.001, dropCoWindowMs: 60 } });
  assert.equal(tune.ok, true, tune.error);
  assert.equal(tune.live.structureDetector.dropKalmanQ, 0.001);
  assert.equal(tune.live.structureDetector.dropCoWindowMs, 60);
  assert.equal(validateLivePatch({ structureDetector: { dropKalmanQ: 0 } }).ok, false);
  assert.equal(validateLivePatch({ structureDetector: { dropCoWindowMs: 5000 } }).ok, false);
});

test('validateLivePatch accepts a structureDetector patch (docs/30)', () => {
  const res = validateLivePatch({
    structureDetector: {
      enabled: true,
      buildThreshold: 0.4,
      dropEnergyJump: 1.8,
      stemsTimeoutMs: 250,
      eventRefractoryMs: 2000,
      falseFireCount: 3,
      falseFireWindowMs: 30000,
      falseFireQuietMs: 60000,
    },
  });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.live.structureDetector.enabled, true);
  assert.equal(res.live.structureDetector.buildThreshold, 0.4);
});

test('validateLivePatch rejects a non-boolean structureDetector.enabled', () => {
  const res = validateLivePatch({ structureDetector: { enabled: 1 } });
  assert.equal(res.ok, false);
  assert.match(res.error, /enabled.*boolean/);
});

test('validateLivePatch rejects an out-of-range structureDetector threshold', () => {
  const res = validateLivePatch({ structureDetector: { dropEnergyJump: 0.5 } });
  assert.equal(res.ok, false);
  assert.match(res.error, /dropEnergyJump/);
});

test('validateLivePatch rejects an unknown structureDetector field', () => {
  const res = validateLivePatch({ structureDetector: { bogusKnob: 1 } });
  assert.equal(res.ok, false);
  assert.match(res.error, /not live-tunable/);
});

test('loadAudioConfig recovers gracefully from a malformed YAML file', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'audio_config.yaml'), ':: not yaml ::');
  // Squash the warn the loader emits so test output stays clean.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const out = loadAudioConfig(d);
    assert.deepEqual(out, {});
  } finally {
    console.warn = origWarn;
  }
});
