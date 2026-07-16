// Unit tests for MIDI mappings (engine side) — mirrors the modulation tests.
// Run:  node --test tests/midi_mapping.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { PlaylistManager } from '../../lib/playlist_manager.js';
import { validateMidiMapping } from '../../lib/midi_mapping_engine.js';

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

// ── PUT upsert-by-target ────────────────────────────────────────────────
// Faithful replay of the api_server PUT handler's persistence sequence for
// /api/playlists/:name/items/:itemId/midi-mappings/:mappingId:
//   load → validate(incoming) → upsertMidiMapping → save.
// The upsert filter is NO LONGER copy-pasted here — both this helper and the
// route call the SAME PlaylistManager.upsertMidiMapping, so they cannot drift.
// This exercises the friendly upsert AND the strict save() backstop
// (PlaylistManager) without booting the whole engine.
function putMidiMapping(pm, playlistName, itemId, mappingId, body) {
  const playlist = pm.load(playlistName);
  if (!playlist) throw new Error('playlist not found');
  const entry = playlist.entries.find(e => e.id === itemId);
  if (!entry) throw new Error('item not found');
  const incoming = { ...body, id: mappingId };
  validateMidiMapping(incoming); // fail loud on bad shape, exactly like the route
  pm.upsertMidiMapping(entry, incoming);
  const saved = pm.save(playlist);
  return saved.entries.find(e => e.id === itemId);
}

test('PUT upsert-by-target: re-binding a param under a NEW id replaces the old binding (one mapping, no throw)', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.save({ name: 'up', entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [] }] });

  // PUT id=X targeting parameter P (CC 51).
  putMidiMapping(pm, 'up', 'e1', 'X', {
    enabled: true,
    control: { type: 'cc', channel: 0, number: 51 },
    target: { scope: 'pattern', parameter: 'P' },
    range: [0, 1],
  });
  // PUT id=Y targeting the SAME parameter P (different id + different CC).
  const entry = putMidiMapping(pm, 'up', 'e1', 'Y', {
    enabled: true,
    control: { type: 'cc', channel: 0, number: 52 },
    target: { scope: 'pattern', parameter: 'P' },
    range: [0, 1],
  });

  // Exactly one mapping targets P — the second (id=Y, CC 52) — and no throw.
  assert.equal(entry.midiMappings.length, 1);
  assert.equal(entry.midiMappings[0].id, 'Y');
  assert.equal(entry.midiMappings[0].target.parameter, 'P');
  assert.equal(entry.midiMappings[0].control.number, 52);
});

test('PUT upsert-by-target: two DIFFERENT targets coexist', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  pm.save({ name: 'two', entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [] }] });

  putMidiMapping(pm, 'two', 'e1', 'A', {
    enabled: true,
    control: { type: 'cc', channel: 0, number: 51 },
    target: { scope: 'pattern', parameter: 'P1' },
    range: [0, 1],
  });
  const entry = putMidiMapping(pm, 'two', 'e1', 'B', {
    enabled: true,
    control: { type: 'cc', channel: 0, number: 52 },
    target: { scope: 'pattern', parameter: 'P2' },
    range: [0, 1],
  });

  assert.equal(entry.midiMappings.length, 2);
  const params = entry.midiMappings.map(m => m.target.parameter).sort();
  assert.deepEqual(params, ['P1', 'P2']);
});

test('backstop intact: a direct save() with two same-target mappings still throws', () => {
  const { playlistsDir, patternsDir } = tmpdirs();
  const pm = new PlaylistManager(playlistsDir, patternsDir);
  // Bypasses the friendly PUT upsert — the save() one-per-target guard must
  // still reject two distinct-id mappings on the same param (defense in depth).
  assert.throws(() => pm.save({
    name: 'backstop',
    entries: [{ id: 'e1', pattern: '13_sparkle', midiMappings: [
      { ...VALID(), id: 'a', target: { scope: 'pattern', parameter: 'P' } },
      { ...VALID(), id: 'b', control: { type: 'cc', channel: 0, number: 52 }, target: { scope: 'pattern', parameter: 'P' } },
    ] }],
  }), /one per target/);
});
