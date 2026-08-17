import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const PLAYLIST_DIR = path.join(REPO_ROOT, 'simulation/scenes/titanic/playlists');
const PATTERN_DIR = path.join(ENGINE_DIR, 'patterns');
const MANIFEST = new Set(JSON.parse(fs.readFileSync(path.join(PATTERN_DIR, 'manifest.json'), 'utf8')));
const AUDIO_SOURCES = new Set(['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux']);
function loadPlaylist(name) {
  return yaml.load(fs.readFileSync(path.join(PLAYLIST_DIR, `${name}.yaml`), 'utf8'));
}

function exportedControls(pattern) {
  const sourcePath = path.join(PATTERN_DIR, `${pattern}.js`);
  assert.ok(fs.existsSync(sourcePath), `${pattern}: source file must exist`);
  const source = fs.readFileSync(sourcePath, 'utf8');
  return new Set([...source.matchAll(
    /export\s+function\s+((?:slider|toggle|trigger|hsvPicker)[A-Za-z0-9_]*)\s*\(/g,
  )].map((match) => match[1]));
}

function assertEntryResolves(entry, playlistName) {
  assert.ok(MANIFEST.has(entry.pattern), `${playlistName}/${entry.pattern}: absent from manifest`);
  const controls = exportedControls(entry.pattern);
  for (const key of Object.keys(entry.defaults ?? {})) {
    assert.ok(controls.has(key), `${playlistName}/${entry.pattern}: stale default ${key}`);
  }
  for (const modulation of entry.modulations ?? []) {
    assert.ok(AUDIO_SOURCES.has(modulation.source?.key),
      `${playlistName}/${entry.pattern}: stale source ${modulation.source?.key}`);
    assert.ok(controls.has(modulation.target?.parameter),
      `${playlistName}/${entry.pattern}: stale target ${modulation.target?.parameter}`);
  }
}

test('Ambient reactive is a same-order, exact-default, silence-safe twin of Ambient', () => {
  const ambient = loadPlaylist('ambient');
  const reactive = loadPlaylist('ambient_sound_reactive');
  assert.equal(ambient.entries.length, 47);
  assert.equal(reactive.entries.length, ambient.entries.length);
  assert.deepEqual(reactive.entries.map((entry) => entry.pattern),
    ambient.entries.map((entry) => entry.pattern));

  for (let index = 0; index < ambient.entries.length; index += 1) {
    const identity = ambient.entries[index];
    const entry = reactive.entries[index];
    assert.deepEqual(entry.defaults, identity.defaults, `${entry.pattern}: defaults diverged`);
    assert.ok(entry.modulations.length >= 1 && entry.modulations.length <= 3,
      `${entry.pattern}: expected one to three restrained mappings`);
    assertEntryResolves(entry, 'ambient_sound_reactive');
    for (const modulation of entry.modulations) {
      assert.equal(modulation.mode, 'override', `${entry.pattern}: mappings must be override`);
      assert.equal(modulation.polarity, 'unipolar', `${entry.pattern}: mappings must be unipolar`);
      assert.equal(modulation.enabled, true, `${entry.pattern}: mapping must be enabled`);
      assert.equal(modulation.range[0], identity.defaults[modulation.target.parameter],
        `${entry.pattern}/${modulation.target.parameter}: silence must equal saved Ambient`);
      assert.ok(modulation.range[1] > modulation.range[0] && modulation.range[1] <= 1,
        `${entry.pattern}/${modulation.target.parameter}: invalid response range`);
      assert.ok(['linear', 'easeIn', 'easeOut'].includes(modulation.curve),
        `${entry.pattern}: unsupported curve ${modulation.curve}`);
    }
  }
});

test('Cleaned default contains only resolvable entries and the known dead 110 is absent', () => {
  const playlist = loadPlaylist('default');
  assert.equal(playlist.entries.length, 26);
  assert.ok(!playlist.entries.some((entry) => entry.pattern === '110_logsville_giant_pixel_chase'));
  for (const entry of playlist.entries) assertEntryResolves(entry, 'default');
});

test('the retired Ambient default backup playlist stays absent from both scenes', () => {
  for (const scene of ['titanic', 'test_bench']) {
    const filename = path.join(
      REPO_ROOT, 'simulation', 'scenes', scene, 'playlists', 'ambient_default_bkup.yaml');
    assert.equal(fs.existsSync(filename), false,
      `${scene}: retired ambient_default_bkup.yaml is back`);
  }
});
