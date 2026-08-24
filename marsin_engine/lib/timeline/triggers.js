/*
 * triggers.js — PURE trigger evaluation for the Timeline Companion. NO IO, NO
 * Date.now() inside: time is always injected. The tick loop is a pure function
 * of (now, plan, state, mood, dayTimes) → which cues fired + the next state.
 * This file decides WHICH cues fire; it never executes actions (that is the
 * server's job). Keeping it pure makes the whole "full night in seconds"
 * simulated-clock test possible (docs/38 §4, §10).
 */

const MS_PER_MIN = 60000;

// ── Intl.DateTimeFormat cache (report _116 / _113 J1 — the overview freeze) ──
// Constructing an Intl.DateTimeFormat is EXPENSIVE, and the day-ribbon overview
// built thousands of them — `resolveDayTimes` makes one (two) per clock cue, and
// the ribbon re-ran `resolveDayTimes` per sample point per day → O(days×cues²)
// formatter constructions, which froze the whole engine (render loop, sACN out,
// tick all share the thread) for up to 296 s at the schema's 512-cue cap. These
// formatters depend ONLY on (locale, tz), so cache and reuse them. `.format()` /
// `.formatToParts()` on a cached instance is cheap; only construction was slow.
const _fmtCache = new Map();
function cachedFormatter(cacheKey, factory) {
  let fmt = _fmtCache.get(cacheKey);
  if (!fmt) { fmt = factory(); _fmtCache.set(cacheKey, fmt); }
  return fmt;
}

// ── local-time helpers (tz-aware, injected `now`) ─────────────────────────────

/**
 * The 'YYYY-MM-DD' calendar day of `nowMs` in IANA timezone `tz`.
 */
export function dayKeyFor(nowMs, tz) {
  const fmt = cachedFormatter(`daykey:${tz}`, () => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }));
  // en-CA yields "YYYY-MM-DD".
  return fmt.format(new Date(nowMs));
}

/**
 * The UTC offset (minutes) of timezone `tz` at instant `nowMs`. Positive east
 * of UTC. Derived by formatting the instant in `tz` and in UTC and diffing the
 * wall-clock fields — robust across DST without a tz database.
 */
function tzOffsetMinutes(nowMs, tz) {
  const fmt = cachedFormatter(`offset:${tz}`, () => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
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
export function phaseActiveAt(startMs, endMs, now) {
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

// ── mood fire bookkeeping (the arm latch + the cooldown stamp) ────────────────

/**
 * Snapshot the MOOD FIRE bookkeeping (`moodArmed` latch + `moodLastFire`
 * cooldown stamp) so a fire that is DROPPED downstream can be un-booked.
 *
 * Why this exists (report `_98` fix 1): `evaluateTick` is PURE — it cannot know
 * whether the arbiter will actually let a mood fire drive the lights, so it
 * stamps the cooldown and burns the one-fire-per-arrival latch at EVALUATION
 * time. When the arbiter then drops the fire (a program owns the deck, or the
 * operator has taken over) the trigger was consumed by a show that never
 * played, and `moodArmed` only re-arms on a return to CALM — so a single
 * suppressed attempt killed party for the rest of a sustained set.
 *
 * The invariant this restores is the one the operator's PARTY OVERRIDE gate
 * already states in the mood branch below: suppression suppresses the SHOW, it
 * does not consume the trigger. The SERVICE (the only layer that knows what
 * actually played) snapshots before the evaluation and rolls back after the
 * arbitration.
 *
 * @param {object} state runtime state
 * @returns {{moodArmed:object, moodLastFire:object}} a shallow copy of both maps
 */
export function snapshotMoodBookkeeping(state) {
  const s = state || {};
  return {
    moodArmed: { ...(s.moodArmed || {}) },
    moodLastFire: { ...(s.moodLastFire || {}) },
  };
}

/**
 * Undo the mood FIRE bookkeeping for ONE cue, restoring both maps to the
 * snapshot taken before `evaluateTick` ran. Mutates `state` in place (the
 * caller owns the post-arbitration clone). A key that did not exist in the
 * snapshot is DELETED, not set to undefined, so the persisted state never grows
 * a phantom entry.
 *
 * @param {object} state    post-evaluation runtime state (mutated)
 * @param {string} cueId
 * @param {{moodArmed:object, moodLastFire:object}} snapshot from snapshotMoodBookkeeping
 * @returns {object} the same state
 */
export function rollbackMoodFire(state, cueId, snapshot) {
  for (const field of ['moodArmed', 'moodLastFire']) {
    const map = state[field];
    if (!map) continue;
    const before = snapshot[field] || {};
    if (Object.prototype.hasOwnProperty.call(before, cueId)) map[cueId] = before[cueId];
    else delete map[cueId];
  }
  return state;
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
 * @param {{ now:number, plan, state, mood:{party:0|1}, dayTimes,
 *           partyEnabled?:boolean,
 *           partyTiming?:{minDwellSec?:number, cooldownSec?:number}|null }} args
 *        partyEnabled — the operator's PARTY OVERRIDE (default true). When
 *        false, no cue may transition the show INTO party; see the mood branch.
 *        partyTiming  — the ENGINE-OWNED session numbers for a cue that moves
 *        INTO party (`/party-config`). When given they REPLACE the cue's
 *        authored `minDwellSec` / `cooldownSec`, so the operator's live edit
 *        takes effect on the next evaluation with no plan reload. Absent (or
 *        null) ⇒ the cue's own numbers, exactly as before.
 */
export function evaluateTick({
  now, plan, state, mood, dayTimes, partyEnabled = true, partyTiming = null,
}) {
  const tz = plan.location.tz;
  const next = cloneState(state);
  const fires = [];

  // Defensive init for maps this function owns (default state may omit the
  // arming latch, which is internal bookkeeping for mood dwell).
  if (!next.firedToday) next.firedToday = {};
  if (!next.moodLastFire) next.moodLastFire = {};
  if (!next.moodArmed) next.moodArmed = {};

  // ── L2 (report _116 / _115): backward wall-clock step clamp ──────────────
  // The mood dwell + cooldown gates below compare `now` against ABSOLUTE epoch
  // stamps persisted in state (`moodSince`, `moodLastFire[id]`). The playa has
  // no internet, so an RTC drift or a BIOS AC-restore boot can step the wall
  // clock BACKWARD — after which those stamps sit in the FUTURE relative to
  // `now`, `now - stamp` goes NEGATIVE, and dwell/cooldown can never satisfy:
  // the party cue is permanently stranded for the whole duration of the jump
  // (forward/1970 boots self-heal; only backward steps wedge). Clamp any stamp
  // that is ahead of `now` down to `now` — negative elapsed = "just happened" /
  // re-derive — so dwell restarts cleanly and cooldown restarts cleanly, and a
  // backward step becomes a self-healing re-arm instead of a dead cue.
  if (typeof next.moodSince === 'number' && next.moodSince > now) next.moodSince = now;
  for (const id of Object.keys(next.moodLastFire)) {
    const stamp = next.moodLastFire[id];
    if (typeof stamp === 'number' && stamp > now) next.moodLastFire[id] = now;
  }

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
      // ARMED IS A DISARM LATCH, NOT AN OBSERVATION LOG (report 356, F1).
      //
      // The operator semantic is "the mood held at `to` for minDwell WHILE
      // ARMED", and `armed:false` is only ever written by a fire (one fire per
      // arrival at `to`) — i.e. it means "a session of this cue is live". It is
      // cleared again at session end (_notePartySessionEnd) and on boot.
      //
      // This used to read `!== true`, which ALSO refused an UNDEFINED latch —
      // a cue the evaluator had simply never seen at `from`. So a plan that went
      // live with the music ALREADY playing (activate mid-set, engine restart
      // into a party, a window opening onto a running DJ) could not fire until
      // the next calm gap: the card said ✓ARMED while the evaluator would never
      // fire. UNDEFINED now means ARMED; only an explicit `false` blocks.
      if (next.moodArmed[cue.id] === false) continue; // a live session owns this cue
      // PARTY OVERRIDE (operator authority): while party mode is disabled, a cue
      // that moves the show INTO party cannot fire. Checked AFTER arming and
      // BEFORE the fire bookkeeping so re-enabling later finds the cue still
      // armed and its cooldown unburned — disabling suppresses the SHOW, it does
      // not consume the trigger. The detector is untouched: `mood` still tracks
      // audioPartyStrong, moodSince still stamps, the meters stay live.
      if (toVal === 1 && partyEnabled === false) continue;
      // SINGLE AUTHORITY for the party session numbers: a cue moving INTO party
      // reads dwell/cooldown from /party-config when the caller supplies them,
      // NOT from the plan YAML. Every other mood cue keeps its authored numbers.
      const useParty = toVal === 1 && partyTiming !== null && partyTiming !== undefined;
      const minDwellSec = (useParty && typeof partyTiming.minDwellSec === 'number')
        ? partyTiming.minDwellSec : (t.minDwellSec || 0);
      const cooldownSec = (useParty && typeof partyTiming.cooldownSec === 'number')
        ? partyTiming.cooldownSec : (t.cooldownSec || 0);
      const gatedPhase = t.whenPhase === undefined ? null : dayTimes.phases[t.whenPhase];
      const phaseOk = t.whenPhase === undefined
        || !!(gatedPhase && phaseActiveAt(gatedPhase.startMs, gatedPhase.endMs, now));
      const dwellOk = now - next.moodSince >= minDwellSec * 1000;
      const last = next.moodLastFire[cue.id];
      const cooldownOk = last === undefined || last === null
        || now - last >= cooldownSec * 1000;
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
