/*
 * timeline_assertions.mjs — the OFFLINE VALIDATION ENGINE for a timeline show
 * plan (docs/77_bm26_night_arc_timeline.md §9 "Dry-run validation" + §11 G2).
 *
 * `tools/timeline_dryrun.mjs` (`--assert` / `--assert-spec`) imports this
 * module and wires it after a simulated run. Every class here is a PURE
 * function over an already-loaded (`loadShowPlan`) normalized plan — no IO, no
 * Date.now(), no engine tick required — so `--assert` also works with a fast
 * `--step 60` run, and the classes 1/3/5/6/8 that need no tick data at all can
 * run standalone from just the plan + a day span.
 *
 * WHAT IT DRIVES — the REAL resolvers, never a reimplementation:
 *   • `resolveDeckStateAt` (lib/timeline/resolve_deck_state.js) — the SAME pure
 *     selection core `TimelineService._catchUp` uses at boot. A class-1/5/8
 *     sample IS a boot/catch-up resolution at that instant.
 *   • `resolveDayTimes` / `anchorToMs` / `dayKeyFor` (lib/timeline/triggers.js)
 *   • `computeSunEvents` (lib/timeline/sun.js, no network)
 *   • `resolveHold` (lib/timeline/arbiter.js)
 *   • `applicableCues` / `festivalDayIndex` (lib/timeline/festival.js)
 *   • `lintShowPlan` (lib/timeline/show_plan.js)
 *
 * THE 8 ASSERTION CLASSES (docs/77 §9, extended per the G2 course correction):
 *   1. FULL-NIGHT CONTIGUITY   — zero ownerless minutes across the night.
 *   2. MASTER-AUTHORSHIP        — every globals.master writer is whitelisted;
 *                                 optional masterZeroCue "one true 0 writer" check.
 *   3. ELIGIBILITY-WINDOW SANITY — every mood cue's whenPhase resolves sanely;
 *                                 optional exact-boundary match against a spec'd
 *                                 eligibility window.
 *   4. SHUFFLE-PINNING          — every directed cue pins autopilot.shuffle:false.
 *   5. EVENT-RESUME COVERAGE    — every event cue's release resumes owned.
 *   6. SOLAR-DRIFT SWEEP        — sun events + cue/phase times resolve finite and
 *                                 the timed-cue firing order never inverts across
 *                                 the festival week; optional expectedOrder match.
 *   7. LINT CLEAN               — lintShowPlan(plan) reports nothing.
 *   8. RESTART/RESUME PROBES    — a simulated engine restart at representative
 *                                 clock times (default 02:00 / 07:30) resolves to
 *                                 an OWNED cue, with a live program's hold still
 *                                 in the future; optional restartExpect pins the
 *                                 exact cue id per probe.
 *
 * Codex P0 — NO FALLBACKS: `parseAssertSpec` throws on any unknown key. A class
 * that structurally cannot run without a spec (2's masterWriters whitelist, 4's
 * directedCues whitelist) is SKIPPED LOUDLY when `--assert` runs with no
 * `--assert-spec`, never silently treated as passing.
 */
import { computeSunEvents, formatLocal } from '../lib/timeline/sun.js';
import {
  resolveDayTimes, dayKeyFor, dateClockToEpochMs, anchorToMs,
} from '../lib/timeline/triggers.js';
import { applicableCues, festivalDayIndex } from '../lib/timeline/festival.js';
import { resolveHold } from '../lib/timeline/arbiter.js';
import { resolveDeckStateAt } from '../lib/timeline/resolve_deck_state.js';
import { lintShowPlan, SUN_EVENTS } from '../lib/timeline/show_plan.js';

const MS_PER_MIN = 60000;
const MS_PER_DAY = 86400000;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUN_EVENT_SET = new Set(SUN_EVENTS);
const DEFAULT_RESTART_PROBES = Object.freeze(['02:00', '07:30']);

// ── tiny local day-key arithmetic (kept LOCAL, not imported from
// timeline_dryrun.mjs, to avoid a circular import — that file imports THIS
// one) ───────────────────────────────────────────────────────────────────────

function dayKeyUtc(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) throw new Error(`expected a YYYY-MM-DD day key, got ${JSON.stringify(dayKey)}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function shiftDayKeyLocal(dayKey, deltaDays) {
  const dt = new Date(dayKeyUtc(dayKey) + deltaDays * MS_PER_DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function minuteFloor(ms) {
  return Math.floor(ms / MS_PER_MIN) * MS_PER_MIN;
}

// Sun-anchored fire times carry seconds (sun.js is not minute-quantized). A
// half-open [start, end) sampled at whole minutes must START at the first
// WHOLE minute AT OR AFTER the real fire instant — flooring the start instead
// would sample a minute strictly before the cue actually fired, reporting a
// spurious 1-minute "ownerless" gap at the top of every range.
function minuteCeil(ms) {
  return Math.ceil(ms / MS_PER_MIN) * MS_PER_MIN;
}

function isPlainObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ── per-calendar-day resolution cache (sun events + resolveDayTimes are
// computed ONCE per calendar day, then reused for every minute sampled that
// day — the same discipline resolve_deck_state.js's buildDaySegments uses) ──

function dayContext(plan, dayKey, cache) {
  let ctx = cache.get(dayKey);
  if (ctx) return ctx;
  const tz = plan.location.tz;
  const noonMs = dateClockToEpochMs(dayKey, '12:00', tz);
  const sunEvents = computeSunEvents({ lat: plan.location.lat, lon: plan.location.lon, date: new Date(noonMs), tz });
  const dayPlan = { ...plan, cues: applicableCues(plan, noonMs) };
  const dayTimes = resolveDayTimes({ plan: dayPlan, now: noonMs, sunEvents });
  ctx = {
    dayKey, noonMs, sunEvents, dayTimes, dayPlan,
  };
  cache.set(dayKey, ctx);
  return ctx;
}

// Resolve at an arbitrary instant, injecting the (cached) dayTimes/sunEvents
// for THAT instant's own calendar day — required for cross-midnight
// correctness (a night's small hours are a DIFFERENT calendar day than its
// sunset half; resolve_deck_state.js's own header calls this out).
function resolveAtCached(plan, atMs, cache) {
  const ctx = dayContext(plan, dayKeyFor(atMs, plan.location.tz), cache);
  return resolveDeckStateAt({
    plan, atMs, sunEvents: ctx.sunEvents, dayTimes: ctx.dayTimes,
  });
}

function inWindowOnDay(plan, noonMs) {
  return !plan.festival || festivalDayIndex(plan, noonMs) !== null;
}

// ── master-authorship: static scan for every globals.master writer ──────────

function collectMasterWriters(plan) {
  const out = [];
  const visit = (cueId, action) => {
    if (!action) return;
    if (action.type === 'globals' && action.set && action.set.master !== undefined) {
      out.push({ cueId, value: action.set.master });
    } else if (action.type === 'playlist' && action.globals && action.globals.master !== undefined) {
      out.push({ cueId, value: action.globals.master });
    } else if (action.type === 'look') {
      const look = plan.looks ? plan.looks[action.look] : null;
      if (look && look.globals && look.globals.master !== undefined) {
        out.push({ cueId, value: look.globals.master });
      }
    } else if (action.type === 'sequence') {
      for (const step of action.steps) visit(cueId, step.action);
    }
  };
  for (const cue of plan.cues) {
    if (cue.enabled === false) continue;
    visit(cue.id, cue.action);
  }
  if (plan.defaultCue) visit('defaultCue', plan.defaultCue.action);
  return out;
}

function cueOrDefaultCueExists(plan, id) {
  if (id === 'defaultCue') return !!plan.defaultCue;
  return plan.cues.some((c) => c.id === id);
}

function autopilotOfAction(action, plan) {
  if (!action) return undefined;
  if (action.type === 'playlist') return action.autopilot;
  if (action.type === 'look') {
    const look = plan.looks ? plan.looks[action.look] : null;
    return look ? look.autopilot : undefined;
  }
  return undefined; // sequence/scene/globals/tasks/effect: no single checkable autopilot
}

function collectReferencedSunEvents(plan) {
  const set = new Set();
  const addAnchor = (a) => { if (a && a.sun) set.add(a.sun); };
  for (const win of Object.values(plan.phases || {})) { addAnchor(win.start); addAnchor(win.end); }
  for (const cue of plan.cues) {
    if (cue.trigger.type === 'sun') set.add(cue.trigger.event);
    if (cue.hold && cue.hold.until) addAnchor(cue.hold.until);
  }
  return set;
}

// ── assert-spec parsing (THROW-style, unknown keys throw — codex P0) ────────

function validateAnchorSpec(anchor, label) {
  if (!isPlainObj(anchor)) throw new Error(`${label} must be an object { clock } or { sun, offsetMin? }`);
  const hasClock = anchor.clock !== undefined;
  const hasSun = anchor.sun !== undefined;
  if (hasClock === hasSun) throw new Error(`${label} must have exactly one of { clock } or { sun }`);
  if (hasClock) {
    if (typeof anchor.clock !== 'string' || !CLOCK_RE.test(anchor.clock)) {
      throw new Error(`${label}.clock must be a 24h "HH:MM" clock time, got ${JSON.stringify(anchor.clock)}`);
    }
    return { clock: anchor.clock };
  }
  if (!SUN_EVENT_SET.has(anchor.sun)) {
    throw new Error(`${label}.sun must be one of ${SUN_EVENTS.join(', ')}, got ${JSON.stringify(anchor.sun)}`);
  }
  const out = { sun: anchor.sun, offsetMin: 0 };
  if (anchor.offsetMin !== undefined) {
    if (!Number.isInteger(anchor.offsetMin)) {
      throw new Error(`${label}.offsetMin must be an integer, got ${JSON.stringify(anchor.offsetMin)}`);
    }
    out.offsetMin = anchor.offsetMin;
  }
  return out;
}

function validateIdArray(list, label) {
  if (!Array.isArray(list)) throw new Error(`${label} must be an array of cue ids`);
  return list.map((id, i) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error(`${label}[${i}] must be a non-empty string`);
    return id;
  });
}

function validateClockArray(list, label) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${label} must be a non-empty array of "HH:MM" clock strings`);
  }
  return list.map((c, i) => {
    if (typeof c !== 'string' || !CLOCK_RE.test(c)) throw new Error(`${label}[${i}] must be "HH:MM", got ${JSON.stringify(c)}`);
    return c;
  });
}

function validateSolarSweepSpec(obj, label) {
  if (!isPlainObj(obj)) throw new Error(`${label} must be an object`);
  const KNOWN = new Set(['lat', 'lon', 'startDate', 'days']);
  for (const key of Object.keys(obj)) {
    if (!KNOWN.has(key)) throw new Error(`${label}: unknown key "${key}" (known: ${[...KNOWN].join(', ')})`);
  }
  const out = {};
  if (obj.lat !== undefined) {
    if (typeof obj.lat !== 'number' || Number.isNaN(obj.lat)) throw new Error(`${label}.lat must be a number, got ${JSON.stringify(obj.lat)}`);
    out.lat = obj.lat;
  }
  if (obj.lon !== undefined) {
    if (typeof obj.lon !== 'number' || Number.isNaN(obj.lon)) throw new Error(`${label}.lon must be a number, got ${JSON.stringify(obj.lon)}`);
    out.lon = obj.lon;
  }
  if (obj.startDate !== undefined) {
    if (typeof obj.startDate !== 'string' || !DATE_RE.test(obj.startDate)) {
      throw new Error(`${label}.startDate must be 'YYYY-MM-DD', got ${JSON.stringify(obj.startDate)}`);
    }
    out.startDate = obj.startDate;
  }
  if (obj.days !== undefined) {
    if (!Number.isInteger(obj.days) || obj.days < 1 || obj.days > 366) {
      throw new Error(`${label}.days must be an integer in [1, 366], got ${JSON.stringify(obj.days)}`);
    }
    out.days = obj.days;
  }
  return out;
}

/**
 * Parse + strictly validate an `--assert-spec` YAML document. THROW-style;
 * every unknown top-level (or nested solarSweep/eligibility) key throws
 * (codex P0). Every field is OPTIONAL; absent fields fall back to documented
 * defaults spelled out per-class below.
 *
 * @param {object} doc  the parsed YAML document
 * @param {string} source  a label for error messages (the file path)
 * @returns {object} normalized spec
 */
export function parseAssertSpec(doc, source) {
  if (doc === null || doc === undefined) {
    throw new Error(`assert spec (${source}): file is empty`);
  }
  if (!isPlainObj(doc)) throw new Error(`assert spec (${source}): must be a YAML mapping`);
  const KNOWN = new Set([
    'masterWriters', 'directedCues', 'nightStart', 'nightEnd', 'solarSweep', 'eventCues',
    'masterZeroCue', 'eligibility', 'expectedOrder', 'restartProbes', 'restartExpect',
  ]);
  for (const key of Object.keys(doc)) {
    if (!KNOWN.has(key)) {
      throw new Error(`assert spec (${source}): unknown key "${key}" (known: ${[...KNOWN].sort().join(', ')})`);
    }
  }
  const out = {
    masterWriters: doc.masterWriters !== undefined ? validateIdArray(doc.masterWriters, `${source}.masterWriters`) : [],
    directedCues: doc.directedCues !== undefined ? validateIdArray(doc.directedCues, `${source}.directedCues`) : [],
    eventCues: doc.eventCues !== undefined ? validateIdArray(doc.eventCues, `${source}.eventCues`) : null,
    restartProbes: doc.restartProbes !== undefined
      ? validateClockArray(doc.restartProbes, `${source}.restartProbes`)
      : [...DEFAULT_RESTART_PROBES],
  };
  if (doc.nightStart !== undefined) out.nightStart = validateAnchorSpec(doc.nightStart, `${source}.nightStart`);
  if (doc.nightEnd !== undefined) out.nightEnd = validateAnchorSpec(doc.nightEnd, `${source}.nightEnd`);
  if (doc.solarSweep !== undefined) out.solarSweep = validateSolarSweepSpec(doc.solarSweep, `${source}.solarSweep`);
  if (doc.masterZeroCue !== undefined) {
    if (typeof doc.masterZeroCue !== 'string' || !doc.masterZeroCue.trim()) {
      throw new Error(`${source}.masterZeroCue must be a non-empty string cue id`);
    }
    out.masterZeroCue = doc.masterZeroCue;
  }
  if (doc.eligibility !== undefined) {
    if (!isPlainObj(doc.eligibility) || doc.eligibility.start === undefined || doc.eligibility.end === undefined) {
      throw new Error(`${source}.eligibility must be an object { start, end } (both anchors required)`);
    }
    out.eligibility = {
      start: validateAnchorSpec(doc.eligibility.start, `${source}.eligibility.start`),
      end: validateAnchorSpec(doc.eligibility.end, `${source}.eligibility.end`),
    };
  }
  if (doc.expectedOrder !== undefined) out.expectedOrder = validateIdArray(doc.expectedOrder, `${source}.expectedOrder`);
  if (doc.restartExpect !== undefined) {
    if (!isPlainObj(doc.restartExpect)) throw new Error(`${source}.restartExpect must be an object { "HH:MM": cue_id }`);
    const expect = {};
    for (const [clock, cueId] of Object.entries(doc.restartExpect)) {
      if (!CLOCK_RE.test(clock)) throw new Error(`${source}.restartExpect key "${clock}" must be "HH:MM"`);
      if (typeof cueId !== 'string' || !cueId.trim()) {
        throw new Error(`${source}.restartExpect["${clock}"] must be a non-empty string cue id`);
      }
      expect[clock] = cueId;
    }
    out.restartExpect = expect;
  }
  return out;
}

// ── class 1: FULL-NIGHT CONTIGUITY ───────────────────────────────────────────

function formatGap(dayKey, gapStartMs, gapEndMs, prevCueId, nextCueId, tz) {
  const mins = Math.round((gapEndMs - gapStartMs) / MS_PER_MIN);
  const from = formatLocal(new Date(gapStartMs), tz);
  const to = formatLocal(new Date(gapEndMs), tz);
  const prev = prevCueId || '(range start)';
  const next = nextCueId || '(range end)';
  return `[contiguity] DAY ${dayKey} ${from}–${to} ownerless (${mins} min) between "${prev}" and "${next}"`;
}

/**
 * Sample resolveDeckStateAt every minute across each night in `dayKeys` and
 * report every contiguous ownerless run (owner.kind !== 'cue'). The night's
 * span defaults to [earliest timed-cue fire, latest timed-cue fire] — spec'd
 * `nightStart`/`nightEnd` override either end. The range is HALF-OPEN
 * [start, end), matching every other half-open convention in this codebase
 * (a cue that deliberately zeroes master at the end anchor, e.g. day_off, is
 * the intended end of coverage, not a bug at that exact minute).
 */
export function assertContiguity({ plan, dayKeys, spec }) {
  const violations = [];
  const cache = new Map();
  const tz = plan.location.tz;

  for (const dayKey of dayKeys) {
    const nextDayKey = shiftDayKeyLocal(dayKey, 1);
    const ctxA = dayContext(plan, dayKey, cache);
    const ctxB = dayContext(plan, nextDayKey, cache);
    if (!inWindowOnDay(plan, ctxA.noonMs)) continue; // dormant night — nothing to check

    const rangeStartMs = ctxA.noonMs;
    const rangeEndMs = dateClockToEpochMs(nextDayKey, '12:00', tz);

    let startMs = spec && spec.nightStart ? anchorToMs(spec.nightStart, ctxA.noonMs, tz, ctxA.sunEvents) : undefined;
    let endMs = spec && spec.nightEnd ? anchorToMs(spec.nightEnd, ctxB.noonMs, tz, ctxB.sunEvents) : undefined;
    if (startMs === undefined || endMs === undefined) {
      const timedIn = (ctx) => Object.values(ctx.dayTimes.cueTimes)
        .filter((ms) => typeof ms === 'number' && ms >= rangeStartMs && ms < rangeEndMs);
      const combined = [...timedIn(ctxA), ...timedIn(ctxB)];
      if (combined.length === 0) continue; // no timed cues this night — nothing to check
      if (startMs === undefined) startMs = Math.min(...combined);
      if (endMs === undefined) endMs = Math.max(...combined);
    }
    if (typeof startMs !== 'number' || typeof endMs !== 'number' || !(startMs < endMs)) {
      violations.push(`[contiguity] DAY ${dayKey} invalid span (start=${startMs} end=${endMs}) — nightStart/nightEnd must resolve with start < end`);
      continue;
    }

    let prevOwnerCueId = null;
    let gapStartMs = null;
    for (let t = minuteCeil(startMs); t < minuteFloor(endMs); t += MS_PER_MIN) {
      const r = resolveAtCached(plan, t, cache);
      const owned = !!(r.owner && r.owner.kind === 'cue');
      if (!owned) {
        if (gapStartMs === null) gapStartMs = t;
      } else {
        if (gapStartMs !== null) {
          violations.push(formatGap(dayKey, gapStartMs, t, prevOwnerCueId, r.owner.cueId, tz));
          gapStartMs = null;
        }
        prevOwnerCueId = r.owner.cueId;
      }
    }
    if (gapStartMs !== null) {
      violations.push(formatGap(dayKey, gapStartMs, minuteFloor(endMs), prevOwnerCueId, null, tz));
    }
  }
  return violations;
}

// ── class 2: MASTER-AUTHORSHIP ───────────────────────────────────────────────

/**
 * Static scan: every globals.master writer (cue action, look, or sequence
 * step) must be in `spec.masterWriters`; every whitelisted id must actually
 * exist (stale-entry check). Optional `spec.masterZeroCue`: exactly one cue
 * authors master=0, and it is the named one.
 */
export function assertMasterAuthorship({ plan, spec }) {
  const violations = [];
  const writers = collectMasterWriters(plan);

  for (const w of writers) {
    if (!spec.masterWriters.includes(w.cueId)) {
      violations.push(`[master-authorship] "${w.cueId}" writes globals.master=${JSON.stringify(w.value)} — not in masterWriters whitelist`);
    }
  }
  for (const id of spec.masterWriters) {
    if (!cueOrDefaultCueExists(plan, id)) {
      violations.push(`[master-authorship] masterWriters lists "${id}" but no such cue exists in the plan (stale whitelist entry)`);
    }
  }

  if (spec.masterZeroCue !== undefined) {
    const zeroId = spec.masterZeroCue;
    if (!cueOrDefaultCueExists(plan, zeroId)) {
      violations.push(`[master-authorship] masterZeroCue "${zeroId}" does not exist in the plan`);
    } else if (!writers.some((w) => w.cueId === zeroId && w.value === 0)) {
      violations.push(`[master-authorship] masterZeroCue "${zeroId}" does not author globals.master=0`);
    }
    for (const w of writers) {
      if (w.value === 0 && w.cueId !== zeroId) {
        violations.push(`[master-authorship] cue "${w.cueId}" also authors globals.master=0 — only masterZeroCue "${zeroId}" should`);
      }
    }
  }
  return violations;
}

// ── class 3: ELIGIBILITY-WINDOW SANITY ───────────────────────────────────────

/**
 * Every enabled mood-trigger cue must carry a `whenPhase` naming a defined,
 * non-empty phase, resolved per simulated day. Optional `spec.eligibility`
 * pins the EXACT resolved boundary (per day) every such cue's phase must match.
 */
export function assertEligibilityWindow({ plan, dayKeys, spec }) {
  const violations = [];
  const cache = new Map();
  const tz = plan.location.tz;
  const moodCues = plan.cues.filter((c) => c.enabled !== false && c.trigger.type === 'mood');

  for (const cue of moodCues) {
    const phase = cue.trigger.whenPhase;
    if (phase === undefined) {
      violations.push(`[eligibility-window] "${cue.id}" mood trigger has no whenPhase gate — party eligible 24h`);
      continue;
    }
    if (!plan.phases || plan.phases[phase] === undefined) {
      violations.push(`[eligibility-window] "${cue.id}" whenPhase "${phase}" is not a defined phase`);
      continue;
    }
    for (const dayKey of dayKeys) {
      const ctx = dayContext(plan, dayKey, cache);
      if (!inWindowOnDay(plan, ctx.noonMs)) continue;
      const win = ctx.dayTimes.phases[phase];
      if (!win || win.startMs === null || win.endMs === null) {
        violations.push(`[eligibility-window] "${cue.id}" whenPhase "${phase}" window unresolved on ${dayKey} (missing/polar sun event)`);
        continue;
      }
      if (win.startMs === win.endMs) {
        violations.push(`[eligibility-window] "${cue.id}" whenPhase "${phase}" window is empty (start===end) on ${dayKey}`);
      }
      if (spec && spec.eligibility) {
        const wantStart = anchorToMs(spec.eligibility.start, ctx.noonMs, tz, ctx.sunEvents);
        const wantEnd = anchorToMs(spec.eligibility.end, ctx.noonMs, tz, ctx.sunEvents);
        if (win.startMs !== wantStart || win.endMs !== wantEnd) {
          const got = `${formatLocal(new Date(win.startMs), tz)}–${formatLocal(new Date(win.endMs), tz)}`;
          const want = `${wantStart !== null ? formatLocal(new Date(wantStart), tz) : 'null'}–${wantEnd !== null ? formatLocal(new Date(wantEnd), tz) : 'null'}`;
          violations.push(`[eligibility-window] "${cue.id}" whenPhase "${phase}" window ${got} does not match spec eligibility ${want} on ${dayKey}`);
        }
      }
    }
  }
  return violations;
}

// ── class 4: SHUFFLE-PINNING ─────────────────────────────────────────────────

/** Every `spec.directedCues` id must exist and pin autopilot.shuffle:false. */
export function assertShufflePinning({ plan, spec }) {
  const violations = [];
  for (const id of spec.directedCues) {
    const cue = plan.cues.find((c) => c.id === id);
    if (!cue) {
      violations.push(`[shuffle-pinning] directedCues lists "${id}" but no such cue exists in the plan`);
      continue;
    }
    const ap = autopilotOfAction(cue.action, plan);
    if (ap === undefined) {
      violations.push(`[shuffle-pinning] "${id}" is in directedCues but its action carries no autopilot block`);
    } else if (ap.shuffle !== false) {
      violations.push(`[shuffle-pinning] "${id}" is in directedCues but autopilot.shuffle is not false (got ${JSON.stringify(ap.shuffle)})`);
    }
  }
  return violations;
}

// ── class 5: EVENT-RESUME COVERAGE ───────────────────────────────────────────

/**
 * For each event cue (spec'd `eventCues`, else every enabled manual-trigger
 * `kind:program` cue), compute its release for 3 representative fire times on
 * the middle in-window simulated day (21:00, 01:30, sunrise+90) and assert
 * resolveDeckStateAt at release+1min lands on an OWNED cue. A cue with no hold
 * is treated as release = fire+60min (stated in the violation line).
 */
export function assertEventResume({ plan, dayKeys, spec }) {
  const violations = [];
  const cache = new Map();
  const tz = plan.location.tz;

  const inWindowDays = dayKeys.filter((dk) => inWindowOnDay(plan, dateClockToEpochMs(dk, '12:00', tz)));
  if (inWindowDays.length === 0) return violations;
  const middleDay = inWindowDays[Math.floor((inWindowDays.length - 1) / 2)];

  const eventCues = spec && spec.eventCues !== null && spec.eventCues !== undefined
    ? spec.eventCues.map((id) => {
      const cue = plan.cues.find((c) => c.id === id);
      if (!cue) throw new Error(`assert spec eventCues: "${id}" does not exist in the plan`);
      return cue;
    })
    : plan.cues.filter((c) => c.enabled !== false && c.kind === 'program' && c.trigger.type === 'manual');

  const ctx = dayContext(plan, middleDay, cache);
  const fireTimes = [
    { label: '21:00', ms: dateClockToEpochMs(middleDay, '21:00', tz) },
    { label: '01:30', ms: dateClockToEpochMs(middleDay, '01:30', tz) },
  ];
  if (ctx.sunEvents.sunrise instanceof Date) {
    fireTimes.push({ label: 'sunrise+90', ms: ctx.sunEvents.sunrise.valueOf() + 90 * MS_PER_MIN });
  }

  for (const cue of eventCues) {
    for (const ft of fireTimes) {
      let releaseMs;
      let holdNote = '';
      if (cue.hold === undefined) {
        releaseMs = ft.ms + 60 * MS_PER_MIN;
        holdNote = ' (cue has no hold: treated release = fire+60min)';
      } else {
        releaseMs = resolveHold(cue.hold, ft.ms, { tz, sunEvents: ctx.sunEvents });
        if (releaseMs === null) continue; // unresolvable hold anchor (polar) — nothing to test
      }
      const checkAt = releaseMs + MS_PER_MIN;
      const r = resolveAtCached(plan, checkAt, cache);
      const owned = !!(r.owner && r.owner.kind === 'cue');
      if (!owned) {
        violations.push(
          `[event-resume] "${cue.id}" released at ${formatLocal(new Date(checkAt), tz)} resumes ownerless `
          + `(defaultCue fill) — fired ${ft.label} on ${middleDay}${holdNote}`,
        );
      }
    }
  }
  return violations;
}

// ── class 6: SOLAR-DRIFT SWEEP ───────────────────────────────────────────────

/**
 * Over the spec'd (or default) lat/lon + date span: every sun event the plan
 * references resolves finite each day, every sun-anchored cue/phase time
 * resolves, every phase stays non-empty, and the timed (clock+sun) cue firing
 * order never inverts across the sweep — checked day-over-day (not just vs
 * day 0) so a seam anywhere in the sweep is caught. Optional
 * `spec.expectedOrder` additionally pins the exact order every day.
 */
export function assertSolarDrift({
  plan, spec, runDateKey,
}) {
  const violations = [];
  const tz = plan.location.tz;
  const sweep = (spec && spec.solarSweep) || {};
  const lat = sweep.lat !== undefined ? sweep.lat : plan.location.lat;
  const lon = sweep.lon !== undefined ? sweep.lon : plan.location.lon;
  const startDate = sweep.startDate !== undefined
    ? sweep.startDate
    : (plan.festival ? plan.festival.startDate : runDateKey);
  const days = sweep.days !== undefined ? sweep.days : (plan.festival ? plan.festival.days : 14);

  const referencedSunEvents = collectReferencedSunEvents(plan);
  const timedCueIds = plan.cues
    .filter((c) => c.enabled !== false && (c.trigger.type === 'clock' || c.trigger.type === 'sun'))
    .map((c) => c.id);

  let day0Order = null;

  for (let i = 0; i < days; i += 1) {
    const dayKey = shiftDayKeyLocal(startDate, i);
    const noonMs = dateClockToEpochMs(dayKey, '12:00', tz);
    const sunEvents = computeSunEvents({
      lat, lon, date: new Date(noonMs), tz,
    });

    for (const ev of referencedSunEvents) {
      const d = sunEvents[ev];
      if (!(d instanceof Date) || Number.isNaN(d.valueOf())) {
        violations.push(`[solar-drift] sun event "${ev}" is unresolvable on ${dayKey} (lat=${lat} lon=${lon}) — likely polar day/night at this location/date`);
      }
    }

    const dayPlan = { ...plan, cues: applicableCues(plan, noonMs) };
    const dayTimes = resolveDayTimes({ plan: dayPlan, now: noonMs, sunEvents });

    for (const cue of dayPlan.cues) {
      if (cue.enabled === false) continue;
      if (cue.trigger.type !== 'clock' && cue.trigger.type !== 'sun') continue;
      if (typeof dayTimes.cueTimes[cue.id] !== 'number') {
        violations.push(`[solar-drift] cue "${cue.id}" sun/clock anchor unresolved on ${dayKey}`);
      }
    }
    for (const [name, win] of Object.entries(dayTimes.phases)) {
      if (win.startMs === null || win.endMs === null) {
        violations.push(`[solar-drift] phase "${name}" window unresolved on ${dayKey}`);
      } else if (win.startMs === win.endMs) {
        violations.push(`[solar-drift] phase "${name}" window empty on ${dayKey}`);
      }
    }

    const order = timedCueIds
      .map((id) => ({ id, ms: dayTimes.cueTimes[id] }))
      .filter((e) => typeof e.ms === 'number')
      .sort((a, b) => a.ms - b.ms)
      .map((e) => e.id);

    // Day-over-day adjacent-pair check (catches a seam ANYWHERE in the sweep,
    // not just a drift relative to day 0): every pair adjacent in DAY 0's
    // order must stay non-decreasing every subsequent day.
    if (day0Order === null) {
      day0Order = order;
    }
    for (let k = 0; k < day0Order.length - 1; k += 1) {
      const a = day0Order[k];
      const b = day0Order[k + 1];
      const aMs = dayTimes.cueTimes[a];
      const bMs = dayTimes.cueTimes[b];
      if (typeof aMs === 'number' && typeof bMs === 'number' && aMs > bMs) {
        violations.push(
          `[solar-drift] cue order seam: "${a}" and "${b}" invert on ${dayKey} `
          + `(day 0 order: "${a}" before "${b}"; here "${a}" ${formatLocal(new Date(aMs), tz)} `
          + `is after "${b}" ${formatLocal(new Date(bMs), tz)})`,
        );
      }
    }

    if (spec && spec.expectedOrder) {
      const expectedPresent = spec.expectedOrder.filter((id) => typeof dayTimes.cueTimes[id] === 'number');
      const actual = [...expectedPresent].sort((a, b) => dayTimes.cueTimes[a] - dayTimes.cueTimes[b]);
      if (JSON.stringify(actual) !== JSON.stringify(expectedPresent)) {
        violations.push(`[solar-drift] expectedOrder mismatch on ${dayKey}: expected [${expectedPresent.join(', ')}], got [${actual.join(', ')}]`);
      }
    }
  }
  return violations;
}

// ── class 7: LINT CLEAN ──────────────────────────────────────────────────────

/** lintShowPlan(plan) must report nothing (docs/38 program-look freeze lint). */
export function assertLintClean({ plan }) {
  return lintShowPlan(plan).map((f) => `[lint] "${f.cueId}": ${f.message}`);
}

// ── class 8: RESTART/RESUME PROBES ───────────────────────────────────────────

/**
 * A "restart" probe = resolveDeckStateAt at that instant — this IS the boot
 * `_catchUp` resolution (resolve_deck_state.js's selection core is lifted
 * verbatim out of TimelineService._catchUp), so this class answers "if the
 * engine rebooted at this clock time, does it come back owned?" for every
 * simulated night, at the spec'd (or default 02:00 / 07:30) probe times —
 * resolved against the NIGHT following each dayKey (i.e. the small hours
 * after that day's sunset), matching docs/77 §9.6's "kill/reboot at 02:00 and
 * 07:30" restart cases. Every probe emits an informational note naming the
 * resolved cue (or the ownerless finding) so the operator can eyeball
 * PASSING probes too, not just failures. Optional `spec.restartExpect` pins
 * the exact expected cue id per probe clock.
 */
export function assertRestartResume({ plan, dayKeys, spec }) {
  const violations = [];
  const notes = [];
  const cache = new Map();
  const tz = plan.location.tz;
  const probes = (spec && spec.restartProbes) || DEFAULT_RESTART_PROBES;
  const expect = (spec && spec.restartExpect) || {};

  for (const dayKey of dayKeys) {
    const nextDayKey = shiftDayKeyLocal(dayKey, 1);
    const ctxA = dayContext(plan, dayKey, cache);
    if (!inWindowOnDay(plan, ctxA.noonMs)) continue;

    for (const clock of probes) {
      const checkAt = dateClockToEpochMs(nextDayKey, clock, tz);
      const r = resolveAtCached(plan, checkAt, cache);
      const owned = !!(r.owner && r.owner.kind === 'cue');
      if (!owned) {
        violations.push(`[restart-resume] restart probe ${clock} (night of ${dayKey}) resumes ownerless (defaultCue fill)`);
        continue;
      }
      notes.push(`restart probe ${clock} (night of ${dayKey}) resolves to cue "${r.owner.cueId}" (controller=${r.controller})`);
      if (r.owner.cueKind === 'program' && r.controller === 'program') {
        if (typeof r.holdUntilMs !== 'number' || !Number.isFinite(r.holdUntilMs) || r.holdUntilMs <= checkAt) {
          violations.push(
            `[restart-resume] restart probe ${clock} (night of ${dayKey}) resolves to program cue `
            + `"${r.owner.cueId}" but its holdUntilMs is not finite/future (got ${r.holdUntilMs})`,
          );
        }
      }
      const expected = expect[clock];
      if (expected !== undefined && expected !== r.owner.cueId) {
        violations.push(
          `[restart-resume] restart probe ${clock} (night of ${dayKey}) resolved to "${r.owner.cueId}", `
          + `expected "${expected}" (restartExpect)`,
        );
      }
    }
  }
  return { violations, notes };
}

// ── orchestrator + report rendering ──────────────────────────────────────────

function finalize(violations, notes) {
  return { status: violations.length > 0 ? 'FAIL' : 'PASS', violations, notes: notes || [] };
}

function skip(reason) {
  return {
    status: 'SKIP', reason, violations: [], notes: [],
  };
}

/**
 * Run all 8 assertion classes against a normalized plan.
 *
 * @param {{plan:object, spec:object|null, dayKeys:string[], runDateKey:string}} args
 *   plan       — a normalized show plan (loadShowPlan output)
 *   spec       — a parseAssertSpec() result, or null when no --assert-spec
 *   dayKeys    — the simulated run's 'YYYY-MM-DD' day keys (span.dayKeys)
 *   runDateKey — the run's requested --date (class 6's no-festival default)
 * @returns {{classes:object, pass:boolean, totalViolations:number}}
 */
export function runAssertions({
  plan, spec, dayKeys, runDateKey,
}) {
  if (!plan || typeof plan !== 'object') throw new Error('runAssertions: plan is required');
  if (!Array.isArray(dayKeys) || dayKeys.length === 0) throw new Error('runAssertions: dayKeys must be a non-empty array');
  const specGiven = spec !== null && spec !== undefined;

  const classes = {};
  classes.contiguity = finalize(assertContiguity({ plan, dayKeys, spec }));
  classes.masterAuthorship = specGiven
    ? finalize(assertMasterAuthorship({ plan, spec }))
    : skip('no --assert-spec: class needs a masterWriters whitelist');
  classes.eligibilityWindow = finalize(assertEligibilityWindow({ plan, dayKeys, spec }));
  classes.shufflePinning = specGiven
    ? finalize(assertShufflePinning({ plan, spec }))
    : skip('no --assert-spec: class needs a directedCues whitelist');
  classes.eventResume = finalize(assertEventResume({ plan, dayKeys, spec }));
  classes.solarDrift = finalize(assertSolarDrift({ plan, spec, runDateKey }));
  classes.lint = finalize(assertLintClean({ plan }));
  const rr = assertRestartResume({ plan, dayKeys, spec });
  classes.restartResume = finalize(rr.violations, rr.notes);

  let totalViolations = 0;
  let pass = true;
  for (const c of Object.values(classes)) {
    totalViolations += c.violations.length;
    if (c.status === 'FAIL') pass = false;
  }
  return { classes, pass, totalViolations };
}

const CLASS_ORDER = [
  ['1 contiguity', 'contiguity'],
  ['2 master-authorship', 'masterAuthorship'],
  ['3 eligibility-window', 'eligibilityWindow'],
  ['4 shuffle-pinning', 'shufflePinning'],
  ['5 event-resume', 'eventResume'],
  ['6 solar-drift', 'solarDrift'],
  ['7 lint', 'lint'],
  ['8 restart-resume', 'restartResume'],
];

/** Render a runAssertions() result as an array of transcript lines. */
export function renderAssertionReport(result) {
  const lines = [];
  const rule = '─'.repeat(78);
  lines.push('', rule, 'ASSERTIONS', rule);
  for (const [label, key] of CLASS_ORDER) {
    const c = result.classes[key];
    const status = c.status === 'SKIP'
      ? `SKIP (${c.reason})`
      : `${c.status} (${c.violations.length} violation${c.violations.length === 1 ? '' : 's'})`;
    lines.push(`  ${label.padEnd(22)} ${status}`);
  }
  for (const [, key] of CLASS_ORDER) {
    const c = result.classes[key];
    for (const v of c.violations) lines.push(`  ${v}`);
    for (const n of c.notes) lines.push(`  (note) ${n}`);
  }
  lines.push(rule);
  lines.push(`ASSERT RESULT: ${result.pass ? 'PASS' : 'FAIL'} (${result.totalViolations} violation${result.totalViolations === 1 ? '' : 's'})`);
  return lines;
}
