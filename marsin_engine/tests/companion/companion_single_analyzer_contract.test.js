import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { mergeAudioConfig } from '../../audio/config/audio_config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(here, '..', '..');
const repoDir = path.resolve(engineDir, '..');

// NOTE: this deliberately does NOT read states/titanic/audio_state.yaml.
// That file is live, engine-written, per-scene runtime state (mic
// selection + analyzer tuning) — the operator flips `enabled: true` on it
// legitimately to exercise the engine's own mic path (e.g. with
// `capture.device: test`) for calibration/dev work, and the engine is its
// sole writer. Treating that mutable file as a static contract makes the
// test fail on every legitimate live-tuning session, not on an actual
// regression. The real, static contract lives in two places: the
// PORTABLE default (config.yaml `audio.enabled`, which is what a scene
// gets when it has never been tuned — see audio_config_store.js's
// `loadSceneAudio`: "MISSING file → {}: ... the caller's config.yaml
// defaults are the whole truth") and the production launcher wiring.
test('production Titanic launch has exactly one analyzer: the Audio Companion', () => {
  const base = yaml.load(fs.readFileSync(path.join(engineDir, 'config.yaml'), 'utf8'));
  const launcher = fs.readFileSync(path.join(repoDir, 'launcher.js'), 'utf8');

  assert.equal(base.audio.enabled, false, 'portable engine analyzer default must remain disabled');

  // A scene that has never been live-tuned (no audio_state.yaml override,
  // i.e. the merge's second layer is `{}` exactly as `loadSceneAudio`
  // returns for a missing file) must inherit the portable default and
  // keep the engine's own analyzer OFF, so the Audio Companion stays the
  // sole analyzer until an operator explicitly opts a scene's engine-mic
  // path in.
  const untunedScene = mergeAudioConfig(base.audio, {});
  assert.equal(untunedScene.enabled, false,
    'a scene with no live audio_state.yaml override must not enable the engine analyzer while the Companion runs');

  assert.match(launcher, /companions:\s*\['audio'\]/,
    'the production launcher must supervise the sole Audio Companion analyzer');
});
