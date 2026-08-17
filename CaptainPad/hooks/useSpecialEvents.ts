// useSpecialEvents — live mirror of the engine's SPECIAL EVENTS show runner.
//
// The runner is engine-side (docs/52 §1c): the show clock, the stage cursor and
// the takeover lease all live there, so this hook is a VIEW. It holds no stage
// cursor of its own, never advances optimistically, and never persists a byte —
// an iPad that sleeps, backgrounds, or dies mid-reveal loses nothing, and a
// second pad shows exactly the same stage.
//
// Same recipe as useTimeline: module-level cache + listener set so a tab switch
// doesn't tear down the subscription, the shared /ws/control bus for live
// frames, and a REST seed for the cold mount that beats the socket.
//
// Codex P0 — fail loud: with no WS frame and no reachable seed, `state` is null
// and the tab renders its offline banner. A `specialEvents` frame we cannot
// parse becomes a visible error, never a silently ignored message.
//
// ARM carries the performance-mode passcode gate (operator ruling 2026-08-14,
// agent _201): ARM engages the timeline takeover lease, so while performance
// mode is live the operator is asked for a FRESH passcode every single time.
// Cancelling the prompt is NOT a failure — no request is issued and the rig
// keeps doing what it was doing.

import { useEffect, useState } from 'react';

import { engineEvents } from '@/utils/engineEvents';
import { getPerformanceModeState } from '@/hooks/usePerformanceMode';
import { runGatedTakeover } from '@/utils/takeover_passcode';
import {
  abortSpecialEvent,
  armSpecialEvent,
  describeEventRefusal,
  dismissSpecialEvent,
  extendSpecialEvent,
  fetchSpecialEventsState,
  finishSpecialEvent,
  fireSpecialEventQuickEffect,
  fireSpecialEventStage,
  parseSpecialEventsFrame,
  resetSpecialEventAutopilot,
  setSpecialEventAutopilot,
  SPECIAL_EVENTS_WS_TYPE,
  type EventAutopilotPatch,
  type SpecialEventsState,
} from '@/utils/special_events_api';

export interface SpecialEventsHookState {
  /**
   * The runner state — which CARRIES the show library (`state.catalog`), so the
   * run and the shows can never be a version apart. `null` = no engine truth
   * yet, and the tab says exactly that.
   */
  state: SpecialEventsState | null;
  connected: boolean;
  /** Last action / seed / frame error, surfaced verbatim. */
  error: string | null;
}

/**
 * `'ok'`        the engine armed the show.
 * `'cancelled'` the operator dismissed the performance-mode passcode prompt.
 *               NOTHING was requested. Never alert on this.
 * `'failed'`    the engine refused; the reason is on the hook's error channel.
 */
export type ArmOutcome = 'ok' | 'cancelled' | 'failed';

const EMPTY: SpecialEventsHookState = {
  state: null,
  connected: false,
  error: null,
};

let _cached: SpecialEventsHookState = EMPTY;
const _listeners = new Set<(s: SpecialEventsHookState) => void>();
let _initialized = false;

function _emit(next: SpecialEventsHookState) {
  _cached = next;
  _listeners.forEach((cb) => {
    try { cb(next); } catch { /* a buggy listener must never break the bus */ }
  });
}

/** Test seam: drop the module cache so each test starts from a cold tab. */
export function __resetSpecialEventsCache() {
  _cached = EMPTY;
  _initialized = false;
}

export function getSpecialEventsCache(): SpecialEventsHookState {
  return _cached;
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  engineEvents.subscribe((msg: any) => {
    if (!msg || msg.type !== SPECIAL_EVENTS_WS_TYPE) return;
    try {
      _emit({ ..._cached, state: parseSpecialEventsFrame(msg), connected: true, error: null });
    } catch (err: any) {
      // A frame that does not match the contract is a LOUD contract break —
      // the operator must see it, because the alternative is a tab confidently
      // painting a stage the engine left minutes ago.
      _emit({ ..._cached, error: err?.message || 'Unreadable specialEvents frame' });
    }
  });

  engineEvents.subscribeStatus((s: any) => {
    _emit({ ..._cached, connected: s.connected, error: s.lastError ?? _cached.error });
  });

  void _reseed();
}

/**
 * Re-read the runner state.
 *
 * `keepError` matters: after a REFUSAL we re-seed so the tab lands on the
 * engine's real stage, and that re-seed must NOT wipe the refusal message the
 * operator has not read yet (Codex P0 — a failure that vanishes in a
 * millisecond is a silent failure).
 */
async function _reseed(keepError = false): Promise<void> {
  const r = await fetchSpecialEventsState();
  if (r.ok && r.data) {
    _emit({ ..._cached, state: r.data, error: keepError ? _cached.error : null });
    return;
  }
  if (!_cached.state) {
    _emit({ ..._cached, error: r.error || 'Special events runner unreachable' });
  }
}

/** Re-read the runner document (pull-to-refresh / focus). */
export function refreshSpecialEvents(): Promise<void> {
  return _reseed();
}

/** Clear the surfaced error after the operator has read it. */
export function clearSpecialEventsError(): void {
  if (_cached.error === null) return;
  _emit({ ..._cached, error: null });
}

// ── Actions ───────────────────────────────────────────────────────────────
// Every mutation ANSWERS with the engine's new state document, so a success
// adopts the engine's own answer — no optimistic cursor, no extra round trip.
// A refusal re-reads instead, which lands the tab back on the engine's real
// stage rather than on whatever the operator hoped for.

interface ActionResult {
  ok: boolean;
  data?: SpecialEventsState;
  error?: string;
  code?: string;
  status?: number;
}

async function _act(run: () => Promise<ActionResult>): Promise<boolean> {
  const r = await run();
  if (!r.ok) {
    _emit({ ..._cached, error: describeEventRefusal(r) });
    await _reseed(true);
    return false;
  }
  _adopt(r.data);
  return true;
}

/** Take the engine's answer as the new truth; re-read if it sent none. */
function _adopt(next: SpecialEventsState | undefined): void {
  if (next === undefined) {
    void _reseed();
    return;
  }
  _emit({ ..._cached, state: next, error: null });
}

const ARM_PROMPT_TITLE = 'Operator passcode required';
const ARM_PROMPT_DETAIL =
  'The show is live. Arming a special event takes the rig over from the timeline plan, '
  + 'so an authorized operator passcode is required. A fresh passcode is required every '
  + 'time; ending the show never needs one.';

/**
 * ARM a show under the performance-mode passcode gate.
 *
 * Performance OFF → one plain request. Performance ON → prompt FIRST, one
 * request per typed passcode, nothing remembered between attempts.
 */
async function _armShow(showId: string): Promise<ArmOutcome> {
  let gated;
  try {
    gated = await runGatedTakeover({
      performanceActive: getPerformanceModeState().active,
      title: ARM_PROMPT_TITLE,
      detail: ARM_PROMPT_DETAIL,
      send: (passcode?: string) => armSpecialEvent(showId, passcode),
    });
  } catch (err: any) {
    // No prompt host mounted, or the transport threw. Fail LOUD: never arm a
    // show unauthenticated, never pretend it worked.
    _emit({ ..._cached, error: err?.message || 'Failed to arm the show' });
    return 'failed';
  }
  if (gated.cancelled) return 'cancelled';
  if (!gated.result.ok) {
    _emit({ ..._cached, error: describeEventRefusal(gated.result) });
    await _reseed(true);
    return 'failed';
  }
  _adopt(gated.result.data);
  return 'ok';
}

function _fireStage(stageId: string, choiceId?: string): Promise<boolean> {
  return _act(() => fireSpecialEventStage(stageId, choiceId));
}

function _pulseEffect(effectId: string): Promise<boolean> {
  return _act(() => fireSpecialEventQuickEffect(effectId));
}

function _extend(): Promise<boolean> {
  return _act(() => extendSpecialEvent());
}

function _finish(): Promise<boolean> {
  return _act(() => finishSpecialEvent());
}

function _abort(): Promise<boolean> {
  return _act(() => abortSpecialEvent());
}

/** Clear the ENDED banner once the operator has read it (engine-side flag). */
function _dismiss(): Promise<boolean> {
  return _act(() => dismissSpecialEvent());
}

/**
 * Retune the live stage's pattern rotation. Like every other verb here this is
 * NOT optimistic: the engine answers with the state it actually adopted, which
 * is what the card re-renders from. A knob that the engine clamped or refused
 * therefore snaps back to engine truth instead of lying about what the rig is
 * doing.
 */
function _setAutopilot(patch: EventAutopilotPatch): Promise<boolean> {
  return _act(() => setSpecialEventAutopilot(patch));
}

/** Back to the cadence the show file authored. */
function _resetAutopilot(): Promise<boolean> {
  return _act(() => resetSpecialEventAutopilot());
}

// Non-hook entry points — the same functions the hook hands out, exported so
// vitest (plain node, no React renderer) drives the real code paths.
export {
  _armShow as runArmShow,
  _fireStage as runFireStage,
  _pulseEffect as runPulseEffect,
  _extend as runExtend,
  _finish as runFinish,
  _dismiss as runDismiss,
  _abort as runAbort,
  _setAutopilot as runSetAutopilot,
  _resetAutopilot as runResetAutopilot,
};

export interface SpecialEventsActions {
  arm: (showId: string) => Promise<ArmOutcome>;
  fire: (stageId: string, choiceId?: string) => Promise<boolean>;
  pulseEffect: (effectId: string) => Promise<boolean>;
  extend: () => Promise<boolean>;
  finish: () => Promise<boolean>;
  abort: () => Promise<boolean>;
  dismiss: () => Promise<boolean>;
  setAutopilot: (patch: EventAutopilotPatch) => Promise<boolean>;
  resetAutopilot: () => Promise<boolean>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

export type UseSpecialEventsResult = SpecialEventsHookState & SpecialEventsActions;

export function useSpecialEvents(): UseSpecialEventsResult {
  _ensureInitialized();
  const [state, setState] = useState<SpecialEventsHookState>(_cached);
  useEffect(() => {
    _listeners.add(setState);
    // Resync in case an update landed between mount and effect run.
    setState(_cached);
    return () => { _listeners.delete(setState); };
  }, []);
  return {
    ...state,
    arm: _armShow,
    fire: _fireStage,
    pulseEffect: _pulseEffect,
    extend: _extend,
    finish: _finish,
    abort: _abort,
    dismiss: _dismiss,
    setAutopilot: _setAutopilot,
    resetAutopilot: _resetAutopilot,
    refresh: refreshSpecialEvents,
    clearError: clearSpecialEventsError,
  };
}
