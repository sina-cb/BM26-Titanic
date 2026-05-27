/**
 * audio_devices — cross-platform mic discovery.
 *
 * Tests focus on the parsers (pure functions, deterministic on canned
 * ffmpeg output) and the args builder. The listAudioDevices() entry
 * point itself is covered indirectly by a single happy-path test with
 * an injected fake spawn so we don't require ffmpeg on the test host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildListDevicesArgs,
  parseAudioDevices,
  deviceToCaptureConfig,
  listAudioDevices,
  defaultInputFormatFor,
  findConfiguredDevice,
} from '../lib/audio_devices.js';

const MAC_AV_OUTPUT = `
[AVFoundation indev @ 0x7f8b1a] AVFoundation video devices:
[AVFoundation indev @ 0x7f8b1a] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8b1a] [1] Capture screen 0
[AVFoundation indev @ 0x7f8b1a] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8b1a] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x7f8b1a] [1] USB Audio Device
[AVFoundation indev @ 0x7f8b1a] [2] BlackHole 2ch
`;

const WIN_DSHOW_OUTPUT = `
[dshow @ 0000023a] DirectShow video devices (some may be both video and audio devices)
[dshow @ 0000023a]  "Webcam C920" (video)
[dshow @ 0000023a]     Alternative name "@device_pnp_\\\\?\\usb#vid_046d&pid_082d"
[dshow @ 0000023a] DirectShow audio devices
[dshow @ 0000023a]  "Microphone Array (Realtek Audio)" (audio)
[dshow @ 0000023a]     Alternative name "@device_cm_{33D9A762-90C8-11D0-BD43}\\wave_{abc}"
[dshow @ 0000023a]  "Stereo Mix (Realtek Audio)"
`;

test('buildListDevicesArgs — macOS avfoundation', () => {
  const args = buildListDevicesArgs({ platform: 'darwin' });
  assert.deepEqual(args, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
});

test('buildListDevicesArgs — Windows dshow', () => {
  const args = buildListDevicesArgs({ platform: 'win32' });
  assert.deepEqual(args, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
});

test('buildListDevicesArgs — unsupported throws', () => {
  assert.throws(() => buildListDevicesArgs({ platform: 'haiku' }), /Unsupported/);
});

test('defaultInputFormatFor — mapping', () => {
  assert.equal(defaultInputFormatFor('darwin'), 'avfoundation');
  assert.equal(defaultInputFormatFor('win32'),  'dshow');
  assert.equal(defaultInputFormatFor('linux'),  'pulse');
  assert.equal(defaultInputFormatFor('weird'),  null);
});

test('parseAudioDevices — mac AVFoundation parses audio only', () => {
  const devs = parseAudioDevices({ platform: 'darwin', output: MAC_AV_OUTPUT });
  assert.equal(devs.length, 3, 'should parse exactly 3 audio devices, ignoring video');
  assert.deepEqual(devs[0], {
    id: 'avfoundation-audio-0',
    label: 'MacBook Pro Microphone',
    platform: 'darwin',
    inputFormat: 'avfoundation',
    ffmpegDevice: ':0',
    isDefault: true,
  });
  assert.equal(devs[1].ffmpegDevice, ':1');
  assert.equal(devs[2].ffmpegDevice, ':2');
  // No video devices leaked in
  assert.ok(!devs.some(d => /FaceTime|Capture screen/.test(d.label)));
});

test('parseAudioDevices — Windows DirectShow captures alternative name', () => {
  const devs = parseAudioDevices({ platform: 'win32', output: WIN_DSHOW_OUTPUT });
  assert.equal(devs.length, 2);
  assert.equal(devs[0].label, 'Microphone Array (Realtek Audio)');
  assert.equal(devs[0].ffmpegDevice, 'audio=Microphone Array (Realtek Audio)');
  assert.equal(devs[0].platform, 'win32');
  assert.equal(devs[0].inputFormat, 'dshow');
  assert.ok(devs[0].alternativeName.startsWith('@device_cm_'),
    'should capture the alternative name from the indented line');
  assert.equal(devs[1].label, 'Stereo Mix (Realtek Audio)');
  // Webcam should NOT appear as an audio device.
  assert.ok(!devs.some(d => /Webcam/.test(d.label)));
});

test('parseAudioDevices — no audio section returns empty', () => {
  const devs = parseAudioDevices({ platform: 'darwin', output: 'some unrelated ffmpeg output' });
  assert.deepEqual(devs, []);
});

test('deviceToCaptureConfig — projects to capture slice', () => {
  const dev = {
    id: 'avfoundation-audio-1', label: 'USB Mic', platform: 'darwin',
    inputFormat: 'avfoundation', ffmpegDevice: ':1',
  };
  const cap = deviceToCaptureConfig(dev);
  assert.equal(cap.device, ':1');
  assert.equal(cap.deviceId, 'avfoundation-audio-1');
  assert.equal(cap.deviceLabel, 'USB Mic');
  assert.equal(cap.platform, 'darwin');
  assert.equal(cap.inputFormat, 'avfoundation');
  assert.ok(typeof cap.selectedAt === 'string' && cap.selectedAt.includes('T'));
});

test('deviceToCaptureConfig — rejects non-object', () => {
  assert.throws(() => deviceToCaptureConfig(null), /AudioDevice/);
});

test('listAudioDevices — happy path with fake spawn (mac)', async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stderr.write(MAC_AV_OUTPUT);
      child.stderr.end();
      child.stdout.end();
      child.emit('exit', 1);   // ffmpeg device-list always exits non-zero
    });
    return child;
  };
  const r = await listAudioDevices({ spawnFn: fakeSpawn, platform: 'darwin' });
  assert.equal(r.platform, 'darwin');
  assert.equal(r.inputFormat, 'avfoundation');
  assert.equal(r.devices.length, 3);
  assert.equal(r.devices[0].label, 'MacBook Pro Microphone');
});

test('listAudioDevices — ffmpeg spawn failure surfaces ffmpeg_missing', async () => {
  const fakeSpawn = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  await assert.rejects(
    () => listAudioDevices({ spawnFn: fakeSpawn, platform: 'darwin' }),
    /ffmpeg/i,
  );
});

// ── findConfiguredDevice ─────────────────────────────────────────────────
// Used by engine boot to validate the saved mic still exists on this
// machine before spawning ffmpeg. Pure function — exhaustive here so
// the engine boot path can rely on the matching contract.

const SAMPLE_DEVICES = [
  { id: 'avfoundation-audio-0', label: 'MacBook Pro Microphone', platform: 'darwin', inputFormat: 'avfoundation', ffmpegDevice: ':0' },
  { id: 'avfoundation-audio-1', label: 'USB Audio Device',       platform: 'darwin', inputFormat: 'avfoundation', ffmpegDevice: ':1' },
  { id: 'avfoundation-audio-2', label: 'Amazon USB Streaming Mic', platform: 'darwin', inputFormat: 'avfoundation', ffmpegDevice: ':2' },
];

test('findConfiguredDevice — matches by deviceId first', () => {
  const m = findConfiguredDevice({ deviceId: 'avfoundation-audio-2' }, SAMPLE_DEVICES);
  assert.equal(m?.ffmpegDevice, ':2');
});

test('findConfiguredDevice — falls back to device path when no deviceId match', () => {
  // deviceId points to nonexistent slot; device path :1 still exists.
  const m = findConfiguredDevice({ deviceId: 'avfoundation-audio-99', device: ':1' }, SAMPLE_DEVICES);
  assert.equal(m?.id, 'avfoundation-audio-1');
});

test('findConfiguredDevice — falls back to label (case-insensitive) last', () => {
  const m = findConfiguredDevice(
    { deviceId: 'avfoundation-audio-99', device: ':99', deviceLabel: 'amazon usb streaming mic' },
    SAMPLE_DEVICES,
  );
  assert.equal(m?.id, 'avfoundation-audio-2');
});

test('findConfiguredDevice — returns null when nothing matches', () => {
  const m = findConfiguredDevice(
    { deviceId: 'x', device: ':99', deviceLabel: 'Not Here' },
    SAMPLE_DEVICES,
  );
  assert.equal(m, null);
});

test('findConfiguredDevice — null sel or empty list returns null', () => {
  assert.equal(findConfiguredDevice(null, SAMPLE_DEVICES), null);
  assert.equal(findConfiguredDevice({ deviceId: 'x' }, []), null);
  assert.equal(findConfiguredDevice({ deviceId: 'x' }, null), null);
});

test('findConfiguredDevice — deviceId match wins over label mismatch', () => {
  // Even if label changed on this machine, the deviceId still wins.
  const devices = [
    { id: 'avfoundation-audio-0', label: 'Renamed Mic', ffmpegDevice: ':0' },
  ];
  const m = findConfiguredDevice(
    { deviceId: 'avfoundation-audio-0', deviceLabel: 'Original Name' },
    devices,
  );
  assert.equal(m?.ffmpegDevice, ':0');
});
