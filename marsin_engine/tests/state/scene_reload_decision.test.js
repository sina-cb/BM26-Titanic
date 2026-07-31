// Unit tests for the POST /scene/reload decision seam (report `_33` §5 step 4:
// the deliberate SAME-scene model reload).
//
// These pin the contract that makes the reload safe to hand to the curator:
// it restarts ONLY the active scene, ONLY through requestSceneSwitch, and it
// refuses everything else LOUDLY with an explicit `code` (codex P0 — no silent
// fallback, no substituted scene, no implicit restart).
//
// Pure-function tests — no engine boot, no HTTP, no disk. The live-engine half
// (performance-mode 409, exit-75 handoff, port re-bind) is in
// tests/state/scene_reload_api.test.js.
//
// Run:  node --test tests/state/scene_reload_decision.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sceneReloadDecision } from '../../lib/api_server.js';

// The all-green facts: caller named the active scene, its model is on disk,
// the engine has the switch hook, launcher-supervised.
const OK = Object.freeze({
  requestedScene: 'titanic',
  activeScene: 'titanic',
  modelExists: true,
  hasSwitchHook: true,
  supervised: true,
});

const decide = (over = {}) => sceneReloadDecision({ ...OK, ...over });

test('reloads the ACTIVE scene: 200 + restart, through requestSceneSwitch', () => {
  const r = decide();
  assert.equal(r.status, 200);
  assert.equal(r.restart, true);
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.scene, 'titanic');
  assert.equal(r.body.restarting, true);
  assert.equal(r.body.activeModel, 'titanic');
});

test('surfaces the restart mode so the caller knows who respawns the engine', () => {
  const supervised = decide({ supervised: true });
  assert.equal(supervised.body.supervised, true);
  assert.equal(supervised.body.mode, 'supervised-handoff');

  const standalone = decide({ supervised: false });
  assert.equal(standalone.restart, true, 'standalone still reloads (self-respawn)');
  assert.equal(standalone.body.supervised, false);
  assert.equal(standalone.body.mode, 'standalone-respawn');
});

test('trims the requested name before comparing', () => {
  const r = decide({ requestedScene: '  titanic  ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.scene, 'titanic');
});

// ── Refusals — each one loud, each one a distinct code ────────────────────

test('REFUSES a scene that is not the active one (never an implicit switch)', () => {
  const r = decide({ requestedScene: 'test_bench' });
  assert.equal(r.status, 409);
  assert.equal(r.restart, false);
  assert.equal(r.body.code, 'SCENE_MISMATCH');
  assert.equal(r.body.activeModel, 'titanic');
  assert.match(r.body.error, /POST \/scene to switch scenes/);
});

test('REFUSES a missing/blank/non-string scene (no implicit "reload whatever is live")', () => {
  for (const bad of [undefined, null, '', '   ', 42, {}, [], true]) {
    const r = decide({ requestedScene: bad });
    assert.equal(r.status, 400, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(r.restart, false);
    assert.equal(r.body.code, 'SCENE_REQUIRED');
    assert.equal(r.body.activeModel, 'titanic');
  }
});

test('REFUSES path traversal / nested scene names', () => {
  for (const bad of ['../secrets', 'sub/dir', 'a\\b', './titanic']) {
    const r = decide({ requestedScene: bad, activeScene: bad, modelExists: true });
    assert.equal(r.status, 400, `${bad} must be rejected`);
    assert.equal(r.restart, false);
    assert.equal(r.body.code, 'INVALID_SCENE');
  }
});

test('REFUSES when the model file is gone (never restart toward a missing model)', () => {
  const r = decide({ modelExists: false });
  assert.equal(r.status, 404);
  assert.equal(r.restart, false);
  assert.equal(r.body.code, 'MODEL_NOT_FOUND');
  assert.match(r.body.error, /Save\/export the scene's model/);
});

test('REFUSES when the engine has no active model name', () => {
  for (const bad of [null, undefined, '']) {
    const r = decide({ activeScene: bad });
    assert.equal(r.status, 500);
    assert.equal(r.restart, false);
    assert.equal(r.body.code, 'NO_ACTIVE_MODEL');
  }
});

test('REFUSES when the requestSceneSwitch hook is not wired', () => {
  const r = decide({ hasSwitchHook: false });
  assert.equal(r.status, 500);
  assert.equal(r.restart, false);
  assert.equal(r.body.code, 'NO_RELOAD_HOOK');
});

test('guard order: identity is checked before disk and before the hook', () => {
  // A mismatched scene whose model is missing AND with no hook is still a
  // 409 — the caller learns the REAL problem (wrong scene), not a downstream
  // symptom.
  const r = decide({ requestedScene: 'other', modelExists: false, hasSwitchHook: false });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SCENE_MISMATCH');
});

test('no refusal ever reports restart:true', () => {
  const refusals = [
    decide({ requestedScene: '' }),
    decide({ requestedScene: 'other' }),
    decide({ requestedScene: 'a/b' }),
    decide({ modelExists: false }),
    decide({ activeScene: null }),
    decide({ hasSwitchHook: false }),
  ];
  for (const r of refusals) {
    assert.equal(r.restart, false);
    assert.notEqual(r.status, 200);
    assert.ok(r.body.code, 'every refusal carries a machine-readable code');
  }
});
