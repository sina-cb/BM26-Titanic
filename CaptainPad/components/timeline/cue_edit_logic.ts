/**
 * cue_edit_logic — PURE cue-assembly rules for the CueEditorSheet.
 *
 * Extracted so two operator rulings (2026-08-03) are pinned by plain-node
 * vitest instead of living untestably inside the component:
 *
 *   1. Cue-level `size` is REMOVED from cues. The editor never shows it and
 *      never emits it; an old saved cue that still carries `globals.size` is
 *      accepted on read and silently shed on the next save (accept-and-ignore,
 *      never re-emit). The DECK-level size global is untouched — it is a real
 *      deck control; only the cue authoring surface lost it.
 *
 *   2. HOLD left the cue UI entirely ("remove hold from the cue UI to avoid
 *      confusion, but keep it for the party"). The mechanism stays fully alive
 *      engine-side (cue.hold in the schema, the arbiter/hold behavior, the
 *      party program's hold in the plan YAMLs). The editor merely stops
 *      displaying or editing it — an existing cue.hold must ROUND-TRIP through
 *      an edit UNTOUCHED, and a new cue emits no hold (engine semantics for an
 *      omitted hold: the program holds until the next program).
 *
 * Type-only imports (erased at build) keep this module free of the
 * RN-flavoured module graph `utils/timelineApi.ts` sits in — same discipline
 * as zoom_logic.ts.
 */
import type {
  ActionPlaylist,
  CueAction,
  CueDays,
  CueKind,
  CueTrigger,
  PlanLook,
  PlanCue,
  ShowPlan,
} from '../../utils/timelineApi';

export const DEFAULT_CUE_DURATION_MIN = 0.5;
export const DEFAULT_CUE_COLOR_PALETTES = ['bass_drop', 'cyberpunk', 'phoenix'] as const;

/**
 * Operator day D covers 6 PM on festival day D through 5:59 PM on day D+1.
 * A morning clock cue authored on operator day D therefore serializes to
 * wire day D+1, and any clock time ≥ 6 PM stays on wire day D.
 *
 * `TIMELINE_DAY_START_MIN` is duplicated here (matches the constant in
 * `night_calendar_logic.ts`) so this pure module has no React-Native import
 * graph — the type-only imports above are erased at build.
 */
export const OPERATOR_DAY_START_MIN = 18 * 60;

/**
 * Parse "HH:MM" clock time. Returns minutes-of-day or null when malformed.
 * A permissive parser keeps this pure helper independent of the RN-flavoured
 * timelineTemplate.ts (which owns `hhmmToMinutes` for the display layer).
 */
function parseClockMinutes(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Map an operator-day index + clock time to the engine's wire day index.
 * Morning cues (before 6 PM) roll forward one day; evening cues stay put.
 * A cue with no clock (sun/phase/mood/manual/party) is unchanged — those
 * triggers resolve against the engine's own day boundaries.
 */
export function operatorDayToWireDay(
  operatorDay: number,
  atHHMM: string | null | undefined,
): number {
  if (!Number.isFinite(operatorDay)) return operatorDay;
  if (!atHHMM) return operatorDay;
  const minutes = parseClockMinutes(atHHMM);
  if (minutes === null) return operatorDay;
  return minutes < OPERATOR_DAY_START_MIN ? operatorDay + 1 : operatorDay;
}

/**
 * Inverse of `operatorDayToWireDay`: given a stored wire day + clock time,
 * return the operator-day card the cue belongs to. Morning cues on wire day
 * D+1 belong to operator day D; evening cues stay on their wire day.
 * `null` if the wire day drops below 0 after the shift (an operator-day 0
 * morning cue authored with wire-day 0 is a broken authoring state — the
 * calendar will surface it in the day-0 lead-in list).
 */
export function wireDayToOperatorDay(
  wireDay: number,
  atHHMM: string | null | undefined,
): number | null {
  if (!Number.isFinite(wireDay)) return wireDay;
  if (!atHHMM) return wireDay;
  const minutes = parseClockMinutes(atHHMM);
  if (minutes === null) return wireDay;
  if (minutes < OPERATOR_DAY_START_MIN) {
    return wireDay >= 1 ? wireDay - 1 : null;
  }
  return wireDay;
}

/**
 * Build the wire-side `days` array for a "this operator day" cue. Handles
 * clock cues (morning + evening halves), party-window baselines (identical
 * clock-relative mapping), and cues with no clock anchor (returns the
 * operator day unchanged — the engine schedules them by phase/sun/mood).
 * `festivalDays` is the plan's festival length; the shifted wire day is
 * clamped to the span so a "morning" cue on the LAST operator day cannot
 * roll off the end.
 *
 * Returns an operator-day error when the shift falls outside the festival
 * span so the editor can fail loudly instead of silently dropping the cue.
 */
export interface OperatorDayWireResult {
  wireDays: number[];
  /** Non-null when clamping would have dropped the cue — surface loud. */
  overflowError: string | null;
}

export function wireDaysForOperatorDay(
  operatorDay: number,
  atHHMM: string | null | undefined,
  festivalDays: number,
): OperatorDayWireResult {
  const shifted = operatorDayToWireDay(operatorDay, atHHMM);
  if (!Number.isFinite(festivalDays) || festivalDays <= 0) {
    return { wireDays: [shifted], overflowError: null };
  }
  if (shifted < 0) {
    return {
      wireDays: [],
      overflowError:
        `Cue at ${atHHMM ?? 'unset'} maps below the festival start — pick a later start time.`,
    };
  }
  if (shifted > festivalDays - 1) {
    return {
      wireDays: [],
      overflowError:
        `Cue at ${atHHMM ?? 'unset'} rolls past the last festival day — add a day or pick an earlier start time.`,
    };
  }
  return { wireDays: [shifted], overflowError: null };
}

/** Fresh operator defaults for a newly authored deck cue. */
export function defaultCuePlaylistAction(): ActionPlaylist {
  return {
    type: 'playlist',
    name: 'default',
    target: { channel: 'deck', id: null },
    autopilot: { active: true, delay_s: 30, shuffle: true },
    transition: {
      mode: 'trans_crossfade',
      durationMs: 1000,
      enabled: true,
      shuffle: false,
    },
    colorAutopilot: {
      active: true,
      mode: 'palettes',
      palettes: [...DEFAULT_CUE_COLOR_PALETTES],
      delay_s: 10,
      shuffle: false,
      transitionMs: 1000,
    },
    globals: { speed: 0.25, bpmSpeedSync: 0 },
    overlays: 'disable',
  };
}

/**
 * Program dispatch disables the standing plan autopilot before applying its
 * own action. Refuse an editor candidate unless it explicitly restarts pattern
 * autopilot; otherwise the cue would freeze on one pattern.
 */
export function programCueAutopilotError(cue: PlanCue): string | null {
  if (cue.enabled === false || cue.kind !== 'program') return null;
  if (cue.action.type !== 'playlist') return null;
  const channel = cue.action.target?.channel ?? 'deck';
  if (channel !== 'deck' && channel !== 'all') return null;
  if (cue.action.autopilot?.active === true) return null;
  return 'Program cues must keep AUTOPILOT PATTERNS ON so the deck does not freeze. '
    + 'Turn it on, or change CUE TYPE to Ambient.';
}

/**
 * PARTY is stored on the wire as the engine's existing mood transition into
 * party. Keeping the predicate here gives the editor a first-class PARTY mode
 * without inventing a second trigger schema that older engines cannot read.
 */
export function isPartyCueTrigger(trigger: CueTrigger): boolean {
  return trigger.type === 'mood' && trigger.to === 'party';
}

/**
 * Migrate an existing legacy PARTY look into the playlist-only cue editor
 * without losing what the look actually runs. Returns null when no migration
 * applies. A PARTY look without a playlist is an invalid authoring state for
 * this editor, so fail loudly instead of silently choosing "default".
 */
export function partyPlaylistActionForEditor(
  cue: PlanCue,
  looks: Record<string, PlanLook>,
): ActionPlaylist | null {
  if (!isPartyCueTrigger(cue.trigger) || cue.action.type !== 'look') return null;
  const look = looks[cue.action.look];
  if (!look || typeof look.playlist !== 'string' || !look.playlist) {
    throw new Error(
      `PARTY cue "${cue.id}" uses look "${cue.action.look}" without a playlist; `
      + 'choose a playlist in the plan before editing this cue.',
    );
  }
  const action: ActionPlaylist = {
    type: 'playlist',
    name: look.playlist,
    target: { channel: 'deck', id: null },
  };
  if (look.palette) action.palette = look.palette;
  if (look.autopilot) action.autopilot = look.autopilot;
  if (look.globals) action.globals = look.globals;
  return action;
}

/**
 * Shed the legacy cue-level `size` from a playlist action's globals map.
 * Every other key rides through untouched; a globals map that held ONLY size
 * is dropped whole (an empty {} would still read as "this cue sets globals").
 * Non-playlist actions and actions without globals are returned as-is.
 */
export function stripCueSizeGlobal(action: CueAction): CueAction {
  if (action.type !== 'playlist') return action;
  const globals = action.globals;
  if (!globals || !('size' in globals)) return action;
  const { size: _shed, ...rest } = globals;
  const out: ActionPlaylist = { ...action };
  if (Object.keys(rest).length > 0) out.globals = rest;
  else delete out.globals;
  return out;
}

/**
 * A legacy Deck snapshot could serialize an unset static palette as `palette:
 * ""`. The field is optional, but once present the engine correctly requires a
 * non-empty palette id. The cue editor does not expose this legacy field, so an
 * empty/whitespace value means "not set" and must be omitted on its next save.
 * Non-string malformed values remain untouched so engine preflight still
 * refuses them loudly.
 */
export function stripEmptyCuePalette(action: CueAction): CueAction {
  if (action.type !== 'playlist' || typeof action.palette !== 'string' || action.palette.trim()) {
    return action;
  }
  const out: ActionPlaylist = { ...action };
  delete out.palette;
  return out;
}

/**
 * Assemble the emitted PlanCue from the original cue + the editor's managed
 * fields. The ORIGINAL cue is spread first so every field the editor does NOT
 * surface — `hold` (operator ruling above), `enabled`, `catchUp`, and any
 * future keys — survives the round-trip byte-identical; the editor then
 * overlays only what it manages. `size` is shed from the action here so no
 * save path can re-emit it regardless of what was loaded.
 */
export function assembleCue(args: {
  initial: PlanCue | null;
  kind: CueKind;
  trigger: CueTrigger;
  action: CueAction;
  days: CueDays;
  label: string;
  /** REQUIRED positive duration — the editor guarantees it. */
  durationMin: number;
}): PlanCue {
  const cue: PlanCue = {
    ...(args.initial ?? {}),
    id: args.initial?.id ?? '', // parent mints ids for new cues
    kind: args.kind,
    trigger: args.trigger,
    action: stripEmptyCuePalette(stripCueSizeGlobal(args.action)),
    days: args.days,
  };
  const label = args.label.trim();
  if (label) cue.label = label;
  else delete cue.label;
  cue.durationMin = args.durationMin;
  return cue;
}

/**
 * Build the complete plan candidate used for engine preflight without mutating
 * the live maker draft. The cue must already have its final engine-valid id.
 */
export function planWithUpsertedCue(plan: ShowPlan, cue: PlanCue): ShowPlan {
  if (!cue.id) throw new Error('A cue must have an id before plan validation.');
  const exists = plan.cues.some((current) => current.id === cue.id);
  return {
    ...plan,
    cues: exists
      ? plan.cues.map((current) => (current.id === cue.id ? cue : current))
      : [...plan.cues, cue],
  };
}
