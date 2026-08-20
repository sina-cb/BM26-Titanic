import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { THEMES, planAmbientSync } from '../../tools/playlist_curation/sync_ambient_playlists.mjs';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const SCENES = ['titanic', 'test_bench'];
const DIAGNOSTIC_PLAYLISTS = new Set(['calibration.yaml', 'dirty_probe.yaml', 'mix_show.yaml']);

function playlistPath(scene, name) {
  return path.join(REPO_ROOT, 'simulation', 'scenes', scene, 'playlists', `${name}.yaml`);
}

function load(scene, name) {
  return yaml.load(fs.readFileSync(playlistPath(scene, name), 'utf8'));
}

test('Titanic Ambient is the exact static source for the test-bench mirror', () => {
  assert.equal(
    fs.readFileSync(playlistPath('test_bench', 'ambient'), 'utf8'),
    fs.readFileSync(playlistPath('titanic', 'ambient'), 'utf8'),
  );
});

test('Ambient Sound Reactive is one byte-identical two-scene party stash', () => {
  assert.equal(
    fs.readFileSync(playlistPath('test_bench', 'ambient_sound_reactive'), 'utf8'),
    fs.readFileSync(playlistPath('titanic', 'ambient_sound_reactive'), 'utf8'),
  );
  const ambient = load('titanic', 'ambient');
  const reactive = load('titanic', 'ambient_sound_reactive');
  assert.deepEqual(reactive.entries.map((entry) => entry.pattern),
    ambient.entries.map((entry) => entry.pattern));
  for (let index = 0; index < ambient.entries.length; index += 1) {
    assert.deepEqual(reactive.entries[index].defaults, ambient.entries[index].defaults);
    assert.ok(reactive.entries[index].modulations.length >= 1);
  }
});

test('every non-diagnostic Ambient reuse inherits the canonical static entry', () => {
  const ambient = load('titanic', 'ambient');
  const byPattern = new Map(ambient.entries.map((entry) => [entry.pattern, entry]));
  for (const scene of SCENES) {
    const directory = path.dirname(playlistPath(scene, 'ambient'));
    for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.yaml'))) {
      if (DIAGNOSTIC_PLAYLISTS.has(filename)
          || filename === 'ambient.yaml'
          || filename === 'ambient_sound_reactive.yaml') continue;
      const document = yaml.load(fs.readFileSync(path.join(directory, filename), 'utf8'));
      for (const entry of document.entries ?? []) {
        const source = byPattern.get(entry.pattern);
        if (!source) continue;
        assert.deepEqual(entry.defaults, source.defaults, `${scene}/${filename}/${entry.pattern}`);
        assert.deepEqual(entry.modulations, [], `${scene}/${filename}/${entry.pattern}: modulation drift`);
        assert.deepEqual(entry.midiMappings, [], `${scene}/${filename}/${entry.pattern}: MIDI drift`);
      }
    }
  }
});

test('thematic Ambient arcs contain only canonical locked entries and mirror scenes', () => {
  const ambient = load('titanic', 'ambient');
  const byPattern = new Map(ambient.entries.map((entry) => [entry.pattern, entry]));
  for (const [name, patterns] of Object.entries(THEMES)) {
    const titanicRaw = fs.readFileSync(playlistPath('titanic', name), 'utf8');
    assert.equal(fs.readFileSync(playlistPath('test_bench', name), 'utf8'), titanicRaw);
    const playlist = yaml.load(titanicRaw);
    assert.deepEqual(playlist.entries.map((entry) => entry.pattern), patterns);
    for (const entry of playlist.entries) {
      assert.deepEqual(entry.defaults, byPattern.get(entry.pattern).defaults);
      assert.deepEqual(entry.modulations, []);
      assert.deepEqual(entry.midiMappings, []);
    }
  }
});

test('the committed playlist tree is synchronized by the permanent tool', () => {
  assert.deepEqual([...planAmbientSync().keys()], []);
});
