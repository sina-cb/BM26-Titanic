// white_day_contract.test.js — daylight sparkle package acceptance.
//
// Daylight art direction is intentionally different from the night White
// family: crisp points may be bright, while total output stays low through
// sparse spatial/temporal duty cycle. The playlist remains a draft and is not
// a Timeline authorization.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const SCENES = ['titanic', 'test_bench'];
const EXISTING_IDS = [
  'white_only/03_silver_current',
  'white_only/04_frost_lattice',
  'white_only/16_frosted_panes',
  'white_only/06_lighthouse_watch',
  'white_only/11_pale_garden',
  'white_only/12_porthole_liner',
  'white_only/15_ivory_louvers',
  'white_only/17_moon_pearls',
  'white_only/19_silver_frames',
  'white_only/20_frost_branch',
];
const NEW_IDS = [
  'white_only/21_playa_glint_field',
  'white_only/22_porthole_wink',
  'white_only/23_deck_hull_exchange',
  'white_only/24_constellation_drift',
  'white_only/25_bow_stern_hello',
];
const EXPECTED_IDS = [...EXISTING_IDS, ...NEW_IDS];
// Review scalar only — this is not a Timeline/master authorization. It pins
// the proposed midpoint so broad low bodies disappear in daylight while crisp
// points survive for physical hull judgment.
const M_DAY_SPARKLE_REVIEW = 0.18;

function playlistPath(scene) {
  return path.join(REPO_DIR, 'simulation', 'scenes', scene, 'playlists', 'white_day.yaml');
}

function patternPath(id) {
  return path.join(PATTERNS_DIR, `${id}.js`);
}

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider\w+)\s*\(/g)]
    .map((match) => match[1]);
}

function instrumentOf(pixel) {
  if (pixel.fixtureType === 'ShehdsBar') return 'Hull Canvas';
  if (pixel.fixtureType === 'UkingPar') return 'Organs';
  if (pixel.fixtureType === 'VintageLed') return 'Jewelry';
  if (/^TeSign/.test(pixel.fixtureType)) return 'Identity';
  if (pixel.type === 'led') return 'Silhouette';
  throw new Error(`unclassified Titanic pixel ${pixel.i}: ${pixel.fixtureType}`);
}

async function renderPattern(id, modelName, defaults, seconds = 45) {
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
  const result = host.compile(fs.readFileSync(patternPath(id), 'utf8'));
  assert.equal(result.ok, true, `${id}/${modelName}: ${result.error}`);

  const exports = new Map((host.getExports(result.handle) || [])
    .filter((entry) => entry.name.startsWith('slider'))
    .map((entry) => [entry.name, entry.id]));
  for (const [name, value] of Object.entries(defaults)) {
    assert.ok(exports.has(name), `${id}/${modelName}: missing export ${name}`);
    host.setControl(result.handle, exports.get(name), value);
  }

  const frame = new Uint8Array(loaded.pixels.length * 6);
  const frames = [];
  const steps = Math.round(seconds / 0.05);
  for (let tick = 1; tick <= steps; tick += 1) {
    host.beginFrame(result.handle, tick * 0.05);
    const rendered = host.renderAll6ch(result.handle, frame);
    if (tick % 5 === 0) frames.push(Uint8Array.from(rendered));
  }
  host.destroy(result.handle);
  host.shutdown();
  return { frames, pixels: loaded.pixels };
}

test('white_day is exactly ten re-seated sources plus five new drafts', () => {
  const documents = SCENES.map((scene) => yaml.load(
    fs.readFileSync(playlistPath(scene), 'utf8')));
  for (const document of documents) {
    assert.equal(document.schemaVersion, 1);
    assert.equal(document.name, 'white_day');
    assert.deepEqual(document.entries.map((entry) => entry.pattern), EXPECTED_IDS);
    assert.equal(new Set(document.entries.map((entry) => entry.id)).size, 15,
      'entry ids must be unique');
    assert.equal(new Set(document.entries.map((entry) => entry.pattern)).size, 15,
      'pattern references must be unique');
  }
  assert.equal(fs.readFileSync(playlistPath('titanic'), 'utf8'),
    fs.readFileSync(playlistPath('test_bench'), 'utf8'),
    'Titanic and test_bench tunes must remain byte-identical');
});

test('every entry resolves and saves every control in declaration order', () => {
  const document = yaml.load(fs.readFileSync(playlistPath('titanic'), 'utf8'));
  for (const entry of document.entries) {
    assert.ok(fs.existsSync(patternPath(entry.pattern)), `${entry.pattern}: source missing`);
    const source = fs.readFileSync(patternPath(entry.pattern), 'utf8');
    assert.deepEqual(Object.keys(entry.defaults), sliderNames(source),
      `${entry.pattern}: defaults must exactly follow slider declaration order`);
    assert.deepEqual(entry.modulations, [], `${entry.pattern}: daylight is free-running`);
    assert.deepEqual(entry.midiMappings, [], `${entry.pattern}: no implicit performance mapping`);
    for (const value of Object.values(entry.defaults)) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1,
        `${entry.pattern}: invalid saved value ${value}`);
    }
  }
});

test('five new patterns are registered drafts with unique source identities', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'));
  const allHashes = new Map();
  for (const id of EXPECTED_IDS) {
    const source = fs.readFileSync(patternPath(id), 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    assert.equal(allHashes.has(hash), false,
      `${id}: source duplicates ${allHashes.get(hash) || 'another playlist entry'}`);
    allHashes.set(hash, id);
  }
  for (const id of NEW_IDS) {
    assert.equal(manifest.filter((entry) => entry === id).length, 1,
      `${id}: manifest registration must occur exactly once`);
    const source = fs.readFileSync(patternPath(id), 'utf8');
    assert.match(source, /DRAFT — pending operator review/);
    assert.doesNotMatch(source, /AUDIO_MODULATION_V1|mic(?:Low|Mid|High|Kick|Flux)/,
      `${id}: daylight baseline must be silence-safe`);
  }
});

for (const modelName of ['titanic', 'test_bench']) {
  test(`all white_day entries compile offline on ${modelName}`, async () => {
    const document = yaml.load(fs.readFileSync(playlistPath('titanic'), 'utf8'));
    for (const entry of document.entries) {
      const rendered = await renderPattern(entry.pattern, modelName, entry.defaults, 1);
      assert.ok(rendered.frames.length > 0, `${entry.pattern}/${modelName}: no frames`);
    }
  });
}

test('new daylight motifs use bright points and low whole-ship duty cycle', async () => {
  const document = yaml.load(fs.readFileSync(playlistPath('titanic'), 'utf8'));
  const entries = new Map(document.entries.map((entry) => [entry.pattern, entry]));
  for (const id of NEW_IDS) {
    const { frames, pixels } = await renderPattern(id, 'titanic', entries.get(id).defaults);
    let peak = 0;
    let bright = 0;
    let lit = 0;
    let total = 0;
    let sum = 0;
    const served = new Set();
    for (const frame of frames) {
      for (let pixel = 0; pixel < pixels.length; pixel += 1) {
        const offset = pixel * 6;
        const value = frame[offset];
        peak = Math.max(peak, value);
        if (value >= 128) bright += 1;
        if (value >= 16) lit += 1;
        sum += value;
        total += 1;
        if (value >= 64) served.add(instrumentOf(pixels[pixel]));
      }
    }
    const brightDuty = bright / total;
    const litDuty = lit / total;
    const mean = sum / total;
    assert.ok(peak >= 180, `${id}: peak ${peak} is too muddy for daylight glints`);
    assert.ok(brightDuty >= 0.0004,
      `${id}: bright duty ${(brightDuty * 100).toFixed(3)}% is too rare to read`);
    assert.ok(brightDuty <= 0.12,
      `${id}: bright duty ${(brightDuty * 100).toFixed(1)}% is too broad`);
    assert.ok(litDuty <= 0.24,
      `${id}: lit duty ${(litDuty * 100).toFixed(1)}% reads as illumination, not sparkle`);
    assert.ok(mean <= 32, `${id}: mean RGB byte ${mean.toFixed(1)} is too high for daylight`);
    assert.deepEqual([...served].sort(),
      ['Hull Canvas', 'Identity', 'Jewelry', 'Organs', 'Silhouette'].sort(),
      `${id}: daylight motion must visit every ship instrument over the review window`);
  }
});

test('all fifteen saved tunes remain sparkle-led at the proposed review master', async () => {
  const document = yaml.load(fs.readFileSync(playlistPath('titanic'), 'utf8'));
  for (const entry of document.entries) {
    const { frames } = await renderPattern(entry.pattern, 'titanic', entry.defaults, 12);
    let peak = 0;
    let visible = 0;
    let sum = 0;
    let total = 0;
    for (const frame of frames) {
      for (let offset = 0; offset < frame.length; offset += 6) {
        const value = frame[offset] * M_DAY_SPARKLE_REVIEW;
        peak = Math.max(peak, value);
        if (value >= 36) visible += 1;
        sum += value;
        total += 1;
      }
    }
    const visibleDuty = visible / total;
    const mean = sum / total;
    assert.ok(peak >= 27,
      `${entry.pattern}: scaled peak ${peak.toFixed(1)} loses its daylight glint`);
    assert.ok(visibleDuty <= 0.30,
      `${entry.pattern}: ${(visibleDuty * 100).toFixed(1)}% visible duty is too broad at review master`);
    assert.ok(mean <= 20,
      `${entry.pattern}: scaled mean ${mean.toFixed(1)} is too high for a daytime sparkle bed`);
  }
});

test('new daylight motifs are visibly animated and mutually distinct', async () => {
  const document = yaml.load(fs.readFileSync(playlistPath('titanic'), 'utf8'));
  const entries = new Map(document.entries.map((entry) => [entry.pattern, entry]));
  const signatures = new Map();
  for (const id of NEW_IDS) {
    const { frames, pixels } = await renderPattern(id, 'titanic', entries.get(id).defaults);
    const mean = new Float64Array(pixels.length);
    const span = new Float64Array(pixels.length);
    const lows = new Uint8Array(pixels.length).fill(255);
    const highs = new Uint8Array(pixels.length);
    for (const frame of frames) {
      for (let pixel = 0; pixel < pixels.length; pixel += 1) {
        const value = frame[pixel * 6];
        mean[pixel] += value / frames.length;
        lows[pixel] = Math.min(lows[pixel], value);
        highs[pixel] = Math.max(highs[pixel], value);
      }
    }
    let animated = 0;
    let animatedPixels = 0;
    for (let pixel = 0; pixel < pixels.length; pixel += 1) {
      span[pixel] = highs[pixel] - lows[pixel];
      animated += span[pixel];
      if (span[pixel] >= 64) animatedPixels += 1;
    }
    assert.ok(animated / pixels.length >= 2,
      `${id}: average dynamic span ${(animated / pixels.length).toFixed(1)} is not visibly alive`);
    assert.ok(animatedPixels / pixels.length >= 0.01,
      `${id}: only ${((animatedPixels / pixels.length) * 100).toFixed(1)}% of pixels carry a crisp moving point`);
    signatures.set(id, { mean, span });
  }

  for (let left = 0; left < NEW_IDS.length; left += 1) {
    for (let right = left + 1; right < NEW_IDS.length; right += 1) {
      const a = signatures.get(NEW_IDS[left]);
      const b = signatures.get(NEW_IDS[right]);
      let distance = 0;
      for (let pixel = 0; pixel < a.mean.length; pixel += 1) {
        distance += Math.abs(a.mean[pixel] - b.mean[pixel]);
        distance += Math.abs(a.span[pixel] - b.span[pixel]);
      }
      distance /= a.mean.length;
      assert.ok(distance >= 8,
        `${NEW_IDS[left]} vs ${NEW_IDS[right]}: signature distance ${distance.toFixed(1)}`);
    }
  }
});
