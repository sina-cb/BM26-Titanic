import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { describeLibrary } from '../../lib/global_effect_library.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = path.resolve(HERE, '../../../docs/ui/touch_control.html');
const PANEL_SOURCE = fs.readFileSync(PANEL_PATH, 'utf8');

function objectKeysAfter(marker) {
  const start = PANEL_SOURCE.indexOf(marker);
  assert.notEqual(start, -1, `touch panel is missing ${marker}`);
  const bodyStart = PANEL_SOURCE.indexOf('{', start);
  const bodyEnd = PANEL_SOURCE.indexOf('\n  };', bodyStart);
  assert.notEqual(bodyEnd, -1, `touch panel has no closing object for ${marker}`);
  return new Set(
    [...PANEL_SOURCE.slice(bodyStart, bodyEnd).matchAll(/^\s*'([^']+)':/gm)]
      .map(match => match[1]),
  );
}

test('touch panel effect catalog has no built-in fallback list', () => {
  assert.match(PANEL_SOURCE, /var FX_OPTS = \[\];\s*\/\* populated only from GET \/global-effect-library \*\//);
});

test('every engine effect preset has an explicit touch-panel face', () => {
  const faces = objectKeysAfter('var FX_SHORT = {');
  const expected = [];
  for (const [effectId, effect] of Object.entries(describeLibrary())) {
    for (const presetId of Object.keys(effect.presets)) expected.push(`${effectId}|${presetId}`);
  }
  assert.deepEqual([...faces].sort(), expected.sort());
});

test('every touch-panel default exists in the engine registry', () => {
  const defaultBlock = PANEL_SOURCE.match(/var FX_DEFAULT = \[([\s\S]*?)\n  \];/);
  assert.ok(defaultBlock, 'touch panel is missing FX_DEFAULT');
  const defaults = [...defaultBlock[1].matchAll(/'([^']+\|[^']+)'/g)].map(match => match[1]);
  assert.equal(defaults.length, 16, 'the 4x4 panel must declare exactly 16 defaults');

  const available = new Set();
  for (const [effectId, effect] of Object.entries(describeLibrary())) {
    for (const presetId of Object.keys(effect.presets)) available.add(`${effectId}|${presetId}`);
  }
  for (const key of defaults) assert.ok(available.has(key), `default ${key} is absent from the engine registry`);
});
