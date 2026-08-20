/**
 * Regression tests for the trace-generator group rename (report 20260724_37).
 *
 * The operator's bug (verbatim): "when I create a group and then press generate,
 * if I change the name of the generator, the old instances are not removed and it
 * causes duplication of fixtures."
 *
 * These pin the pure helpers that gui_builder's trace-name onFinishChange +
 * generateGroupFromTrace delegate to:
 *   - sweepGeneratedInstances removes the OLD group name on a rename (no orphans),
 *   - carryTraceGroupOverride moves the master/lock across the rename,
 *   - traceRenameError fails loud on reserved / colliding names.
 *
 * The tests drive the SAME sequence the operator does — create trace → generate →
 * rename → (regenerate) — against a plain in-memory params object, so a
 * regression that re-orphans the old-named set fails here without a browser.
 *
 * Pure module — plain objects only, no DOM/THREE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  traceRenameError,
  sweepGeneratedInstances,
  carryTraceGroupOverride,
} from '../src/gui/trace_group_rename.js';

// ── Minimal re-implementation of generateGroupFromTrace's fixture emission ──
// (the geometry/aim math is irrelevant to the orphan bug; only the group/name
// stamping + the sweep matter). Mirrors gui_builder exactly for those parts.
function generate(params, traceIndex, previousGroupName = null) {
  const trace = params.traces[traceIndex];
  const groupName = trace.groupName || trace.name || `Trace ${traceIndex + 1}`;
  const { kept } = sweepGeneratedInstances(params.parLights, groupName, previousGroupName);
  params.parLights = kept;
  for (let n = 1; n <= trace.count; n++) {
    params.parLights.push({
      group: groupName,
      name: `${groupName} ${n}`,
      fixtureType: trace.fixtureType || 'UkingPar',
      x: n, y: 0, z: 0,
      traceGenerated: true,
    });
  }
  trace.generated = true;
}

// Mirror of gui_builder's trace-name onFinishChange happy path.
function rename(params, traceIndex, newName) {
  const trace = params.traces[traceIndex];
  const oldGroupName = trace.groupName || trace.name;
  const err = traceRenameError(newName, {
    traces: params.traces, parLights: params.parLights,
    traceIndex, oldGroupName,
  });
  if (err) return err;
  trace.name = newName;
  trace.groupName = newName;
  carryTraceGroupOverride(params.groupOverrides, oldGroupName, newName);
  if (trace.generated) generate(params, traceIndex, oldGroupName);
  return null;
}

function freshParams() {
  return {
    traces: [{ name: 'Old Ring', groupName: 'Old Ring', shape: 'circle', count: 4 }],
    parLights: [],
    groupOverrides: {},
  };
}

// ── The operator's exact sequence: create → generate → rename → no dupes ──

test('generate-then-rename: old-named instances are removed, not orphaned', () => {
  const params = freshParams();
  generate(params, 0);
  assert.equal(params.parLights.length, 4, 'four fixtures after first generate');
  assert.ok(params.parLights.every(l => l.group === 'Old Ring'));

  const err = rename(params, 0, 'New Ring');
  assert.equal(err, null, 'rename accepted');

  // The bug was: 8 fixtures (4 orphaned "Old Ring" + 4 fresh "New Ring").
  assert.equal(params.parLights.length, 4, 'still exactly four fixtures — no duplication');
  assert.ok(
    params.parLights.every(l => l.group === 'New Ring'),
    'every fixture carries the new group name',
  );
  assert.equal(
    params.parLights.filter(l => l.group === 'Old Ring').length, 0,
    'zero orphaned old-named fixtures',
  );
  assert.deepEqual(
    params.parLights.map(l => l.name),
    ['New Ring 1', 'New Ring 2', 'New Ring 3', 'New Ring 4'],
    'names re-stamped to the new group',
  );
});

test('rename carries the group master override + lock; no orphaned key', () => {
  const params = freshParams();
  generate(params, 0);
  params.groupOverrides['Old Ring'] = { enabled: false, brightness: 42, locked: true };

  rename(params, 0, 'New Ring');

  assert.deepEqual(
    params.groupOverrides['New Ring'],
    { enabled: false, brightness: 42, locked: true },
    'override moved verbatim',
  );
  assert.ok(!('Old Ring' in params.groupOverrides), 'no orphaned override under the old name');
});

test('rename-then-generate: renaming before first generate leaves no stale set', () => {
  const params = freshParams();
  // Rename BEFORE generating — trace not yet generated, so nothing to sweep.
  const err = rename(params, 0, 'New Ring');
  assert.equal(err, null);
  assert.equal(params.parLights.length, 0, 'no fixtures generated yet');

  // Now generate under the new name.
  generate(params, 0);
  assert.equal(params.parLights.length, 4);
  assert.ok(params.parLights.every(l => l.group === 'New Ring'));
});

test('double rename does not accumulate orphans across renames', () => {
  const params = freshParams();
  generate(params, 0);
  rename(params, 0, 'Mid Ring');
  rename(params, 0, 'Final Ring');
  assert.equal(params.parLights.length, 4, 'still four after two renames');
  assert.ok(params.parLights.every(l => l.group === 'Final Ring'));
});

test('config.js re-stamp stays intact: trace.groupName tracks the fixtures', () => {
  const params = freshParams();
  generate(params, 0);
  rename(params, 0, 'New Ring');
  // config.js L146: traceGroupNames = traces.filter(generated).map(groupName||name).
  const traceGroupNames = new Set(
    params.traces.filter(t => t.generated).map(t => t.groupName || t.name),
  );
  assert.ok(
    params.parLights.every(l => traceGroupNames.has(l.group)),
    'every generated fixture group is re-stampable from a trace groupName',
  );
});

// ── Fail-loud collision guards (codex P0) ──

test('rename to a reserved bucket is rejected', () => {
  const params = freshParams();
  generate(params, 0);
  const err = rename(params, 0, 'Ungrouped');
  assert.match(err, /reserved/i);
  assert.ok(params.parLights.every(l => l.group === 'Old Ring'), 'state unchanged on reject');
});

test('rename colliding with another trace group is rejected', () => {
  const params = freshParams();
  params.traces.push({ name: 'Other Ring', groupName: 'Other Ring', shape: 'circle', count: 2 });
  generate(params, 0);
  generate(params, 1);
  const err = rename(params, 0, 'Other Ring');
  assert.match(err, /already exists/i);
  // No merge happened — Other Ring still has exactly its 2 fixtures.
  assert.equal(params.parLights.filter(l => l.group === 'Other Ring').length, 2);
  assert.equal(params.parLights.filter(l => l.group === 'Old Ring').length, 4);
});

test('rename colliding with an existing par group name is rejected', () => {
  const params = freshParams();
  generate(params, 0);
  params.parLights.push({ group: 'Manual Group', name: 'Manual Group 1', x: 0, y: 0, z: 0 });
  const err = rename(params, 0, 'Manual Group');
  assert.match(err, /already exists/i);
});

test('empty name is rejected', () => {
  const params = freshParams();
  generate(params, 0);
  const err = rename(params, 0, '');
  assert.match(err, /empty/i);
});

test('renaming to the same name is a no-op (no error)', () => {
  const params = freshParams();
  generate(params, 0);
  const err = traceRenameError('Old Ring', {
    traces: params.traces, parLights: params.parLights,
    traceIndex: 0, oldGroupName: 'Old Ring',
  });
  assert.equal(err, null, 'own name never collides with itself');
});

// ── sweepGeneratedInstances direct unit coverage ──

test('sweep preserves non-generated fixtures in the swept group', () => {
  const parLights = [
    { group: 'Old Ring', name: 'Old Ring 1', traceGenerated: true },
    { group: 'Old Ring', name: 'Hand Placed', traceGenerated: false },
    { group: 'Keep', name: 'Keep 1', traceGenerated: true },
  ];
  const { kept, removed } = sweepGeneratedInstances(parLights, 'New Ring', 'Old Ring');
  assert.equal(removed.length, 1, 'only the generated old-named fixture is removed');
  assert.ok(kept.some(l => l.name === 'Hand Placed'), 'hand-placed fixture survives');
  assert.ok(kept.some(l => l.name === 'Keep 1'), 'unrelated group survives');
});

test('sweep with no previousGroupName behaves like the pre-fix single-name sweep', () => {
  const parLights = [
    { group: 'Ring', name: 'Ring 1', traceGenerated: true },
    { group: 'Ring', name: 'Ring 2', traceGenerated: true },
  ];
  const { kept, removed } = sweepGeneratedInstances(parLights, 'Ring', null);
  assert.equal(removed.length, 2);
  assert.equal(kept.length, 0);
});
