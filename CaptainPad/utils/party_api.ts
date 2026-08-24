// party_api — PARTY MODE handling contract (engine :6968) + the pure helpers
// the TIMELINE tab's PARTY MODE card renders.
//
// Division of concerns (operator, 2026-07-27): the Audio Companion configures
// DETECTION (thresholds/params); CaptainPad's TIMELINE tab owns HANDLING —
// the hard disable, the trigger playlist, and the session numbers. This module
// is the client for that handling authority.
//
// Wire contract (owned by the engine side, 2026-07-27, extended same day):
//   GET  /party-config → { enabled, playlist, availablePlaylists,
//                          minDwellSec, durationEnabled, durationMin,
//                          cooldownEnabled, cooldownSec, effectiveState? }
//   PUT  /party-config  partial { enabled?, playlist?, minDwellSec?,
//                          durationEnabled?, durationMin?, cooldownEnabled?,
//                          cooldownSec? } → full new state,
//                          or 400 { error } on an invalid request.
//
// Semantics: DISABLE kills any active party session immediately and blocks
// triggering (the detector keeps running); playlist + the session numbers take
// effect on the NEXT session.
//
// Session-length modes (operator, 2026-07-27):
//   - `minDwellSec` (SUSTAIN) is the strong-detection guarantee and is ALWAYS
//     in play — it has no toggle.
//   - `durationEnabled` ON  → a session runs for a FIXED `durationMin`.
//   - `durationEnabled` OFF → FOLLOW-THE-MUSIC: the session ends when the
//     party signal DROPS. There is NO second timeline-side release value —
//     the release IS the companion's `offConfirmMs` detection param (one
//     sustain, not two stacked), tuned in the Audio Companion.
//   - `cooldownEnabled` has its own toggle, BUT a disabled duration forces
//     cooldown fully off ("no cooldown in follow-the-music mode"). The
//     effective value is computed by describePartyRows() from the GET's own
//     fields so the UI can never disagree with the engine.
//
// Codex P0: a rejected PUT surfaces the engine's error VERBATIM and the UI
// reconciles back to the real server state — never a silent revert, never an
// optimistic value left standing on failure.

import { ApiResult, fetchWithTimeout } from './api';
import { getApiBaseAsync } from './apiBase';

/** Engine-computed handling state, when the GET provides it. */
export type PartyEffectiveState =
  | 'armed' | 'disabled' | 'no_plan' | 'manual' | 'waiting_window' | 'in_session' | 'cooldown';

const EFFECTIVE_STATES: PartyEffectiveState[] =
  ['armed', 'disabled', 'no_plan', 'manual', 'waiting_window', 'in_session', 'cooldown'];

export interface PartyConfig {
  enabled: boolean;
  playlist: string;
  availablePlaylists: string[];
  /**
   * Sustained detection required before a session starts, in seconds. The
   * strong-detection guarantee — always in force, never toggled off.
   */
  minDwellSec: number;
  /** Follow-the-music mode — the companion's offConfirmMs ends the session. */
  durationEnabled: boolean;
  /** Fixed session length, in minutes. Used only when durationEnabled. */
  durationMin: number;
  /** Operator's cooldown toggle. Forced off engine-side when duration is off. */
  cooldownEnabled: boolean;
  /** Lockout after a session ends before another may trigger, in seconds. */
  cooldownSec: number;
  /** Engine's own verdict; absent on engines that don't compute it yet. */
  effectiveState?: PartyEffectiveState;

  // ── Engine-computed live view (2026-07-27 contract addition). All OPTIONAL
  // so a pre-addition engine still parses; where present these are AUTHORITY
  // and the card prefers them over any client-side derivation.
  /** Session length the engine would actually use. */
  effectiveDurationMin?: number;
  /** Whether a cooldown actually applies right now (already accounts for
   *  follow-the-music mode forcing it off). */
  effectiveCooldownEnabled?: boolean;
  /** Cooldown length the engine would actually apply. */
  effectiveCooldownSec?: number;
  /** True while the RUNNING session is follow-the-music; null when idle. */
  sessionFollowsMusic?: boolean | null;
  /** Operator-forced session ignores the detector until RETURN TO LIVE AUDIO. */
  sessionForced?: boolean;
  /** Epoch ms a fixed-duration session ends; null when idle / follow-the-music. */
  sessionEndsAtMs?: number | null;
  /** Seconds left in the cooldown lockout; 0 when clear. */
  cooldownRemainingSec?: number;
  /** Timeline plan running right now. */
  planActive?: boolean;
  /** Today falls inside the plan's festival span. */
  inFestivalWindow?: boolean;
  /** True only while the authored Party Window is open. */
  partyWindowOpen?: boolean;
  /** Plan cue the party session fires (informational). */
  partyCueId?: string | null;
  /**
   * The party cue's LAST DISPATCH ERROR (e.g. a missing playlist), or null when
   * clean. A cue that threw leaves the trigger latch down with no session and,
   * before _356, no visible reason — this is that reason (_356 F6/P0-2).
   */
  cueError?: string | null;
  /** Epoch ms the authored Party Window next opens; null when the engine has none. */
  partyWindowOpensAtMs?: number | null;
  /** Epoch ms the authored Party Window closes; null when the engine has none. */
  partyWindowClosesAtMs?: number | null;
  /**
   * Engine mood-input health: true means the companion stopped publishing and
   * the calm fallback is intentionally holding. Also on /timeline/state, which
   * is where the card reads it from on an engine that omits it here.
   */
  moodStale?: boolean;
  /** The exact hard signal Timeline consumes (`audioPartyStrong`). */
  strongSignal?: boolean;
  /** Seconds the hard signal has continuously held. */
  sustainHeldSec?: number;
  /** Required continuous hold before the cue may fire. */
  sustainRequiredSec?: number;
  /** Normalized 0..1 progress through the current sustain. */
  sustainProgress?: number;
  /** Seconds the debounced Party signal has been absent during a live session. */
  signalLossHeldSec?: number;
  /** Fixed grace period before a fixed-duration session ends early. */
  signalLossRequiredSec?: number;
  /** Normalized 0..1 progress through the signal-loss grace period. */
  signalLossProgress?: number;
  /** Engine-authored readiness facts; presentation never re-invents them. */
  readiness?: {
    enabled: boolean;
    planActive: boolean;
    partyWindowOpen: boolean;
    planDriving: boolean;
    triggerArmed: boolean | null;
    cooldownClear: boolean;
  };
}

/** Partial update body for PUT /party-config. */
export interface PartyConfigPatch {
  enabled?: boolean;
  playlist?: string;
  minDwellSec?: number;
  durationEnabled?: boolean;
  durationMin?: number;
  cooldownEnabled?: boolean;
  cooldownSec?: number;
}

/** Numeric fields the card edits with steppers. */
export type PartyNumericField = 'minDwellSec' | 'durationMin' | 'cooldownSec';

/**
 * Client-side stepper bounds. These are UI ergonomics (how far one tap moves,
 * what the buttons refuse to exceed) — the ENGINE is still the validator, and
 * a rejected value surfaces its 400 verbatim.
 */
export const PARTY_FIELD_BOUNDS: Record<PartyNumericField, { min: number; max: number; step: number }> = {
  minDwellSec: { min: 0, max: 1800, step: 15 },       // 0 – 30 min, 15 s taps
  durationMin: { min: 1, max: 180, step: 1 },         // 1 – 180 min, 1 min taps
  cooldownSec: { min: 0, max: 7200, step: 60 },       // 0 – 120 min, 1 min taps
};

/** One stepper tap: `dir` is -1 / +1. Clamped to the field's bounds. */
export function stepPartyField(field: PartyNumericField, current: number, dir: -1 | 1): number {
  const b = PARTY_FIELD_BOUNDS[field];
  const next = current + dir * b.step;
  // Snap onto the step grid so a hand-set odd value (e.g. 130 s) lands on a
  // clean multiple after one tap instead of carrying the offset forever.
  const snapped = Math.round(next / b.step) * b.step;
  return Math.min(b.max, Math.max(b.min, snapped));
}

/** Seconds → "m:ss" (dwell / cooldown readouts). */
export function formatMinSec(totalSec: number): string {
  const t = Math.max(0, Math.round(totalSec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Seconds → "N min" (cooldown, which the operator thinks of in minutes). */
export function formatMinutes(totalSec: number): string {
  const mins = Math.max(0, totalSec) / 60;
  const rounded = Math.round(mins * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} min`;
}

export type PartyTimerTone = 'active' | 'ready' | 'waiting' | 'off';

export interface PartyTimerReadout {
  id: 'sustain' | 'party' | 'cooldown';
  label: string;
  value: string;
  detail: string;
  tone: PartyTimerTone;
}

/** Three mutually honest clocks: each counts only while that stage is live. */
export function partyTimerReadouts(config: PartyConfig, nowMs: number): PartyTimerReadout[] {
  const state = config.effectiveState;
  const required = Math.max(0, config.sustainRequiredSec ?? config.minDwellSec);
  const held = Math.min(required, Math.max(0, config.sustainHeldSec ?? 0));
  const readiness = config.readiness;
  const canSustain = state === 'armed'
    && config.strongSignal === true
    && readiness?.enabled === true
    && readiness.planActive === true
    && readiness.partyWindowOpen === true
    && readiness.planDriving === true
    && readiness.triggerArmed === true
    && readiness.cooldownClear === true;

  let sustain: PartyTimerReadout;
  if (state === 'in_session') {
    if (config.sessionForced === true) {
      sustain = {
        id: 'sustain',
        label: 'LIVE AUDIO',
        value: 'FORCED',
        detail: 'SIGNAL IGNORED',
        tone: 'active',
      };
    } else if (config.sessionFollowsMusic === true) {
      sustain = {
        id: 'sustain',
        label: 'TIMELINE RELEASE',
        value: 'FOLLOWS SIGNAL',
        detail: 'AFTER COMPANION RELEASE',
        tone: 'ready',
      };
    } else if (config.signalLossRequiredSec === undefined) {
      sustain = {
        id: 'sustain',
        label: 'TIMELINE RELEASE',
        value: 'UNAVAILABLE',
        detail: 'ENGINE STATUS MISSING',
        tone: 'off',
      };
    } else if (config.strongSignal === false) {
      const releaseRemaining = Math.max(
        0,
        config.signalLossRequiredSec - (config.signalLossHeldSec ?? 0),
      );
      sustain = {
        id: 'sustain',
        label: 'TIMELINE RELEASE',
        value: `${formatMinSec(releaseRemaining)} LEFT`,
        detail: 'AFTER DETECTOR OFF',
        tone: 'active',
      };
    } else {
      sustain = {
        id: 'sustain',
        label: 'TIMELINE RELEASE',
        value: 'READY',
        detail: `${formatMinSec(config.signalLossRequiredSec)} AFTER DETECTOR`,
        tone: 'ready',
      };
    }
  } else if (canSustain) {
    const remaining = Math.max(0, required - held);
    sustain = {
      id: 'sustain',
      label: 'TIMELINE SUSTAIN',
      value: remaining === 0 ? 'READY' : `${formatMinSec(remaining)} LEFT`,
      detail: `${formatMinSec(held)} OF ${formatMinSec(required)}`,
      tone: remaining === 0 ? 'ready' : 'active',
    };
  } else {
    const detail = state === 'cooldown'
      ? 'WAITS FOR COOLDOWN'
      : readiness?.partyWindowOpen === false
        ? 'WAITS FOR WINDOW'
        : config.strongSignal !== true
          ? 'WAITS FOR SIGNAL'
          : 'NOT ARMED';
    sustain = {
      id: 'sustain',
      label: 'TIMELINE SUSTAIN',
      value: 'WAITING',
      detail,
      tone: 'waiting',
    };
  }

  let party: PartyTimerReadout;
  if (state !== 'in_session') {
    party = { id: 'party', label: 'PARTY TIME', value: 'WAITING', detail: 'STARTS AFTER SUSTAIN', tone: 'waiting' };
  } else if (config.sessionFollowsMusic === true) {
    party = { id: 'party', label: 'PARTY TIME', value: 'LIVE', detail: 'FOLLOWS MUSIC', tone: 'active' };
  } else {
    const remainingSec = config.sessionEndsAtMs === null || config.sessionEndsAtMs === undefined
      ? 0
      : Math.max(0, Math.ceil((config.sessionEndsAtMs - nowMs) / 1000));
    party = {
      id: 'party',
      label: 'PARTY TIME',
      value: `${formatMinSec(remainingSec)} LEFT`,
      detail: `${config.effectiveDurationMin ?? config.durationMin} MIN SESSION`,
      tone: 'active',
    };
  }

  const cooldownEnabled = config.effectiveCooldownEnabled ?? (
    config.durationEnabled && config.cooldownEnabled
  );
  let cooldown: PartyTimerReadout;
  if (!cooldownEnabled) {
    cooldown = { id: 'cooldown', label: 'COOLDOWN', value: 'OFF', detail: 'NO LOCKOUT', tone: 'off' };
  } else if (state === 'cooldown') {
    cooldown = {
      id: 'cooldown',
      label: 'COOLDOWN',
      value: `${formatMinSec(config.cooldownRemainingSec ?? 0)} LEFT`,
      detail: 'NEXT PARTY LOCKED',
      tone: 'active',
    };
  } else {
    cooldown = {
      id: 'cooldown',
      label: 'COOLDOWN',
      value: 'READY',
      detail: `${formatMinSec(config.effectiveCooldownSec ?? config.cooldownSec)} AFTER PARTY`,
      tone: 'ready',
    };
  }
  return [sustain, party, cooldown];
}

// ── Readiness chips (_356 §4) ────────────────────────────────────────────
// PURE, and deliberately fed ONLY by engine-authored fields. The chip row is
// the operator's answer to "why is party not firing", so a chip computed from
// `currentPhase`, a ribbon segment, `atLocal`, or any pad-local flag is worse
// than no chip at all: those disagree with the evaluator across midnight
// (_356 F2) and the row then lies with full confidence.
//
// Tones: 'ready' = the condition is met; 'alert' = it blocks party (red);
// 'neutral' = normal but not met (nothing is wrong); 'live' = a session is
// running right now.

export type PartyChipTone = 'ready' | 'alert' | 'neutral' | 'live';

export type PartyChipId =
  | 'plan' | 'deck' | 'window' | 'partyOn' | 'signal' | 'session' | 'cooldown';

export interface PartyReadinessChip {
  id: PartyChipId;
  /** Chip copy exactly as rendered, e.g. "× WINDOW · opens 21:00". */
  text: string;
  tone: PartyChipTone;
}

export interface PartyChipOptions {
  /**
   * Engine mood-input health. Read from `/party-config.moodStale` when the
   * engine sends it, else `/timeline/state.moodStale`. Absent/null means the
   * engine did not say — the chip then reports the signal only.
   */
  moodStale?: boolean | null;
  /**
   * IANA plan timezone, for the "opens HH:MM" detail. Null/absent means we
   * cannot name a wall-clock time and the chip omits it rather than printing
   * the pad's own device time, which is wrong off-playa.
   */
  planTz?: string | null;
  /**
   * Clock for "is that opening TODAY?" — pass the card's tick. Absent means we
   * cannot tell today from tomorrow, so the chip keeps the WEEKDAY (the form
   * that is never ambiguous) rather than printing a bare time that reads as
   * "today" when it is not.
   */
  nowMs?: number | null;
}

/** Epoch ms → "HH:MM" in the plan tz. Null when the tz or the instant is unusable. */
export function formatPartyClock(atMs: number | null | undefined, tz: string | null | undefined): string | null {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || !tz) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(atMs));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    let hour = Number(get('hour'));
    const minute = get('minute');
    if (hour === 24) hour = 0;
    if (Number.isNaN(hour) || !minute) return null;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  } catch {
    // A malformed tz makes Intl throw. Say nothing rather than device-local.
    return null;
  }
}

/** 'YYYY-MM-DD' calendar day of `atMs` in `tz`. Null when Intl refuses the tz. */
function partyTzDateKey(atMs: number, tz: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(atMs));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const [y, m, d] = [get('year'), get('month'), get('day')];
    if (!y || !m || !d) return null;
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

/** Short weekday of `atMs` in `tz` ("Mon"). Null when Intl refuses the tz. */
function partyTzWeekday(atMs: number, tz: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .formatToParts(new Date(atMs));
    return parts.find((p) => p.type === 'weekday')?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Epoch ms → "HH:MM" in the plan tz, prefixed with the short WEEKDAY whenever
 * that instant is NOT on the same plan-tz calendar day as `nowMs` — "Mon 09:00".
 *
 * A bare "opens 09:00" on a window that actually opens TOMORROW morning reads as
 * "in a few minutes" to an operator standing in front of the ship at 09:23, so
 * the day is part of the answer, not decoration (bug, 2026-08-23). With no
 * `nowMs` we cannot tell the two apart and keep the weekday: unambiguous either
 * way. Null when the tz or the instant is unusable — say nothing rather than
 * print the pad's own device day.
 */
export function formatPartyClockOnDay(
  atMs: number | null | undefined,
  tz: string | null | undefined,
  nowMs?: number | null,
): string | null {
  const clock = formatPartyClock(atMs, tz);
  if (clock === null || !tz || typeof atMs !== 'number') return null;
  const atKey = partyTzDateKey(atMs, tz);
  const nowKey = typeof nowMs === 'number' && Number.isFinite(nowMs)
    ? partyTzDateKey(nowMs, tz)
    : null;
  if (atKey !== null && nowKey !== null && atKey === nowKey) return clock;
  const weekday = partyTzWeekday(atMs, tz);
  return weekday ? `${weekday} ${clock}` : clock;
}

function chip(id: PartyChipId, text: string, tone: PartyChipTone): PartyReadinessChip {
  return { id, text, tone };
}

function markChip(id: PartyChipId, label: string, ready: boolean): PartyReadinessChip {
  return chip(id, `${ready ? '✓' : '×'} ${label}`, ready ? 'ready' : 'alert');
}

/**
 * The PARTY card's readiness row. Returns [] when the engine sent no
 * `readiness` block — an engine that cannot answer gets no row, not a row of
 * guesses.
 */
export function partyReadinessChips(
  config: PartyConfig,
  options: PartyChipOptions = {},
): PartyReadinessChip[] {
  const readiness = config.readiness;
  if (!readiness) return [];
  const inSession = config.effectiveState === 'in_session';
  const forced = config.sessionForced === true;
  const cueError = config.cueError || null;
  const moodStale = config.moodStale ?? options.moodStale ?? null;

  // PLAN / DECK were the SAME boolean before _356 F8: "plan is on and in its
  // festival days" is a different fact from "the Timeline actually owns the
  // deck", and only the second one is broken by a takeover.
  const chips: PartyReadinessChip[] = [
    markChip('plan', 'PLAN', readiness.planActive),
    markChip('deck', 'DECK', readiness.planDriving),
  ];

  // WINDOW. A forced session deliberately ignores the window, so a red ✗ there
  // would be a false alarm — say BYPASSED and stay neutral.
  if (forced) {
    chips.push(chip('window', '· WINDOW BYPASSED', 'neutral'));
  } else if (readiness.partyWindowOpen) {
    chips.push(markChip('window', 'WINDOW', true));
  } else {
    const opensAt = formatPartyClockOnDay(
      config.partyWindowOpensAtMs,
      options.planTz,
      options.nowMs,
    );
    chips.push(chip('window', opensAt ? `× WINDOW · opens ${opensAt}` : '× WINDOW', 'alert'));
  }

  // PARTY ON is the operator's policy toggle. It was labelled DETECTOR, which
  // is the COMPANION's job — detector health lives in the detector panel.
  chips.push(markChip('partyOn', 'PARTY ON', readiness.enabled));

  // SIGNAL is the exact input the evaluator sees (the stale-guarded mood).
  // Calm is normal, not a fault; STALE is the fault.
  if (moodStale === true) {
    chips.push(chip('signal', '× SIGNAL STALE', 'alert'));
  } else if (config.strongSignal === true) {
    chips.push(chip('signal', '✓ SIGNAL', 'ready'));
  } else {
    chips.push(chip('signal', '× SIGNAL', 'neutral'));
  }

  // SESSION replaces ARMED. The arm latch can only move on a session start/end
  // or a dispatch error, so those are the only three things it may report —
  // and red is reserved for the error (_356 F6).
  if (cueError) {
    chips.push(chip('session', '× SESSION ERROR', 'alert'));
  } else if (inSession) {
    chips.push(chip('session', '· SESSION LIVE', 'live'));
  } else if (readiness.triggerArmed === true) {
    chips.push(chip('session', '✓ SESSION ARMED', 'ready'));
  } else if (readiness.triggerArmed === null) {
    chips.push(chip('session', '× SESSION NO CUE', 'neutral'));
  } else {
    chips.push(chip('session', '× SESSION', 'neutral'));
  }

  if (readiness.cooldownClear) {
    chips.push(markChip('cooldown', 'COOLDOWN', true));
  } else {
    const left = config.cooldownRemainingSec;
    chips.push(chip(
      'cooldown',
      typeof left === 'number' && left > 0 ? `× COOLDOWN · ${formatMinSec(left)}` : '× COOLDOWN',
      'alert',
    ));
  }
  return chips;
}

// ── Button enablement (_356 §3 P0-4) ─────────────────────────────────────
// PURE, and the ONLY place the card decides what is pressable. Before _356
// both session buttons rendered enabled in every state, so RETURN TO LIVE
// AUDIO looked live while the engine would refuse it (F5).

export interface PartyButtonInput {
  /** Server truth; null while the first GET is in flight. */
  config: PartyConfig | null;
  /** Engine control bus up. */
  connected: boolean;
  /** Performance mode / view-only lock. */
  locked: boolean;
  /** A write is already in flight. */
  pending: boolean;
  /** Settings disclosure state — labels the SETTINGS button only. */
  expanded?: boolean;
}

export interface PartyButtonRule {
  enabled: boolean;
  label: string;
}

export interface PartyButtonRules {
  force: PartyButtonRule;
  returnToAudio: PartyButtonRule;
  resetCooldown: PartyButtonRule;
  enabledToggle: PartyButtonRule;
  settings: PartyButtonRule;
}

export function partyButtonRules(input: PartyButtonInput): PartyButtonRules {
  const { config, connected, locked, pending } = input;
  // Every write needs a live, unlocked, idle transport. SETTINGS is the one
  // control that touches nothing, so it is always available.
  const canWrite = connected && !locked && !pending;
  const inSession = config?.effectiveState === 'in_session';
  const forced = config?.sessionForced === true;
  const cooldownLeft = config?.cooldownRemainingSec ?? 0;

  return {
    // FORCE starts a session. It is meaningless (and the engine refuses it)
    // while one is already running — the operator wants RETURN there.
    force: {
      enabled: canWrite
        && !!config?.partyCueId
        && config?.readiness?.planActive === true
        && !inSession,
      label: forced ? 'PARTY FORCED' : 'FORCE PARTY',
    },
    // RETURN ends ANY live session, forced or detected. With no session live
    // the engine 409s, so the button is off rather than lying (_356 F5).
    returnToAudio: {
      enabled: canWrite && inSession,
      label: forced ? 'RETURN TO LIVE AUDIO' : 'END PARTY SESSION',
    },
    resetCooldown: {
      enabled: canWrite && cooldownLeft > 0,
      label: 'RESET COOLDOWN',
    },
    enabledToggle: {
      enabled: connected && !locked && !pending && !!config,
      label: config?.enabled ? 'ENABLED' : 'DISABLED',
    },
    settings: {
      enabled: true,
      label: input.expanded ? 'LESS' : 'SETTINGS',
    },
  };
}

const PATH = '/party-config';

/**
 * Validate an engine payload before it reaches React state. A malformed body
 * is a LOUD error, not a half-populated card (no fallback defaults).
 */
export function parsePartyConfig(raw: unknown): PartyConfig {
  const o = raw as any;
  if (!o || typeof o !== 'object') {
    throw new Error(`GET ${PATH}: expected an object, got ${JSON.stringify(raw)}`);
  }
  if (typeof o.enabled !== 'boolean') {
    throw new Error(`GET ${PATH}: 'enabled' must be a boolean, got ${JSON.stringify(o.enabled)}`);
  }
  if (typeof o.playlist !== 'string') {
    throw new Error(`GET ${PATH}: 'playlist' must be a string, got ${JSON.stringify(o.playlist)}`);
  }
  if (!Array.isArray(o.availablePlaylists) || o.availablePlaylists.some((p: unknown) => typeof p !== 'string')) {
    throw new Error(`GET ${PATH}: 'availablePlaylists' must be a string[], got ${JSON.stringify(o.availablePlaylists)}`);
  }
  for (const k of ['minDwellSec', 'durationMin', 'cooldownSec'] as const) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) {
      throw new Error(`GET ${PATH}: '${k}' must be a finite number, got ${JSON.stringify(o[k])}`);
    }
  }
  for (const k of ['durationEnabled', 'cooldownEnabled'] as const) {
    if (typeof o[k] !== 'boolean') {
      throw new Error(`GET ${PATH}: '${k}' must be a boolean, got ${JSON.stringify(o[k])}`);
    }
  }
  if (o.effectiveState !== undefined && !EFFECTIVE_STATES.includes(o.effectiveState)) {
    throw new Error(
      `GET ${PATH}: 'effectiveState' must be one of ${EFFECTIVE_STATES.join('|')}, got ${JSON.stringify(o.effectiveState)}`,
    );
  }
  const cfg: PartyConfig = {
    enabled: o.enabled,
    playlist: o.playlist,
    availablePlaylists: o.availablePlaylists.slice(),
    minDwellSec: o.minDwellSec,
    durationEnabled: o.durationEnabled,
    durationMin: o.durationMin,
    cooldownEnabled: o.cooldownEnabled,
    cooldownSec: o.cooldownSec,
  };
  if (o.effectiveState !== undefined) cfg.effectiveState = o.effectiveState;

  // Live-view additions: OPTIONAL (a pre-addition engine simply omits them),
  // but type-checked when present — a wrong-typed field is a loud contract
  // break, not something to shrug off.
  for (const k of [
    'effectiveDurationMin',
    'effectiveCooldownSec',
    'cooldownRemainingSec',
    'sustainHeldSec',
    'sustainRequiredSec',
    'sustainProgress',
    'signalLossHeldSec',
    'signalLossRequiredSec',
    'signalLossProgress',
  ] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) {
      throw new Error(`GET ${PATH}: '${k}' must be a finite number when present, got ${JSON.stringify(o[k])}`);
    }
    cfg[k] = o[k];
  }
  for (const k of [
    'effectiveCooldownEnabled',
    'planActive',
    'inFestivalWindow',
    'partyWindowOpen',
    'strongSignal',
    'sessionForced',
    'moodStale',
  ] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'boolean') {
      throw new Error(`GET ${PATH}: '${k}' must be a boolean when present, got ${JSON.stringify(o[k])}`);
    }
    cfg[k] = o[k];
  }
  // Nullable pair: null means "no session running", which is information.
  if (o.sessionFollowsMusic !== undefined) {
    if (o.sessionFollowsMusic !== null && typeof o.sessionFollowsMusic !== 'boolean') {
      throw new Error(`GET ${PATH}: 'sessionFollowsMusic' must be a boolean or null, got ${JSON.stringify(o.sessionFollowsMusic)}`);
    }
    cfg.sessionFollowsMusic = o.sessionFollowsMusic;
  }
  if (o.sessionEndsAtMs !== undefined) {
    if (o.sessionEndsAtMs !== null && (typeof o.sessionEndsAtMs !== 'number' || !Number.isFinite(o.sessionEndsAtMs))) {
      throw new Error(`GET ${PATH}: 'sessionEndsAtMs' must be a finite number or null, got ${JSON.stringify(o.sessionEndsAtMs)}`);
    }
    cfg.sessionEndsAtMs = o.sessionEndsAtMs;
  }
  for (const k of ['partyCueId', 'cueError'] as const) {
    if (o[k] === undefined) continue;
    if (o[k] !== null && typeof o[k] !== 'string') {
      throw new Error(`GET ${PATH}: '${k}' must be a string or null, got ${JSON.stringify(o[k])}`);
    }
    cfg[k] = o[k];
  }
  // Party Window boundaries (_356 P0-2). Nullable: a plan with no Party Window
  // has no next open, and that is information — not a reason to guess one.
  for (const k of ['partyWindowOpensAtMs', 'partyWindowClosesAtMs'] as const) {
    if (o[k] === undefined) continue;
    if (o[k] !== null && (typeof o[k] !== 'number' || !Number.isFinite(o[k]))) {
      throw new Error(`GET ${PATH}: '${k}' must be a finite number or null, got ${JSON.stringify(o[k])}`);
    }
    cfg[k] = o[k];
  }
  if (o.readiness !== undefined) {
    if (!o.readiness || typeof o.readiness !== 'object' || Array.isArray(o.readiness)) {
      throw new Error(`GET ${PATH}: 'readiness' must be an object when present, got ${JSON.stringify(o.readiness)}`);
    }
    for (const key of ['enabled', 'planActive', 'partyWindowOpen', 'planDriving', 'cooldownClear'] as const) {
      if (typeof o.readiness[key] !== 'boolean') {
        throw new Error(`GET ${PATH}: 'readiness.${key}' must be a boolean, got ${JSON.stringify(o.readiness[key])}`);
      }
    }
    if (o.readiness.triggerArmed !== null && typeof o.readiness.triggerArmed !== 'boolean') {
      throw new Error(
        `GET ${PATH}: 'readiness.triggerArmed' must be a boolean or null, got `
        + JSON.stringify(o.readiness.triggerArmed),
      );
    }
    cfg.readiness = { ...o.readiness };
  }
  return cfg;
}

export async function fetchPartyConfig(): Promise<ApiResult<PartyConfig>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${PATH}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: (body && body.error) || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: parsePartyConfig(body), status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

export async function setPartyConfig(patch: PartyConfigPatch): Promise<ApiResult<PartyConfig>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: (body && body.error) || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: parsePartyConfig(body), status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

async function postPartyCommand(path: string): Promise<ApiResult<PartyConfig>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`, { method: 'POST' });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: (body && body.error) || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: parsePartyConfig(body), status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

export const forcePartySession = () => postPartyCommand('/party/force');
export const returnPartyToLiveAudio = () => postPartyCommand('/party/live-audio');
export const resetPartyCooldown = () => postPartyCommand('/party/cooldown/reset');

// ── Edit coalescing + optimistic view ────────────────────────────────────
// PURE. The card accumulates edits into ONE pending patch and PUTs it after a
// debounce, so a mashed toggle or a held "+" produces a single write whose
// body is the FINAL intent. Both helpers are exercised by vitest, and both are
// the code the card actually runs (no parallel logic to drift).

/** Last-write-wins merge of patches, in order. Flapping collapses to the end state. */
export function coalescePartyPatches(patches: PartyConfigPatch[]): PartyConfigPatch {
  return patches.reduce<PartyConfigPatch>((acc, p) => ({ ...acc, ...p }), {});
}

/**
 * The config as the operator currently sees it: server truth with the pending
 * (not-yet-acknowledged) edits laid over it. When the PUT lands, the response
 * REPLACES this — the overlay is never authoritative.
 */
export function mergePartyPatch(cfg: PartyConfig, patch: PartyConfigPatch): PartyConfig {
  return { ...cfg, ...patch };
}

// ── Row-state rule (session length ⇄ cooldown) ───────────────────────────
// PURE. One place decides what the SESSION LENGTH and COOLDOWN rows show,
// so the card can't invent a state the engine doesn't hold.
//
// Operator rule: duration disabled ⇒ cooldown fully gone. The EFFECTIVE
// cooldown is therefore `durationEnabled && cooldownEnabled`, derived from
// the GET's own fields — never from local UI memory.

export interface PartyRowStates {
  /** Fixed-length mode (durationMin stepper is the active control). */
  durationEnabled: boolean;
  /** Follow-the-music mode — the party signal drop ends the session. */
  releaseMode: boolean;
  /** Cooldown as it actually applies (false whenever duration is off). */
  cooldownEnabled: boolean;
  /** True when the cooldown toggle must be greyed out (not operator-changeable). */
  cooldownToggleDisabled: boolean;
  /** Why the cooldown row is greyed, or null when it is live. */
  cooldownHint: string | null;
}

export function describePartyRows(
  cfg: Pick<PartyConfig, 'durationEnabled' | 'cooldownEnabled' | 'effectiveCooldownEnabled'>,
): PartyRowStates {
  const durationEnabled = cfg.durationEnabled === true;
  // The ENGINE's effective flag wins wherever it disagrees with the raw
  // toggle; the duration gate still applies on top so a pending (not yet
  // acknowledged) duration-off greys the row immediately instead of waiting
  // a round-trip.
  const rawCooldown = typeof cfg.effectiveCooldownEnabled === 'boolean'
    ? cfg.effectiveCooldownEnabled
    : cfg.cooldownEnabled === true;
  return {
    durationEnabled,
    releaseMode: !durationEnabled,
    cooldownEnabled: durationEnabled && rawCooldown,
    cooldownToggleDisabled: !durationEnabled,
    cooldownHint: durationEnabled ? null : 'No cooldown in follow-the-music mode.',
  };
}

/**
 * PURE. When the engine's EFFECTIVE value for a field differs from the raw
 * configured one (e.g. a plan cue overrides the session length), say so next
 * to the stepper instead of letting the operator believe the raw number is
 * what will run. Returns null when they agree or the engine sent nothing.
 */
export function describeEffectiveNote(
  raw: number,
  effective: number | undefined,
  format: (n: number) => string,
): string | null {
  if (typeof effective !== 'number' || effective === raw) return null;
  return `engine uses ${format(effective)}`;
}

// ── Status derivation ────────────────────────────────────────────────────
// PURE. Prefers the engine's own `effectiveState` when the GET provides it
// (single source of truth); otherwise derives from GET /party-config
// `enabled` plus the live /timeline/state fields the Timeline tab already
// consumes (`planActive`, `party`, `currentMood`,
// `partyCooldownRemainingSec`).
//
// Party mode only takes effect while a timeline plan is ACTIVE (operator
// precedence rule), so "enabled but no plan" is its own honest state — not
// "armed".

export type PartyStatusTone =
  | 'unknown' | 'off' | 'live' | 'cooldown' | 'armed' | 'waiting' | 'noplan' | 'manual';

export interface PartyStatus {
  tone: PartyStatusTone;
  /** Short uppercase state word for the pill. */
  label: string;
  /** One-line operator explanation. */
  detail: string;
}

export interface PartyStatusInput {
  /** Server truth for the hard toggle; null while we have not read it yet. */
  enabled: boolean | null;
  /** Engine-computed verdict from GET /party-config — AUTHORITATIVE when sent. */
  effectiveState?: PartyEffectiveState;
  /** planActive — party only runs under an active plan. */
  planActive?: boolean | null;
  /** inFestivalWindow — false means the plan exists but today is outside it. */
  inFestivalWindow?: boolean | null;
  /** /timeline/state.party — engines send a 0/1 number or a boolean. */
  party?: number | boolean | null;
  /** /timeline/state.currentMood */
  currentMood?: string | null;
  /** Epoch ms the running fixed-duration session ends (null when N/A). */
  sessionEndsAtMs?: number | null;
  /** True while the RUNNING session is follow-the-music. */
  sessionFollowsMusic?: boolean | null;
  /** Seconds left before another session may trigger (0/absent when clear). */
  cooldownRemainingSec?: number | null;
  /** Clock for the live countdowns — pass Date.now(); injectable for tests. */
  nowMs?: number;
  /** True when the engine control bus is down — we cannot claim "armed". */
  engineOffline?: boolean;
}

const DISABLED: PartyStatus = {
  tone: 'off',
  label: 'DISABLED',
  detail: 'Party sessions are blocked. Any running session was killed; detection keeps running.',
};

/** "no plan" has two very different causes — name the one that applies. */
function noPlanStatus(inFestivalWindow?: boolean | null): PartyStatus {
  if (inFestivalWindow === false) {
    return {
      tone: 'noplan',
      label: 'OUT OF WINDOW',
      detail: 'Outside the festival window — the plan is dormant, so nothing will trigger until the festival starts.',
    };
  }
  return {
    tone: 'noplan',
    label: 'NO PLAN',
    detail: 'Party mode is enabled but no timeline plan is running — nothing will trigger until a plan is active.',
  };
}

const MANUAL: PartyStatus = {
  tone: 'manual',
  label: 'MANUAL',
  detail: 'MANUAL — the operator has the deck. Party sessions stay parked until the plan is driving again.',
};

/** IN SESSION detail: name the end condition (fixed countdown or the music). */
function inSessionStatus(input: PartyStatusInput): PartyStatus {
  const mood = input.currentMood ? ` · mood ${input.currentMood}` : '';
  if (input.sessionFollowsMusic) {
    return { tone: 'live', label: 'IN SESSION', detail: `Party session running — follows the music, ends when the signal drops${mood}.` };
  }
  if (typeof input.sessionEndsAtMs === 'number' && typeof input.nowMs === 'number') {
    const leftSec = Math.max(0, (input.sessionEndsAtMs - input.nowMs) / 1000);
    return { tone: 'live', label: 'IN SESSION', detail: `Party session running — ends in ${formatMinSec(leftSec)}${mood}.` };
  }
  return { tone: 'live', label: 'IN SESSION', detail: `A party session is running now${mood}.` };
}

function cooldownStatus(cd?: number | null): PartyStatus {
  return {
    tone: 'cooldown',
    label: 'COOLDOWN',
    detail: (typeof cd === 'number' && cd > 0)
      ? `Cooling down ${formatMinSec(cd)} — nothing can trigger until it clears.`
      : 'Session just ended — waiting out the cooldown before another can trigger.',
  };
}

export function describePartyStatus(input: PartyStatusInput): PartyStatus {
  if (input.engineOffline) {
    return { tone: 'unknown', label: 'ENGINE OFFLINE', detail: 'Cannot reach the engine — party state unknown.' };
  }
  if (input.enabled === null || input.enabled === undefined) {
    return { tone: 'unknown', label: 'CHECKING…', detail: 'Reading party configuration from the engine.' };
  }

  // The engine's own verdict wins whenever it sends one (six states).
  switch (input.effectiveState) {
    case 'disabled': return DISABLED;
    case 'no_plan': return noPlanStatus(input.inFestivalWindow);
    case 'manual': return MANUAL;
    case 'waiting_window':
      return {
        tone: 'waiting',
        label: 'WINDOW CLOSED',
        detail: 'Party detection is enabled, but it cannot switch playlists until the timed Party Window opens.',
      };
    case 'in_session': return inSessionStatus(input);
    case 'cooldown': return cooldownStatus(input.cooldownRemainingSec);
    case 'armed': return { tone: 'armed', label: 'ARMED', detail: 'Waiting for sustained party audio to trigger a session.' };
    default: break;  // no effectiveState on this engine — derive below
  }

  if (input.enabled === false) return DISABLED;

  const inSession = input.party === true || (typeof input.party === 'number' && input.party > 0);
  if (inSession) return inSessionStatus(input);

  const cd = input.cooldownRemainingSec;
  if (typeof cd === 'number' && cd > 0) return cooldownStatus(cd);
  if (input.planActive === false) return noPlanStatus(input.inFestivalWindow);
  return { tone: 'armed', label: 'ARMED', detail: 'Waiting for sustained party audio to trigger a session.' };
}
