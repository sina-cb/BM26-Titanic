// crisp_contract.test.js - collection-wide exact-color and staging contract.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { PlaylistManager } from '../../lib/playlist_manager.js';
import { WasmHost } from '../../lib/wasm_host.js';
import { parseAudioModSpec } from '../../tools/audio_mod_spec.mjs';
import { validatePatternIntent } from '../../tools/playlist_gallery/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
const CRISP_DIR = path.join(PATTERNS_DIR, 'crisp');
const MANIFEST_PATH = path.join(PATTERNS_DIR, 'manifest.json');
const GOALS_PATH = path.join(ENGINE_DIR, 'tools', 'playlist_gallery', 'pattern_goals.json');
const TITANIC_PLAYLIST_DIR = path.join(
  REPO_DIR, 'simulation', 'scenes', 'titanic', 'playlists',
);
const BENCH_PLAYLIST_DIR = path.join(
  REPO_DIR, 'simulation', 'scenes', 'test_bench', 'playlists',
);
const TITANIC_PLAYLIST_PATH = path.join(TITANIC_PLAYLIST_DIR, 'ambient.yaml');
const BENCH_PLAYLIST_PATH = path.join(BENCH_PLAYLIST_DIR, 'ambient.yaml');
const TITANIC_REACTIVE_PATH = path.join(
  TITANIC_PLAYLIST_DIR, 'ambient_sound_reactive.yaml',
);
const BENCH_REACTIVE_PATH = path.join(
  BENCH_PLAYLIST_DIR, 'ambient_sound_reactive.yaml',
);
const GLOBAL_SPEED = 0.3;
const FRAME_SECONDS = 0.025 * GLOBAL_SPEED;
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
const ROLE_AUDIT_TIME_SCALE = new Map([
  // Preserve the established geometric phase span when a deliberately slower
  // saved cadence would otherwise shorten this fixed-frame role audit.
  ['crisp/03_magnetic_field_collision',
    (0.05 + Math.pow(2, (0.3 - 0.5) * 4) * 0.04)
      / (0.014 + 0.2 * 0.020)],
  ['crisp/06_impossible_corridor',
    (0.06 + Math.pow(2, (0.3 - 0.5) * 4) * 0.22)
      / (0.018 + 0.3 * 0.036)],
]);
const CRISP_SOURCE_IDS = [
  'crisp/01_orbiting_circle',
  'crisp/02_dimensional_slicer',
  'crisp/03_magnetic_field_collision',
  'crisp/04_mechanical_aperture',
  'crisp/05_continental_drift',
  'crisp/06_impossible_corridor',
  'crisp/07_faultline_lightning',
  'crisp/08_topology_knot',
  'crisp/09_pressure_chamber',
  'crisp/10_geometric_echo',
  'crisp/11_event_horizon',
];
const PATTERN_IDS = [
  'crisp/01_orbiting_circle',
  'crisp/02_dimensional_slicer',
  'crisp/03_magnetic_field_collision',
  'crisp/06_impossible_corridor',
  'crisp/08_topology_knot',
  'crisp/10_geometric_echo',
];

const titanicPlaylistBytes = fs.readFileSync(TITANIC_PLAYLIST_PATH);
const benchPlaylistBytes = fs.readFileSync(BENCH_PLAYLIST_PATH);
const titanicReactiveBytes = fs.readFileSync(TITANIC_REACTIVE_PATH);
const benchReactiveBytes = fs.readFileSync(BENCH_REACTIVE_PATH);
const playlist = yaml.load(titanicPlaylistBytes.toString('utf8'));
const entriesByPattern = new Map(playlist.entries.map((entry) => [entry.pattern, entry]));
const sources = new Map(CRISP_SOURCE_IDS.map((patternId) => [
  patternId,
  fs.readFileSync(path.join(PATTERNS_DIR, `${patternId}.js`), 'utf8'),
]));
const frameTimes = new WeakMap();

function sliderNames(source) {
  return [...source.matchAll(/export\s+function\s+(slider[A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1]);
}

function setControl(host, handle, name, ...values) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  assert.ok(control, `missing control export: ${name}`);
  host.setControl(handle, control.id, ...values);
}

function applyControls(host, handle, patternId, overrides = {}, pureEndpoints = false) {
  const source = sources.get(patternId);
  const entry = entriesByPattern.get(patternId);
  if (pureEndpoints) {
    setControl(host, handle, 'colorPalette1', 0, 1, 1);
    setControl(host, handle, 'colorPalette2', 2 / 3, 1, 1);
  }
  for (const name of sliderNames(source)) {
    const value = overrides[name] ?? entry.defaults[name];
    assert.ok(Number.isFinite(value), `${patternId}: missing finite saved ${name}`);
    setControl(host, handle, name, value);
  }
}

async function compileOnModel(patternId, modelName, overrides = {}, pureEndpoints = false) {
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
  const compiled = host.compile(sources.get(patternId));
  assert.equal(compiled.ok, true, `${patternId}/${modelName}: ${compiled.error}`);
  applyControls(host, compiled.handle, patternId, overrides, pureEndpoints);
  return { host, loaded, compiled };
}

function renderFrame(host, handle, pixelCount, frameSeconds = FRAME_SECONDS) {
  const frame = new Uint8Array(pixelCount * 6);
  const frameTime = (frameTimes.get(host) || 0) + frameSeconds;
  frameTimes.set(host, frameTime);
  host.beginFrame(handle, frameTime);
  host.renderAll6ch(handle, frame);
  return frame;
}

function pixelBytes(frame, pixelIndex) {
  return frame.subarray(pixelIndex * 6, pixelIndex * 6 + 6);
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
  assert.equal(left.length, right.length);
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) different += 1;
  }
  return different / left.length;
}

function changedPixelFraction(left, right) {
  assert.equal(left.length, right.length);
  let changed = 0;
  for (let offset = 0; offset < left.length; offset += 6) {
    if (Math.abs(left[offset] - right[offset]) > 2
        || Math.abs(left[offset + 1] - right[offset + 1]) > 2
        || Math.abs(left[offset + 2] - right[offset + 2]) > 2) {
      changed += 1;
    }
  }
  return changed / (left.length / 6);
}

function largeJumpFraction(left, right) {
  assert.equal(left.length, right.length);
  let changed = 0;
  for (let offset = 0; offset < left.length; offset += 6) {
    if (Math.max(
      Math.abs(left[offset] - right[offset]),
      Math.abs(left[offset + 1] - right[offset + 1]),
      Math.abs(left[offset + 2] - right[offset + 2]),
    ) >= 64) changed += 1;
  }
  return changed / (left.length / 6);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

test('Crisp catalog sources promote into paired Ambient playlists in order', () => {
  assert.deepEqual(titanicPlaylistBytes, benchPlaylistBytes);
  assert.deepEqual(titanicReactiveBytes, benchReactiveBytes);
  assert.equal(playlist.schemaVersion, 1);
  assert.equal(playlist.name, 'ambient');
  const promotedEntries = playlist.entries.filter((entry) => PATTERN_IDS.includes(entry.pattern));
  assert.deepEqual(promotedEntries.map((entry) => entry.pattern), PATTERN_IDS);
  assert.deepEqual(
    promotedEntries.map((entry) => entry.id),
    PATTERN_IDS.map((patternId) => `e_${patternId.replace('/', '_')}`),
  );

  const discovered = fs.readdirSync(CRISP_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => `crisp/${name.replace(/\.js$/, '')}`);
  assert.deepEqual(discovered, CRISP_SOURCE_IDS);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const goals = JSON.parse(fs.readFileSync(GOALS_PATH, 'utf8'));
  for (const patternId of CRISP_SOURCE_IDS) {
    const source = sources.get(patternId);
    assert.equal(manifest.filter((item) => item === patternId).length, 1);
    assert.doesNotThrow(() => validatePatternIntent(patternId, goals[patternId], source));
    assert.match(source, /^\/\/ DRAFT/);
    assert.match(source, /\bindex\s*%\s*74(?:\.0)?\b/);
    assert.doesNotMatch(source.slice(source.indexOf('export function render3D')), /\barray\s*\(/);
    assert.doesNotMatch(source, /\b(?:random|noise)\s*\(/);
    assert.doesNotThrow(() => parseAudioModSpec(source, patternId));
  }

  for (const patternId of PATTERN_IDS) {
    const source = sources.get(patternId);
    const entry = entriesByPattern.get(patternId);
    assert.deepEqual(Object.keys(entry.defaults), sliderNames(source));
    const expectedSpeed = patternId === 'crisp/03_magnetic_field_collision' ? 0.2 : 0.3;
    assert.equal(entry.defaults.sliderLocalSpeed, expectedSpeed);
    assert.deepEqual(entry.modulations, []);
    assert.deepEqual(entry.midiMappings, []);
  }

  for (const directory of [TITANIC_PLAYLIST_DIR, BENCH_PLAYLIST_DIR]) {
    const manager = new PlaylistManager(directory, PATTERNS_DIR);
    assert.equal(manager.list().includes('crisp'), false);
    const loaded = manager.load('ambient');
    assert.deepEqual(
      loaded.entries.filter((entry) => PATTERN_IDS.includes(entry.pattern))
        .map((entry) => entry.pattern),
      PATTERN_IDS,
    );
    assert.equal(loaded.entries.some((entry) => entry._missing), false);
  }
  assert.equal(fs.existsSync(path.join(TITANIC_PLAYLIST_DIR, 'crisp.yaml')), false);
  assert.equal(fs.existsSync(path.join(BENCH_PLAYLIST_DIR, 'crisp.yaml')), false);
});

test('every Crisp pattern emits only endpoint rays or black with W=A=U=0',
  { timeout: 60_000 }, async () => {
    for (const modelName of ['test_bench', 'titanic']) {
      for (const patternId of PATTERN_IDS) {
        const { host, loaded, compiled } = await compileOnModel(
          patternId, modelName, {}, true,
        );
        try {
          let sawRed = false;
          let sawBlue = false;
          let sawBlack = false;
          for (let step = 0; step < 600; step += 1) {
            const frame = renderFrame(host, compiled.handle, loaded.pixels.length);
            for (let offset = 0; offset < frame.length; offset += 6) {
              const red = frame[offset];
              const green = frame[offset + 1];
              const blue = frame[offset + 2];
              assert.equal(green, 0, `${patternId}/${modelName}: non-endpoint green`);
              assert.equal(red > 0 && blue > 0, false,
                `${patternId}/${modelName}: interpolated endpoints`);
              assert.equal(frame[offset + 3], 0, `${patternId}/${modelName}: W`);
              assert.equal(frame[offset + 4], 0, `${patternId}/${modelName}: A`);
              assert.equal(frame[offset + 5], 0, `${patternId}/${modelName}: U`);
              sawRed ||= red > 0;
              sawBlue ||= blue > 0;
              sawBlack ||= red === 0 && blue === 0;
            }
          }
          assert.equal(sawRed, true, `${patternId}/${modelName}: Color 1 absent`);
          assert.equal(sawBlue, true, `${patternId}/${modelName}: Color 2 absent`);
          assert.equal(sawBlack, true, `${patternId}/${modelName}: black absent`);
        } finally {
          host.destroy(compiled.handle);
          host.shutdown();
        }
      }
    }
  });

test('every Crisp pattern animates all Titanic roles and authors complementary TE signs',
  { timeout: 60_000 }, async () => {
    for (const patternId of PATTERN_IDS) {
      const { host, loaded, compiled } = await compileOnModel(
        patternId, 'titanic', {}, true,
      );
      try {
        const firstSign = loaded.metaArray
          .map((meta, index) => meta.sectionId === 3 ? index : -1)
          .filter((index) => index >= 0);
        const secondSign = loaded.metaArray
          .map((meta, index) => meta.sectionId === 415 ? index : -1)
          .filter((index) => index >= 0);
        assert.equal(firstSign.length, 74);
        assert.equal(secondSign.length, 74);

        const roleCounts = new Map(EXPECTED_FIXTURE_ROLES.map((role) => [role, 0]));
        const roleLit = new Map(EXPECTED_FIXTURE_ROLES.map((role) => [role, new Set()]));
        const roleChanged = new Map(EXPECTED_FIXTURE_ROLES.map((role) => [role, new Set()]));
        const roleSamples = new Map(EXPECTED_FIXTURE_ROLES.map((role) => [role, 0]));
        const roleDark = new Map(EXPECTED_FIXTURE_ROLES.map((role) => [role, 0]));
        const roleHot = new Map(EXPECTED_FIXTURE_ROLES.map((role) => [role, 0]));
        loaded.metaArray.forEach((meta) => {
          if (roleCounts.has(meta.fixtureTypeId)) {
            roleCounts.set(meta.fixtureTypeId, roleCounts.get(meta.fixtureTypeId) + 1);
          }
        });

        const snapshots = [];
        const lowerAddressesContinue = [false, false];
        const signMin = [
          Array.from({ length: 74 }, () => [255, 255, 255]),
          Array.from({ length: 74 }, () => [255, 255, 255]),
        ];
        const signMax = [
          Array.from({ length: 74 }, () => [0, 0, 0]),
          Array.from({ length: 74 }, () => [0, 0, 0]),
        ];
        let signPairSamples = 0;
        let complementaryPairSamples = 0;
        let previousFrame = null;
        let maxVintageHeads = 0;
        let maxActivePars = 0;
        for (let step = 0; step <= 600; step += 1) {
          const frame = renderFrame(
            host,
            compiled.handle,
            loaded.pixels.length,
            FRAME_SECONDS * (ROLE_AUDIT_TIME_SCALE.get(patternId) || 1),
          );
          if (step === 100 || step === 350 || step === 600) {
            snapshots.push(frame);
          }
          for (let pixelIndex = 0; pixelIndex < loaded.pixels.length; pixelIndex += 1) {
            const bytes = pixelBytes(frame, pixelIndex);
            const level = Math.max(bytes[0], bytes[1], bytes[2]);
            const role = loaded.metaArray[pixelIndex].fixtureTypeId;
            if (roleSamples.has(role)) {
              roleSamples.set(role, roleSamples.get(role) + 1);
              if (level < 8) roleDark.set(role, roleDark.get(role) + 1);
              if (level >= 224) roleHot.set(role, roleHot.get(role) + 1);
              if (previousFrame) {
                const previous = pixelBytes(previousFrame, pixelIndex);
                if (Math.max(
                  Math.abs(bytes[0] - previous[0]),
                  Math.abs(bytes[1] - previous[1]),
                  Math.abs(bytes[2] - previous[2]),
                ) >= 8) roleChanged.get(role).add(pixelIndex);
              }
            }
            if (level > 4) {
              if (roleLit.has(role)) roleLit.get(role).add(pixelIndex);
            }
          }
          const vintageHeads = new Map();
          let activePars = 0;
          for (let pixelIndex = 0; pixelIndex < loaded.pixels.length; pixelIndex += 1) {
            const meta = loaded.metaArray[pixelIndex];
            const bytes = pixelBytes(frame, pixelIndex);
            const lit = Math.max(bytes[0], bytes[1], bytes[2]) >= 8;
            if (meta.fixtureTypeId === FIX_VINTAGE_6 && lit) {
              vintageHeads.set(meta.fixtureId, (vintageHeads.get(meta.fixtureId) || 0) + 1);
            }
            if (meta.fixtureTypeId === FIX_PAR && lit) activePars += 1;
          }
          maxVintageHeads = Math.max(maxVintageHeads, ...vintageHeads.values(), 0);
          maxActivePars = Math.max(maxActivePars, activePars);
          if (step % 60 === 0) {
            signPairSamples += 1;
            let pairDifferences = 0;
            for (let local = 0; local < 74; local += 1) {
              const firstBytes = pixelBytes(frame, firstSign[local]);
              const secondBytes = pixelBytes(frame, secondSign[local]);
              if (!firstBytes.every((value, channel) => value === secondBytes[channel])) {
                pairDifferences += 1;
              }
            }
            if (pairDifferences >= 4) complementaryPairSamples += 1;
            const signIndices = [firstSign, secondSign];
            for (let sign = 0; sign < signIndices.length; sign += 1) {
              for (let local = 0; local < 34; local += 1) {
                if (!pixelBytes(frame, signIndices[sign][local]).every(
                  (value, channel) => value === pixelBytes(
                    frame, signIndices[sign][40 + local],
                  )[channel],
                )) lowerAddressesContinue[sign] = true;
              }
            }
          }
          for (const [sign, indices] of [firstSign, secondSign].entries()) {
            for (let local = 0; local < 74; local += 1) {
              const now = pixelBytes(frame, indices[local]);
              for (let channel = 0; channel < 3; channel += 1) {
                signMin[sign][local][channel] = Math.min(
                  signMin[sign][local][channel], now[channel],
                );
                signMax[sign][local][channel] = Math.max(
                  signMax[sign][local][channel], now[channel],
                );
              }
            }
          }
          previousFrame = frame;
        }

        assert.deepEqual(lowerAddressesContinue, [true, true],
          `${patternId}: a sign repeats its 34/40 subsection`);
        assert.ok(complementaryPairSamples >= Math.floor(signPairSamples * 0.8),
          `${patternId}: signs remain generic byte-identical seals`);
        const signChanged = signMin.map((minima, sign) => minima.filter(
          (channels, local) => channels.some(
            (minimum, channel) => signMax[sign][local][channel] - minimum >= 8,
          ),
        ).length);
        assert.ok(signChanged[0] >= 12, `${patternId}: first sign only animates ${signChanged[0]}`);
        assert.ok(signChanged[1] >= 12, `${patternId}: second sign only animates ${signChanged[1]}`);
        const earlyMiddleMotion = changedPixelFraction(snapshots[0], snapshots[1]);
        const middleLateMotion = changedPixelFraction(snapshots[1], snapshots[2]);
        assert.ok(earlyMiddleMotion >= 0.005,
          `${patternId}: early/mid motion ${earlyMiddleMotion.toFixed(4)}`);
        assert.ok(middleLateMotion >= 0.005,
          `${patternId}: mid/late motion ${middleLateMotion.toFixed(4)}`);
        for (const role of EXPECTED_FIXTURE_ROLES) {
          assert.ok(roleCounts.get(role) > 0, `${patternId}: role ${role} absent`);
          assert.ok(roleLit.get(role).size > 0, `${patternId}: role ${role} never lit`);
          const dynamicFraction = roleChanged.get(role).size / roleCounts.get(role);
          assert.ok(dynamicFraction >= 0.025,
            `${patternId}: role ${role} dynamic fraction ${dynamicFraction.toFixed(3)}`);
        }
        const darkFraction = (role) => roleDark.get(role) / roleSamples.get(role);
        const hotFraction = (role) => roleHot.get(role) / roleSamples.get(role);
        assert.ok(darkFraction(FIX_BAR_18) >= 0.18 && darkFraction(FIX_BAR_18) <= 0.86,
          `${patternId}: Hull dark ${darkFraction(FIX_BAR_18).toFixed(3)}`);
        assert.ok(darkFraction(FIX_VINTAGE_6) >= 0.65,
          `${patternId}: Vintage dark ${darkFraction(FIX_VINTAGE_6).toFixed(3)}`);
        assert.ok(darkFraction(FIX_TE_SIGN) >= 0.12 && darkFraction(FIX_TE_SIGN) <= 0.86,
          `${patternId}: Identity dark ${darkFraction(FIX_TE_SIGN).toFixed(3)}`);
        assert.ok(hotFraction(FIX_BAR_18) <= 0.25,
          `${patternId}: Hull hot ${hotFraction(FIX_BAR_18).toFixed(3)}`);
        assert.ok(hotFraction(FIX_VINTAGE_6) <= 0.12,
          `${patternId}: Vintage hot ${hotFraction(FIX_VINTAGE_6).toFixed(3)}`);
        assert.ok(maxVintageHeads <= 2,
          `${patternId}: ${maxVintageHeads} Vintage heads lit together`);
        assert.ok(maxActivePars <= 12, `${patternId}: ${maxActivePars} PARs lit together`);
      } finally {
        host.destroy(compiled.handle);
        host.shutdown();
      }
    }
  });

test('legal maximum speed remains active without runaway or reset spikes',
  { timeout: 60_000 }, async () => {
    for (const patternId of PATTERN_IDS) {
      const { host, loaded, compiled } = await compileOnModel(
        patternId, 'titanic', { sliderLocalSpeed: 1 }, true,
      );
      try {
        let previous = null;
        for (let step = 0; step < 120; step += 1) {
          previous = renderFrame(host, compiled.handle, loaded.pixels.length, 0.025);
        }
        const activity = [];
        const jumps = [];
        for (let step = 0; step < 400; step += 1) {
          const frame = renderFrame(host, compiled.handle, loaded.pixels.length, 0.025);
          activity.push(changedPixelFraction(previous, frame));
          jumps.push(largeJumpFraction(previous, frame));
          previous = frame;
        }
        const sortedActivity = [...activity].sort((left, right) => left - right);
        const sorted = [...jumps].sort((left, right) => left - right);
        const medianActivity = sortedActivity[Math.floor(sortedActivity.length * 0.5)];
        const p95Jump = sorted[Math.floor(sorted.length * 0.95)];
        const maxJump = sorted[sorted.length - 1];
        assert.ok(medianActivity >= 0.001,
          `${patternId}: max speed median activity ${medianActivity.toFixed(3)}`);
        assert.ok(p95Jump <= 0.24,
          `${patternId}: max speed p95 jump ${p95Jump.toFixed(3)}`);
        assert.ok(maxJump <= 0.30,
          `${patternId}: max speed reset spike ${maxJump.toFixed(3)}`);
      } finally {
        host.destroy(compiled.handle);
        host.shutdown();
      }
    }
  });

test('saved Crisp looks remain output-distinct on Titanic',
  { timeout: 60_000 }, async () => {
    const mapsByPattern = new Map();
    for (const patternId of PATTERN_IDS) {
      const { host, loaded, compiled } = await compileOnModel(
        patternId, 'titanic', {}, true,
      );
      try {
        const maps = [];
        for (let step = 0; step <= 600; step += 1) {
          const frame = renderFrame(host, compiled.handle, loaded.pixels.length);
          if ([80, 180, 280, 380, 480, 580].includes(step)) maps.push(classMap(frame));
        }
        mapsByPattern.set(patternId, maps);
      } finally {
        host.destroy(compiled.handle);
        host.shutdown();
      }
    }

    for (let leftIndex = 0; leftIndex < PATTERN_IDS.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < PATTERN_IDS.length;
           rightIndex += 1) {
        const leftId = PATTERN_IDS[leftIndex];
        const rightId = PATTERN_IDS[rightIndex];
        const distances = mapsByPattern.get(leftId).map((left, frameIndex) =>
          hammingFraction(left, mapsByPattern.get(rightId)[frameIndex]));
        const separation = median(distances);
        assert.ok(separation >= 0.30,
          `${leftId} vs ${rightId}: median class separation ${separation.toFixed(3)}`);
      }
    }
  });
