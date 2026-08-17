// Offline rendered-output acceptance for DOM Ball Dancers and its Spin control.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { audioSignalDescriptors } from '../../audio/postproc/audio_signals.js';
import { createBitFreeViewPromoter } from '../../lib/in_view_intrinsic.js';
import { buildMetaArray, loadModelForGauge } from '../../lib/model_loader.js';
import {
  applyContinuousModulation,
  resolveModulationSources,
} from '../../lib/modulation_engine.js';
import { buildViewCatalog } from '../../lib/view_catalog.js';
import { buildMaskConstants } from '../../lib/view_mask_constants.js';
import { WasmHost } from '../../lib/wasm_host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const PATTERN_NAME = 'party_dancers/01_dom_ball_dancers';
const EQ_PATTERN_NAME = 'party_dancers/02_dom_eq_rise';
const PATTERN_PATH = path.join(PATTERNS_DIR, 'party_dancers', '01_dom_ball_dancers.js');
const MANIFEST_PATH = path.join(PATTERNS_DIR, 'manifest.json');
const PLAYLIST_PATH = path.resolve(
  ENGINE_DIR, '../simulation/scenes/titanic/playlists/party_dancers.yaml',
);
const EXPECTED_ENTRY_ID = 'e_party_dancers_0_134_dom_frequency_baseline';
const EXPECTED_SLIDERS = [
  'sliderLocalSpeed',
  'sliderLevel',
  'sliderMinimumWidth',
  'sliderEnergyWidth',
  'sliderBackgroundLevel',
  'sliderOrganEnergy',
  'sliderOrganKick',
  'sliderIdentityLevel',
  'sliderDomFreq1',
  'sliderDomEnergy1',
  'sliderDomFreq2',
  'sliderDomEnergy2',
  'sliderSpin',
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
const TITANIC_SIDE_SPLIT_X = 0.5253936432;

const source = fs.readFileSync(PATTERN_PATH, 'utf8');
const playlist = yaml.load(fs.readFileSync(PLAYLIST_PATH, 'utf8'));
const playlistEntry = playlist.entries[0];

function sliderNames(patternSource) {
  return [...patternSource.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

function recursivePatternIds(directory, prefix = '') {
  const ids = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      ids.push(...recursivePatternIds(path.join(directory, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      ids.push(`${prefix}${path.basename(entry.name, '.js')}`);
    }
  }
  return ids;
}

function modulationFor(signal) {
  const matches = playlistEntry.modulations.filter((item) => item.source.key === signal);
  assert.equal(matches.length, 1, `expected one ${signal} modulation, got ${matches.length}`);
  return matches[0];
}

function modulationValue(signal, rawValue) {
  const mapping = modulationFor(signal);
  const normalized = resolveModulationSources({ paramCenterSnapshot: { [signal]: rawValue } });
  assert.ok(Number.isFinite(normalized[signal]), `${signal} did not normalize`);
  return {
    parameter: mapping.target.parameter,
    value: applyContinuousModulation({
      baseNorm: playlistEntry.defaults[mapping.target.parameter] ?? 0,
      sourceNorm: normalized[signal],
      ...mapping,
    }),
  };
}

function signalOverrides(values) {
  return Object.fromEntries(Object.entries(values).map(([signal, rawValue]) => {
    const mapped = modulationValue(signal, rawValue);
    return [mapped.parameter, mapped.value];
  }));
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
  for (const name of sliderNames(source)) {
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

async function compileSynthetic(coords, metas) {
  const host = new WasmHost();
  await host.init(coords.length);
  host.setCoords(coords);
  host.setPixelMeta(metas);
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

function warmRender(host, handle, pixelCount, frames = 220, step = 0.025, start = 0) {
  let buffer;
  for (let frame = 1; frame <= frames; frame += 1) {
    buffer = renderFrame(host, handle, pixelCount, start + frame * step);
  }
  return { buffer, elapsed: start + frames * step };
}

async function renderModel(modelName, overrides = {}, options = {}) {
  const { host, loaded, result } = await compileOnModel(modelName);
  assert.equal(result.ok, true, `${modelName}: ${result.error}`);
  try {
    applyControls(host, result.handle, overrides, options.pureEndpoints ?? false);
    const rendered = warmRender(
      host,
      result.handle,
      loaded.pixels.length,
      options.frames ?? 220,
      0.025,
    );
    return { buffer: rendered.buffer, loaded };
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
}

function syntheticMeta(fixtureTypeId, index, overrides = {}) {
  return {
    controllerId: 30,
    sectionId: 900,
    fixtureId: 1000 + fixtureTypeId,
    fixtureTypeId,
    pixelLocalIndex: index,
    ...overrides,
  };
}

function leftHullPoint(u, z = 0.5, y = 0.48) {
  return {
    nx: (2.045444444444444 - u) / 5.320666666666667,
    ny: y,
    nz: z,
  };
}

function rightHullPoint(u, z = 0.5, y = 0.48) {
  return {
    nx: (u + 1.485938864628821 * z + 2.113310043668122) / 4.182183406113537,
    ny: y,
    nz: z,
  };
}

function leftSignPoint(u, signY = 0.5, x = 0.36) {
  return {
    nx: x,
    ny: 0.5159 + signY * 0.1468,
    nz: (u + 21.396855346) / 26.751572327,
  };
}

function rightSignPoint(u, signY = 0.5, z = 0.52) {
  return {
    nx: (u - 22.171335999 * z + 35.347564959) / 34.162087014,
    ny: 0.5246 + signY * 0.1478,
    nz: z,
  };
}

function longitudinalGrid(fixtureTypeId = FIX_BAR_18) {
  const coords = [];
  const metas = [];
  const us = [];
  for (let index = 0; index <= 100; index += 1) {
    const u = index / 100;
    coords.push(leftHullPoint(u));
    metas.push(syntheticMeta(fixtureTypeId, index));
    us.push(u);
  }
  return { coords, metas, us };
}

async function renderSynthetic(coords, metas, overrides = {}, options = {}) {
  const { host, result } = await compileSynthetic(coords, metas);
  assert.equal(result.ok, true, result.error);
  try {
    applyControls(host, result.handle, overrides, options.pureEndpoints ?? false);
    const rendered = warmRender(
      host,
      result.handle,
      coords.length,
      options.frames ?? 220,
      0.025,
    );
    return rendered.buffer;
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
}

function pixelChannel(buffer, pixel, channel) {
  return buffer[pixel * 6 + channel];
}

function pixelBrightness(buffer, pixel) {
  const offset = pixel * 6;
  return Math.max(...buffer.slice(offset, offset + 6));
}

function brightnesses(buffer, indices = null) {
  const pixels = indices ?? Array.from({ length: buffer.length / 6 }, (_, index) => index);
  return pixels.map((pixel) => pixelBrightness(buffer, pixel));
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

function weightedStats(buffer, us, channel) {
  const raw = us.map((_, index) => pixelChannel(buffer, index, channel));
  const floor = Math.min(...raw);
  const weights = raw.map((value) => Math.max(0, value - floor - 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  assert.ok(total > 0, `channel ${channel} has no band above the bed`);
  const centroid = weights.reduce((sum, weight, index) => sum + weight * us[index], 0) / total;
  const variance = weights.reduce(
    (sum, weight, index) => sum + weight * (us[index] - centroid) ** 2,
    0,
  ) / total;
  return {
    centroid,
    deviation: Math.sqrt(variance),
    peak: Math.max(...raw),
    mean: mean(raw),
    footprint: weights.filter((weight) => weight > Math.max(...weights) * 0.25).length,
    peakAt: us[raw.indexOf(Math.max(...raw))],
  };
}

function weightedDifferenceStats(active, base, us, channel) {
  const weights = us.map((_, index) => Math.max(
    0,
    pixelChannel(active, index, channel) - pixelChannel(base, index, channel),
  ));
  const total = weights.reduce((sum, value) => sum + value, 0);
  assert.ok(total > 0, `channel ${channel} has no positive energy response`);
  const centroid = weights.reduce((sum, weight, index) => sum + weight * us[index], 0) / total;
  const variance = weights.reduce(
    (sum, weight, index) => sum + weight * (us[index] - centroid) ** 2,
    0,
  ) / total;
  return {
    centroid,
    deviation: Math.sqrt(variance),
    mean: mean(weights),
    peak: Math.max(...weights),
    footprint: weights.filter((weight) => weight > Math.max(...weights) * 0.25).length,
  };
}

function titanicU(pixel) {
  if (pixel.nx < TITANIC_SIDE_SPLIT_X) {
    return Math.max(0, Math.min(1, 2.045444444444444 - 5.320666666666667 * pixel.nx));
  }
  return Math.max(0, Math.min(
    1,
    4.182183406113537 * pixel.nx - 1.485938864628821 * pixel.nz - 2.113310043668122,
  ));
}

test('qualified package preserves the baseline identity and adds exactly one EQ-rise companion', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const discovered = recursivePatternIds(PATTERNS_DIR);
  assert.equal(fs.existsSync(PATTERN_PATH), true);
  assert.equal(discovered.filter((name) => name === PATTERN_NAME).length, 1);
  assert.equal(manifest.filter((name) => name === PATTERN_NAME).length, 1);
  assert.equal(manifest.filter((name) => name === EQ_PATTERN_NAME).length, 1);
  assert.equal(manifest.some((name) => /^134_/.test(name)), false);
  assert.equal(playlist.schemaVersion, 1);
  assert.equal(playlist.name, 'party_dancers');
  assert.equal(playlist.entries.length, 2);
  assert.equal(playlistEntry.id, EXPECTED_ENTRY_ID);
  assert.equal(playlistEntry.pattern, PATTERN_NAME);
  assert.match(source.split(/\r?\n/, 1)[0], /^\/\/ DRAFT/);
  assert.deepEqual(sliderNames(source), EXPECTED_SLIDERS);
  assert.deepEqual(Object.keys(playlistEntry.defaults), EXPECTED_SLIDERS);
  assert.ok(EXPECTED_SLIDERS.length <= 13, 'operator surface exceeds thirteen local knobs');
  assert.deepEqual(
    fs.readdirSync(path.dirname(PATTERN_PATH)).filter((name) => /^\d\d_.*\.js$/.test(name)),
    ['01_dom_ball_dancers.js', '02_dom_eq_rise.js'],
  );
  assert.doesNotMatch(source, /slider(?:BallSize|TrailLength|IdentityEnergy)/);
  const executable = source.slice(source.indexOf('*/') + 2);
  assert.doesNotMatch(executable, /Lissajous|trail|particle/i);
});

test('playlist binds exactly both real DOM lanes plus LOW/KICK through registry normalizers', () => {
  const descriptors = new Map(audioSignalDescriptors().map((item) => [item.key, item]));
  const actualSignals = playlistEntry.modulations.map((item) => item.source.key);
  assert.deepEqual(actualSignals, EXPECTED_SIGNALS);
  for (const signal of EXPECTED_SIGNALS) {
    assert.ok(descriptors.has(signal), `${signal} is not an authoritative audio signal`);
    const mapping = modulationFor(signal);
    assert.equal(mapping.enabled, true);
    assert.equal(mapping.type, 'continuous');
    assert.equal(mapping.source.scope, 'cpc');
    assert.equal(mapping.target.scope, 'pattern');
    assert.ok(EXPECTED_SLIDERS.includes(mapping.target.parameter));
  }
  assert.deepEqual(descriptors.get('micDomFreq1').range, [0, 22050]);
  assert.deepEqual(descriptors.get('micDomFreq2').range, [0, 22050]);
  const normalized = resolveModulationSources({
    paramCenterSnapshot: { micDomFreq1: 11025, micDomFreq2: 22050 },
  });
  assert.equal(normalized.micDomFreq1, 0.5);
  assert.equal(normalized.micDomFreq2, 1);
  assert.equal(actualSignals.some((name) => name === 'micMid' || name === 'micHigh'), false);
});

test('pattern compiles and renders offline on Titanic and explicit test_bench geometry', async () => {
  for (const modelName of ['titanic', 'test_bench']) {
    const { host, loaded, result } = await compileOnModel(modelName);
    try {
      assert.equal(result.ok, true, `${modelName}: ${result.error}`);
      applyControls(host, result.handle);
      const buffer = renderFrame(host, result.handle, loaded.pixels.length, 0.025);
      assert.equal(buffer.length, loaded.pixels.length * 6);
      assert.ok(buffer.some((value) => value > 0));
    } finally {
      if (result.ok) host.destroy(result.handle);
      host.shutdown();
    }
  }
  assert.match(source, /function isTestBenchPixel\s*\(/);
  assert.match(source, /benchPixel == 1/);
  assert.doesNotMatch(source, /catch\s*\(/);
});

test('Titanic load-bearing roles are exact and cover all 964 pixels', async () => {
  const loaded = await loadModelForGauge('titanic');
  const counts = new Map();
  for (const meta of loaded.metaArray) {
    counts.set(meta.fixtureTypeId, (counts.get(meta.fixtureTypeId) ?? 0) + 1);
  }
  assert.equal(loaded.pixels.length, 964);
  assert.deepEqual([...counts.keys()].sort((first, second) => first - second), [1, 2, 3, 4, 7],
    'unknown or missing Titanic fixture roles must fail loudly');
  assert.deepEqual(Object.fromEntries([...counts.entries()].sort()), {
    1: 320,
    2: 40,
    3: 96,
    4: 360,
    7: 148,
  });
});

test('each DOM frequency lane sweeps strictly monotonically through longitudinal u', async () => {
  const { coords, metas, us } = longitudinalGrid();
  const frequencies = [60, 180, 540, 1620, 4860];
  for (const lane of [1, 2]) {
    const centroids = [];
    for (const frequency of frequencies) {
      const baseline = await renderSynthetic(coords, metas, {
        ...signalOverrides({
          micDomFreq1: lane === 1 ? frequency : 0,
          micDomEnergy1: 0,
          micDomFreq2: lane === 2 ? frequency : 0,
          micDomEnergy2: 0,
        }),
        sliderSpin: 0,
      }, { pureEndpoints: true });
      const overrides = {
        ...signalOverrides({
        micDomFreq1: lane === 1 ? frequency : 0,
        micDomEnergy1: lane === 1 ? 0.88 : 0,
        micDomFreq2: lane === 2 ? frequency : 0,
        micDomEnergy2: lane === 2 ? 0.88 : 0,
        }),
        sliderSpin: 0,
      };
      const buffer = await renderSynthetic(coords, metas, overrides, { pureEndpoints: true });
      const stats = weightedDifferenceStats(buffer, baseline, us, lane === 1 ? 0 : 2);
      centroids.push(stats.centroid);
    }
    for (let index = 1; index < centroids.length; index += 1) {
      assert.ok(
        centroids[index] > centroids[index - 1] + 0.035,
        `lane ${lane} frequency sweep is not strictly increasing: ${centroids.join(', ')}`,
      );
    }
    assert.ok(centroids.at(-1) - centroids[0] > 0.48,
      `lane ${lane} sweep travel is too small: ${centroids.join(', ')}`);
  }
});

test('each DOM energy lane widens and strengthens its band without moving center', async () => {
  const { coords, metas, us } = longitudinalGrid();
  for (const lane of [1, 2]) {
    const common = {
      micDomFreq1: lane === 1 ? 720 : 0,
      micDomFreq2: lane === 2 ? 720 : 0,
      micDomEnergy1: 0,
      micDomEnergy2: 0,
    };
    const baseline = await renderSynthetic(coords, metas, {
      ...signalOverrides(common),
      sliderSpin: 0,
    }, {
      pureEndpoints: true,
    });
    common[`micDomEnergy${lane}`] = 0.25;
    const quiet = await renderSynthetic(coords, metas, {
      ...signalOverrides(common),
      sliderSpin: 0,
    }, {
      pureEndpoints: true,
    });
    common[`micDomEnergy${lane}`] = 0.95;
    const present = await renderSynthetic(coords, metas, {
      ...signalOverrides(common),
      sliderSpin: 0,
    }, {
      pureEndpoints: true,
    });
    const channel = lane === 1 ? 0 : 2;
    const quietStats = weightedDifferenceStats(quiet, baseline, us, channel);
    const presentStats = weightedDifferenceStats(present, baseline, us, channel);
    assert.ok(presentStats.deviation > quietStats.deviation * 1.30,
      `lane ${lane} energy did not widen band: ${quietStats.deviation} -> ${presentStats.deviation}`);
    assert.ok(presentStats.mean > quietStats.mean * 1.25,
      `lane ${lane} energy did not strengthen band: ${quietStats.mean} -> ${presentStats.mean}`);
    assert.ok(Math.abs(presentStats.centroid - quietStats.centroid) < 0.018,
      `lane ${lane} energy moved center: ${quietStats.centroid} -> ${presentStats.centroid}`);
  }
});

test('inverse longitudinal geometry is byte-exact across both sides and four hull faces', async () => {
  const coords = [];
  const metas = [];
  for (const fixtureType of [FIX_RAW_LED, FIX_PAR, FIX_VINTAGE_6, FIX_BAR_18]) {
    for (const u of [0.12, 0.34, 0.61, 0.87]) {
      for (const y of [0.23, 0.68]) {
        coords.push(leftHullPoint(u, 0.31, y));
        coords.push(leftHullPoint(u, 0.73, y));
        coords.push(rightHullPoint(u, 0.31, y));
        coords.push(rightHullPoint(u, 0.73, y));
        const localIndex = Math.round(u * 30);
        for (let member = 0; member < 4; member += 1) {
          metas.push(syntheticMeta(fixtureType, localIndex));
        }
      }
    }
  }
  const buffer = await renderSynthetic(coords, metas, { sliderSpin: 0 }, { pureEndpoints: true });
  for (let quartet = 0; quartet < coords.length; quartet += 4) {
    const expected = [...buffer.slice(quartet * 6, quartet * 6 + 6)];
    for (let member = 1; member < 4; member += 1) {
      assert.deepEqual(
        [...buffer.slice((quartet + member) * 6, (quartet + member) * 6 + 6)],
        expected,
        `four-face mirror divergence in quartet ${quartet / 4}, member ${member}`,
      );
    }
  }
});

test('both palette endpoints remain simultaneously visible on both physical halves', async () => {
  const rendered = await renderModel('titanic', {
    ...signalOverrides({
      micDomFreq1: 240,
      micDomEnergy1: 0.82,
      micDomFreq2: 2400,
      micDomEnergy2: 0.82,
    }),
    sliderBackgroundLevel: 0.08,
  }, { pureEndpoints: true });
  const halves = [
    rendered.loaded.pixels.map((pixel, index) => pixel.nx < TITANIC_SIDE_SPLIT_X ? index : -1)
      .filter((index) => index >= 0),
    rendered.loaded.pixels.map((pixel, index) => pixel.nx >= TITANIC_SIDE_SPLIT_X ? index : -1)
      .filter((index) => index >= 0),
  ];
  for (const [side, indices] of halves.entries()) {
    const reds = indices.map((pixel) => pixelChannel(rendered.buffer, pixel, 0));
    const blues = indices.map((pixel) => pixelChannel(rendered.buffer, pixel, 2));
    assert.ok(Math.max(...reds) >= 80, `side ${side} lost lane-1 endpoint`);
    assert.ok(Math.max(...blues) >= 80, `side ${side} lost lane-2 endpoint`);
    assert.ok(reds.filter((value) => value >= 40).length >= 18,
      `side ${side} lane-1 band is not broadly visible`);
    assert.ok(blues.filter((value) => value >= 40).length >= 18,
      `side ${side} lane-2 band is not broadly visible`);
  }
});

test('silence is animated, fully covered, never black, and W=A on both models', async () => {
  const silence = signalOverrides({
    micDomFreq1: 0,
    micDomEnergy1: 0,
    micDomFreq2: 0,
    micDomEnergy2: 0,
    micLow: 0,
    micKick: 0,
  });
  for (const modelName of ['titanic', 'test_bench']) {
    const { host, loaded, result } = await compileOnModel(modelName);
    assert.equal(result.ok, true, `${modelName}: ${result.error}`);
    try {
      applyControls(host, result.handle, silence);
      const first = warmRender(host, result.handle, loaded.pixels.length, 80).buffer;
      const last = warmRender(host, result.handle, loaded.pixels.length, 320, 0.025, 2).buffer;
      for (const buffer of [first, last]) {
        const dark = [];
        for (let pixel = 0; pixel < loaded.pixels.length; pixel += 1) {
          if (pixelBrightness(buffer, pixel) === 0) dark.push(pixel);
          assert.equal(buffer[pixel * 6 + 3], buffer[pixel * 6 + 4],
            `${modelName}: W/A mismatch at pixel ${pixel}`);
        }
        assert.deepEqual(dark, [], `${modelName}: safety bed missed pixels ${dark.join(', ')}`);
      }
      assert.ok(rmsDifference(first, last) > 0.45,
        `${modelName}: silence field is not visibly animated`);
    } finally {
      host.destroy(result.handle);
      host.shutdown();
    }
  }
});

test('TE signs are 74/74 balanced, legible, endpoint-active, and full-surface dynamic', async () => {
  const overrides = {
    ...signalOverrides({
      micDomFreq1: 260,
      micDomEnergy1: 0.72,
      micDomFreq2: 2100,
      micDomEnergy2: 0.68,
    }),
    sliderIdentityLevel: 0.68,
  };
  const first = await renderModel('titanic', overrides, { pureEndpoints: true, frames: 120 });
  const last = await renderModel('titanic', overrides, { pureEndpoints: true, frames: 360 });
  const left = first.loaded.pixels.map((pixel, index) => pixel.group === 'TE Sign' ? index : -1)
    .filter((index) => index >= 0);
  const right = first.loaded.pixels.map((pixel, index) => pixel.group === 'TE Sign 2' ? index : -1)
    .filter((index) => index >= 0);
  assert.equal(left.length, 74);
  assert.equal(right.length, 74);
  for (const [name, indices] of [['left', left], ['right', right]]) {
    const levels = brightnesses(first.buffer, indices);
    assert.ok(Math.min(...levels) >= 8, `${name} sign lost its legibility floor`);
    assert.ok(Math.max(...levels) - Math.min(...levels) >= 20,
      `${name} sign does not use its full glyph surface`);
    assert.ok(indices.every((pixel) => pixelChannel(first.buffer, pixel, 0) > 0),
      `${name} sign lost endpoint 1 across its surface`);
    assert.ok(indices.every((pixel) => pixelChannel(first.buffer, pixel, 2) > 0),
      `${name} sign lost endpoint 2 across its surface`);
    assert.ok(rmsDifference(first.buffer, last.buffer, indices) > 0.35,
      `${name} sign does not animate across the glyph surface`);
  }
  const leftMean = mean(brightnesses(first.buffer, left));
  const rightMean = mean(brightnesses(first.buffer, right));
  assert.ok(Math.abs(leftMean - rightMean) / Math.max(leftMean, rightMean) <= 0.10,
    `TE signs are imbalanced: ${leftMean} vs ${rightMean}`);

  const coords = [];
  const metas = [];
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 11; column += 1) {
      const u = column / 10;
      const signY = row / 6;
      coords.push(leftSignPoint(u, signY));
      metas.push(syntheticMeta(FIX_TE_SIGN, row * 11 + column, {
        controllerId: 17,
        sectionId: 3,
      }));
    }
  }
  const grid = await renderSynthetic(coords, metas, overrides, { pureEndpoints: true });
  const rowMeans = Array.from({ length: 7 }, (_, row) => mean(
    Array.from({ length: 11 }, (_, column) => pixelBrightness(grid, row * 11 + column)),
  ));
  const columnMeans = Array.from({ length: 11 }, (_, column) => mean(
    Array.from({ length: 7 }, (_, row) => pixelBrightness(grid, row * 11 + column)),
  ));
  assert.ok(Math.max(...rowMeans) - Math.min(...rowMeans) >= 3,
    'Identity output does not materially use glyph-local Y');
  assert.ok(Math.max(...columnMeans) - Math.min(...columnMeans) >= 12,
    'Identity output does not materially project longitudinal bands across the glyph');
});

test('LOW sustains and KICK pulses only PAR Organs, spatially near the DOM bands, then releases', async () => {
  const commonSignals = {
    micDomFreq1: 430,
    micDomEnergy1: 0.70,
    micDomFreq2: 2600,
    micDomEnergy2: 0.64,
  };
  const quiet = await renderModel('titanic', signalOverrides({
    ...commonSignals,
    micLow: 0,
    micKick: 0,
  }), { pureEndpoints: true });
  const low = await renderModel('titanic', signalOverrides({
    ...commonSignals,
    micLow: 1,
    micKick: 0,
  }), { pureEndpoints: true });
  const kick = await renderModel('titanic', signalOverrides({
    ...commonSignals,
    micLow: 0,
    micKick: 1,
  }), { pureEndpoints: true });
  const organs = quiet.loaded.metaArray.map((meta, index) => meta.fixtureTypeId === FIX_PAR ? index : -1)
    .filter((index) => index >= 0);
  const nonOrgans = quiet.loaded.metaArray
    .map((meta, index) => meta.fixtureTypeId !== FIX_PAR ? index : -1)
    .filter((index) => index >= 0);
  const deltaMean = (active, base, indices) => mean(indices.map(
    (pixel) => pixelBrightness(active.buffer, pixel) - pixelBrightness(base.buffer, pixel),
  ));
  assert.ok(deltaMean(low, quiet, organs) >= 12, 'LOW did not sustain a material Organ breath');
  assert.ok(deltaMean(kick, quiet, organs) >= 8, 'KICK did not add a material Organ heartbeat');
  assert.ok(deltaMean(kick, quiet, nonOrgans) <= 1,
    'KICK escaped the PAR material and became a whole-rig flash');
  const kickDeltas = organs.map((pixel) => ({
    delta: pixelBrightness(kick.buffer, pixel) - pixelBrightness(quiet.buffer, pixel),
    u: titanicU(quiet.loaded.pixels[pixel]),
  }));
  assert.ok(Math.max(...kickDeltas.map((item) => item.delta))
    - Math.min(...kickDeltas.map((item) => item.delta)) >= 4,
  'KICK is global across Organs instead of spatially agreeing with the bands');

  const { host, loaded, result } = await compileOnModel('titanic');
  assert.equal(result.ok, true, result.error);
  try {
    applyControls(host, result.handle, signalOverrides({
      ...commonSignals,
      micLow: 0,
      micKick: 0,
    }), true);
    let rendered = warmRender(host, result.handle, loaded.pixels.length, 220);
    const baseline = rendered.buffer;
    setControl(host, result.handle, 'sliderOrganKick', modulationValue('micKick', 1).value);
    rendered = warmRender(host, result.handle, loaded.pixels.length, 12, 0.025, rendered.elapsed);
    const pulse = rendered.buffer;
    setControl(host, result.handle, 'sliderOrganKick', modulationValue('micKick', 0).value);
    rendered = warmRender(host, result.handle, loaded.pixels.length, 90, 0.025, rendered.elapsed);
    const released = rendered.buffer;
    assert.ok(rmsDifference(pulse, baseline, organs) > 4, 'KICK attack is not visible on Organs');
    assert.ok(rmsDifference(released, baseline, organs) < rmsDifference(pulse, baseline, organs) * 0.35,
      'KICK does not release gracefully back toward the sustained Organ state');
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
});

test('test_bench uses its explicit x geometry and preserves an independent monotonic band sweep', async () => {
  const low = await renderModel('test_bench', {
    ...signalOverrides({
      micDomFreq1: 90,
      micDomEnergy1: 0.90,
      micDomFreq2: 0,
      micDomEnergy2: 0,
    }),
    sliderBackgroundLevel: 0,
    sliderSpin: 0,
  }, { pureEndpoints: true });
  const high = await renderModel('test_bench', {
    ...signalOverrides({
      micDomFreq1: 4200,
      micDomEnergy1: 0.90,
      micDomFreq2: 0,
      micDomEnergy2: 0,
    }),
    sliderBackgroundLevel: 0,
    sliderSpin: 0,
  }, { pureEndpoints: true });
  const bars = low.loaded.metaArray.map((meta, index) => meta.fixtureTypeId === FIX_BAR_18 ? index : -1)
    .filter((index) => index >= 0);
  const redCentroid = (rendered) => {
    const values = bars.map((pixel) => pixelChannel(rendered.buffer, pixel, 0));
    const floor = Math.min(...values);
    const weights = values.map((value) => Math.max(0, value - floor));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return weights.reduce(
      (sum, weight, index) => sum + weight * rendered.loaded.pixels[bars[index]].nx,
      0,
    ) / total;
  };
  assert.ok(redCentroid(high) > redCentroid(low) + 0.28,
    `test_bench explicit x sweep did not move monotonically: ${redCentroid(low)} -> ${redCentroid(high)}`);
});

test('Spin zero holds the original orientation while Spin one rotates the shared hull field', async () => {
  const { host, loaded, result } = await compileOnModel('titanic');
  assert.equal(result.ok, true, result.error);
  try {
    const common = {
      ...signalOverrides({
        micDomFreq1: 420,
        micDomEnergy1: 0.90,
        micDomFreq2: 2300,
        micDomEnergy2: 0.86,
      }),
      sliderBackgroundLevel: 0,
      sliderSpin: 0,
    };
    applyControls(host, result.handle, common, true);
    let rendered = warmRender(host, result.handle, loaded.pixels.length, 80);
    const heldStart = rendered.buffer;
    rendered = warmRender(host, result.handle, loaded.pixels.length, 240, 0.025, rendered.elapsed);
    const heldEnd = rendered.buffer;
    const heldDifference = rmsDifference(heldStart, heldEnd);
    setControl(host, result.handle, 'sliderSpin', 1);
    rendered = warmRender(host, result.handle, loaded.pixels.length, 240, 0.025, rendered.elapsed);
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

test('live edits stay continuous and the large wrapped phase has no seam, blackout, or W/A drift', async () => {
  const { coords, metas } = longitudinalGrid();
  const { host, result } = await compileSynthetic(coords, metas);
  assert.equal(result.ok, true, result.error);
  try {
    applyControls(host, result.handle);
    let rendered = warmRender(host, result.handle, coords.length, 160);
    let prior = rendered.buffer;
    let elapsed = rendered.elapsed;
    for (const [control, value] of [
      ['sliderLocalSpeed', 1],
      ['sliderLevel', 0.9],
      ['sliderMinimumWidth', 0.85],
      ['sliderEnergyWidth', 0.9],
      ['sliderBackgroundLevel', 0.85],
      ['sliderOrganEnergy', 0.8],
      ['sliderOrganKick', 0.8],
      ['sliderIdentityLevel', 0.85],
      ['sliderDomFreq1', 0.6],
      ['sliderDomEnergy1', 0.95],
      ['sliderDomFreq2', 0.2],
      ['sliderDomEnergy2', 0.9],
      ['sliderSpin', 1],
    ]) {
      setControl(host, result.handle, control, value);
      elapsed += 0.025;
      const edited = renderFrame(host, result.handle, coords.length, elapsed);
      const editRms = rmsDifference(prior, edited);
      assert.ok(editRms < 45,
        `${control} caused a live-edit teleport/discontinuity: RMS ${editRms}`);
      prior = edited;
    }

    for (const longElapsed of [9998.0, 9999.975, 10000.0, 10000.025, 20000.025, 100000.025]) {
      const before = renderFrame(host, result.handle, coords.length, longElapsed);
      const after = renderFrame(host, result.handle, coords.length, longElapsed + 0.025);
      assert.ok(Math.max(...brightnesses(after)) > 0, `long-run blackout at ${longElapsed}`);
      assert.ok(rmsDifference(before, after) < 45, `long-run seam at ${longElapsed}`);
      for (let pixel = 0; pixel < coords.length; pixel += 1) {
        assert.equal(after[pixel * 6 + 3], after[pixel * 6 + 4],
          `long-run W/A mismatch at ${longElapsed}, pixel ${pixel}`);
      }
    }
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
});

test('warmed Titanic render remains within the 40 fps frame budget', async () => {
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
    assert.ok(average < 25, `average Titanic frame exceeds 40 fps budget: ${average} ms`);
    assert.ok(p95 < 25, `p95 Titanic frame exceeds 40 fps budget: ${p95} ms`);
  } finally {
    host.destroy(result.handle);
    host.shutdown();
  }
});
