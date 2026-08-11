import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import {
  buildRawMirrorWrites,
  RAW_MIRROR_SOURCES,
} from '../../audio/companion/audio_pipeline.js';
import {
  buildAudioAnalyzerOptions,
  loadEffectiveAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';
import { AudioStructureDetector } from '../../audio/detector/audio_structure_detector.js';
import { DerivedSignals } from '../../audio/signals/derived_signals.js';
import { SYNTHS } from '../../audio/synth/test_synths.js';
import { ParamCenter } from '../../lib/param_center.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');

test('production raw publication includes every derived-signal analyzer input', () => {
  const fields = Object.fromEntries(
    RAW_MIRROR_SOURCES.map(({ analyzerField }, index) => [analyzerField, index / 20]),
  );
  const writes = buildRawMirrorWrites(fields);
  assert.deepEqual(writes.map(({ key }) => key), [
    'micLowRaw',
    'micMidRaw',
    'micHighRaw',
    'micKickRaw',
    'micFluxRaw',
    'micDomFreq1',
    'micDomEnergy1',
    'micDomFreq2',
    'micDomEnergy2',
    'micOnsetLowRaw',
    'micOnsetMidRaw',
    'micOnsetHighRaw',
    'micSubRaw',
    'micTonalStabilityRaw',
    'micChromaFluxRaw',
    'micChromaTiltRaw',
  ]);
  assert.deepEqual(writes.map(({ value }) => value), RAW_MIRROR_SOURCES.map((_, index) => index / 20));
});

test('raw publication fails loudly instead of replacing a missing analyzer field with zero', () => {
  const fields = Object.fromEntries(
    RAW_MIRROR_SOURCES.map(({ analyzerField }) => [analyzerField, 0]),
  );
  delete fields.micSub;
  assert.throws(() => buildRawMirrorWrites(fields), /micSub/);
});

test('real Companion analyzer publication makes onset, chest-hit, chroma, and genre inputs live', () => {
  const audioConfig = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'titanic',
  }).audioConfig;
  const paramCenter = new ParamCenter(null);
  const detector = new AudioStructureDetector({
    paramCenter,
    broadcast: () => {},
    getConfig: () => audioConfig.structureDetector,
  });
  const derived = new DerivedSignals({ paramCenter });
  let clockMs = 0;
  let lastMs = 0;
  const hopMs = (audioConfig.hopSize / audioConfig.capture.sampleRate) * 1000;
  const maxima = Object.fromEntries([
    'micOnsetLowRaw',
    'micOnsetMidRaw',
    'micOnsetHighRaw',
    'micSubRaw',
    'micTonalStabilityRaw',
    'micChromaFluxRaw',
    'micChromaTiltRaw',
    'micOnsetLow',
    'micOnsetMid',
    'micOnsetHigh',
    'audioChestHit',
    'audioGenreConf',
  ].map((key) => [key, 0]));
  const analyzer = new AudioAnalyzer(buildAudioAnalyzerOptions(audioConfig, {
    nowFn: () => clockMs,
    onAnalysis: (analysis) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000;
      lastMs = clockMs;
      paramCenter.setMany(buildRawMirrorWrites(analysis), 'companion');
      detector.tick(clockMs, dt);
      derived.tick(clockMs, dt);
      for (const key of Object.keys(maxima)) {
        maxima[key] = Math.max(maxima[key], paramCenter.get(key));
      }
    },
  }));
  const synth = SYNTHS.full_track;
  const frame = new Int16Array(audioConfig.hopSize);
  const durationSamples = audioConfig.capture.sampleRate * 18;
  for (let offset = 0; offset < durationSamples; offset += frame.length) {
    for (let index = 0; index < frame.length; index++) {
      frame[index] = Math.round(32767 * synth.sample(
        offset + index,
        audioConfig.capture.sampleRate,
        synth.defaults,
      ));
    }
    clockMs += hopMs;
    analyzer.pushSamples(frame);
  }
  detector.dispose();

  for (const key of ['micOnsetLowRaw', 'micOnsetHighRaw', 'micSubRaw']) {
    assert.ok(maxima[key] > 0, `${key} must leave zero through production publication`);
  }
  for (const key of ['micOnsetLow', 'micOnsetHigh', 'audioChestHit']) {
    assert.ok(maxima[key] > 0, `${key} must leave zero through the real derived chain: ` +
      JSON.stringify(maxima));
  }
  assert.ok(maxima.micTonalStabilityRaw > 0);
  assert.ok(maxima.micChromaFluxRaw > 0);
  assert.ok(maxima.micChromaTiltRaw > 0);
  assert.ok(Number.isFinite(paramCenter.get('audioGenre')));
  assert.ok(Number.isFinite(paramCenter.get('audioGenreConf')));
});
