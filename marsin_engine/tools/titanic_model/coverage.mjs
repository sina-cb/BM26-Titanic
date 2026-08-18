import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';
import {
  measureNamedRegionCoverage,
  validateTitanicRegionIntent,
} from './regions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const TITANIC_PLAYLIST_PATH = path.join(
  REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists', 'ambient.yaml',
);
const REGION_INTENT_PATH = path.join(PATTERNS_DIR, 'crisp', 'region_intent.json');
const CADENCE_COVERAGE_FRAMES = Object.freeze({
  // These keepers deliberately use slower story clocks. Give them the same
  // geometric phase span as the original 160-frame coverage window without
  // changing the established sampling window for locked patterns.
  'crisp/03_magnetic_field_collision': 250,
  'crisp/06_impossible_corridor': 250,
});
const CADENCE_COVERAGE_TIME_SCALE = Object.freeze({
  // Pattern 03 was deliberately slowed for Ambient. Preserve the geometric
  // phase span of this offline region audit without changing its live timing.
  'crisp/03_magnetic_field_collision': 4.0,
  'crisp/06_impossible_corridor': 4.0,
});

export const CRISP_KEEPERS = Object.freeze([
  'crisp/01_orbiting_circle',
  'crisp/02_dimensional_slicer',
  'crisp/03_magnetic_field_collision',
  'crisp/06_impossible_corridor',
  'crisp/08_topology_knot',
  'crisp/10_geometric_echo',
]);

export const COVERAGE_SCENARIOS = Object.freeze([
  Object.freeze({ name: 'saved', value: null, speed: null }),
  Object.freeze({ name: 'lower_authored', value: 0.2, speed: 0.2 }),
  Object.freeze({ name: 'upper_authored', value: 0.8, speed: 0.8 }),
]);

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

function setControl(host, handle, name, value) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  if (!control) throw new Error(`missing control export: ${name}`);
  host.setControl(handle, control.id, value);
}

function controlsForScenario(source, saved, scenario) {
  return Object.fromEntries(sliderNames(source).map((name) => {
    if (scenario.name === 'saved') return [name, saved[name]];
    if (name === 'sliderLocalSpeed') return [name, scenario.speed];
    return [name, scenario.value];
  }));
}

async function renderScenario(pattern, source, modelName, controls, frameCount) {
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
  if (!compiled.ok) throw new Error(`${pattern}/${modelName}: ${compiled.error}`);
  try {
    for (const [name, value] of Object.entries(controls)) {
      if (!Number.isFinite(value)) {
        throw new Error(`${pattern}: missing finite ${name} in coverage scenario`);
      }
      setControl(host, compiled.handle, name, value);
    }
    const frames = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frame = new Uint8Array(loaded.pixels.length * 6);
      const timeScale = CADENCE_COVERAGE_TIME_SCALE[pattern] || 1;
      host.beginFrame(compiled.handle, (frameIndex + 1) * 0.025 * timeScale);
      host.renderAll6ch(compiled.handle, frame);
      frames.push(frame);
    }
    return { loaded, frames };
  } finally {
    host.destroy(compiled.handle);
    host.shutdown();
  }
}

function measureModelGroups(pixels, frames) {
  const groups = [...new Set(pixels.map((pixel) => pixel.group))];
  const results = {};
  for (const group of groups) {
    const indices = pixels
      .map((pixel, index) => pixel.group === group ? index : -1)
      .filter((index) => index >= 0);
    let litPixels = 0;
    let dynamicPixels = 0;
    let litSamples = 0;
    for (const pixelIndex of indices) {
      let minimum = 255;
      let maximum = 0;
      for (const frame of frames) {
        const offset = pixelIndex * 6;
        const level = Math.max(frame[offset], frame[offset + 1], frame[offset + 2]);
        minimum = Math.min(minimum, level);
        maximum = Math.max(maximum, level);
        if (level >= 8) litSamples += 1;
      }
      if (maximum >= 8) litPixels += 1;
      if (maximum - minimum >= 4) dynamicPixels += 1;
    }
    results[group] = {
      pixels: indices.length,
      everLitFraction: litPixels / indices.length,
      dynamicFraction: dynamicPixels / indices.length,
      litSampleFraction: litSamples / (indices.length * frames.length),
    };
  }
  return results;
}

export function loadCrispRegionIntents() {
  const registry = JSON.parse(fs.readFileSync(REGION_INTENT_PATH, 'utf8'));
  if (registry.schemaVersion !== 1 || !registry.patterns) {
    throw new Error('Crisp region intent registry must use schemaVersion 1');
  }
  for (const pattern of CRISP_KEEPERS) {
    validateTitanicRegionIntent(pattern, registry.patterns[pattern]);
  }
  const unexpected = Object.keys(registry.patterns).filter(
    (pattern) => !CRISP_KEEPERS.includes(pattern),
  );
  if (unexpected.length > 0) {
    throw new Error(`Crisp region intent has non-keeper entries: ${unexpected.join(', ')}`);
  }
  return registry.patterns;
}

export async function measureCrispModelCoverage({ frameCount = 160 } = {}) {
  const playlist = yaml.load(fs.readFileSync(TITANIC_PLAYLIST_PATH, 'utf8'));
  const entries = new Map(playlist.entries.map((entry) => [entry.pattern, entry]));
  const intents = loadCrispRegionIntents();
  const results = {};
  for (const pattern of CRISP_KEEPERS) {
    const entry = entries.get(pattern);
    if (!entry) throw new Error(`Titanic Ambient playlist missing promoted ${pattern}`);
    const source = fs.readFileSync(path.join(PATTERNS_DIR, `${pattern}.js`), 'utf8');
    const patternResult = {
      balanceMode: intents[pattern].balance_mode,
      titanic: {},
      test_bench: {},
    };
    const patternFrameCount = CADENCE_COVERAGE_FRAMES[pattern] || frameCount;
    for (const modelName of ['titanic', 'test_bench']) {
      for (const scenario of COVERAGE_SCENARIOS) {
        const controls = controlsForScenario(source, entry.defaults, scenario);
        const { loaded, frames } = await renderScenario(
          pattern, source, modelName, controls, patternFrameCount,
        );
        patternResult[modelName][scenario.name] = modelName === 'titanic'
          ? measureNamedRegionCoverage(loaded.pixels, frames)
          : measureModelGroups(loaded.pixels, frames);
      }
    }
    results[pattern] = patternResult;
  }
  return {
    frameCount,
    frameCounts: Object.fromEntries(CRISP_KEEPERS.map((pattern) => [
      pattern,
      CADENCE_COVERAGE_FRAMES[pattern] || frameCount,
    ])),
    timeScales: Object.fromEntries(CRISP_KEEPERS.map((pattern) => [
      pattern,
      CADENCE_COVERAGE_TIME_SCALE[pattern] || 1,
    ])),
    frameSeconds: 0.025,
    scenarios: COVERAGE_SCENARIOS.map((scenario) => scenario.name),
    patterns: results,
  };
}
