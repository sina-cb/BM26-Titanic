// Unit tests for MIDI mappings (engine side) — mirrors the modulation tests.
// Run:  node --test tests/midi_mapping.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { PlaylistManager } from '../lib/playlist_manager.js';
import { validateMidiMapping } from '../lib/midi_mapping_engine.js';

function tmpdirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'midimap_test_'));
  const playlistsDir = path.join(root, 'playlists');
  const patternsDir = path.join(root, 'patterns');
  fs.mkdirSync(playlistsDir, { recursive: true });
  fs.mkdirSync(patternsDir, { recursive: true });
  fs.writeFileSync(path.join(patternsDir, '13_sparkle.js'), '// stub\nexport var foo = 0;\n');
  return { playlistsDir, patternsDir };
}

const VALID = () => ({
  id: 'midi_sliderLocalSpeed',
  enabled: true,
  control: { type: 'cc', channel: 0, number: 51 },
  target: { scope: 'pattern', parameter: 'sliderLocalSpeed' },
  range: [0, 1],
});

test('validateMidiMapping accepts a well-formed mapping', () => {
  const v = validateMidiMapping(VALID());
  assert.equal(v.target.parameter, 'sliderLocalSpeed');
  assert.equal(v.control.number, 51);
});

test('validateMidiMapping rejects malformed mappings', () => {
  assert.throws(() => validateMidiMapping(null), /must be an object/);
  assert.throws(() => validateMidiMapping({ ...VALID(), id: '' }), /id must be/);
  assert.throws(() => validateMidiMapping({ ...VALID(), enabled: 'yes' }), /enabled must be boolean/);
  assert.throws(() => validateMidiMapping({ ...VALID(), control: undefined }), /control required/);
  assert.throws(() => validateMidiMapping({ ...VALID(), control: { type: 'pitchbend', channel: 0, number: 1 } }), /control.type/);
  assert.throws(() => validateMidiMapping({ ...VALID(), control: { type: 'cc', channel: 16, number: 1 } }), /control.channel/);
  assert.throws(() => validateMidiMapping({ ...VALID(), control: { type: 'cc', channel: 0, number: 200 } }), /control.number/);
  assert.throws(() => validateMidiMapping({ ...VALID(), target: { scope: 'global', parameter: 'x' } }), /target.scope/);
  assert.throws(() => validateMidiMapping({ ...VALID(), target: { scope: 'pattern', parameter: '' } }), /target.parameter/);
  assert.throws(() => validateMidiMapping({ ...VALID(), range: [0] }), /range must be/);
});

test('playlist round-trips midiMappings through disk', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.save({
    name: 'mm',
    entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [VALID()] }],
  });
  const reloaded = pm.load('mm');
  assert.equal(reloaded.entries[0].midiMappings.length, 1);
  assert.equal(reloaded.entries[0].midiMappings[0].target.parameter, 'sliderLocalSpeed');
});

test('save rejects an invalid midi mapping (strict)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  assert.throws(() => pm.save({
    name: 'bad',
    entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [{ ...VALID(), control: { type: 'cc', channel: 99, number: 1 } }] }],
  }), /control.channel/);
});

test('save rejects two mappings targeting the same param (one-per-target)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  assert.throws(() => pm.save({
    name: 'dup',
    entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [
      { ...VALID(), id: 'a' },
      { ...VALID(), id: 'b', control: { type: 'cc', channel: 0, number: 52 } },
    ] }],
  }), /one per target/);
});

test('load is lenient — drops an invalid mapping, keeps valid ones', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  // Write a file directly with one good + one bad mapping.
  const good = VALID();
  const bad = { id: 'broken', enabled: true, control: { type: 'cc', channel: 0, number: 1 }, target: { scope: 'pattern', parameter: 'x' }, range: 'nope' };
  fs.writeFileSync(path.join(playlistsDir, 'mix.yaml'),
    yaml.dump({ schemaVersion: 1, name: 'mix', entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [good, bad] }] }));
  const reloaded = pm.load('mix');
  assert.equal(reloaded.entries[0].midiMappings.length, 1);
  assert.equal(reloaded.entries[0].midiMappings[0].id, 'midi_sliderLocalSpeed');
});
