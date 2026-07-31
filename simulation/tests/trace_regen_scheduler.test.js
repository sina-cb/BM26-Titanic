/**
 * Unit contract for the cold-move dirty ledger (report 20260725_44 steps 2-6).
 *
 * The bug being pinned: a generator drag used to run a full
 * generateGroupFromTrace per pointermove tick (~2.4 s frame stall each). The
 * scheduler is what turns N ticks into exactly ONE regenerate at release — and
 * what guarantees the LED batch cache is ALWAYS invalidated on that release
 * (the move-trail bug, report 20260725_2, was persistent stale coordinates).
 *
 * Pure logic — no THREE, no DOM, no window.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  markTraceRegenDirty, markStrandTransformDirty, hasPendingRegens,
  peekPendingRegens, takePendingRegens, resetPendingRegens,
} from '../src/dmx/trace_regen_scheduler.js';

// Boot-safe: a freshly imported module owes nothing. Asserted BEFORE any
// beforeEach reset could mask a module-level mark.
test('boot-safe: nothing is pending on a fresh import', () => {
  assert.equal(hasPendingRegens(), false);
  assert.deepEqual(peekPendingRegens(), { traces: [], strandTransform: false });
});

beforeEach(() => resetPendingRegens());

test('N drag ticks on one trace = exactly ONE flush entry', () => {
  for (let tick = 0; tick < 40; tick++) markTraceRegenDirty(3);
  assert.equal(hasPendingRegens(), true);
  assert.deepEqual(takePendingRegens(), { traces: [3], strandTransform: false });
});

test('take CLEARS the ledger — a second release does no work', () => {
  markTraceRegenDirty(1);
  takePendingRegens();
  assert.equal(hasPendingRegens(), false);
  assert.deepEqual(takePendingRegens(), { traces: [], strandTransform: false });
});

test('no marks (non-generated trace never marks) = no flush', () => {
  // _onTraceTransformChange only marks when trace.generated is true, so a drag
  // of a non-generated generator must leave the release seam with nothing to do.
  assert.equal(hasPendingRegens(), false);
  assert.deepEqual(takePendingRegens(), { traces: [], strandTransform: false });
});

test('multi-trace release regenerates in ascending index order', () => {
  markTraceRegenDirty(7);
  markTraceRegenDirty(2);
  markTraceRegenDirty(11);
  markTraceRegenDirty(2);
  // Ascending, deduped: chain numbering must never depend on drag order.
  assert.deepEqual(takePendingRegens().traces, [2, 7, 11]);
});

test('strand transform flag rides the same release and always clears', () => {
  markStrandTransformDirty();
  markStrandTransformDirty();
  assert.equal(hasPendingRegens(), true);
  const taken = takePendingRegens();
  assert.equal(taken.strandTransform, true, 'release MUST see the strand invalidation it owes');
  assert.deepEqual(taken.traces, []);
  assert.equal(hasPendingRegens(), false);
});

test('a mixed drag reports both halves in one take', () => {
  markTraceRegenDirty(0);
  markStrandTransformDirty();
  assert.deepEqual(takePendingRegens(), { traces: [0], strandTransform: true });
});

test('peek does NOT clear — diagnostics can never eat a pending flush', () => {
  markTraceRegenDirty(5);
  markStrandTransformDirty();
  assert.deepEqual(peekPendingRegens(), { traces: [5], strandTransform: true });
  assert.deepEqual(peekPendingRegens(), { traces: [5], strandTransform: true });
  assert.equal(hasPendingRegens(), true);
  assert.deepEqual(takePendingRegens(), { traces: [5], strandTransform: true });
});

test('bad trace index throws — a dropped mark would strand the fixtures', () => {
  // P0: fail loudly. A silently ignored dirty mark means the operator's
  // fixtures never follow their generator after the drag.
  for (const bad of [undefined, null, -1, 1.5, '2', NaN, {}]) {
    assert.throws(() => markTraceRegenDirty(bad), TypeError, `expected throw for ${String(bad)}`);
  }
  assert.equal(hasPendingRegens(), false);
});

test('reset drops work without doing it — teardown only', () => {
  markTraceRegenDirty(4);
  markStrandTransformDirty();
  resetPendingRegens();
  assert.equal(hasPendingRegens(), false);
});
