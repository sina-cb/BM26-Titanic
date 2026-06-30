// ── Mixer UNDO ring (round-2 #10) ────────────────────────────────────
//
// A bounded, SESSION-ONLY stack of full-mixer "look" snapshots taken
// BEFORE each destructive mixer mutation (channel delete, snapshot
// recall, recall-fade kickoff, reorder, param-preset recall). Undo pops
// the most recent entry and restores its look via the engine's proven
// recallLook() path.
//
// WHY a ring of full looks (not a command/inverse-op log): recallLook is
// the existing, proven, never-dark restore — it rebuilds the deck
// explicitly and re-registers every overlay's CPC through the same
// build path boot uses. An inverse-op log would need a bespoke inverse
// per route (un-delete-with-CPC, un-reorder, un-recall) — strictly more
// code + bug surface for a live show. A captured look is plain serialized
// JS (no live WASM handles), so holding UNDO_MAX of them is cheap.
//
// WHY session-only (in-memory, NOT persisted): an engine restart is
// itself a clean undo boundary — there is nothing sensible to "undo back
// to" across a process that rebooted. Persisting the ring would also race
// the on-disk mixer state (the look on disk could already differ from a
// stale persisted entry), so we deliberately keep it transient.
//
// This module is the PURE ring mechanics (push / trim / pop / depth /
// top). The api_server owns captureLook()/recallLook() and the choke-
// point pushUndo() that fills it — see lib/api_server.js. Keeping the
// ring pure makes the cap/trim/report contract unit-testable without an
// engine boot (tests/mixer_undo.test.js).

// Max entries retained. Oldest is dropped when the ring overflows.
export const UNDO_MAX = 10;

export class UndoStack {
  /** @param {number} max  Cap (defaults to UNDO_MAX). Must be a positive int. */
  constructor(max = UNDO_MAX) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new Error(`UndoStack: max must be a positive integer, got ${max}`);
    }
    this.max = max;
    /** @type {Array<{label:string, look:object, atMs:number}>} */
    this._entries = [];
  }

  /**
   * Push a new undo entry (the pre-mutation look). Trims the OLDEST entry
   * when the ring overflows the cap. Validates the entry shape loudly — a
   * malformed push is a developer error, never silently dropped.
   * @param {{label:string, look:object, atMs:number}} entry
   */
  push(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('UndoStack.push: entry must be an object');
    }
    if (typeof entry.label !== 'string' || entry.label.length === 0) {
      throw new Error('UndoStack.push: entry.label must be a non-empty string');
    }
    if (!entry.look || typeof entry.look !== 'object') {
      throw new Error('UndoStack.push: entry.look must be an object');
    }
    this._entries.push(entry);
    // Bound the ring: drop the OLDEST (front) once over cap. A while-loop
    // (not a single shift) so a smaller `max` always converges.
    while (this._entries.length > this.max) this._entries.shift();
  }

  /**
   * Pop + return the most recent entry, or null when empty. The CALLER is
   * responsible for failing loud on empty (the API returns 400 UNDO_EMPTY)
   * — this is the pure data op, not the policy.
   * @returns {{label:string, look:object, atMs:number}|null}
   */
  pop() {
    return this._entries.length ? this._entries.pop() : null;
  }

  /** Number of entries currently held. */
  get depth() {
    return this._entries.length;
  }

  /** The most recent entry's label, or null when empty (for the UI button). */
  get topLabel() {
    return this._entries.length ? this._entries[this._entries.length - 1].label : null;
  }

  /** True iff there is nothing to undo. */
  get isEmpty() {
    return this._entries.length === 0;
  }
}
