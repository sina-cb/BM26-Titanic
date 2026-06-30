/*
 * show_plan.js — load / validate / save the Timeline Companion's SHOW PLAN
 * YAML (the authored timeline: phases, looks, cues for a scene). Mirrors the
 * Audio Companion's companion_config.js contract:
 *   - loadShowPlan(filePath) returns the built-in default ONLY on ENOENT;
 *     any other read/parse error THROWS (codex P0 — no silent fallback over a
 *     corrupt plan).
 *   - validateShowPlan(plan) THROWS on any invalid field (throw-style
 *     validation) and returns a normalized object.
 *   - saveShowPlan validates-then-writes; dumpShowPlan returns YAML text.
 *
 * The schema is docs/38 §3 (trigger/action/look/phase model). Cross-reference
 * checks (a phase-trigger's phase, a look-action's look, a mood whenPhase must
 * all be defined in the plan) fail loud on a dangling reference.
 */
import fs from 'node:fs';

import yaml from 'js-yaml';

// Sun events a sun anchor / sun trigger may reference (mirrors sun.js output).
export const SUN_EVENTS = Object.freeze([
  'sunrise', 'sunset', 'solarNoon',
  'civilDawn', 'civilDusk',
  'nauticalDawn', 'nauticalDusk',
  'goldenHourEnd', 'goldenHourStart',
]);

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MOOD_VALUES = Object.freeze(['calm', 'party']);
const TARGET_CHANNELS = Object.freeze(['deck', 'mixer', 'all']);
const CUE_KINDS = Object.freeze(['program', 'mood', 'ambient']);

// Deck playlist transition styles a 'playlist' action may request (docs/38 §16.9).
// Mirrors the engine's deck transition-config `mode` (api_server.js) — the swap
// runs as a soft double-buffer fade in this style. UI drops the rarer wipe/iris
// styles; the engine accepts exactly these three for an authored cue.
export const CUE_TRANSITION_MODES = Object.freeze([
  'trans_crossfade', 'trans_flash', 'trans_dissolve',
]);
// A playlist action's `overlays` field: enable (honor configured overlays) or
// disable (turn ALL deck overlays off). Absent → no change (docs/38 §16.9).
const CUE_OVERLAY_MODES = Object.freeze(['enable', 'disable']);

// A playlist action's optional `colorAutopilot` block (docs/39) — a DECK-ONLY knob
// that configures the engine's palette-cycling daemon when the cue fires. Wire
// shape: { active, palettes: string[](>=1), delay_s: number>0, shuffle?: bool }.
export const CUE_COLOR_AUTOPILOT_KEYS = Object.freeze([
  'active', 'palettes', 'delay_s', 'shuffle', 'transitionMs',
]);

// ── small validators (all throw-style; first arg is a context label) ──────────

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function assertSlug(value, label) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new Error(`${label} must be a slug /^[a-z0-9][a-z0-9_-]{0,63}$/, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} must be a number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertBool(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertClock(value, label) {
  if (typeof value !== 'string' || !CLOCK_RE.test(value)) {
    throw new Error(`${label} must be a 24h "HH:MM" clock time, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A calendar-date string 'YYYY-MM-DD'. Validates not only the shape but that
 * the fields form a real date (e.g. rejects '2026-02-30'). Returns the string.
 */
function assertDate(value, label) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(`${label} must be a 'YYYY-MM-DD' date, got ${JSON.stringify(value)}`);
  }
  const [y, mo, d] = value.split('-').map(Number);
  // Round-trip through UTC to reject impossible dates (Feb 30 → Mar 2 etc.).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new Error(`${label} is not a valid calendar date, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertSunEvent(value, label) {
  if (!SUN_EVENTS.includes(value)) {
    throw new Error(`${label} must be one of ${SUN_EVENTS.join(', ')}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

// A CPC globals value is either a plain Number or an {h,s,v} color triple.
function validateGlobalsMap(map, label) {
  if (!isPlainObject(map)) throw new Error(`${label} must be an object of CPC keys`);
  const out = {};
  for (const [key, val] of Object.entries(map)) {
    if (typeof val === 'number') {
      if (Number.isNaN(val)) throw new Error(`${label}.${key} number is NaN`);
      out[key] = val;
    } else if (isPlainObject(val)) {
      const keys = Object.keys(val).sort();
      if (keys.length !== 3 || keys[0] !== 'h' || keys[1] !== 's' || keys[2] !== 'v') {
        throw new Error(`${label}.${key} object must be an {h,s,v} color triple`);
      }
      out[key] = {
        h: assertNumber(val.h, `${label}.${key}.h`),
        s: assertNumber(val.s, `${label}.${key}.s`),
        v: assertNumber(val.v, `${label}.${key}.v`),
      };
    } else {
      throw new Error(`${label}.${key} must be a Number or an {h,s,v} object`);
    }
  }
  return out;
}

function validateTarget(target, label) {
  if (target === undefined) return { channel: 'deck', id: null };
  if (!isPlainObject(target)) throw new Error(`${label} must be an object { channel, id }`);
  if (!TARGET_CHANNELS.includes(target.channel)) {
    throw new Error(`${label}.channel must be one of ${TARGET_CHANNELS.join(', ')}, got ${JSON.stringify(target.channel)}`);
  }
  let id = null;
  if (target.id !== undefined && target.id !== null) {
    id = assertString(target.id, `${label}.id`);
  }
  return { channel: target.channel, id };
}

/**
 * Plan-level AUTOPILOT baseline block (docs/38 §14.3) — the regular-programming
 * layer. All fields optional; missing → documented defaults. THROW-style.
 *   { enabled, playlist?, delay_s, shuffle, target, mood }
 */
function validatePlanAutopilot(ap, label) {
  if (ap === undefined) {
    return { enabled: true, delay_s: 45, shuffle: true, target: { channel: 'deck', id: null }, mood: true };
  }
  if (!isPlainObject(ap)) throw new Error(`${label} must be an object`);
  const out = {};
  out.enabled = ap.enabled !== undefined ? assertBool(ap.enabled, `${label}.enabled`) : true;
  if (ap.playlist !== undefined) out.playlist = assertSlug(ap.playlist, `${label}.playlist`);
  if (ap.delay_s !== undefined) {
    if (typeof ap.delay_s !== 'number' || Number.isNaN(ap.delay_s) || ap.delay_s <= 0) {
      throw new Error(`${label}.delay_s must be a number > 0, got ${JSON.stringify(ap.delay_s)}`);
    }
    out.delay_s = ap.delay_s;
  } else {
    out.delay_s = 45;
  }
  out.shuffle = ap.shuffle !== undefined ? assertBool(ap.shuffle, `${label}.shuffle`) : true;
  out.target = validateTarget(ap.target, `${label}.target`);
  out.mood = ap.mood !== undefined ? assertBool(ap.mood, `${label}.mood`) : true;
  return out;
}

function validateAutopilot(ap, label) {
  if (!isPlainObject(ap)) throw new Error(`${label} must be an object { active, delay_s, shuffle }`);
  assertBool(ap.active, `${label}.active`);
  if (typeof ap.delay_s !== 'number' || Number.isNaN(ap.delay_s) || ap.delay_s <= 0) {
    throw new Error(`${label}.delay_s must be a number > 0, got ${JSON.stringify(ap.delay_s)}`);
  }
  assertBool(ap.shuffle, `${label}.shuffle`);
  return { active: ap.active, delay_s: ap.delay_s, shuffle: ap.shuffle };
}

function validateIdList(list, label) {
  if (!Array.isArray(list)) throw new Error(`${label} must be an array of ids`);
  return list.map((id, i) => assertString(id, `${label}[${i}]`));
}

// ── anchors (clock | sun ± offset) ────────────────────────────────────────────

function validateAnchor(anchor, label) {
  if (!isPlainObject(anchor)) throw new Error(`${label} must be an object`);
  const hasClock = anchor.clock !== undefined;
  const hasSun = anchor.sun !== undefined;
  if (hasClock === hasSun) {
    throw new Error(`${label} must have exactly one of { clock } or { sun }`);
  }
  if (hasClock) {
    return { clock: assertClock(anchor.clock, `${label}.clock`) };
  }
  const out = { sun: assertSunEvent(anchor.sun, `${label}.sun`), offsetMin: 0 };
  if (anchor.offsetMin !== undefined) {
    out.offsetMin = assertInteger(anchor.offsetMin, `${label}.offsetMin`);
  }
  return out;
}

// ── location / phases / looks ─────────────────────────────────────────────────

function validateLocation(loc) {
  if (!isPlainObject(loc)) throw new Error('plan.location must be an object');
  const lat = assertNumber(loc.lat, 'plan.location.lat');
  const lon = assertNumber(loc.lon, 'plan.location.lon');
  if (lat < -90 || lat > 90) throw new Error(`plan.location.lat must be in [-90, 90], got ${lat}`);
  if (lon < -180 || lon > 180) throw new Error(`plan.location.lon must be in [-180, 180], got ${lon}`);
  const tz = assertString(loc.tz, 'plan.location.tz');
  // A bad zone passes the string check but throws RangeError on every tick
  // (Intl with an invalid timeZone) → a silent show dead-stop. Probe it now so
  // an authoring error fails loud at validation, not at 19:42 on the playa.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch (_) {
    throw new Error(`plan.location.tz "${tz}" is not a valid IANA time zone`);
  }
  let elevationM = 0;
  if (loc.elevationM !== undefined) elevationM = assertNumber(loc.elevationM, 'plan.location.elevationM');
  return { lat, lon, tz, elevationM };
}

function validatePhases(phases) {
  if (!isPlainObject(phases)) throw new Error('plan.phases must be an object of phase windows');
  const out = {};
  for (const [name, win] of Object.entries(phases)) {
    assertSlug(name, `plan.phases key "${name}"`);
    if (!isPlainObject(win)) throw new Error(`plan.phases.${name} must be an object { start, end }`);
    out[name] = {
      start: validateAnchor(win.start, `plan.phases.${name}.start`),
      end: validateAnchor(win.end, `plan.phases.${name}.end`),
    };
  }
  return out;
}

function validateLook(name, look) {
  if (!isPlainObject(look)) throw new Error(`plan.looks.${name} must be an object`);
  const out = {};
  if (look.playlist !== undefined) out.playlist = assertSlug(look.playlist, `plan.looks.${name}.playlist`);
  if (look.autopilot !== undefined) out.autopilot = validateAutopilot(look.autopilot, `plan.looks.${name}.autopilot`);
  if (look.palette !== undefined) out.palette = assertSlug(look.palette, `plan.looks.${name}.palette`);
  if (look.globals !== undefined) out.globals = validateGlobalsMap(look.globals, `plan.looks.${name}.globals`);
  if (look.tasks !== undefined) {
    if (!isPlainObject(look.tasks)) throw new Error(`plan.looks.${name}.tasks must be an object { enable, disable }`);
    out.tasks = {
      enable: validateIdList(look.tasks.enable !== undefined ? look.tasks.enable : [], `plan.looks.${name}.tasks.enable`),
      disable: validateIdList(look.tasks.disable !== undefined ? look.tasks.disable : [], `plan.looks.${name}.tasks.disable`),
    };
  }
  out.target = validateTarget(look.target, `plan.looks.${name}.target`);
  return out;
}

function validateLooks(looks) {
  if (!isPlainObject(looks)) throw new Error('plan.looks must be an object of looks');
  const out = {};
  for (const [name, look] of Object.entries(looks)) {
    assertSlug(name, `plan.looks key "${name}"`);
    out[name] = validateLook(name, look);
  }
  return out;
}

// ── triggers / actions ────────────────────────────────────────────────────────

function validateTrigger(trigger, label, phaseNames) {
  if (!isPlainObject(trigger)) throw new Error(`${label} must be an object`);
  switch (trigger.type) {
    case 'clock':
      return { type: 'clock', at: assertClock(trigger.at, `${label}.at`) };
    case 'sun': {
      const out = { type: 'sun', event: assertSunEvent(trigger.event, `${label}.event`), offsetMin: 0 };
      if (trigger.offsetMin !== undefined) out.offsetMin = assertInteger(trigger.offsetMin, `${label}.offsetMin`);
      return out;
    }
    case 'phase': {
      const phase = assertSlug(trigger.phase, `${label}.phase`);
      if (!phaseNames.has(phase)) throw new Error(`${label}.phase "${phase}" is not a defined phase`);
      return { type: 'phase', phase };
    }
    case 'mood': {
      if (!MOOD_VALUES.includes(trigger.from)) throw new Error(`${label}.from must be one of ${MOOD_VALUES.join(', ')}`);
      if (!MOOD_VALUES.includes(trigger.to)) throw new Error(`${label}.to must be one of ${MOOD_VALUES.join(', ')}`);
      const out = { type: 'mood', from: trigger.from, to: trigger.to, minDwellSec: 0, cooldownSec: 0 };
      if (trigger.minDwellSec !== undefined) {
        out.minDwellSec = assertNumber(trigger.minDwellSec, `${label}.minDwellSec`);
        if (out.minDwellSec < 0) throw new Error(`${label}.minDwellSec must be >= 0`);
      }
      if (trigger.cooldownSec !== undefined) {
        out.cooldownSec = assertNumber(trigger.cooldownSec, `${label}.cooldownSec`);
        if (out.cooldownSec < 0) throw new Error(`${label}.cooldownSec must be >= 0`);
      }
      if (trigger.whenPhase !== undefined) {
        const wp = assertSlug(trigger.whenPhase, `${label}.whenPhase`);
        if (!phaseNames.has(wp)) throw new Error(`${label}.whenPhase "${wp}" is not a defined phase`);
        out.whenPhase = wp;
      }
      return out;
    }
    case 'manual':
      return { type: 'manual' };
    default:
      throw new Error(`${label}.type must be one of clock, sun, phase, mood, manual, got ${JSON.stringify(trigger.type)}`);
  }
}

/**
 * A 'playlist' action's optional `transition` block (docs/38 §16.9) — how the deck
 * swap that loads this playlist should look. THROW-style; `mode` is REQUIRED when
 * the block is present (an empty {} is an authoring error). Returns a normalized
 * { mode, durationMs?, enabled? }.
 */
function validateCueTransition(transition, label) {
  if (!isPlainObject(transition)) throw new Error(`${label} must be an object { mode, durationMs?, enabled? }`);
  if (transition.mode === undefined) {
    throw new Error(`${label}.mode is required (one of ${CUE_TRANSITION_MODES.join(', ')})`);
  }
  const mode = assertString(transition.mode, `${label}.mode`);
  if (!CUE_TRANSITION_MODES.includes(mode)) {
    throw new Error(`${label}.mode must be one of ${CUE_TRANSITION_MODES.join(', ')}, got ${JSON.stringify(transition.mode)}`);
  }
  const out = { mode };
  if (transition.durationMs !== undefined) {
    const ms = assertInteger(transition.durationMs, `${label}.durationMs`);
    if (ms <= 0) throw new Error(`${label}.durationMs must be an integer > 0, got ${ms}`);
    out.durationMs = ms;
  }
  if (transition.enabled !== undefined) out.enabled = assertBool(transition.enabled, `${label}.enabled`);
  return out;
}

/**
 * A 'playlist' action's optional `colorAutopilot` block (docs/39) — configures the
 * engine's palette-cycling daemon when this deck cue fires. THROW-style. The wire
 * shape MUST match the engine ColorAutopilot + the deck REST route:
 *   { active: bool, palettes: string[](>=1), delay_s: number>0, shuffle?: bool,
 *     transitionMs?: number>=0 }
 * Palette ids are validated for SHAPE here (non-empty strings); membership in the
 * rig's colorPalettes config is enforced at apply time (the plan validator has no
 * palette catalog). `transitionMs` (optional, default 0 = hard cut) is the
 * crossfade duration on a palette switch. Returns a normalized
 * { active, palettes, delay_s, shuffle, transitionMs }.
 */
function validateCueColorAutopilot(ca, label) {
  if (!isPlainObject(ca)) {
    throw new Error(`${label} must be an object { active, palettes, delay_s, shuffle?, transitionMs? }`);
  }
  assertBool(ca.active, `${label}.active`);
  if (!Array.isArray(ca.palettes) || ca.palettes.length === 0) {
    throw new Error(`${label}.palettes must be a non-empty array of palette ids`);
  }
  const palettes = ca.palettes.map((id, i) => assertString(id, `${label}.palettes[${i}]`));
  if (typeof ca.delay_s !== 'number' || Number.isNaN(ca.delay_s) || ca.delay_s <= 0) {
    throw new Error(`${label}.delay_s must be a number > 0, got ${JSON.stringify(ca.delay_s)}`);
  }
  const shuffle = ca.shuffle !== undefined ? assertBool(ca.shuffle, `${label}.shuffle`) : false;
  let transitionMs = 0;
  if (ca.transitionMs !== undefined) {
    if (typeof ca.transitionMs !== 'number' || !Number.isFinite(ca.transitionMs) || ca.transitionMs < 0) {
      throw new Error(`${label}.transitionMs must be a number >= 0, got ${JSON.stringify(ca.transitionMs)}`);
    }
    transitionMs = ca.transitionMs;
  }
  return { active: ca.active, palettes, delay_s: ca.delay_s, shuffle, transitionMs };
}

function validateAction(action, label, lookNames) {
  if (!isPlainObject(action)) throw new Error(`${label} must be an object`);
  switch (action.type) {
    case 'playlist': {
      const out = { type: 'playlist', name: assertSlug(action.name, `${label}.name`) };
      out.target = validateTarget(action.target, `${label}.target`);
      if (action.autopilot !== undefined) out.autopilot = validateAutopilot(action.autopilot, `${label}.autopilot`);
      // transition + overlays are DECK-ONLY knobs (docs/38 §16.9): they configure
      // the deck's soft-swap / overlay layers, which have no meaning on a mixer
      // channel. A non-deck target with either field is an authoring error.
      if (action.transition !== undefined) {
        if (out.target.channel !== 'deck') {
          throw new Error(`${label}.transition is only valid for a deck target`);
        }
        out.transition = validateCueTransition(action.transition, `${label}.transition`);
      }
      if (action.overlays !== undefined) {
        if (out.target.channel !== 'deck') {
          throw new Error(`${label}.overlays is only valid for a deck target`);
        }
        if (!CUE_OVERLAY_MODES.includes(action.overlays)) {
          throw new Error(`${label}.overlays must be one of ${CUE_OVERLAY_MODES.join(', ')}, got ${JSON.stringify(action.overlays)}`);
        }
        out.overlays = action.overlays;
      }
      // colorAutopilot is a DECK-ONLY knob (docs/39): it drives the engine's
      // palette-cycling daemon, which only has meaning on the deck output. A
      // non-deck target with the field is an authoring error → throw.
      if (action.colorAutopilot !== undefined) {
        if (out.target.channel !== 'deck') {
          throw new Error(`${label}.colorAutopilot is only valid for a deck target`);
        }
        out.colorAutopilot = validateCueColorAutopilot(action.colorAutopilot, `${label}.colorAutopilot`);
      }
      return out;
    }
    case 'look': {
      const look = assertSlug(action.look, `${label}.look`);
      if (!lookNames.has(look)) throw new Error(`${label}.look "${look}" is not a defined look`);
      return { type: 'look', look };
    }
    case 'scene':
      return { type: 'scene', scene: assertSlug(action.scene, `${label}.scene`) };
    case 'globals': {
      const out = { type: 'globals', set: validateGlobalsMap(action.set, `${label}.set`) };
      out.target = validateTarget(action.target, `${label}.target`);
      return out;
    }
    case 'tasks':
      return {
        type: 'tasks',
        enable: validateIdList(action.enable !== undefined ? action.enable : [], `${label}.enable`),
        disable: validateIdList(action.disable !== undefined ? action.disable : [], `${label}.disable`),
      };
    case 'effect': {
      // fire-now uses the scheduled task's OWN preset; presetId is OPTIONAL and
      // params are NOT supported in v1 (the runtime cannot pass them through).
      // Accepting params and dropping them silently would violate codex P0 — so
      // we throw loud here rather than honor a field we can't apply.
      const out = {
        type: 'effect',
        effectId: assertString(action.effectId, `${label}.effectId`),
      };
      if (action.presetId !== undefined) {
        if (typeof action.presetId === 'string') {
          if (!action.presetId.trim()) throw new Error(`${label}.presetId string must be non-empty`);
          out.presetId = action.presetId;
        } else if (typeof action.presetId === 'number' && !Number.isNaN(action.presetId)) {
          out.presetId = action.presetId;
        } else {
          throw new Error(`${label}.presetId must be a string or number`);
        }
      }
      if (action.params !== undefined) {
        throw new Error(`${label}.params is not supported in v1`);
      }
      return out;
    }
    default:
      throw new Error(`${label}.type must be one of playlist, look, scene, globals, tasks, effect, got ${JSON.stringify(action.type)}`);
  }
}

/**
 * A cue's HOLD window (docs/38 §14.3) — only meaningful for kind:'program'.
 *   { min: Number>0 }   → program owns priority for that many minutes
 *   { until: <anchor> } → program owns priority until that clock/sun anchor
 * Exactly one of the two; omitted → null (holds until the next program cue).
 */
function validateHold(hold, label) {
  if (!isPlainObject(hold)) throw new Error(`${label} must be an object { min } or { until }`);
  const hasMin = hold.min !== undefined;
  const hasUntil = hold.until !== undefined;
  if (hasMin === hasUntil) {
    throw new Error(`${label} must have exactly one of { min } or { until }`);
  }
  if (hasMin) {
    if (typeof hold.min !== 'number' || Number.isNaN(hold.min) || hold.min <= 0) {
      throw new Error(`${label}.min must be a number > 0, got ${JSON.stringify(hold.min)}`);
    }
    return { min: hold.min };
  }
  return { until: validateAnchor(hold.until, `${label}.until`) };
}

/**
 * The optional FESTIVAL span block (docs/38 §15.2). Absent ⇒ null (a "nightly
 * recurring" plan with no fixed span — every cue must be days:'all'). Present ⇒
 * { startDate:'YYYY-MM-DD'(valid), days: Int 1..31 }. THROW-style.
 */
function validateFestival(festival, label) {
  if (festival === undefined || festival === null) return null;
  if (!isPlainObject(festival)) throw new Error(`${label} must be an object { startDate, days }`);
  const startDate = assertDate(festival.startDate, `${label}.startDate`);
  const days = assertInteger(festival.days, `${label}.days`);
  if (days < 1 || days > 31) throw new Error(`${label}.days must be an integer in [1, 31], got ${days}`);
  return { startDate, days };
}

/**
 * A cue's `days` applicability (docs/38 §15.2). Default 'all'. Otherwise an
 * array of either day INDICES (Int in [0, festival.days-1]) or calendar DATE
 * strings ('YYYY-MM-DD'). Index/date forms require a festival block (mixing a
 * day-targeted cue into a no-festival plan is an authoring error → throw). The
 * array must be homogeneous (all ints OR all dates) and non-empty.
 */
function validateCueDays(days, label, festival) {
  if (days === undefined || days === 'all') return 'all';
  if (!Array.isArray(days)) {
    throw new Error(`${label} must be 'all' or an array of day indices / dates, got ${JSON.stringify(days)}`);
  }
  if (days.length === 0) throw new Error(`${label} array must be non-empty`);
  const allInts = days.every((v) => Number.isInteger(v));
  const allDates = days.every((v) => typeof v === 'string');
  if (!allInts && !allDates) {
    throw new Error(`${label} must be all integer day-indices OR all 'YYYY-MM-DD' date strings, got ${JSON.stringify(days)}`);
  }
  if (!festival) {
    throw new Error(`${label} uses day indices/dates but the plan has no festival block (add festival or use days:'all')`);
  }
  if (allInts) {
    return days.map((v, i) => {
      if (v < 0 || v > festival.days - 1) {
        throw new Error(`${label}[${i}] day index ${v} out of range [0, ${festival.days - 1}]`);
      }
      return v;
    });
  }
  return days.map((v, i) => assertDate(v, `${label}[${i}]`));
}

function validateCue(cue, index, phaseNames, lookNames, seenIds, festival) {
  const label = `plan.cues[${index}]`;
  if (!isPlainObject(cue)) throw new Error(`${label} must be an object`);
  const id = assertSlug(cue.id, `${label}.id`);
  if (seenIds.has(id)) throw new Error(`${label}.id "${id}" is not unique within the plan`);
  seenIds.add(id);
  const out = { id };
  if (cue.label !== undefined) out.label = assertString(cue.label, `${label}.label`);
  out.enabled = cue.enabled !== undefined ? assertBool(cue.enabled, `${label}.enabled`) : true;
  out.catchUp = cue.catchUp !== undefined ? assertBool(cue.catchUp, `${label}.catchUp`) : true;
  out.trigger = validateTrigger(cue.trigger, `${label}.trigger`, phaseNames);
  out.action = validateAction(cue.action, `${label}.action`, lookNames);
  // kind: explicit must be one of program | mood | ambient; default inference is
  // mood-trigger→'mood', everything else→'program' (docs/38 §14.3). We normalize
  // the default here so downstream (arbiter) always sees an explicit kind.
  if (cue.kind !== undefined) {
    if (!CUE_KINDS.includes(cue.kind)) {
      throw new Error(`${label}.kind must be one of ${CUE_KINDS.join(', ')}, got ${JSON.stringify(cue.kind)}`);
    }
    out.kind = cue.kind;
  } else {
    out.kind = out.trigger.type === 'mood' ? 'mood' : 'program';
  }
  // hold: only meaningful for kind:'program'. Validate whenever present.
  if (cue.hold !== undefined) out.hold = validateHold(cue.hold, `${label}.hold`);
  // days: festival-day applicability (docs/38 §15.2). Default 'all'.
  out.days = validateCueDays(cue.days, `${label}.days`, festival);
  return out;
}

// ── top-level ─────────────────────────────────────────────────────────────────

/**
 * Validate a full show plan. THROWS on any invalid field (throw-style).
 * Returns a normalized plan object.
 */
export function validateShowPlan(plan) {
  if (!isPlainObject(plan)) throw new Error('show plan must be an object');
  if (plan.schemaVersion !== 1 && plan.schemaVersion !== 2) {
    throw new Error(`plan.schemaVersion must === 1 or 2, got ${JSON.stringify(plan.schemaVersion)}`);
  }
  const name = assertSlug(plan.name, 'plan.name');
  const location = validateLocation(plan.location);
  // v1 plans carry no festival and no cue.days — they normalize to the v2 shape
  // with festival:null and every cue days:'all' (recurring nightly, exactly as
  // before). v2 plans may carry an explicit festival span + per-cue days.
  const festival = plan.schemaVersion === 2 ? validateFestival(plan.festival, 'plan.festival') : null;
  const phases = validatePhases(plan.phases !== undefined ? plan.phases : {});
  const looks = validateLooks(plan.looks !== undefined ? plan.looks : {});

  const phaseNames = new Set(Object.keys(phases));
  const lookNames = new Set(Object.keys(looks));
  const autopilot = validatePlanAutopilot(plan.autopilot, 'plan.autopilot');

  if (!Array.isArray(plan.cues)) throw new Error('plan.cues must be an array');
  // Bound the plan: buildOverview is O(days × cues) with per-cue Intl, so a huge
  // plan can stall the engine's event loop (a 10k-cue POST froze /status ~32s).
  if (plan.cues.length > 512) {
    throw new Error(`plan has too many cues (max 512), got ${plan.cues.length}`);
  }
  const seenIds = new Set();
  const cues = plan.cues.map((cue, i) => validateCue(cue, i, phaseNames, lookNames, seenIds, festival));

  // Always emit the v2 normalized shape (back-compat: a v1 input → v2 out with
  // festival:null + days:'all'). loadShowPlan still loads old files unchanged.
  return { schemaVersion: 2, name, location, festival, autopilot, phases, looks, cues };
}

/**
 * Load a show plan from disk. A MISSING file is the only non-error path → the
 * built-in default plan. Any present-but-broken file THROWS (codex P0).
 *
 * @param {string} filePath
 * @returns {object} normalized plan
 */
export function loadShowPlan(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return validateShowPlan(defaultShowPlan());
    throw new Error(`show plan read failed (${filePath}): ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new Error(`show plan parse failed (${filePath}): ${err.message}`);
  }
  return validateShowPlan(parsed);
}

/** Validate-then-write a plan to disk (never persist an invalid plan). */
export function saveShowPlan(plan, filePath) {
  const normalized = validateShowPlan(plan);
  fs.writeFileSync(filePath, dumpShowPlan(normalized), 'utf8');
  return normalized;
}

/** Serialize a (validated) plan to YAML text without writing. */
export function dumpShowPlan(plan) {
  const normalized = validateShowPlan(plan);
  return yaml.dump(normalized, { lineWidth: 100, noRefs: true });
}

/**
 * The built-in default — a runnable BRC nightly plan. Playlists are all
 * 'default' (the only name guaranteed to exist) so the plan is runnable in
 * tests; looks still carry palettes/autopilot to exercise the look bundle.
 * Cues mirror docs/38 §3.5 (golden-hour look, party_night phase look, mood
 * calm→party gated to party_night, sunrise look).
 */
export function defaultShowPlan() {
  return {
    schemaVersion: 2,
    name: 'playa_default',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    // BRC 2026: an 8-day span from 2026-08-30 through 2026-09-06. Day indices
    // 0..7; index 6 = burn night, index 7 = temple burn (docs/38 §15.2).
    festival: { startDate: '2026-08-30', days: 8 },
    // The AUTOPILOT baseline (regular programming): engine autopilot cycles the
    // 'default' playlist on the deck, mood swaps allowed (docs/38 §14).
    autopilot: {
      enabled: true,
      playlist: 'default',
      delay_s: 45,
      shuffle: true,
      target: { channel: 'deck', id: null },
      mood: true,
    },
    phases: {
      philharmonic: {
        start: { sun: 'sunset', offsetMin: -30 },
        end: { sun: 'sunset', offsetMin: 60 },
      },
      party_night: {
        start: { sun: 'sunset', offsetMin: 120 },
        end: { sun: 'sunrise', offsetMin: -60 },
      },
      sunrise_set: {
        start: { sun: 'sunrise', offsetMin: -30 },
        end: { sun: 'sunrise', offsetMin: 90 },
      },
    },
    looks: {
      daytime: { playlist: 'default', palette: 'deep_sea', globals: { master: 0.5 } },
      philharmonic: {
        playlist: 'default', palette: 'sunset_coral',
        autopilot: { active: true, delay_s: 90, shuffle: false },
      },
      party: {
        playlist: 'default', palette: 'bass_drop',
        autopilot: { active: true, delay_s: 30, shuffle: true },
      },
      sunrise: { playlist: 'default', palette: 'aurora', globals: { master: 0.6 } },
      // Day-specific looks for the special nights.
      burn_night: { playlist: 'default', palette: 'bass_drop', globals: { master: 1 } },
      temple: { playlist: 'default', palette: 'aurora', globals: { master: 0.4 } },
    },
    cues: [
      // ── recurring (every festival day) ────────────────────────────────────
      {
        id: 'c_visibility_on',
        label: 'Exterior up at golden hour',
        kind: 'program',
        days: 'all',
        trigger: { type: 'sun', event: 'sunset', offsetMin: -45 },
        action: { type: 'look', look: 'philharmonic' },
        hold: { min: 90 },
      },
      {
        id: 'c_party_start',
        label: 'Party night ramp',
        // ambient (NOT program): sets the party look at party_night start but does
        // NOT take priority — so the night runs on AUTOPILOT and the mood cue
        // below can auto-fire calm->party from the audio analysis. A blocking
        // program here would suppress mood for the whole window.
        kind: 'ambient',
        days: 'all',
        trigger: { type: 'phase', phase: 'party_night' },
        action: { type: 'look', look: 'party' },
      },
      {
        id: 'c_mood_to_party',
        label: 'Follow the DJ: calm -> party',
        kind: 'mood',
        days: 'all',
        trigger: {
          type: 'mood', from: 'calm', to: 'party',
          minDwellSec: 20, cooldownSec: 300, whenPhase: 'party_night',
        },
        action: {
          type: 'playlist', name: 'default',
          autopilot: { active: true, delay_s: 30, shuffle: true },
        },
      },
      {
        id: 'c_sunrise',
        label: 'Sunrise wind-down',
        kind: 'program',
        days: 'all',
        trigger: { type: 'sun', event: 'sunrise', offsetMin: -15 },
        action: { type: 'look', look: 'sunrise' },
        hold: { min: 90 },
      },
      // ── day-specific (the special nights) ─────────────────────────────────
      {
        id: 'c_burn_night',
        label: 'Burn night spectacle',
        kind: 'program',
        days: [6],
        trigger: { type: 'sun', event: 'sunset', offsetMin: 90 },
        action: { type: 'look', look: 'burn_night' },
        hold: { min: 120 },
      },
      {
        id: 'c_temple',
        label: 'Temple burn — reverent',
        kind: 'program',
        days: [7],
        trigger: { type: 'sun', event: 'sunset', offsetMin: 60 },
        action: { type: 'look', look: 'temple' },
        hold: { min: 120 },
      },
    ],
  };
}
