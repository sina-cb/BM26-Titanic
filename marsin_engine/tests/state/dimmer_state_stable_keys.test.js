/**
 * tests/state/dimmer_state_stable_keys.test.js
 *
 * Persisted per-group dimmer state used to be keyed by NUMERIC section id
 * (globals_state.yaml → dimmers). Section ids are minted by the simulation's
 * controller registry ("next free id" per group) and are RE-MINTED whenever
 * the operator regenerates the scene/model — so every model regeneration
 * orphaned the saved brightness and the Dimmer Rack fell back to 1.0
 * (report 20260725_122, live-stack finding: model moved 486-498 → 500+).
 *
 * Fix under test (StateManager.migrateDimmersToGroupKeys +
 * applyGlobalsState's groupToSectionId resolution):
 *  - dimmer state is keyed by STABLE GROUP NAME;
 *  - legacy id-keyed files migrate forward on load (one-time, idempotent);
 *  - values survive a section-id renumbering because names resolve against
 *    the CURRENT model at apply time;
 *  - orphaned keys (id/name matching no current group) warn LOUDLY and are
 *    preserved in the file untouched — never silently deleted or defaulted.
 *
 * Pure StateManager tests — no engine spawn, no network, tmp state dirs.
 *
 * Run:  node --test tests/state/dimmer_state_stable_keys.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import yaml from 'js-yaml';

import { StateManager } from '../../lib/state_manager.js';

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dimmer_keys_${label}_`));
}

// Minimal double for IntensityController — records every call.
function fakeIntensity() {
  const calls = [];
  return {
    calls,
    setSectionBrightness(sectionId, val) { calls.push([sectionId, val]); },
    setBlackout() {},
  };
}

function captureWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return warnings;
}

// Model generation A: the ids the legacy state file was saved against.
const GROUPS_A = { 'TE Sign': 3, 'Left Wall': 486, 'Right Wall': 487 };
// Model generation B: same groups, operator regenerated the scene — every
// wall id re-minted (the exact 486→500+ churn from report _122).
const GROUPS_B = { 'TE Sign': 3, 'Left Wall': 500, 'Right Wall': 501 };

test('legacy id-keyed dimmer state migrates to group-name keys on load', () => {
  const dir = tmpDir('migrate');
  fs.writeFileSync(path.join(dir, 'globals_state.yaml'), yaml.dump({
    blackout: false, effects: {}, params: {},
    dimmers: { 3: 0.21, 486: 0.13, 487: 0.09 },
  }));
  const sm = new StateManager(dir);
  const state = sm.loadGlobalsState();
  const result = sm.migrateDimmersToGroupKeys(state, GROUPS_A);

  assert.equal(result.migrated, 3);
  assert.deepEqual(result.orphaned, []);
  assert.deepEqual(state.dimmers, {
    'TE Sign': 0.21, 'Left Wall': 0.13, 'Right Wall': 0.09,
  });
});

test('migration is idempotent — a second run changes nothing', () => {
  const state = { dimmers: { 486: 0.13 } };
  const sm = new StateManager(tmpDir('idem'));
  sm.migrateDimmersToGroupKeys(state, GROUPS_A);
  const after = { ...state.dimmers };
  const second = sm.migrateDimmersToGroupKeys(state, GROUPS_A);
  assert.equal(second.migrated, 0);
  assert.deepEqual(second.orphaned, []);
  assert.deepEqual(state.dimmers, after);
});

test('renumbered model keeps values by name across a save/load round-trip', () => {
  const dir = tmpDir('renumber');
  // 1. Legacy file written against model A.
  fs.writeFileSync(path.join(dir, 'globals_state.yaml'), yaml.dump({
    blackout: false, effects: {}, params: {},
    dimmers: { 3: 0.21, 486: 0.13, 487: 0.09 },
  }));
  const sm = new StateManager(dir);

  // 2. Boot #1 against model A: migrate + save (the engine's next
  //    saveGlobals persists the migrated shape).
  const state1 = sm.loadGlobalsState();
  sm.migrateDimmersToGroupKeys(state1, GROUPS_A);
  sm.saveGlobalsState(state1);

  // 3. Operator regenerates the scene → boot #2 against model B, in which
  //    every wall section id changed. Values must land on the NEW ids.
  const state2 = sm.loadGlobalsState();
  const result = sm.migrateDimmersToGroupKeys(state2, GROUPS_B);
  assert.equal(result.migrated, 0, 'name keys need no re-migration');
  assert.deepEqual(result.orphaned, []);

  const ic = fakeIntensity();
  sm.applyGlobalsState(state2, null, ic, null, GROUPS_B);
  assert.deepEqual(
    new Map(ic.calls),
    new Map([[3, 0.21], [500, 0.13], [501, 0.09]]),
    'brightness follows the group NAME onto the re-minted section ids');
});

test('orphaned id keys warn loudly and survive the round-trip untouched', () => {
  const dir = tmpDir('orphan');
  fs.writeFileSync(path.join(dir, 'globals_state.yaml'), yaml.dump({
    blackout: false, effects: {}, params: {},
    // 189 and 999 map to no group in either model generation.
    dimmers: { 3: 0.21, 189: 0.0, 999: 0.5 },
  }));
  const sm = new StateManager(dir);
  const state = sm.loadGlobalsState();

  const warnings = captureWarnings(() => {
    const result = sm.migrateDimmersToGroupKeys(state, GROUPS_B);
    assert.equal(result.migrated, 1);
    assert.deepEqual(result.orphaned.sort(), ['189', '999']);
  });
  const orphanWarning = warnings.find(w => w.includes('orphaned'));
  assert.ok(orphanWarning, 'a loud warning names the orphaned keys');
  assert.ok(orphanWarning.includes('189') && orphanWarning.includes('999'),
    `warning lists both orphan keys: ${orphanWarning}`);

  // Orphans preserved in memory…
  assert.equal(state.dimmers['189'], 0.0);
  assert.equal(state.dimmers['999'], 0.5);
  assert.equal(state.dimmers['TE Sign'], 0.21);

  // …and on disk after the next save (never silently deleted).
  sm.saveGlobalsState(state);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'globals_state.yaml'), 'utf8'));
  assert.equal(onDisk.dimmers['189'], 0.0);
  assert.equal(onDisk.dimmers['999'], 0.5);
  assert.equal(onDisk.dimmers['TE Sign'], 0.21);
});

test('half-migrated file: name-keyed value wins over legacy id duplicate', () => {
  const state = { dimmers: { 'Left Wall': 0.42, 486: 0.13 } };
  const sm = new StateManager(tmpDir('dup'));
  const warnings = captureWarnings(() => {
    const result = sm.migrateDimmersToGroupKeys(state, GROUPS_A);
    assert.equal(result.migrated, 0);
  });
  assert.deepEqual(state.dimmers, { 'Left Wall': 0.42 },
    'name-keyed value kept, legacy duplicate dropped');
  assert.ok(warnings.some(w => w.includes('duplicates')),
    'dropping the duplicate is loud, never silent');
});

test('applyGlobalsState: legacy numeric keys still apply verbatim (old snapshots)', () => {
  // A pre-fix snapshot restored through applyGlobalsState carries numeric
  // keys and no name mapping — it must behave exactly as before the fix.
  const sm = new StateManager(tmpDir('legacy_apply'));
  const ic = fakeIntensity();
  sm.applyGlobalsState({ dimmers: { 5: 0.7, 18: 0.11 } }, null, ic, null, GROUPS_B);
  assert.deepEqual(new Map(ic.calls), new Map([[5, 0.7], [18, 0.11]]));
});

test('applyGlobalsState preserves an intentional all-zero Dimmer Rack', () => {
  const sm = new StateManager(tmpDir('all_zero_authority'));
  const ic = fakeIntensity();
  const state = { dimmers: { 'TE Sign': 0, 'Left Wall': 0, 'Right Wall': 0 } };
  sm.applyGlobalsState(state, null, ic, null, GROUPS_B);
  assert.deepEqual(
    new Map(ic.calls),
    new Map([[3, 0], [500, 0], [501, 0]]),
    'rack zero is authoritative and must not be silently repaired',
  );
  assert.deepEqual(state.dimmers, { 'TE Sign': 0, 'Left Wall': 0, 'Right Wall': 0 });
});

test('applyGlobalsState: unknown group name warns and is skipped, never guessed', () => {
  const sm = new StateManager(tmpDir('unknown_name'));
  const ic = fakeIntensity();
  const warnings = captureWarnings(() => {
    sm.applyGlobalsState(
      { dimmers: { 'Removed Group': 0.3, 'TE Sign': 0.21 } }, null, ic, null, GROUPS_B);
  });
  assert.deepEqual(ic.calls, [[3, 0.21]], 'only the resolvable group applies');
  assert.ok(warnings.some(w => w.includes('Removed Group')),
    'the unresolvable group is named in a loud warning');
});
