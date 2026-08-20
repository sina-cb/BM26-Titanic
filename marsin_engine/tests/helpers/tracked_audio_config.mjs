// ░░ TRACKED-ONLY analyzer config for tests — no scene-state overlay ░░
//
// `loadEffectiveAudioAnalysisConfig()` resolves the SHOW config: tracked
// `config.yaml`, then `states/<scene>/audio_state.yaml` merged OVER it. That is
// exactly right for the engine and the Companion — and exactly wrong for a
// GATE. The scene state file is written by the running engine every time the
// operator turns a knob (`PATCH /audio/config`), so a test built on the
// effective config is scored against whatever the operator's mic gain, FFT
// size, band gates and live-patched derived groups happen to be right now. Two
// machines disagree, and a real regression can hide behind a louder mic.
//
// Measured on one box on 2026-08-14 — live working tree vs tracked config.yaml:
//
//   titanic    bands.inputGain 1 → 9.1, bands.{low,mid,high}Gate absent → 0.04
//   test_bench bands.inputGain 1 → 8.83, bands.noiseGate 0.04 → 0.06,
//              fftSize 2048 → 1024, bands.{low,mid,high}Gate absent → 0.12/0.1/0.14
//
// Under that overlay `tests/integration/audio_analysis_validation.test.mjs`
// reported ZERO drops on both labelled drop clips (3 red tests) purely because
// the operator's gain saturated the energy-jump ratio the detector gates on;
// the same code is green on the tracked config. `_204` found the same hole in
// the published note holdout (`tests/audio/note_estimator_noisy.test.mjs`,
// which carries the long-form version of this note).
//
// So: every test that scores BEHAVIOUR builds its analyzer from here. The
// overlay itself is still covered — `tests/audio/audio_analysis_config.test.js`
// exercises `loadEffectiveAudioAnalysisConfig` directly, which is the one place
// the merge semantics are the subject rather than the substrate.

import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { mergeAudioConfig } from '../../audio/config/audio_config.js';
import { validateAudioAnalysisConfig } from '../../audio/config/audio_analysis_config.js';

/**
 * The analyzer-facing audio config as TRACKED in `config.yaml`, validated the
 * same way the effective loader validates it — with no `states/<scene>/`
 * overlay of any kind.
 *
 * @param {string} engineDir — absolute path to marsin_engine/
 * @returns {object} the validated `audio` block
 */
export function loadTrackedAudioAnalysisConfig(engineDir) {
  if (typeof engineDir !== 'string' || engineDir.length === 0) {
    throw new TypeError('loadTrackedAudioAnalysisConfig: engineDir is required');
  }
  const configPath = path.join(engineDir, 'config.yaml');
  const rootConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
  if (!rootConfig || typeof rootConfig !== 'object' || Array.isArray(rootConfig)) {
    throw new TypeError(`engine config must contain a YAML object (${configPath})`);
  }
  return validateAudioAnalysisConfig(mergeAudioConfig(rootConfig.audio));
}
