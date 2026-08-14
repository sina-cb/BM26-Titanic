// sparkle_param_migration.test.js — the saved-work guard for the 13_sparkle
// parameter rename (report 20260806_184).
//
// 13_sparkle used to name four controls after the audio signal that should
// drive them — `sliderLOW_Level`, `sliderHIGH_Brilliance`,
// `sliderFLUX_StarCount`, `sliderKICK_Burst`. They are now plain
// (`sliderLevel`, `sliderBrilliance`, `sliderStarCount`, `sliderBurst`) and the
// signal recommendation lives in the pattern's AUDIO_MODULATION_V1 block.
//
// WHY THIS FILE EXISTS: playlist LOAD IS LENIENT. `PlaylistManager._coerceModulations`
// drops a mapping whose target no longer resolves, and a `defaults` key that no
// longer matches an export is simply never replayed — both SILENTLY. A rename
// that missed one saved reference would therefore delete a night of the
// operator's tuning with no error anywhere. This test is the loud end of that:
// every saved reference to a 13_sparkle parameter in the titanic scene must
// resolve against the pattern's CURRENT exports, and the migrated values are
// pinned to the exact numbers that were on disk before the rename.
//
// Read-only: this test never writes to simulation/scenes.
//
// Run:  cd marsin_engine && node --test tests/playlist/sparkle_param_migration.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { parseAudioModSpec, audioSuggestionsBySlider } from '../../tools/audio_mod_spec.mjs';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(ENGINE_DIR, '..');
const PATTERN_FILE = path.join(ENGINE_DIR, 'patterns/13_sparkle.js');
const TITANIC_PLAYLISTS = path.join(REPO_ROOT, 'simulation/scenes/titanic/playlists');

const PATTERN_SRC = fs.readFileSync(PATTERN_FILE, 'utf8');

/** Every control export the pattern declares, in declaration order. */
function declaredControls(source) {
  return [...source.matchAll(
    /export\s+function\s+((?:slider|toggle|trigger|hsvPicker)[A-Za-z0-9_]*)\s*\(/g)].map(m => m[1]);
}

function titanicEntriesFor(patternName) {
  const out = [];
  for (const file of fs.readdirSync(TITANIC_PLAYLISTS).filter(f => f.endsWith('.yaml')).sort()) {
    const doc = yaml.load(fs.readFileSync(path.join(TITANIC_PLAYLISTS, file), 'utf8'));
    for (const entry of (doc?.entries ?? [])) {
      if (entry.pattern === patternName) out.push({ file, entry });
    }
  }
  return out;
}

// ── the pattern itself ──────────────────────────────────────────────────────

test('13_sparkle declares CLEAN parameter names in the original knob order', () => {
  // Declaration order IS physical MFT knob order (.agent/memory/pattern-param-order).
  // The rename happened IN PLACE — every setter kept its position, so knob N
  // still drives the same control it did before.
  assert.deepEqual(declaredControls(PATTERN_SRC), [
    'sliderLocalSpeed',
    'sliderLevel',
    'sliderStarCount',
    'sliderBrilliance',
    'sliderTwinkleFocus',
    'sliderAfterglow',
    'sliderStarChorus',
    'sliderBurst',
    'sliderJewelryWhite',
    'sliderUvStars',
  ]);
  // The signal-in-the-name hack is gone from the CODE (the doc comment still
  // explains what it was, deliberately).
  for (const dead of ['sliderLOW_Level', 'sliderHIGH_Brilliance', 'sliderFLUX_StarCount', 'sliderKICK_Burst']) {
    assert.ok(!PATTERN_SRC.includes(`export function ${dead}`), `${dead} must no longer be exported`);
  }
});

test('the audio recommendation moved into the header block, unchanged', () => {
  // The suggestion the four names used to encode is now METADATA on the same
  // four parameters — same signal, same range, same curve as the old header.
  const map = audioSuggestionsBySlider(parseAudioModSpec(PATTERN_SRC, '13_sparkle'));
  assert.deepEqual(map, {
    sliderLevel: {
      version: 'AUDIO_MODULATION_V1', signal: 'micLow', range: [0.20, 0.72],
      curve: 'linear', modulationCurve: 'linear', note: 'total elegance budget',
    },
    sliderBrilliance: {
      version: 'AUDIO_MODULATION_V1', signal: 'micHigh', range: [0.16, 0.76],
      curve: 'linear', modulationCurve: 'linear', note: 'high-frequency diamonds',
    },
    sliderStarCount: {
      version: 'AUDIO_MODULATION_V1', signal: 'micFlux', range: [0.12, 0.86],
      curve: 'ease', modulationCurve: 'easeOut', note: 'build reveals more stars',
    },
    sliderBurst: {
      version: 'AUDIO_MODULATION_V1', signal: 'micKick', range: [0.00, 0.78],
      curve: 'pow2', modulationCurve: 'easeIn', note: 'constellation burst',
    },
  });
  // The suggestion's modulation-engine curves are EXACTLY what the operator's
  // saved sound-reactive mappings already use — the metadata now says out loud
  // what the hand-built playlist entry encoded.
  assert.equal(map.sliderStarCount.modulationCurve, 'easeOut');
  assert.equal(map.sliderBurst.modulationCurve, 'easeIn');
});

// ── the saved operator work ─────────────────────────────────────────────────

test('EVERY saved 13_sparkle reference in the titanic scene still resolves', () => {
  const controls = new Set(declaredControls(PATTERN_SRC));
  const entries = titanicEntriesFor('13_sparkle');
  assert.ok(entries.length >= 3, `expected several saved 13_sparkle entries, found ${entries.length}`);

  const orphans = [];
  for (const { file, entry } of entries) {
    for (const key of Object.keys(entry.defaults ?? {})) {
      if (!controls.has(key)) orphans.push(`${file}:${entry.id} defaults.${key}`);
    }
    for (const mod of (entry.modulations ?? [])) {
      const param = mod?.target?.parameter;
      if (!controls.has(param)) orphans.push(`${file}:${entry.id} modulation ${mod.id} -> ${param}`);
    }
  }
  // A non-empty list here means saved operator tuning is being DROPPED on load
  // without a word of warning — the exact failure this rename had to avoid.
  assert.deepEqual(orphans, [], `orphaned saved 13_sparkle references:\n${orphans.join('\n')}`);
});

test('the migrated saved VALUES are byte-for-byte what was on disk pre-rename', () => {
  // Pinned from the pre-rename files (report 20260806_184 has the full
  // old-name -> new-name -> value table). Only the KEYS changed.
  const expected = {
    'ambient.yaml': {
      sliderLocalSpeed: 0.57, sliderLevel: 0.17, sliderStarCount: 0.73,
      sliderBrilliance: 0.59, sliderTwinkleFocus: 0.88, sliderAfterglow: 0.13,
      sliderStarChorus: 0.63, sliderBurst: 0.15, sliderJewelryWhite: 0.81,
      sliderUvStars: 0.78,
    },
    'ambient_sound_reactive.yaml': {
      sliderLocalSpeed: 0.3, sliderLevel: 0.45, sliderStarCount: 0.5,
      sliderBrilliance: 0.7, sliderTwinkleFocus: 0.5, sliderAfterglow: 0.5,
      sliderStarChorus: 0.55, sliderBurst: 0, sliderJewelryWhite: 0.5,
      sliderUvStars: 0.3,
    },
    'default.yaml': {
      sliderLocalSpeed: 0.3, sliderLevel: 1, sliderStarCount: 0.5,
      sliderBrilliance: 0.7, sliderTwinkleFocus: 0.5, sliderAfterglow: 0.5,
      sliderStarChorus: 0.55, sliderBurst: 0, sliderJewelryWhite: 0.5,
      sliderUvStars: 0.3,
    },
  };
  const byFile = Object.fromEntries(
    titanicEntriesFor('13_sparkle').map(({ file, entry }) => [file, entry]));
  for (const [file, defaults] of Object.entries(expected)) {
    assert.ok(byFile[file], `${file} must still carry a 13_sparkle entry`);
    assert.deepEqual(byFile[file].defaults, defaults, `${file} saved values must be preserved exactly`);
  }
});

test('the sound-reactive playlist keeps all four modulations, retargeted only', () => {
  const entry = titanicEntriesFor('13_sparkle')
    .find(e => e.file === 'ambient_sound_reactive.yaml').entry;
  assert.deepEqual(entry.modulations.map(m => ({
    id: m.id, key: m.source.key, param: m.target.parameter,
    mode: m.mode, range: m.range, curve: m.curve,
  })), [
    { id: 'mod_sliderLevel_micLow', key: 'micLow', param: 'sliderLevel', mode: 'override', range: [0.2, 0.7], curve: 'linear' },
    { id: 'mod_sliderBrilliance_micHigh', key: 'micHigh', param: 'sliderBrilliance', mode: 'override', range: [0.16, 0.76], curve: 'linear' },
    { id: 'mod_sliderBurst_micKick', key: 'micKick', param: 'sliderBurst', mode: 'override', range: [0, 0.78], curve: 'easeIn' },
    { id: 'mod_sliderStarCount_micFlux', key: 'micFlux', param: 'sliderStarCount', mode: 'override', range: [0.12, 0.86], curve: 'easeOut' },
  ]);
  // The micFlux binding is the one the operator reported as dead. It survives
  // the rename; the Companion now actually publishes the signal it rides.
  assert.ok(entry.modulations.some(m => m.source.key === 'micFlux'));
});
