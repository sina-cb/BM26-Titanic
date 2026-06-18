/**
 * audio_capture — cross-platform ffmpeg arg builder + spawn shape.
 *
 * Verifies the platform-branching rule from docs/25 §3:
 *   - All OS-specific logic lives in this module + audio_devices.js.
 *   - macOS defaults to `:0`, Linux to `default`, Windows REQUIRES a
 *     pinned device.
 *   - spawn always uses shell:false.
 *   - ffmpegPath override is honoured.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { AudioCapture, buildFfmpegArgs } from '../audio/capture/audio_capture.js';

test('buildFfmpegArgs — macOS default device', () => {
  const args = buildFfmpegArgs({ platform: 'darwin', channels: 1, sampleRate: 44100 });
  // Look for `-f avfoundation -i :0` in the argv.
  const fIdx = args.indexOf('-f');
  assert.equal(args[fIdx + 1], 'avfoundation');
  const iIdx = args.indexOf('-i');
  assert.equal(args[iIdx + 1], ':0');
});

test('buildFfmpegArgs — macOS selected device passes through', () => {
  const args = buildFfmpegArgs({ platform: 'darwin', device: ':2' });
  assert.equal(args[args.indexOf('-i') + 1], ':2');
});

test('buildFfmpegArgs — Windows pinned device builds -f dshow -i audio=...', () => {
  const args = buildFfmpegArgs({
    platform: 'win32', device: 'audio=Microphone Array',
  });
  assert.equal(args[args.indexOf('-f') + 1], 'dshow');
  assert.equal(args[args.indexOf('-i') + 1], 'audio=Microphone Array');
  // Low-latency capture flags (docs/37 §13 — the dshow ~480ms super-chunk fix).
  assert.equal(args[args.indexOf('-audio_buffer_size') + 1], '50', 'default dshow buffer 50ms');
  assert.ok(args.includes('-flush_packets'), 'output packets flushed immediately');
  assert.ok(args.includes('-fflags') && args.includes('nobuffer'), 'demux nobuffer');
});

test('buildFfmpegArgs — captureBufferMs overrides the dshow audio_buffer_size', () => {
  const args = buildFfmpegArgs({ platform: 'win32', device: 'audio=Mic', captureBufferMs: 20 });
  assert.equal(args[args.indexOf('-audio_buffer_size') + 1], '20');
});

test('buildFfmpegArgs — Windows without device throws device_not_configured', () => {
  try {
    buildFfmpegArgs({ platform: 'win32' });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'device_not_configured');
    assert.match(err.message, /Windows/);
  }
});

test('buildFfmpegArgs — unsupported platform throws unsupported_platform', () => {
  try {
    buildFfmpegArgs({ platform: 'haiku', device: 'whatever' });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'unsupported_platform');
  }
});

/**
 * Make a fake ffmpeg child that emits 'exit' when killed, so cap.stop()
 * resolves cleanly in tests instead of hanging on the 2-second SIGKILL
 * backstop.
 */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('exit', 0, 'SIGTERM')); };
  return child;
}

test('AudioCapture — uses shell:false and honours ffmpegPath', async () => {
  let receivedPath = null;
  let receivedArgs = null;
  let receivedOpts = null;
  const fakeSpawn = (path, args, opts) => {
    receivedPath = path; receivedArgs = args; receivedOpts = opts;
    return makeFakeChild();
  };
  const cap = new AudioCapture({
    backend: 'ffmpeg',
    ffmpegPath: '/opt/custom/ffmpeg',
    platform: 'darwin',
    device: ':1',
    sampleRate: 48000,
    channels: 1,
    frameSamples: 512,
    onFrame: () => {},
    spawnFn: fakeSpawn,
  });
  cap.start();
  assert.equal(receivedPath, '/opt/custom/ffmpeg', 'ffmpegPath should reach spawn()');
  assert.equal(receivedOpts.shell, false, 'spawn must use shell:false (docs/25 §3)');
  assert.equal(receivedOpts.windowsHide, true);
  assert.equal(receivedArgs[receivedArgs.indexOf('-i') + 1], ':1');
  assert.equal(receivedArgs[receivedArgs.indexOf('-f') + 1], 'avfoundation');
  await cap.stop();
});

test('AudioCapture — Windows without configured device throws at construction', () => {
  assert.throws(
    () => new AudioCapture({
      backend: 'ffmpeg', platform: 'win32', frameSamples: 512,
      onFrame: () => {}, spawnFn: () => {},
    }),
    /Windows/,
  );
});

test('AudioCapture — emitted audioStatus includes extended fields', async () => {
  const statuses = [];
  const fakeSpawn = () => makeFakeChild();
  const cap = new AudioCapture({
    backend: 'ffmpeg', platform: 'darwin', device: ':0',
    deviceLabel: 'Built-in', deviceId: 'avfoundation-audio-0',
    sampleRate: 44100, channels: 1, frameSamples: 256,
    onFrame: () => {},
    onStatus: (s) => statuses.push(s),
    spawnFn: fakeSpawn,
  });
  cap.start();
  // 'starting' should have all the extended fields populated.
  const starting = statuses.find(s => s.phase === 'starting');
  assert.ok(starting, 'should emit a starting status');
  assert.equal(starting.platform, 'darwin');
  assert.equal(starting.inputFormat, 'avfoundation');
  assert.equal(starting.deviceLabel, 'Built-in');
  assert.equal(starting.deviceId, 'avfoundation-audio-0');
  assert.equal(starting.restartCount, 0);
  assert.equal(starting.errorCode, null);
  await cap.stop();
});
