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
const CRISP_KEEPERS = new Set([
  'crisp/01_orbiting_circle',
  'crisp/02_dimensional_slicer',
  'crisp/03_magnetic_field_collision',
  'crisp/06_impossible_corridor',
  'crisp/08_topology_knot',
  'crisp/10_geometric_echo',
]);
const FRAME_SECONDS = 0.025;
const SAMPLE_STEPS = new Set([80, 180, 280, 380, 480, 580]);

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function median(values) {
  return percentile(values, 0.5);
}

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

function setControl(host, handle, name, ...values) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  if (!control) throw new Error(`missing control export: ${name}`);
  host.setControl(handle, control.id, ...values);
}

function classMap(frame) {
  const classes = new Uint8Array(frame.length / 6);
  for (let pixelIndex = 0; pixelIndex < classes.length; pixelIndex += 1) {
    const offset = pixelIndex * 6;
    const red = frame[offset];
    const blue = frame[offset + 2];
    classes[pixelIndex] = red < 2 && blue < 2 ? 0 : (red >= blue ? 1 : 2);
  }
  return classes;
}

function hammingFraction(left, right) {
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) different += 1;
  }
  return different / left.length;
}

async function compilePattern(pattern, source, defaults, modelName, pureEndpoints) {
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
  if (pureEndpoints) {
    setControl(host, compiled.handle, 'colorPalette1', 0, 1, 1);
    setControl(host, compiled.handle, 'colorPalette2', 2 / 3, 1, 1);
  }
  for (const name of sliderNames(source)) {
    setControl(host, compiled.handle, name, defaults[name]);
  }
  return { host, loaded, handle: compiled.handle };
}

export async function auditCrispQuality() {
  const playlist = yaml.load(fs.readFileSync(PLAYLIST_PATH, 'utf8'));
  const patterns = playlist.entries.filter((entry) => CRISP_KEEPERS.has(entry.pattern)).map((entry) => ({
    id: entry.pattern,
    defaults: entry.defaults,
    source: fs.readFileSync(path.join(PATTERNS_DIR, `${entry.pattern}.js`), 'utf8'),
  }));
  const performance = {};
  for (const modelName of ['titanic', 'test_bench']) {
    performance[modelName] = {};
    for (const pattern of patterns) {
      const { host, loaded, handle } = await compilePattern(
        pattern.id, pattern.source, pattern.defaults, modelName, false,
      );
      try {
        const frame = new Uint8Array(loaded.pixels.length * 6);
        for (let step = 1; step <= 80; step += 1) {
          host.beginFrame(handle, step * FRAME_SECONDS);
          host.renderAll6ch(handle, frame);
        }
        const timings = [];
        for (let step = 81; step <= 1080; step += 1) {
          const started = globalThis.performance.now();
          host.beginFrame(handle, step * FRAME_SECONDS);
          host.renderAll6ch(handle, frame);
          timings.push(globalThis.performance.now() - started);
        }
        performance[modelName][pattern.id] = {
          pixels: loaded.pixels.length,
          meanMs: timings.reduce((sum, value) => sum + value, 0) / timings.length,
          p95Ms: percentile(timings, 0.95),
          p99Ms: percentile(timings, 0.99),
          budgetFractionP99: percentile(timings, 0.99) / 25,
        };
      } finally {
        host.destroy(handle);
        host.shutdown();
      }
    }
  }

  const classMaps = new Map();
  for (const pattern of patterns) {
    const { host, loaded, handle } = await compilePattern(
      pattern.id, pattern.source, pattern.defaults, 'titanic', true,
    );
    try {
      const maps = [];
      const frame = new Uint8Array(loaded.pixels.length * 6);
      for (let step = 0; step <= 600; step += 1) {
        host.beginFrame(handle, (step + 1) * FRAME_SECONDS * 0.3);
        host.renderAll6ch(handle, frame);
        if (SAMPLE_STEPS.has(step)) maps.push(classMap(frame));
      }
      classMaps.set(pattern.id, maps);
    } finally {
      host.destroy(handle);
      host.shutdown();
    }
  }
  const distinction = {};
  for (let leftIndex = 0; leftIndex < patterns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < patterns.length; rightIndex += 1) {
      const left = patterns[leftIndex].id;
      const right = patterns[rightIndex].id;
      const distances = classMaps.get(left).map((map, frameIndex) =>
        hammingFraction(map, classMaps.get(right)[frameIndex]));
      distinction[`${left} vs ${right}`] = {
        samples: distances,
        medianClassSeparation: median(distances),
      };
    }
  }
  return { frameBudgetMs: 25, performance, distinction };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  if (outIndex >= 0 && !outPath) throw new Error('--out requires a path');
  const result = await auditCrispQuality();
  const document = `${JSON.stringify(result, null, 2)}\n`;
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
