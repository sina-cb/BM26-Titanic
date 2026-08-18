import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadModelForGauge } from '../lib/model_loader.js';
import { WasmHost } from '../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const PLAYLIST_PATH = path.join(
  REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists', 'ambient.yaml',
);
const PATTERNS = [
  'crisp/03_magnetic_field_collision',
  'crisp/06_impossible_corridor',
];
const GLOBAL_SPEED_CONTROL = 0.64;
const GLOBAL_SPEED_MULTIPLIER = 0.25 * Math.pow(16, GLOBAL_SPEED_CONTROL);
const FRAME_SECONDS = 0.025 * GLOBAL_SPEED_MULTIPLIER;
const WARMUP_FRAMES = 80;
const SAMPLE_FRAMES = 720;

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

function setControl(host, handle, name, value) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  if (!control) throw new Error(`missing control export: ${name}`);
  host.setControl(handle, control.id, value);
}

function frameCadence(previous, current, indices) {
  let total = 0;
  let changed = 0;
  let large = 0;
  for (const pixelIndex of indices) {
    const offset = pixelIndex * 6;
    const delta = Math.max(
      Math.abs(previous[offset] - current[offset]),
      Math.abs(previous[offset + 1] - current[offset + 1]),
      Math.abs(previous[offset + 2] - current[offset + 2]),
    );
    total += delta;
    if (delta >= 4) changed += 1;
    if (delta >= 64) large += 1;
  }
  return {
    meanAbsolute: total / (indices.length * 255),
    changedFraction: changed / indices.length,
    largeJumpFraction: large / indices.length,
  };
}

async function auditPattern(pattern, source, defaults, modelName) {
  const loaded = await loadModelForGauge(modelName);
  const barIndices = loaded.pixels
    .map((pixel, index) => ({ pixel, index }))
    .filter(({ pixel }) => pixel.fixtureType === 'ShehdsBar')
    .map(({ index }) => index);
  if (barIndices.length === 0) throw new Error(`${modelName}: no ShehdsBar pixels`);
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
  if (!compiled.ok) throw new Error(`${pattern}/${modelName}: ${compiled.error}`);
  try {
    for (const name of sliderNames(source)) {
      setControl(host, compiled.handle, name, defaults[name]);
    }
    let previous = new Uint8Array(loaded.pixels.length * 6);
    for (let frameIndex = 1; frameIndex <= WARMUP_FRAMES; frameIndex += 1) {
      host.beginFrame(compiled.handle, frameIndex * FRAME_SECONDS);
      host.renderAll6ch(compiled.handle, previous);
    }
    const samples = [];
    for (let frameIndex = 1; frameIndex <= SAMPLE_FRAMES; frameIndex += 1) {
      const current = new Uint8Array(loaded.pixels.length * 6);
      host.beginFrame(
        compiled.handle, (WARMUP_FRAMES + frameIndex) * FRAME_SECONDS,
      );
      host.renderAll6ch(compiled.handle, current);
      samples.push(frameCadence(previous, current, barIndices));
      previous = current;
    }
    return {
      barPixels: barIndices.length,
      seconds: SAMPLE_FRAMES / 40,
      meanAbsolutePerFrame: samples.reduce(
        (sum, sample) => sum + sample.meanAbsolute, 0,
      ) / samples.length,
      meanChangedFraction: samples.reduce(
        (sum, sample) => sum + sample.changedFraction, 0,
      ) / samples.length,
      meanLargeJumpFraction: samples.reduce(
        (sum, sample) => sum + sample.largeJumpFraction, 0,
      ) / samples.length,
      p95ChangedFraction: samples.map((sample) => sample.changedFraction)
        .sort((left, right) => left - right)[Math.floor(samples.length * 0.95)],
    };
  } finally {
    host.destroy(compiled.handle);
    host.shutdown();
  }
}

export async function auditCrispCadence() {
  const playlist = yaml.load(fs.readFileSync(PLAYLIST_PATH, 'utf8'));
  const defaults = new Map(playlist.entries.map((entry) => [entry.pattern, entry.defaults]));
  const results = {};
  for (const pattern of PATTERNS) {
    const source = fs.readFileSync(path.join(PATTERNS_DIR, `${pattern}.js`), 'utf8');
    results[pattern] = {};
    for (const modelName of ['titanic', 'test_bench']) {
      results[pattern][modelName] = await auditPattern(
        pattern, source, defaults.get(pattern), modelName,
      );
    }
  }
  return {
    globalSpeedControl: GLOBAL_SPEED_CONTROL,
    globalSpeedMultiplier: GLOBAL_SPEED_MULTIPLIER,
    frameSeconds: FRAME_SECONDS,
    results,
  };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  if (outIndex >= 0 && !outPath) throw new Error('--out requires a path');
  const document = `${JSON.stringify(await auditCrispCadence(), null, 2)}\n`;
  if (outPath) {
    fs.writeFileSync(outPath, document);
    process.stdout.write(`wrote ${outPath}\n`);
  } else {
    process.stdout.write(document);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
