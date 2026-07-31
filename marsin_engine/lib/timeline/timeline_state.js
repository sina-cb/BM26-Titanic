/*
 * timeline_state.js — runtime state persistence for the Timeline Companion.
 * Runtime (assignment) state lives under marsin_engine/states/<scene>/ per
 * docs/38 §3.6, NOT versioned. Writes are atomic (temp file + renameSync) so a
 * crash mid-write never leaves a half-written state file.
 *
 * A MISSING file is the only non-error path → a fresh default state (boot must
 * always have a working runtime). The companion owns these fields; the pure
 * trigger evaluator (triggers.js) reads/returns the latch + mood bookkeeping.
 */
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

export const TIMELINE_STATE_FILE = 'timeline_state.yaml';

/**
 * Playlist a party session loads when the operator has never chosen one.
 * The plan's own `party_high` look points at the same name; this constant is
 * the ENGINE-side authority the party cue reads at fire time.
 */
export const PARTY_PLAYLIST_DEFAULT = 'party_high';

/**
 * Shipped session-handling numbers (report 20260725_12 §2 "Session numbers",
 * option A). Used ONLY to seed the persisted party config the first time, when
 * the active plan has no party cue to seed from. After seeding, party-config is
 * the single authority — the plan's own numbers are no longer read.
 */
export const PARTY_TIMING_DEFAULTS = Object.freeze({
  minDwellSec: 120,
  durationMin: 12,
  cooldownSec: 120,        // operator 2026-07-27: "keep it at 2 minutes for now"
});

/**
 * Bounds for the operator-editable session numbers. Outside ⇒ 400, nothing
 * applied (codex P0 — reject loudly, never clamp).
 */
export const PARTY_TIMING_BOUNDS = Object.freeze({
  minDwellSec: { min: 0, max: 3600 },
  durationMin: { min: 1, max: 120 },
  cooldownSec: { min: 0, max: 7200 },
});

/**
 * The two session-shape toggles. Both default TRUE.
 *
 *   durationEnabled:false ⇒ FOLLOW-THE-MUSIC: the session has no fixed length.
 *                           It runs until the party SIGNAL DROPS — and that drop
 *                           already embodies the detector's own `offConfirmMs`
 *                           (default 30 s of sustained absence), so there is
 *                           deliberately NO second timeline-side wait stacked on
 *                           top. ONE release sustain, and it lives in the
 *                           companion where the detection params belong.
 *                           There is NO cooldown at all after such a session.
 *   cooldownEnabled       ⇒ only meaningful while durationEnabled is true;
 *                           with duration off it is forced off.
 *
 * `minDwellSec` deliberately has NO toggle — sustain before a trigger is always
 * enforced (operator: "sustain should always be there for a strong detection").
 */
export const PARTY_TOGGLE_DEFAULTS = Object.freeze({
  durationEnabled: true,
  cooldownEnabled: true,
});

/**
 * Normalise the PARTY OVERRIDE fields out of a (possibly older) persisted
 * state object. A state file written before this feature has none of the keys —
 * that is a MIGRATION default, not a runtime fallback: the documented shipped
 * policy is "party mode armed, party_high playlist". A key that is present but
 * of the wrong TYPE is an authoring/corruption error and THROWS (codex P0), so
 * a hand-edited `partyEnabled: "no"` can never read as armed.
 *
 * The three TIMING fields read back as `null` until they are seeded (see
 * TimelineService._seedPartyTiming), so the seeding step can tell "never set"
 * from "the operator chose 0".
 *
 * @param {object} state — a loaded timeline state
 * @returns {{enabled:boolean, playlist:string,
 *            minDwellSec:number|null, durationMin:number|null, cooldownSec:number|null}}
 */
export function partyConfigOf(state) {
  const s = state || {};
  if (s.partyEnabled !== undefined && typeof s.partyEnabled !== 'boolean') {
    throw new TypeError(
      `timeline state partyEnabled must be a boolean, got ${JSON.stringify(s.partyEnabled)}`);
  }
  if (s.partyPlaylist !== undefined && s.partyPlaylist !== null
    && (typeof s.partyPlaylist !== 'string' || !s.partyPlaylist.trim())) {
    throw new TypeError(
      `timeline state partyPlaylist must be a non-empty string, got ${JSON.stringify(s.partyPlaylist)}`);
  }
  const timing = {};
  for (const key of Object.keys(PARTY_TIMING_BOUNDS)) {
    const field = `party${key[0].toUpperCase()}${key.slice(1)}`;
    const v = s[field];
    if (v === undefined || v === null) { timing[key] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(
        `timeline state ${field} must be a finite number, got ${JSON.stringify(v)}`);
    }
    timing[key] = v;
  }
  const toggles = {};
  for (const key of Object.keys(PARTY_TOGGLE_DEFAULTS)) {
    const field = `party${key[0].toUpperCase()}${key.slice(1)}`;
    const v = s[field];
    if (v === undefined || v === null) { toggles[key] = PARTY_TOGGLE_DEFAULTS[key]; continue; }
    if (typeof v !== 'boolean') {
      throw new TypeError(`timeline state ${field} must be a boolean, got ${JSON.stringify(v)}`);
    }
    toggles[key] = v;
  }
  return {
    enabled: s.partyEnabled === undefined ? true : s.partyEnabled,
    playlist: (s.partyPlaylist === undefined || s.partyPlaylist === null)
      ? PARTY_PLAYLIST_DEFAULT : s.partyPlaylist,
    ...timing,
    ...toggles,
  };
}

// `mode` ∈ armed | overridden. PAUSE and HOLD were removed (2026-07-03
// simplification): the only operator interruption of a running plan is a
// TEMPORARY TAKE OVER ('overridden'), which always auto-resumes via its lease.
export function defaultTimelineState() {
  return {
    activePlan: null,
    mode: 'armed',
    // Control-precedence layer (docs/38 §14): autopilot is the baseline,
    // controller is the derived active layer, activeProgram is the running show.
    autopilotEnabled: true,
    controller: 'autopilot',
    activeProgram: null,
    // Pending-program lease (docs/38 §16.5): when a program comes due while the
    // controller is in any MANUAL sub-state, a lease is ARMED instead of firing.
    // null = no lease. Armed shape:
    //   { cueId, label, action, armedAtMs, expiresAtMs }
    // The lease auto-starts the program at expiresAtMs (show goes on, I2), or the
    // operator ENABLEs (start now) / DISMISSes (cancel, latch firedToday) it.
    pendingProgram: null,
    // Operator-takeover lease (docs/38 §16): non-null WHILE the operator holds
    // manual control of an active plan. null = no lease. Armed shape:
    //   { expiresAtMs }
    // The plan auto-resumes at expiresAtMs (runs catchUp at the wall-clock time
    // of release). RUNTIME state — dropped on boot, never resumed stale.
    operatorLease: null,
    currentPhase: null,
    currentMood: 'calm',
    lastFiredCueId: null,
    lastFiredAtMs: null,
    firedToday: {},
    dayKey: null,
    prevMood: null,
    moodSince: 0,
    moodLastFire: {},
    // ── PARTY OVERRIDE (operator authority, 2026-07-27) ────────────────────
    // SHOW POLICY, never sensing. `partyEnabled:false` means a mood→party cue
    // CANNOT fire, and a live party session ends immediately (the deck returns
    // to the default cue). The DETECTOR keeps running and publishing
    // `audioPartyStrong` the whole time — the companion's PARTY meters stay
    // live while the show policy says "no party tonight".
    //
    // `partyPlaylist` is the playlist a party cue loads AT FIRE TIME: it
    // overrides the plan look's own `playlist` so changing it takes effect for
    // the NEXT session without editing (or reloading) the plan.
    //
    // Persisted here so an operator who disabled party mode STAYS disabled
    // across a supervisor restart.
    partyEnabled: true,
    // `null` = NEVER SEEDED (same rule as the timing numbers below): on first
    // plan load the service copies the plan's own party-look playlist in, so an
    // existing plan is never silently repointed at a playlist it doesn't name.
    partyPlaylist: null,
    // Session-handling numbers. `null` = NEVER SEEDED: on first plan load the
    // service copies the active plan's party-cue numbers in (or the shipped
    // defaults when the plan has no party cue), and from then on THIS is the
    // single authority — the plan YAML's copies are no longer read, so there is
    // no dual authority to drift.
    partyMinDwellSec: null,
    partyDurationMin: null,
    partyCooldownSec: null,
    // Session SHAPE toggles (see PARTY_TOGGLE_DEFAULTS). durationEnabled:false
    // is FOLLOW-THE-MUSIC — no fixed length, no cooldown, ends when the party
    // signal drops (which already carries the detector's offConfirmMs).
    partyDurationEnabled: true,
    partyCooldownEnabled: true,
  };
}

/**
 * Load runtime state from <stateDir>/timeline_state.yaml. A missing file →
 * a fresh default state. A present-but-broken file THROWS (codex P0).
 *
 * @param {string} stateDir
 */
export function loadTimelineState(stateDir) {
  const filePath = path.join(stateDir, TIMELINE_STATE_FILE);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return defaultTimelineState();
    throw new Error(`timeline state read failed (${filePath}): ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new Error(`timeline state parse failed (${filePath}): ${err.message}`);
  }
  if (parsed === null || parsed === undefined) return defaultTimelineState();
  // D11: validate the PERSISTED party fields ONCE, here, and refuse to load a
  // corrupt file — exactly what a broken YAML already does two lines up. Before
  // this, a hand-edited `partyEnabled: "no"` parsed fine and then threw inside
  // EVERY tick (86 k unthrottled log lines/day) while the WHOLE timeline — clock
  // cues, sun cues, default-cue reconcile — was dead and the engine looked
  // healthy. One loud error at boot naming the file and the field instead.
  try {
    partyConfigOf(parsed);
  } catch (err) {
    throw new Error(`timeline state invalid (${filePath}): ${err.message}`);
  }
  return parsed;
}

/**
 * Persist runtime state atomically: write to <file>.tmp then renameSync over
 * the target (rename is atomic on the same filesystem). Creates the state dir
 * if it does not yet exist.
 *
 * @param {object} state
 * @param {string} stateDir
 */
export function saveTimelineState(state, stateDir) {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, TIMELINE_STATE_FILE);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, yaml.dump(state, { lineWidth: 100, noRefs: true }), 'utf8');
  fs.renameSync(tmpPath, filePath);
  return state;
}
