import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import {
  mergeAudioConfig,
  validateStructureDetectorConfig,
} from './audio_config.js';
import { sceneStateDir } from '../../lib/state_paths.js';
import {
  buildDerivedSignalsOptions,
  validateDerivedSignalsConfig,
} from './derived_signals_config.js';

const REQUIRED_AUDIO_FIELDS = Object.freeze(['fftSize', 'hopSize']);
const REQUIRED_CAPTURE_FIELDS = Object.freeze(['sampleRate']);
const REQUIRED_BAND_FIELDS = Object.freeze([
  'lowMaxHz',
  'midMaxHz',
  'attackMs',
  'releaseMs',
  'noiseGate',
  'inputGain',
  'sourceSmoothHz',
]);
const REQUIRED_KICK_FIELDS = Object.freeze([
  'minHz',
  'maxHz',
  'threshold',
  'refractoryMs',
  'decayMs',
]);
const REQUIRED_SUB_FIELDS = Object.freeze(['minHz', 'maxHz']);
const REQUIRED_BPM_TRACKER_FIELDS = Object.freeze([
  'minBpm',
  'maxBpm',
  'activityThreshold',
  'silenceResetMs',
  'outputSlewBpmPerSec',
]);
const REQUIRED_BPM_TRACKER_BOOLEANS = Object.freeze([
  'silenceResetEnabled',
  'outputSlewEnabled',
]);
/**
 * The COMPLETE set of keys the yaml `audio.bpmTracker` block may carry. Anything
 * else is a typo or a stale knob from a removed experiment, and it must fail
 * loudly instead of being silently ignored while the operator believes it took
 * effect. `hopsPerSec` is deliberately NOT here — it is DERIVED from
 * capture.sampleRate / hopSize, never hand-set.
 */
const ALLOWED_BPM_TRACKER_FIELDS = Object.freeze(
  [...REQUIRED_BPM_TRACKER_FIELDS, ...REQUIRED_BPM_TRACKER_BOOLEANS],
);

function isYamlMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readYamlObject(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} read failed (${filePath}): ${error.message}`);
  }
  let value;
  try {
    value = yaml.load(raw);
  } catch (error) {
    throw new Error(`${label} parse failed (${filePath}): ${error.message}`);
  }
  if (!isYamlMapping(value)) {
    throw new TypeError(`${label} must contain a YAML object (${filePath})`);
  }
  return value;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`audio analysis config requires object "${field}"`);
  }
  return value;
}

function requireFiniteFields(value, fields, group) {
  const objectValue = requireObject(value, group);
  for (const field of fields) {
    if (!Number.isFinite(objectValue[field])) {
      throw new TypeError(`audio analysis config requires finite "${group}.${field}"`);
    }
  }
}

/** Validate the complete analyzer-facing configuration without filling gaps. */
export function validateAudioAnalysisConfig(audioConfig) {
  requireObject(audioConfig, 'audio');
  for (const field of REQUIRED_AUDIO_FIELDS) {
    if (!Number.isInteger(audioConfig[field]) || audioConfig[field] <= 0) {
      throw new TypeError(`audio analysis config requires positive integer "audio.${field}"`);
    }
  }
  requireFiniteFields(audioConfig.capture, REQUIRED_CAPTURE_FIELDS, 'audio.capture');
  requireFiniteFields(audioConfig.bands, REQUIRED_BAND_FIELDS, 'audio.bands');
  requireFiniteFields(audioConfig.kick, REQUIRED_KICK_FIELDS, 'audio.kick');
  requireFiniteFields(audioConfig.sub, REQUIRED_SUB_FIELDS, 'audio.sub');
  requireFiniteFields(audioConfig.bpmTracker, REQUIRED_BPM_TRACKER_FIELDS, 'audio.bpmTracker');
  validateStructureDetectorConfig(audioConfig.structureDetector);
  validateDerivedSignalsConfig(audioConfig.derivedSignals);
  if (typeof audioConfig.enabled !== 'boolean') {
    throw new TypeError('audio analysis config requires boolean "audio.enabled"');
  }
  const { sampleRate } = audioConfig.capture;
  if (sampleRate <= 0) {
    throw new RangeError('audio analysis config requires audio.capture.sampleRate > 0');
  }
  if ((audioConfig.fftSize & (audioConfig.fftSize - 1)) !== 0) {
    throw new RangeError('audio analysis config requires audio.fftSize to be a power of two');
  }
  if (audioConfig.hopSize > audioConfig.fftSize) {
    throw new RangeError('audio analysis config requires audio.hopSize <= audio.fftSize');
  }
  const nyquist = sampleRate / 2;
  const bands = audioConfig.bands;
  if (!(bands.lowMaxHz > 20 && bands.lowMaxHz < bands.midMaxHz &&
        bands.midMaxHz <= nyquist)) {
    throw new RangeError(
      'audio analysis config requires 20 < audio.bands.lowMaxHz < ' +
      'audio.bands.midMaxHz <= Nyquist',
    );
  }
  if (!(bands.attackMs > 0 && bands.attackMs <= 5000) ||
      !(bands.releaseMs > 0 && bands.releaseMs <= 5000)) {
    throw new RangeError('audio analysis config requires band attack/release in (0, 5000] ms');
  }
  if (!(bands.noiseGate >= 0 && bands.noiseGate < 1)) {
    throw new RangeError('audio analysis config requires audio.bands.noiseGate in [0, 1)');
  }
  if (!(bands.inputGain >= 0 && bands.inputGain <= 64)) {
    throw new RangeError('audio analysis config requires audio.bands.inputGain in [0, 64]');
  }
  if (!(bands.sourceSmoothHz >= 0 && bands.sourceSmoothHz <= nyquist)) {
    throw new RangeError(
      'audio analysis config requires audio.bands.sourceSmoothHz in [0, Nyquist]',
    );
  }
  for (const field of ['lowGate', 'midGate', 'highGate']) {
    if (bands[field] !== undefined && !(Number.isFinite(bands[field]) &&
        bands[field] >= 0 && bands[field] < 1)) {
      throw new RangeError(`audio analysis config requires audio.bands.${field} in [0, 1)`);
    }
  }
  const kick = audioConfig.kick;
  if (!(kick.minHz > 0 && kick.minHz < kick.maxHz && kick.maxHz <= nyquist)) {
    throw new RangeError(
      'audio analysis config requires 0 < audio.kick.minHz < audio.kick.maxHz <= Nyquist',
    );
  }
  if (!(kick.threshold > 1) || kick.refractoryMs < 0 || !(kick.decayMs > 0)) {
    throw new RangeError('audio analysis config has invalid audio.kick detector timing/threshold');
  }
  const sub = audioConfig.sub;
  if (!(sub.minHz > 0 && sub.minHz < sub.maxHz && sub.maxHz <= nyquist)) {
    throw new RangeError(
      'audio analysis config requires 0 < audio.sub.minHz < audio.sub.maxHz <= Nyquist',
    );
  }
  for (const field of Object.keys(audioConfig.bpmTracker)) {
    if (!ALLOWED_BPM_TRACKER_FIELDS.includes(field)) {
      throw new TypeError(
        `audio analysis config has unknown key "audio.bpmTracker.${field}" ` +
        `(allowed: ${ALLOWED_BPM_TRACKER_FIELDS.join(', ')})`);
    }
  }
  for (const field of REQUIRED_BPM_TRACKER_BOOLEANS) {
    if (typeof audioConfig.bpmTracker[field] !== 'boolean') {
      throw new TypeError(`audio analysis config requires boolean "audio.bpmTracker.${field}"`);
    }
  }
  if (audioConfig.bpmTracker.outputSlewBpmPerSec <= 0) {
    throw new RangeError('audio analysis config requires audio.bpmTracker.outputSlewBpmPerSec > 0');
  }
  if (audioConfig.bpmTracker.minBpm <= 0 ||
      audioConfig.bpmTracker.maxBpm <= audioConfig.bpmTracker.minBpm) {
    throw new RangeError(
      'audio analysis config requires 0 < audio.bpmTracker.minBpm < audio.bpmTracker.maxBpm',
    );
  }
  // activityThreshold is a band level in [0,1]; 0 would make "silence"
  // unreachable and >1 would make every hop silent — both are operator errors.
  if (audioConfig.bpmTracker.activityThreshold <= 0 ||
      audioConfig.bpmTracker.activityThreshold > 1) {
    throw new RangeError(
      'audio analysis config requires 0 < audio.bpmTracker.activityThreshold <= 1');
  }
  if (audioConfig.bpmTracker.silenceResetMs <= 0) {
    throw new RangeError('audio analysis config requires audio.bpmTracker.silenceResetMs > 0');
  }
  return audioConfig;
}

/**
 * Resolve the show configuration exactly as the engine does:
 * config.yaml audio block, then states/<model>/audio_state.yaml.
 */
export function loadEffectiveAudioAnalysisConfig({ engineDir, modelName }) {
  if (typeof engineDir !== 'string' || engineDir.length === 0) {
    throw new TypeError('loadEffectiveAudioAnalysisConfig: engineDir is required');
  }
  if (typeof modelName !== 'string' || modelName.length === 0) {
    throw new TypeError('loadEffectiveAudioAnalysisConfig: modelName is required');
  }
  const configPath = path.join(engineDir, 'config.yaml');
  const statePath = path.join(sceneStateDir(engineDir, modelName), 'audio_state.yaml');
  const rootConfig = readYamlObject(configPath, 'engine config');
  const sceneAudioConfig = readYamlObject(statePath, 'scene audio config');
  const baseAudioConfig = requireObject(rootConfig.audio, 'config.yaml audio');
  const audioConfig = mergeAudioConfig(baseAudioConfig, sceneAudioConfig);
  validateAudioAnalysisConfig(audioConfig);
  return {
    modelName,
    configPath,
    statePath,
    rootConfig,
    sceneAudioConfig,
    audioConfig,
  };
}

/** Build the one authoritative AudioAnalyzer constructor payload. */
export function buildAudioAnalyzerOptions(audioConfig, runtime = {}) {
  validateAudioAnalysisConfig(audioConfig);
  if (typeof runtime.onAnalysis !== 'function') {
    throw new TypeError('buildAudioAnalyzerOptions: runtime.onAnalysis is required');
  }
  const options = {
    sampleRate: audioConfig.capture.sampleRate,
    fftSize: audioConfig.fftSize,
    hopSize: audioConfig.hopSize,
    bands: { ...audioConfig.bands },
    kick: { ...audioConfig.kick },
    sub: { ...audioConfig.sub },
    onAnalysis: runtime.onAnalysis,
  };
  if (runtime.nowFn !== undefined) options.nowFn = runtime.nowFn;
  if (runtime.onConditioned !== undefined) options.onConditioned = runtime.onConditioned;
  return options;
}

export function comparableAudioAnalyzerConfig(audioConfig) {
  const opts = buildAudioAnalyzerOptions(audioConfig, { onAnalysis: () => {} });
  delete opts.onAnalysis;
  return opts;
}

/**
 * Build the authoritative BpmTracker constructor payload.
 *
 * `hopsPerSec` is DERIVED here, never configured: the tracker converts
 * autocorrelation lags to BPM with it, and the hop rate is fully determined by
 * the capture config (`capture.sampleRate / hopSize`) — both of which the
 * operator edits in config.yaml. A constant baked into the tracker would
 * silently mis-scale every tempo the moment either changed, so the tracker has
 * no default for it and this is the only place it is computed.
 */
export function buildBpmTrackerOptions(audioConfig) {
  validateAudioAnalysisConfig(audioConfig);
  const { sampleRate } = audioConfig.capture;
  return { ...audioConfig.bpmTracker, hopsPerSec: sampleRate / audioConfig.hopSize };
}

export { buildDerivedSignalsOptions };
