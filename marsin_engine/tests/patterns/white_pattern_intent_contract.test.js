import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validatePatternIntent } from '../../tools/playlist_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const GOALS_PATH = path.join(ENGINE_DIR, 'tools', 'playlist_gallery', 'pattern_goals.json');
const WHITE_IDS = [
  '60_white_wash',
  '61_white_breathe',
  '62_white_shimmer',
  '63_white_chase',
  '64_temple_warm_white',
];

test('every White review pattern has a current versioned fixture-authored intent', () => {
  const goals = JSON.parse(fs.readFileSync(GOALS_PATH, 'utf8'));
  for (const id of WHITE_IDS) {
    const source = fs.readFileSync(path.join(ENGINE_DIR, 'patterns', `${id}.js`), 'utf8');
    assert.doesNotMatch(
      source,
      /\bvar\s+FIX_[A-Z0-9_]+\s*=/,
      `${id}: fixture capabilities must be model-injected, never self-declared`,
    );
    assert.doesNotThrow(
      () => validatePatternIntent(id, goals[id], source),
      `${id}: missing or stale structured White design intent`,
    );
    assert.match(goals[id].jewelry_white, /Jewelry|Vintage|native.white/i);
    assert.match(goals[id].te_sign_treatment, /TE|Identity|sign/i);
    assert.match(goals[id].palette_white_material, /W.?=.?(?:A|amber)|native.white/i);
  }
});
