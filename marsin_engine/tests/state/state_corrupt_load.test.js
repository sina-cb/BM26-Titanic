/**
 * state_corrupt_load.test.js — corrupt state YAML behavior, pinned (catalog
 * `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md` G-6, rank 6).
 *
 * `lib/state_manager.js:109-117` (`StateManager.load`) catches ANY error
 * (unreadable file, corrupt YAML) and silently returns `defaultState` after a
 * `console.warn`. Before this file nothing pinned the corrupt-file case for
 * `mixer_state.yaml` / `deck_state.yaml` / `globals_state.yaml` — only the
 * WRITE-failure path (`state_atomicity.test.js`) and a malformed VALUE inside
 * otherwise-valid YAML (`settings_state.test.js`) were covered.
 *
 * P0 TENSION (catalog N-1, unresolved — flagged for the reviewer, not this
 * agent's call): the codex says fail loudly; deck-restore already has a
 * visible degrade flag (`/status.deckRestoreDegraded`,
 * `lib/api_server.js:4967`). Corrupt STATE has no equivalent — the operator
 * cannot tell from `/status` that the mixer booted on defaults because the
 * YAML on disk was garbage. Test 5 below pins today's behavior (silent limp,
 * `console.warn` only) and carries the ruling question; it is not this
 * agent's place to add a `/status.stateRestoreDegraded` flag (production
 * code) — follow-up goes on the Notion board per this suite's report.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StateManager } from '../../lib/state_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state-corrupt-'));
}

function withPatchedWarn(fn) {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args.map(String).join(' '));
  try {
    return { result: fn(), calls };
  } finally {
    console.warn = orig;
  }
}

test('corrupt mixer_state.yaml: loadMixerState() returns the documented default and warns naming the file', () => {
  const dir = tmpStateDir();
  fs.writeFileSync(path.join(dir, 'mixer_state.yaml'), '{{{ not yaml');
  const sm = new StateManager(dir);
  const { result, calls } = withPatchedWarn(() => sm.loadMixerState());
  assert.deepEqual(result, { master: 1.0, channels: [], patternControls: {}, mixGroups: [] });
  assert.equal(calls.length, 1, 'exactly one warn line');
  assert.match(calls[0], /mixer_state\.yaml/, 'warn names the filename');
});

test('corrupt deck_state.yaml: loadDeckState() returns { channel: null } and warns', () => {
  const dir = tmpStateDir();
  fs.writeFileSync(path.join(dir, 'deck_state.yaml'), '{{{ not yaml');
  const sm = new StateManager(dir);
  const { result, calls } = withPatchedWarn(() => sm.loadDeckState());
  assert.deepEqual(result, { channel: null });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /deck_state\.yaml/);
});

test('corrupt globals_state.yaml: loadGlobalsState() returns the documented defaults and warns', () => {
  const dir = tmpStateDir();
  fs.writeFileSync(path.join(dir, 'globals_state.yaml'), '{{{ not yaml');
  const sm = new StateManager(dir);
  const { result, calls } = withPatchedWarn(() => sm.loadGlobalsState());
  assert.deepEqual(result, { blackout: false, effects: {}, params: {}, dimmers: {}, invert: false });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /globals_state\.yaml/);
});

test('truncated mid-document YAML: a valid file chopped mid-stream throws through js-yaml and still limps to default', () => {
  const dir = tmpStateDir();
  // A syntactically valid multi-line mapping, truncated inside a flow scalar
  // so js-yaml cannot parse a complete document.
  const valid = 'master: 1.0\nchannels:\n  - id: ch_1\n    name: "Channel one long enough to chop';
  const truncated = valid.slice(0, 40);
  fs.writeFileSync(path.join(dir, 'mixer_state.yaml'), truncated);
  const sm = new StateManager(dir);
  const { result, calls } = withPatchedWarn(() => sm.loadMixerState());
  assert.deepEqual(result, { master: 1.0, channels: [], patternControls: {}, mixGroups: [] });
  assert.equal(calls.length, 1, 'the truncated document must fail to parse and warn exactly once');
});

test('empty file: yaml.load("") is undefined, falls through the `|| defaultState`, and does NOT warn', () => {
  const dir = tmpStateDir();
  fs.writeFileSync(path.join(dir, 'deck_state.yaml'), '');
  const sm = new StateManager(dir);
  const { result, calls } = withPatchedWarn(() => sm.loadDeckState());
  assert.deepEqual(result, { channel: null });
  assert.equal(calls.length, 0, 'an empty file is not an ERROR (no throw), so no warn is emitted');
});

test('NEEDS-RULING: corrupt state is a silent limp with no /status flag (catalog N-1)', () => {
  // Pins TODAY's behavior so a future change to add visibility is a
  // deliberate, test-driven decision, not an accidental regression either
  // way. The ruling question: should StateManager.load() failures surface a
  // `/status.stateRestoreDegraded` array, mirroring deckRestoreDegraded
  // (api_server.js:4967)? File the follow-up on the Notion board when this
  // lands — this test only proves the CURRENT gap exists.
  const dir = tmpStateDir();
  fs.writeFileSync(path.join(dir, 'globals_state.yaml'), '{{{ not yaml');
  const sm = new StateManager(dir);
  const { result } = withPatchedWarn(() => sm.loadGlobalsState());
  // The StateManager has no method and no field anywhere that reports "the
  // last load degraded" — the only signal is the console.warn line, which
  // does not reach /status. Assert that surface directly: no degraded-style
  // property leaks onto the returned state object.
  assert.equal('stateRestoreDegraded' in result, false);
  assert.equal(typeof sm.stateRestoreDegraded, 'undefined');
  assert.equal(typeof sm.getDegradedLoads, 'undefined');
});
