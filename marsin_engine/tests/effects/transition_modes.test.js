import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DECK_TRANSITION_MODES,
  isDeckTransitionMode,
  pickDeckTransitionMode,
} from '../../lib/transition_modes.js';
import { CUE_TRANSITION_MODES } from '../../lib/timeline/show_plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const TRANSITIONS_DIR = path.join(ENGINE_DIR, 'patterns', 'transitions');

test('the canonical transition catalog exactly matches executable scripts', () => {
  const scripts = fs.readdirSync(TRANSITIONS_DIR)
    .filter((name) => name.startsWith('trans_') && name.endsWith('.js'))
    .map((name) => path.basename(name, '.js'))
    .sort();
  assert.deepEqual([...DECK_TRANSITION_MODES].sort(), scripts);
  assert.deepEqual(CUE_TRANSITION_MODES, DECK_TRANSITION_MODES);
  assert.equal(isDeckTransitionMode('trans_crossfade'), true);
  assert.equal(isDeckTransitionMode('trans_morse_blink'), false);
  assert.equal(isDeckTransitionMode('trans_does_not_exist'), false);
});

test('shuffle selection is bounded and deterministically testable', () => {
  assert.equal(pickDeckTransitionMode(0), DECK_TRANSITION_MODES[0]);
  assert.equal(
    pickDeckTransitionMode(1 - Number.EPSILON),
    DECK_TRANSITION_MODES[DECK_TRANSITION_MODES.length - 1],
  );
  assert.throws(() => pickDeckTransitionMode(1), /must be finite in \[0,1\)/);
  assert.throws(() => pickDeckTransitionMode(Number.NaN), /must be finite/);
});

test('Morse Blink has no stale executable, selector, gallery, HIL, or language-spec reference', () => {
  const files = [
    path.join(ENGINE_DIR, 'lib', 'api_server.js'),
    path.join(ENGINE_DIR, 'lib', 'timeline', 'show_plan.js'),
    path.join(ENGINE_DIR, 'tests', 'hil', 'hil_transition_pixel_perfect_test.mjs'),
    path.join(ENGINE_DIR, 'tools', 'transition_gallery', 'generate.mjs'),
    path.join(ENGINE_DIR, 'tools', 'param_truth', 'param_truth_results.json'),
    path.join(REPO_DIR, 'docs', 'MARSIN_PB_LANG_SPEC.md'),
    path.join(REPO_DIR, 'docs', 'pattern_gallery', 'transitions', 'manifest.json'),
    path.join(REPO_DIR, 'docs', 'pattern_gallery', 'transitions', 'index.html'),
    path.join(REPO_DIR, 'CaptainPad', 'utils', 'timelineApi.ts'),
    path.join(REPO_DIR, 'CaptainPad', 'components', 'DeckTransitionControls.tsx'),
  ];
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /trans_morse_blink/,
      `stale Morse Blink reference in ${file}`);
  }
  assert.equal(
    fs.existsSync(path.join(TRANSITIONS_DIR, 'trans_morse_blink.js')),
    false,
    'Morse Blink executable must be deleted',
  );
});
