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
const FRAME_SECONDS = 0.025;

export const CRISP_SEAM_SPECS = Object.freeze({
  'crisp/01_orbiting_circle': Object.freeze([
    Object.freeze({ clock: 'storyPhase', seed: '0.0', wrap: 1, rate: speed =>
      0.28 + Math.pow(2, (speed - 0.5) * 4) * 0.14 }),
    Object.freeze({ clock: 'detailPhase', seed: '0.0', wrap: 10, optional: true,
      rate: speed => 0.28 + Math.pow(2, (speed - 0.5) * 4) * 0.14 }),
  ]),
  'crisp/02_dimensional_slicer': Object.freeze([
    Object.freeze({ clock: 'storyPhase', seed: '0.0', wrap: 60, rate: speed =>
      0.04 + Math.pow(2, (speed - 0.5) * 4) * 0.08 }),
  ]),
  'crisp/03_magnetic_field_collision': Object.freeze([
    Object.freeze({ clock: 'storyPhase', seed: '0.0', wrap: 1, rate: speed =>
      0.014 + speed * 0.020 }),
  ]),
  'crisp/06_impossible_corridor': Object.freeze([
    Object.freeze({ clock: 'storyPhase', seed: '0.0', wrap: 10, rate: speed =>
      0.018 + speed * 0.036 }),
  ]),
  'crisp/08_topology_knot': Object.freeze([
    Object.freeze({ clock: 'storyPhase', seed: '0.0', wrap: 60, rate: speed =>
      0.06 + Math.pow(2, (speed - 0.5) * 4) * 0.22 }),
  ]),
  'crisp/10_geometric_echo': Object.freeze([
    Object.freeze({ clock: 'markerPhase', seed: '0.17', wrap: 100,
      rate: speed => 0.38 + speed * 0.58, liveSpeedSeed: true }),
  ]),
});

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map(match => match[1]);
}

function setControl(host, handle, name, value) {
  const control = host.getExports(handle).find(entry => entry.name === name);
  if (!control) throw new Error(`missing control export: ${name}`);
  host.setControl(handle, control.id, value);
}

function instrumentClock(source, spec, speed) {
  const step = FRAME_SECONDS * spec.rate(speed);
  const initial = spec.wrap - step * 1.5;
  const declaration = `var ${spec.clock} = ${spec.seed};`;
  if (!source.includes(declaration)) {
    if (spec.optional) return null;
    throw new Error(`seam audit cannot find exact clock declaration: ${declaration}`);
  }
  let instrumented = source.replace(declaration, `var ${spec.clock} = ${initial};`);
  if (spec.liveSpeedSeed) {
    if (!instrumented.includes('var liveLocalSpeed = 0.30;')) {
      throw new Error('seam audit cannot seed liveLocalSpeed for Geometric Echo');
    }
    instrumented = instrumented.replace(
      'var liveLocalSpeed = 0.30;', `var liveLocalSpeed = ${speed};`,
    );
  }
  return instrumented;
}

function frameDelta(left, right, pixels) {
  let total = 0;
  let large = 0;
  let maximum = 0;
  const largeJumpFixtures = {};
  const largestJumps = [];
  const pixelCount = left.length / 6;
  for (let offset = 0; offset < left.length; offset += 6) {
    const delta = Math.max(
      Math.abs(left[offset] - right[offset]),
      Math.abs(left[offset + 1] - right[offset + 1]),
      Math.abs(left[offset + 2] - right[offset + 2]),
    );
    total += delta;
    maximum = Math.max(maximum, delta);
    if (delta >= 64) {
      large += 1;
      const fixture = pixels[offset / 6]?.fixtureType || 'unknown';
      largeJumpFixtures[fixture] = (largeJumpFixtures[fixture] || 0) + 1;
    }
    if (delta > 0) {
      const pixelIndex = offset / 6;
      largestJumps.push({
        pixelIndex,
        name: pixels[pixelIndex]?.name || 'unknown',
        fixtureType: pixels[pixelIndex]?.fixtureType || 'unknown',
        delta,
        from: [left[offset], left[offset + 1], left[offset + 2]],
        to: [right[offset], right[offset + 1], right[offset + 2]],
      });
    }
  }
  return {
    meanAbsolute: total / (pixelCount * 255),
    largeJumpFraction: large / pixelCount,
    maximumByteDelta: maximum,
    largeJumpFixtures,
    largestJumps: largestJumps.sort((a, b) => b.delta - a.delta).slice(0, 12),
  };
}

async function auditBoundary(pattern, source, defaults, modelName, speed, spec) {
  const step = FRAME_SECONDS * spec.rate(speed);
  const instrumented = instrumentClock(source, spec, speed);
  if (instrumented === null) return null;
  const loaded = await loadModelForGauge(modelName);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map(pixel => ({
    nx: pixel.nx,
    ny: pixel.ny,
    nz: pixel.nz,
  })));
  host.setPixelMeta(loaded.metaArray);
  host.setFixtureConstants(loaded.fixtureConstants);
  const compiled = host.compile(instrumented);
  if (!compiled.ok) throw new Error(`${pattern}/${modelName}: ${compiled.error}`);
  try {
    for (const name of sliderNames(source)) {
      setControl(host, compiled.handle, name,
        name === 'sliderLocalSpeed' ? speed : defaults[name]);
    }
    const frames = [];
    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      const frame = new Uint8Array(loaded.pixels.length * 6);
      host.beginFrame(compiled.handle, (frameIndex + 1) * FRAME_SECONDS);
      host.renderAll6ch(compiled.handle, frame);
      frames.push(frame);
    }
    const boundary = frameDelta(frames[0], frames[1], loaded.pixels);
    const naturalNext = frameDelta(frames[1], frames[2], loaded.pixels);
    // Crisp edges can legitimately move across a dense fixture cohort in one
    // frame. Compare the reset against a full unit of ordinary in-flight
    // motion as well as the mandated immediate next frame, so a real wrap-only
    // spike fails while a recurring sharp passage is not mislabeled a seam.
    const referenceFrameCount = Math.ceil(1 / step) + 2;
    let previousFrame = frames[2];
    let maximumMeanAbsolute = naturalNext.meanAbsolute;
    let maximumLargeJumpFraction = naturalNext.largeJumpFraction;
    for (let referenceIndex = 0;
      referenceIndex < referenceFrameCount; referenceIndex += 1) {
      const frame = new Uint8Array(loaded.pixels.length * 6);
      host.beginFrame(compiled.handle, (referenceIndex + 4) * FRAME_SECONDS);
      host.renderAll6ch(compiled.handle, frame);
      const delta = frameDelta(previousFrame, frame, loaded.pixels);
      maximumMeanAbsolute = Math.max(maximumMeanAbsolute, delta.meanAbsolute);
      maximumLargeJumpFraction = Math.max(
        maximumLargeJumpFraction, delta.largeJumpFraction,
      );
      previousFrame = frame;
    }
    return {
      clock: spec.clock,
      wrap: spec.wrap,
      speed,
      boundary,
      naturalNext,
      naturalEnvelope: {
        phaseSpan: 1,
        frameCount: referenceFrameCount,
        maximumMeanAbsolute,
        maximumLargeJumpFraction,
      },
      nextFrameExcessRatio: boundary.meanAbsolute /
        Math.max(naturalNext.meanAbsolute, 1 / (loaded.pixels.length * 255)),
      meanExcessRatio: boundary.meanAbsolute /
        Math.max(maximumMeanAbsolute, 1 / (loaded.pixels.length * 255)),
      largeJumpExcess: boundary.largeJumpFraction - maximumLargeJumpFraction,
    };
  } finally {
    host.destroy(compiled.handle);
    host.shutdown();
  }
}

export async function auditCrispSeams() {
  const playlist = yaml.load(fs.readFileSync(PLAYLIST_PATH, 'utf8'));
  const entries = new Map(playlist.entries.map(entry => [entry.pattern, entry]));
  const results = {};
  for (const [pattern, specs] of Object.entries(CRISP_SEAM_SPECS)) {
    const entry = entries.get(pattern);
    if (!entry) throw new Error(`Crisp seam audit missing playlist entry ${pattern}`);
    const source = fs.readFileSync(path.join(PATTERNS_DIR, `${pattern}.js`), 'utf8');
    results[pattern] = {};
    for (const modelName of ['titanic', 'test_bench']) {
      results[pattern][modelName] = [];
      for (const speed of [0, entry.defaults.sliderLocalSpeed, 1]) {
        for (const spec of specs) {
          const result = await auditBoundary(
            pattern, source, entry.defaults, modelName, speed, spec,
          );
          if (result) results[pattern][modelName].push(result);
        }
      }
    }
  }
  return results;
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outputPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  if (outIndex >= 0 && !outputPath) throw new Error('--out requires a path');
  const results = await auditCrispSeams();
  const document = { frameSeconds: FRAME_SECONDS, patterns: results };
  if (outputPath) {
    fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
    process.stdout.write(`wrote ${outputPath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
