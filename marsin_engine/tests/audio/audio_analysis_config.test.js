import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildAudioAnalyzerOptions,
  buildBpmTrackerOptions,
  comparableAudioAnalyzerConfig,
  loadEffectiveAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';
import { AUDIO_LIVE_FIELDS } from '../../audio/config/audio_config.js';
import { DETECTOR_DEFAULTS } from '../../audio/detector/audio_structure_detector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');

test('production and evaluation resolve one byte-equivalent titanic analyzer config', () => {
  const production = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const evaluation = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  assert.deepEqual(
    comparableAudioAnalyzerConfig(evaluation.audioConfig),
    comparableAudioAnalyzerConfig(production.audioConfig),
  );
});

test('scene audio state wins over config.yaml for every analyzer group', () => {
  const resolved = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'test_bench',
  });
  assert.equal(resolved.audioConfig.fftSize, resolved.sceneAudioConfig.fftSize);
  assert.deepEqual(resolved.audioConfig.bands, resolved.sceneAudioConfig.bands);
  assert.deepEqual(resolved.audioConfig.kick, resolved.sceneAudioConfig.kick);
  assert.deepEqual(resolved.audioConfig.sub, resolved.sceneAudioConfig.sub);
  assert.deepEqual(resolved.audioConfig.bpmTracker, resolved.rootConfig.audio.bpmTracker);
});

test('effective audio config honors the test state-root redirect', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26-audio-state-root-'));
  const previous = process.env.MARSIN_STATE_DIR;
  try {
    const stateDir = path.join(stateRoot, 'test_bench');
    fs.mkdirSync(stateDir);
    fs.copyFileSync(
      path.join(ENGINE_DIR, 'states', 'test_bench', 'audio_state.yaml'),
      path.join(stateDir, 'audio_state.yaml'),
    );
    process.env.MARSIN_STATE_DIR = stateRoot;
    const resolved = loadEffectiveAudioAnalysisConfig({
      engineDir: ENGINE_DIR,
      modelName: 'test_bench',
    });
    assert.equal(resolved.statePath, path.join(stateRoot, 'test_bench', 'audio_state.yaml'));
    assert.equal(resolved.sceneAudioConfig.fftSize, 1024);
  } finally {
    if (previous === undefined) delete process.env.MARSIN_STATE_DIR;
    else process.env.MARSIN_STATE_DIR = previous;
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('effective loader rejects semantic scalar roots and nested detector scalars', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26-audio-semantic-root-'));
  const previous = process.env.MARSIN_STATE_DIR;
  try {
    const stateDir = path.join(stateRoot, 'test_bench');
    fs.mkdirSync(stateDir);
    process.env.MARSIN_STATE_DIR = stateRoot;

    fs.writeFileSync(path.join(stateDir, 'audio_state.yaml'), '2026-08-12\n');
    assert.throws(
      () => loadEffectiveAudioAnalysisConfig({ engineDir: ENGINE_DIR, modelName: 'test_bench' }),
      /scene audio config must contain a YAML object/,
    );

    fs.writeFileSync(
      path.join(stateDir, 'audio_state.yaml'),
      'structureDetector: 2026-08-12\n',
    );
    assert.throws(
      () => loadEffectiveAudioAnalysisConfig({ engineDir: ENGINE_DIR, modelName: 'test_bench' }),
      /audio\.structureDetector/,
    );
  } finally {
    if (previous === undefined) delete process.env.MARSIN_STATE_DIR;
    else process.env.MARSIN_STATE_DIR = previous;
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('analyzer factory applies every configured analyzer field', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const options = buildAudioAnalyzerOptions(audioConfig, {
    nowFn: () => 123,
    onConditioned: () => {},
    onAnalysis: () => {},
  });
  assert.equal(options.sampleRate, audioConfig.capture.sampleRate);
  assert.equal(options.fftSize, audioConfig.fftSize);
  assert.equal(options.hopSize, audioConfig.hopSize);
  assert.deepEqual(options.bands, audioConfig.bands);
  assert.deepEqual(options.kick, audioConfig.kick);
  assert.deepEqual(options.sub, audioConfig.sub);
  assert.deepEqual(buildBpmTrackerOptions(audioConfig), {
    ...audioConfig.bpmTracker,
    hopsPerSec: audioConfig.capture.sampleRate / audioConfig.hopSize,
  });
});

test('BPM detector bounds are explicit, validated, and independent from speed mapping', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  assert.deepEqual(buildBpmTrackerOptions(audioConfig), {
    minBpm: 70,
    maxBpm: 180,
    activityThreshold: 0.05,
    silenceResetMs: 1200,
    silenceResetEnabled: false,
    outputSlewEnabled: true,
    outputSlewBpmPerSec: 16,
    // DERIVED from the capture config (44100 / 512), never hand-configured.
    hopsPerSec: 44100 / 512,
  });
  assert.throws(
    () => buildBpmTrackerOptions({
      ...audioConfig,
      bpmTracker: { ...audioConfig.bpmTracker, minBpm: 180, maxBpm: 60 },
    }),
    /minBpm < audio\.bpmTracker\.maxBpm/,
  );
});

test('the tracker hop rate follows the capture config, never a baked constant', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  // An operator who halves the hop size doubles the analysis hop rate; the
  // tracker must be told, or every lag→BPM conversion silently doubles.
  const halvedHop = { ...audioConfig, hopSize: audioConfig.hopSize / 2 };
  assert.equal(buildBpmTrackerOptions(halvedHop).hopsPerSec,
    2 * buildBpmTrackerOptions(audioConfig).hopsPerSec);
  const slowRate = {
    ...audioConfig,
    capture: { ...audioConfig.capture, sampleRate: 22050 },
    bands: { ...audioConfig.bands, sourceSmoothHz: 6000 },
  };
  assert.equal(buildBpmTrackerOptions(slowRate).hopsPerSec, 22050 / audioConfig.hopSize);
});

test('an unknown or typo bpmTracker key fails loudly, naming the key', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  assert.throws(
    () => buildBpmTrackerOptions({
      ...audioConfig,
      bpmTracker: { ...audioConfig.bpmTracker, minBPM: 70 },
    }),
    /unknown key "audio\.bpmTracker\.minBPM"/,
  );
  // Stale knobs from the removed pure-hypothesis experiment must not be
  // silently accepted (and silently ignored) either.
  assert.throws(
    () => buildBpmTrackerOptions({
      ...audioConfig,
      bpmTracker: { ...audioConfig.bpmTracker, usePureHypothesis: false },
    }),
    /unknown key "audio\.bpmTracker\.usePureHypothesis"/,
  );
});

test('activityThreshold is validated as a band level in (0, 1]', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const withThreshold = (activityThreshold) => ({
    ...audioConfig,
    bpmTracker: { ...audioConfig.bpmTracker, activityThreshold },
  });
  assert.throws(() => buildBpmTrackerOptions(withThreshold(0)), /activityThreshold/);
  assert.throws(() => buildBpmTrackerOptions(withThreshold(-0.1)), /activityThreshold/);
  assert.throws(() => buildBpmTrackerOptions(withThreshold(1.5)), /activityThreshold/);
  assert.equal(buildBpmTrackerOptions(withThreshold(1)).activityThreshold, 1);
});

test('the published-BPM slew is validated, never silently defaulted', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const withSlew = (slew) => ({
    ...audioConfig,
    bpmTracker: { ...audioConfig.bpmTracker, ...slew },
  });
  const missingRate = withSlew({});
  delete missingRate.bpmTracker.outputSlewBpmPerSec;
  assert.throws(() => buildBpmTrackerOptions(missingRate),
    /audio\.bpmTracker\.outputSlewBpmPerSec/);
  assert.throws(() => buildBpmTrackerOptions(withSlew({ outputSlewBpmPerSec: 0 })),
    /outputSlewBpmPerSec > 0/);
  assert.throws(() => buildBpmTrackerOptions(withSlew({ outputSlewBpmPerSec: -12 })),
    /outputSlewBpmPerSec > 0/);
  assert.throws(() => buildBpmTrackerOptions(withSlew({ outputSlewBpmPerSec: 'fast' })),
    /audio\.bpmTracker\.outputSlewBpmPerSec/);
  assert.throws(() => buildBpmTrackerOptions(withSlew({ outputSlewEnabled: 'yes' })),
    /outputSlewEnabled/);
  const missingFlag = withSlew({});
  delete missingFlag.bpmTracker.outputSlewEnabled;
  assert.throws(() => buildBpmTrackerOptions(missingFlag), /outputSlewEnabled/);
});

test('analyzer factory fails loudly when a required field is absent', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const broken = { ...audioConfig, bands: { ...audioConfig.bands } };
  delete broken.bands.noiseGate;
  assert.throws(
    () => buildAudioAnalyzerOptions(broken, { onAnalysis: () => {} }),
    /audio\.bands\.noiseGate/,
  );
});

test('structureDetector boot config exactly covers the live contract', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  assert.deepEqual(
    Object.keys(audioConfig.structureDetector).sort(),
    [...AUDIO_LIVE_FIELDS.structureDetector].sort(),
  );
  assert.deepEqual(
    audioConfig.structureDetector,
    { ...DETECTOR_DEFAULTS, enabled: true },
    'config.yaml must carry detector defaults plus the existing enabled tune',
  );
});

test('structureDetector boot config rejects missing, unknown, typed, and ranged fields', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const withDetector = (structureDetector) => ({ ...audioConfig, structureDetector });

  const missing = { ...audioConfig.structureDetector };
  delete missing.dropEnergyJump;
  assert.throws(
    () => buildAudioAnalyzerOptions(withDetector(missing), { onAnalysis: () => {} }),
    /audio\.structureDetector\.dropEnergyJump/,
  );

  assert.throws(
    () => buildAudioAnalyzerOptions(withDetector({
      ...audioConfig.structureDetector,
      mysteryGate: 0.5,
    }), { onAnalysis: () => {} }),
    /unknown key "audio\.structureDetector\.mysteryGate"/,
  );
  assert.throws(
    () => buildAudioAnalyzerOptions(withDetector({
      ...audioConfig.structureDetector,
      enabled: 1,
    }), { onAnalysis: () => {} }),
    /structureDetector\.enabled.*boolean/,
  );
  assert.throws(
    () => buildAudioAnalyzerOptions(withDetector({
      ...audioConfig.structureDetector,
      dropEnergyJump: 1,
    }), { onAnalysis: () => {} }),
    /structureDetector\.dropEnergyJump/,
  );
});

test('complete validation rejects analyzer combinations before they can be persisted', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  assert.throws(
    () => buildAudioAnalyzerOptions({
      ...audioConfig,
      bands: { ...audioConfig.bands, lowMaxHz: audioConfig.bands.midMaxHz + 1 },
    }, { onAnalysis: () => {} }),
    /lowMaxHz.*midMaxHz/,
  );
  assert.throws(
    () => buildAudioAnalyzerOptions({
      ...audioConfig,
      sub: { minHz: 100, maxHz: 50 },
    }, { onAnalysis: () => {} }),
    /audio\.sub\.minHz.*audio\.sub\.maxHz/,
  );
  assert.throws(
    () => buildAudioAnalyzerOptions({ ...audioConfig, fftSize: 1000 }, {
      onAnalysis: () => {},
    }),
    /fftSize.*power of two/,
  );
});

test('sourceSmoothHz contract accepts exact Nyquist as the documented off setting', () => {
  const { audioConfig } = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  });
  const exactNyquist = {
    ...audioConfig,
    bands: {
      ...audioConfig.bands,
      sourceSmoothHz: audioConfig.capture.sampleRate / 2,
    },
  };
  assert.doesNotThrow(
    () => buildAudioAnalyzerOptions(exactNyquist, { onAnalysis: () => {} }),
  );
  assert.throws(
    () => buildAudioAnalyzerOptions({
      ...exactNyquist,
      bands: { ...exactNyquist.bands, sourceSmoothHz: 22050.01 },
    }, { onAnalysis: () => {} }),
    /sourceSmoothHz.*Nyquist/,
  );
});
