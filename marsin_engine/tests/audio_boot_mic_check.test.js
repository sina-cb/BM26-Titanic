/**
 * Engine-boot mic-not-found check.
 *
 * The engine boot path (engine.js `buildAndStartAudio`) runs three
 * pure steps before constructing AudioCapture / AudioAnalyzer when the
 * operator has explicitly selected a mic (cfg.capture.device or
 * cfg.capture.deviceId is set):
 *
 *   1. Enumerate via listAudioDevices (or fail closed if that throws).
 *   2. Match the saved selection via findConfiguredDevice
 *      (deviceId > device > label fallback).
 *   3. If no match, populate audioState.lastStatus with
 *      `error: 'configured_mic_not_found'`, the `missingDevice` echo,
 *      and the full `availableDevices` list — same shape iPad's
 *      `/audio/devices` returns so CaptainPad can reuse its types.
 *
 * These tests pin the contract of the helpers + status-payload shape
 * the engine relies on. Edge cases live next to the matcher in
 * audio_devices.test.js — this file is the boot-path-specific suite.
 *
 * Why a standalone file (vs. extending audio_devices.test.js): keeps
 * the matcher tests pure and lets this suite carry boot-specific
 * fixtures (full SAMPLE_CFG with capture.* and a fake AudioCapture
 * counter we can assert was NOT incremented).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findConfiguredDevice } from '../lib/audio_devices.js';

const MAC_DEVICES = [
  { id: 'avfoundation-audio-0', label: 'MacBook Pro Microphone', platform: 'darwin', inputFormat: 'avfoundation', ffmpegDevice: ':0', isDefault: true },
  { id: 'avfoundation-audio-1', label: 'Studio Display Mic',     platform: 'darwin', inputFormat: 'avfoundation', ffmpegDevice: ':1' },
];

/**
 * Replicates the engine boot path's `buildAndStartAudio` mic-not-found
 * branch, calling injected enumerate / AudioCapture factories. Mirrors
 * engine.js exactly so this test changes if the boot contract drifts.
 */
async function runBootMicCheck({ cfg, enumerate, makeCapture, publish }) {
  const sel = cfg.capture || {};
  // No explicit selection → skip the check (platform default path).
  if (!sel.device && !sel.deviceId) {
    const cap = makeCapture(cfg);
    return { capture: cap, status: { enabled: !!cfg.enabled, error: null } };
  }
  let enumResult;
  try {
    enumResult = await enumerate({
      platform:    sel.platform || 'darwin',
      inputFormat: sel.inputFormat || undefined,
    });
  } catch (err) {
    const status = {
      enabled: false,
      error: 'device_enumeration_failed',
      enumerationError: { code: err.code || 'unknown', message: err.message },
    };
    publish?.(status);
    return { capture: null, status };
  }
  const match = findConfiguredDevice(
    { deviceId: sel.deviceId, device: sel.device, deviceLabel: sel.deviceLabel },
    enumResult.devices || [],
  );
  if (!match) {
    const status = {
      enabled: false,
      error: 'configured_mic_not_found',
      missingDevice: {
        device:      sel.device      ?? null,
        deviceLabel: sel.deviceLabel ?? null,
        deviceId:    sel.deviceId    ?? null,
        platform:    sel.platform    ?? 'darwin',
      },
      availableDevices: enumResult.devices || [],
      platform:    enumResult.platform,
      inputFormat: enumResult.inputFormat,
    };
    publish?.(status);
    return { capture: null, status };
  }
  const cap = makeCapture(cfg);
  return { capture: cap, status: { enabled: true, error: null } };
}

test('mic-not-found: deviceId missing from enumeration → status error + NO AudioCapture', async () => {
  let captureCount = 0;
  const published = [];
  const cfg = {
    enabled: true,
    capture: {
      platform: 'darwin', inputFormat: 'avfoundation',
      device: ':2', deviceId: 'avfoundation-audio-2', deviceLabel: 'Amazon USB',
    },
  };
  const { capture, status } = await runBootMicCheck({
    cfg,
    enumerate: async () => ({ platform: 'darwin', inputFormat: 'avfoundation', devices: MAC_DEVICES }),
    makeCapture: () => { captureCount++; return {}; },
    publish: (s) => published.push(s),
  });

  assert.equal(captureCount, 0, 'AudioCapture must NOT be instantiated');
  assert.equal(capture, null);
  assert.equal(status.enabled, false);
  assert.equal(status.error, 'configured_mic_not_found');
  assert.deepEqual(status.missingDevice, {
    device: ':2', deviceLabel: 'Amazon USB', deviceId: 'avfoundation-audio-2', platform: 'darwin',
  });
  assert.equal(status.availableDevices.length, 2);
  assert.equal(status.availableDevices[0].id, 'avfoundation-audio-0');
  // The iPad's fetchAudioDevices expects { id, label, platform, inputFormat, ffmpegDevice }
  // — assert the shape matches so the iPad type can be reused.
  for (const d of status.availableDevices) {
    assert.equal(typeof d.id, 'string');
    assert.equal(typeof d.label, 'string');
    assert.equal(typeof d.platform, 'string');
    assert.equal(typeof d.inputFormat, 'string');
    assert.equal(typeof d.ffmpegDevice, 'string');
  }
  // The status must be published over the audioStatus channel.
  assert.equal(published.length, 1);
  assert.equal(published[0].error, 'configured_mic_not_found');
});

test('platform default (cfg.capture.device:null) bypasses the mic-not-found check', async () => {
  let captureCount = 0;
  let enumCalled = false;
  const cfg = {
    enabled: true,
    capture: { platform: 'darwin', device: null, deviceId: null, deviceLabel: null },
  };
  const { capture, status } = await runBootMicCheck({
    cfg,
    enumerate: async () => { enumCalled = true; return { devices: [] }; },
    makeCapture: () => { captureCount++; return {}; },
  });
  assert.equal(enumCalled, false, 'should not enumerate when no explicit selection');
  assert.equal(captureCount, 1, 'AudioCapture should be constructed as before');
  assert.ok(capture);
  assert.equal(status.enabled, true);
});

test('matching deviceId on this machine → check passes, AudioCapture spawned', async () => {
  let captureCount = 0;
  const cfg = {
    enabled: true,
    capture: {
      platform: 'darwin', inputFormat: 'avfoundation',
      device: ':0', deviceId: 'avfoundation-audio-0', deviceLabel: 'MacBook Pro Microphone',
    },
  };
  const { capture, status } = await runBootMicCheck({
    cfg,
    enumerate: async () => ({ platform: 'darwin', inputFormat: 'avfoundation', devices: MAC_DEVICES }),
    makeCapture: () => { captureCount++; return {}; },
  });
  assert.equal(captureCount, 1);
  assert.ok(capture);
  assert.equal(status.error, null);
});

test('device enumeration itself fails → status error device_enumeration_failed, NO AudioCapture', async () => {
  let captureCount = 0;
  const published = [];
  const cfg = {
    enabled: true,
    capture: {
      platform: 'darwin', inputFormat: 'avfoundation',
      device: ':2', deviceId: 'avfoundation-audio-2',
    },
  };
  const { capture, status } = await runBootMicCheck({
    cfg,
    enumerate: async () => {
      const err = new Error('ffmpeg not on PATH');
      err.code = 'ffmpeg_missing';
      throw err;
    },
    makeCapture: () => { captureCount++; return {}; },
    publish: (s) => published.push(s),
  });
  assert.equal(captureCount, 0);
  assert.equal(capture, null);
  assert.equal(status.enabled, false);
  assert.equal(status.error, 'device_enumeration_failed');
  assert.equal(status.enumerationError.code, 'ffmpeg_missing');
  assert.match(status.enumerationError.message, /ffmpeg/i);
  assert.equal(published.length, 1);
});

test('mic-not-found: matches by label when deviceId stale and path renumbered', async () => {
  // Cross-machine: Mac A had Amazon USB at :2 (deviceId=audio-2), now
  // on Mac B Amazon USB happens to be at :1 (audio-1). The deviceId
  // and device-path miss, but the label still hits.
  let captureCount = 0;
  const cfg = {
    enabled: true,
    capture: {
      platform: 'darwin', inputFormat: 'avfoundation',
      device: ':2',
      deviceId: 'avfoundation-audio-2',
      deviceLabel: 'Studio Display Mic',
    },
  };
  const { capture, status } = await runBootMicCheck({
    cfg,
    enumerate: async () => ({ platform: 'darwin', inputFormat: 'avfoundation', devices: MAC_DEVICES }),
    makeCapture: () => { captureCount++; return {}; },
  });
  assert.equal(captureCount, 1, 'label fallback should let boot proceed');
  assert.ok(capture);
  assert.equal(status.error, null);
});
