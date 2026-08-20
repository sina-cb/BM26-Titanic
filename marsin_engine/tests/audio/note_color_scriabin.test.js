import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOTE_COLOR_SCRIABIN, NOTE_COLOR_PITCH_KEYS, NOTE_COLOR_WHEEL_DEFAULTS,
  validateDerivedSignalsPatch,
} from '../../audio/config/derived_signals_config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_APP = path.join(HERE, '..', '..', 'audio', 'companion', 'ui', 'companion_app.js');
const UI_HTML = path.join(HERE, '..', '..', 'audio', 'companion', 'ui', 'index.html');

/**
 * W9 (docs/59 §2) — the SCRIABIN preset for the companion's noteColors wheel.
 *
 * The rig's FOLLOW NOTE mode consumes `audioNoteHue`, i.e. THIS wheel — ONE
 * operator-tunable note→colour authority. Live Touch's FOLLOW NOTE uses
 * Scriabin's published table instead, so the two surfaces can honestly
 * disagree. Rather than port a second mapping into the engine (two authorities
 * that can drift), the twelve Scriabin hues are a PRESET for the one wheel.
 */

test('the preset names every pitch key the wheel has, and no others', () => {
  assert.deepEqual(Object.keys(NOTE_COLOR_SCRIABIN).sort(), [...NOTE_COLOR_PITCH_KEYS].sort());
});

test('the whole preset ROUND-TRIPS through the wheel\'s own patch validator', () => {
  // The button sends exactly this: ONE 12-field setDerivedConfig patch through
  // the ordinary door. If any value were outside [0,1) the operator would tap
  // it and get a flash instead of a wheel — checked here, not on the playa.
  const out = validateDerivedSignalsPatch({ noteColors: { ...NOTE_COLOR_SCRIABIN } });
  assert.deepEqual(out.noteColors, { ...NOTE_COLOR_SCRIABIN });
});

test('a hue at or past the top of the wheel is still refused — the preset is not exempt', () => {
  assert.throws(() => validateDerivedSignalsPatch({ noteColors: { c: 1 } }), /must be in \[0, 1\)/);
  assert.throws(() => validateDerivedSignalsPatch({ noteColors: { c: -0.01 } }), /must be in \[0, 1\)/);
});

test('SCRIABIN is a DIFFERENT wheel from the reference one — it is a choice, not a rename', () => {
  const differing = NOTE_COLOR_PITCH_KEYS.filter(
    (k) => NOTE_COLOR_SCRIABIN[k] !== NOTE_COLOR_WHEEL_DEFAULTS[k]);
  assert.ok(differing.length >= 10,
    `the two wheels should disagree about nearly every note, differed on ${differing.length}`);
});

test('the preset carries HUE ONLY — no saturation or value leaks in', () => {
  // Scriabin's table also varies S/V ("flesh, with a glint of steel"), but this
  // wheel is hue-only by design and `generateScheme` takes a bare hue, so the
  // S/V could not ride through the generators anyway. Dropping it is stated,
  // not discovered.
  for (const key of NOTE_COLOR_PITCH_KEYS) {
    assert.equal(typeof NOTE_COLOR_SCRIABIN[key], 'number', `${key} must be a bare hue`);
  }
});

test('the Companion UI bundle carries the SAME twelve hues, byte for byte', () => {
  // The UI is a static bundle with no import of the engine config module, so
  // the two copies are pinned HERE rather than by a shared import. A drift
  // would give the operator a button that loads a wheel nobody designed.
  const src = fs.readFileSync(UI_APP, 'utf8');
  const block = /const NOTE_COLOR_SCRIABIN = \{([\s\S]*?)\};/.exec(src);
  assert.ok(block, 'companion_app.js must declare NOTE_COLOR_SCRIABIN');
  const uiHues = {};
  for (const m of block[1].matchAll(/([A-Za-z]+):\s*([0-9.]+)/g)) uiHues[m[1]] = Number(m[2]);
  assert.deepEqual(uiHues, { ...NOTE_COLOR_SCRIABIN });
});

test('the Companion UI exposes the button and says what it does', () => {
  const html = fs.readFileSync(UI_HTML, 'utf8');
  assert.match(html, /id="note-color-scriabin"/, 'the SCRIABIN button must exist');
  assert.match(html, /id="note-color-scriabin-help"/, 'and must carry its explanation');
  const src = fs.readFileSync(UI_APP, 'utf8');
  assert.match(src, /\$\('note-color-scriabin'\)\.onclick/, 'the button must be wired');
  // It goes through the ordinary door — no preset-shaped side channel that
  // could write a hue the editor would refuse.
  assert.match(src, /type: 'setDerivedConfig', group: 'noteColors', patch: \{ \.\.\.NOTE_COLOR_SCRIABIN \}/);
});
