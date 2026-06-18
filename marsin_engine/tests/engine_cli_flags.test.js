/**
 * engine_cli_flags — argv parser for the audio CLI surface
 * (--list_mics / --choose_mic / --start / --mic / --clear_mic).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEngineFlags, flagsRequireExit } from '../lib/engine_cli_flags.js';

test('parseEngineFlags — empty argv returns all-false', () => {
  const f = parseEngineFlags([]);
  assert.deepEqual(f, { listMics: false, chooseMic: false, start: false, mic: null, clearMic: false, audioFile: null });
});

test('parseEngineFlags — --list_mics', () => {
  assert.equal(parseEngineFlags(['--list_mics']).listMics, true);
});

test('parseEngineFlags — --choose_mic alone', () => {
  const f = parseEngineFlags(['--choose_mic']);
  assert.equal(f.chooseMic, true);
  assert.equal(f.start, false);
});

test('parseEngineFlags — --choose_mic --start', () => {
  const f = parseEngineFlags(['--choose_mic', '--start']);
  assert.equal(f.chooseMic, true);
  assert.equal(f.start, true);
});

test('parseEngineFlags — --mic "audio=Microphone Array"', () => {
  const f = parseEngineFlags(['--mic', 'audio=Microphone Array']);
  assert.equal(f.mic, 'audio=Microphone Array');
});

test('parseEngineFlags — --clear_mic', () => {
  assert.equal(parseEngineFlags(['--clear_mic']).clearMic, true);
});

test('parseEngineFlags — --audio_file /x.wav', () => {
  const f = parseEngineFlags(['--audio_file', '/x.wav']);
  assert.equal(f.audioFile, '/x.wav');
});

test('parseEngineFlags — --audio_file is not an exit flag (continues boot)', () => {
  assert.equal(flagsRequireExit(parseEngineFlags(['--audio_file', '/x.wav'])), false);
});

test('parseEngineFlags — --audio_file without value throws cli_missing_value', () => {
  assert.throws(() => parseEngineFlags(['--audio_file']), /requires a path/);
  assert.throws(() => parseEngineFlags(['--audio_file', '--start']), /requires a path/);
  try {
    parseEngineFlags(['--audio_file']);
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'cli_missing_value');
  }
});

test('parseEngineFlags — --mic without value throws', () => {
  assert.throws(() => parseEngineFlags(['--mic']), /requires a device string/);
  assert.throws(() => parseEngineFlags(['--mic', '--start']), /requires a device string/);
});

test('parseEngineFlags — mixed with unrelated flags is fine', () => {
  // engine.js' real arg parser owns --pattern / --model; we just
  // pluck our own and ignore everything else.
  const f = parseEngineFlags(['--pattern', 'fire', '--model', 'test_bench', '--list_mics']);
  assert.equal(f.listMics, true);
  assert.equal(f.mic, null);
});

test('flagsRequireExit — --list_mics exits', () => {
  assert.equal(flagsRequireExit(parseEngineFlags(['--list_mics'])), true);
});
test('flagsRequireExit — --clear_mic exits', () => {
  assert.equal(flagsRequireExit(parseEngineFlags(['--clear_mic'])), true);
});
test('flagsRequireExit — --choose_mic alone exits', () => {
  assert.equal(flagsRequireExit(parseEngineFlags(['--choose_mic'])), true);
});
test('flagsRequireExit — --choose_mic --start continues', () => {
  assert.equal(flagsRequireExit(parseEngineFlags(['--choose_mic', '--start'])), false);
});
test('flagsRequireExit — --mic continues', () => {
  assert.equal(flagsRequireExit(parseEngineFlags(['--mic', ':0'])), false);
});
test('flagsRequireExit — null is safe', () => {
  assert.equal(flagsRequireExit(null), false);
});
