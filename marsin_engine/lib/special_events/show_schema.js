/*
 * show_schema.js — load / validate / normalize a SPECIAL EVENT show YAML.
 *
 * A "special event" is a staged, one-button-per-step show the operator runs from
 * the CaptainPad Events tab (docs/52). Shows are SCENE-OWNED DATA, exactly like
 * playlists and timeline plans:
 *
 *     simulation/scenes/<scene>/special_events/<show_id>.yaml
 *
 * The operator authors a show by dropping a file in that directory. No UI code,
 * no engine code. The engine renders whatever validates.
 *
 * VALIDATION POSTURE — mirrors lib/timeline/show_plan.js (codex P0, fail loud):
 *   - throw-style: the FIRST invalid field throws an Error naming the exact
 *     path and what was wrong. There is no partial show and no coercion.
 *   - a file that exists but is broken is a LOUD, LISTED load error — never a
 *     silently-skipped file and never a half-loaded show.
 *   - cross-references that can be checked without the running rig (stage ids,
 *     choice ids, quick-effect ids, action shapes, effect ids) are checked HERE,
 *     at load. References that need the live rig (does this PLAYLIST exist in
 *     the scene? does the deck export this CONTROL?) are checked at ARM /
 *     FIRE time by the service, which owns those lookups.
 *
 * This module is PURE apart from the two fs reads at the bottom: no engine
 * imports, no state. That is what lets the unit suite exercise every refusal
 * without spawning an engine.
 */
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

/** The only schema version this loader understands. */
export const SHOW_SCHEMA_VERSION = 1;

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Ordered stages per show. A show is a thumb-driven column, not a program. */
export const MAX_STAGES = 12;
/** Variant buttons on a CHOICE stage (the pink/blue reveal is 2). */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;
/** Momentary pulse buttons shown alongside the current stage. */
export const MAX_QUICK_EFFECTS = 6;
/** Actions in one authored set — a stage fires a handful of things, not a plan. */
export const MAX_ACTIONS = 12;

/**
 * The action VERBS a show may use. Every one maps onto an engine internal that
 * already exists; none of them writes dimmers, mixer structure or scenes.
 *
 *   playlist    — activate a deck playlist (the operator's show content)
 *   control     — write / pulse one exported control on the LIVE deck pattern
 *   masterFade  — timed grand-master ramp (this is how a BLACKOUT stage works)
 *   globals     — shared ParamCenter writes (pin SPEED, etc.)
 *   effect      — a global effect PULSE (strobe burst, white flash, …)
 *
 * `pattern` is DELIBERATELY NOT a verb (see the refusal message in
 * validateAction): the operator's show model is playlist-driven, a single-entry
 * playlist IS a pattern plus its authored defaults, and the deck's direct
 * set-pattern path has no reusable internal to bind to.
 */
export const ACTION_TYPES = Object.freeze([
  'playlist', 'control', 'masterFade', 'globals', 'effect',
]);

/**
 * Global effects a show may pulse. Deliberately tiny and deliberately all
 * "cheap": every one is either a legacy on/off channel slam or a frame-locked
 * burst that ends itself. Anything with an envelope, a buffer or a safety tier
 * beyond WARNING stays out of show data.
 *
 *   strobe        frame-locked strobe BURST (hz + durationMs, self-terminating)
 *   vintageWhite  drives the VintageLed heads' white channel to 1.0
 *   blastWhite    slams EVERY channel (RGB + W + A) to 1.0 — "flash all white"
 *   uvBlast       the UV slam
 *   invert        global RGB invert
 *
 * The ids are the GLOBAL_EFFECT_LIBRARY ids; the unit suite pins that they all
 * still exist there, so a library rename can never leave a show pointing at a
 * ghost.
 */
export const EVENT_EFFECT_IDS = Object.freeze([
  'strobe', 'vintageWhite', 'blastWhite', 'uvBlast', 'invert',
]);

/** Legacy on/off effects — pulsed with `holdMs` or latched with `state`. */
export const EVENT_TOGGLE_EFFECT_IDS = Object.freeze(
  EVENT_EFFECT_IDS.filter((id) => id !== 'strobe'),
);

/**
 * The toggles that own a RELEASE envelope in the controller
 * (`RELEASABLE_EFFECTS`, global_effects_controller.js). `invert` is a
 * whole-frame filter with no boost to decay, so a release on it would be a
 * setting that does nothing — refused, not ignored.
 */
export const EVENT_RELEASABLE_EFFECT_IDS = Object.freeze(
  ['vintageWhite', 'blastWhite', 'uvBlast'],
);

/** Strobe burst bounds. `durationMs` is capped by MAX_BURST_MS in the controller. */
export const STROBE_HZ_MIN = 0.2;
export const STROBE_HZ_MAX = 25;
export const STROBE_BURST_MS_MAX = 2000;

/** An effect pulse may not latch the rig: bound the hold hard. */
export const EFFECT_HOLD_MS_MAX = 5000;

/**
 * FLASH RELEASE (docs/57 §2.3). A slam that ends on a frame boundary reads as a
 * glitch, so a show may author a soft exit on the effect's falling edge:
 *
 *   releaseMs  how long the boost ramps 1.0 → 0. Default 0 = the historical
 *              hard cut, so every show file written before this meant — and
 *              still means — exactly what it said.
 *   releaseTo  'show' (default) the flash decays and the running pattern rises
 *              through it; 'dark' the flash decays to black over whatever is
 *              underneath. `dark` is for a flash whose next state IS dark —
 *              pair it with a masterFade to 0, because at the end of the ramp
 *              the envelope retires and the content pops back.
 *
 * Bounded by the same 5000 ms the controller enforces on `vintageWhiteReleaseMs`
 * and this file enforces on a hold: a release is a tail, not a second show.
 */
export const EFFECT_RELEASE_MS_MAX = 5000;
export const EFFECT_RELEASE_TO = Object.freeze(['show', 'dark']);
export const EFFECT_RELEASE_TO_DEFAULT = 'show';

/** The strobe burst's own soft exit — the controller's `strobeFadingOut` blend. */
export const STROBE_FADE_OUT_MS_MAX = 5000;
/** A control pulse's falling edge. */
export const CONTROL_PULSE_MS_DEFAULT = 120;
export const CONTROL_PULSE_MS_MAX = 5000;
/** How far into a stage an authored action may be scheduled. */
export const ACTION_DELAY_MS_MAX = 60000;
/** Auto-advance / extension bounds (seconds). */
export const ADVANCE_SEC_MAX = 3600;
export const EXTEND_SEC_MAX = 3600;

/** Optional absolute show lease. Activity may refresh the timeline takeover,
 *  but it must never extend this show-authored hard stop. */
export const SHOW_LEASE_SEC_MIN = 60;
export const SHOW_LEASE_SEC_MAX = 21600;

// ── Stage AUTOPILOT (pattern rotation) bounds ───────────────────────────────
//
// A stage may rotate the patterns INSIDE the playlist it activated, on a timer,
// with a soft transition — the deck's AUTOPILOT PATTERNS behaviour, scoped to a
// show stage (operator, 2026-08-15: "an auto transition between those patterns
// that I can set the timer for in the UI … the deck auto pilot settings exactly
// no color"). COLOUR is deliberately absent: the Baby families are hard-coded
// RGB and the colour autopilot stays disarmed for the whole show.
//
// These bounds MIRROR the deck's own, on purpose, so a value the operator can
// dial on the deck is a value a stage can author:
//   everySec   ← the deck cadence (AUTOPILOT_TIMER_PRESETS_S tops out at 180 s,
//                but the field accepts the full advance window)
//   durationMs ← api_server's DECK_TRANSITION_MIN_MS / DECK_TRANSITION_MAX_MS.
//                Restated here because this module is PURE (no engine imports);
//                the engine suite pins the two against each other.
export const AUTOPILOT_EVERY_SEC_MIN = 1;
export const AUTOPILOT_EVERY_SEC_MAX = ADVANCE_SEC_MAX;
export const AUTOPILOT_TRANSITION_MS_MIN = 50;
export const AUTOPILOT_TRANSITION_MS_MAX = 30000;
/** The transition every Baby stage wants, and the deck's own default. */
export const AUTOPILOT_TRANSITION_MODE_DEFAULT = 'trans_crossfade';
/** Cadence used when a stage arms rotation without naming one. */
export const AUTOPILOT_EVERY_SEC_DEFAULT = 30;
export const AUTOPILOT_TRANSITION_MS_DEFAULT = 1000;
// GROUP LOCALITY — "keep swapping inside a window of adjacent playlist entries
// for N swaps, then move the window". Mirrors autopilot_pick.js's AUTO_GROUP_*
// (restated: this module is pure; the engine suite pins the pair).
export const AUTOPILOT_GROUP_SIZE_MIN = 2;
export const AUTOPILOT_GROUP_SIZE_MAX = 8;
export const AUTOPILOT_GROUP_SIZE_DEFAULT = 3;
export const AUTOPILOT_GROUP_DWELL_MIN = 1;
export const AUTOPILOT_GROUP_DWELL_MAX = 50;
export const AUTOPILOT_GROUP_DWELL_DEFAULT = 6;

/** Engine transition scripts are `patterns/transitions/trans_*.js`. */
const TRANSITION_MODE_RE = /^trans_[a-z0-9_]+$/;

// ── small throw-style validators ────────────────────────────────────────────

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function assertSlug(value, label) {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new Error(
      `${label} must be a slug /^[a-z0-9][a-z0-9_-]{0,63}$/, got ${JSON.stringify(value)}`);
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

function assertNumberInRange(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `${label} must be a finite number in [${min}, ${max}], got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A show/stage/choice accent colour. This is DATA the tab paints with (docs/52
 * §5 contrast-checks it against the dark surface at render). Optional; a
 * present-but-malformed value throws rather than silently rendering grey.
 */
function assertHexColor(value, label) {
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
    throw new Error(`${label} must be a '#RRGGBB' hex colour, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertNoUnknownKeys(obj, allowed, label) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${label} has unknown key '${key}' (allowed: ${allowed.join(', ')})`);
    }
  }
}

// ── actions ─────────────────────────────────────────────────────────────────

const ACTION_COMMON_KEYS = ['type', 'delayMs'];

/**
 * Validate + normalize ONE action.
 *
 * `delayMs` is an ABSOLUTE offset from the moment the action SET is dispatched
 * — not a gap from the previous action. Absolute offsets are what make the
 * reveal's "flash first, playlist under the flash" ordering readable in the
 * YAML, and validateActionList enforces that they never go backwards so the
 * authored order is always the execution order.
 *
 * @returns {object} normalized action
 */
export function validateAction(action, label) {
  if (!isPlainObject(action)) {
    throw new Error(`${label} must be an object, got ${JSON.stringify(action)}`);
  }
  if (action.type === 'pattern') {
    throw new Error(
      `${label}.type 'pattern' is not a special-event verb — use ` +
      "{ type: 'playlist', playlist: <name> }. A single-entry playlist IS a " +
      'pattern plus its authored defaults, and it is the path the deck, the ' +
      'timeline and this runner all share.');
  }
  if (typeof action.type !== 'string' || !ACTION_TYPES.includes(action.type)) {
    throw new Error(
      `${label}.type must be one of ${ACTION_TYPES.join(' | ')}, ` +
      `got ${JSON.stringify(action.type)}`);
  }
  let delayMs = 0;
  if (action.delayMs !== undefined) {
    delayMs = assertNumberInRange(action.delayMs, `${label}.delayMs`, 0, ACTION_DELAY_MS_MAX);
    if (!Number.isInteger(delayMs)) {
      throw new Error(`${label}.delayMs must be a whole number of ms, got ${action.delayMs}`);
    }
  }

  switch (action.type) {
    case 'playlist': {
      assertNoUnknownKeys(action, [...ACTION_COMMON_KEYS, 'playlist', 'entryId'], label);
      const playlist = assertSlug(action.playlist, `${label}.playlist`);
      let entryId = null;
      if (action.entryId !== undefined && action.entryId !== null) {
        entryId = assertString(action.entryId, `${label}.entryId`);
      }
      return { type: 'playlist', delayMs, playlist, entryId };
    }
    case 'control': {
      assertNoUnknownKeys(
        action, [...ACTION_COMMON_KEYS, 'control', 'value', 'pulse', 'pulseMs'], label);
      const control = assertString(action.control, `${label}.control`);
      const wantsPulse = action.pulse !== undefined;
      const wantsValue = action.value !== undefined;
      if (wantsPulse === wantsValue) {
        throw new Error(
          `${label} must set exactly one of 'value' (a steady write) or ` +
          "'pulse: true' (a rising-edge trigger)");
      }
      if (wantsPulse) {
        if (action.pulse !== true) {
          throw new Error(`${label}.pulse must be literally true, got ${JSON.stringify(action.pulse)}`);
        }
        let pulseMs = CONTROL_PULSE_MS_DEFAULT;
        if (action.pulseMs !== undefined) {
          pulseMs = assertNumberInRange(action.pulseMs, `${label}.pulseMs`, 1, CONTROL_PULSE_MS_MAX);
        }
        return { type: 'control', delayMs, control, value: null, pulse: true, pulseMs };
      }
      if (action.pulseMs !== undefined) {
        throw new Error(`${label}.pulseMs is only meaningful with 'pulse: true'`);
      }
      const value = assertNumberInRange(action.value, `${label}.value`, 0, 1);
      return { type: 'control', delayMs, control, value, pulse: false, pulseMs: null };
    }
    case 'masterFade': {
      assertNoUnknownKeys(action, [...ACTION_COMMON_KEYS, 'target', 'durationMs'], label);
      const target = assertNumberInRange(action.target, `${label}.target`, 0, 1);
      const durationMs = assertNumberInRange(
        action.durationMs, `${label}.durationMs`, 1, ACTION_DELAY_MS_MAX);
      return { type: 'masterFade', delayMs, target, durationMs };
    }
    case 'globals': {
      assertNoUnknownKeys(action, [...ACTION_COMMON_KEYS, 'set'], label);
      if (!isPlainObject(action.set) || Object.keys(action.set).length === 0) {
        throw new Error(`${label}.set must be a non-empty object of ParamCenter key → value`);
      }
      for (const [key, value] of Object.entries(action.set)) {
        assertString(key, `${label}.set key`);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(
            `${label}.set['${key}'] must be a finite number, got ${JSON.stringify(value)}`);
        }
      }
      return { type: 'globals', delayMs, set: { ...action.set } };
    }
    case 'effect':
      return validateEffectAction(action, label, delayMs);
    default:
      // Unreachable — the type check above is exhaustive. Kept so a future verb
      // added to ACTION_TYPES without a branch here fails loud instead of
      // silently normalizing to nothing.
      throw new Error(`${label}.type '${action.type}' has no validator`);
  }
}

function validateEffectAction(action, label, delayMs) {
  if (typeof action.effectId !== 'string' || !EVENT_EFFECT_IDS.includes(action.effectId)) {
    throw new Error(
      `${label}.effectId must be one of ${EVENT_EFFECT_IDS.join(' | ')}, ` +
      `got ${JSON.stringify(action.effectId)}`);
  }
  if (action.effectId === 'strobe') {
    assertNoUnknownKeys(
      action, [...ACTION_COMMON_KEYS, 'effectId', 'hz', 'durationMs', 'fadeOutMs', 'toggle'], label);
    const hz = action.hz === undefined
      ? 6
      : assertNumberInRange(action.hz, `${label}.hz`, STROBE_HZ_MIN, STROBE_HZ_MAX);
    if (action.toggle !== undefined) {
      assertBool(action.toggle, `${label}.toggle`);
      if (action.toggle !== true) {
        throw new Error(`${label}.toggle must be true when present`);
      }
      if (action.durationMs !== undefined || action.fadeOutMs !== undefined) {
        throw new Error(
          `${label} strobe toggle cannot also set durationMs or fadeOutMs — ` +
          'a toggle stays on until the next tap or show teardown');
      }
      return {
        type: 'effect', delayMs, effectId: 'strobe', hz,
        toggle: true, durationMs: null, fadeOutMs: 0,
      };
    }
    const durationMs = assertNumberInRange(
      action.durationMs, `${label}.durationMs`, 1, STROBE_BURST_MS_MAX);
    // The burst's soft exit. 0 (the default) is the snap-off every show file
    // written before this got, and still gets.
    const fadeOutMs = action.fadeOutMs === undefined
      ? 0
      : assertIntegerInRange(action.fadeOutMs, `${label}.fadeOutMs`, 0, STROBE_FADE_OUT_MS_MAX);
    return {
      type: 'effect', delayMs, effectId: 'strobe', hz,
      toggle: false, durationMs, fadeOutMs,
    };
  }
  assertNoUnknownKeys(
    action,
    [...ACTION_COMMON_KEYS, 'effectId', 'holdMs', 'state', 'releaseMs', 'releaseTo'],
    label);
  const wantsHold = action.holdMs !== undefined;
  const wantsState = action.state !== undefined;
  if (wantsHold === wantsState) {
    throw new Error(
      `${label} must set exactly one of 'holdMs' (a momentary PULSE — the effect ` +
      "releases itself) or 'state' (an explicit latch/unlatch)");
  }

  // ── the RELEASE envelope on the falling edge (docs/57 §2.3) ──────────────
  const releaseMs = action.releaseMs === undefined
    ? 0
    : assertIntegerInRange(action.releaseMs, `${label}.releaseMs`, 0, EFFECT_RELEASE_MS_MAX);
  if (releaseMs > 0 && !EVENT_RELEASABLE_EFFECT_IDS.includes(action.effectId)) {
    throw new Error(
      `${label}.releaseMs is set on '${action.effectId}', which has no release envelope ` +
      `(only ${EVENT_RELEASABLE_EFFECT_IDS.join(' | ')} decay). Drop the releaseMs`);
  }
  let releaseTo = EFFECT_RELEASE_TO_DEFAULT;
  if (action.releaseTo !== undefined) {
    if (typeof action.releaseTo !== 'string' || !EFFECT_RELEASE_TO.includes(action.releaseTo)) {
      throw new Error(
        `${label}.releaseTo must be one of ${EFFECT_RELEASE_TO.join(' | ')}, ` +
        `got ${JSON.stringify(action.releaseTo)}`);
    }
    // A target with no ramp is a statement with no mechanism. Refuse it rather
    // than silently doing the hard cut the author clearly did not ask for.
    if (releaseMs === 0) {
      throw new Error(
        `${label}.releaseTo is set but releaseMs is 0 — a release TARGET with no ` +
        'release does nothing. Give it a releaseMs (1..' + EFFECT_RELEASE_MS_MAX +
        ') or drop the releaseTo');
    }
    releaseTo = action.releaseTo;
  }

  if (wantsHold) {
    const holdMs = assertNumberInRange(action.holdMs, `${label}.holdMs`, 1, EFFECT_HOLD_MS_MAX);
    return {
      type: 'effect', delayMs, effectId: action.effectId, holdMs, state: null,
      releaseMs, releaseTo,
    };
  }
  const state = assertBool(action.state, `${label}.state`);
  // A RISING edge has no falling edge to soften. Authoring one here means the
  // author expected the latch to end itself, which it never does.
  if (state && releaseMs > 0) {
    throw new Error(
      `${label} sets 'state: true' AND a releaseMs — a latch ON has no release. ` +
      "Put the release on the action that turns it off ('state: false'), or use " +
      "'holdMs' for a pulse that releases itself");
  }
  return {
    type: 'effect', delayMs, effectId: action.effectId, holdMs: null, state,
    releaseMs, releaseTo,
  };
}

/** Validate an ordered action list: non-empty, bounded, non-decreasing delays. */
export function validateActionList(actions, label) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error(`${label} must be a non-empty array of actions`);
  }
  if (actions.length > MAX_ACTIONS) {
    throw new Error(`${label} has ${actions.length} actions (max ${MAX_ACTIONS})`);
  }
  const out = [];
  let lastDelay = 0;
  actions.forEach((raw, i) => {
    const action = validateAction(raw, `${label}[${i}]`);
    if (action.delayMs < lastDelay) {
      throw new Error(
        `${label}[${i}].delayMs (${action.delayMs}) goes BACKWARDS from the previous ` +
        `action's ${lastDelay} — delays are absolute offsets from the moment the set ` +
        'fires, so authored order must be execution order');
    }
    lastDelay = action.delayMs;
    out.push(action);
  });
  return out;
}

// ── stages ──────────────────────────────────────────────────────────────────

const STAGE_KEYS = [
  'id', 'label', 'color', 'ceremonial', 'hint',
  'actions', 'choices', 'advance', 'extend', 'quickEffects', 'autopilot',
];

// ── stage autopilot ─────────────────────────────────────────────────────────

/**
 * The AUTHORED default for a stage that does not mention `autopilot:` at all.
 *
 * `supported:false` is the load-bearing field, and it is NOT the same as
 * `active:false`. A stage that authors nothing offers the operator NO rotation
 * controls and the runner forces rotation OFF while it holds — a BLACKOUT must
 * never quietly keep swapping patterns behind a dark ship. A stage that authors
 * `autopilot: { active: false, … }` DOES get the controls, parked; the operator
 * can start rotation live from the tab. The difference is the whole point of
 * the flag, so it is explicit data rather than an inference from `active`.
 */
function stageAutopilotUnsupported() {
  return {
    supported: false,
    active: false,
    everySec: AUTOPILOT_EVERY_SEC_DEFAULT,
    shuffle: false,
    groupMode: false,
    groupSize: AUTOPILOT_GROUP_SIZE_DEFAULT,
    groupDwell: AUTOPILOT_GROUP_DWELL_DEFAULT,
    transition: {
      enabled: false,
      mode: AUTOPILOT_TRANSITION_MODE_DEFAULT,
      durationMs: AUTOPILOT_TRANSITION_MS_DEFAULT,
      shuffle: false,
    },
  };
}

/** Whole-number bound check — group size / dwell are counts, not durations. */
function assertIntegerInRange(value, label, min, max) {
  assertNumberInRange(value, label, min, max);
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateAutopilotTransition(raw, label) {
  const out = {
    enabled: false,
    mode: AUTOPILOT_TRANSITION_MODE_DEFAULT,
    durationMs: AUTOPILOT_TRANSITION_MS_DEFAULT,
    shuffle: false,
  };
  if (raw === undefined || raw === null) return out;
  if (!isPlainObject(raw)) {
    throw new Error(`${label} must be an object { enabled, mode, durationMs, shuffle }`);
  }
  assertNoUnknownKeys(raw, ['enabled', 'mode', 'durationMs', 'shuffle'], label);
  if (raw.enabled !== undefined) out.enabled = assertBool(raw.enabled, `${label}.enabled`);
  if (raw.shuffle !== undefined) out.shuffle = assertBool(raw.shuffle, `${label}.shuffle`);
  if (raw.mode !== undefined) {
    if (typeof raw.mode !== 'string' || !TRANSITION_MODE_RE.test(raw.mode)) {
      throw new Error(
        `${label}.mode must be a 'trans_*' transition script name ` +
        `(e.g. '${AUTOPILOT_TRANSITION_MODE_DEFAULT}'), got ${JSON.stringify(raw.mode)}`);
    }
    out.mode = raw.mode;
  }
  if (raw.durationMs !== undefined) {
    out.durationMs = assertNumberInRange(
      raw.durationMs, `${label}.durationMs`,
      AUTOPILOT_TRANSITION_MS_MIN, AUTOPILOT_TRANSITION_MS_MAX);
  }
  return out;
}

/**
 * Validate + normalize a stage's `autopilot:` block — the pattern-rotation
 * settings the operator can also drive live from the tab.
 *
 * Absent → `supported:false` (see stageAutopilotUnsupported). PRESENT and
 * malformed throws, exactly like every other field: a stage that MEANT to
 * rotate and silently did not is a dead tease in front of a crowd.
 */
export function validateStageAutopilot(raw, label) {
  if (raw === undefined || raw === null) return stageAutopilotUnsupported();
  if (!isPlainObject(raw)) {
    throw new Error(
      `${label} must be an object { active, everySec, shuffle, transition } ` +
      `(omit the key entirely for a stage that never rotates), got ${JSON.stringify(raw)}`);
  }
  assertNoUnknownKeys(
    raw,
    ['active', 'everySec', 'shuffle', 'groupMode', 'groupSize', 'groupDwell', 'transition'],
    label);
  return {
    supported: true,
    active: raw.active === undefined ? false : assertBool(raw.active, `${label}.active`),
    everySec: raw.everySec === undefined
      ? AUTOPILOT_EVERY_SEC_DEFAULT
      : assertNumberInRange(
        raw.everySec, `${label}.everySec`, AUTOPILOT_EVERY_SEC_MIN, AUTOPILOT_EVERY_SEC_MAX),
    shuffle: raw.shuffle === undefined ? false : assertBool(raw.shuffle, `${label}.shuffle`),
    groupMode: raw.groupMode === undefined
      ? false : assertBool(raw.groupMode, `${label}.groupMode`),
    groupSize: raw.groupSize === undefined
      ? AUTOPILOT_GROUP_SIZE_DEFAULT
      : assertIntegerInRange(
        raw.groupSize, `${label}.groupSize`,
        AUTOPILOT_GROUP_SIZE_MIN, AUTOPILOT_GROUP_SIZE_MAX),
    groupDwell: raw.groupDwell === undefined
      ? AUTOPILOT_GROUP_DWELL_DEFAULT
      : assertIntegerInRange(
        raw.groupDwell, `${label}.groupDwell`,
        AUTOPILOT_GROUP_DWELL_MIN, AUTOPILOT_GROUP_DWELL_MAX),
    transition: validateAutopilotTransition(raw.transition, `${label}.transition`),
  };
}

/**
 * Validate a LIVE autopilot patch off the wire (`POST
 * /special-events/autopilot`). Same field names, same bounds, same throw-style
 * as the authored block — one contract, so a value the operator can dial is
 * exactly a value a stage can author. Every key is optional; an empty patch is
 * refused rather than silently doing nothing.
 *
 * @returns {object} a SPARSE patch: only the keys the caller actually sent.
 */
export function validateAutopilotPatch(raw, label = 'autopilot') {
  if (!isPlainObject(raw)) {
    throw new Error(`${label} must be an object, got ${JSON.stringify(raw)}`);
  }
  assertNoUnknownKeys(
    raw,
    ['active', 'everySec', 'shuffle', 'groupMode', 'groupSize', 'groupDwell', 'transition'],
    label);
  const patch = {};
  if (raw.active !== undefined) patch.active = assertBool(raw.active, `${label}.active`);
  if (raw.everySec !== undefined) {
    patch.everySec = assertNumberInRange(
      raw.everySec, `${label}.everySec`, AUTOPILOT_EVERY_SEC_MIN, AUTOPILOT_EVERY_SEC_MAX);
  }
  if (raw.shuffle !== undefined) patch.shuffle = assertBool(raw.shuffle, `${label}.shuffle`);
  if (raw.groupMode !== undefined) patch.groupMode = assertBool(raw.groupMode, `${label}.groupMode`);
  if (raw.groupSize !== undefined) {
    patch.groupSize = assertIntegerInRange(
      raw.groupSize, `${label}.groupSize`,
      AUTOPILOT_GROUP_SIZE_MIN, AUTOPILOT_GROUP_SIZE_MAX);
  }
  if (raw.groupDwell !== undefined) {
    patch.groupDwell = assertIntegerInRange(
      raw.groupDwell, `${label}.groupDwell`,
      AUTOPILOT_GROUP_DWELL_MIN, AUTOPILOT_GROUP_DWELL_MAX);
  }
  if (raw.transition !== undefined) {
    if (!isPlainObject(raw.transition)) {
      throw new Error(`${label}.transition must be an object, got ${JSON.stringify(raw.transition)}`);
    }
    assertNoUnknownKeys(
      raw.transition, ['enabled', 'mode', 'durationMs', 'shuffle'], `${label}.transition`);
    // Re-run the FULL transition validator over the sparse sub-patch by
    // validating each present key on its own, so the bounds are stated once.
    const sub = {};
    for (const key of ['enabled', 'mode', 'durationMs', 'shuffle']) {
      if (raw.transition[key] !== undefined) sub[key] = raw.transition[key];
    }
    if (Object.keys(sub).length === 0) {
      throw new Error(`${label}.transition is empty — send at least one field or omit it`);
    }
    const checked = validateAutopilotTransition(sub, `${label}.transition`);
    patch.transition = {};
    for (const key of Object.keys(sub)) patch.transition[key] = checked[key];
  }
  if (Object.keys(patch).length === 0) {
    throw new Error(
      `${label} is empty — send at least one of active, everySec, shuffle, groupMode, ` +
      'groupSize, groupDwell, transition');
  }
  return patch;
}

function validateAdvance(advance, label) {
  if (advance === undefined || advance === 'manual') return { mode: 'manual', afterSec: null };
  if (!isPlainObject(advance)) {
    throw new Error(`${label} must be 'manual' or { afterSec: <seconds> }, got ${JSON.stringify(advance)}`);
  }
  assertNoUnknownKeys(advance, ['afterSec'], label);
  const afterSec = assertNumberInRange(advance.afterSec, `${label}.afterSec`, 0.001, ADVANCE_SEC_MAX);
  return { mode: 'timed', afterSec };
}

function validateExtend(extend, label, advanceMode) {
  if (extend === undefined || extend === null) return null;
  if (!isPlainObject(extend)) {
    throw new Error(`${label} must be an object { label, addSec } or { label, actions }`);
  }
  assertNoUnknownKeys(extend, ['label', 'addSec', 'actions'], label);
  const extendLabel = assertString(extend.label, `${label}.label`);
  const hasAdd = extend.addSec !== undefined;
  const hasActions = extend.actions !== undefined;
  if (hasAdd === hasActions) {
    throw new Error(
      `${label} must set exactly one of 'addSec' (extend a live countdown) or ` +
      "'actions' (fire an authored set again)");
  }
  if (hasAdd) {
    if (advanceMode !== 'timed') {
      throw new Error(
        `${label}.addSec extends a COUNTDOWN, but this stage advances manually — ` +
        "use 'actions' instead");
    }
    const addSec = assertNumberInRange(extend.addSec, `${label}.addSec`, 0.001, EXTEND_SEC_MAX);
    return { label: extendLabel, addSec, actions: null };
  }
  return { label: extendLabel, addSec: null, actions: validateActionList(extend.actions, `${label}.actions`) };
}

/**
 * Effects that may NOT appear on the operator's quick-effect chip row, however
 * they are wrapped (docs/57 §3, operator order: "remove the all white blast
 * from the UI").
 *
 * `blastWhite` slams every channel of every fixture on the ship to full. That
 * is a STAGED moment — the reveal, THE KISS — where it lands on a beat everyone
 * is waiting for and hides a playlist swap underneath. As a chip it is a
 * drummable full-rig whiteout sitting one thumb away at all times, which is not
 * what it is for.
 *
 * The refusal lives in the SCHEMA, not in CaptainPad: the Events tab is a pure
 * renderer of engine truth (docs/52 §5), so a UI filter would make the YAML lie
 * about what the operator can fire and the chip would reappear on any new
 * surface. `blastWhite` deliberately STAYS in EVENT_EFFECT_IDS — stage and
 * choice actions still use it, and that is exactly where it belongs.
 */
export const QUICK_EFFECT_FORBIDDEN_IDS = Object.freeze(['blastWhite']);

function assertQuickEffectActionsAllowed(actions, label) {
  actions.forEach((action, i) => {
    if (action.type !== 'effect') return;
    if (!QUICK_EFFECT_FORBIDDEN_IDS.includes(action.effectId)) return;
    throw new Error(
      `${label}[${i}].effectId '${action.effectId}' is not allowed as a QUICK EFFECT — ` +
      'the all-white slam is a staged moment, not a drummable chip. Put it in a ' +
      "stage's `actions:` (or a choice's), where it lands on cue and can hide a " +
      'playlist swap under it.');
  });
}

function validateQuickEffects(list, label) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`${label} must be an array`);
  if (list.length > MAX_QUICK_EFFECTS) {
    throw new Error(`${label} has ${list.length} entries (max ${MAX_QUICK_EFFECTS})`);
  }
  const seen = new Set();
  return list.map((raw, i) => {
    const qLabel = `${label}[${i}]`;
    if (!isPlainObject(raw)) throw new Error(`${qLabel} must be an object`);
    assertNoUnknownKeys(raw, ['id', 'label', 'color', 'actions'], qLabel);
    const id = assertSlug(raw.id, `${qLabel}.id`);
    if (seen.has(id)) throw new Error(`${qLabel}.id '${id}' is duplicated in this stage`);
    seen.add(id);
    const actions = validateActionList(raw.actions, `${qLabel}.actions`);
    assertQuickEffectActionsAllowed(actions, `${qLabel}.actions`);
    return {
      id,
      label: assertString(raw.label, `${qLabel}.label`),
      color: raw.color === undefined ? null : assertHexColor(raw.color, `${qLabel}.color`),
      actions,
    };
  });
}

function validateChoices(list, label) {
  if (!Array.isArray(list)) throw new Error(`${label} must be an array of variant buttons`);
  if (list.length < MIN_CHOICES || list.length > MAX_CHOICES) {
    throw new Error(
      `${label} must hold ${MIN_CHOICES}..${MAX_CHOICES} variants, got ${list.length}`);
  }
  const seen = new Set();
  return list.map((raw, i) => {
    const cLabel = `${label}[${i}]`;
    if (!isPlainObject(raw)) throw new Error(`${cLabel} must be an object`);
    assertNoUnknownKeys(raw, ['id', 'label', 'color', 'actions'], cLabel);
    const id = assertSlug(raw.id, `${cLabel}.id`);
    if (seen.has(id)) throw new Error(`${cLabel}.id '${id}' is duplicated in this stage`);
    seen.add(id);
    return {
      id,
      label: assertString(raw.label, `${cLabel}.label`),
      color: raw.color === undefined ? null : assertHexColor(raw.color, `${cLabel}.color`),
      actions: validateActionList(raw.actions, `${cLabel}.actions`),
    };
  });
}

function validateStage(raw, index, seenIds) {
  const label = `stages[${index}]`;
  if (!isPlainObject(raw)) throw new Error(`${label} must be an object`);
  assertNoUnknownKeys(raw, STAGE_KEYS, label);

  const id = assertSlug(raw.id, `${label}.id`);
  if (seenIds.has(id)) throw new Error(`${label}.id '${id}' is duplicated in this show`);
  seenIds.add(id);

  const hasActions = raw.actions !== undefined;
  const hasChoices = raw.choices !== undefined;
  if (hasActions === hasChoices) {
    throw new Error(
      `${label} must define exactly one of 'actions' (a plain stage) or ` +
      "'choices' (a CHOICE stage — the operator picks a variant at the button)");
  }

  const advance = validateAdvance(raw.advance, `${label}.advance`);

  return {
    id,
    label: assertString(raw.label, `${label}.label`),
    color: raw.color === undefined ? null : assertHexColor(raw.color, `${label}.color`),
    ceremonial: raw.ceremonial === undefined ? false : assertBool(raw.ceremonial, `${label}.ceremonial`),
    hint: raw.hint === undefined ? null : assertString(raw.hint, `${label}.hint`),
    kind: hasChoices ? 'choice' : 'action',
    actions: hasActions ? validateActionList(raw.actions, `${label}.actions`) : null,
    choices: hasChoices ? validateChoices(raw.choices, `${label}.choices`) : null,
    advance,
    extend: validateExtend(raw.extend, `${label}.extend`, advance.mode),
    quickEffects: validateQuickEffects(raw.quickEffects, `${label}.quickEffects`),
    autopilot: validateStageAutopilot(raw.autopilot, `${label}.autopilot`),
  };
}

// ── show ────────────────────────────────────────────────────────────────────

const SHOW_KEYS = [
  'schemaVersion', 'id', 'name', 'color', 'icon', 'description', 'leaseDurationSec', 'stages',
];

/**
 * Validate + normalize a whole show. THROWS on the first violation.
 *
 * @param {object} raw   parsed YAML
 * @param {string} [expectedId]  when the file name should own the id (loadShow)
 * @returns {object} the normalized show
 */
export function validateShow(raw, expectedId) {
  if (!isPlainObject(raw)) throw new Error('show must be a YAML mapping');
  assertNoUnknownKeys(raw, SHOW_KEYS, 'show');

  if (raw.schemaVersion !== SHOW_SCHEMA_VERSION) {
    throw new Error(
      `show.schemaVersion must be ${SHOW_SCHEMA_VERSION}, got ${JSON.stringify(raw.schemaVersion)}`);
  }
  const id = assertSlug(raw.id, 'show.id');
  if (expectedId !== undefined && id !== expectedId) {
    throw new Error(
      `show.id '${id}' does not match its file name '${expectedId}.yaml' — ` +
      'the file name is the id the tab and the API address the show by');
  }
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
    throw new Error('show.stages must be a non-empty array');
  }
  if (raw.stages.length > MAX_STAGES) {
    throw new Error(`show.stages has ${raw.stages.length} stages (max ${MAX_STAGES})`);
  }

  const seenIds = new Set();
  const stages = raw.stages.map((stage, i) => validateStage(stage, i, seenIds));

  return {
    schemaVersion: SHOW_SCHEMA_VERSION,
    id,
    name: assertString(raw.name, 'show.name'),
    color: raw.color === undefined ? null : assertHexColor(raw.color, 'show.color'),
    icon: raw.icon === undefined ? null : assertString(raw.icon, 'show.icon'),
    description: raw.description === undefined ? null : assertString(raw.description, 'show.description'),
    leaseDurationSec: raw.leaseDurationSec === undefined
      ? null
      : assertIntegerInRange(
        raw.leaseDurationSec, 'show.leaseDurationSec', SHOW_LEASE_SEC_MIN, SHOW_LEASE_SEC_MAX),
    stages,
  };
}

/**
 * Every playlist name a show can possibly activate, in first-referenced order.
 * The service validates these against the scene's real playlist library at ARM
 * — a missing one refuses the ARM and names what IS available.
 */
export function showPlaylistNames(show) {
  const names = [];
  const push = (actions) => {
    for (const a of actions || []) {
      if (a.type === 'playlist' && !names.includes(a.playlist)) names.push(a.playlist);
    }
  };
  for (const stage of show.stages) {
    push(stage.actions);
    for (const choice of stage.choices || []) push(choice.actions);
    if (stage.extend) push(stage.extend.actions);
    for (const quick of stage.quickEffects) push(quick.actions);
  }
  return names;
}

/**
 * A UI-facing summary of a show (the picker card + the stage column skeleton).
 * Carries no action internals — the tab never needs them and they would only be
 * a second place for the contract to drift.
 */
export function summarizeShow(show) {
  return {
    id: show.id,
    name: show.name,
    color: show.color,
    icon: show.icon,
    description: show.description,
    stageCount: show.stages.length,
    stages: show.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      color: stage.color,
      ceremonial: stage.ceremonial,
      hint: stage.hint,
      kind: stage.kind,
      choices: (stage.choices || []).map((c) => ({ id: c.id, label: c.label, color: c.color })),
      quickEffects: stage.quickEffects.map((q) => ({ id: q.id, label: q.label, color: q.color })),
      advance: { mode: stage.advance.mode, afterSec: stage.advance.afterSec },
      extend: stage.extend ? { label: stage.extend.label, kind: stage.extend.addSec ? 'time' : 'actions' } : null,
      // The AUTHORED rotation defaults. Carried on the summary (unlike action
      // internals) because the tab needs two things from it: whether to draw
      // the AUTOPILOT card for this stage at all (`supported`), and what the
      // show file asked for, so a live override can be shown as a change from
      // the author's intent and reset back to it.
      autopilot: { ...stage.autopilot, transition: { ...stage.autopilot.transition } },
    })),
  };
}

// ── disk ────────────────────────────────────────────────────────────────────

/**
 * Load ONE show file. Throws on a missing file, unparseable YAML, or any schema
 * violation — the caller decides whether that is fatal (ARM) or a listed load
 * error (the library scan).
 */
export function loadShow(filePath) {
  const base = path.basename(filePath, '.yaml');
  const text = fs.readFileSync(filePath, 'utf8');
  let raw;
  try {
    raw = yaml.load(text);
  } catch (err) {
    throw new Error(`unparseable YAML: ${err.message}`);
  }
  return validateShow(raw, base);
}

/**
 * Scan a scene's `special_events/` directory.
 *
 * A missing directory is NOT an error — a scene with no shows simply has none
 * (the tab renders an empty picker). A file that exists but does not validate
 * IS an error, and it is RETURNED rather than thrown: the tab must be able to
 * show every good show AND a red card naming each broken file. A broken file is
 * never loadable and never armable.
 *
 * @returns {{shows: object[], errors: {file: string, id: string, error: string}[]}}
 */
export function loadShowLibrary(dir) {
  if (!fs.existsSync(dir)) return { shows: [], errors: [] };
  const shows = [];
  const errors = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
  for (const file of files) {
    const id = file.slice(0, -'.yaml'.length);
    try {
      shows.push(loadShow(path.join(dir, file)));
    } catch (err) {
      errors.push({ file, id, error: err && err.message ? err.message : String(err) });
    }
  }
  const seen = new Set();
  for (const show of shows) {
    if (seen.has(show.id)) {
      throw new Error(`special_events: duplicate show id '${show.id}' in ${dir}`);
    }
    seen.add(show.id);
  }
  return { shows, errors };
}
