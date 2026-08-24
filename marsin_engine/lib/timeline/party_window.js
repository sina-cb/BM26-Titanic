/*
 * party_window.js — THE ONE ANSWER to "is the Party Window open right now?"
 * (report 356 §2, findings F2/F4).
 *
 * Before this module the engine carried TWO definitions of an open window:
 *   (a) the STATUS one (`_partyWindowOpenAt`) — the phase clock is active AND
 *       the party cue's `days:` apply to the NIGHT the window belongs to, where
 *       a window observed after midnight belongs to the evening it started on;
 *   (b) the EVALUATOR one — `applicableCues()` on the CALENDAR day plus a
 *       clock-only `whenPhase` gate inside `evaluateTick`.
 * They disagreed for the entire post-midnight half of every wrapping window, so
 * `/party-config` said "WINDOW CLOSED" while the evaluator happily fired the
 * party cue. Everything — status, the runtime cue set, `getState().partyWindow`
 * and the resolver — now funnels through `partyWindowAt()` below.
 *
 * PURE, by the same discipline as triggers.js / festival.js / resolve_deck_state.js:
 * NO IO, NO Date.now(), the plan is never mutated, every instant is injected.
 *
 * NIGHT-START-DAY SEMANTICS (the operator's authoring intent): a Party Window
 * authored `21:00 → 09:00` is ONE window belonging to the evening it opened on.
 * The cue's `days:` index is resolved against that evening (`nightStartMs`), not
 * against the calendar day the clock happens to read at 02:00.
 */
import { resolveDayTimes, phaseActiveAt, clockToEpochMs, anchorToMs } from './triggers.js';
import { cueAppliesOn } from './festival.js';

const MS_PER_DAY = 86400000;

// A window with nothing authored (no party cue at all). Shaped exactly like a
// real answer so every consumer can read `.open` unconditionally.
const NO_WINDOW = {
  phaseId: null,
  open: false,
  startMs: null,
  endMs: null,
  nightStartMs: null,
  opensAtMs: null,
  closesAtMs: null,
};

/** The closed/absent window shape, for callers with no plan or no party cue. */
export function noPartyWindow() {
  return { ...NO_WINDOW };
}

/**
 * Resolve ONE named phase at `atMs` with NIGHT-START-DAY semantics.
 *
 * @param {{plan:object, phaseId:string, atMs:number, dayTimes?:object, sunEvents?:object}} args
 * @returns {{phaseId:string, active:boolean, startMs:number|null, endMs:number|null,
 *            nightStartMs:number|null, nightEndMs:number|null}}
 *   startMs/endMs — the phase anchors resolved on the CALENDAR day of `atMs`.
 *   nightStartMs  — the instant the window that covers (or next covers) `atMs`
 *                   opened: today's `startMs`, shifted back one day when a
 *                   wrapping window is observed after midnight.
 *   nightEndMs    — the matching close instant (shifted forward one day when a
 *                   wrapping window is observed before midnight).
 */
export function phaseWindowAt({ plan, phaseId, atMs, dayTimes, sunEvents }) {
  if (!plan || typeof plan !== 'object') throw new Error('phaseWindowAt: plan is required');
  if (typeof phaseId !== 'string' || !phaseId) {
    throw new Error(
      `phaseWindowAt: phaseId must be a non-empty string, got ${JSON.stringify(phaseId)}`);
  }
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
    throw new Error(`phaseWindowAt: atMs must be a finite epoch ms, got ${JSON.stringify(atMs)}`);
  }
  // The plan validator already rejects a trigger naming an undefined phase, so a
  // miss here is a corrupt in-memory plan — THROW, never a silent "closed".
  const authored = plan.phases ? plan.phases[phaseId] : undefined;
  if (!authored) {
    throw new Error(`phaseWindowAt: phase "${phaseId}" is not defined in plan "${plan.name}"`);
  }
  const times = dayTimes || resolveDayTimes({ plan, now: atMs, sunEvents: sunEvents || {} });
  const resolved = times.phases[phaseId] || { startMs: null, endMs: null };
  const { startMs, endMs } = resolved;
  const active = phaseActiveAt(startMs, endMs, atMs);
  const wraps = startMs !== null && endMs !== null && startMs > endMs;
  const nightStartMs = (wraps && atMs < endMs) ? startMs - MS_PER_DAY : startMs;
  const wrapsForward = wraps && atMs >= endMs;   // pre-midnight: the close is tomorrow
  const nightEndMs = endMs === null ? null : (wrapsForward ? endMs + MS_PER_DAY : endMs);
  return { phaseId, active, startMs, endMs, nightStartMs, nightEndMs };
}

/**
 * The phase anchor (`start` or `end`) `offsetDays` calendar days after the day
 * of `baseMs`. A CLOCK anchor is re-resolved on that day, so the answer is
 * DST-correct. A SUN anchor steps by one solar day per offset: the sun events
 * are only resolved for the day of `baseMs`, and re-deriving them here would
 * make this module impure. That is accurate to a few minutes, which is all the
 * "opens HH:MM" chip detail needs — and every real Party Window is clock-anchored.
 */
function phaseAnchorForDayOffset(plan, phaseId, which, baseMs, offsetDays, sunEvents) {
  const anchor = plan.phases[phaseId][which];
  const tz = plan.location.tz;
  if (anchor.clock !== undefined) {
    return clockToEpochMs(anchor.clock, baseMs + offsetDays * MS_PER_DAY, tz);
  }
  const base = anchorToMs(anchor, baseMs, tz, sunEvents || {});
  return base === null ? null : base + offsetDays * MS_PER_DAY;
}

/**
 * The NEXT night the window opens for real (clock AND the cue's `days:`), or
 * `{null, null}` when it never opens again inside the plan's own span. Bounded
 * by the festival length (or 2 days for a recurring-nightly plan).
 */
function nextOpening({ plan, cue, phaseId, now, sunEvents }) {
  const horizon = plan.festival ? plan.festival.days + 1 : 2;
  for (let k = 0; k < horizon; k += 1) {
    const opensAtMs = phaseAnchorForDayOffset(plan, phaseId, 'start', now, k, sunEvents);
    if (opensAtMs === null || opensAtMs <= now) continue;
    if (!cueAppliesOn(cue, plan, opensAtMs)) continue;
    let closesAtMs = phaseAnchorForDayOffset(plan, phaseId, 'end', now, k, sunEvents);
    if (closesAtMs !== null && closesAtMs <= opensAtMs) closesAtMs += MS_PER_DAY;
    return { opensAtMs, closesAtMs };
  }
  return { opensAtMs: null, closesAtMs: null };
}

/**
 * THE Party Window predicate (report 356 §2).
 *
 * @param {{plan:object, cue:object|null, now:number, sunEvents?:object, dayTimes?:object}} args
 *   cue — the plan's party cue (mood→party). `null` ⇒ no window at all.
 * @returns {{phaseId:string|null, open:boolean, startMs:number|null, endMs:number|null,
 *            nightStartMs:number|null, opensAtMs:number|null, closesAtMs:number|null}}
 *   open        — the window is open RIGHT NOW (clock active AND the cue's days
 *                 apply to the night it opened on).
 *   opensAtMs   — while open: the instant it opened. While closed: the next
 *                 instant it opens (null when it never opens again).
 *   closesAtMs  — the close instant of the window `opensAtMs` names.
 */
export function partyWindowAt({ plan, cue, now, sunEvents, dayTimes }) {
  if (!plan || typeof plan !== 'object') throw new Error('partyWindowAt: plan is required');
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new Error(`partyWindowAt: now must be a finite epoch ms, got ${JSON.stringify(now)}`);
  }
  if (!cue) return noPartyWindow();
  const whenPhase = (cue.trigger && cue.trigger.whenPhase !== undefined)
    ? cue.trigger.whenPhase : null;
  if (whenPhase === null) {
    // No authored window phase: the cue's festival DAYS are the ONLY gate, and
    // the window is the whole day — there is no HH:MM to open or close at.
    return { ...NO_WINDOW, open: cueAppliesOn(cue, plan, now) };
  }
  const w = phaseWindowAt({ plan, phaseId: whenPhase, atMs: now, dayTimes, sunEvents });
  const open = w.active && cueAppliesOn(cue, plan, w.nightStartMs);
  if (open) {
    return {
      phaseId: whenPhase,
      open: true,
      startMs: w.startMs,
      endMs: w.endMs,
      nightStartMs: w.nightStartMs,
      opensAtMs: w.nightStartMs,
      closesAtMs: w.nightEndMs,
    };
  }
  const next = nextOpening({ plan, cue, phaseId: whenPhase, now, sunEvents });
  return {
    phaseId: whenPhase,
    open: false,
    startMs: w.startMs,
    endMs: w.endMs,
    nightStartMs: w.nightStartMs,
    opensAtMs: next.opensAtMs,
    closesAtMs: next.closesAtMs,
  };
}
