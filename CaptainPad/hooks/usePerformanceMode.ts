// usePerformanceMode — shared, module-level subscription to the engine's
// PERFORMANCE MODE state (the live-show structural lock). Both the deck header
// and the mixer header consume this ONE hook so they always agree.
//
// Same shape as useEngineState's module-cache pattern: a module-level cached
// value + a Set of listeners, seeded from REST once and kept live by the
// `performanceMode` broadcast on the /ws/control bus. The engine's WS broadcast
// is authoritative — the control never optimistically flips; it awaits the echo.
//
// Seeding: on first mount we fetch GET /performance-mode, and we re-seed on
// every control-bus (re)connect (mirrors useEngineState._seedFromStatus) so a
// reconnect — or the operator pointing CaptainPad at a different engine —
// re-syncs the lock badge without waiting for the next broadcast.

import { useEffect, useState } from 'react';
import { engineEvents } from '@/utils/engineEvents';
import { fetchPerformanceMode } from '@/utils/api';
import {
  DEFAULT_PERFORMANCE_MODE,
  reconcilePerformanceMode,
  isPerformanceModeMessage,
  type PerformanceModeState,
} from '@/components/performance_mode_logic';

let _cached: PerformanceModeState = DEFAULT_PERFORMANCE_MODE;
const _listeners = new Set<(s: PerformanceModeState) => void>();
let _initialized = false;

function _dirtyKey(s: PerformanceModeState): string {
  // Cheap identity for the dirty set: count + the ordered entry ids. Enough to
  // detect a changed backlog without a deep compare (two different sets sharing
  // a count still differ by id order).
  return `${s.dirtyCount}|${(s.dirtyEntries || []).map((e) => e.entryId).join(',')}`;
}

function _emit(next: PerformanceModeState) {
  // Reference-stable no-op guard: skip the fan-out when nothing changed so
  // consumers don't re-render on a redundant re-seed/broadcast. Dirty state is
  // part of the identity so a fresh summary (e.g. the exit-sheet refresh) fans
  // out even when active/enteredAt are unchanged.
  if (next.active === _cached.active && next.enteredAt === _cached.enteredAt
      && _dirtyKey(next) === _dirtyKey(_cached)) return;
  _cached = next;
  _listeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // A buggy subscriber must never break the broadcast pipeline.
    }
  });
}

function _seedFromRest() {
  fetchPerformanceMode()
    .then((r) => {
      if (!r.ok || !r.data) return;
      _emit(reconcilePerformanceMode(_cached, r.data));
    })
    .catch(() => undefined);
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Live updates: the engine broadcasts {type:'performanceMode', ...} on
  // enter/exit and replays it on every /ws/control connect.
  engineEvents.subscribe((msg) => {
    if (isPerformanceModeMessage(msg)) {
      _emit(reconcilePerformanceMode(_cached, msg));
    }
  });
  // REST seed now + on every control-bus (re)connect (the connect replay also
  // covers this, but the explicit fetch guarantees a seed even if the replay is
  // missed during the handshake race — same belt-and-braces as useEngineState).
  engineEvents.subscribeStatus((s) => {
    if (s.connected) _seedFromRest();
  });
  _seedFromRest();
}

/** Subscribe to the shared performance-mode state. */
export function usePerformanceMode(): PerformanceModeState {
  _ensureInitialized();
  const [state, setState] = useState<PerformanceModeState>(_cached);
  useEffect(() => {
    const listener = (s: PerformanceModeState) => setState(s);
    _listeners.add(listener);
    // Resync — handles the race between mount and first emit.
    listener(_cached);
    return () => { _listeners.delete(listener); };
  }, []);
  return state;
}

/**
 * Force a REST re-seed of the shared performance-mode state (GET
 * /performance-mode). The engine broadcasts `performanceMode` only on
 * enter/exit, so the dirty summary the operator accrues DURING a show isn't
 * pushed — the exit flow calls this when it opens the KEEP/RESTORE sheet to
 * pull the freshest {dirtyCount, dirtyEntries} before asking whether to save.
 */
export function refreshPerformanceMode(): void {
  _ensureInitialized();
  _seedFromRest();
}

/**
 * usePerfLock — convenience for the ~20 leaf components that only need "is the
 * structural lock on?". Every UI control that maps to a 409-gated engine route
 * reads this and renders the standard locked idiom (opacity 0.45 +
 * disabled/pointerEvents none, or the component's own `locked` prop).
 */
export function usePerfLock(): boolean {
  return usePerformanceMode().active;
}

/** Non-hook read of the current performance-mode state (for imperative code —
 *  e.g. the MIDI LED projector snapshot). */
export function getPerformanceModeState(): PerformanceModeState {
  _ensureInitialized();
  return _cached;
}

// ── Performance-dialog summon bus ──────────────────────────────────────────
// Lives in the PURE logic module (components/performance_mode_logic.ts) so
// vitest pins its semantics without transport imports; re-exported here so
// hook-land consumers (useMidiControl, PerformanceModeControl) have one import
// site next to the state hook.
export {
  subscribePerformanceDialogSummon,
  summonPerformanceDialog,
} from '@/components/performance_mode_logic';
