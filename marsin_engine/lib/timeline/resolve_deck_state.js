/*
 * resolve_deck_state.js — the PURE "what does the plan put on the deck at
 * instant T" resolver (design report _94 §4.1, operator ruling D5 2026-07-31).
 *
 * The selection core here is LIFTED VERBATIM out of TimelineService._catchUp so
 * the codebase has exactly ONE answer to "resolve the plan at a time", shared by
 * four consumers:
 *   • _catchUp                 — boot / resume / lease-release "plan at NOW"
 *   • POST /timeline/travel    — the time-travel snapshot at a chosen instant
 *   • GET  /timeline/resolve   — the read-only peek (event-sheet preview)
 *   • buildOverview segments   — the day-zoom "resolved ribbon"
 *
 * PURE, by the same discipline as triggers.js / arbiter.js / festival.js: NO IO,
 * NO Date.now(), the plan is never mutated, every instant is injected. The one
 * derived value it will compute for itself is the day's sun events (sun.js is
 * pure math) — inject `sunEvents` to reuse the service's per-day cache.
 *
 * SCOPE — what this function does NOT know:
 *   • runtime state. It answers from the PLAN alone: no operator takeover, no
 *     runtime `autopilotEnabled` toggle, no live deck-ownership latch, no party
 *     session. `controller` is therefore the PLAN-derived owner
 *     ('program' inside a live hold, else 'autopilot'; 'manual' out of window),
 *     exactly the term _catchUp derives from this core.
 *   • cross-midnight carry-over. Like _catchUp it evaluates the CALENDAR DAY of
 *     `atMs` in the plan's tz: a cue that fired at 22:00 yesterday is not an
 *     owner at 02:00 today (today's scan has not reached a cue yet, so the
 *     answer is the defaultCue / baseline). This is _catchUp's own day-latch
 *     semantics — the honest answer to "what would the engine do if it resolved
 *     the plan at this instant".
 */
import { computeSunEvents } from './sun.js';
import {
  resolveDayTimes, activePhase, dayKeyFor, dateClockToEpochMs,
} from './triggers.js';
import { applicableCues, festivalDayIndex } from './festival.js';
import { resolveHold } from './arbiter.js';

const MS_PER_MIN = 60000;
const MS_PER_DAY = 86400000;

// Whether the plan is "in time" at `atMs`. Mirrors TimelineService._inFestivalWindow
// (a plan with no festival block is a recurring-nightly plan → always in window).
function inWindowAt(plan, atMs) {
  if (!plan.festival) return true;
  return festivalDayIndex(plan, atMs) !== null;
}

// The playlist + palette an action would put on the deck. A `look` resolves
// through plan.looks (validateShowPlan already rejects unknown look names, so a
// miss here is a corrupt in-memory plan → THROW, never a silent null).
function playlistPaletteOf(plan, action) {
  if (!action) return { playlist: null, palette: null };
  if (action.type === 'look') {
    const look = plan.looks ? plan.looks[action.look] : undefined;
    if (!look) throw new Error(`resolveDeckStateAt: look "${action.look}" not defined in plan`);
    return { playlist: look.playlist || null, palette: look.palette || null };
  }
  if (action.type === 'playlist') return { playlist: action.name, palette: null };
  // scene / globals / tasks / effect drive no playlist of their own.
  return { playlist: null, palette: null };
}

/**
 * Resolve what the PLAN puts on the deck at `atMs`.
 *
 * @param {{plan:object, atMs:number, sunEvents?:object}} args
 *   plan      — a normalized (validated) show plan
 *   atMs      — the instant to resolve, epoch ms
 *   sunEvents — optional precomputed sun events for the calendar day of `atMs`
 * @returns {{
 *   atMs:number, dayKey:string, festivalDayIndex:number|null, inWindow:boolean,
 *   phase:string|null,
 *   owner:null|{kind:'cue'|'defaultCue'|'baseline', cueId:string|null,
 *               label:string, cueKind:string|null},
 *   action:object|null, playlist:string|null, palette:string|null,
 *   windowUntilMs:number|null, holdUntilMs:number|null, fireMs:number|null,
 *   controller:'manual'|'program'|'autopilot',
 *   source:'cue'|'hold-expired-baseline'|'default-cue'|'autopilot-baseline'|'dormant',
 *   passedCueIds:string[],
 *   restored:null|{cueId, label, cueKind, fireMs, action, windowUntilMs,
 *                  holdUntilMs, programLive, holdExpired},
 *   dayTimes:object, sunEvents:object,
 * }}
 *
 * TWO ANSWERS, deliberately distinct:
 *   `restored` — the SELECTION CORE's pick: the cue _catchUp re-applies. Present
 *                even when its durationMin window has already elapsed (catchUp
 *                re-applies the complete action, then the default cue reclaims).
 *   `owner` + playlist/palette/controller — what actually DRIVES the deck at
 *                `atMs`. A live program hold owns outright; a restored cue owns
 *                while its deck window is open; an ELAPSED window yields to the
 *                defaultCue / baseline. This is the answer the ribbon, the
 *                event sheet and time travel want.
 */
export function resolveDeckStateAt({ plan, atMs, sunEvents, dayTimes: injectedDayTimes }) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('resolveDeckStateAt: plan is required');
  }
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
    throw new Error(`resolveDeckStateAt: atMs must be a finite epoch ms, got ${JSON.stringify(atMs)}`);
  }
  const { lat, lon, tz } = plan.location;
  const events = sunEvents || computeSunEvents({ lat, lon, date: new Date(atMs), tz });
  const dayKey = dayKeyFor(atMs, tz);
  // The runtime evaluates ONE day at a time (docs/38 §15.2) — restrict to the
  // cues applicable on the calendar day of `atMs`, exactly like the tick and
  // _catchUp do.
  const dayPlan = { ...plan, cues: applicableCues(plan, atMs) };
  // PERF (report _116 / _113 J1): `resolveDayTimes` is the Intl-heavy call that
  // made the day ribbon O(days×cues²). Every sample point of a single calendar
  // day resolves the SAME cue/phase times, so `buildDaySegments` computes the
  // day's `dayTimes` ONCE and injects it here — the resolver then does zero
  // per-sample Intl work. Direct callers (/travel, /resolve, _catchUp) omit it
  // and resolve for their own instant, exactly as before.
  const dayTimes = injectedDayTimes || resolveDayTimes({ plan: dayPlan, now: atMs, sunEvents: events });

  // FESTIVAL-WINDOW ISOLATION: out of window the plan is DORMANT and drives
  // nothing (TimelineService._goDormant). Same early return _catchUp takes.
  if (!inWindowAt(plan, atMs)) {
    return {
      atMs,
      dayKey,
      festivalDayIndex: null,
      inWindow: false,
      phase: null,
      owner: null,
      action: null,
      playlist: null,
      palette: null,
      windowUntilMs: null,
      holdUntilMs: null,
      fireMs: null,
      controller: 'manual',
      source: 'dormant',
      passedCueIds: [],
      restored: null,
      dayTimes,
      sunEvents: events,
    };
  }

  const dayIndex = plan.festival ? festivalDayIndex(plan, atMs) : null;
  const phase = activePhase({ plan, now: atMs, dayTimes });

  // ── THE SELECTION CORE (verbatim from _catchUp) ──────────────────────────
  // Every already-passed clock/sun cue of the day is "fired" (the caller latches
  // firedToday from `passedCueIds`); the LATEST restorable one is the owner.
  const passedCueIds = [];
  let best = null;
  for (const cue of dayPlan.cues) {
    if (cue.enabled === false) continue;
    const t = cue.trigger;
    if (t.type !== 'clock' && t.type !== 'sun') continue;
    const fireMs = dayTimes.cueTimes[cue.id];
    if (typeof fireMs !== 'number' || fireMs > atMs) continue;
    passedCueIds.push(cue.id);
    const restorable = (cue.action.type === 'look' || cue.action.type === 'playlist') && cue.catchUp !== false;
    if (restorable && (best === null || fireMs > best.fireMs)) best = { cue, fireMs };
  }

  // ── the RESTORED cue: exactly what _catchUp dispatches ────────────────────
  // Present whenever the selection core found a restorable cue, EVEN IF its
  // durationMin window has already elapsed (catchUp re-applies its complete
  // action and then lets the default cue reclaim the deck).
  let restored = null;
  if (best) {
    // A program is only LIVE while it is genuinely still inside a real (future)
    // hold window — a no-hold or already-expired program restores its LOOK but
    // must NOT seize the controller (_catchUp's own rule).
    const holdUntilMs = best.cue.kind === 'program'
      ? resolveHold(best.cue.hold, best.fireMs, dayTimes) : null;
    const programLive = typeof holdUntilMs === 'number' && holdUntilMs > atMs;
    // §16.11 deck-ownership window, re-anchored to the cue's TRUE fire time (not
    // to `atMs`) — an already-elapsed durationMin yields the deck immediately.
    const durationMin = best.cue.durationMin;
    const windowUntilMs = (typeof durationMin === 'number' && durationMin > 0)
      ? best.fireMs + durationMin * MS_PER_MIN : null;
    restored = {
      cueId: best.cue.id,
      label: best.cue.label || best.cue.id,
      cueKind: best.cue.kind,
      fireMs: best.fireMs,
      action: best.cue.action,
      windowUntilMs,
      holdUntilMs,
      programLive,
      // FIX 7 (`_98`): the program fired earlier today and its numeric hold has
      // ALREADY elapsed. catchUp still re-applies the complete action (palette /
      // globals / master), but the cue owns NOTHING afterwards — the caller
      // clears the deck-ownership latch so the plan's ambient defaultCue reclaims
      // the deck, matching the live hold-expiry path.
      holdExpired: typeof holdUntilMs === 'number' && holdUntilMs <= atMs,
    };
  }

  const common = {
    atMs, dayKey, festivalDayIndex: dayIndex, inWindow: true, phase,
    passedCueIds, restored, dayTimes, sunEvents: events,
  };

  // ── the OWNER: what actually drives the deck AT `atMs` ────────────────────
  // A live program hold owns outright. Otherwise the restored cue owns while its
  // deck window is open (no durationMin = "owns until the next deck cue"); an
  // ELAPSED durationMin window yields to the default cue — the §16.11 /
  // _reconcileDefaultCue rule, which is why the ribbon must not keep showing an
  // expired cue.
  const windowLive = restored
    && (restored.windowUntilMs === null || restored.windowUntilMs > atMs);
  // G1 / FIX 7 (report `_98`): a program whose numeric HOLD has EXPIRED no longer
  // owns anything. Before `_98` the service's `__resume_autopilot__` handler
  // reloaded `plan.autopilot.playlist` but never cleared the deck-OWNERSHIP
  // latch, so the cue kept OWNING while the BASELINE playlist played underneath
  // it — which this resolver reported honestly as `source:'hold-expired-baseline'`.
  // The service now hands the deck to the plan's `defaultCue` on hold expiry
  // (operator requirement: ambient is the dominant program), so the honest answer
  // here is to yield to the defaultCue / baseline branches below. The
  // `hold-expired-baseline` source is consequently no longer emitted; it is left
  // in the documented union so existing clients need no type change.
  const holdExpired = !!(restored && restored.cueKind === 'program'
    && typeof restored.holdUntilMs === 'number' && restored.holdUntilMs <= atMs);
  if (restored && !holdExpired && (restored.programLive || windowLive)) {
    const { playlist, palette } = playlistPaletteOf(plan, restored.action);
    return {
      ...common,
      owner: {
        kind: 'cue', cueId: restored.cueId, label: restored.label, cueKind: restored.cueKind,
      },
      action: restored.action,
      playlist,
      palette,
      windowUntilMs: restored.windowUntilMs,
      holdUntilMs: restored.programLive ? restored.holdUntilMs : null,
      fireMs: restored.fireMs,
      controller: restored.programLive ? 'program' : 'autopilot',
      source: 'cue',
    };
  }

  // No live owner → the plan-level DEFAULT CUE fills the deck (docs/38 §16.11).
  if (plan.defaultCue) {
    const { playlist, palette } = playlistPaletteOf(plan, plan.defaultCue.action);
    return {
      ...common,
      owner: {
        kind: 'defaultCue',
        cueId: null,
        label: plan.defaultCue.label || 'Default cue',
        cueKind: null,
      },
      action: plan.defaultCue.action,
      playlist,
      palette,
      windowUntilMs: null,
      holdUntilMs: null,
      fireMs: null,
      controller: 'autopilot',
      source: 'default-cue',
    };
  }

  // No defaultCue authored → the AUTOPILOT BASELINE is the deck fill.
  const ap = plan.autopilot;
  return {
    ...common,
    owner: {
      kind: 'baseline', cueId: null, label: 'Autopilot baseline', cueKind: null,
    },
    action: null,
    playlist: ap && ap.playlist ? ap.playlist : null,
    palette: null,
    windowUntilMs: null,
    holdUntilMs: null,
    fireMs: null,
    controller: 'autopilot',
    source: 'autopilot-baseline',
  };
}

// ── day ribbon (the day-zoom "what actually plays" segment list) ────────────

// The 'YYYY-MM-DD' calendar date one day after `dateKey`. Anchored at UTC
// midnight so DST never distorts the step (same trick as festival.js).
function nextDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + MS_PER_DAY);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// HH:MM of an instant in tz, with the day's closing boundary rendered as the
// unambiguous '24:00' rather than the next day's '00:00' (the ribbon is laid out
// against a 24 h column, so 1440 minutes must not read as 0).
const _hhmmFmtCache = new Map();
function hhmm(ms, tz, dayEndMs) {
  if (ms === dayEndMs) return '24:00';
  // Cache the formatter per tz — see the Intl-construction cost note in
  // triggers.js (report _116 / _113 J1). Constructed once, reused per segment.
  let fmt = _hhmmFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    });
    _hhmmFmtCache.set(tz, fmt);
  }
  return fmt.format(new Date(ms));
}

function sameOwner(a, b) {
  return a.owner.kind === b.owner.kind
    && a.owner.cueId === b.owner.cueId
    && a.playlist === b.playlist
    && a.palette === b.palette
    && a.controller === b.controller;
}

/**
 * The RESOLVED RIBBON for one calendar day: what actually owns the deck and
 * which playlist plays, across [00:00, 24:00) local (design _94 §2.2.3).
 *
 * Built by sampling the pure resolver at the day's own boundaries — every
 * applicable timed cue's fire time, every phase start/end, AND every point where
 * a cue HANDS THE DECK BACK (its `durationMin` window end and, for a program, its
 * hold end) — then merging consecutive samples that resolve to the same owner. A
 * handful of calls per day, no clock, no IO.
 *
 * The hand-back boundaries are not optional garnish (bug B1, report `_100`):
 * without them the sampler only ever asks "who owns the deck?" at moments a cue
 * STARTS, so a cue that hands back at 20:19 is reported as owning until the next
 * unrelated boundary. On the shipped plan that mis-stated the whole stretch
 * `_98` FIX 7 exists to give the ambient defaultCue — i.e. the ribbon lied about
 * the exact thing day zoom was built to make honest.
 *
 * HONESTY NOTE: the ribbon renders the truth of the SHIPPED plan, it does not
 * fix it. It inherits the resolver's calendar-day semantics (see the module
 * header), so a night's owner does not carry across midnight into the next
 * day's ribbon.
 *
 * @param {{plan:object, dateKey:string, sunEvents?:object}} args
 * @returns {Array<{fromMs, toMs, fromLocal, toLocal, owner, playlist, palette,
 *                  controller, source}>}
 */
export function buildDaySegments({ plan, dateKey, sunEvents }) {
  if (!plan || typeof plan !== 'object') throw new Error('buildDaySegments: plan is required');
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`buildDaySegments: dateKey must be YYYY-MM-DD, got ${JSON.stringify(dateKey)}`);
  }
  const tz = plan.location.tz;
  const dayStartMs = dateClockToEpochMs(dateKey, '00:00', tz);
  const dayEndMs = dateClockToEpochMs(nextDateKey(dateKey), '00:00', tz);
  // Noon anchors the day's own cue/phase resolution regardless of UTC offset.
  const dayNoonMs = dateClockToEpochMs(dateKey, '12:00', tz);
  const events = sunEvents || computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon, date: new Date(dayNoonMs), tz,
  });

  const dayPlan = { ...plan, cues: applicableCues(plan, dayNoonMs) };
  const dayTimes = resolveDayTimes({ plan: dayPlan, now: dayNoonMs, sunEvents: events });

  // Sample points: the day's start plus every boundary strictly inside it.
  const points = new Set([dayStartMs]);
  const addPoint = (ms) => {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > dayStartMs && ms < dayEndMs) points.add(ms);
  };
  for (const cue of dayPlan.cues) {
    if (cue.enabled === false) continue;
    const ms = dayTimes.cueTimes[cue.id];
    if (typeof ms !== 'number') continue;
    addPoint(ms);
    // HAND-BACK boundaries — the instants the resolver itself models as the end
    // of ownership (`windowUntilMs` / `holdUntilMs`). Sample them or the merge
    // below never sees the transition.
    if (typeof cue.durationMin === 'number' && cue.durationMin > 0) {
      addPoint(ms + cue.durationMin * MS_PER_MIN);
    }
    if (cue.kind === 'program') addPoint(resolveHold(cue.hold, ms, dayTimes));
  }
  for (const win of Object.values(dayTimes.phases)) {
    for (const ms of [win.startMs, win.endMs]) {
      if (typeof ms === 'number' && ms > dayStartMs && ms < dayEndMs) points.add(ms);
    }
  }
  const sorted = [...points].sort((a, b) => a - b);

  const segments = [];
  for (const ms of sorted) {
    // Inject the day's already-resolved `dayTimes` (computed once above) so the
    // resolver does no per-sample Intl work — the core of the _113 J1 fix.
    const r = resolveDeckStateAt({ plan, atMs: ms, sunEvents: events, dayTimes });
    const entry = {
      fromMs: ms,
      toMs: dayEndMs,
      owner: r.owner === null
        ? { kind: 'dormant', cueId: null, label: 'Plan dormant (out of festival window)' }
        : { kind: r.owner.kind, cueId: r.owner.cueId, label: r.owner.label },
      playlist: r.playlist,
      palette: r.palette,
      controller: r.controller,
      source: r.source,
    };
    const prev = segments[segments.length - 1];
    if (prev && sameOwner(prev, entry)) continue;   // same owner → extend, no new segment
    if (prev) prev.toMs = ms;
    segments.push(entry);
  }

  return segments.map((s) => ({
    ...s,
    fromLocal: hhmm(s.fromMs, tz, dayEndMs),
    toLocal: hhmm(s.toMs, tz, dayEndMs),
  }));
}
