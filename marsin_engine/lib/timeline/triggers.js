/*
 * triggers.js — PURE trigger evaluation for the Timeline Companion. NO IO, NO
 * Date.now() inside: time is always injected. The tick loop is a pure function
 * of (now, plan, state, mood, dayTimes) → which cues fired + the next state.
 * This file decides WHICH cues fire; it never executes actions (that is the
 * server's job). Keeping it pure makes the whole "full night in seconds"
 * simulated-clock test possible (docs/38 §4, §10).
 */

const MS_PER_MIN = 60000;

// ── local-time helpers (tz-aware, injected `now`) ─────────────────────────────

/**
 * The 'YYYY-MM-DD' calendar day of `nowMs` in IANA timezone `tz`.
 */
export function dayKeyFor(nowMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // en-CA yields "YYYY-MM-DD".
  return fmt.format(new Date(nowMs));
}

/**
 * The UTC offset (minutes) of timezone `tz` at instant `nowMs`. Positive east
 * of UTC. Derived by formatting the instant in `tz` and in UTC and diffing the
 * wall-clock fields — robust across DST without a tz database.
 */
function tzOffsetMinutes(nowMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  // The local wall-clock as if it were UTC, minus the true instant = offset.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - nowMs) / MS_PER_MIN);
}

/**
 * Convert a local wall-clock "HH:MM" on the calendar day of `nowMs` (in `tz`)
 * → epoch ms. Resolves the tz offset for that local day so the returned instant
 * is the correct UTC moment, DST included.
 */
export function clockToEpochMs(hhmm, nowMs, tz) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const dayKey = dayKeyFor(nowMs, tz);
  const [y, mo, d] = dayKey.split('-').map(Number);
  // First approximation: treat the wall-clock as UTC, then correct by the tz
  // offset measured AT that approximate instant (handles the day's DST state).
  const naiveUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const offsetMin = tzOffsetMinutes(naiveUtc, tz);
  return naiveUtc - offsetMin * MS_PER_MIN;
}

/**
 * Convert a SPECIFIC calendar date 'YYYY-MM-DD' + wall-clock "HH:MM" in tz `tz`
 * → epoch ms. Unlike clockToEpochMs (which uses the day of an injected nowMs),
 * this targets an explicit date — used by the multi-day overview to anchor each
 * festival day independently of the live clock. DST-correct via the same
 * offset-at-the-instant correction.
 */
export function dateClockToEpochMs(dateKey, hhmm, tz) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const offsetMin = tzOffsetMinutes(naiveUtc, tz);
  return naiveUtc - offsetMin * MS_PER_MIN;
}

// ── day-time resolution ───────────────────────────────────────────────────────

/**
 * Resolve an anchor ({clock:'HH:MM'} | {sun:<event>, offsetMin}) → epoch ms on
 * the calendar day of `nowMs` in tz `tz`. Returns null for a polar/missing sun
 * event. Exported so the arbiter's hold resolution can reuse the same
 * clock/sun math rather than duplicating it.
 */
export function anchorToMs(anchor, nowMs, tz, sunEvents) {
  if (anchor.clock !== undefined) {
    return clockToEpochMs(anchor.clock, nowMs, tz);
  }
  const event = sunEvents[anchor.sun];
  if (!(event instanceof Date)) return null; // polar / missing → never fires
  return event.valueOf() + (anchor.offsetMin || 0) * MS_PER_MIN;
}

/**
 * Resolve absolute epoch-ms fire times for the plan on the day of `now`.
 * Returns { phases: { <name>: { startMs, endMs } }, cueTimes: { <id>: ms|null } }.
 * cueTimes only carries clock/sun cues — phase/mood/manual cues are not
 * time-resolved here.
 *
 * @param {{ plan, now:number, sunEvents }} args
 */
export function resolveDayTimes({ plan, now, sunEvents }) {
  const tz = plan.location.tz;
  const phases = {};
  for (const [name, win] of Object.entries(plan.phases)) {
    phases[name] = {
      startMs: anchorToMs(win.start, now, tz, sunEvents),
      endMs: anchorToMs(win.end, now, tz, sunEvents),
    };
  }
  const cueTimes = {};
  for (const cue of plan.cues) {
    const t = cue.trigger;
    if (t.type === 'clock') {
      cueTimes[cue.id] = clockToEpochMs(t.at, now, tz);
    } else if (t.type === 'sun') {
      const event = sunEvents[t.event];
      cueTimes[cue.id] = event instanceof Date
        ? event.valueOf() + (t.offsetMin || 0) * MS_PER_MIN
        : null;
    }
  }
  // Carry tz + the raw sun events so downstream pure consumers (the arbiter's
  // hold resolution) can resolve arbitrary anchors without re-plumbing them.
  return { phases, cueTimes, tz, sunEvents };
}

/**
 * Whether `now` falls inside [startMs, endMs). Handles windows that cross
 * midnight (endMs < startMs) by treating the window as wrapping.
 */
function phaseActiveAt(startMs, endMs, now) {
  if (startMs === null || endMs === null) return false;
  if (startMs <= endMs) return now >= startMs && now < endMs;
  // Wrapping window (e.g. sunset+2h .. sunrise-1h spans midnight).
  return now >= startMs || now < endMs;
}

/**
 * The active phase name at `now` (or null). When multiple phases overlap the
 * FIRST in plan order wins (plan authoring order is deterministic).
 */
export function activePhase({ plan, now, dayTimes }) {
  for (const name of Object.keys(plan.phases)) {
    const win = dayTimes.phases[name];
    if (win && phaseActiveAt(win.startMs, win.endMs, now)) return name;
  }
  return null;
}

// ── the tick ──────────────────────────────────────────────────────────────────

function cloneState(state) {
  // structuredClone keeps the function pure (input is never mutated).
  return structuredClone(state);
}

/**
 * Evaluate one tick. PURE: returns { fires: [{cueId, reason}], state }. The
 * input `state` is treated as immutable; a NEW state is returned.
 *
 * @param {{ now:number, plan, state, mood:{party:0|1}, dayTimes }} args
 */
export function evaluateTick({ now, plan, state, mood, dayTimes }) {
  const tz = plan.location.tz;
  const next = cloneState(state);
  const fires = [];

  // Defensive init for maps this function owns (default state may omit the
  // arming latch, which is internal bookkeeping for mood dwell).
  if (!next.firedToday) next.firedToday = {};
  if (!next.moodLastFire) next.moodLastFire = {};
  if (!next.moodArmed) next.moodArmed = {};

  // Day roll-over: reset the once-per-day latch when the calendar day changes.
  const dayKey = dayKeyFor(now, tz);
  if (next.dayKey !== dayKey) {
    next.dayKey = dayKey;
    next.firedToday = {};
  }

  // Mood edge bookkeeping: detect a change and stamp moodSince.
  const party = mood && mood.party ? 1 : 0;
  const prevMood = next.prevMood;
  const moodChanged = prevMood !== party;
  if (moodChanged) next.moodSince = now;

  // Active phase + rising-edge detection.
  const phaseNow = activePhase({ plan, now, dayTimes });
  const prevPhase = next.currentPhase;

  for (const cue of plan.cues) {
    if (cue.enabled === false) continue;
    const t = cue.trigger;

    if (t.type === 'clock' || t.type === 'sun') {
      const fireMs = dayTimes.cueTimes[cue.id];
      if (fireMs === null || fireMs === undefined) continue;
      if (now >= fireMs && next.firedToday[cue.id] !== dayKey) {
        next.firedToday[cue.id] = dayKey;
        fires.push({ cueId: cue.id, reason: t.type });
      }
    } else if (t.type === 'phase') {
      const win = dayTimes.phases[t.phase];
      const activeNow = win && phaseActiveAt(win.startMs, win.endMs, now);
      // Rising edge: this phase is active now and was NOT the current phase
      // on the previous tick.
      if (activeNow && prevPhase !== t.phase) {
        fires.push({ cueId: cue.id, reason: 'phase' });
      }
    } else if (t.type === 'mood') {
      const fromVal = t.from === 'party' ? 1 : 0;
      const toVal = t.to === 'party' ? 1 : 0;
      // We fire once dwell is satisfied — NOT on the raw edge tick — so a brief
      // blip that reverts before minDwellSec never fires. ARMING tracks the
      // requested transition: a cue arms when the mood sits at `from`, and only
      // an armed cue may fire when the mood later holds at `to`. moodSince marks
      // the last mood change; a flip away from `to` before dwell resets it and
      // abandons the pending fire. moodArmed latches one fire per arrival at `to`.
      if (party === fromVal) {
        next.moodArmed[cue.id] = true;
        continue;
      }
      if (party !== toVal) continue;      // mood at neither endpoint (n/a for binary)
      if (next.moodArmed[cue.id] !== true) continue; // never observed `from` → don't fire
      const phaseOk = t.whenPhase === undefined || phaseNow === t.whenPhase;
      const dwellOk = now - next.moodSince >= (t.minDwellSec || 0) * 1000;
      const last = next.moodLastFire[cue.id];
      const cooldownOk = last === undefined || last === null
        || now - last >= (t.cooldownSec || 0) * 1000;
      if (phaseOk && dwellOk && cooldownOk) {
        next.moodLastFire[cue.id] = now;
        next.moodArmed[cue.id] = false; // latch: one fire per arrival at `to`
        fires.push({ cueId: cue.id, reason: 'mood' });
      }
    }
    // manual cues never auto-fire.
  }

  // Commit phase + mood tracking into the returned state.
  next.currentPhase = phaseNow;
  next.prevMood = party;
  return { fires, state: next };
}
