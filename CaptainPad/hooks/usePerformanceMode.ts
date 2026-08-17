// usePerformanceMode — shared, module-level subscription to the engine's
// PERFORMANCE MODE state (the live-show structural lock). The app-wide sidebar
// control and every structural leaf consume this ONE hook so they always agree.
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
import { useCaptainPadAccess } from '@/hooks/use_captainpad_access';
import { isEffectivePerformanceLock } from '@/utils/captainpad_access_logic';
import { engineEvents } from '@/utils/engineEvents';
import { fetchPerformanceMode } from '@/utils/api';
import {
  DEFAULT_PERFORMANCE_MODE,
  editPrincipalMaySave,
  reconcilePerformanceMode,
  resolveLocalViewOverride,
  isPerformanceModeMessage,
  type PerformanceModeState,
} from '@/components/performance_mode_logic';

/**
 * What the hook hands consumers: the engine state, PLUS the two facts a pad
 * needs to talk honestly about an unreachable engine. A strict superset of
 * `PerformanceModeState`, so every existing consumer (the _217 deck overlay,
 * the mixer performance overlay, the tab policy, the session chip) keeps
 * destructuring exactly what it destructured before.
 */
export interface PerformanceModeView extends PerformanceModeState {
  /**
   * True while this pad is presenting a CLIENT-LOCAL view instead of the
   * engine's. Only ever true while `engineOffline` is true. UI that wants to
   * badge the state reads this; UI that just wants "is the performance face
   * up?" reads `active`, which is already override-aware.
   */
  localOverride: boolean;
  /** True while the /ws/control bus is disconnected (the header's OFFLINE). */
  engineOffline: boolean;
}

let _cached: PerformanceModeState = DEFAULT_PERFORMANCE_MODE;
const _listeners = new Set<(s: PerformanceModeView) => void>();
const _readyListeners = new Set<(ready: boolean) => void>();
let _initialized = false;
let _resolved = false;

// ── OFFLINE LOCAL VIEW OVERRIDE (report `_250`) ────────────────────────────
// The mode flip is an ENGINE route, so with the control bus down the pad had
// no way off the locked performance face — precisely when the operator most
// needs CONFIG. docs/56 D1 (+ report `_228`): an auth-enabled engine BOOTS
// locked, so an iPad that cannot reach it is stuck on that face.
//
// `_localOverride` is a purely LOCAL presentation answer, alive only while
// `_connected === false`. It is never POSTed, never merged into `_cached`,
// never written to AsyncStorage, and it is DISCARDED on reconnect — a reload
// while offline honestly starts back on the engine's last-known face with the
// offline switch available again.
//
// NO PASSCODE gates it, deliberately, and that weakens nothing: the credential
// ring lives in the engine, so nothing could be verified offline anyway, and
// every gate that matters is engine-side per request — the perf-exit passcode
// (docs/56 D2), the edit-session principal (D3) and the eight D6 persistence
// writers. With no connection there is no request to gate; on reconnect the
// engine's broadcast immediately wins.
let _connected = false;
let _localOverride: boolean | null = null;

// The override-aware projection handed to subscribers. Kept as one cached
// object so listeners get a reference-stable value between real changes.
let _view: PerformanceModeView = {
  ...DEFAULT_PERFORMANCE_MODE,
  localOverride: false,
  engineOffline: true,
};

/** Ready is "this pad has a definite answer": the engine supplied one, OR the
 *  operator supplied a local one while the engine is unreachable. */
function _effectiveReady(): boolean {
  return _resolved || (!_connected && _localOverride !== null);
}
let _readyEmitted = _effectiveReady();

function _emitReady() {
  const ready = _effectiveReady();
  if (_readyEmitted === ready) return;
  _readyEmitted = ready;
  _readyListeners.forEach((listener) => listener(ready));
}

function _setResolved(resolved: boolean) {
  _resolved = resolved;
  _emitReady();
}

function _dirtyKey(s: PerformanceModeState): string {
  // Cheap identity for the dirty set: count + the ordered entry ids. Enough to
  // detect a changed backlog without a deep compare (two different sets sharing
  // a count still differ by id order).
  return `${s.dirtyCount}|${(s.dirtyEntries || []).map((e) => e.entryId).join(',')}`;
}

// Reference-stable no-op guard: skip the fan-out when nothing changed so
// consumers don't re-render on a redundant re-seed/broadcast. Dirty state is
// part of the identity so a fresh summary (e.g. the exit-sheet refresh) fans
// out even when active/enteredAt are unchanged.
//
// The EDIT SESSION is part of the identity too (docs/56). An escalation or
// handover (POST /edit-session) changes ONLY `editPrincipal` — active,
// enteredAt and the dirty set are all untouched — so leaving it out of this
// comparison silently swallowed the broadcast: the amber chip never cleared
// when Sina took the session, and every pad kept showing a stale identity
// while the engine had already changed what it persists. `authRequired`
// joins it for the same reason: it is the other field that can move on its
// own (a pad seeded from one engine and then reconnected to another).
//
// The guard now lives on the projected VIEW (report `_250`) so the offline
// override and the connection state are part of that same identity — a
// disconnect or a local view pick must fan out even though the engine's own
// fields are untouched.
function _viewIdentity(v: PerformanceModeView): string {
  return [
    v.active, v.enteredAt, v.editPrincipal, v.authRequired,
    v.localOverride, v.engineOffline, _dirtyKey(v),
  ].join('|');
}

function _recomputeView() {
  const { active, localOverride } =
    resolveLocalViewOverride(_cached.active, _connected, _localOverride);
  const next: PerformanceModeView = {
    ..._cached,
    active,
    localOverride,
    engineOffline: !_connected,
  };
  if (_viewIdentity(next) === _viewIdentity(_view)) return;
  _view = next;
  _listeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // A buggy subscriber must never break the broadcast pipeline.
    }
  });
}

function _emit(next: PerformanceModeState) {
  _cached = next;
  _recomputeView();
}

function _seedFromRest() {
  fetchPerformanceMode()
    .then((r) => {
      if (!r.ok || !r.data) return;
      _setResolved(true);
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
      _setResolved(true);
      _emit(reconcilePerformanceMode(_cached, msg));
    }
  });
  // REST seed now + on every control-bus (re)connect (the connect replay also
  // covers this, but the explicit fetch guarantees a seed even if the replay is
  // missed during the handshake race — same belt-and-braces as useEngineState).
  engineEvents.subscribeStatus((s) => {
    _connected = s.connected;
    if (s.connected) {
      // RECONNECT (report `_250`): the engine's broadcast is authoritative
      // again, so the client-local view override is DISCARDED here — never
      // merged into the engine state, never sent up, and never allowed to
      // survive into a later disconnect. The normal passcode-gated flow
      // resumes on the very next render.
      _localOverride = null;
      _seedFromRest();
    } else {
      _setResolved(false);
    }
    _emitReady();
    _recomputeView();
  });
  _seedFromRest();
}

/** Subscribe to the shared performance-mode state (override-aware). */
export function usePerformanceMode(): PerformanceModeView {
  _ensureInitialized();
  const [state, setState] = useState<PerformanceModeView>(_view);
  useEffect(() => {
    const listener = (s: PerformanceModeView) => setState(s);
    _listeners.add(listener);
    // Resync — handles the race between mount and first emit.
    listener(_view);
    return () => { _listeners.delete(listener); };
  }, []);
  return state;
}

/**
 * True once this pad has a definite performance-mode answer to render.
 *
 * Normally that means "this engine connection supplied authoritative state".
 * Report `_250` adds the one other way to have a definite answer: the engine
 * is unreachable AND the operator has taken a local view. Without that, an
 * offline pad reports not-ready forever, and not-ready is treated as LOCKED by
 * the tab policy and the route guard — which is the stuck face this fixes.
 */
export function usePerformanceModeReady(): boolean {
  _ensureInitialized();
  const [ready, setReady] = useState(_effectiveReady);
  useEffect(() => {
    _readyListeners.add(setReady);
    setReady(_effectiveReady());
    return () => { _readyListeners.delete(setReady); };
  }, []);
  return ready;
}

/**
 * Take a CLIENT-LOCAL view while the engine is unreachable (report `_250`).
 *
 * Presentation only: it changes what THIS pad draws (the perf overlays, the
 * tab policy, the route guard) and nothing else. No request is made, nothing
 * is persisted, and the pick is dropped the moment the control bus reconnects.
 *
 * Fails LOUD when the engine IS connected (codex P0 — no fallbacks): with a
 * live engine the only legitimate way to change mode is POST /performance-mode
 * through the passcode-gated flow, and a silent local flip there would be a
 * client-side lie about a globally-shared lock.
 */
export function setLocalPerformanceView(active: boolean): void {
  _ensureInitialized();
  if (_connected) {
    throw new Error(
      'setLocalPerformanceView: the engine is connected — mode changes must go '
      + 'through POST /performance-mode so the engine stays authoritative.',
    );
  }
  _localOverride = active;
  _emitReady();
  _recomputeView();
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
 * Apply the successful POST /performance-mode response immediately.
 *
 * The POST response comes from the same authoritative engine that owns the
 * lock, so it is safe to reconcile it directly.  This is deliberately not an
 * optimistic client-side flip: the UI only changes after the engine has
 * accepted the mutation.  We still follow it with the normal REST re-seed at
 * the call site, because enter/exit broadcasts and the response can omit the
 * dirty-summary fields.
 *
 * Returns false for a malformed response so callers can fail loudly rather
 * than pretending the show mode changed.
 */
export function applyPerformanceModeResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object'
      || typeof (response as { active?: unknown }).active !== 'boolean') {
    return false;
  }
  _ensureInitialized();
  _setResolved(true);
  _emit(reconcilePerformanceMode(_cached, response));
  return true;
}

/**
 * usePerfLock — convenience for the ~20 leaf components that only need "is the
 * structural lock on?". Every UI control that maps to a 409-gated engine route
 * reads this and renders the standard locked idiom (opacity 0.45 +
 * disabled/pointerEvents none, or the component's own `locked` prop).
 */
export function usePerfLock(): boolean {
  const performanceMode = usePerformanceMode();
  const performanceModeReady = usePerformanceModeReady();
  const { session, loading } = useCaptainPadAccess();
  return !performanceModeReady
    || isEffectivePerformanceLock(performanceMode.active, session, loading);
}

/**
 * useEditPersistLock — "will the engine persist what I do right now?" (docs/56).
 *
 * Sibling of usePerfLock, and deliberately a SEPARATE hook: usePerfLock guards
 * routes the engine 409s while a show is live; this one guards the narrower set
 * of affordances that write RIG STATE FILES (playlist CRUD, explicit captures,
 * the persistence controls) and which a non-owner edit session 403s. Live
 * control is not in that set — a sailor edits the rig, they just don't save it.
 *
 * False until the engine has answered, and false on auth-disabled engines,
 * where no gate exists: never grey a control on a guess.
 */
export function useEditPersistLock(): boolean {
  const performanceMode = usePerformanceMode();
  const ready = usePerformanceModeReady();
  if (!ready) return false;
  return !editPrincipalMaySave(performanceMode.editPrincipal, performanceMode.authRequired);
}

/**
 * Non-hook read of the ENGINE-AUTHORITATIVE performance-mode state (for
 * imperative code — the MIDI LED projector snapshot, and the takeover gates in
 * useTimeline / useSpecialEvents that decide whether a request needs a
 * passcode prompt).
 *
 * Deliberately NOT override-aware (report `_250`): every caller here is
 * deciding how to shape a request TO THE ENGINE, and those decisions must be
 * made against what the engine believes, never against a local view pick. The
 * override is presentation, and presentation is what the hook returns.
 */
export function getPerformanceModeState(): PerformanceModeState {
  _ensureInitialized();
  return _cached;
}

/**
 * Non-hook read of what the pad PRESENTS — the same override-aware projection
 * `usePerformanceMode()` hands React. Use this (not the raw state above) for
 * anything about screen composition; use the raw state for anything shaping a
 * request to the engine.
 */
export function getPerformanceModeView(): PerformanceModeView {
  _ensureInitialized();
  return _view;
}

/** Non-hook read of `usePerformanceModeReady()`. */
export function isPerformanceModeReady(): boolean {
  _ensureInitialized();
  return _effectiveReady();
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
