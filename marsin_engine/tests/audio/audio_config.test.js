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
} from '../../audio/config/audio_config.js';
import {
  loadSceneAudio, saveSceneAudio, sceneAudioPath,
} from '../../audio/config/audio_config_store.js';

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
  // is the build/drop/sustain detector group (docs/30). The 2026-06-20 detector
  // super-tuning pass added `dropMinLevel` (absolute sub floor), `dropLevelAssist`
  // (windowed-edge level assist toggle), and the slow-zone soft-knee knobs
  // `slowZoneWidth` + `slowFluxFloor`. The 2026-06-20 detector-RECALL pass added
  // the build→drop transition gate (`dropBuildGate` + `dropBuildMemoryMs`) and
  // the mic-gain-relative drop floor (`dropRelLevel`). The 2026-06-20 detector
  // REAL-AUDIO pass (E1) added the precision-first gates `dropBuildRise` (required
  // buildScore rise, not a flat-high plateau) + `dropNoveltyRatio`/`dropNoveltyWindowMs`
  // (windowed-ratio novelty vs recent median) — they cut real-corpus false-fires
  // from 1.48 to 0.12/min.
  assert.deepEqual(AUDIO_LIVE_FIELDS, {
    bands:   ['lowMaxHz', 'midMaxHz', 'attackMs', 'releaseMs', 'noiseGate', 'inputGain', 'sourceSmoothHz',
      'lowGate', 'midGate', 'highGate'],
    kick:    ['minHz', 'maxHz', 'threshold', 'refractoryMs', 'decayMs'],
    // analyzer_features (slot 3): sub-bass "chest hit" window (~30–60 Hz).
    sub:     ['minHz', 'maxHz'],
    // bpmTracker: the published-BPM slew ONLY. The band/evidence/silence knobs
    // re-shape the tempo model and stay config-only, so they must NEVER appear
    // here — the slew is a pure output smoother, safe to trim mid-show.
    bpmTracker: ['outputSlewEnabled', 'outputSlewBpmPerSec'],
    structureDetector: [
      'enabled', 'buildThreshold', 'dropEnergyJump', 'dropEdgeMode', 'dropDeltaWindowMs',
      'dropMinLevel', 'dropLevelAssist', 'dropBuildGate', 'dropBuildMemoryMs',
      'dropSlowZoneMax', 'dropBuildRise', 'dropNoveltyRatio', 'dropNoveltyWindowMs', 'dropRelLevel',
      'dropNisThreshold', 'dropKalmanQ', 'dropCoWindowMs',
      'slowZoneRef', 'slowZoneWidth', 'slowFluxFloor',
      'stemsTimeoutMs', 'eventRefractoryMs', 'falseFireCount', 'falseFireWindowMs', 'falseFireQuietMs',
    ],
  });
});

test('validateLivePatch round-trips the published-BPM slew and rejects bad values', () => {
  const ok = validateLivePatch({ bpmTracker: { outputSlewEnabled: true, outputSlewBpmPerSec: 24 } });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.live.bpmTracker, { outputSlewEnabled: true, outputSlewBpmPerSec: 24 });
  assert.equal(ok.requiresCaptureRestart, false);
  // The rate must be a finite number in (0, 240] — no clamping, a 400 instead.
  assert.equal(validateLivePatch({ bpmTracker: { outputSlewBpmPerSec: 0 } }).ok, false);
  assert.equal(validateLivePatch({ bpmTracker: { outputSlewBpmPerSec: -8 } }).ok, false);
  assert.equal(validateLivePatch({ bpmTracker: { outputSlewBpmPerSec: 900 } }).ok, false);
  assert.equal(validateLivePatch({ bpmTracker: { outputSlewBpmPerSec: 'fast' } }).ok, false);
  // The flag is a strict boolean, never a truthy coercion.
  assert.equal(validateLivePatch({ bpmTracker: { outputSlewEnabled: 1 } }).ok, false);
  // The tempo-model knobs stay config-only.
  assert.equal(validateLivePatch({ bpmTracker: { minBpm: 90 } }).ok, false);
  assert.equal(validateLivePatch({ bpmTracker: { silenceResetEnabled: true } }).ok, false);
  assert.equal(validateLivePatch({ bpmTracker: { activityThreshold: 0.1 } }).ok, false);
});

test('pickLiveFields carries the published-BPM slew into the scene subset', () => {
  const picked = pickLiveFields({
    bpmTracker: { minBpm: 60, outputSlewEnabled: true, outputSlewBpmPerSec: 20 },
  });
  assert.deepEqual(picked.bpmTracker, { outputSlewEnabled: true, outputSlewBpmPerSec: 20 });
});

test('validateLivePatch accepts a valid sub window, rejects bad edges (analyzer_features slot 3)', () => {
  const ok = validateLivePatch({ sub: { minHz: 30, maxHz: 60 } });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.live.sub.minHz, 30);
  assert.equal(ok.live.sub.maxHz, 60);
  // Out-of-range edges 400 at the field validator (≤ 0 / above Nyquist).
  assert.equal(validateLivePatch({ sub: { minHz: 0 } }).ok, false);
  assert.equal(validateLivePatch({ sub: { maxHz: 30000 } }).ok, false);
  // Unknown sub field is rejected (no silent acceptance).
  assert.equal(validateLivePatch({ sub: { threshold: 1.2 } }).ok, false);
});

test('validateLivePatch accepts per-band gates, rejects out-of-range (on-playa hardening)', () => {
  const ok = validateLivePatch({ bands: { lowGate: 0.05, midGate: 0.09, highGate: 0.2 } });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.live.bands.lowGate, 0.05);
  assert.equal(ok.live.bands.midGate, 0.09);
  assert.equal(ok.live.bands.highGate, 0.2);
  // A gate must be in [0, 1) — 1.0 and negatives 400 at the field validator.
  assert.equal(validateLivePatch({ bands: { highGate: 1 } }).ok, false);
  assert.equal(validateLivePatch({ bands: { lowGate: -0.1 } }).ok, false);
  // Non-finite is rejected before the range check (codex P0: no silent coercion).
  assert.equal(validateLivePatch({ bands: { midGate: 'loud' } }).ok, false);
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

// A malformed state/override file must FAIL LOUDLY, not "recover" to {}.
// Recovering was destructive: every caller does load → merge → save, so the
// empty object got merged with the defaults and written straight back over the
// operator's file — the read destroyed exactly what it claimed to protect.
test('loadAudioConfig THROWS on a malformed YAML file, naming the path', () => {
  const d = tmpDir();
  const p = path.join(d, 'audio_config.yaml');
  fs.writeFileSync(p, ':: not yaml ::');
  assert.throws(() => loadAudioConfig(d), (err) => {
    assert.match(err.message, /failed to parse/);
    assert.ok(err.message.includes(p), `error should name the file, got: ${err.message}`);
    return true;
  });
});

test('loadSceneAudio returns {} for a missing file but THROWS on a malformed one', () => {
  const d = tmpDir();
  assert.deepEqual(loadSceneAudio(d), {}, 'a never-tuned scene has no state — not an error');
  const p = sceneAudioPath(d);
  fs.writeFileSync(p, 'capture:\n  device: ":0"\n bad indent: [\n');
  assert.throws(() => loadSceneAudio(d), (err) => {
    assert.match(err.message, /failed to parse/);
    assert.ok(err.message.includes(p), `error should name the file, got: ${err.message}`);
    assert.match(err.message, /will NOT overwrite/);
    return true;
  });
  // And the file is still intact — nothing wrote over it.
  assert.match(fs.readFileSync(p, 'utf8'), /Microphone|device/);
});

test('saveSceneAudio THROWS when the write cannot land (no silent 200)', () => {
  const d = tmpDir();
  // A directory where the state file should be: writeFileSync on the temp
  // name succeeds, the rename onto a directory does not.
  fs.mkdirSync(sceneAudioPath(d));
  assert.throws(() => saveSceneAudio(d, { enabled: true }), /failed to write/);
  // The temp file was cleaned up rather than left as litter.
  const litter = fs.readdirSync(d).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(litter, []);
});

// pickLiveFields must NOT stamp the whole derivedSignals tree into scene state:
// the merged config always carries every group (config.yaml supplies them), so
// persisting all of it froze a copy of config.yaml into the scene file and
// shadowed every later retune. Only groups the operator actually live-patched
// this runtime are persisted, and only their live-tunable fields.
const CFG_WITH_DERIVED = {
  ...FULL_CFG,
  derivedSignals: {
    party: { wLow: 0.4, wMid: 0.4, wHigh: 0.2, loudTau: 0.4, onThresh: 0.3, offThresh: 0.12, holdMs: 1200, offConfirmMs: 800, warmupMs: 1500 },
    phrase: { phraseBars: 8, downbeatFire: 0.5, dropFire: 0.5, dropReanchorMs: 1500 },
  },
};

test('pickLiveFields persists NO derivedSignals when nothing was live-patched', () => {
  const out = pickLiveFields(CFG_WITH_DERIVED);
  assert.equal(out.derivedSignals, undefined);
});

test('pickLiveFields persists only the live-patched groups, live fields only', () => {
  const out = pickLiveFields(CFG_WITH_DERIVED, { derivedSignalsGroups: new Set(['party']) });
  assert.deepEqual(Object.keys(out.derivedSignals), ['party']);
  // wLow/wMid/wHigh are NOT live-tunable — persisting them would shadow a
  // future config.yaml re-weighting that the operator never overrode.
  assert.deepEqual(Object.keys(out.derivedSignals.party).sort(), [
    'holdMs', 'loudTau', 'offConfirmMs', 'offThresh', 'onThresh', 'warmupMs',
  ]);
  assert.equal(out.derivedSignals.party.onThresh, 0.3);
});

test('pickLiveFields rejects an unknown derivedSignals group', () => {
  assert.throws(
    () => pickLiveFields(CFG_WITH_DERIVED, { derivedSignalsGroups: ['bogus'] }),
    /unknown derivedSignals group "bogus"/,
  );
});
