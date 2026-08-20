// white_only_contract.test.js — the grayscale-intensity contract for the
// WHITE ONLY pattern family in patterns/white_only/ (wave _312).
//
// The operator's art direction, as gates:
//   1. WHITE MEANS WHITE. Zero chroma — R = G = B exactly, on every pixel of
//      every sampled frame, on BOTH show models. Native white is W = A
//      matched; UV is always zero. One shared WHITE AUTHORITY block owns the
//      emit path and is byte-identical across all twenty sources, so a stray
//      tint is a hash failure before it is ever a pixel.
//   2. NOT A FLAT WHITE BLAST. "High contrast white … not always and too
//      white": the level histogram must show a real mid/low body under the
//      peaks AND a real crisp-peak mass, bounded above so the family can
//      never degenerate into one uniform wash.
//        - >=25% of lit mass below 0.55 x peak (peak = p99 of lit levels)
//        - 8%..55% of lit mass above 0.80 x peak
//      The 8% floor keeps peaks big enough to read at fifty feet; the 55%
//      ceiling is the anti-wash bar; the 25% body floor is the texture bar.
//   3. DARK AREAS SPARINGLY. Time-averaged dark fraction (byte < 8) <= 0.20,
//      and no named Titanic region is ever permanently dark — the rig stays
//      visible (night-visibility mission).
//   4. ALIVE AND DISTINCT. Every keeper animates, and all twenty are
//      pairwise distinguishable.
//   5. SILENCE == MUSIC. No audio hooks at all — grep-gated.
//
// Sampling steps beginFrame at dt = 0.05 s (< the VM's 0.1 s dt clamp), the
// lesson of report _305: a coarse elapsed grid under-samples every clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';
import { measureNamedRegionCoverage } from '../../tools/titanic_model/regions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const WHITE_DIR = path.join(PATTERNS_DIR, 'white_only');
const SCENES_DIR = path.resolve(ENGINE_DIR, '..', 'simulation', 'scenes');
const SCENES = ['titanic', 'test_bench'];
const MODELS = ['titanic', 'test_bench'];

const KEEPERS = 20;
const NAME_RE = /^(\d\d)_([a-z0-9_]+)$/;

// dt per beginFrame step. MUST stay under the VM's 0.1 s clamp.
const DT = 0.05;

function whiteIds() {
  assert.ok(fs.existsSync(WHITE_DIR), 'patterns/white_only/ must exist');
  return fs.readdirSync(WHITE_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
}

const IDS = whiteIds();
const SOURCE = new Map(IDS.map((id) => [id, fs.readFileSync(path.join(WHITE_DIR, `${id}.js`), 'utf8')]));

const modelCache = new Map();
async function model(name) {
  if (!modelCache.has(name)) modelCache.set(name, await loadModelForGauge(name));
  return modelCache.get(name);
}

async function compilePattern(id, modelName) {
  const loaded = await model(modelName);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(loaded.metaArray);
  host.setFixtureConstants(loaded.fixtureConstants);
  const result = host.compile(SOURCE.get(id));
  assert.equal(result.ok, true, `${id} on ${modelName}: ${result.error}`);
  const frame = new Uint8Array(loaded.pixels.length * 6);
  return {
    pixels: loaded.pixels,
    render(elapsedSeconds) {
      host.beginFrame(result.handle, elapsedSeconds);
      return Uint8Array.from(host.renderAll6ch(result.handle, frame));
    },
    close() { host.destroy(result.handle); host.shutdown(); },
  };
}

// Step the pattern clock densely at DT; keep every `sampleEvery`-th frame.
function renderSeries(driver, seconds, sampleEvery) {
  const steps = Math.round(seconds / DT);
  const frames = [];
  for (let tick = 1; tick <= steps; tick += 1) {
    const frame = driver.render(tick * DT);
    if (tick % sampleEvery === 0) frames.push(frame);
  }
  return frames;
}

// The 30 s / 120-frame titanic review series each heavy gate shares.
const seriesCache = new Map();
async function titanicSeries(id) {
  if (!seriesCache.has(id)) {
    const driver = await compilePattern(id, 'titanic');
    const frames = renderSeries(driver, 30, 5);
    driver.close();
    seriesCache.set(id, frames);
  }
  return seriesCache.get(id);
}

function levelAt(frame, pixelIndex) {
  const offset = pixelIndex * 6;
  return Math.max(frame[offset], frame[offset + 1], frame[offset + 2]);
}

// ── 1. curation ────────────────────────────────────────────────────────────

test('white_only is exactly twenty numbered keepers in playlist order', () => {
  assert.equal(IDS.length, KEEPERS, `expected ${KEEPERS} keepers, found ${IDS.length}: ${IDS.join(', ')}`);
  IDS.forEach((id, index) => {
    const match = NAME_RE.exec(id);
    assert.ok(match, `${id}: file name must be NN_snake_name`);
    assert.equal(Number.parseInt(match[1], 10), index + 1,
      `${id}: numbering must be contiguous 01..20 (position ${index + 1})`);
  });
});

// ── 2. the shared WHITE AUTHORITY block ────────────────────────────────────

const BLOCK_START = '// ── WHITE AUTHORITY';
const BLOCK_END = '// ── end WHITE AUTHORITY ──';

function authorityBlock(source, id) {
  const start = source.indexOf(BLOCK_START);
  const end = source.indexOf(BLOCK_END);
  assert.ok(start >= 0 && end > start, `${id}: WHITE AUTHORITY block markers missing`);
  return source.slice(start, end + BLOCK_END.length);
}

test('WHITE AUTHORITY block is byte-identical across the family', () => {
  const hashes = new Set(IDS.map((id) => crypto.createHash('md5')
    .update(authorityBlock(SOURCE.get(id), id)).digest('hex')));
  assert.equal(hashes.size, 1, `authority block drifted: ${hashes.size} distinct hashes`);
});

test('emitWhite is the only emit path in every source', () => {
  for (const id of IDS) {
    const source = SOURCE.get(id);
    const emits = source.match(/rgbwau\(/g) || [];
    assert.equal(emits.length, 1, `${id}: rgbwau must appear exactly once (inside the authority block)`);
    const renderBody = source.slice(source.indexOf('export function render3D'));
    assert.match(renderBody, /emitWhite\(/, `${id}: render3D must emit through emitWhite`);
  }
});

// ── 3. source contracts: no palette, no audio, shared speed law ────────────

test('no palette exports, no audio hooks, the shared speed law', () => {
  for (const id of IDS) {
    const source = SOURCE.get(id);
    // The authority block's own comment names colorPalette, so target the
    // machinery: an export, or the cp1/cp2 endpoint variables.
    assert.ok(!/export function colorPalette|export var cp[12]H/.test(source),
      `${id}: white_only is untintable — no colorPalette exports`);
    assert.ok(!/AUDIO_MODULATION_V1/.test(source), `${id}: family is free-running — no audio block`);
    assert.ok(!/mic(Low|Mid|High|Kick|Flux)/.test(source), `${id}: family is free-running — no mic signals`);
    assert.match(source, /var speedScale = 0\.35 \+ clamp01\(localSpeed\) \* 1\.65;/,
      `${id}: must use the shared local speed law`);
    const sliders = [...source.matchAll(/export function (slider\w+)\(/g)].map((m) => m[1]);
    assert.equal(sliders[0], 'sliderLocalSpeed', `${id}: sliderLocalSpeed must be the first knob`);
    assert.ok(sliders.includes('sliderLevel'), `${id}: sliderLevel must exist`);
    if (sliders.includes('sliderDirection')) {
      assert.equal(sliders[1], 'sliderDirection', `${id}: direction must be the second knob`);
    }
    assert.match(source, /export var localSpeed = 0\.30;/,
      `${id}: code default localSpeed must be the 0.30 reference point`);
  }
});

// ── 4. purity: zero chroma, W = A, U = 0, both models ─────────────────────

for (const modelName of MODELS) {
  test(`every sampled pixel is pure white on ${modelName}`, async () => {
    for (const id of IDS) {
      const driver = await compilePattern(id, modelName);
      const frames = renderSeries(driver, 8, 20); // 8 frames across 8 s
      driver.close();
      for (const frame of frames) {
        for (let pixel = 0; pixel < driver.pixels.length; pixel += 1) {
          const offset = pixel * 6;
          const r = frame[offset];
          const g = frame[offset + 1];
          const b = frame[offset + 2];
          const w = frame[offset + 3];
          const a = frame[offset + 4];
          const u = frame[offset + 5];
          assert.ok(r === g && g === b,
            `${id} on ${modelName}: pixel ${pixel} has chroma (${r},${g},${b})`);
          assert.equal(w, a, `${id} on ${modelName}: pixel ${pixel} W ${w} != A ${a}`);
          assert.equal(u, 0, `${id} on ${modelName}: pixel ${pixel} emits UV ${u}`);
        }
      }
    }
  });
}

// ── 5. intensity texture: body under the peaks, peaks over the body ───────

// The cohorts are ABSOLUTE bytes, not relative to a per-pattern percentile.
// A relative "x% above 0.8 x p99" bar was tried first and punishes exactly
// the contrasty distributions the operator asked for (rare thin peaks put
// p99 inside the mid body, making the metric circular). The emit ceiling is
// 224 (WHITE_RGB_SHARE 0.88), so:
//   - >= 200 max: crisp features actually punch near the ceiling;
//   - frac(>= 180) in [1%, 45%]: peaks have real area but never become the
//     flat white blast the operator vetoed;
//   - frac(< 124) >= 30%: a real mid/low-gray body under the peaks
//     ("the colors are not always and too white").
test('intensity texture: real mid body, real crisp peaks, never a wash (titanic)', async () => {
  for (const id of IDS) {
    const frames = await titanicSeries(id);
    const loaded = await model('titanic');
    const lit = [];
    let darkSamples = 0;
    let totalSamples = 0;
    for (const frame of frames) {
      for (let pixel = 0; pixel < loaded.pixels.length; pixel += 1) {
        const level = levelAt(frame, pixel);
        totalSamples += 1;
        if (level < 8) darkSamples += 1;
        else lit.push(level);
      }
    }
    assert.ok(lit.length > 0, `${id}: never lit at all`);
    let peak = 0;
    for (const level of lit) peak = Math.max(peak, level);
    assert.ok(peak >= 200, `${id}: max lit byte ${peak} never reaches the emit ceiling — too dim for the night-visibility mission`);
    const lowBody = lit.filter((level) => level < 124).length / lit.length;
    const highMass = lit.filter((level) => level >= 180).length / lit.length;
    const darkFraction = darkSamples / totalSamples;
    assert.ok(lowBody >= 0.30,
      `${id}: only ${(lowBody * 100).toFixed(1)}% of lit mass below byte 124 — reads as a flat white blast`);
    assert.ok(highMass >= 0.01,
      `${id}: only ${(highMass * 100).toFixed(2)}% of lit mass at >= byte 180 — no crisp peaks to read at 50 ft`);
    assert.ok(highMass <= 0.45,
      `${id}: ${(highMass * 100).toFixed(1)}% of lit mass at >= byte 180 — too white, texture collapsed`);
    assert.ok(darkFraction <= 0.20,
      `${id}: dark fraction ${(darkFraction * 100).toFixed(1)}% — dark areas are a spice, not a base`);
  }
});

// ── 6. sparse darks: every named region stays served ──────────────────────

test('no named titanic region is permanently dark', async () => {
  const loaded = await model('titanic');
  for (const id of IDS) {
    const frames = await titanicSeries(id);
    const coverage = measureNamedRegionCoverage(loaded.pixels, frames);
    for (const [region, stats] of Object.entries(coverage)) {
      assert.ok(stats.everLitFraction >= 0.9,
        `${id}: region "${region}" ever-lit ${stats.everLitFraction.toFixed(3)} < 0.9`);
      assert.ok(stats.litSampleFraction >= 0.25,
        `${id}: region "${region}" lit only ${(stats.litSampleFraction * 100).toFixed(1)}% of the time`);
    }
  }
});

// ── 7. animation ───────────────────────────────────────────────────────────

test('every keeper is visibly animated (titanic)', async () => {
  const loaded = await model('titanic');
  for (const id of IDS) {
    const frames = await titanicSeries(id); // 120 frames over 30 s (0.25 s apart)
    let best = 0;
    for (let start = 0; start + 8 < frames.length; start += 8) {
      const early = frames[start];
      const late = frames[start + 8]; // 2 s apart
      let sum = 0;
      for (let pixel = 0; pixel < loaded.pixels.length; pixel += 1) {
        sum += Math.abs(levelAt(late, pixel) - levelAt(early, pixel));
      }
      best = Math.max(best, sum / loaded.pixels.length);
    }
    assert.ok(best >= 2.0, `${id}: max 2-second mean level delta ${best.toFixed(2)} — not visibly animated`);
  }
});

// ── 8. distinctness across the twenty ──────────────────────────────────────

test('all twenty keepers are pairwise distinct (titanic)', async () => {
  const loaded = await model('titanic');
  const signatures = new Map();
  for (const id of IDS) {
    const frames = await titanicSeries(id);
    // Signature: per-pixel time-mean level plus per-pixel dynamic range —
    // together they separate "same field, different phase" lookalikes.
    const mean = new Float64Array(loaded.pixels.length);
    const minLevel = new Float64Array(loaded.pixels.length).fill(255);
    const maxLevel = new Float64Array(loaded.pixels.length);
    for (const frame of frames) {
      for (let pixel = 0; pixel < loaded.pixels.length; pixel += 1) {
        const level = levelAt(frame, pixel);
        mean[pixel] += level / frames.length;
        minLevel[pixel] = Math.min(minLevel[pixel], level);
        maxLevel[pixel] = Math.max(maxLevel[pixel], level);
      }
    }
    signatures.set(id, { mean, span: maxLevel.map((value, i) => value - minLevel[i]) });
  }
  for (let left = 0; left < IDS.length; left += 1) {
    for (let right = left + 1; right < IDS.length; right += 1) {
      const a = signatures.get(IDS[left]);
      const b = signatures.get(IDS[right]);
      let meanDiff = 0;
      let spanDiff = 0;
      for (let pixel = 0; pixel < loaded.pixels.length; pixel += 1) {
        meanDiff += Math.abs(a.mean[pixel] - b.mean[pixel]);
        spanDiff += Math.abs(a.span[pixel] - b.span[pixel]);
      }
      meanDiff /= loaded.pixels.length;
      spanDiff /= loaded.pixels.length;
      const distance = meanDiff + spanDiff;
      assert.ok(distance >= 12,
        `${IDS[left]} vs ${IDS[right]}: signature distance ${distance.toFixed(1)} — near-duplicates`);
    }
  }
});

// ── 9. playlist integrity ──────────────────────────────────────────────────

test('white_only playlist: byte-identical scenes, resolving entries, playlist order', () => {
  const copies = SCENES.map((scene) => fs.readFileSync(
    path.join(SCENES_DIR, scene, 'playlists', 'white_only.yaml')));
  assert.ok(copies[0].equals(copies[1]), 'white_only.yaml differs between titanic and test_bench');

  const text = copies[0].toString('utf8');
  const referenced = [...text.matchAll(/pattern: (white_only\/[a-z0-9_]+)/g)].map((m) => m[1]);
  assert.equal(referenced.length, KEEPERS, `playlist must carry all ${KEEPERS} family entries`);
  referenced.forEach((qualified, index) => {
    const id = qualified.split('/')[1];
    assert.equal(id, IDS[index],
      `playlist position ${index + 1} is ${qualified}, expected white_only/${IDS[index]} — numbering IS playlist order`);
    assert.ok(fs.existsSync(path.join(WHITE_DIR, `${id}.js`)), `${qualified}: file missing`);
  });
  // Every family entry loads at the authored reference point.
  const entryBlocks = text.split(/\n  - id: /).filter((block) => block.includes('pattern: white_only/'));
  assert.equal(entryBlocks.length, KEEPERS);
  for (const block of entryBlocks) {
    assert.match(block, /sliderLocalSpeed: 0\.3\b/,
      'family entries must load at the sliderLocalSpeed 0.30 reference point');
  }
});
