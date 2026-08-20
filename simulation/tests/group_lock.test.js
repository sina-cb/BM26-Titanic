/**
 * Tests for GROUP LOCK helpers (src/core/group_lock.js) + lock/master
 * persistence (pruneGroupOverrides). Pure modules — no DOM/THREE — so they run
 * under `node --test`.
 *
 * Covers: which fixtures a locked group ties together, the TE Sign A ≡ B
 * classifier, the LED display-group key shared by GUI + exporter, the LED group
 * master RGB scale (the "real, not fake" direct-paint override), and that the
 * `locked` flag survives the scene save prune.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ledDisplayGroup,
  isGroupLocked,
  parGroupMemberIndices,
  strandGroupMemberIndices,
  isTeSignConfigs,
  scaleRgbForLedOutput,
  ledOutputScale,
  UNGROUPED_LABEL,
} from '../src/core/group_lock.js';
import { TE_SIGN_TYPE_A, TE_SIGN_TYPE_B } from '../src/fixtures/te_sign_generator.js';
import { pruneGroupOverrides } from '../src/core/config.js';

// ── ledDisplayGroup ──────────────────────────────────────────────────────

test('ledDisplayGroup: trims a named group, else Ungrouped', () => {
  assert.equal(ledDisplayGroup({ group: 'Bow' }), 'Bow');
  assert.equal(ledDisplayGroup({ group: '  Hull  ' }), 'Hull');
  assert.equal(ledDisplayGroup({ group: '' }), UNGROUPED_LABEL);
  assert.equal(ledDisplayGroup({ group: '   ' }), UNGROUPED_LABEL);
  assert.equal(ledDisplayGroup({}), UNGROUPED_LABEL);
  assert.equal(ledDisplayGroup(null), UNGROUPED_LABEL);
});

// ── isGroupLocked ────────────────────────────────────────────────────────

test('isGroupLocked: true only when the bag carries locked === true', () => {
  assert.equal(isGroupLocked({ A: { locked: true } }, 'A'), true);
  assert.equal(isGroupLocked({ A: { locked: false } }, 'A'), false);
  assert.equal(isGroupLocked({ A: { enabled: false } }, 'A'), false);
  assert.equal(isGroupLocked({}, 'A'), false);
  assert.equal(isGroupLocked(undefined, 'A'), false);
  assert.equal(isGroupLocked({ A: { locked: true } }, undefined), false);
});

// ── member index collection ──────────────────────────────────────────────

test('parGroupMemberIndices: all configs in the group (missing ⇒ Default)', () => {
  const cfgs = [
    { group: 'TE Sign' }, { group: 'Bow' }, { group: 'TE Sign' }, {}, { group: 'Default' },
  ];
  assert.deepEqual(parGroupMemberIndices(cfgs, 'TE Sign'), [0, 2]);
  assert.deepEqual(parGroupMemberIndices(cfgs, 'Bow'), [1]);
  // index 3 has no group ⇒ counts as Default alongside index 4
  assert.deepEqual(parGroupMemberIndices(cfgs, 'Default'), [3, 4]);
  assert.deepEqual(parGroupMemberIndices([], 'X'), []);
});

test('strandGroupMemberIndices: buckets by display group', () => {
  const strands = [
    { group: 'Ropes' }, { group: '' }, { group: 'Ropes' }, { group: '  ' },
  ];
  assert.deepEqual(strandGroupMemberIndices(strands, 'Ropes'), [0, 2]);
  assert.deepEqual(strandGroupMemberIndices(strands, UNGROUPED_LABEL), [1, 3]);
});

// ── TE Sign classifier ───────────────────────────────────────────────────

test('isTeSignConfigs: true only when EVERY member is a TE Sign half', () => {
  assert.equal(isTeSignConfigs([{ fixtureType: TE_SIGN_TYPE_A }, { fixtureType: TE_SIGN_TYPE_B }]), true);
  assert.equal(isTeSignConfigs([{ fixtureType: TE_SIGN_TYPE_A }]), true);
  // A stray non-sign fixture disqualifies the set (so applyTeSignPlacement
  // never clobbers a non-half with the sign transform).
  assert.equal(isTeSignConfigs([{ fixtureType: TE_SIGN_TYPE_A }, { fixtureType: 'UkingPar' }]), false);
  assert.equal(isTeSignConfigs([]), false);
});

// ── scaleRgbForLedOutput (master + group RGB scale, real output override) ──

test('scaleRgbForLedOutput: no override ⇒ unchanged', () => {
  assert.deepEqual(scaleRgbForLedOutput(true, {}, 'A', 1, 0.5, 0.2), [1, 0.5, 0.2]);
  assert.deepEqual(scaleRgbForLedOutput(undefined, undefined, 'A', 1, 1, 1), [1, 1, 1]);
  assert.deepEqual(scaleRgbForLedOutput(true, { A: { brightness: 100 } }, 'A', 0.8, 0.4, 0.1), [0.8, 0.4, 0.1]);
});

test('scaleRgbForLedOutput: brightness scales linearly', () => {
  assert.deepEqual(scaleRgbForLedOutput(true, { A: { brightness: 50 } }, 'A', 1, 0.6, 0.2), [0.5, 0.3, 0.1]);
  assert.deepEqual(scaleRgbForLedOutput(true, { A: { brightness: 0 } }, 'A', 1, 1, 1), [0, 0, 0]);
});

test('scaleRgbForLedOutput: group Off ⇒ black regardless of brightness', () => {
  assert.deepEqual(scaleRgbForLedOutput(true, { A: { enabled: false, brightness: 100 } }, 'A', 1, 1, 1), [0, 0, 0]);
});

test('scaleRgbForLedOutput: GLOBAL master Off ⇒ black, overriding a full-on group', () => {
  assert.deepEqual(scaleRgbForLedOutput(false, { A: { enabled: true, brightness: 100 } }, 'A', 1, 1, 1), [0, 0, 0]);
});

test('scaleRgbForLedOutput: lock-only override (default master) does not dim', () => {
  // A group that is locked but at its master default must NOT scale output.
  assert.deepEqual(scaleRgbForLedOutput(true, { A: { enabled: true, brightness: 100, locked: true } }, 'A', 1, 1, 1), [1, 1, 1]);
});

// ── ledOutputScale (last-layer LED output gate: master + group) ──────────

test('ledOutputScale: all-on ⇒ 1 (no gating)', () => {
  assert.equal(ledOutputScale(true, {}, 'A'), 1);
  assert.equal(ledOutputScale(undefined, undefined, 'A'), 1); // undefined master = enabled
  assert.equal(ledOutputScale(true, { A: { enabled: true, brightness: 100 } }, 'A'), 1);
});

test('ledOutputScale: GLOBAL master OFF ⇒ 0 (black), overriding a full-on group', () => {
  assert.equal(ledOutputScale(false, {}, 'A'), 0);
  assert.equal(ledOutputScale(false, { A: { enabled: true, brightness: 100 } }, 'A'), 0);
});

test('ledOutputScale: group OFF ⇒ 0 regardless of brightness', () => {
  assert.equal(ledOutputScale(true, { A: { enabled: false, brightness: 100 } }, 'A'), 0);
});

test('ledOutputScale: group brightness scales linearly (0..1)', () => {
  assert.equal(ledOutputScale(true, { A: { brightness: 50 } }, 'A'), 0.5);
  assert.equal(ledOutputScale(true, { A: { brightness: 0 } }, 'A'), 0);
  assert.equal(ledOutputScale(true, { A: { brightness: 25 } }, 'A'), 0.25);
});

test('ledOutputScale: Ungrouped bucket key resolves like any other group', () => {
  // The exporter tags ungrouped LED pixels with displayGroup = UNGROUPED_LABEL,
  // so an OFF Ungrouped master must black them out.
  assert.equal(ledOutputScale(true, { [UNGROUPED_LABEL]: { enabled: false } }, UNGROUPED_LABEL), 0);
  assert.equal(ledOutputScale(true, { [UNGROUPED_LABEL]: { brightness: 40 } }, UNGROUPED_LABEL), 0.4);
});

// ── persistence: locked survives the save prune ──────────────────────────

test('pruneGroupOverrides: keeps a lock-only group and preserves locked', () => {
  const clean = pruneGroupOverrides({ A: { enabled: true, brightness: 100, locked: true } });
  assert.deepEqual(clean, { A: { enabled: true, brightness: 100, locked: true } });
});

test('pruneGroupOverrides: default+unlocked group is dropped (scene stays clean)', () => {
  assert.deepEqual(pruneGroupOverrides({ A: { enabled: true, brightness: 100 } }), {});
  assert.deepEqual(pruneGroupOverrides({ A: { enabled: true, brightness: 100, locked: false } }), {});
});

test('pruneGroupOverrides: master-only group persists WITHOUT a locked key', () => {
  const clean = pruneGroupOverrides({ A: { enabled: false, brightness: 40 } });
  assert.deepEqual(clean, { A: { enabled: false, brightness: 40 } });
  assert.equal('locked' in clean.A, false);
});

test('pruneGroupOverrides: master + lock both persist together', () => {
  const clean = pruneGroupOverrides({ A: { enabled: true, brightness: 25, locked: true } });
  assert.deepEqual(clean, { A: { enabled: true, brightness: 25, locked: true } });
});
