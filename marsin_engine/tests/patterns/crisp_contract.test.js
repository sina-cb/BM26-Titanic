// crisp_contract.test.js - exact-color and full-staging contract for Crisp.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';
import { validatePatternIntent } from '../../tools/playlist_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERN_ID = 'crisp/01_orbiting_circle';
const PATTERN_PATH = path.join(ENGINE_DIR, 'patterns', `${PATTERN_ID}.js`);
const MANIFEST_PATH = path.join(ENGINE_DIR, 'patterns', 'manifest.json');
const GOALS_PATH = path.join(ENGINE_DIR, 'tools', 'playlist_gallery', 'pattern_goals.json');
const TITANIC_PLAYLIST_PATH = path.join(
  REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists', 'crisp.yaml',
);
const BENCH_PLAYLIST_PATH = path.join(
  REPO_DIR, 'simulation', 'scenes', 'test_bench', 'playlists', 'crisp.yaml',
);
const GLOBAL_SPEED = 0.3;
const FIX_RAW_LED = 1;
const FIX_PAR = 2;
const FIX_VINTAGE_6 = 3;
const FIX_BAR_18 = 4;
const FIX_TE_SIGN = 7;
const EXPECTED_FIXTURE_ROLES = [
  FIX_RAW_LED,
  FIX_PAR,
  FIX_VINTAGE_6,
  FIX_BAR_18,
  FIX_TE_SIGN,
];

const source = fs.readFileSync(PATTERN_PATH, 'utf8');
const titanicPlaylistBytes = fs.readFileSync(TITANIC_PLAYLIST_PATH);
const benchPlaylistBytes = fs.readFileSync(BENCH_PLAYLIST_PATH);
const playlist = yaml.load(titanicPlaylistBytes.toString('utf8'));
const playlistEntry = playlist.entries[0];

function sliderNames(patternSource) {
  return [...patternSource.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

function setControl(host, handle, name, ...values) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  assert.ok(control, `missing control export: ${name}`);
  host.setControl(handle, control.id, ...values);
}

function applyControls(host, handle, overrides = {}, pureEndpoints = false) {
  if (pureEndpoints) {
    setControl(host, handle, 'colorPalette1', 0, 1, 1);
    setControl(host, handle, 'colorPalette2', 2 / 3, 1, 1);
  }
  for (const name of sliderNames(source)) {
    const value = overrides[name] ?? playlistEntry.defaults[name];
    assert.ok(Number.isFinite(value), `missing finite saved value for ${name}`);
    setControl(host, handle, name, value);
  }
}

async function compileOnModel(modelName, overrides = {}, pureEndpoints = false) {
  const loaded = await loadModelForGauge(modelName);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map((pixel) => ({
    nx: pixel.nx,
    ny: pixel.ny,
    nz: pixel.nz,
  })));
  host.setPixelMeta(loaded.metaArray);
  host.setFixtureConstants(loaded.fixtureConstants);
  const compiled = host.compile(source);
  assert.equal(compiled.ok, true, `${modelName}: ${compiled.error}`);
  applyControls(host, compiled.handle, overrides, pureEndpoints);
  return { host, loaded, compiled };
}

function renderFrame(host, handle, pixelCount, scaledElapsed) {
  const frame = new Uint8Array(pixelCount * 6);
  host.beginFrame(handle, scaledElapsed);
  host.renderAll6ch(handle, frame);
  return frame;
}

function pixelBytes(frame, pixelIndex) {
  return frame.subarray(pixelIndex * 6, pixelIndex * 6 + 6);
}

function framesDiffer(left, right) {
  let changedPixels = 0;
  let absoluteDifference = 0;
  for (let offset = 0; offset < left.length; offset += 6) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(left[offset + channel] - right[offset + channel]);
      absoluteDifference += difference;
      if (difference > 0) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  return { changedPixels, absoluteDifference };
}

async function finalBenchFrame(overrides) {
  const { host, loaded, compiled } = await compileOnModel(
    'test_bench', overrides, true,
  );
  try {
    let frame = null;
    for (let step = 0; step <= 160; step += 1) {
      frame = renderFrame(
        host,
        compiled.handle,
        loaded.pixels.length,
        step * 0.05 * GLOBAL_SPEED,
      );
    }
    return frame;
  } finally {
    host.destroy(compiled.handle);
    host.shutdown();
  }
}

test('Crisp source, manifest, intent, and paired playlists are registered exactly', () => {
  assert.deepEqual(titanicPlaylistBytes, benchPlaylistBytes);
  assert.equal(playlist.schemaVersion, 1);
  assert.equal(playlist.name, 'crisp');
  assert.equal(playlist.entries.length, 1);
  assert.equal(playlistEntry.pattern, PATTERN_ID);
  assert.equal(playlistEntry.defaults.sliderLocalSpeed, 0.3);
  assert.deepEqual(Object.keys(playlistEntry.defaults), sliderNames(source));
  assert.deepEqual(playlistEntry.modulations, []);
  assert.deepEqual(playlistEntry.midiMappings, []);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.filter((entry) => entry === PATTERN_ID).length, 1);

  const goals = JSON.parse(fs.readFileSync(GOALS_PATH, 'utf8'));
  assert.doesNotThrow(() => validatePatternIntent(PATTERN_ID, goals[PATTERN_ID], source));
  assert.match(source, /\bindex\s*%\s*74(?:\.0)?\b/);
  const renderSource = source.slice(source.indexOf('export function render3D'));
  assert.doesNotMatch(renderSource, /\barray\s*\(/, 'render loop must remain allocation-free');
});

test('Crisp emits only exact endpoint rays or black with W=A=U=0', async () => {
  for (const modelName of ['test_bench', 'titanic']) {
    const { host, loaded, compiled } = await compileOnModel(modelName, {}, true);
    try {
      let sawRed = false;
      let sawBlue = false;
      let sawBlack = false;
      let sawAntialias = false;
      for (let step = 0; step <= 80; step += 1) {
        const frame = renderFrame(
          host,
          compiled.handle,
          loaded.pixels.length,
          step * 0.1 * GLOBAL_SPEED,
        );
        for (let offset = 0; offset < frame.length; offset += 6) {
          const red = frame[offset];
          const green = frame[offset + 1];
          const blue = frame[offset + 2];
          assert.equal(green, 0, `${modelName}: non-endpoint green at byte ${offset}`);
          assert.equal(red > 0 && blue > 0, false,
            `${modelName}: interpolated red+blue at byte ${offset}`);
          assert.equal(frame[offset + 3], 0, `${modelName}: unintended W`);
          assert.equal(frame[offset + 4], 0, `${modelName}: unintended A`);
          assert.equal(frame[offset + 5], 0, `${modelName}: unintended U`);
          sawRed ||= red > 0;
          sawBlue ||= blue > 0;
          sawBlack ||= red === 0 && blue === 0;
          sawAntialias ||= (red > 0 && red < 255) || (blue > 0 && blue < 255);
        }
      }
      assert.equal(sawRed, true, `${modelName}: palette endpoint 1 never appeared`);
      assert.equal(sawBlue, true, `${modelName}: palette endpoint 2 never appeared`);
      assert.equal(sawBlack, true, `${modelName}: black negative space never appeared`);
      assert.equal(sawAntialias, true, `${modelName}: no endpoint-exact antialias values`);
    } finally {
      host.destroy(compiled.handle);
      host.shutdown();
    }
  }
});

test('Crisp animates all five Titanic fixture roles and pairs complete TE signs',
  { timeout: 20_000 }, async () => {
    const { host, loaded, compiled } = await compileOnModel('titanic', {}, true);
    try {
      const firstSign = loaded.metaArray
        .map((meta, index) => meta.sectionId === 3 ? index : -1)
        .filter((index) => index >= 0);
      const secondSign = loaded.metaArray
        .map((meta, index) => meta.sectionId === 415 ? index : -1)
        .filter((index) => index >= 0);
      assert.equal(firstSign.length, 74);
      assert.equal(secondSign.length, 74);

      const everLit = new Uint8Array(loaded.pixels.length);
      const roleCounts = new Map();
      const roleLit = new Map();
      for (const role of EXPECTED_FIXTURE_ROLES) {
        roleCounts.set(role, 0);
        roleLit.set(role, new Set());
      }
      loaded.metaArray.forEach((meta, index) => {
        if (roleCounts.has(meta.fixtureTypeId)) {
          roleCounts.set(meta.fixtureTypeId, roleCounts.get(meta.fixtureTypeId) + 1);
        }
        assert.ok(index < loaded.pixels.length, 'metadata exceeds model pixel count');
      });

      let early = null;
      let middle = null;
      let late = null;
      let lowerAddressesContinue = false;
      let pairedFrames = 0;
      for (let step = 0; step <= 200; step += 1) {
        const frame = renderFrame(
          host,
          compiled.handle,
          loaded.pixels.length,
          step * 0.1 * GLOBAL_SPEED,
        );
        if (step === 0) early = frame;
        if (step === 100) middle = frame;
        if (step === 200) late = frame;
        for (let pixelIndex = 0; pixelIndex < loaded.pixels.length; pixelIndex += 1) {
          const bytes = pixelBytes(frame, pixelIndex);
          if (Math.max(bytes[0], bytes[1], bytes[2]) > 4) {
            everLit[pixelIndex] = 1;
            const role = loaded.metaArray[pixelIndex].fixtureTypeId;
            if (roleLit.has(role)) roleLit.get(role).add(pixelIndex);
          }
        }
        for (let local = 0; local < 74; local += 1) {
          assert.deepEqual(
            pixelBytes(frame, firstSign[local]),
            pixelBytes(frame, secondSign[local]),
            `paired signs differ at step ${step}, local ${local}`,
          );
        }
        pairedFrames += 1;
        for (let local = 0; local < 34; local += 1) {
          if (!pixelBytes(frame, firstSign[local]).every(
            (value, channel) => value === pixelBytes(frame, firstSign[40 + local])[channel],
          )) lowerAddressesContinue = true;
        }
      }

      assert.equal(pairedFrames, 201);
      assert.equal(lowerAddressesContinue, true, 'sign pixels 40..73 repeat 0..33');
      const earlyMiddle = framesDiffer(early, middle);
      const middleLate = framesDiffer(middle, late);
      assert.ok(earlyMiddle.changedPixels >= loaded.pixels.length * 0.18,
        `early/mid changed only ${earlyMiddle.changedPixels} pixels`);
      assert.ok(middleLate.changedPixels >= loaded.pixels.length * 0.18,
        `mid/late changed only ${middleLate.changedPixels} pixels`);

      for (const role of EXPECTED_FIXTURE_ROLES) {
        assert.ok(roleCounts.get(role) > 0, `fixture role ${role} absent from Titanic`);
        const coverage = roleLit.get(role).size / roleCounts.get(role);
        assert.ok(coverage >= 0.12,
          `fixture role ${role} animated only ${(coverage * 100).toFixed(1)}% of pixels`);
      }
      const wholeModelCoverage = everLit.reduce((sum, value) => sum + value, 0)
        / loaded.pixels.length;
      assert.ok(wholeModelCoverage >= 0.55,
        `only ${(wholeModelCoverage * 100).toFixed(1)}% of Titanic participated`);
    } finally {
      host.destroy(compiled.handle);
      host.shutdown();
    }
  });

test('every saved Crisp slider tells the truth in rendered output',
  { timeout: 30_000 }, async () => {
    const probes = [
      ['sliderLocalSpeed', 0, 1],
      ['sliderBodyRadius', 0, 1],
      ['sliderCount', 0, 1],
      ['sliderSpacing', 0, 1],
      ['sliderTrail', 0, 1],
      ['sliderSafetyFloor', 0, 1],
    ];
    for (const [name, low, high] of probes) {
      const lowFrame = await finalBenchFrame({ [name]: low });
      const highFrame = await finalBenchFrame({ [name]: high });
      const difference = framesDiffer(lowFrame, highFrame);
      assert.ok(difference.changedPixels >= lowFrame.length / 6 * 0.05,
        `${name}: changed only ${difference.changedPixels} pixels`);
      assert.ok(difference.absoluteDifference >= lowFrame.length / 6 * 4,
        `${name}: RGB difference ${difference.absoluteDifference} is too weak`);
    }
  });
