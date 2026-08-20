// useTimeline — live mirror of the in-engine Timeline service.
//
// docs/38 §15: the Timeline runs IN the engine now (no separate :6965
// companion). The engine broadcasts a `timelineState` message on its
// `/ws/control` topic on connect and on every state change (tick, takeover,
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { engineEvents } from '@/utils/engineEvents';
import { getPerformanceModeState } from '@/hooks/usePerformanceMode';
import { runGatedTakeover } from '@/utils/takeover_passcode';
import {
  fetchTimelineState,
  activateTimelinePlan,
  setTimelineAutopilot,
  resumeTimeline,
  endTimelineProgram,
  enableTimelineProgram,
  dismissTimelineProgram,
  fireTimelineCue,
  postTimelineTakeover,
  postTimelineActivity,
  postTimelineTravel,
  TimelineState,
  TimelineTravelSpec,
} from '@/utils/timelineApi';

export interface TimelineHookState {
  state: TimelineState | null;
  connected: boolean;
  /** Last seed/action error surfaced for the offline banner / toast. */
  error: string | null;
}

export interface TimelineActions {
  activatePlan: (name: string) => Promise<boolean>;
  setAutopilot: (enabled: boolean) => Promise<boolean>;
  /** End an operator takeover and resume the plan at now (POST /timeline/resume). */
  resume: () => Promise<boolean>;
  endProgram: () => Promise<boolean>;
  /** Start the pending-program lease NOW (docs/38 §16.5 lease-enable). */
  enableProgram: () => Promise<boolean>;
  /** Dismiss the pending-program lease; stay manual (docs/38 §16.5 lease-dismiss). */
  dismissProgram: () => Promise<boolean>;
  fireCue: (id: string) => Promise<boolean>;
  /**
   * Take the rig over from a running plan; arms the operator lease.
   *
   * THREE outcomes, not two (operator ruling 2026-08-14): while performance
   * mode is live the operator is asked for a passcode first, and DISMISSING
   * that prompt is not a failure — no request is even made. Callers must not
   * alert on `'cancelled'`.
   */
  takeover: () => Promise<TakeoverOutcome>;
  /** Refresh the takeover lease (no-op when none held). Throttle the caller. */
  activity: () => Promise<boolean>;
  /**
   * EVENT ZOOM · PERFORM (_95 §3.3): a SCOPED takeover of the LIVE event —
   * the plan holds, and a program that comes due is deferred until exit.
   * Carries the engine's error verbatim on failure; `'cancelled'` means the
   * operator dismissed the performance-mode passcode prompt.
   */
  performTakeover: (cueId: string) => Promise<PerformTakeoverResult>;
  /**
   * EVENT ZOOM · TIME TRAVEL (_95 §3.4): enter (or retarget) a travel zoom.
   * Returns the engine's error verbatim on failure (null on success).
   */
  travel: (spec: TimelineTravelSpec) => Promise<string | null>;
}

export type UseTimelineResult = TimelineHookState & TimelineActions;

/**
 * `'ok'`        the engine armed the operator lease.
 * `'cancelled'` the operator dismissed the performance-mode passcode prompt —
 *               NOTHING was requested and the plan keeps running. Never alert.
 * `'failed'`    the engine refused; the reason is on the hook's error channel.
 */
export type TakeoverOutcome = 'ok' | 'cancelled' | 'failed';

export interface PerformTakeoverResult {
  outcome: TakeoverOutcome;
  /** The engine's message, verbatim, when `outcome === 'failed'`. */
  error: string | null;
}

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

async function _reseedAfterAction({ preserveError = false } = {}) {
  const r = await fetchTimelineState();
  if (r.ok && r.data) {
    _emit({
      state: r.data,
      connected: _cached.connected,
      error: preserveError ? _cached.error : null,
    });
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

async function _setAutopilot(enabled: boolean): Promise<boolean> {
  const r = await setTimelineAutopilot(enabled);
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to toggle autopilot' });
    // Reconcile the authoritative state, but keep the refusal visible. This is
    // especially important for a Live Touch lease conflict: clearing the error
    // during the follow-up GET made a rejected action look successful.
    await _reseedAfterAction({ preserveError: true });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _resume(): Promise<boolean> {
  // Claim the exit BEFORE the request goes out. The engine clears the zoom and
  // broadcasts the new `timelineState` on its own 1 s tick, which routinely
  // beats our REST response back to the app — without this claim the ZoomBanner
  // reads that broadcast as "the zoom ended and it wasn't me" and raises the
  // engine-restart alarm at an operator who just asked to leave.
  _zoomExitRequested = true;
  const r = await resumeTimeline();
  if (!r.ok) {
    // The zoom is still live: drop the claim so the real "it ended without you"
    // signal still works, and keep our entered-here claim so the tab-return
    // gesture (and the banner's EXIT) can try again.
    _zoomExitRequested = false;
    _emit({ ..._cached, error: r.error || 'Failed to resume' });
    return false;
  }
  // The single exit for a plain takeover, PERFORM and TRAVEL alike — the engine
  // clears the zoom with the lease. Drop our "we entered it" claim too, so a
  // later tab return can't fire a second, pointless resume.
  _zoomEnteredHere = false;
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

async function _enableProgram(): Promise<boolean> {
  const r = await enableTimelineProgram();
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to enable program' });
    return false;
  }
  await _reseedAfterAction();
  return true;
}

async function _dismissProgram(): Promise<boolean> {
  const r = await dismissTimelineProgram();
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to dismiss program' });
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

// ── PERFORMANCE-MODE TAKEOVER PASSCODE (operator ruling 2026-08-14) ───────
//
// "Take over in performance mode from the timeline needs to have either of the
// passwords we have for Sina, Muisha, or Sailors" … "pass code is required
// EVERY TIME."
//
// EVERY takeover affordance in this app funnels through the two functions
// below, so gating them here is what makes the rule exhaustive: the
// PlanLockBanner button on deck/mixer/touch-control, the mixer's
// takeover-and-switch-output variant, the implicit takeover fired by touching a
// manual control under a live plan (useOperatorTakeover), and the EVENT sheet's
// scoped PERFORM.
//
// The gate reads the ENGINE-GLOBAL performance flag, not this device's
// privilege: a privileged pad with a live 30-minute session is asked for the
// passcode exactly like every other pad, because the engine ignores session
// tokens on this route. The passcode is never stored — see the storage audit in
// utils/takeover_passcode.ts.
const TAKEOVER_PROMPT_TITLE = 'Operator passcode required';
const TAKEOVER_PROMPT_DETAIL =
  'The show is live and the timeline is driving the rig. Enter an authorized operator '
  + 'passcode to take control. A fresh passcode is required for every takeover; handing '
  + 'the rig back to the plan never needs one.';

async function _takeover(): Promise<TakeoverOutcome> {
  let gated;
  try {
    gated = await runGatedTakeover({
      performanceActive: getPerformanceModeState().active,
      title: TAKEOVER_PROMPT_TITLE,
      detail: TAKEOVER_PROMPT_DETAIL,
      send: (auth) => postTimelineTakeover(undefined, auth),
    });
  } catch (err: any) {
    // No prompt host mounted, or the transport threw: fail LOUD, never take
    // over unauthenticated and never pretend it worked.
    _emit({ ..._cached, error: err?.message || 'Failed to take over plan' });
    return 'failed';
  }
  if (gated.cancelled) return 'cancelled';
  if (!gated.result.ok) {
    _emit({ ..._cached, error: gated.result.error || 'Failed to take over plan' });
    return 'failed';
  }
  // Re-seed so the indicator flips to the lease/countdown state immediately —
  // the engine also broadcasts `timelineState`, this just converges faster.
  await _reseedAfterAction();
  return 'ok';
}

// ── EVENT ZOOM: "did THIS client enter the zoom?" ────────────────────────
//
// D1 (operator ruling): returning to the TIMELINE tab exits the zoom — but ONLY
// from the client that entered it. There is ONE engine zoom session and both
// pads render the same banner off the same broadcast; if a second pad's ordinary
// tab-browsing fired resume(), it would yank pad A's live performance. So the
// tab-return exit is gated on this module-level flag, and every OTHER client
// exits through the banner's explicit EXIT button.
//
// Module-level (not React state) for the same reason the cache above is: the
// timeline tab unmounts on every tab switch and this must survive that.
let _zoomEnteredHere = false;

// "WE asked for this exit." Set the instant a resume() is issued from ANY
// surface (the banner's EXIT, the timeline-tab return) and read by the banner
// to tell an operator-requested exit apart from one the engine imposed —
// lease expiry, engine restart, autopilot OFF, a maker auto-save. Only the
// latter deserves the "zoom ended" notice.
let _zoomExitRequested = false;

/** True when THIS client is the one that entered the live zoom. */
export function zoomEnteredHere(): boolean {
  return _zoomEnteredHere;
}

/** True when this client asked for the zoom to end (see `_zoomExitRequested`). */
export function zoomExitRequested(): boolean {
  return _zoomExitRequested;
}

/** Clear both zoom claims — called once the engine's `zoom` is observed null. */
export function clearZoomClaims(): void {
  _zoomEnteredHere = false;
  _zoomExitRequested = false;
}

async function _performTakeover(cueId: string): Promise<PerformTakeoverResult> {
  let gated;
  try {
    // Same gate as the plain takeover: a SCOPED perform is still seizing the
    // rig from a running plan, which is exactly what the ruling covers.
    gated = await runGatedTakeover({
      performanceActive: getPerformanceModeState().active,
      title: TAKEOVER_PROMPT_TITLE,
      detail: TAKEOVER_PROMPT_DETAIL,
      send: (auth) => postTimelineTakeover({ scope: 'perform', cueId }, auth),
    });
  } catch (err: any) {
    const msg = err?.message || 'Failed to take the deck';
    _emit({ ..._cached, error: msg });
    return { outcome: 'failed', error: msg };
  }
  if (gated.cancelled) return { outcome: 'cancelled', error: null };
  if (!gated.result.ok) {
    const msg = gated.result.error || 'Failed to take the deck';
    _emit({ ..._cached, error: msg });
    return { outcome: 'failed', error: msg };
  }
  _zoomEnteredHere = true;
  await _reseedAfterAction();
  return { outcome: 'ok', error: null };
}

async function _travel(spec: TimelineTravelSpec): Promise<string | null> {
  const r = await postTimelineTravel(spec);
  if (!r.ok) {
    // Codex P0: the engine's 400 is the message — "no prev event on 2026-09-04",
    // "target … is outside the festival window". Never soften it, never clamp.
    const msg = r.error || 'Failed to time travel';
    _emit({ ..._cached, error: msg });
    return msg;
  }
  _zoomEnteredHere = true;
  await _reseedAfterAction();
  return null;
}

async function _activity(): Promise<boolean> {
  // A harmless no-op engine-side when no lease is held; only refreshes the
  // expiry while overridden. We do NOT re-seed here — activity pings are
  // high-frequency and the next `timelineState` broadcast carries the fresh
  // `expiresAtMs`. A failure is non-fatal (the countdown still ticks), so we
  // surface it on the error channel but never throw.
  const r = await postTimelineActivity();
  if (!r.ok) {
    _emit({ ..._cached, error: r.error || 'Failed to refresh lease' });
    return false;
  }
  return true;
}

// Non-hook entry points for the two gated takeovers. Same functions the hook
// hands out — exported so imperative code (and vitest, which runs in plain
// node with no React renderer) can exercise the passcode gate directly.
export { _takeover as runTakeover, _performTakeover as runPerformTakeover };

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
    setAutopilot: _setAutopilot,
    resume: _resume,
    endProgram: _endProgram,
    enableProgram: _enableProgram,
    dismissProgram: _dismissProgram,
    fireCue: _fireCue,
    takeover: _takeover,
    activity: _activity,
    performTakeover: _performTakeover,
    travel: _travel,
  };
}

// ── EVENT ZOOM presence pings (_94 §3.2 "presence, not touch") ───────────
//
// A performer may watch the rig hands-off for minutes. The plain takeover's
// touch-driven pings (useOperatorTakeover below) would let the 120 s lease lapse
// mid-performance, so while the ZOOM BANNER is mounted and a zoom is held we
// ping /timeline/activity on a fixed interval instead.
//
// This is deliberately NOT a "never expire" hack: the pings stop the moment the
// banner unmounts (app backgrounded on web = the page is gone, iPad dead, WiFi
// gone), the lease expires, and the plan auto-resumes. The "never stuck"
// invariant survives every failure mode.
const ZOOM_PRESENCE_PING_MS = 30_000;

export function useZoomPresence(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    // Ping immediately on entry so a lease armed just before a slow render
    // still gets its first refresh promptly, then every 30 s.
    void _activity();
    const t = setInterval(() => { void _activity(); }, ZOOM_PRESENCE_PING_MS);
    return () => clearInterval(t);
  }, [active]);
}

// ── Operator-takeover interaction hook (DECK/MIXER) ──────────────────────
//
// Request #3: when a plan is driving the rig and the operator touches a manual
// control, they are taking over. This hook packages the takeover/activity
// wiring + a live countdown so the deck and mixer share ONE implementation
// (no drift between the two surfaces).
//
//   notifyInteraction()  — call on EVERY manual control interaction (fader,
//     button, pattern select). It:
//       • fires POST /timeline/takeover ONCE on the first interaction while a
//         plan is active and no lease is yet held (debounced via a ref so a
//         fader drag doesn't spam the route), then
//       • throttles POST /timeline/activity to ~once / ACTIVITY_THROTTLE_MS
//         while a lease IS held, so the lease stays alive only as long as the
//         operator keeps working. When they stop, real inactivity expires it.
//
//   leaseRemainingSec    — the live "plan resumes in M:SS" countdown derived
//     from operatorLease.expiresAtMs, ticked every 1s. null when no lease.
//
// We deliberately do NOT run any fixed idle timer — pings track real touches so
// genuine 2-min inactivity actually releases the lease engine-side (catchUp).

export interface OperatorTakeover {
  /** True when controller ∈ {autopilot,program} and not overridden (takeover). */
  planActive: boolean;
  /** True while an operator takeover lease is held (mode overridden). */
  leaseHeld: boolean;
  /** Live "plan resumes in" seconds, or null when no lease is held. */
  leaseRemainingSec: number | null;
  /** Call on any manual control interaction (fader/button/select). */
  notifyInteraction: () => void;
  /** Hand the plan back immediately (POST /timeline/resume). */
  resumeNow: () => Promise<boolean>;
}

// Throttle window for activity pings — roughly one ping per this many ms of
// continued interaction (well under the 2-min lease window).
const ACTIVITY_THROTTLE_MS = 10_000;

export function useOperatorTakeover(): OperatorTakeover {
  const { state, takeover, activity, resume } = useTimeline();
  const planActive = state?.planActive === true;
  const lease = state?.operatorLease ?? null;
  const leaseHeld = !!lease || state?.mode === 'overridden';

  // Refs so the throttle/debounce survive re-renders without re-subscribing.
  const lastActivityRef = useRef(0);
  const takeoverInFlightRef = useRef(false);
  // Mirror the live state into refs so the stable notifyInteraction callback
  // reads the latest values without being re-created on every state change.
  const planActiveRef = useRef(planActive);
  const leaseHeldRef = useRef(leaseHeld);
  useEffect(() => { planActiveRef.current = planActive; }, [planActive]);
  useEffect(() => { leaseHeldRef.current = leaseHeld; }, [leaseHeld]);

  const notifyInteraction = useCallback(() => {
    if (leaseHeldRef.current) {
      // Lease already held → keep it alive, throttled to real interaction.
      const now = Date.now();
      if (now - lastActivityRef.current >= ACTIVITY_THROTTLE_MS) {
        lastActivityRef.current = now;
        void activity();
      }
      return;
    }
    if (planActiveRef.current && !takeoverInFlightRef.current) {
      // First interaction against a live plan → take over ONCE.
      takeoverInFlightRef.current = true;
      lastActivityRef.current = Date.now();
      void takeover().finally(() => { takeoverInFlightRef.current = false; });
    }
  }, [activity, takeover]);

  // 1s ticker → live countdown. Only runs while a lease is held.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lease) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [lease]);

  const leaseRemainingSec = (() => {
    if (!lease || !Number.isFinite(lease.expiresAtMs)) return null;
    return Math.max(0, Math.round((lease.expiresAtMs - Date.now()) / 1000));
  })();

  return { planActive, leaseHeld, leaseRemainingSec, notifyInteraction, resumeNow: resume };
}
