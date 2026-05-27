/**
 * audio_config_store — persistence for the scene's audio_state.yaml.
 * Single file per scene now contains BOTH mic selection and analyzer
 * tuning; the tests below verify that the two concerns coexist
 * without stomping each other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import {
  loadSceneAudio, saveSceneAudio,
  saveSelectedMic, saveManualMic, clearSavedMic,
  sceneAudioPath,
} from '../lib/audio_config_store.js';
import { pickLiveFields } from '../lib/audio_config.js';

function tmpScene() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mae-scene-'));
}

test('saveSelectedMic + loadSceneAudio — mic round-trip', () => {
  const dir = tmpScene();
  saveSelectedMic(dir, {
    platform: 'darwin', inputFormat: 'avfoundation',
    device: ':0', deviceId: 'avfoundation-audio-0',
    deviceLabel: 'Built-in Mic', selectedAt: '2026-05-24T18:10:00-07:00',
  });
  const back = loadSceneAudio(dir);
  assert.equal(back.capture.device, ':0');
  assert.equal(back.capture.deviceLabel, 'Built-in Mic');
  assert.equal(back.capture.platform, 'darwin');
});

test('saveSelectedMic — does NOT wipe pre-existing bands/kick/enabled', () => {
  // The whole point of the single-file split: tuning and mic share a
  // file but mutating one must not touch the other.
  const dir = tmpScene();
  saveSceneAudio(dir, {
    enabled: true,
    fftSize: 2048, hopSize: 1024,
    bands: { lowMaxHz: 300, midMaxHz: 1800, smoothingAlpha: 0.4 },
    kick:  { minHz: 45, maxHz: 110, threshold: 1.8, refractoryMs: 250, decayMs: 140 },
  });
  saveSelectedMic(dir, { platform: 'darwin', device: ':1', deviceLabel: 'USB' });
  const back = loadSceneAudio(dir);
  assert.equal(back.enabled, true);
  assert.equal(back.fftSize, 2048);
  assert.equal(back.bands.lowMaxHz, 300, 'pre-existing bands tuning must survive');
  assert.equal(back.kick.threshold, 1.8, 'pre-existing kick tuning must survive');
  assert.equal(back.capture.device, ':1');
});

test('saveManualMic — records platform + device + timestamp', () => {
  const dir = tmpScene();
  saveManualMic(dir, 'audio=USB Mic Array', { platform: 'win32', inputFormat: 'dshow' });
  const back = loadSceneAudio(dir);
  assert.equal(back.capture.device, 'audio=USB Mic Array');
  assert.equal(back.capture.deviceLabel, 'audio=USB Mic Array');
  assert.equal(back.capture.platform, 'win32');
  assert.equal(back.capture.inputFormat, 'dshow');
  assert.ok(back.capture.selectedAt);
});

test('saveManualMic — rejects empty device string', () => {
  const dir = tmpScene();
  assert.throws(() => saveManualMic(dir, ''), /non-empty/);
  assert.throws(() => saveManualMic(dir, null), /non-empty/);
});

test('clearSavedMic — removes only mic fields, keeps tuning + other capture keys', () => {
  const dir = tmpScene();
  saveSceneAudio(dir, {
    enabled: true,
    bands: { lowMaxHz: 250 },
    kick:  { threshold: 1.6 },
    capture: {
      platform: 'darwin', device: ':0', deviceLabel: 'Built-in',
      selectedAt: 'now',
      sampleRate: 48000,   // non-mic capture field, should survive
    },
  });
  const r = clearSavedMic(dir);
  assert.equal(r.cleared, true);
  const back = loadSceneAudio(dir);
  // Mic fields gone:
  assert.equal(back.capture?.device, undefined);
  assert.equal(back.capture?.deviceLabel, undefined);
  assert.equal(back.capture?.selectedAt, undefined);
  // Non-mic capture field + tuning survive:
  assert.equal(back.capture?.sampleRate, 48000);
  assert.equal(back.enabled, true);
  assert.equal(back.bands.lowMaxHz, 250);
  assert.equal(back.kick.threshold, 1.6);
});

test('clearSavedMic — deletes file when only mic-related state existed', () => {
  const dir = tmpScene();
  saveManualMic(dir, ':0');
  assert.ok(fs.existsSync(sceneAudioPath(dir)));
  clearSavedMic(dir);
  assert.ok(!fs.existsSync(sceneAudioPath(dir)), 'file should be removed when nothing remains');
});

test('clearSavedMic — no-op when file missing', () => {
  const dir = tmpScene();
  const r = clearSavedMic(dir);
  assert.equal(r.cleared, false);
});

test('loadSceneAudio — returns {} on missing file', () => {
  const dir = tmpScene();
  assert.deepEqual(loadSceneAudio(dir), {});
});

test('loadSceneAudio — returns {} on malformed yaml without throwing', () => {
  const dir = tmpScene();
  fs.writeFileSync(sceneAudioPath(dir), 'this: is: not: valid: yaml: [');
  assert.deepEqual(loadSceneAudio(dir), {});
});

test('saveSceneAudio + saveSelectedMic — full read-write cycle', () => {
  // Mimic what the engine does at boot + on PATCH:
  //   1. operator runs --choose_mic --model X   → saveSelectedMic
  //   2. engine boots X                         → loadSceneAudio
  //   3. operator tweaks band in CaptainPad     → saveSceneAudio with merged subset
  // Mic must still be present after step 3.
  const dir = tmpScene();
  saveSelectedMic(dir, { platform: 'darwin', device: ':2', deviceLabel: 'Yeti', selectedAt: 'now' });

  const onBoot = loadSceneAudio(dir);
  assert.equal(onBoot.capture.device, ':2');

  // simulate PATCH-merge that engine.js does:
  const tuning = { enabled: true, bands: { lowMaxHz: 200 } };
  saveSceneAudio(dir, { ...onBoot, ...tuning });

  const after = loadSceneAudio(dir);
  assert.equal(after.capture.device, ':2', 'mic must survive a tuning save');
  assert.equal(after.bands.lowMaxHz, 200);
  assert.equal(after.enabled, true);
});

// ── Boot-write contract (engine.js boot path) ────────────────────────────
// The engine boot does:
//   saveSceneAudio(dir, { ...loadSceneAudio(dir), ...pickLiveFields(cfg) })
// once per boot so the file always reflects ground truth. The tests
// below pin the two scenarios that prompted the change.

const BOOT_CFG = {
  enabled: true,
  fftSize: 2048,
  hopSize: 1024,
  bands: { lowMaxHz: 220, midMaxHz: 1800, attackMs: 4, releaseMs: 90, noiseGate: 0.02 },
  kick:  { minHz: 45, maxHz: 110, threshold: 1.8, refractoryMs: 250, decayMs: 140 },
  capture: {
    platform: 'darwin', inputFormat: 'avfoundation',
    device: ':2', deviceId: 'avfoundation-audio-2', deviceLabel: 'Amazon USB',
  },
};

test('boot-write — fresh scene (no audio_state.yaml on disk) creates file with full shape', () => {
  const dir = tmpScene();
  assert.ok(!fs.existsSync(sceneAudioPath(dir)), 'precondition: no file');

  // Simulate engine boot-write.
  const onDisk = loadSceneAudio(dir);
  saveSceneAudio(dir, { ...onDisk, ...pickLiveFields(BOOT_CFG) });

  const back = loadSceneAudio(dir);
  assert.ok(fs.existsSync(sceneAudioPath(dir)), 'file should now exist');
  assert.equal(back.enabled, true);
  assert.equal(back.fftSize, 2048);
  assert.equal(back.hopSize, 1024);
  assert.equal(back.bands.lowMaxHz, 220);
  assert.equal(back.bands.attackMs, 4);
  assert.equal(back.kick.minHz, 45);
  assert.equal(back.capture.device, ':2');
  assert.equal(back.capture.deviceId, 'avfoundation-audio-2');
});

test('boot-write — preserves pre-existing chains block; fills in missing bands/kick', () => {
  const dir = tmpScene();
  // Pre-existing file like an early-development state — has chains and
  // capture, missing bands/kick/fftSize/hopSize.
  saveSceneAudio(dir, {
    capture: { device: ':2', deviceLabel: 'Old Mic', platform: 'darwin' },
    enabled: true,
    chains: {
      micLow:  [{ id: 'low_gain',  type: 'gain', enabled: true, params: { paramKey: 'micLowGain' } }],
      micKick: [{ id: 'kick_gain', type: 'gain', enabled: true, params: { paramKey: 'micKickGain' } }],
    },
  });

  // Simulate engine boot-write with a fully-merged cfg (config.yaml
  // defaults + the per-scene mic).
  const onDisk = loadSceneAudio(dir);
  saveSceneAudio(dir, { ...onDisk, ...pickLiveFields(BOOT_CFG) });

  const back = loadSceneAudio(dir);
  // Bands / kick / fftSize / hopSize now present:
  assert.equal(back.bands.lowMaxHz, 220);
  assert.equal(back.kick.threshold, 1.8);
  assert.equal(back.fftSize, 2048);
  assert.equal(back.hopSize, 1024);
  // Chains preserved verbatim:
  assert.ok(back.chains);
  assert.equal(back.chains.micLow[0].id, 'low_gain');
  assert.equal(back.chains.micKick[0].params.paramKey, 'micKickGain');
});

test('boot-write — fires even when audio disabled (enabled:false in cfg)', () => {
  // Operator request: audio_state.yaml should reflect ground truth
  // even for scenes with audio off, so they can pre-tune before
  // flipping enabled on.
  const dir = tmpScene();
  const disabledCfg = { ...BOOT_CFG, enabled: false };
  const onDisk = loadSceneAudio(dir);
  saveSceneAudio(dir, { ...onDisk, ...pickLiveFields(disabledCfg) });
  const back = loadSceneAudio(dir);
  assert.equal(back.enabled, false);
  assert.ok(back.bands, 'bands should still be persisted when disabled');
  assert.ok(back.kick,  'kick should still be persisted when disabled');
});

test('sceneAudioPath — predictable location', () => {
  assert.equal(
    path.basename(sceneAudioPath('/x/marsin_engine/states/test_bench')),
    'audio_state.yaml',
  );
});
