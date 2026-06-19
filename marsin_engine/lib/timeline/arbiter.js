/*
 * arbiter.js — PURE control-precedence arbitration for the Timeline Companion
 * (docs/38 §14). It layers ON TOP of evaluateTick (triggers.js): triggers decide
 * WHICH cues want to fire; the arbiter decides WHICH of those actually drive the
 * lights, under the three-layer precedence model:
 *
 *   MANUAL / paused  (operator takeover — drives nothing, hold keeps the look)
 *     > PROGRAM       (a preprogrammed scheduled show — overrides autopilot,
 *                      suppresses mood swaps, owns priority for its hold window)
 *     > AUTOPILOT     (baseline: engine autopilot cycles a playlist + mood swaps
 *                      fire "as needed"; toggleable off → manual)
 *
 * Like triggers.js this is a PURE function: NO IO, NO Date.now() inside, and the
 * input `state` is NEVER mutated (it is cloned). The SERVER executes the returned
 * actions and persists the returned state. This keeps the "full night in seconds"
 * simulated-clock test possible and lets the same logic later run in CaptainPad
 * (docs/38 §14.6).
 */
import { anchorToMs } from './triggers.js';

const MS_PER_MIN = 60000;

function cloneState(state) {
  return structuredClone(state);
}

/**
 * Resolve a program cue's hold window → an absolute untilMs (or null).
 *   { min }          → now + min*60000
 *   { until:anchor } → anchor resolved to epoch (clock/sun via triggers.js)
 *   omitted/null     → null (holds until the next program cue / operator ends it)
 *
 * @param {{min:number}|{until:object}|null|undefined} hold
 * @param {number} now epoch ms
 * @param {{tz:string, sunEvents:object}} dayTimes
 * @returns {number|null}
 */
export function resolveHold(hold, now, dayTimes) {
  if (hold === undefined || hold === null) return null;
  if (hold.min !== undefined) return now + hold.min * MS_PER_MIN;
  if (hold.until !== undefined) {
    return anchorToMs(hold.until, now, dayTimes.tz, dayTimes.sunEvents);
  }
  return null;
}

/**
 * Arbitrate one tick's fires against the control-precedence model (docs/38 §14).
 * PURE — clones state, returns the new state and the actions the server should
 * execute.
 *
 * @param {{
 *   now: number,
 *   plan: object,                         // validated show plan (carries autopilot + cue kinds)
 *   state: object,                        // runtime state (autopilotEnabled, mode, activeProgram, pendingProgram, manualHoldUntilMs)
 *   fires: Array<{cueId:string, reason:string}>,   // from evaluateTick
 *   dayTimes: object,                     // from resolveDayTimes (carries tz + sunEvents for hold anchors)
 *   leaseSec?: number,                    // pending-program lease window (docs/38 §16.5, default 30)
 * }} args
 * @returns {{
 *   actions: Array<{cueId:string, action:object, autopilotOff?:boolean}>,
 *   state: object,
 *   controller: 'manual'|'program'|'autopilot',
 * }}
 */
export function arbitrate({ now, plan, state, fires, dayTimes, leaseSec }) {
  const next = cloneState(state);
  const actions = [];

  const cueById = new Map();
  for (const cue of plan.cues) cueById.set(cue.id, cue);

  const autopilotEnabled = next.autopilotEnabled !== false;
  const paused = next.mode === 'paused' || next.mode === 'overridden';
  const holding = typeof next.manualHoldUntilMs === 'number' && next.manualHoldUntilMs > now;
  const moodAllowed = !plan.autopilot || plan.autopilot.mood !== false;
  const leaseWindowSec = typeof leaseSec === 'number' && leaseSec > 0 ? leaseSec : 30;

  // ── "manual" = any operator-owned sub-state (docs/38 §16.1) ─────────────────
  // PAUSED/OVERRIDDEN (mode), HOLDING (manualHoldUntilMs), or IDLE (autopilot
  // disabled with no active program). A lease arms on top of ANY of these.
  const manual = paused || holding || (!autopilotEnabled && !next.activeProgram);

  // ── lease auto-expiry FIRST (docs/38 §16.5: lease-exp → PG auto-start) ──────
  // The show goes on even when manual/paused (I2). Convert the lease into an
  // active program NOW, disarm the baseline, and emit the program's action.
  let leaseAutoStarted = false;
  if (next.pendingProgram && typeof next.pendingProgram.expiresAtMs === 'number'
      && now >= next.pendingProgram.expiresAtMs) {
    const pend = next.pendingProgram;
    const cue = cueById.get(pend.cueId);
    const hold = cue ? cue.hold : undefined;
    next.activeProgram = {
      cueId: pend.cueId,
      startedAtMs: now,
      untilMs: resolveHold(hold, now, dayTimes),
    };
    next.pendingProgram = null;
    actions.push({ cueId: pend.cueId, action: pend.action, autopilotOff: true });
    leaseAutoStarted = true;
  }

  // ── expire an active program whose hold window has elapsed ──────────────────
  let programEnded = false;
  if (!leaseAutoStarted && next.activeProgram && typeof next.activeProgram.untilMs === 'number'
      && now >= next.activeProgram.untilMs) {
    next.activeProgram = null;
    programEnded = true;
  }

  // ── base controller (before processing this tick's fires) ───────────────────
  // A pending lease does NOT change the controller — the manual owner still
  // drives until the lease resolves (docs/38 §16.1).
  let controller;
  if (leaseAutoStarted) controller = 'program';
  else if (paused || holding) controller = 'manual';
  else if (next.activeProgram) controller = 'program';
  else if (autopilotEnabled) controller = 'autopilot';
  else controller = 'manual';

  // ── program ended → re-establish autopilot FIRST (before this tick's fires) ──
  // The resume action must precede any mood/ambient action so a server applying
  // actions in order re-arms the baseline, then the mood/ambient swap lands ON
  // TOP and wins. Emitting resume last would let the baseline playlist clobber
  // the mood swap on the same tick a program expires.
  let resumedThisTick = false;
  if (programEnded && autopilotEnabled && !paused && !holding) {
    actions.push({ cueId: '__autopilot_resume__', action: { type: '__resume_autopilot__' } });
    next.activeProgram = null;
    controller = 'autopilot';
    resumedThisTick = true;
  }

  // ── process fires in plan/fire order ────────────────────────────────────────
  let programStartedThisTick = false;
  for (const fire of fires) {
    const cue = cueById.get(fire.cueId);
    if (!cue) continue;                 // unknown cue id → nothing to drive
    const kind = cue.kind;

    if (kind === 'program') {
      // A program just auto-started from a lease this tick — a freshly-due
      // program is the one we just started; ignore further program fires.
      if (leaseAutoStarted) continue;
      // MANUAL (paused/holding/idle) → ARM a lease instead of firing (docs/38
      // §16.4/§16.5, I2/I3). The operator gets a sign; if no action within the
      // lease window the lease auto-starts the program. Only ONE pending at a
      // time — a newer due program replaces an un-actioned one. We do NOT latch
      // firedToday on ARM (only on fire/auto-start/dismiss) so the lease is the
      // single record of the due program.
      if (manual) {
        next.pendingProgram = {
          cueId: cue.id,
          label: cue.label || cue.id,
          action: cue.action,
          armedAtMs: now,
          expiresAtMs: now + leaseWindowSec * 1000,
        };
        // controller is unchanged (stays manual) — the lease layers on top.
        continue;
      }
      // AUTOPILOT → preempt immediately. PROGRAM → replace the active program.
      next.activeProgram = {
        cueId: cue.id,
        startedAtMs: now,
        untilMs: resolveHold(cue.hold, now, dayTimes),
      };
      programStartedThisTick = true;
      controller = 'program';
      actions.push({ cueId: cue.id, action: cue.action, autopilotOff: true });
    } else if (kind === 'mood') {
      // Moods only move the lights during autopilot, and never on the same tick a
      // program just started (the program owns this tick).
      if (controller === 'autopilot' && moodAllowed && !programStartedThisTick) {
        actions.push({ cueId: cue.id, action: cue.action });
      }
      // else: SUPPRESSED (dropped) — visible as "wouldFire" upstream if desired.
    } else {
      // ambient / other: applies whenever we are not in manual control.
      if (controller !== 'manual') {
        actions.push({ cueId: cue.id, action: cue.action });
      }
    }
  }

  // If a NEW program started this same tick, it re-seized control. The resume we
  // pushed before the loop is now redundant (the program turns autopilot off and
  // loads its own look) — drop it to avoid a needless baseline flicker. controller
  // is already 'program' (set in the loop).
  if (resumedThisTick && programStartedThisTick) {
    const idx = actions.findIndex((a) => a.cueId === '__autopilot_resume__');
    if (idx !== -1) actions.splice(idx, 1);
  }

  next.controller = controller;
  return { actions, state: next, controller };
}
