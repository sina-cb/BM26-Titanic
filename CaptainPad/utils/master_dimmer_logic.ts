// master_dimmer_logic — pure logic behind the Dimmer Rack's MASTER fader.
//
// The rack renders one NauticalFader per dimmer GROUP, but several group
// names can legitimately resolve to the SAME physical section id (the
// engine's GET /dimmer-groups dedupes by name, not by section). The master
// therefore works in SECTION-ID space: one write per physical section, each
// section counted once in the readout.
//
// LEAF MODULE by design — no React, no react-native, no engine imports, so
// it is unit-testable in plain Node (utils/master_dimmer_logic.test.ts).

/** The rack's per-fader default when the engine has no stored level yet. */
export const DEFAULT_DIMMER_LEVEL = 1.0;

/**
 * Unique physical section ids behind a { groupName: sectionId } map,
 * ascending. Aliased groups (two names, one section) collapse to one id so
 * the master neither double-writes nor double-weights them.
 */
export function uniqueSectionIds(groups: Record<string, number>): number[] {
  const ids = new Set<number>();
  for (const sectionId of Object.values(groups)) ids.add(sectionId);
  return [...ids].sort((a, b) => a - b);
}

/**
 * What the MASTER fader shows: the MEAN of the current section levels.
 *
 * Chosen over "last value the master was set to" because it stays honest
 * after an individual fader diverges — the rack already owns every level
 * in `dimmerStates` (keyed by String(sectionId), exactly as GET /dimmers
 * serves it), so the mean is derivable with no extra state to go stale.
 * Sections with no stored level read as DEFAULT_DIMMER_LEVEL, matching what
 * their fader renders.
 *
 * Right after a master move every section holds the same value, so the mean
 * equals the commanded level — the two readings only differ once the
 * operator moves an individual fader, which is precisely when the mean is
 * the more truthful number.
 */
export function masterLevel(dimmerStates: Record<string, number>, ids: number[]): number {
  if (ids.length === 0) return DEFAULT_DIMMER_LEVEL;
  let sum = 0;
  for (const id of ids) {
    const v = dimmerStates[String(id)];
    sum += typeof v === 'number' ? v : DEFAULT_DIMMER_LEVEL;
  }
  return sum / ids.length;
}

/**
 * ABSOLUTE apply: every section takes the master's value verbatim (no
 * ratio/scaling mode — the rack has no such concept). Returns a NEW state
 * object; keys the master doesn't own (orphan group-name keys the engine
 * passes through verbatim) are preserved untouched.
 */
export function applyMasterLevel(
  dimmerStates: Record<string, number>,
  ids: number[],
  level: number,
): Record<string, number> {
  const next = { ...dimmerStates };
  for (const id of ids) next[String(id)] = level;
  return next;
}

/**
 * One master move = one write per section, so a 24-group rack fans out 24
 * POSTs. A fader drag emits values far faster than that round-trips, and
 * queueing every intermediate value would pile hundreds of requests behind
 * the browser's 6-per-host limit and land the STALE ones last.
 *
 * This is the backpressure: keep only the LATEST requested level while a
 * batch is in flight, then send that one. The final (release) value is
 * always delivered because it is simply the last value left pending.
 *
 * `send` resolves to an error string when any write in the batch failed, or
 * null on success; `onResult` receives it after every batch so the UI can
 * surface engine-down loudly. A `send` that REJECTS is reported the same way
 * (its message goes to `onResult`) rather than becoming an unhandled
 * rejection nobody sees on an iPad — the failure is surfaced, never hidden,
 * and no fallback value is written in its place.
 */
export type MasterBatchSender = (level: number) => Promise<string | null>;

export type MasterSender = {
  /** Request that every section go to `level` (coalesced, latest wins). */
  request: (level: number) => void;
  /** True while a batch is in flight. */
  isBusy: () => boolean;
};

export function createCoalescedSender(
  send: MasterBatchSender,
  onResult: (error: string | null) => void,
): MasterSender {
  let pending: number | null = null;
  let running = false;

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending !== null) {
        const level = pending;
        pending = null;
        try {
          onResult(await send(level));
        } catch (err: any) {
          onResult(err?.message || String(err));
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    request(level: number) {
      pending = level;
      void pump();
    },
    isBusy() {
      return running;
    },
  };
}
