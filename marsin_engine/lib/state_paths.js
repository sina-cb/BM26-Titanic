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
 *   MARSIN_TIMELINE_DIR   — replaces `<repo>/simulation/scenes/<scene>/timeline`
 *                           (the SHOW PLAN library). Added for the timeline e2e
 *                           suite (report `_100`): every timeline scenario needs
 *                           throwaway plans (an in-window fixture, a dormant
 *                           rehearsal plan), and `POST /timeline/plans` writes
 *                           them straight into the operator's tracked scene
 *                           tree. Two prior threads (`_95`, `_97`) had to
 *                           hand-restore that tree afterwards; this seam means a
 *                           spawned test engine simply cannot reach it.
 *
 * All three must be ABSOLUTE paths; a set-but-relative/empty value throws at
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

/**
 * Per-scene SHOW PLAN library dir. Defaults to the tracked
 * `<repo>/simulation/scenes/<scene>/timeline`; `MARSIN_TIMELINE_DIR`
 * overrides it (all scenes then share the override dir — fine for the
 * single-scene test harnesses this exists for).
 *
 * @param {string} engineDir — absolute path to marsin_engine/
 * @param {string} modelName — scene/model name (e.g. 'test_bench')
 * @returns {string}
 */
export function resolveTimelineDir(engineDir, modelName) {
  if (!modelName || typeof modelName !== 'string') {
    throw new TypeError(`resolveTimelineDir requires a model name, got: ${JSON.stringify(modelName)}`);
  }
  return _resolveOverride(
    'MARSIN_TIMELINE_DIR',
    () => path.join(engineDir, '..', 'simulation', 'scenes', modelName, 'timeline'),
  );
}

/**
 * Per-scene SPECIAL EVENT show library dir (docs/52). Defaults to the tracked
 * `<repo>/simulation/scenes/<scene>/special_events`;
 * `MARSIN_SPECIAL_EVENTS_DIR` overrides it, so the special-events suites can
 * author throwaway shows (including deliberately BROKEN ones, to prove the
 * loud-refusal path) without ever writing into the operator's scene tree.
 *
 * @param {string} engineDir — absolute path to marsin_engine/
 * @param {string} modelName — scene/model name (e.g. 'test_bench')
 * @returns {string}
 */
export function resolveSpecialEventsDir(engineDir, modelName) {
  if (!modelName || typeof modelName !== 'string') {
    throw new TypeError(`resolveSpecialEventsDir requires a model name, got: ${JSON.stringify(modelName)}`);
  }
  return _resolveOverride(
    'MARSIN_SPECIAL_EVENTS_DIR',
    () => path.join(engineDir, '..', 'simulation', 'scenes', modelName, 'special_events'),
  );
}

/** True when any state-redirect override is active (for boot logging). */
export function stateOverridesActive() {
  return process.env.MARSIN_STATE_DIR !== undefined
    || process.env.MARSIN_PLAYLISTS_DIR !== undefined
    || process.env.MARSIN_TIMELINE_DIR !== undefined
    || process.env.MARSIN_SPECIAL_EVENTS_DIR !== undefined;
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
