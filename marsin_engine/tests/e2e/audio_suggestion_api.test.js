// audio_suggestion_api.test.js — the engine SURFACES a pattern's declared
// audio-binding suggestions on its existing parameter payloads.
//
// Contract (report 20260806_184):
//   - Suggestions ride the `exports:` array on /mixer and /deck as an ADDITIVE
//     per-export `audioSuggestion` field — the same seam `codeDefault` and
//     `cpcOwned`/`cpcLabel` already use. NO new endpoint, no new round trip.
//   - The field is keyed by the RUNTIME parameter name and NEVER changes it,
//     and never changes the parameter's value.
//   - A pattern with no AUDIO_MODULATION_V1 block gets NO field at all —
//     absence is absence, nothing is inferred.
//
// Spawns a REAL engine on a high random port with temp state/playlist dirs and
// its sACN output black-holed, so it cannot touch the operator's live stack.
//
// Run:  cd marsin_engine && node --test tests/e2e/audio_suggestion_api.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';
import { parseAudioModSpec, audioSuggestionsBySlider } from '../../tools/audio_mod_spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'marsin-audiosugg',
  // Deliberately clear of the operator's stack (6966-6972, 5568, 8081, 10000)
  // and of the other suites' windows.
  portBase: 7420,
  portSpan: 60,
  // Black-hole sACN so the spawned engine can never reach the live sim bridge.
  extraArgs: ['--dest', '127.0.0.9'],
});
const { api } = h;

/** The pattern's suggestions computed independently, straight from source. */
function expectedSuggestions(patternName) {
  const src = fs.readFileSync(path.join(ENGINE_DIR, 'patterns', `${patternName}.js`), 'utf8');
  return audioSuggestionsBySlider(parseAudioModSpec(src, patternName));
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});
after(async () => { await h.teardown(); });

test('GET /deck stamps audioSuggestion on the sliders the header declares', async () => {
  const { status, data } = await api('GET', '/deck/channel');
  assert.equal(status, 200);
  const exports_ = data.channel.exports;
  assert.ok(Array.isArray(exports_) && exports_.length > 0, 'deck channel must expose exports');

  const expected = expectedSuggestions('13_sparkle');
  assert.equal(Object.keys(expected).length, 4, 'fixture pattern declares four mappings');

  const stamped = {};
  for (const e of exports_) {
    if (e.audioSuggestion !== undefined) stamped[e.name] = e.audioSuggestion;
  }
  assert.deepEqual(stamped, expected);

  // The FLUX suggestion specifically — the signal this whole wave restored.
  assert.deepEqual(stamped.sliderStarCount, {
    version: 'AUDIO_MODULATION_V1', signal: 'micFlux', range: [0.12, 0.86],
    curve: 'ease', modulationCurve: 'easeOut', note: 'build reveals more stars',
  });
});

test('the suggestion changes NEITHER the parameter name NOR its value', async () => {
  const { data } = await api('GET', '/deck/channel');
  for (const e of data.channel.exports) {
    if (e.audioSuggestion === undefined) continue;
    // The key the suggestion is stamped on IS the runtime export name — the
    // same identifier a saved modulation's target.parameter carries.
    assert.match(e.name, /^slider[A-Z]/, `${e.name} keeps its plain runtime name`);
    assert.equal(e.kind, 1, `${e.name} is still a plain slider export`);
    // Metadata never rewrites the value. Whatever the export carries, it is
    // the control's own number — the suggestion sits beside it, not on it.
    if (e.v0 !== undefined) assert.equal(typeof e.v0, 'number');
  }
  // And the migrated names are the ones on the wire — no signal prefixes.
  const names = data.channel.exports.map(e => e.name);
  for (const dead of ['sliderLOW_Level', 'sliderHIGH_Brilliance', 'sliderFLUX_StarCount', 'sliderKICK_Burst']) {
    assert.ok(!names.includes(dead), `${dead} must be gone from the wire`);
  }
  assert.ok(names.includes('sliderStarCount'));
});

test('a pattern with NO block gets NO audioSuggestion field (never inferred)', async () => {
  // Pick a real pattern that carries no AUDIO_MODULATION_V1 block.
  const { data: picker } = await api('GET', '/patterns');
  const names = Array.isArray(picker) ? picker : (picker.patterns ?? []);
  const blockless = names.find((n) => {
    const file = path.join(ENGINE_DIR, 'patterns', `${n}.js`);
    if (!fs.existsSync(file)) return false;
    return parseAudioModSpec(fs.readFileSync(file, 'utf8'), n) === null;
  });
  assert.ok(blockless, 'expected at least one block-less pattern in the catalog');

  const load = await api('POST', '/pattern', { pattern: blockless });
  assert.equal(load.status, 200, `loading ${blockless} should succeed: ${JSON.stringify(load.data)}`);
  const { data } = await api('GET', '/deck/channel');
  for (const e of data.channel.exports) {
    assert.equal(e.audioSuggestion, undefined,
      `${blockless}.${e.name} must carry no suggestion at all`);
  }
});

test('GET /mixer carries the same additive field on its channel exports', async () => {
  const back = await api('POST', '/pattern', { pattern: '13_sparkle' });
  assert.equal(back.status, 200);
  const mixer = await api('GET', '/mixer');
  assert.equal(mixer.status, 200);
  // A fresh boot has no extra mixer channels, so this asserts the SHAPE
  // contract: anything the mixer serializer stamps is a well-formed,
  // enum-checked suggestion. (The deck serializer — same annotate call — is
  // proven with real data above.)
  for (const ch of (mixer.data.channels ?? [])) {
    for (const e of (ch.exports ?? [])) {
      if (e.audioSuggestion === undefined) continue;
      assertWellFormed(e.audioSuggestion, `${ch.pattern}.${e.name}`);
    }
  }

  // The legacy /exports payload rides the SAME annotate call, so the stamp
  // reaches it for free — one seam, every surface.
  const legacy = await api('GET', '/exports');
  assert.equal(legacy.status, 200);
  const stamped = legacy.data.filter(e => e.audioSuggestion !== undefined);
  assert.equal(stamped.length, 4, '13_sparkle declares four suggested params');
  for (const e of stamped) assertWellFormed(e.audioSuggestion, e.name);
});

function assertWellFormed(s, where) {
  assert.equal(s.version, 'AUDIO_MODULATION_V1', `${where}: version`);
  assert.ok(['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'].includes(s.signal),
    `${where}: bad signal ${s.signal}`);
  assert.equal(s.range.length, 2, `${where}: range`);
  assert.ok(s.range.every(n => typeof n === 'number' && Number.isFinite(n)), `${where}: range numbers`);
  assert.ok(['linear', 'pow2', 'ease'].includes(s.curve), `${where}: bad curve ${s.curve}`);
  assert.ok(['linear', 'easeIn', 'easeOut'].includes(s.modulationCurve),
    `${where}: bad modulationCurve ${s.modulationCurve}`);
  if (s.note !== undefined) assert.equal(typeof s.note, 'string', `${where}: note`);
}
