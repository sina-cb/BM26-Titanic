// Unit tests for lib/state_paths.js — the single seam that decides where
// engine runtime state lives. The MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR
// overrides exist so a test-spawned engine can NEVER write into the
// git-tracked states/ + simulation/scenes/*/playlists trees (incident
// 2026-07-08: leaked runtime state in a tracked audio_state.yaml was
// restored by the next real boot and took the dev stack down).
//
// Run:  cd marsin_engine && node --test tests/state_paths.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import {
  resolveStateRoot, sceneStateDir, resolvePlaylistsDir, stateOverridesActive,
} from '../../lib/state_paths.js';

const ENGINE_DIR = path.resolve('/some', 'repo', 'marsin_engine');

/** Run fn with the two override env vars set/unset exactly as given. */
function withEnv(overrides, fn) {
  const keys = ['MARSIN_STATE_DIR', 'MARSIN_PLAYLISTS_DIR'];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('default (no env): state root is <engineDir>/states', () => {
  withEnv({}, () => {
    assert.equal(resolveStateRoot(ENGINE_DIR), path.join(ENGINE_DIR, 'states'));
    assert.equal(
      sceneStateDir(ENGINE_DIR, 'test_bench'),
      path.join(ENGINE_DIR, 'states', 'test_bench'),
    );
    assert.equal(stateOverridesActive(), false);
  });
});

test('default (no env): playlists dir is <repo>/simulation/scenes/<scene>/playlists', () => {
  withEnv({}, () => {
    assert.equal(
      resolvePlaylistsDir(ENGINE_DIR, 'test_bench'),
      path.join(ENGINE_DIR, '..', 'simulation', 'scenes', 'test_bench', 'playlists'),
    );
  });
});

test('MARSIN_STATE_DIR redirects the state root (and the scene dir under it)', () => {
  const tmp = path.join(os.tmpdir(), 'marsin-states-override');
  withEnv({ MARSIN_STATE_DIR: tmp }, () => {
    assert.equal(resolveStateRoot(ENGINE_DIR), tmp);
    assert.equal(sceneStateDir(ENGINE_DIR, 'test_bench'), path.join(tmp, 'test_bench'));
    assert.equal(stateOverridesActive(), true);
  });
});

test('MARSIN_PLAYLISTS_DIR redirects the playlists dir', () => {
  const tmp = path.join(os.tmpdir(), 'marsin-playlists-override');
  withEnv({ MARSIN_PLAYLISTS_DIR: tmp }, () => {
    assert.equal(resolvePlaylistsDir(ENGINE_DIR, 'anything'), tmp);
    assert.equal(stateOverridesActive(), true);
    // The state root stays tracked-default — overrides are independent.
    assert.equal(resolveStateRoot(ENGINE_DIR), path.join(ENGINE_DIR, 'states'));
  });
});

test('a set-but-relative or empty override FAILS LOUDLY (no silent fallback)', () => {
  // Codex P0: a misconfigured override silently falling back to the tracked
  // tree is exactly the pollution this module exists to prevent.
  withEnv({ MARSIN_STATE_DIR: 'relative/dir' }, () => {
    assert.throws(() => resolveStateRoot(ENGINE_DIR), /MARSIN_STATE_DIR must be an absolute path/);
  });
  withEnv({ MARSIN_STATE_DIR: '' }, () => {
    assert.throws(() => resolveStateRoot(ENGINE_DIR), /MARSIN_STATE_DIR must be an absolute path/);
  });
  withEnv({ MARSIN_PLAYLISTS_DIR: './nope' }, () => {
    assert.throws(
      () => resolvePlaylistsDir(ENGINE_DIR, 'x'),
      /MARSIN_PLAYLISTS_DIR must be an absolute path/,
    );
  });
});

test('sceneStateDir / resolvePlaylistsDir reject a missing model name', () => {
  withEnv({}, () => {
    assert.throws(() => sceneStateDir(ENGINE_DIR, null), /requires a model name/);
    assert.throws(() => sceneStateDir(ENGINE_DIR, ''), /requires a model name/);
    assert.throws(() => resolvePlaylistsDir(ENGINE_DIR, undefined), /requires a model name/);
  });
});
