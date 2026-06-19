// useTimeline — live mirror of the in-engine Timeline service.
//
// docs/38 §15: the Timeline runs IN the engine now (no separate :6965
// companion). The engine broadcasts a `timelineState` message on its
// `/ws/control` topic on connect and on every state change (tick, mode flip,
// autopilot toggle, program start/end, cue fire, error). This hook reads that
// off the SHARED control-plane bus (engineEvents) — the same socket every
// other control hook uses — and seeds the first paint from GET /timeline/state.
//
// Why the shared bus (not a bespoke WS): pre-§15 the timeline lived on its own
// port (:6965) and needed its own socket. Now it's the engine on :6968, so it
// rides /ws/control next to scheduledTasks / mixer / deck — one parse, many
// listeners (same recipe as useScheduledTasks / useEngineState).
//
// Module-level cache + listener set so tab switches don't tear down the
// subscription or re-fetch on every focus.
//
// Codex P0 — fail loud: when the control WS is down AND the `/timeline/state`
// seed is unreachable, `connected` is false and `state` is null. The tab
// renders an offline banner from that — never stale data.

import { useEffect, useState } from 'react';
import { engineEvents } from '@/utils/engineEvents';
import {
  fetchTimelineState,
  activateTimelinePlan,
  setTimelineMode,
  setTimelineAutopilot,
  holdTimeline,
  resumeTimeline,
  endTimelineProgram,
  fireTimelineCue,
  TimelineState,
  TimelineMode,
} from '@/utils/timelineApi';

export interface TimelineHookState {
  state: TimelineState | null;
  connected: boolean;
  /** Last seed/action error surfaced for the offline banner / toast. */
  error: string | null;
}

export interface TimelineActions {
  activatePlan: (name: string) => Promise<boolean>;
  setMode: (mode: 'armed' | 'paused') => Promise<boolean>;
  setAutopilot: (enabled: boolean) => Promise<boolean>;
  hold: (minutes: number) => Promise<boolean>;
  resume: () => Promise<boolean>;
  endProgram: () => Promise<boolean>;
  fireCue: (id: string) => Promise<boolean>;
}

export type UseTimelineResult = TimelineHookState & TimelineActions;

const EMPTY: TimelineHookState = { state: null, connected: false, error: null };

let _cached: TimelineHookState = EMPTY;
const _listeners = new Set<(s: TimelineHookState) => void>();
let _initialized = false;

function _emit(next: TimelineHookState) {
  _cached = next;
  _listeners.forEach((cb) => {
    try { cb(next); } catch { /* a buggy listener must never break the bus */ }
  });
}

function _isTimelineState(v: unknown): v is TimelineState {
  return !!v && typeof v === 'object' && typeof (v as { mode?: unknown }).mode === 'string';
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Subscribe to /ws/control for live `timelineState` broadcasts. The engine
  // replays the current state on connect (api_server control connect handler)
  // and pushes a fresh one on every tick / state change.
  engineEvents.subscribe((msg) => {
    if (!msg || msg.type !== 'timelineState') return;
    // The engine sends the full state document inline on `timelineState`.
    const candidate = msg as unknown;
    if (!_isTimelineState(candidate)) return;
    _emit({ state: candidate as TimelineState, connected: true, error: null });
  });

  // Mirror the bus connection status onto our banner. The control WS is shared
  // with every other tab; we reflect its connected flag so the timeline tab's
  // offline banner matches the rest of the app.
  engineEvents.subscribeStatus((s) => {
    _emit({ ..._cached, connected: s.connected, error: s.lastError ?? _cached.error });
  });

  // REST seed — the WS replay covers connect, but a cold mount before the
  // socket lands still needs the initial snapshot.
  fetchTimelineState()
    .then((r) => {
      if (r.ok && r.data) {
        _emit({ state: r.data, connected: _cached.connected, error: null });
      } else if (!_cached.state) {
        // Codex P0: surface the engine error verbatim, never a fallback.
        _emit({ ..._cached, error: r.error || 'Timeline unreachable' });
      }
    })
    .catch((err: any) => {
      if (!_cached.state) {
        _emit({ ..._cached, error: err?.message || 'Timeline unreachable' });
      }
    });
}

// ── Action functions (REST; re-seed on success so the UI converges even if
// the WS broadcast is delayed) ──────────────────────────────────────────

async function _reseedAfterAction() {
  const r = await fetchTimelineState();
  if (r.ok && r.data) {
    _emit({ state: r.data, connected: _cached.connected, error: null });
  }
}

async function _activatePlan(name: string): Promise<boolean> {
  const r = await activateTimelinePlan(name);
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to activate plan' });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _setMode(mode: 'armed' | 'paused'): Promise<boolean> {
  // Optimistic mode flip — the pill reads correctly the instant the operator
  // taps; the WS broadcast / re-seed reconciles within a tick.
  const priorMode = _cached.state?.mode ?? null;
  if (_cached.state) {
    _emit({ ..._cached, state: { ..._cached.state, mode: mode as TimelineMode } });
  }
  const r = await setTimelineMode(mode);
  if (!r.ok) {
    // Restore the prior mode explicitly — the re-seed no-ops when the engine
    // is unreachable, which would otherwise leave the pill showing a lie.
    if (priorMode !== null && _cached.state) {
      _emit({ ..._cached, state: { ..._cached.state, mode: priorMode }, error: r.error || 'Failed to set mode' });
    } else {
      _emit({ ..._cached, error: r.error || 'Failed to set mode' });
    }
    await _reseedAfterAction();
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _setAutopilot(enabled: boolean): Promise<boolean> {
  const r = await setTimelineAutopilot(enabled);
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to toggle autopilot' });
    await _reseedAfterAction();
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _hold(minutes: number): Promise<boolean> {
  const r = await holdTimeline(minutes);
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to hold' });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _resume(): Promise<boolean> {
  const r = await resumeTimeline();
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to resume' });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _endProgram(): Promise<boolean> {
  const r = await endTimelineProgram();
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to end program' });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _fireCue(id: string): Promise<boolean> {
  const r = await fireTimelineCue(id);
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to fire cue' });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

export function useTimeline(): UseTimelineResult {
  _ensureInitialized();
  const [state, setState] = useState<TimelineHookState>(_cached);
  useEffect(() => {
    _listeners.add(setState);
    // Resync to whatever's current in case an update landed between mount and
    // effect run (same pattern as useEngineState).
    setState(_cached);
    return () => { _listeners.delete(setState); };
  }, []);
  return {
    ...state,
    activatePlan: _activatePlan,
    setMode: _setMode,
    setAutopilot: _setAutopilot,
    hold: _hold,
    resume: _resume,
    endProgram: _endProgram,
    fireCue: _fireCue,
  };
}
