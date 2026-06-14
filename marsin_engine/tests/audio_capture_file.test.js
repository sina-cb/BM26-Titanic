/**
 * audio_capture — file-replay capture source (`device: "file:<path>"`).
 *
 * Verifies the file-input ffmpeg arg builder from docs/25 §3 "File replay":
 *   - `-stream_loop -1` (before -i) loops the clip forever by default.
 *   - `loop: false` omits `-stream_loop`.
 *   - `-re -i <path> ... -f s16le -` with NO device-format flag
 *     (avfoundation / dshow / pulse) — ffmpeg auto-detects the container.
 *   - An empty `file:` path throws a typed `audio_file_missing_path`.
 *   - Live-capture argv stays byte-for-byte unchanged for a normal device.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFfmpegArgs, isFileDevice } from '../audio/capture/audio_capture.js';

const DEVICE_FORMATS = ['avfoundation', 'dshow', 'pulse', 'alsa'];

/** Index of the value that follows the first `-i` flag. */
function inputAfter(args) {
  return args[args.indexOf('-i') + 1];
}

test('isFileDevice — only true for file: URIs', () => {
  assert.equal(isFileDevice('file:/clips/track.wav'), true);
  assert.equal(isFileDevice(':0'), false);
  assert.equal(isFileDevice('audio=Mic'), false);
  assert.equal(isFileDevice(null), false);
  assert.equal(isFileDevice(undefined), false);
});

test('buildFfmpegArgs — file source loops by default with -stream_loop -1 -re -i', () => {
  const args = buildFfmpegArgs({ device: 'file:/x.wav', loop: true });
  // -stream_loop -1 MUST precede -i.
  const slIdx = args.indexOf('-stream_loop');
  assert.notEqual(slIdx, -1, 'expected -stream_loop in file mode');
  assert.equal(args[slIdx + 1], '-1');
  assert.ok(slIdx < args.indexOf('-i'), '-stream_loop must come before -i');
  // -re before -i for native-rate timing.
  assert.ok(args.includes('-re'));
  assert.ok(args.indexOf('-re') < args.indexOf('-i'), '-re must come before -i');
  // Real path, prefix stripped.
  assert.equal(inputAfter(args), '/x.wav');
  // Raw PCM out to stdout.
  assert.equal(args[args.indexOf('-f', args.indexOf('-i'))], '-f');
  assert.ok(args.includes('s16le'));
  assert.equal(args[args.length - 1], '-', 'last arg pipes to stdout');
});

test('buildFfmpegArgs — file source defaults to looping when loop omitted', () => {
  const args = buildFfmpegArgs({ device: 'file:/x.wav' });
  assert.ok(args.includes('-stream_loop'), 'loop defaults to true');
});

test('buildFfmpegArgs — loop:false omits -stream_loop', () => {
  const args = buildFfmpegArgs({ device: 'file:/x.wav', loop: false });
  assert.equal(args.indexOf('-stream_loop'), -1, 'no -stream_loop when loop:false');
  // -re and -i are still present.
  assert.ok(args.includes('-re'));
  assert.equal(inputAfter(args), '/x.wav');
});

test('buildFfmpegArgs — file source passes NO device input-format flag', () => {
  const args = buildFfmpegArgs({ device: 'file:/x.wav' });
  for (const fmt of DEVICE_FORMATS) {
    assert.ok(!args.includes(fmt), `file mode must not emit -f ${fmt} (auto-detect)`);
  }
});

test('buildFfmpegArgs — file source honours channels / sampleRate', () => {
  const args = buildFfmpegArgs({ device: 'file:/x.wav', channels: 2, sampleRate: 48000 });
  assert.equal(args[args.indexOf('-ac') + 1], '2');
  assert.equal(args[args.indexOf('-ar') + 1], '48000');
});

test('buildFfmpegArgs — empty file: path throws audio_file_missing_path', () => {
  try {
    buildFfmpegArgs({ device: 'file:' });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'audio_file_missing_path');
  }
});

test('buildFfmpegArgs — live capture argv unchanged for a normal device', () => {
  const args = buildFfmpegArgs({ platform: 'darwin', device: ':0', channels: 1, sampleRate: 44100 });
  // Live mode keeps the device input-format flag and the device string.
  assert.equal(args[args.indexOf('-f') + 1], 'avfoundation');
  assert.equal(inputAfter(args), ':0');
  // And does NOT smuggle in file-mode flags.
  assert.equal(args.indexOf('-stream_loop'), -1);
  assert.equal(args.indexOf('-re'), -1);
});
