/*
 * festival.js — PURE festival-span helpers for the 8-day model (docs/38 §15.2).
 * NO IO, NO Date.now(): `nowMs` is always injected, mirroring triggers.js. These
 * answer "which festival day is it today, and which cues apply today" so the
 * runtime tick can stay a one-day evaluation while the PLAN spans the festival.
 *
 * All day math is done in the plan's location timezone (`plan.location.tz`):
 * a festival day is a calendar day in that tz, indexed 0..(festival.days-1)
 * starting at festival.startDate.
 */

import { dayKeyFor } from './triggers.js';

const MS_PER_DAY = 86400000;

// Calendar-day count between two 'YYYY-MM-DD' keys (b - a), tz-independent: both
// keys are anchored at UTC midnight so DST never distorts the day delta.
function dayKeyDelta(aKey, bKey) {
  const [ay, am, ad] = aKey.split('-').map(Number);
  const [by, bm, bd] = bKey.split('-').map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((bUtc - aUtc) / MS_PER_DAY);
}

/**
 * 0-based index of TODAY within the festival span, computed in the plan's tz.
 * Returns null when the plan has no festival block, or when today falls outside
 * [startDate, startDate+days-1].
 *
 * @param {object} plan   — a normalized (v2) plan
 * @param {number} nowMs  — injected clock
 * @returns {number|null}
 */
export function festivalDayIndex(plan, nowMs) {
  const festival = plan && plan.festival;
  if (!festival) return null;
  const tz = plan.location.tz;
  const todayKey = dayKeyFor(nowMs, tz);
  const idx = dayKeyDelta(festival.startDate, todayKey);
  if (idx < 0 || idx > festival.days - 1) return null;
  return idx;
}

/**
 * Whether a cue applies on TODAY's festival day:
 *   days:'all'            → always true (recurring nightly)
 *   integer array         → includes today's festivalDayIndex
 *   date-string array     → includes today's 'YYYY-MM-DD' (in the plan's tz)
 * A day/index-targeted cue on a plan with no festival (or on a day outside the
 * span) does NOT apply.
 *
 * @param {object} cue   — a normalized cue (days already normalized)
 * @param {object} plan
 * @param {number} nowMs
 * @returns {boolean}
 */
export function cueAppliesOn(cue, plan, nowMs) {
  const days = cue.days === undefined ? 'all' : cue.days;
  if (days === 'all') return true;
  if (!Array.isArray(days) || days.length === 0) return false;
  // A day/date-targeted cue requires a festival span (matches the validator +
  // docs §15.2). Without one, BOTH index and date forms must NOT apply —
  // short-circuit here so the date form can't slip through asymmetrically.
  if (!plan || !plan.festival) return false;
  if (typeof days[0] === 'number') {
    const idx = festivalDayIndex(plan, nowMs);
    return idx !== null && days.includes(idx);
  }
  // Date-string form: match today's calendar day in the plan's tz.
  const todayKey = dayKeyFor(nowMs, plan.location.tz);
  return days.includes(todayKey);
}

/**
 * The subset of plan.cues that apply TODAY. Cues with days:'all' (or no
 * festival) always pass; index/date cues pass only on their day.
 *
 * @param {object} plan
 * @param {number} nowMs
 * @returns {Array}
 */
export function applicableCues(plan, nowMs) {
  if (!plan || !Array.isArray(plan.cues)) return [];
  return plan.cues.filter((cue) => cueAppliesOn(cue, plan, nowMs));
}

/**
 * Whole CALENDAR days (in the plan's tz) from TODAY until festival.startDate,
 * computed via the same UTC-midnight day-key math as festivalDayIndex so DST
 * never distorts the count. Returns a POSITIVE integer ONLY when the plan has a
 * festival AND today is strictly BEFORE startDate. Returns null otherwise —
 * no festival, today on/after startDate (in-window or already ended).
 *
 * @param {object} plan   — a normalized (v2) plan
 * @param {number} nowMs  — injected clock
 * @returns {number|null}
 */
export function festivalStartsInDays(plan, nowMs) {
  const festival = plan && plan.festival;
  if (!festival) return null;
  const tz = plan.location.tz;
  const todayKey = dayKeyFor(nowMs, tz);
  const delta = dayKeyDelta(todayKey, festival.startDate); // startDate - today
  return delta > 0 ? delta : null;
}

/**
 * The 'YYYY-MM-DD' calendar date of festival day `index`, computed from
 * startDate. tz-independent (anchored at UTC midnight). Throws on a bad index.
 *
 * @param {object} festival — { startDate, days }
 * @param {number} index    — 0..(days-1)
 * @returns {string}
 */
export function festivalDateFor(festival, index) {
  if (!festival) throw new Error('festivalDateFor: no festival block');
  if (!Number.isInteger(index) || index < 0 || index > festival.days - 1) {
    throw new Error(`festivalDateFor: index ${index} out of range [0, ${festival.days - 1}]`);
  }
  const [y, m, d] = festival.startDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + index));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
