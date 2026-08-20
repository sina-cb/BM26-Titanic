/**
 * trace_regen_scheduler.js — the COLD-MOVE dirty ledger for generator edits.
 *
 * WHY (report 20260725_44 §1): every pointermove tick of a generator drag used
 * to run a full `generateGroupFromTrace` → `rebuildParLights` → shader-recompile
 * storm (~2.4 s frame stall per tick, 0.4 FPS paced drag). The editor visuals
 * (trace line, handles, preview dots, aim line, chain-order overlay) are cheap
 * and keep tracking the cursor; the EXPENSIVE fixture regeneration is marked
 * dirty here and flushed exactly ONCE on pointer release.
 *
 * This module is deliberately pure — no THREE, no DOM, no window — so the
 * "one flush per release" contract is unit-testable in Node.
 *
 * CONTRACT (do not weaken):
 *   • `takePending()` CLEARS the ledger. A release that takes pending work must
 *     do that work — the LED move-trail bug (report 20260725_2) was persistent
 *     stale batch coordinates, so `strandTransform` MUST always end in an
 *     `invalidateMarsinBatchCache` call at the release seam.
 *   • Marking is idempotent per trace index: N drag ticks ⇒ 1 regenerate.
 *   • Bad input throws. A silently-dropped dirty mark would leave the operator
 *     looking at fixtures that never followed their generator (P0: no fallbacks).
 */

// Trace indices whose generated fixtures are stale while a drag is in flight.
const _pendingTraces = new Set();

// The LED-strand batch cache is stale (a strand handle moved during a drag).
let _pendingStrandTransform = false;

/**
 * Mark a generator's fixtures as stale. Call ONLY while an interaction is in
 * flight and a release seam is guaranteed to follow — a gizmo drag (flushed by
 * main.js's `dragging-changed`), a preview-dot drag, or a GUI geometry control
 * being dragged (flushed by its own `onFinishChange`, report 20260725_83).
 * Outside those, the caller regenerates immediately (undo, programmatic edits).
 * @param {number} traceIndex index into params.traces
 */
export function markTraceRegenDirty(traceIndex) {
  if (!Number.isInteger(traceIndex) || traceIndex < 0) {
    throw new TypeError(
      `markTraceRegenDirty: traceIndex must be a non-negative integer, got ${traceIndex}`);
  }
  _pendingTraces.add(traceIndex);
}

/** Mark the LED-strand batch cache as stale (deferred `strand_transform`). */
export function markStrandTransformDirty() {
  _pendingStrandTransform = true;
}

/** @returns {boolean} true when a release still owes work. */
export function hasPendingRegens() {
  return _pendingTraces.size > 0 || _pendingStrandTransform;
}

/**
 * Read the ledger WITHOUT clearing it (diagnostics, tests, harnesses).
 * @returns {{traces: number[], strandTransform: boolean}}
 */
export function peekPendingRegens() {
  return {
    traces: [..._pendingTraces].sort((a, b) => a - b),
    strandTransform: _pendingStrandTransform,
  };
}

/**
 * Take AND clear the ledger. The caller is now responsible for the work.
 * Trace indices come back ascending so a multi-trace release regenerates in a
 * deterministic order (chain numbering must never depend on drag order).
 * @returns {{traces: number[], strandTransform: boolean}}
 */
export function takePendingRegens() {
  const taken = peekPendingRegens();
  _pendingTraces.clear();
  _pendingStrandTransform = false;
  return taken;
}

/** Drop everything without doing the work — scene teardown / test setup only. */
export function resetPendingRegens() {
  _pendingTraces.clear();
  _pendingStrandTransform = false;
}
