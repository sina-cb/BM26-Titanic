import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const WHITE_IDS = [
  '60_white_wash',
  '61_white_breathe',
  '62_white_shimmer',
  '63_white_chase',
  '64_temple_warm_white',
];
const SCENES = ['titanic', 'test_bench'];

function playlistPath(scene) {
  return path.join(REPO_DIR, 'simulation', 'scenes', scene, 'playlists', 'white_only.yaml');
}

function sliderNames(pattern) {
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'patterns', `${pattern}.js`), 'utf8');
  return [...source.matchAll(/export\s+function\s+(slider\w+)\s*\(/g)].map((match) => match[1]);
}

test('white_only is one complete, explicitly tuned, unmodulated White review arc', () => {
  const documents = SCENES.map((scene) => yaml.load(fs.readFileSync(playlistPath(scene), 'utf8')));
  for (const [sceneIndex, document] of documents.entries()) {
    const scene = SCENES[sceneIndex];
    assert.equal(document.schemaVersion, 1);
    assert.equal(document.name, 'white_only');
    assert.deepEqual(document.entries.map((entry) => entry.pattern), WHITE_IDS,
      `${scene}/white_only must preserve the complete ordered White family`);

    for (const entry of document.entries) {
      const expectedControls = sliderNames(entry.pattern);
      assert.deepEqual(Object.keys(entry.defaults), expectedControls,
        `${scene}/${entry.pattern}: save every control in declaration order for exact bench review`);
      for (const [name, value] of Object.entries(entry.defaults)) {
        assert.equal(Number.isFinite(value), true, `${scene}/${entry.pattern}/${name}: non-finite tune`);
        assert.ok(value >= 0 && value <= 1,
          `${scene}/${entry.pattern}/${name}: tune ${value} is outside [0, 1]`);
      }
      assert.deepEqual(entry.modulations, [], `${scene}/${entry.pattern}: White review must be static`);
      assert.deepEqual(entry.midiMappings, [], `${scene}/${entry.pattern}: White review must not bind MIDI`);
    }
  }
});

test('Titanic and test_bench carry byte-identical white_only review tunes', () => {
  assert.equal(
    fs.readFileSync(playlistPath('titanic'), 'utf8'),
    fs.readFileSync(playlistPath('test_bench'), 'utf8'),
  );
});
