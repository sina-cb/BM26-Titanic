// useTimeline — live mirror of the Timeline Companion's runtime state.
//
// The Timeline Companion (docs/38) is a server-side, engine-supervised
// process on its OWN port (6965). It pushes a `timelineState` message on
// its `/ws` topic on connect and on every state change (mode flip, phase
// boundary, cue fire, error). This hook owns the ONE WebSocket to that
// companion for the app's lifetime and exposes the latest state plus the
// action functions the TIMELINE tab drives.
//
// Why a bespoke WS (not engineBus): the shared buses in engineBus.ts
// derive their URL straight from `api_base` (the engine, :6968). The
// companion lives on the SAME host but a DIFFERENT port (:6965), so it
// needs its own socket. We reuse the bus's proven recipe — lazy connect,
// exponential backoff, AppState-resume — scoped to the timeline URL.
//
// Module-level cache + listener set, exactly like useEngineState /
// useScheduledTasks, so tab switches don't tear down the socket or
// re-fetch on every focus.
//
// Codex P0 — fail loud: when the WS is down AND the `/state` seed is
// unreachable, `connected` is false and `state` is null. The tab renders a
// "timeline companion offline" banner from that — never stale data.

import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  fetchTimelineState,
  getTimelineWsUrlAsync,
  activateTimelinePlan,
  setTimelineMode,
  holdTimeline,
  resumeTimeline,
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
  hold: (minutes: number) => Promise<boolean>;
  resume: () => Promise<boolean>;
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

// ── Dedicated timeline WebSocket (the createBus recipe, timeline URL) ───
let _ws: WebSocket | null = null;
let _alive = true;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _backoffMs = 250;
const MAX_BACKOFF_MS = 5_000;

function _clearReconnectTimer() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

function _scheduleReconnect() {
  _clearReconnectTimer();
  if (!_alive) return;
  const wait = _backoffMs;
  _backoffMs = Math.min(_backoffMs * 2, MAX_BACKOFF_MS);
  _reconnectTimer = setTimeout(_connect, wait);
}

function _detachAndClose(socket: WebSocket | null) {
  if (!socket) return;
  try {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  } catch { /* ignore */ }
  try { socket.close(); } catch { /* ignore */ }
}

function _isTimelineState(v: unknown): v is TimelineState {
  return !!v && typeof v === 'object' && typeof (v as { mode?: unknown }).mode === 'string';
}

function _onMessage(raw: string) {
  let msg: { type?: string; [k: string]: unknown } | null = null;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || msg.type !== 'timelineState') return;
  // The companion sends the full state document on `timelineState`. It
  // may wrap it under `state` or send the fields inline; accept either.
  const candidate = _isTimelineState(msg.state) ? (msg.state as TimelineState) : (msg as unknown);
  if (!_isTimelineState(candidate)) return;
  _emit({ state: candidate, connected: true, error: null });
}

function _connect() {
  _clearReconnectTimer();
  if (!_alive) return;
  if (_ws && (_ws.readyState === 0 /* CONNECTING */ || _ws.readyState === 1 /* OPEN */)) {
    return;
  }
  getTimelineWsUrlAsync()
    .then((wsUrl) => {
      if (!_alive) return;
      _detachAndClose(_ws);
      try {
        _ws = new WebSocket(wsUrl);
      } catch {
        _scheduleReconnect();
        return;
      }
      _ws.onopen = () => {
        _backoffMs = 250;
        // Don't claim `connected` until the first `timelineState` lands —
        // the companion pushes one on connect, and that message carries
        // the engine-connected flag we need. Until then keep whatever we
        // have but mark the socket alive so the banner can clear quickly.
        _emit({ ..._cached, connected: true });
      };
      _ws.onclose = () => {
        _emit({ ..._cached, connected: false });
        _scheduleReconnect();
      };
      _ws.onerror = (e: WebSocketMessageEvent | Event) => {
        _emit({
          ..._cached,
          connected: false,
          error: (e && (e as { message?: string }).message) || 'timeline ws error',
        });
        // onclose follows and schedules the reconnect.
      };
      _ws.onmessage = (e: WebSocketMessageEvent) => {
        _onMessage(typeof e.data === 'string' ? e.data : '');
      };
    })
    .catch(() => _scheduleReconnect());
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Open the socket and seed the first paint from REST — the WS pushes a
  // snapshot on connect, but the seed makes a cold mount correct even if
  // the socket is still establishing.
  _connect();
  fetchTimelineState()
    .then((r) => {
      if (r.ok && r.data) {
        _emit({ state: r.data, connected: _cached.connected, error: null });
      } else {
        // Don't overwrite a good WS snapshot that may have raced in; only
        // record the seed error if we still have nothing. Codex P0:
        // surface the companion's error verbatim, never a fallback.
        if (!_cached.state) {
          _emit({ ..._cached, error: r.error || 'Timeline companion unreachable' });
        }
      }
    })
    .catch((err: any) => {
      if (!_cached.state) {
        _emit({ ..._cached, error: err?.message || 'Timeline companion unreachable' });
      }
    });

  // Reconnect on app foreground (same posture as engineBus).
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (!_ws || _ws.readyState >= 2 /* CLOSING|CLOSED */) {
          _backoffMs = 250;
          _connect();
        }
      }
    });
  }
}

// ── Action functions (REST; re-seed on success so the UI converges even
// if the WS broadcast is delayed) ──────────────────────────────────────

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
  // Optimistic mode flip — the pill reads correctly the instant the
  // operator taps; the WS broadcast / re-seed reconciles within a tick.
  if (_cached.state) {
    _emit({ ..._cached, state: { ..._cached.state, mode: mode as TimelineMode } });
  }
  const r = await setTimelineMode(mode);
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to set mode' });
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
    // Resync to whatever's current in case an update landed between mount
    // and effect run (same pattern as useEngineState).
    setState(_cached);
    return () => { _listeners.delete(setState); };
  }, []);
  return {
    ...state,
    activatePlan: _activatePlan,
    setMode: _setMode,
    hold: _hold,
    resume: _resume,
    fireCue: _fireCue,
  };
}
