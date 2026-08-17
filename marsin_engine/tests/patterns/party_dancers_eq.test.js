// Offline rendered-output acceptance for the bottom-up DOM EQ companion.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { createBitFreeViewPromoter } from '../../lib/in_view_intrinsic.js';
import { buildMetaArray, loadModelForGauge } from '../../lib/model_loader.js';
import { buildViewCatalog } from '../../lib/view_catalog.js';
import { buildMaskConstants } from '../../lib/view_mask_constants.js';
import { WasmHost } from '../../lib/wasm_host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../..');
const PATTERN_NAME = 'party_dancers/02_dom_eq_rise';
const PATTERN_PATH = path.join(ENGINE_DIR, 'patterns', 'party_dancers', '02_dom_eq_rise.js');
const PLAYLIST_PATH = path.resolve(
  ENGINE_DIR, '../simulation/scenes/titanic/playlists/party_dancers.yaml',
);
const GALLERY_DIR = path.resolve(
  ENGINE_DIR, '../docs/pattern_gallery/playlists/titanic/party_dancers',
);
const EXPECTED_ENTRY_ID = 'e_party_dancers_1_dom_eq_rise';
const EXPECTED_SLIDERS = [
  'sliderLocalSpeed',
  'sliderLevel',
  'sliderBandWidth',
  'sliderBackgroundLevel',
  'sliderOrganEnergy',
  'sliderOrganKick',
  'sliderIdentityLevel',
  'sliderSpin',
  'sliderDomFreq1',
  'sliderDomEnergy1',
  'sliderDomFreq2',
  'sliderDomEnergy2',
];
const EXPECTED_SIGNALS = [
  'micDomFreq1',
  'micDomEnergy1',
  'micDomFreq2',
  'micDomEnergy2',
  'micLow',
  'micKick',
];
const FIX_RAW_LED = 1;
const FIX_PAR = 2;
const FIX_VINTAGE_6 = 3;
const FIX_BAR_18 = 4;
const FIX_TE_SIGN = 7;

const source = fs.readFileSync(PATTERN_PATH, 'utf8');
const playlist = yaml.load(fs.readFileSync(PLAYLIST_PATH, 'utf8'));
const playlistEntry = playlist.entries.find((entry) => entry.id === EXPECTED_ENTRY_ID);

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
  } else {
    setControl(host, handle, 'colorPalette1', 0.54, 0.94, 1);
    setControl(host, handle, 'colorPalette2', 0.92, 0.91, 1);
  }
  for (const name of EXPECTED_SLIDERS) {
    const value = overrides[name] ?? playlistEntry.defaults[name];
    assert.ok(Number.isFinite(value), `no finite saved/default value for ${name}`);
    setControl(host, handle, name, value);
  }
}

async function compileOnModel(modelName) {
  const loaded = await loadModelForGauge(modelName);
  const { viewTable } = buildViewCatalog(loaded);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map((pixel) => ({
    nx: pixel.nx,
    ny: pixel.ny,
    nz: pixel.nz,
  })));
  host.setPixelMeta(loaded.metaArray);
  host.setMaskConstants(buildMaskConstants({
    groupBits: loaded.groupBits,
    viewMasks: loaded.viewMasks,
  }));
  host.setFixtureConstants(loaded.fixtureConstants);
  host.setViewTable(viewTable);
  host.setBitFreeViewPromoter(createBitFreeViewPromoter(loaded, host));
  const result = host.compile(source);
  if (result.ok && host.metaDirty) {
    host.setPixelMeta(buildMetaArray(loaded.pixels));
    host.metaDirty = false;
  }
  return { host, loaded, result };
}

async function compileSynthetic(coords) {
  const host = new WasmHost();
  await host.init(coords.length);
  host.setCoords(coords);
  host.setPixelMeta(coords.map((_, index) => ({
    controllerId: 1,
    sectionId: 1,
    fixtureId: 1000,
    fixtureTypeId: FIX_BAR_18,
    pixelLocalIndex: index,
  })));
  host.setFixtureConstants({
    FIX_RAW_LED,
    FIX_PAR,
    FIX_VINTAGE_6,
    FIX_BAR_18,
    FIX_TE_SIGN,
  });
  const result = host.compile(source);
  return { host, result };
}

function renderFrame(host, handle, pixelCount, elapsed) {
  const buffer = new Uint8Array(pixelCount * 6);
  host.beginFrame(handle, elapsed);
  host.renderAll6ch(handle, buffer);
  return buffer;
}

function warmRender(host, handle, pixelCount, frames, start = 0) {
  let buffer;
  for (let frame = 1; frame <= frames; frame += 1) {
    buffer = renderFrame(host, handle, pixelCount, start + frame * 0.025);
  }
  return { buffer, elapsed: start + frames * 0.025 };
}

async function renderModel(modelName, overrides = {}, frames = 220) {
  const { host, loaded, result } = await compileOnModel(modelName);
  assert.equal(result.ok, true, `${modelName}: ${result.error}`);
  try {
    applyControls(host, result.handle, overrides, true);
    return { buffer: warmRender(host, result.handle, loaded.pixels.length, frames).buffer, loaded };
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
}

async function renderSynthetic(coords, overrides = {}, frames = 260) {
  const { host, result } = await compileSynthetic(coords);
  assert.equal(result.ok, true, result.error);
  try {
    applyControls(host, result.handle, overrides, true);
    return warmRender(host, result.handle, coords.length, frames).buffer;
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
}

function pixelBrightness(buffer, pixel) {
  const offset = pixel * 6;
  return Math.max(...buffer.slice(offset, offset + 6));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rmsDifference(first, second, indices = null) {
  const pixels = indices ?? Array.from({ length: first.length / 6 }, (_, index) => index);
  let squareSum = 0;
  let count = 0;
  for (const pixel of pixels) {
    for (let channel = 0; channel < 6; channel += 1) {
      const difference = first[pixel * 6 + channel] - second[pixel * 6 + channel];
      squareSum += difference * difference;
      count += 1;
    }
  }
  return Math.sqrt(squareSum / count);
}

function frequencyValue(hz) {
  return hz / 22050;
}

function verticalDifferenceCentroid(active, baseline, loaded, channel) {
  const weights = loaded.pixels.map((pixel, index) => Math.max(
    0,
    active[index * 6 + channel] - baseline[index * 6 + channel],
  ));
  const total = weights.reduce((sum, value) => sum + value, 0);
  assert.ok(total > 0, `channel ${channel} has no audio-driven output`);
  return weights.reduce(
    (sum, weight, index) => sum + weight * loaded.pixels[index].ny,
    0,
  ) / total;
}

test('EQ Rise has a stable second playlist identity and complete DOM wiring', () => {
  assert.ok(playlistEntry, `missing ${EXPECTED_ENTRY_ID}`);
  assert.equal(playlistEntry.pattern, PATTERN_NAME);
  assert.match(source.split(/\r?\n/, 1)[0], /^\/\/ DRAFT/);
  assert.deepEqual(sliderNames(source), EXPECTED_SLIDERS);
  assert.deepEqual(Object.keys(playlistEntry.defaults), EXPECTED_SLIDERS);
  assert.equal(EXPECTED_SLIDERS.length, 12);
  assert.deepEqual(
    playlistEntry.modulations.map((item) => item.source.key),
    EXPECTED_SIGNALS,
  );
  assert.equal(new Set(playlistEntry.modulations.map((item) => item.id)).size, 6);
  assert.match(source, /pairedLobes\(azimuth, center, width\)/);
  assert.match(source, /verticalColumn\(modelY, center, headWidth, energy\)/);
  assert.doesNotMatch(source.slice(source.indexOf('*/') + 2), /catch\s*\(|random\s*\(/);
});

test('Party Dancers gallery renders both looks with goals, autoplay, and complete media', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(GALLERY_DIR, 'manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(GALLERY_DIR, 'index.html'), 'utf8');
  assert.equal(manifest.playlist, 'party_dancers');
  assert.equal(manifest.seconds, 12);
  assert.deepEqual(
    manifest.items.map((item) => item.pattern),
    playlist.entries.map((entry) => entry.pattern),
  );
  for (const item of manifest.items) {
    assert.ok(item.goal?.length > 80, `${item.pattern}: gallery goal is missing or generic`);
    assert.ok(fs.existsSync(path.join(GALLERY_DIR, 'gifs', item.gif)), `missing ${item.gif}`);
    assert.ok(fs.existsSync(path.join(GALLERY_DIR, 'videos', item.video)), `missing ${item.video}`);
  }
  assert.equal((html.match(/<video\b[^>]*\bautoplay\b/g) || []).length, 2);
  assert.match(html, /DOM Ball Dancers/);
  assert.match(html, /DOM EQ Rise/);
});

test('EQ Rise compiles, covers every pixel in silence, and emits no W/A/UV on both models', async () => {
  const silence = {
    sliderDomFreq1: 0,
    sliderDomEnergy1: 0,
    sliderDomFreq2: 0,
    sliderDomEnergy2: 0,
    sliderOrganEnergy: 0,
    sliderOrganKick: 0,
  };
  for (const modelName of ['titanic', 'test_bench']) {
    const rendered = await renderModel(modelName, silence, 180);
    for (let pixel = 0; pixel < rendered.loaded.pixels.length; pixel += 1) {
      assert.ok(pixelBrightness(rendered.buffer, pixel) > 0,
        `${modelName}: silence floor missed pixel ${pixel}`);
      assert.equal(rendered.buffer[pixel * 6 + 3], 0, `${modelName}: W at ${pixel}`);
      assert.equal(rendered.buffer[pixel * 6 + 4], 0, `${modelName}: A at ${pixel}`);
      assert.equal(rendered.buffer[pixel * 6 + 5], 0, `${modelName}: UV at ${pixel}`);
    }
  }
});

test('each dominant frequency lane rises monotonically from bottom to top', async () => {
  const frequencies = [60, 180, 540, 1620, 4860];
  for (const lane of [1, 2]) {
    const angle = lane === 1 ? 0 : Math.PI / 2;
    const coords = Array.from({ length: 101 }, (_, index) => ({
      nx: 0.5 + Math.cos(angle) * 0.25,
      ny: index / 100,
      nz: 0.5 + Math.sin(angle) * 0.25,
    }));
    const loaded = { pixels: coords };
    const centroids = [];
    for (const frequency of frequencies) {
      const common = {
        sliderSpin: 0,
        sliderBackgroundLevel: 0.04,
        sliderDomFreq1: lane === 1 ? frequencyValue(frequency) : 0,
        sliderDomFreq2: lane === 2 ? frequencyValue(frequency) : 0,
        sliderDomEnergy1: 0,
        sliderDomEnergy2: 0,
      };
      const baseline = await renderSynthetic(coords, common, 260);
      common[`sliderDomEnergy${lane}`] = 0.92;
      const active = await renderSynthetic(coords, common, 260);
      centroids.push(verticalDifferenceCentroid(
        active,
        baseline,
        loaded,
        lane === 1 ? 0 : 2,
      ));
    }
    for (let index = 1; index < centroids.length; index += 1) {
      assert.ok(centroids[index] > centroids[index - 1] + 0.02,
        `lane ${lane} did not rise monotonically: ${centroids.join(', ')}`);
    }
    assert.ok(centroids.at(-1) - centroids[0] > 0.22,
      `lane ${lane} vertical travel is too small: ${centroids.join(', ')}`);
  }
});

test('Spin zero holds the dancer orientation while Spin one visibly rotates it', async () => {
  const { host, loaded, result } = await compileOnModel('titanic');
  assert.equal(result.ok, true, result.error);
  try {
    const common = {
      sliderBackgroundLevel: 0,
      sliderDomFreq1: frequencyValue(420),
      sliderDomEnergy1: 0.9,
      sliderDomFreq2: frequencyValue(2300),
      sliderDomEnergy2: 0.86,
    };
    applyControls(host, result.handle, { ...common, sliderSpin: 0 }, true);
    let rendered = warmRender(host, result.handle, loaded.pixels.length, 80);
    const heldStart = rendered.buffer;
    rendered = warmRender(host, result.handle, loaded.pixels.length, 240, rendered.elapsed);
    const heldEnd = rendered.buffer;
    const heldDifference = rmsDifference(heldStart, heldEnd);
    setControl(host, result.handle, 'sliderSpin', 1);
    rendered = warmRender(host, result.handle, loaded.pixels.length, 240, rendered.elapsed);
    const rotated = rendered.buffer;
    const rotatedDifference = rmsDifference(heldEnd, rotated);
    assert.ok(rotatedDifference > heldDifference * 1.6,
      `Spin did not dominate field drift: hold ${heldDifference}, spin ${rotatedDifference}`);
    assert.ok(rotatedDifference > 8, `Spin movement is too subtle: ${rotatedDifference}`);
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
});

test('both TE signs stay balanced, detailed, and animated under EQ motion', async () => {
  const overrides = {
    sliderDomFreq1: frequencyValue(360),
    sliderDomEnergy1: 0.82,
    sliderDomFreq2: frequencyValue(2600),
    sliderDomEnergy2: 0.78,
    sliderSpin: 0.46,
    sliderIdentityLevel: 0.66,
  };
  const first = await renderModel('titanic', overrides, 120);
  const last = await renderModel('titanic', overrides, 360);
  const signs = [
    first.loaded.pixels.map((pixel, index) => pixel.group === 'TE Sign' ? index : -1)
      .filter((index) => index >= 0),
    first.loaded.pixels.map((pixel, index) => pixel.group === 'TE Sign 2' ? index : -1)
      .filter((index) => index >= 0),
  ];
  assert.deepEqual(signs.map((indices) => indices.length), [74, 74]);
  const means = [];
  for (const [side, indices] of signs.entries()) {
    const levels = indices.map((pixel) => pixelBrightness(first.buffer, pixel));
    means.push(mean(levels));
    assert.ok(Math.min(...levels) >= 8, `TE sign ${side} lost its floor`);
    assert.ok(Math.max(...levels) - Math.min(...levels) >= 24,
      `TE sign ${side} lacks full-surface EQ detail`);
    assert.ok(rmsDifference(first.buffer, last.buffer, indices) > 2,
      `TE sign ${side} does not visibly rotate/rise`);
  }
  assert.ok(Math.abs(means[0] - means[1]) / Math.max(...means) <= 0.10,
    `TE signs are imbalanced: ${means.join(' vs ')}`);
});

test('warmed EQ Rise render remains within the 40 fps frame budget', async () => {
  const { host, loaded, result } = await compileOnModel('titanic');
  assert.equal(result.ok, true, result.error);
  try {
    applyControls(host, result.handle);
    warmRender(host, result.handle, loaded.pixels.length, 80);
    const durations = [];
    for (let frame = 0; frame < 120; frame += 1) {
      const started = performance.now();
      renderFrame(host, result.handle, loaded.pixels.length, 2 + frame * 0.025);
      durations.push(performance.now() - started);
    }
    const average = mean(durations);
    const p95 = [...durations].sort((first, second) => first - second)[
      Math.floor(durations.length * 0.95)
    ];
    assert.ok(average < 25, `average Titanic frame exceeds 40 fps: ${average} ms`);
    assert.ok(p95 < 25, `p95 Titanic frame exceeds 40 fps: ${p95} ms`);
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
});
