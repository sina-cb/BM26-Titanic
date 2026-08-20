// te_sign_surface_contract.test.js — physical continuity and authorship for
// Titanic's two 74-pixel TE signs. Each sign is patched as 40 + 34 pixels, so
// fixture-local indices must never be mistaken for complete sign coordinates.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { parsePatternDefaults } from '../../lib/pattern_defaults.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const AMBIENT_DIR = path.join(ENGINE_DIR, 'patterns', 'ambient_extra');
const WHITE_IDS = [
  '60_white_wash',
  '61_white_breathe',
  '62_white_shimmer',
  '63_white_chase',
  '64_temple_warm_white',
];
// Sample at 10 Hz so the VM receives the same bounded phase increments as the
// running 40 Hz engine. Sparse multi-second jumps would be clamped inside
// patterns and would falsely make a healthy 40-second composition look static.
const AMBIENT_SAMPLE_TIMES_SECONDS = Array.from({ length: 401 }, (_, index) => index * 0.1);
const WHITE_SAMPLE_TIMES_SECONDS = [0, 5, 10, 20, 30];

function patternSpecs() {
  const ambient = fs.readdirSync(AMBIENT_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
    .map((name) => ({
      id: `ambient_extra/${name.slice(0, -3)}`,
      filename: path.join(AMBIENT_DIR, name),
      savedLocalSpeed: 0.3,
      globalSpeed: 0.3,
      sampleTimes: AMBIENT_SAMPLE_TIMES_SECONDS,
    }));
  const white = WHITE_IDS.map((id) => ({
    id,
    filename: path.join(ENGINE_DIR, 'patterns', `${id}.js`),
    savedLocalSpeed: null,
    globalSpeed: 1.0,
    sampleTimes: WHITE_SAMPLE_TIMES_SECONDS,
  }));
  return [...ambient, ...white];
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function setSourceDefaults(host, handle, source, savedLocalSpeed) {
  const defaults = parsePatternDefaults(source).defaults;
  for (const exported of host.getExports(handle)) {
    if (exported.type !== 'function' || !exported.name.startsWith('slider')) continue;
    let value = defaults[exported.name];
    if (exported.name === 'sliderLocalSpeed' && savedLocalSpeed !== null) {
      value = savedLocalSpeed;
    }
    if (value !== undefined) host.setControl(handle, exported.id, value);
  }
}

function pixelBytes(frame, pixelIndex) {
  return frame.subarray(pixelIndex * 6, pixelIndex * 6 + 6);
}

function bytesEqual(left, right) {
  for (let channel = 0; channel < 6; channel += 1) {
    if (left[channel] !== right[channel]) return false;
  }
  return true;
}

const loadedPromise = loadModelForGauge('titanic');

for (const spec of patternSpecs()) {
  test(`${spec.id} authors a complete, matched, dynamic TE-sign surface`,
    { timeout: 20_000 }, async () => {
      const loaded = await loadedPromise;
      const firstSign = loaded.pixels
        .map((pixel, index) => ({ pixel, index }))
        .filter(({ pixel }) => pixel.sId === 3)
        .map(({ index }) => index);
      const secondSign = loaded.pixels
        .map((pixel, index) => ({ pixel, index }))
        .filter(({ pixel }) => pixel.sId === 415)
        .map(({ index }) => index);
      assert.equal(firstSign.length, 74, 'Titanic TE sign 1 must contain 74 pixels');
      assert.equal(secondSign.length, 74, 'Titanic TE sign 2 must contain 74 pixels');

      const source = fs.readFileSync(spec.filename, 'utf8');
      assert.ok(
        /\bindex\s*%\s*74(?:\.0)?\b/.test(stripComments(source)),
        `${spec.id}: fold the complete physical sign with index % 74`,
      );

      const host = new WasmHost();
      let compiled = null;
      try {
      await host.init(loaded.pixels.length);
      host.setCoords(loaded.pixels.map((pixel) => ({
        nx: pixel.nx,
        ny: pixel.ny,
        nz: pixel.nz,
      })));
      host.setPixelMeta(loaded.metaArray);
      host.setFixtureConstants(loaded.fixtureConstants);
      compiled = host.compile(source);
      assert.equal(compiled.ok, true, `${spec.id}: ${compiled.error}`);
      setSourceDefaults(host, compiled.handle, source, spec.savedLocalSpeed);

      const frames = [];
      for (const elapsed of spec.sampleTimes) {
        const frame = new Uint8Array(loaded.pixels.length * 6);
        host.beginFrame(compiled.handle, elapsed * spec.globalSpeed);
        host.renderAll6ch(compiled.handle, frame);
        frames.push(frame);
        for (let local = 0; local < 74; local += 1) {
          assert.deepEqual(
            pixelBytes(frame, firstSign[local]),
            pixelBytes(frame, secondSign[local]),
            `${spec.id}: paired TE signs differ at t=${elapsed}s, sign pixel ${local}`,
          );
        }
      }

      const lowerFixtureIsNotARepeat = frames.some((frame) => {
        for (let local = 0; local < 34; local += 1) {
          if (!bytesEqual(
            pixelBytes(frame, firstSign[local]),
            pixelBytes(frame, firstSign[40 + local]),
          )) return true;
        }
        return false;
      });
      assert.equal(
        lowerFixtureIsNotARepeat,
        true,
        `${spec.id}: sign pixels 40..73 repeat 0..33 instead of extending the surface`,
      );

      const signIsDynamic = frames.slice(1).some((frame) => {
        for (let local = 0; local < 74; local += 1) {
          if (!bytesEqual(
            pixelBytes(frames[0], firstSign[local]),
            pixelBytes(frame, firstSign[local]),
          )) return true;
        }
        return false;
      });
      assert.equal(signIsDynamic, true, `${spec.id}: TE sign treatment is static`);

      if (spec.savedLocalSpeed !== null) {
        const signRanges = [];
        for (let local = 0; local < 74; local += 1) {
          let minimum = 255;
          let maximum = 0;
          for (const frame of frames) {
            const bytes = pixelBytes(frame, firstSign[local]);
            const intensity = Math.max(bytes[0], bytes[1], bytes[2]);
            minimum = Math.min(minimum, intensity);
            maximum = Math.max(maximum, intensity);
          }
          signRanges.push(maximum - minimum);
        }
        const signMeanRange = signRanges.reduce((sum, value) => sum + value, 0)
          / signRanges.length;
        const signCoverage = signRanges.filter((value) => value >= 20).length
          / signRanges.length;
        assert.ok(
          signMeanRange >= 35,
          `${spec.id}: TE sign mean range ${signMeanRange.toFixed(1)} is too static at Global=0.30 / Local=0.30`,
        );
        assert.ok(
          signCoverage >= 0.65,
          `${spec.id}: only ${(signCoverage * 100).toFixed(0)}% of TE pixels visibly move at Global=0.30 / Local=0.30`,
        );

        const modelRanges = [];
        for (let pixel = 0; pixel < loaded.pixels.length; pixel += 1) {
          let minimum = 255;
          let maximum = 0;
          for (const frame of frames) {
            const bytes = pixelBytes(frame, pixel);
            const intensity = Math.max(bytes[0], bytes[1], bytes[2]);
            minimum = Math.min(minimum, intensity);
            maximum = Math.max(maximum, intensity);
          }
          modelRanges.push(maximum - minimum);
        }
        const modelMeanRange = modelRanges.reduce((sum, value) => sum + value, 0)
          / modelRanges.length;
        const modelCoverage = modelRanges.filter((value) => value >= 20).length
          / modelRanges.length;
        assert.ok(
          modelMeanRange >= 30,
          `${spec.id}: whole-model mean range ${modelMeanRange.toFixed(1)} is too static at Global=0.30 / Local=0.30`,
        );
        assert.ok(
          modelCoverage >= 0.40,
          `${spec.id}: only ${(modelCoverage * 100).toFixed(0)}% of the model visibly moves at Global=0.30 / Local=0.30`,
        );
      }

      } finally {
        if (compiled?.ok) host.destroy(compiled.handle);
        host.shutdown();
      }
    });
}
