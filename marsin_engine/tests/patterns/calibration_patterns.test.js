// Contract tests for the portable model-calibration pattern family (66-73)
// and its byte-identical Titanic/test-bench playlist.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath, pathToFileURL } from 'url';

import { WasmHost } from '../../lib/wasm_host.js';
import { buildFixtureTypeIds, fixtureTypeId } from '../../lib/fixture_type_constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const SCENES_DIR = path.resolve(ENGINE_DIR, '../simulation/scenes');

const CALIBRATION_PATTERNS = [
  '66_calibration_x_plane',
  '67_calibration_y_plane',
  '68_calibration_z_plane',
  '69_calibration_coordinate_rgb',
  '70_calibration_fixture_types',
  '71_calibration_fixture_pixel_order',
  '72_calibration_controller_focus',
  '73_calibration_emitter_channels',
];

function readPattern(name) {
  return fs.readFileSync(path.join(PATTERNS_DIR, `${name}.js`), 'utf8');
}

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

test('calibration family is draft-marked and registered in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'));
  for (const name of CALIBRATION_PATTERNS) {
    const source = readPattern(name);
    assert.ok(manifest.includes(name), `${name} is missing from patterns/manifest.json`);
    assert.match(source.split(/\r?\n/, 1)[0], /^\/\/ DRAFT — pending operator review$/);
    assert.doesNotMatch(source, /\bsliderLocalSpeed\b/, `${name} is a static utility, not a clocked pattern`);
    assert.doesNotMatch(source, /\bbeforeRender\s*\(/, `${name} must remain operator-positioned and static`);
  }
});

test('X, Y, and Z planes expose the same truthful knob order', () => {
  for (const name of CALIBRATION_PATTERNS.slice(0, 3)) {
    assert.deepEqual(sliderNames(readPattern(name)), [
      'sliderPosition',
      'sliderWidth',
      'sliderBackground',
    ], name);
  }
});

for (const modelName of ['test_bench', 'titanic']) {
  test(`every calibration pattern compiles against ${modelName}`, async () => {
    const modelPath = path.join(ENGINE_DIR, 'models', `${modelName}.js`);
    const model = await import(pathToFileURL(modelPath).href);
    const pixels = model.pixels;
    const host = new WasmHost();
    await host.init(pixels.length);
    host.setCoords(pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
    host.setPixelMeta(pixels.map((pixel) => ({
      controllerId: pixel.cId || 0,
      sectionId: pixel.sId || 0,
      fixtureId: pixel.fId || 0,
      viewMask: pixel.vMask || 0,
      fixtureTypeId: fixtureTypeId(pixel.fixtureType),
      pixelLocalIndex: pixel.localIndex || 0,
      viewMaskHi: pixel.vMaskHi || 0,
    })));
    host.setFixtureConstants(buildFixtureTypeIds(pixels));

    for (const name of CALIBRATION_PATTERNS) {
      const result = host.compile(readPattern(name));
      assert.equal(result.ok, true, `${name} failed on ${modelName}: ${result.error}`);
    }
  });
}

test('both scenes carry the same complete calibration playlist and truthful defaults', () => {
  const benchPath = path.join(SCENES_DIR, 'test_bench', 'playlists', 'calibration.yaml');
  const titanicPath = path.join(SCENES_DIR, 'titanic', 'playlists', 'calibration.yaml');
  const benchBytes = fs.readFileSync(benchPath);
  const titanicBytes = fs.readFileSync(titanicPath);
  assert.deepEqual(benchBytes, titanicBytes, 'scene calibration playlists must stay byte-identical');

  const playlist = yaml.load(benchBytes.toString('utf8'));
  assert.equal(playlist.schemaVersion, 1);
  assert.equal(playlist.name, 'calibration');
  assert.deepEqual(playlist.entries.map((entry) => entry.pattern), CALIBRATION_PATTERNS);

  for (const entry of playlist.entries) {
    assert.deepEqual(
      Object.keys(entry.defaults),
      sliderNames(readPattern(entry.pattern)),
      `${entry.pattern} playlist defaults must match its slider declarations in knob order`,
    );
    assert.deepEqual(entry.modulations, []);
    assert.deepEqual(entry.midiMappings, []);
    assert.ok(entry.notes.length > 20, `${entry.pattern} needs an operator-facing calibration instruction`);
  }
});
