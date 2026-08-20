// ambient_extra_contract.test.js — registration, promotion state, portability,
// and lane safety for the 50-pattern Ambient factory family.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { parsePatternDefaults } from '../../lib/pattern_defaults.js';
import { WasmHost } from '../../lib/wasm_host.js';
import { parseAudioModSpec } from '../../tools/audio_mod_spec.mjs';
import { validatePatternIntent } from '../../tools/playlist_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const FAMILY_DIR = path.join(PATTERNS_DIR, 'ambient_extra');
const MANIFEST_PATH = path.join(PATTERNS_DIR, 'manifest.json');
const GOALS_PATH = path.join(ENGINE_DIR, 'tools', 'playlist_gallery', 'pattern_goals.json');
const SCENES_DIR = path.resolve(ENGINE_DIR, '..', 'simulation', 'scenes');
const DRAFT_LINE = '// DRAFT — pending operator review';
const PROMOTED_IDS = [
  '01_harbor_glass',
  '02_brass_compass',
  '03_pearl_chain',
  '05_open_gate',
  '07_keel_glow',
  '09_shadow_slats',
  '10_chart_lines',
  '11_paper_fold',
  '12_floating_frames',
  '16_turning_tiles',
  '17_frost_branch',
  '22_balance_beam',
  '35_turning_box',
];
const PROMOTED_QUALIFIED_IDS = PROMOTED_IDS.map((id) => `ambient_extra/${id}`);

function patternIds() {
  return fs.readdirSync(FAMILY_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.slice(0, -3))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
}

function loadPlaylist(scene, name) {
  const filename = path.join(SCENES_DIR, scene, 'playlists', `${name}.yaml`);
  return yaml.load(fs.readFileSync(filename, 'utf8'));
}

const IDS = patternIds();
const QUALIFIED_IDS = IDS.map((id) => `ambient_extra/${id}`);

test('Ambient Extra is exactly one ordered 50-pattern candidate family', () => {
  assert.equal(IDS.length, 50);
  assert.deepEqual(
    IDS.map((id) => Number.parseInt(id, 10)),
    Array.from({ length: 50 }, (_, index) => index + 1),
  );

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(
    manifest.filter((id) => id.startsWith('ambient_extra/')),
    QUALIFIED_IDS,
  );

  const goals = JSON.parse(fs.readFileSync(GOALS_PATH, 'utf8'));
  for (const id of QUALIFIED_IDS) {
    const source = fs.readFileSync(
      path.join(FAMILY_DIR, `${id.slice('ambient_extra/'.length)}.js`), 'utf8');
    assert.doesNotThrow(
      () => validatePatternIntent(id, goals[id], source),
      `${id}: missing or malformed structured gallery intent`,
    );
    assert.equal(typeof goals[id].uniqueness_review?.refinement_directive, 'string',
      `${id}: missing cross-catalog uniqueness refinement`);
  }
});

test('Ambient Extra design intents fail loudly on missing or stale contracts', () => {
  const pattern = QUALIFIED_IDS[0];
  const source = fs.readFileSync(path.join(FAMILY_DIR, `${IDS[0]}.js`), 'utf8');
  const goals = JSON.parse(fs.readFileSync(GOALS_PATH, 'utf8'));

  const missingWhy = structuredClone(goals[pattern]);
  delete missingWhy.why_exists;
  assert.throws(
    () => validatePatternIntent(pattern, missingWhy, source),
    /why_exists must be a descriptive string/,
  );

  const wrongVersion = structuredClone(goals[pattern]);
  wrongVersion.schema_version = 2;
  assert.throws(
    () => validatePatternIntent(pattern, wrongVersion, source),
    /schema_version must be 1/,
  );

  const unknownField = structuredClone(goals[pattern]);
  unknownField.design_intnet = unknownField.design_intent;
  assert.throws(
    () => validatePatternIntent(pattern, unknownField, source),
    /root has unknown key design_intnet/,
  );

  const staleOrder = structuredClone(goals[pattern]);
  [staleOrder.controls[0], staleOrder.controls[1]] =
    [staleOrder.controls[1], staleOrder.controls[0]];
  assert.throws(
    () => validatePatternIntent(pattern, staleOrder, source),
    /parameter names\/order do not match source controls/,
  );

  const staleAudio = structuredClone(goals[pattern]);
  staleAudio.audio_handles[0].range[1] += 0.01;
  assert.throws(
    () => validatePatternIntent(pattern, staleAudio, source),
    /audio handles do not match AUDIO_MODULATION_V1/,
  );

  const missingTargetIntent = structuredClone(goals[pattern]);
  const realTarget = missingTargetIntent.audio_handles[0].target;
  missingTargetIntent.audio_handles[0].target = 'sliderDoesNotExist';
  const missingTargetSource = source.replace(
    new RegExp(`${realTarget}(\\s*<-)`),
    'sliderDoesNotExist$1',
  );
  assert.throws(
    () => validatePatternIntent(pattern, missingTargetIntent, missingTargetSource),
    /AUDIO_MODULATION_V1 targets undeclared control sliderDoesNotExist/,
  );

  const malformedEvidence = structuredClone(goals[pattern]);
  malformedEvidence.evidence_notes.capture_samples_seconds = ['not-a-number'];
  assert.throws(
    () => validatePatternIntent(pattern, malformedEvidence, source),
    /capture_samples_seconds must be numeric evidence/,
  );

  const malformedUniqueness = structuredClone(goals[pattern]);
  malformedUniqueness.uniqueness_review.nearest_neighbors[0].severity = 'catastrophic';
  assert.throws(
    () => validatePatternIntent(pattern, malformedUniqueness, source),
    /nearest_neighbors\[0\]\.severity is invalid/,
  );
});

test('approved factory patterns are locked in canonical Ambient and the review playlist is retired', () => {
  const titanic = loadPlaylist('titanic', 'ambient');
  const bench = loadPlaylist('test_bench', 'ambient');
  assert.deepEqual(titanic, bench);
  // Ambient Extra's promoted block is contiguous and ordered, but other
  // approved factory families (e.g. Crisp) may be appended after it, so
  // locate the block instead of assuming it is the literal tail.
  const patterns = titanic.entries.map((entry) => entry.pattern);
  const blockStart = patterns.indexOf(PROMOTED_QUALIFIED_IDS[0]);
  assert.ok(blockStart >= 0,
    `${PROMOTED_QUALIFIED_IDS[0]}: promoted Ambient Extra block missing from canonical Ambient`);
  assert.deepEqual(
    patterns.slice(blockStart, blockStart + PROMOTED_QUALIFIED_IDS.length),
    PROMOTED_QUALIFIED_IDS,
  );
  assert.equal(fs.existsSync(path.join(
    SCENES_DIR, 'titanic', 'playlists', 'ambient_extra.yaml')),
  false);
  assert.equal(fs.existsSync(path.join(
    SCENES_DIR, 'test_bench', 'playlists', 'ambient_extra.yaml')),
  false);

  for (const pattern of PROMOTED_QUALIFIED_IDS) {
    const entry = titanic.entries.find((candidate) => candidate.pattern === pattern);
    assert.ok(entry, `${pattern}: missing canonical Ambient entry`);
    assert.equal(entry.defaults.sliderLocalSpeed, 0.3);
    const source = fs.readFileSync(path.join(
      PATTERNS_DIR, `${pattern}.js`), 'utf8');
    const controls = [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
      .map((match) => match[1]);
    assert.deepEqual(Object.keys(entry.defaults), controls,
      `${pattern}: every control must be explicitly locked in declaration order`);
    assert.deepEqual(entry.modulations, []);
    assert.deepEqual(entry.midiMappings, []);
  }
});

test('only unpromoted factory sources stay draft-marked and every source has valid audio suggestions', () => {
  for (const id of IDS) {
    const source = fs.readFileSync(path.join(FAMILY_DIR, `${id}.js`), 'utf8');
    if (PROMOTED_IDS.includes(id)) {
      assert.notEqual(source.split(/\r?\n/, 1)[0], DRAFT_LINE, `ambient_extra/${id}`);
    } else {
      assert.equal(source.split(/\r?\n/, 1)[0], DRAFT_LINE, `ambient_extra/${id}`);
    }
    assert.doesNotMatch(
      source,
      /\bvar\s+FIX_[A-Z0-9_]+\s*=/,
      `ambient_extra/${id}: fixture capabilities must be model-injected, never self-declared`,
    );
    const controls = [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
      .map((match) => match[1]);
    const defaults = parsePatternDefaults(source).defaults;
    assert.deepEqual(
      controls.filter((control) => defaults[control] === undefined),
      [],
      `ambient_extra/${id}: every slider needs a gallery-resolvable code default`,
    );
    const spec = parseAudioModSpec(source, `ambient_extra/${id}`);
    assert.equal(spec.version, 'AUDIO_MODULATION_V1', `ambient_extra/${id}`);
    assert.equal(spec.mappings.length, 2, `ambient_extra/${id}: expected two suggestions`);
  }
});

test('every Ambient Extra source compiles portably and preserves W=A with U off', async () => {
  const loaded = await loadModelForGauge('test_bench');
  for (const id of IDS) {
    const host = new WasmHost();
    await host.init(loaded.pixels.length);
    host.setCoords(loaded.pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
    host.setPixelMeta(loaded.metaArray);
    host.setFixtureConstants(loaded.fixtureConstants);
    const source = fs.readFileSync(path.join(FAMILY_DIR, `${id}.js`), 'utf8');
    const compiled = host.compile(source);
    assert.equal(compiled.ok, true, `ambient_extra/${id}: ${compiled.error}`);
    const frame = new Uint8Array(loaded.pixels.length * 6);
    let peak = 0;
    for (const elapsed of [0, 0.5, 1.0, 2.0]) {
      host.beginFrame(compiled.handle, elapsed);
      host.renderAll6ch(compiled.handle, frame);
      for (let offset = 0; offset < frame.length; offset += 6) {
        peak = Math.max(peak, frame[offset], frame[offset + 1], frame[offset + 2], frame[offset + 3]);
        assert.equal(frame[offset + 3], frame[offset + 4], `ambient_extra/${id}: W/A mismatch`);
        assert.equal(frame[offset + 5], 0, `ambient_extra/${id}: unexpected UV`);
      }
    }
    assert.ok(peak > 0, `ambient_extra/${id}: all sampled frames were dark`);
    host.destroy(compiled.handle);
    host.shutdown();
  }
});
