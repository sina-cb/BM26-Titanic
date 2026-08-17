import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, '..', '..');
const repoDir = path.resolve(engineDir, '..');

test('production Titanic launch has exactly one analyzer: the Audio Companion', () => {
  const base = yaml.load(fs.readFileSync(path.join(engineDir, 'config.yaml'), 'utf8'));
  const scene = yaml.load(fs.readFileSync(
    path.join(engineDir, 'states', 'titanic', 'audio_state.yaml'),
    'utf8',
  ));
  const launcher = fs.readFileSync(path.join(repoDir, 'launcher.js'), 'utf8');

  assert.equal(base.audio.enabled, false, 'portable engine analyzer default must remain disabled');
  assert.equal(scene.enabled, false,
    'Titanic scene state must not override the engine analyzer on while Companion is running');
  assert.match(launcher, /companions:\s*\['audio'\]/,
    'the production launcher must supervise the sole Audio Companion analyzer');
});
