/*
 * strict_save.test.js — regression for L5 (reports _115 / _116 / _120):
 * StateManager.save() SWALLOWED every write failure with a console.warn, so the
 * deck/mixer/globals branch of POST /settings/save-now could report a lying 200
 * {saved:true} on a disk-full/EBUSY write — the CaptainPad "✓ SAVED" badge reads
 * that response.
 *
 * The fix is a STRICT / BEST-EFFORT split at the exact save seam:
 *   - the ~80 render-adjacent AUTO-SAVE triggers call save() WITHOUT `strict`
 *     and stay BEST-EFFORT (warn-only, never throw) — a transient disk blip must
 *     never crash the ship (W1-1's uncaughtException backstop exits(1) on any
 *     surviving throw);
 *   - ONLY the explicit operator save (save-now) passes `{ strict:true }`, so a
 *     failed write PROPAGATES and the endpoint returns an honest non-200.
 *
 * This file pins that split at the StateManager level (deterministic, no engine
 * subprocess). The endpoint wiring itself (save-now → non-200; an auto-save over
 * the same broken dir keeps the engine up) is proven end-to-end in
 * tests/e2e/save_now_honesty_e2e.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { StateManager } from '../../lib/state_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'strict_save_'));
}

// A StateManager whose stateDir has been REPLACED BY A FILE, so every atomic
// write into it fails at openSync (ENOTDIR) — the operator's own suggested way
// to force a write failure. The manager is constructed against a real dir first
// (its constructor mkdirs), then the dir is swapped for a file.
function brokenStateManager() {
  const parent = tmpStateDir();
  const stateDir = path.join(parent, 'scene');
  const sm = new StateManager(stateDir); // ctor mkdirs stateDir
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.writeFileSync(stateDir, 'not a directory', 'utf8'); // writes now fail
  return sm;
}

// Minimal PatternChannel stand-in — serializeChannel reads only plain fields.
function fakeChannel(overrides = {}) {
  return {
    id: 'ch_base_1', name: 'Base', pattern: '13_sparkle', mode: 'blend_screen',
    fader: 1, enabled: true, locked: false, faderLocked: false,
    localControls: {}, playlist: null,
    viewSelection: { type: 'all', target: null, invert: false },
    ...overrides,
  };
}

function fakeMixer() {
  return {
    master: 1,
    getMixerChannels: () => [],
    getDeckChannel: () => fakeChannel(),
    getMixGroups: () => [],
    tempoBpm: null,
    tempoSourcePref: 'osc',
  };
}

function fakeGlobals() {
  return { blackout: false, effects: {}, params: {}, dimmers: {}, invert: false };
}

// ── save(): the strict flag decides swallow vs throw ──────────────────────

test('save() DEFAULT is best-effort — a failed write is swallowed (warn-only, no throw)', () => {
  const sm = brokenStateManager();
  // Must NOT throw — this is the auto-save contract (a transient disk blip during
  // one of the ~80 auto triggers can never reach W1-1's process backstop).
  assert.doesNotThrow(() => sm.save('globals_state.yaml', { a: 1 }));
});

test('save({ strict:true }) PROPAGATES a failed write (no swallow)', () => {
  const sm = brokenStateManager();
  assert.throws(() => sm.save('globals_state.yaml', { a: 1 }, { strict: true }),
    'the explicit operator save must propagate a write failure, never swallow it');
});

// ── the three public save methods thread the flag through ─────────────────

test('saveMixerState/saveDeckState/saveGlobalsState default best-effort (never throw on a broken dir)', () => {
  const sm = brokenStateManager();
  const mixer = fakeMixer();
  assert.doesNotThrow(() => sm.saveMixerState(mixer));
  assert.doesNotThrow(() => sm.saveDeckState(mixer, { transitionConfig: {} }));
  assert.doesNotThrow(() => sm.saveGlobalsState(fakeGlobals(), null));
});

test('saveMixerState({ strict:true }) throws on a broken dir', () => {
  const sm = brokenStateManager();
  assert.throws(() => sm.saveMixerState(fakeMixer(), { strict: true }));
});

test('saveDeckState({ strict:true }) throws on a broken dir', () => {
  const sm = brokenStateManager();
  assert.throws(() => sm.saveDeckState(fakeMixer(), { transitionConfig: {} }, { strict: true }));
});

test('saveGlobalsState({ strict:true }) throws on a broken dir', () => {
  const sm = brokenStateManager();
  assert.throws(() => sm.saveGlobalsState(fakeGlobals(), null, { strict: true }));
});

// ── strict does NOT change the happy path (writes still land, byte-identical) ─

test('strict:true still writes normally when the dir is healthy (auto-save output unchanged)', () => {
  const dir = tmpStateDir();
  const smBest = new StateManager(path.join(dir, 'best'));
  const smStrict = new StateManager(path.join(dir, 'strict'));
  const mixer = fakeMixer();

  smBest.saveMixerState(mixer);                                    // auto-save path
  smStrict.saveMixerState(mixer, { strict: true });               // save-now path
  const best = fs.readFileSync(path.join(dir, 'best', 'mixer_state.yaml'), 'utf8');
  const strict = fs.readFileSync(path.join(dir, 'strict', 'mixer_state.yaml'), 'utf8');
  assert.equal(strict, best, 'strict save must produce byte-identical output to the best-effort save');
  // sanity: it is a real, parseable mixer file
  assert.ok(yaml.load(strict).master === 1);
});
