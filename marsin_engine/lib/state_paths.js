/**
 * state_paths — the SINGLE seam that resolves where the engine's runtime
 * state lives on disk.
 *
 * Why this exists (incident 2026-07-08): the per-scene state files under
 * `marsin_engine/states/<scene>/` are TRACKED in git — they are the
 * operator's saved show state. A test that spawns a real engine (e.g.
 * tests/playlist_api.test.js) used to make that engine write runtime state
 * straight into the tracked tree; one such run left a bogus
 * `capture.device: test` in states/test_bench/audio_state.yaml, and the
 * next real boot restored it, spun ffmpeg into a crash loop, and took the
 * dev stack down.
 *
 * The fix: every path into the states tree resolves through here, and two
 * environment overrides let a test/HIL harness redirect ALL engine state
 * writes into a temp directory so a spawned engine can NEVER mutate the
 * tracked tree:
 *
 *   MARSIN_STATE_DIR      — replaces `<engineDir>/states` (the state root).
 *   MARSIN_PLAYLISTS_DIR  — replaces `<repo>/simulation/scenes/<scene>/playlists`.
 *
 * Both must be ABSOLUTE paths; a set-but-relative/empty value throws at
 * boot (codex P0: no silent fallback — a misconfigured override must fail
 * loudly, not quietly write into the tracked tree anyway).
 */

import path from 'path';

/**
 * Root directory that holds the per-scene state dirs. Defaults to the
 * tracked `<engineDir>/states`; `MARSIN_STATE_DIR` overrides it.
 *
 * @param {string} engineDir — absolute path to marsin_engine/
 * @returns {string}
 */
export function resolveStateRoot(engineDir) {
  return _resolveOverride('MARSIN_STATE_DIR', () => path.join(engineDir, 'states'));
}

/**
 * Per-scene state dir (`<stateRoot>/<modelName>`) — audio_state.yaml,
 * deck_state.yaml, mixer_state.yaml, … all live here.
 *
 * @param {string} engineDir — absolute path to marsin_engine/
 * @param {string} modelName — scene/model name (e.g. 'test_bench')
 * @returns {string}
 */
export function sceneStateDir(engineDir, modelName) {
  if (!modelName || typeof modelName !== 'string') {
    throw new TypeError(`sceneStateDir requires a model name, got: ${JSON.stringify(modelName)}`);
  }
  return path.join(resolveStateRoot(engineDir), modelName);
}

/**
 * Per-scene playlist library dir. Defaults to the tracked
 * `<repo>/simulation/scenes/<scene>/playlists`; `MARSIN_PLAYLISTS_DIR`
 * overrides it (all scenes then share the override dir — fine for the
 * single-scene test harnesses this exists for).
 *
 * @param {string} engineDir — absolute path to marsin_engine/
 * @param {string} modelName — scene/model name (e.g. 'test_bench')
 * @returns {string}
 */
export function resolvePlaylistsDir(engineDir, modelName) {
  if (!modelName || typeof modelName !== 'string') {
    throw new TypeError(`resolvePlaylistsDir requires a model name, got: ${JSON.stringify(modelName)}`);
  }
  return _resolveOverride(
    'MARSIN_PLAYLISTS_DIR',
    () => path.join(engineDir, '..', 'simulation', 'scenes', modelName, 'playlists'),
  );
}

/** True when either state-redirect override is active (for boot logging). */
export function stateOverridesActive() {
  return process.env.MARSIN_STATE_DIR !== undefined
    || process.env.MARSIN_PLAYLISTS_DIR !== undefined;
}

function _resolveOverride(envKey, defaultFn) {
  const override = process.env[envKey];
  if (override === undefined) return defaultFn();
  if (!override || !path.isAbsolute(override)) {
    // Fail loud: a set-but-bogus override silently falling back to the
    // tracked tree is exactly the pollution this module exists to prevent.
    throw new Error(
      `${envKey} must be an absolute path when set, got: ${JSON.stringify(override)}`,
    );
  }
  return override;
}
