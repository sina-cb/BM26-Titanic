import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildAudioAnalyzerOptions,
  comparableAudioAnalyzerConfig,
  loadEffectiveAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';

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
