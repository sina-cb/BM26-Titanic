// special_events_api — CaptainPad's client for the engine-side SPECIAL EVENTS
// show runner (docs/52; engine slice by agent _205, UI slice by _206).
//
// The runner lives IN the engine, not here. This module is a THIN, strictly
// validating client: it types the wire, refuses malformed payloads loudly, and
// threads the engine's `code` through so callers can tell a 409
// `STAGE_NOT_ARMED` (the operator tapped out of order) apart from
// `SPECIAL_EVENT` (someone else tried to write the deck) apart from a plain
// transport failure.
//
// ── WIRE CONTRACT — reconciled against the engine, 2026-08-14 ─────────────
//
//   GET  /special-events               → { shows, loadErrors }
//   GET  /special-events/state         → the FULL runner document
//   POST /special-events/arm    { show }        ← the ONE passcode-gated route
//   POST /special-events/fire   { stageId, choiceId? }
//   POST /special-events/quick-effect { id }
//   POST /special-events/extend
//   POST /special-events/finish
//   POST /special-events/abort
//   POST /special-events/dismiss                ← clears an `ended` banner
//   POST /special-events/autopilot { active?, everySec?, shuffle?, transition? }
//                                               ← live stage pattern rotation
//   POST /special-events/autopilot { reset: true }  ← back to the show file
//   WS   `specialEvents`               → the same document, live
//
// Every mutation answers `{ status: 'ok', state }` where `state` is
// byte-identical to the WS frame, so the tab adopts the engine's own answer
// instead of guessing and re-reading.
//
// The state document carries the SHOW LIBRARY (`shows` + `loadErrors`) as well
// as the run, so there is exactly one shape to reconcile. `GET /special-events`
// is the same two fields on their own, kept for a cheap cold seed.
//
// ── Field mapping (engine name → the name this app uses) ──────────────────
// Renamed at the parser so the UI reads in its own vocabulary and any future
// wire rename is a one-line change here:
//
//   stageId            → currentStageId   (the stage HOLDING the rig)
//   lastError          → error
//   loadErrors         → errors
//   stage.quickEffects → stage.effects
//   stage.advance      → stage.advanceSec  ({mode:'timed',afterSec} → number)
//   stage.extend       → stage.extendLabel + stage.extendKind
//
// ── ARM is a takeover ────────────────────────────────────────────────────
// ARM engages the timeline takeover lease, so the engine wears the SAME gate
// there as on `/timeline/takeover`: in performance mode it demands a FRESH
// operator passcode every single time. `armSpecialEvent` attaches it as
// `X-CaptainPad-Passcode` on THAT ONE REQUEST — the header-only, zero-storage
// idiom of utils/takeover_passcode.ts (agent _201). Nothing here stores,
// caches, logs or re-sends a passcode; it arrives as an argument and dies with
// the fetch. Every other verb — including ABORT — is ungated: handing the rig
// back is always free.
//
// ── Codex P0 — no fallbacks ──────────────────────────────────────────────
// A payload that does not match the contract THROWS with the offending field.
// A half-parsed show is worse than a visible error card at 2 a.m.

import { ApiResult, fetchWithTimeout } from './api';
import { getApiBaseAsync } from './apiBase';
import { clearOperatorAuthOnRefusal, operatorAuthHeaders } from './operator_auth';
import type { OperatorAuthSendInput } from './takeover_passcode';

const BASE_PATH = '/special-events';
const STATE_PATH = '/special-events/state';
const ARM_PATH = '/special-events/arm';
const FIRE_PATH = '/special-events/fire';
const QUICK_EFFECT_PATH = '/special-events/quick-effect';
const EXTEND_PATH = '/special-events/extend';
const FINISH_PATH = '/special-events/finish';
const ABORT_PATH = '/special-events/abort';
const DISMISS_PATH = '/special-events/dismiss';
const AUTOPILOT_PATH = '/special-events/autopilot';

/** WS message type the engine broadcasts on /ws/control. */
export const SPECIAL_EVENTS_WS_TYPE = 'specialEvents';

// ── Engine refusal codes (special_events_service.js SpecialEventError) ────

export const STAGE_NOT_ARMED = 'STAGE_NOT_ARMED';
export const EVENT_ACTIVE = 'EVENT_ACTIVE';
export const NO_EVENT_ARMED = 'NO_EVENT_ARMED';
export const NO_STAGE_RUNNING = 'NO_STAGE_RUNNING';
export const QUICK_EFFECT_NOT_FOUND = 'QUICK_EFFECT_NOT_FOUND';
export const CHOICE_REQUIRED = 'CHOICE_REQUIRED';
export const CHOICE_NOT_ALLOWED = 'CHOICE_NOT_ALLOWED';
export const NO_EXTEND = 'NO_EXTEND';
export const ARM_FAILED = 'ARM_FAILED';
/** The live stage authors no `autopilot:` block, so it has no rotation to tune. */
export const NO_STAGE_AUTOPILOT = 'NO_STAGE_AUTOPILOT';
export const AUTOPILOT_INVALID = 'AUTOPILOT_INVALID';
export const SPECIAL_EVENT_PLAYLIST_MISSING = 'SPECIAL_EVENT_PLAYLIST_MISSING';
/** The engine's single-writer gate on the deck content routes while a show runs. */
export const SPECIAL_EVENT_LOCK = 'SPECIAL_EVENT';

// ── Show catalog ──────────────────────────────────────────────────────────

/** A quick-effect pulse button, live while its stage is CURRENT. */
export interface EventQuickEffect {
  id: string;
  label: string;
  /** Show-data accent. `null` → the stage/theme accent is used. */
  color: string | null;
}

/** One variant button of a CHOICE stage (the ceremonial pink / blue pair). */
export interface EventChoice {
  id: string;
  label: string;
  color: string | null;
}

// ── Stage pattern rotation (the show autopilot) ───────────────────────────
//
// The DECK's AUTOPILOT PATTERNS settings, scoped to a show stage and with the
// colour half deliberately absent (operator, 2026-08-15: "the deck auto pilot
// settings exactly no color"). The engine drives the deck's own autopilot
// daemon with these, so the cadence, the crossfade and the countdown are the
// same machinery the deck tab shows — not a parallel implementation.

/** The soft-swap config for a rotation — the deck's DECK TX block. */
export interface EventAutopilotTransition {
  enabled: boolean;
  /** A `trans_*` transition script name; `trans_crossfade` is the default. */
  mode: string;
  durationMs: number;
  /** Roll a random transition style for each swap. */
  shuffle: boolean;
}

/** A stage's AUTHORED rotation defaults, off the show file. */
export interface EventStageAutopilot {
  /**
   * Whether this stage offers rotation controls at all. NOT the same as
   * `active`: an unsupported stage (blackout, reveal) draws no card and the
   * engine forces rotation off while it holds.
   */
  supported: boolean;
  active: boolean;
  everySec: number;
  shuffle: boolean;
  /** Keep swapping inside a window of adjacent playlist entries. */
  groupMode: boolean;
  groupSize: number;
  /** Swaps to linger in a group window before taking a fresh one. */
  groupDwell: number;
  transition: EventAutopilotTransition;
}

/** The LIVE rotation state for whichever stage holds the rig. */
export interface EventAutopilotState {
  supported: boolean;
  /** The stage these settings belong to, or `null` when unsupported. */
  stageId: string | null;
  active: boolean;
  /** Cadence in seconds; `null` only when unsupported. */
  everySec: number | null;
  shuffle: boolean;
  groupMode: boolean;
  /** `null` only when unsupported. */
  groupSize: number | null;
  /** `null` only when unsupported. */
  groupDwell: number | null;
  /** `null` only when unsupported. */
  transition: EventAutopilotTransition | null;
  /** Absolute wall-clock ms of the next pattern swap, straight off the daemon. */
  nextSwapAtMs: number | null;
  /**
   * The deck's ACTIVE playlist entry — what is on the ship right now (docs/57
   * §4.3). `null` when the deck has no entry to name; the card says so rather
   * than inventing a title. Read engine-side so this tab never grows a second
   * data source for the deck.
   */
  nowPlaying: EventNowPlaying | null;
  /** True when the operator's live tuning differs from the show file. */
  overridden: boolean;
}

/** The deck's active entry, named the way the operator named it. */
export interface EventNowPlaying {
  /** Pattern id (the fallback title). */
  pattern: string | null;
  /** The operator's own name for this entry, when it has one. */
  label: string | null;
}

/** The sparse patch `POST /special-events/autopilot` accepts. */
export interface EventAutopilotPatch {
  active?: boolean;
  everySec?: number;
  shuffle?: boolean;
  groupMode?: boolean;
  groupSize?: number;
  groupDwell?: number;
  transition?: Partial<EventAutopilotTransition>;
}

export type EventStageKind = 'action' | 'choice';
/** `time` adds seconds to a live countdown; `actions` re-fires authored actions. */
export type EventExtendKind = 'time' | 'actions';

export interface EventStageSummary {
  id: string;
  label: string;
  color: string | null;
  /** One line of show-authored operator guidance, or `null`. */
  hint: string | null;
  /** `true` → the reveal moment: biggest buttons on the glass, chrome dimmed. */
  ceremonial: boolean;
  kind: EventStageKind;
  /** Non-empty exactly when `kind === 'choice'`. */
  choices: EventChoice[];
  /** Quick-effect buttons; `[]` when the stage authors none. */
  effects: EventQuickEffect[];
  /** EXTEND button label, or `null` when this stage defines no extend. */
  extendLabel: string | null;
  /** How EXTEND behaves; `null` exactly when `extendLabel` is null. */
  extendKind: EventExtendKind | null;
  /** Auto-advance window in seconds; `null` → the stage waits for a human. */
  advanceSec: number | null;
  /** The stage's AUTHORED rotation defaults (see EventStageAutopilot). */
  autopilot: EventStageAutopilot;
}

export interface EventShow {
  id: string;
  name: string;
  color: string | null;
  /** IconSymbol name from show data; `null` → the tab's default glyph. */
  icon: string | null;
  description: string | null;
  stages: EventStageSummary[];
}

/** A show YAML that refused to load. Rendered as a red, untappable card. */
export interface EventShowLoadError {
  file: string;
  error: string;
}

export interface EventCatalog {
  shows: EventShow[];
  errors: EventShowLoadError[];
}

// ── Runner state ──────────────────────────────────────────────────────────

export type EventRunStatus = 'idle' | 'armed' | 'running' | 'ended';
const RUN_STATUSES: EventRunStatus[] = ['idle', 'armed', 'running', 'ended'];

export type EventEndReason = 'finished' | 'aborted' | 'panic' | 'restore_failed';
const END_REASONS: EventEndReason[] = ['finished', 'aborted', 'panic', 'restore_failed'];

export interface SpecialEventsState {
  status: EventRunStatus;
  /** The armed/running show (or the one that just ended), else `null`. */
  showId: string | null;
  /** The stage whose actions have fired and is holding the rig now. */
  currentStageId: string | null;
  /** The ONLY stage the engine will accept a `/fire` for. */
  armedStageId: string | null;
  /** The chosen variant of a fired choice stage. */
  choiceId: string | null;
  /** Live auto-advance countdown on the armed stage, or `null` when manual. */
  countdownSec: number | null;
  /** How long the current stage has been holding, in seconds. */
  stageElapsedSec: number | null;
  endedReason: EventEndReason | null;
  /** The engine's extra sentence about how a run ended (a restore failure). */
  endedDetail: string | null;
  /** Engine's own error, surfaced verbatim. */
  error: string | null;
  /** True while the runner holds the timeline's operator lease. */
  leaseHeld: boolean;
  /** Live pattern rotation for the stage holding the rig. */
  autopilot: EventAutopilotState;
  /** The show library, carried on every frame (see the header). */
  catalog: EventCatalog;
}

// ── Parsers (throw-style, mirroring party_api's posture) ──────────────────

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function readString(o: Record<string, unknown>, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) {
    fail(path, `'${key}' must be a non-empty string, got ${JSON.stringify(v)}`);
  }
  return v as string;
}

function readOptionalString(o: Record<string, unknown>, key: string, path: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    fail(path, `'${key}' must be a string or absent, got ${JSON.stringify(v)}`);
  }
  return v as string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Show-data accents are DATA, and data gets validated at the door. A malformed
 * accent is a loud load error here rather than a crash inside a render pass at
 * 2 a.m. (the renderer's contrast check then decides whether a VALID accent is
 * legible enough to fill a button with).
 */
function readOptionalColor(o: Record<string, unknown>, key: string, path: string): string | null {
  const v = readOptionalString(o, key, path);
  if (v === null) return null;
  if (!HEX_COLOR.test(v)) {
    fail(path, `'${key}' must be a #rrggbb color, got ${JSON.stringify(v)}`);
  }
  return v;
}

function readObject(raw: unknown, path: string, what: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(path, `expected ${what} object, got ${JSON.stringify(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function readArray(o: Record<string, unknown>, key: string, path: string): unknown[] {
  const v = o[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(path, `'${key}' must be an array when present, got ${JSON.stringify(v)}`);
  return v;
}

function parseQuickEffect(raw: unknown, path: string): EventQuickEffect {
  const o = readObject(raw, path, 'a quick effect');
  return {
    id: readString(o, 'id', path),
    label: readString(o, 'label', path),
    color: readOptionalColor(o, 'color', path),
  };
}

function parseChoice(raw: unknown, path: string): EventChoice {
  const o = readObject(raw, path, 'a choice');
  return {
    id: readString(o, 'id', path),
    label: readString(o, 'label', path),
    color: readOptionalColor(o, 'color', path),
  };
}

function readBool(o: Record<string, unknown>, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(path, `'${key}' must be a boolean, got ${JSON.stringify(v)}`);
  return v as boolean;
}

function readNumber(o: Record<string, unknown>, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(path, `'${key}' must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v as number;
}

function parseAutopilotTransition(raw: unknown, path: string): EventAutopilotTransition {
  const o = readObject(raw, path, "the rotation's 'transition'");
  return {
    enabled: readBool(o, 'enabled', path),
    mode: readString(o, 'mode', path),
    durationMs: readNumber(o, 'durationMs', path),
    shuffle: readBool(o, 'shuffle', path),
  };
}

/** The "this stage never rotates" shape — the engine's own `supported:false`. */
function noStageAutopilot(): EventStageAutopilot {
  return {
    supported: false,
    active: false,
    everySec: 30,
    shuffle: false,
    groupMode: false,
    groupSize: 3,
    groupDwell: 6,
    transition: { enabled: false, mode: 'trans_crossfade', durationMs: 1000, shuffle: false },
  };
}

/**
 * A stage's authored rotation block.
 *
 * ABSENT is treated as "this stage does not rotate" — the same
 * validate-if-present / documented-default rule `timelineLeaseHeld` and
 * `advance` already follow in this parser, and NOT a swallowed error: a block
 * that IS present and malformed still throws with the offending field.
 *
 * The tolerance is deliberate and it is about the ceremony, not about
 * convenience. This tab carries ABORT. Throwing the whole state document away
 * because an optional CARD went missing would black out the operator's only way
 * to hand the rig back, mid-reveal, to fix a cosmetic regression. Losing the
 * rotation controls is visible on its own — the card is simply not there.
 */
export function parseStageAutopilot(raw: unknown, path: string): EventStageAutopilot {
  if (raw === undefined || raw === null) return noStageAutopilot();
  const o = readObject(raw, path, "the stage's 'autopilot'");
  return {
    supported: readBool(o, 'supported', path),
    active: readBool(o, 'active', path),
    everySec: readNumber(o, 'everySec', path),
    shuffle: readBool(o, 'shuffle', path),
    groupMode: readBool(o, 'groupMode', path),
    groupSize: readNumber(o, 'groupSize', path),
    groupDwell: readNumber(o, 'groupDwell', path),
    transition: parseAutopilotTransition(o.transition, path),
  };
}

/**
 * The LIVE rotation block off the state document. Unsupported stages carry
 * `everySec` / `groupSize` / `groupDwell` / `transition` as null, so those are
 * nullable here and nowhere else.
 *
 * Absent → "nothing is rotating" (see parseStageAutopilot for why this one
 * field is tolerant while a malformed one still throws).
 */
export function parseAutopilotState(raw: unknown, path: string): EventAutopilotState {
  if (raw === undefined || raw === null) {
    return {
      supported: false,
      stageId: null,
      active: false,
      everySec: null,
      shuffle: false,
      groupMode: false,
      groupSize: null,
      groupDwell: null,
      transition: null,
      nextSwapAtMs: null,
      nowPlaying: null,
      overridden: false,
    };
  }
  const o = readObject(raw, path, "the runner's 'autopilot'");
  const supported = readBool(o, 'supported', path);
  const nextRaw = o.nextSwapAtMs;
  if (nextRaw !== null && nextRaw !== undefined
      && (typeof nextRaw !== 'number' || !Number.isFinite(nextRaw))) {
    fail(path, `'nextSwapAtMs' must be a finite number or null, got ${JSON.stringify(nextRaw)}`);
  }
  return {
    supported,
    stageId: readOptionalString(o, 'stageId', path),
    active: readBool(o, 'active', path),
    everySec: supported ? readNumber(o, 'everySec', path) : null,
    shuffle: readBool(o, 'shuffle', path),
    groupMode: readBool(o, 'groupMode', path),
    groupSize: supported ? readNumber(o, 'groupSize', path) : null,
    groupDwell: supported ? readNumber(o, 'groupDwell', path) : null,
    transition: supported ? parseAutopilotTransition(o.transition, path) : null,
    nextSwapAtMs: typeof nextRaw === 'number' ? nextRaw : null,
    nowPlaying: parseNowPlaying(o.nowPlaying, path),
    overridden: o.overridden === true,
  };
}

/**
 * `nowPlaying: { pattern, label } | null`.
 *
 * Absent/null is a legitimate answer (the deck has no active entry), but a
 * PRESENT-but-malformed block still throws — the card would otherwise render a
 * confident blank where a pattern name belongs.
 */
function parseNowPlaying(raw: unknown, path: string): EventNowPlaying | null {
  if (raw === undefined || raw === null) return null;
  const o = readObject(raw, path, "the runner's 'autopilot.nowPlaying'");
  const pattern = readOptionalString(o, 'pattern', path);
  const label = readOptionalString(o, 'label', path);
  if (pattern === null && label === null) return null;
  return { pattern, label };
}

/**
 * What the SHOW card prints as NOW PLAYING: the operator's own name for the
 * entry when it has one, else the pattern id — the same precedence the deck's
 * EntryLabelEditor shows. `null` when there is nothing to name.
 */
export function nowPlayingTitle(np: EventNowPlaying | null): string | null {
  if (!np) return null;
  const label = np.label && np.label.trim() ? np.label.trim() : null;
  if (label) return label;
  return np.pattern && np.pattern.trim() ? np.pattern.trim() : null;
}

/** `advance: { mode, afterSec }` → seconds, or null for a manual stage. */
function parseAdvance(raw: unknown, path: string): number | null {
  if (raw === undefined || raw === null) return null;
  const o = readObject(raw, path, "the stage's 'advance'");
  const mode = readString(o, 'mode', path);
  if (mode === 'manual') return null;
  if (mode !== 'timed') {
    fail(path, `'advance.mode' must be 'manual' or 'timed', got ${JSON.stringify(mode)}`);
  }
  const after = o.afterSec;
  if (typeof after !== 'number' || !Number.isFinite(after) || after <= 0) {
    fail(path, `'advance.afterSec' must be a positive finite number on a timed stage, got ${JSON.stringify(after)}`);
  }
  return after;
}

export function parseEventStage(raw: unknown, path: string = `GET ${BASE_PATH}`): EventStageSummary {
  const o = readObject(raw, path, 'a stage');
  const id = readString(o, 'id', path);
  const where = `${path} stage '${id}'`;

  const choices = readArray(o, 'choices', where).map((c) => parseChoice(c, where));
  const effects = readArray(o, 'quickEffects', where).map((e) => parseQuickEffect(e, where));

  // A stage with choices IS a choice stage. The engine declares `kind` too; a
  // declaration that contradicts the payload is a loud contract break, never
  // something to reconcile silently.
  const derived: EventStageKind = choices.length > 0 ? 'choice' : 'action';
  const declared = readOptionalString(o, 'kind', where);
  if (declared !== null) {
    if (declared !== 'action' && declared !== 'choice') {
      fail(where, `'kind' must be 'action' or 'choice', got ${JSON.stringify(declared)}`);
    }
    if (declared !== derived) {
      fail(where, `'kind' is '${declared}' but the stage has ${choices.length} choices`);
    }
  }

  let extendLabel: string | null = null;
  let extendKind: EventExtendKind | null = null;
  if (o.extend !== undefined && o.extend !== null) {
    const e = readObject(o.extend, where, "the stage's 'extend'");
    extendLabel = readString(e, 'label', where);
    const k = readString(e, 'kind', where);
    if (k !== 'time' && k !== 'actions') {
      fail(where, `'extend.kind' must be 'time' or 'actions', got ${JSON.stringify(k)}`);
    }
    extendKind = k;
  }

  if (o.ceremonial !== undefined && typeof o.ceremonial !== 'boolean') {
    fail(where, `'ceremonial' must be a boolean when present, got ${JSON.stringify(o.ceremonial)}`);
  }

  return {
    id,
    label: readString(o, 'label', where),
    color: readOptionalColor(o, 'color', where),
    hint: readOptionalString(o, 'hint', where),
    ceremonial: o.ceremonial === true,
    kind: derived,
    choices,
    effects,
    extendLabel,
    extendKind,
    advanceSec: parseAdvance(o.advance, where),
    autopilot: parseStageAutopilot(o.autopilot, where),
  };
}

export function parseEventShow(raw: unknown, path: string = `GET ${BASE_PATH}`): EventShow {
  const o = readObject(raw, path, 'a show');
  const id = readString(o, 'id', path);
  const where = `${path} show '${id}'`;
  const stagesRaw = o.stages;
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    fail(where, `'stages' must be a non-empty array, got ${JSON.stringify(stagesRaw)}`);
  }
  return {
    id,
    name: readString(o, 'name', where),
    color: readOptionalColor(o, 'color', where),
    icon: readOptionalString(o, 'icon', where),
    description: readOptionalString(o, 'description', where),
    stages: (stagesRaw as unknown[]).map((s) => parseEventStage(s, where)),
  };
}

/**
 * The show library out of any document that carries it — `GET /special-events`
 * or the state frame, which is the same two fields inline.
 */
export function parseEventCatalog(raw: unknown, path: string = `GET ${BASE_PATH}`): EventCatalog {
  const o = readObject(raw, path, 'a catalog');
  const showsRaw = o.shows;
  if (!Array.isArray(showsRaw)) {
    fail(path, `'shows' must be an array, got ${JSON.stringify(showsRaw)}`);
  }
  const errors = readArray(o, 'loadErrors', path).map((e) => {
    const eo = readObject(e, path, 'a load error');
    return { file: readString(eo, 'file', path), error: readString(eo, 'error', path) };
  });
  return { shows: (showsRaw as unknown[]).map((s) => parseEventShow(s, path)), errors };
}

export function parseSpecialEventsState(
  raw: unknown,
  path: string = `GET ${STATE_PATH}`,
): SpecialEventsState {
  const o = readObject(raw, path, 'a state');
  const status = o.status;
  if (typeof status !== 'string' || !RUN_STATUSES.includes(status as EventRunStatus)) {
    fail(path, `'status' must be one of ${RUN_STATUSES.join('|')}, got ${JSON.stringify(status)}`);
  }

  const nullableString = (key: string): string | null => {
    const v = o[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') fail(path, `'${key}' must be a string or null, got ${JSON.stringify(v)}`);
    return v as string;
  };

  const nullableSeconds = (key: string): number | null => {
    const v = o[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      fail(path, `'${key}' must be a finite number or null, got ${JSON.stringify(v)}`);
    }
    return Math.max(0, v as number);
  };

  const endedRaw = nullableString('endedReason');
  if (endedRaw !== null && !END_REASONS.includes(endedRaw as EventEndReason)) {
    fail(path, `'endedReason' must be one of ${END_REASONS.join('|')}, got ${JSON.stringify(endedRaw)}`);
  }

  if (o.timelineLeaseHeld !== undefined && typeof o.timelineLeaseHeld !== 'boolean') {
    fail(path, `'timelineLeaseHeld' must be a boolean, got ${JSON.stringify(o.timelineLeaseHeld)}`);
  }

  return {
    status: status as EventRunStatus,
    showId: nullableString('showId'),
    currentStageId: nullableString('stageId'),
    armedStageId: nullableString('armedStageId'),
    choiceId: nullableString('choiceId'),
    countdownSec: nullableSeconds('countdownSec'),
    stageElapsedSec: nullableSeconds('stageElapsedSec'),
    endedReason: endedRaw as EventEndReason | null,
    endedDetail: nullableString('endedDetail'),
    error: nullableString('lastError'),
    leaseHeld: o.timelineLeaseHeld === true,
    autopilot: parseAutopilotState(o.autopilot, path),
    catalog: parseEventCatalog(o, path),
  };
}

/**
 * Pull the state document out of a `specialEvents` WS frame.
 *
 * The engine broadcasts FLAT (`{ type, ...state }`, the `timelineState` idiom);
 * a document nested under `state` is accepted as the same contract in a
 * different envelope. Anything else THROWS — a frame we cannot read must reach
 * the operator as an error, not leave the tab painting a stale stage.
 */
export function parseSpecialEventsFrame(msg: unknown): SpecialEventsState {
  const path = `WS ${SPECIAL_EVENTS_WS_TYPE}`;
  const o = readObject(msg, path, 'a frame');
  const nested = o.state;
  if (nested !== undefined && nested !== null) {
    return parseSpecialEventsState(nested, path);
  }
  return parseSpecialEventsState(o, path);
}

/** Every mutation answers `{ status: 'ok', state }`. Read the state out of it. */
function parseMutationEnvelope(raw: unknown, path: string): SpecialEventsState {
  const o = readObject(raw, path, 'a mutation response');
  if (o.state === undefined || o.state === null) {
    fail(path, `expected a 'state' document in the response, got ${JSON.stringify(raw)}`);
  }
  return parseSpecialEventsState(o.state, path);
}

// ── Transport ─────────────────────────────────────────────────────────────

function refusal<T>(status: number, body: any): ApiResult<T> {
  return {
    ok: false,
    error: (body && body.error) || `HTTP ${status}`,
    code: body && typeof body.code === 'string' ? body.code : undefined,
    data: body,
    status,
  };
}

async function eventsGet<T>(path: string, parse: (raw: unknown) => T): Promise<ApiResult<T>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`);
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) return refusal<T>(res.status, body);
    return { ok: true, data: parse(body), status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

async function eventsPost(
  path: string,
  body?: unknown,
  // Per-request headers ONLY. The passcode reaches this function as an argument
  // and is gone when the fetch settles — see the ARM note in the header.
  extraHeaders?: Record<string, string>,
): Promise<ApiResult<SpecialEventsState>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) return refusal<SpecialEventsState>(res.status, data);
    return { ok: true, data: parseMutationEnvelope(data, `POST ${path}`), status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

export function fetchEventCatalog(): Promise<ApiResult<EventCatalog>> {
  return eventsGet(BASE_PATH, (raw) => parseEventCatalog(raw));
}

export function fetchSpecialEventsState(): Promise<ApiResult<SpecialEventsState>> {
  return eventsGet(STATE_PATH, (raw) => parseSpecialEventsState(raw));
}

/**
 * ARM a show. In performance mode the engine refuses without a FRESH operator
 * passcode (ARM engages the takeover lease); `passcode` is attached to this one
 * request's headers and never stored anywhere.
 */
export async function armSpecialEvent(
  showId: string,
  auth?: OperatorAuthSendInput,
): Promise<ApiResult<SpecialEventsState>> {
  const base = await getApiBaseAsync();
  const requestUrl = `${base}${ARM_PATH}`;
  const headers = await operatorAuthHeaders(auth || {});
  const result = await eventsPost(ARM_PATH, { show: showId }, headers);
  await clearOperatorAuthOnRefusal(headers, result.status, requestUrl);
  return result;
}

export function fireSpecialEventStage(
  stageId: string,
  choiceId?: string,
): Promise<ApiResult<SpecialEventsState>> {
  const body: { stageId: string; choiceId?: string } = { stageId };
  if (choiceId !== undefined) body.choiceId = choiceId;
  return eventsPost(FIRE_PATH, body);
}

/**
 * Pulse a quick effect (STROBE / VINTAGE WHITE / FLASH ALL WHITE / UV BLAST).
 * The engine resolves the id against the CURRENT stage and refuses otherwise,
 * so the id alone is the whole request.
 */
export function fireSpecialEventQuickEffect(effectId: string): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(QUICK_EFFECT_PATH, { id: effectId });
}

export function extendSpecialEvent(): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(EXTEND_PATH, {});
}

export function finishSpecialEvent(): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(FINISH_PATH, {});
}

export function abortSpecialEvent(): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(ABORT_PATH, {});
}

/** Clear an `ended` banner once the operator has read it. */
export function dismissSpecialEvent(): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(DISMISS_PATH, {});
}

/**
 * Retune the LIVE stage's pattern rotation — cadence, shuffle, and the
 * crossfade between patterns.
 *
 * Sparse: send only what changed. The engine merges the patch into a per-stage
 * override that outlives the run, so tuning done at the rail is still there the
 * next night. It refuses (409 / 400) when no stage is running or when the live
 * stage authors no rotation, which is why the tab never has to guess.
 */
export function setSpecialEventAutopilot(
  patch: EventAutopilotPatch,
): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(AUTOPILOT_PATH, patch);
}

/** Drop the live override and go back to what the show file authored. */
export function resetSpecialEventAutopilot(): Promise<ApiResult<SpecialEventsState>> {
  return eventsPost(AUTOPILOT_PATH, { reset: true });
}

/**
 * The operator-facing sentence for a refused action. The engine's own message
 * is ALWAYS carried; this only prepends the meaning of the well-known codes so
 * "409" reads as "you tapped a stage that is not next" at 2 a.m.
 */
export function describeEventRefusal(result: { error?: string; code?: string; status?: number }): string {
  const engineSays = result.error || `HTTP ${result.status ?? '???'}`;
  switch (result.code) {
    case STAGE_NOT_ARMED:
      return `Out of order — the engine only accepts the armed stage. ${engineSays}`;
    case EVENT_ACTIVE:
      return `A show is already armed or running. ${engineSays}`;
    case NO_EVENT_ARMED:
      return `No show is armed. ${engineSays}`;
    case NO_STAGE_RUNNING:
      return `No stage is running yet — fire the stage first. ${engineSays}`;
    case QUICK_EFFECT_NOT_FOUND:
      return `That quick effect does not belong to the stage that is live. ${engineSays}`;
    case CHOICE_REQUIRED:
      return `This stage needs one of its choice buttons, not the stage itself. ${engineSays}`;
    case CHOICE_NOT_ALLOWED:
      return `This stage takes no choice. ${engineSays}`;
    case NO_EXTEND:
      return `Nothing to extend on the stage that is live. ${engineSays}`;
    case SPECIAL_EVENT_PLAYLIST_MISSING:
      return `The show needs a playlist this scene does not have. ${engineSays}`;
    case ARM_FAILED:
      return `ARM was rolled back — nothing was changed on the rig. ${engineSays}`;
    case NO_STAGE_AUTOPILOT:
      return `This stage does not rotate patterns — its show file authors no autopilot. ${engineSays}`;
    case AUTOPILOT_INVALID:
      return `The engine refused those autopilot settings. ${engineSays}`;
    case SPECIAL_EVENT_LOCK:
      return `A special event owns the deck right now. ${engineSays}`;
    default:
      return engineSays;
  }
}
