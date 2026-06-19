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
 *   state: object,                        // runtime state (autopilotEnabled, mode, activeProgram, manualHoldUntilMs)
 *   fires: Array<{cueId:string, reason:string}>,   // from evaluateTick
 *   dayTimes: object,                     // from resolveDayTimes (carries tz + sunEvents for hold anchors)
 * }} args
 * @returns {{
 *   actions: Array<{cueId:string, action:object, autopilotOff?:boolean}>,
 *   state: object,
 *   controller: 'manual'|'program'|'autopilot',
 * }}
 */
export function arbitrate({ now, plan, state, fires, dayTimes }) {
  const next = cloneState(state);
  const actions = [];

  const cueById = new Map();
  for (const cue of plan.cues) cueById.set(cue.id, cue);

  const autopilotEnabled = next.autopilotEnabled !== false;
  const paused = next.mode === 'paused' || next.mode === 'overridden';
  const holding = typeof next.manualHoldUntilMs === 'number' && next.manualHoldUntilMs > now;
  const moodAllowed = !plan.autopilot || plan.autopilot.mood !== false;

  // ── expire an active program whose hold window has elapsed ──────────────────
  let programEnded = false;
  if (next.activeProgram && typeof next.activeProgram.untilMs === 'number'
      && now >= next.activeProgram.untilMs) {
    next.activeProgram = null;
    programEnded = true;
  }

  // ── base controller (before processing this tick's fires) ───────────────────
  let controller;
  if (paused || holding) controller = 'manual';
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
      // A scheduled program preempts autopilot UNLESS the operator has hard
      // takeover (paused/overridden) or a manual hold is keeping a look.
      if (paused || holding) continue;  // operator's hands win — suppress
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
