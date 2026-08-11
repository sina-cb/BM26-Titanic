import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { mergeAudioConfig } from './audio_config.js';

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
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
  const statePath = path.join(engineDir, 'states', modelName, 'audio_state.yaml');
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
