// uv_only_contract.test.js — collection-wide contract for the UV ONLY family
// (wave _313): the legacy spike 65_uv_only plus patterns/uv_only/01..19.
//
// The family's promises, each silently breakable by an ordinary edit:
//   1. UV PURITY — R = G = B = W = A = 0 on every pixel of every frame. One
//      stray fill and the "what does the violet lane alone look like" answer
//      the operator stands in front of is a lie.
//   2. HARDWARE TRUTH — only the ShehdsBars (FIX_BAR_18) and UkingPars
//      (FIX_PAR) carry a violet die. The 19 new patterns write U strictly on
//      those fixtures so sim, gallery and playa agree (65_uv_only predates
//      this and is grandfathered: it writes U everywhere and sacn_mapper
//      drops it on incapable fixtures).
//   3. INTENSITY TEXTURE — violet-intensity ART, not a flat UV wash: a real
//      mid field, crisp peaks, and only sparing, moving darkness. UV reads
//      dim at distance, so a parked dark region is a hole in the rig.
//   4. The family authority block is byte-identical across all 19 sources.
//   5. MFT conventions: localSpeed first, direction second, level last.
//
// All coverage sampling uses dt < 0.1 s per beginFrame (the engine's dt-clamp
// makes coarser sweeps undersample — see the _306 measurement note).

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

import { PlaylistManager } from '../../lib/playlist_manager.js';
import { WasmHost } from '../../lib/wasm_host.js';
import { buildFixtureTypeIds, fixtureTypeId } from '../../lib/fixture_type_constants.js';
import { parseAudioModSpec } from '../../tools/audio_mod_spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const UV_DIR = path.join(PATTERNS_DIR, 'uv_only');
const MANIFEST_PATH = path.join(PATTERNS_DIR, 'manifest.json');
const SCENES = ['titanic', 'test_bench'];

// Reference cadence: global speed 0.25 -> engine time factor 0.25 * 16^0.25
// = 0.5; a 25 ms wall frame therefore advances pattern time 12.5 ms — well
// under the 0.1 s dt clamp, so nothing is undersampled.
const FRAME_SECONDS = 0.025 * 0.25 * Math.pow(16, 0.25);

const SPIKE_ID = '65_uv_only';
const NEW_IDS = [
  'uv_only/01_blacklight_tide',
  'uv_only/02_crossing_uv_beacons',
  'uv_only/03_violet_maelstrom',
  'uv_only/04_cathedral_uv_ribs',
  'uv_only/05_breathing_violet_horizon',
  'uv_only/06_uv_orbit_rings',
  'uv_only/07_violet_eclipse',
  'uv_only/08_uv_broadside_call',
  'uv_only/09_uv_lighthouse',
  'uv_only/10_violet_caustics',
  'uv_only/11_uv_aurora_breath',
  'uv_only/12_uv_rain',
  'uv_only/13_violet_reaction',
  'uv_only/14_uv_lattice_drift',
  'uv_only/15_violet_breathing',
  'uv_only/16_uv_starfield',
  'uv_only/17_violet_mantas',
  'uv_only/18_uv_ink_plumes',
  'uv_only/19_violet_frond_garden',
];
const ALL_IDS = [SPIKE_ID, ...NEW_IDS];

function playlistPath(scene) {
  return path.join(REPO_DIR, 'simulation', 'scenes', scene, 'playlists', 'uv_only.yaml');
}

function readSource(patternId) {
  return fs.readFileSync(path.join(PATTERNS_DIR, `${patternId}.js`), 'utf8');
}

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

const playlist = yaml.load(fs.readFileSync(playlistPath('titanic'), 'utf8'));
const entriesByPattern = new Map(playlist.entries.map((entry) => [entry.pattern, entry]));

const modelCache = new Map();
async function loadModel(modelName) {
  if (!modelCache.has(modelName)) {
    const model = await import(
      pathToFileURL(path.join(ENGINE_DIR, 'models', `${modelName}.js`)).href);
    modelCache.set(modelName, model.pixels);
  }
  return modelCache.get(modelName);
}

async function compileOnModel(patternId, modelName, overrides = {}) {
  const pixels = await loadModel(modelName);
  const host = new WasmHost();
  await host.init(pixels.length);
  host.setCoords(pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(pixels.map((pixel) => ({
    controllerId: pixel.cId || 0,
    sectionId: pixel.sId || 0,
    fixtureId: pixel.fId || 0,
    viewMask: pixel.vMask || 0,
    fixtureTypeId: fixtureTypeId(pixel.fixtureType),
    pixelLocalIndex: pixel.localIndex || 0,
    viewMaskHi: pixel.vMaskHi || 0,
  })));
  host.setFixtureConstants(buildFixtureTypeIds(pixels));
  const source = readSource(patternId);
  const compiled = host.compile(source);
  assert.equal(compiled.ok, true, `${patternId}/${modelName}: ${compiled.error}`);
  const entry = entriesByPattern.get(patternId);
  assert.ok(entry, `${patternId}: not in uv_only playlist`);
  const controls = host.getExports(compiled.handle);
  for (const name of sliderNames(source)) {
    const value = Object.prototype.hasOwnProperty.call(overrides, name)
      ? overrides[name] : entry.defaults[name];
    assert.ok(Number.isFinite(value), `${patternId}: missing finite saved ${name}`);
    const control = controls.find((item) => item.name === name);
    assert.ok(control, `${patternId}: missing control export ${name}`);
    host.setControl(compiled.handle, control.id, value);
  }
  return { host, pixels, handle: compiled.handle };
}

function capableMask(pixels) {
  return pixels.map((pixel) => Boolean(pixel.channels)
    && Object.prototype.hasOwnProperty.call(pixel.channels, 'u'));
}

function renderRun(host, handle, pixelCount, steps, frameSeconds, keepSteps) {
  const kept = new Map();
  const buffer = new Uint8Array(pixelCount * 6);
  let time = 0;
  for (let step = 0; step < steps; step += 1) {
    time += frameSeconds;
    host.beginFrame(handle, time);
    const frame = host.renderAll6ch(handle, buffer).slice();
    if (keepSteps.has(step)) kept.set(step, frame);
  }
  return kept;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

// ── 1. Registration, playlist, and source-level contracts ───────────────────

test('uv_only family is complete, registered, and saved in one ordered arc', () => {
  const titanicBytes = fs.readFileSync(playlistPath('titanic'));
  const benchBytes = fs.readFileSync(playlistPath('test_bench'));
  assert.deepEqual(titanicBytes, benchBytes,
    'uv_only.yaml must be byte-identical across both scenes');

  assert.equal(playlist.schemaVersion, 1);
  assert.equal(playlist.name, 'uv_only');
  assert.deepEqual(playlist.entries.map((entry) => entry.pattern), ALL_IDS,
    'uv_only must carry the spike plus the 19 new patterns in numbered order');

  const discovered = fs.readdirSync(UV_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => `uv_only/${name.replace(/\.js$/, '')}`);
  assert.deepEqual(discovered, NEW_IDS, 'patterns/uv_only/ holds exactly the 19 sources');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  for (const patternId of ALL_IDS) {
    assert.equal(manifest.filter((item) => item === patternId).length, 1,
      `${patternId}: must appear exactly once in patterns/manifest.json`);
  }

  for (const entry of playlist.entries) {
    const source = readSource(entry.pattern);
    assert.deepEqual(Object.keys(entry.defaults), sliderNames(source),
      `${entry.pattern}: save every control in declaration order`);
    for (const [name, value] of Object.entries(entry.defaults)) {
      assert.equal(Number.isFinite(value), true, `${entry.pattern}/${name}: non-finite tune`);
      assert.ok(value >= 0 && value <= 1, `${entry.pattern}/${name}: ${value} outside [0, 1]`);
    }
    assert.deepEqual(entry.modulations, [], `${entry.pattern}: UV review must be static`);
    assert.deepEqual(entry.midiMappings, [], `${entry.pattern}: UV review must not bind MIDI`);
  }

  for (const scene of SCENES) {
    const manager = new PlaylistManager(
      path.join(REPO_DIR, 'simulation', 'scenes', scene, 'playlists'), PATTERNS_DIR);
    const loaded = manager.load('uv_only');
    assert.equal(loaded.entries.some((entry) => entry._missing), false,
      `${scene}/uv_only: unresolved pattern reference`);
  }
});

test('the 19 new sources share one byte-identical UV authority block', () => {
  const BLOCK_START = '// ── UV AUTHORITY';
  const BLOCK_END = '// ── end UV AUTHORITY ──';
  const digests = new Set();
  for (const patternId of NEW_IDS) {
    const source = readSource(patternId);
    const start = source.indexOf(BLOCK_START);
    const end = source.indexOf(BLOCK_END);
    assert.ok(start >= 0 && end > start, `${patternId}: missing UV authority block`);
    const block = source.slice(start, end + BLOCK_END.length);
    digests.add(crypto.createHash('md5').update(block).digest('hex'));
    // The authority owns the ONLY rgbwau call: everything funnels through
    // emitUv, which zeroes the non-violet lanes and masks incapable fixtures.
    const outside = source.slice(0, start) + source.slice(end + BLOCK_END.length);
    assert.equal(/\brgbwau\s*\(/.test(outside), false,
      `${patternId}: rgbwau called outside the UV authority block`);
    assert.ok(/\bemitUv\s*\(/.test(outside), `${patternId}: never calls emitUv`);
  }
  assert.equal(digests.size, 1,
    `UV authority block drifted: ${digests.size} distinct hashes across the family`);
});

for (const patternId of NEW_IDS) {
  test(`${patternId}: source conventions (MFT order, purity by construction)`, () => {
    const source = readSource(patternId);
    assert.equal(/export\s+function\s+colorPalette[12]\b/.test(source), false,
      `${patternId}: a palette picker would let the CPC re-colour a UV pattern`);
    assert.equal(/export\s+var\s+cp[12][HSV]\b/.test(source), false,
      `${patternId}: declares cp palette vars`);
    assert.equal(/^\s*(rgb|hsv)\s*\(/m.test(source), false,
      `${patternId}: bare rgb()/hsv() call`);
    // Task #69: multi-line chained sums with leading `+` continuation lines
    // miscompile in the VM. Named-variable accumulation only.
    assert.equal(/^\s*\+/m.test(source), false,
      `${patternId}: leading-+ continuation line (VM miscompile risk, task #69)`);

    const order = sliderNames(source);
    assert.equal(order[0], 'sliderLocalSpeed', `${patternId}: localSpeed must be first`);
    assert.equal(order[1], 'sliderDirection', `${patternId}: direction must be second`);
    assert.equal(order[order.length - 1], 'sliderLevel', `${patternId}: level must be last`);
    assert.ok(order.length <= 12, `${patternId}: ${order.length} sliders exceeds one MFT bank`);

    const spec = parseAudioModSpec(source, patternId);
    assert.ok(spec, `${patternId}: missing AUDIO_MODULATION_V1 block`);
    const primary = spec.mappings.find((mapping) => mapping.slider === 'sliderLevel');
    assert.ok(primary && primary.signal === 'micLow',
      `${patternId}: sliderLevel must map to micLow as the PRIMARY audio target`);
    for (const mapping of spec.mappings) {
      assert.ok(order.includes(mapping.slider),
        `${patternId}: audio maps unknown slider ${mapping.slider}`);
    }
  });
}

// ── 2. UV purity + hardware-truth on BOTH models ─────────────────────────────

for (const modelName of SCENES) {
  test(`UV purity holds for all 20 on ${modelName}`, { timeout: 600_000 }, async () => {
    for (const patternId of ALL_IDS) {
      const { host, pixels, handle } = await compileOnModel(patternId, modelName);
      try {
        const capable = capableMask(pixels);
        let peakU = 0;
        const buffer = new Uint8Array(pixels.length * 6);
        let time = 0;
        for (let step = 0; step < 400; step += 1) {
          time += FRAME_SECONDS;
          host.beginFrame(handle, time);
          const frame = host.renderAll6ch(handle, buffer);
          for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
            const offset = pixelIndex * 6;
            assert.equal(frame[offset], 0, `${patternId}/${modelName}: R written`);
            assert.equal(frame[offset + 1], 0, `${patternId}/${modelName}: G written`);
            assert.equal(frame[offset + 2], 0, `${patternId}/${modelName}: B written`);
            assert.equal(frame[offset + 3], 0, `${patternId}/${modelName}: W written`);
            assert.equal(frame[offset + 4], 0, `${patternId}/${modelName}: A written`);
            const violet = frame[offset + 5];
            if (violet > peakU) peakU = violet;
            if (!capable[pixelIndex] && patternId !== SPIKE_ID) {
              assert.equal(violet, 0,
                `${patternId}/${modelName}: U written on a fixture with no violet die`);
            }
          }
        }
        assert.ok(peakU >= 160,
          `${patternId}/${modelName}: violet lane peaks at only ${peakU}`);
      } finally {
        host.destroy(handle);
        host.shutdown();
      }
    }
  });
}

// ── 3. Intensity texture, sparse dark, animation (titanic, capable subset) ──

test('every UV pattern is textured violet art, never a flat wash, never parked dark',
  { timeout: 600_000 }, async () => {
    for (const patternId of ALL_IDS) {
      const { host, pixels, handle } = await compileOnModel(patternId, 'titanic');
      try {
        const capable = capableMask(pixels);
        const capableCount = capable.filter(Boolean).length;
        assert.equal(capableCount, 400, 'titanic UV census moved — re-derive the gate');
        const maxPerPixel = new Float64Array(pixels.length);
        let darkSamples = 0;
        let midSamples = 0;
        let hotSamples = 0;
        let totalSamples = 0;
        let peakU = 0;
        const spreads = [];
        const snapshots = [];
        const stepChanges = [];
        let previous = null;
        const buffer = new Uint8Array(pixels.length * 6);
        let time = 0;
        for (let step = 0; step < 800; step += 1) {
          time += FRAME_SECONDS;
          host.beginFrame(handle, time);
          const frame = host.renderAll6ch(handle, buffer).slice();
          let sum = 0;
          let sumSquares = 0;
          for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
            if (!capable[pixelIndex]) continue;
            const violet = frame[pixelIndex * 6 + 5];
            totalSamples += 1;
            if (violet < 8) darkSamples += 1;
            else if (violet >= 48 && violet < 192) midSamples += 1;
            if (violet >= 208) hotSamples += 1;
            if (violet > peakU) peakU = violet;
            if (violet > maxPerPixel[pixelIndex]) maxPerPixel[pixelIndex] = violet;
            sum += violet;
            sumSquares += violet * violet;
          }
          const mean = sum / capableCount;
          spreads.push(Math.sqrt(Math.max(0, sumSquares / capableCount - mean * mean)));
          if (step === 100 || step === 400 || step === 780) snapshots.push(frame);
          // ~1 s apart at the reference cadence (80 frames x 12.5 ms).
          if (step % 80 === 0) {
            if (previous) {
              let changed = 0;
              for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
                if (!capable[pixelIndex]) continue;
                if (Math.abs(frame[pixelIndex * 6 + 5] - previous[pixelIndex * 6 + 5]) >= 8) {
                  changed += 1;
                }
              }
              stepChanges.push(changed / capableCount);
            }
            previous = frame;
          }
        }

        const darkFraction = darkSamples / totalSamples;
        const midFraction = midSamples / totalSamples;
        const hotFraction = hotSamples / totalSamples;
        assert.ok(darkFraction <= 0.35,
          `${patternId}: dark fraction ${darkFraction.toFixed(3)} — too much darkness for a UV night rig`);
        assert.ok(midFraction >= 0.10,
          `${patternId}: mid fraction ${midFraction.toFixed(3)} — no violet body between floor and peaks`);
        assert.ok(hotFraction <= 0.30,
          `${patternId}: hot fraction ${hotFraction.toFixed(3)} — reads as a flat blazing wash`);
        assert.ok(peakU >= 190, `${patternId}: peak U ${peakU} — never reaches a crisp peak`);
        assert.ok(median(spreads) >= 10,
          `${patternId}: median spatial stddev ${median(spreads).toFixed(1)} — flat field`);
        let neverLit = 0;
        for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
          if (capable[pixelIndex] && maxPerPixel[pixelIndex] < 24) neverLit += 1;
        }
        assert.equal(neverLit, 0,
          `${patternId}: ${neverLit} capable pixels stay dark forever (parked dark region)`);

        const snapshotDelta = (left, right) => {
          let changed = 0;
          for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
            if (!capable[pixelIndex]) continue;
            if (Math.abs(left[pixelIndex * 6 + 5] - right[pixelIndex * 6 + 5]) >= 8) changed += 1;
          }
          return changed / capableCount;
        };
        assert.ok(snapshotDelta(snapshots[0], snapshots[1]) >= 0.03,
          `${patternId}: early/mid snapshots nearly identical`);
        assert.ok(snapshotDelta(snapshots[1], snapshots[2]) >= 0.03,
          `${patternId}: mid/late snapshots nearly identical`);
        assert.ok(median(stepChanges) >= 0.005,
          `${patternId}: median 1 s change ${median(stepChanges).toFixed(4)} — static look`);
      } finally {
        host.destroy(handle);
        host.shutdown();
      }
    }
  });

// ── 4. Silence floor: the audio-driven level at its range minimum ───────────

test('at the audio silence floor every pattern stays lit and alive',
  { timeout: 600_000 }, async () => {
    for (const patternId of ALL_IDS) {
      const source = readSource(patternId);
      const spec = parseAudioModSpec(source, patternId);
      const primary = spec ? spec.mappings.find((m) => m.slider === 'sliderLevel') : null;
      const floor = primary ? Math.min(primary.min, primary.max) : 0.35;
      const { host, pixels, handle } = await compileOnModel(
        patternId, 'titanic', { sliderLevel: floor });
      try {
        const capable = capableMask(pixels);
        const buffer = new Uint8Array(pixels.length * 6);
        const kept = [];
        let time = 0;
        for (let step = 0; step < 400; step += 1) {
          time += FRAME_SECONDS;
          host.beginFrame(handle, time);
          const frame = host.renderAll6ch(handle, buffer);
          let peak = 0;
          for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
            if (!capable[pixelIndex]) continue;
            const violet = frame[pixelIndex * 6 + 5];
            if (violet > peak) peak = violet;
          }
          assert.ok(peak >= 16,
            `${patternId}: frame ${step} nearly black at the silence floor (peak ${peak})`);
          if (step === 50 || step === 350) kept.push(frame.slice());
        }
        let changed = 0;
        let capableCount = 0;
        for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
          if (!capable[pixelIndex]) continue;
          capableCount += 1;
          if (Math.abs(kept[0][pixelIndex * 6 + 5] - kept[1][pixelIndex * 6 + 5]) >= 8) {
            changed += 1;
          }
        }
        assert.ok(changed / capableCount >= 0.02,
          `${patternId}: freezes at the silence floor`);
      } finally {
        host.destroy(handle);
        host.shutdown();
      }
    }
  });

// ── 5. Runaway: unclamped global speed 4.0 (dt saturates the 0.1 s clamp) ───

test('runaway global speed saturates the dt clamp without spikes or resets',
  { timeout: 600_000 }, async () => {
    // g = 4.0 unclamped -> engine time factor 0.25 * 16^4 = 16384; a 25 ms
    // wall frame asks for 409.6 s of pattern time and the family dt clamp
    // hands back 0.1 s. The look must stay continuous — no NaNs, no reset
    // spikes, motion still bounded.
    for (const patternId of ALL_IDS) {
      const { host, pixels, handle } = await compileOnModel(
        patternId, 'titanic', { sliderLocalSpeed: 1 });
      try {
        const capable = capableMask(pixels);
        const capableCount = capable.filter(Boolean).length;
        const buffer = new Uint8Array(pixels.length * 6);
        let previous = null;
        const jumps = [];
        let time = 0;
        for (let step = 0; step < 400; step += 1) {
          time += 409.6;
          host.beginFrame(handle, time);
          const frame = host.renderAll6ch(handle, buffer).slice();
          if (previous) {
            let large = 0;
            for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
              if (!capable[pixelIndex]) continue;
              if (Math.abs(frame[pixelIndex * 6 + 5] - previous[pixelIndex * 6 + 5]) >= 96) {
                large += 1;
              }
            }
            jumps.push(large / capableCount);
          }
          previous = frame;
        }
        const sorted = [...jumps].sort((left, right) => left - right);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        assert.ok(p95 <= 0.35,
          `${patternId}: runaway p95 jump ${p95.toFixed(3)} — reset spikes at max speed`);
      } finally {
        host.destroy(handle);
        host.shutdown();
      }
    }
  });

// ── 6. Distinctness across the complete 20-pattern program ──────────────────

test('all 20 UV looks remain output-distinct on the capable subset',
  { timeout: 600_000 }, async () => {
    const SAMPLE_STEPS = new Set([80, 180, 280, 380, 480, 580]);
    const mapsByPattern = new Map();
    for (const patternId of ALL_IDS) {
      const { host, pixels, handle } = await compileOnModel(patternId, 'titanic');
      try {
        const capable = capableMask(pixels);
        const kept = renderRun(host, handle, pixels.length, 600, FRAME_SECONDS, SAMPLE_STEPS);
        const maps = [...SAMPLE_STEPS].sort((a, b) => a - b).map((step) => {
          const frame = kept.get(step);
          const classes = [];
          for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
            if (!capable[pixelIndex]) continue;
            const violet = frame[pixelIndex * 6 + 5];
            classes.push(violet < 56 ? 0 : (violet < 160 ? 1 : 2));
          }
          return classes;
        });
        mapsByPattern.set(patternId, maps);
      } finally {
        host.destroy(handle);
        host.shutdown();
      }
    }

    for (let leftIndex = 0; leftIndex < ALL_IDS.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ALL_IDS.length; rightIndex += 1) {
        const leftMaps = mapsByPattern.get(ALL_IDS[leftIndex]);
        const rightMaps = mapsByPattern.get(ALL_IDS[rightIndex]);
        const distances = leftMaps.map((leftMap, frameIndex) => {
          let different = 0;
          for (let position = 0; position < leftMap.length; position += 1) {
            if (leftMap[position] !== rightMaps[frameIndex][position]) different += 1;
          }
          return different / leftMap.length;
        });
        const separation = median(distances);
        assert.ok(separation >= 0.18,
          `${ALL_IDS[leftIndex]} vs ${ALL_IDS[rightIndex]}: median class separation ` +
          `${separation.toFixed(3)} — two of the twenty read as the same look`);
      }
    }
  });
