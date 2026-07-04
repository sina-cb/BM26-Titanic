// timelineApi — Timeline REST helpers.
//
// docs/38 §15: the Timeline runs IN the engine now (no separate :6965
// companion process). Its REST surface lives on the engine itself, under the
// `/timeline/*` prefix, on the operator-configured `api_base` (:6968). We no
// longer port-swap to 6965 — one origin, the engine.
//
// LEAF-ish module: it imports only the dependency-free apiBase resolver
// (same discipline as engineBus.ts) plus the shared fetch-with-timeout.

import { getApiBaseAsync } from './apiBase';
import { fetchWithTimeout, ApiResult } from './api';

// ── Wire types (the engine /timeline contract, docs/38 §7 + §14) ───────

export interface TimelineSun {
  sunrise?: string;
  sunset?: string;
  civilDusk?: string;
  civilDawn?: string;
  goldenHourStart?: string;
  goldenHourEnd?: string;
  solarNoon?: string;
  nauticalDusk?: string;
  [k: string]: string | undefined;
}

export interface TimelinePhaseWindow {
  start?: string;
  end?: string;
}

export interface TimelineNextCue {
  id: string;
  label: string;
  inSec: number;
}

export interface TimelineCue {
  id: string;
  label: string;
  trigger: string;
  enabled: boolean;
  nextInSec: number | null;
  lastError: string | null;
}

// One EVENT-LOG entry (engine `recentFires` ring — field name kept for wire
// compat). Pinned wire shape:
//   { kind:'fire'|'lifecycle', cueId?, label, reason, source, atMs }
// kind 'fire' = a cue application (manual/auto/catchUp/default source);
// kind 'lifecycle' = a plan/mode transition (activated, resumed,
// autopilot toggle, operator takeover/lease, program end, pending lease).
// kind/label/source are OPTIONAL so an older engine's plain fire entries
// ({cueId, atMs, reason}) still parse and render.
export interface TimelineRecentFire {
  cueId?: string | null;
  atMs: number;
  reason: string;
  kind?: 'fire' | 'lifecycle' | string;
  label?: string;
  source?: string; // 'manual' | 'auto' | 'catchUp' | 'default' | 'system' | …
}

export interface TimelineWouldFire {
  cueId: string;
  reason: string;
  controller?: string;
  atMs?: number;
}

export interface TimelineActiveProgram {
  cueId: string;
  startedAtMs: number;
  untilMs: number | null;
}

// The cue/event currently DRIVING the deck (a running program, else the cue
// that owns the deck window). Null when the autopilot baseline is driving and
// nothing cue-specific is active. Surfaced so the timeline tab AND the
// deck/mixer lock banner can name the live event.
export interface TimelineActiveCue {
  id: string;
  label: string;
  kind: 'cue' | 'program';
  /** Program hold / durationMin window end (epoch ms), or null when open-ended. */
  untilMs: number | null;
}

// Pending-program lease (docs/38 §16.5 / §16.7): a program cue is due while the
// deck is in MANUAL; the engine arms a lease and CaptainPad shows the
// "SCHEDULED SHOW PENDING" sign with a countdown until `expiresAtMs` (when the
// lease auto-starts the program). One lease at a time; null when none is armed.
export interface TimelinePendingProgram {
  cueId: string;
  label: string;
  expiresAtMs: number;
}

// armed = the plan drives the rig; overridden = an operator TEMPORARY TAKE OVER
// is active (auto-resumes via its lease). PAUSE and HOLD were removed on
// 2026-07-03 (takeover is the only manual interruption now).
export type TimelineMode = 'armed' | 'overridden';
export type TimelineController = 'autopilot' | 'program' | 'manual';

// Operator-takeover lease (the DECK/MIXER manual-override lease, distinct from
// the pending-program lease above). Non-null while an operator has taken the
// rig over from a running plan; `expiresAtMs` is the wall-clock at which the
// engine auto-releases (no UI activity for `operatorLeaseSec`) and the plan
// resumes at catchUp. Null when no takeover is held.
export interface TimelineOperatorLease {
  expiresAtMs: number;
}

export interface TimelineState {
  mode: TimelineMode;
  scene: string | null;
  activePlan: string | null;
  // Control-precedence layer (docs/38 §14), now first-class in the engine.
  controller: TimelineController;
  autopilotEnabled: boolean;
  activeProgram: TimelineActiveProgram | null;
  // The event currently driving the deck (program or deck-window cue), or null
  // when only the autopilot baseline is driving. See TimelineActiveCue.
  activeCue: TimelineActiveCue | null;
  // The armed pending-program lease (docs/38 §16.5), or null when none is due.
  pendingProgram: TimelinePendingProgram | null;
  // True when the controller is autopilot/program AND the mode is not
  // overridden (operator takeover) — i.e. the plan is actively driving the rig.
  // This is the primary "plan is live" signal the deck/mixer plan indicator reads.
  planActive: boolean;
  // True when the plan is active AND the output view is pinned to the DECK
  // under plan control (the plan is forcing the deck output). When this is set,
  // the operator manually switching to the mixer must be gated by a takeover
  // confirm (the CP-VIEWSWITCH feature) rather than silently stealing the
  // output from the running plan. The engine does NOT auto-take-over on a view
  // change — taking over is the explicit POST /timeline/takeover.
  forcingDeckView: boolean;
  // True when the active plan is "in time": it has NO festival block (recurring
  // nightly) OR today falls inside [festival.startDate, +days). The plan's
  // control-lock (yellow "PLAN IS RUNNING") ONLY engages in-window — out of
  // window the plan still exists/arms but does NOT lock the deck/mixer.
  inFestivalWindow: boolean;
  // Whole calendar days (plan tz) until festival.startDate, as a POSITIVE
  // integer when the plan has a festival and today is before it; otherwise null
  // (no festival, in-window, or already ended). Drives the plan-view-only
  // "plan active — starts in X days" note.
  festivalStartsInDays: number | null;
  // The operator-takeover lease (manual override of a running plan), or null
  // when no takeover is held. See TimelineOperatorLease.
  operatorLease: TimelineOperatorLease | null;
  // The configured inactivity window (config.yaml `timeline.operatorLeaseSec`),
  // e.g. 120. After this many seconds without UI activity the engine releases
  // the takeover lease and resumes the plan.
  operatorLeaseSec: number;
  currentPhase: string | null;
  currentMood: string | null;
  party: number | boolean;
  moodValue: number;
  engineConnected: boolean;
  nextCue: TimelineNextCue | null;
  sun: TimelineSun;
  phases: Record<string, TimelinePhaseWindow>;
  cues: TimelineCue[];
  recentFires: TimelineRecentFire[];
  wouldFire?: TimelineWouldFire[];
  lastError: string | null;
}

// ── REST helpers ───────────────────────────────────────────────────────
// Same {ok, data, error} envelope the engine `api.ts` helpers return so the
// hook + tab handle failures uniformly. We surface the engine's `{error}`
// body verbatim on non-2xx (Codex P0: fail loud, no fallback).

async function timelineGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, data, status: res.status };
    return { ok: true, data, status: res.status };
  } catch (err: any) {
    // Transport failure: no HTTP status (offline / timeout / DNS).
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

async function timelineSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    // Some responses may be empty; tolerate that without faking success on a
    // non-2xx.
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, data, status: res.status };
    return { ok: true, data, status: res.status };
  } catch (err: any) {
    // Transport failure: no HTTP status (offline / timeout / DNS).
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

// ── Plan v2 schema (the maker authors / POSTs these) ───────────────────
// Mirrors marsin_engine/lib/timeline/show_plan.js (validateShowPlan). We
// keep the action/trigger unions permissive (Record passthrough) so the
// maker can round-trip fields the UI doesn't expose yet without dropping
// them — the engine is the validator of record (Codex P0: fail loud there).

export type SunEvent =
  | 'sunrise' | 'sunset' | 'solarNoon'
  | 'civilDawn' | 'civilDusk'
  | 'nauticalDawn' | 'nauticalDusk'
  | 'goldenHourEnd' | 'goldenHourStart';

export interface PlanAnchorClock { clock: string }
export interface PlanAnchorSun { sun: SunEvent; offsetMin?: number }
export type PlanAnchor = PlanAnchorClock | PlanAnchorSun;

export type CueKind = 'program' | 'mood' | 'ambient';

export interface TriggerClock { type: 'clock'; at: string }
export interface TriggerSun { type: 'sun'; event: SunEvent; offsetMin?: number }
export interface TriggerPhase { type: 'phase'; phase: string }
export interface TriggerMood {
  type: 'mood';
  from: string;
  to: string;
  minDwellSec?: number;
  cooldownSec?: number;
  whenPhase?: string;
}
export interface TriggerManual { type: 'manual' }
export type CueTrigger = TriggerClock | TriggerSun | TriggerPhase | TriggerMood | TriggerManual;

export interface ActionLook { type: 'look'; look: string }

// Deck transition modes (mirrors the engine DeckTransitionConfig modes, see
// CaptainPad/utils/api.ts DeckTransitionConfig). The maker offers these on a
// playlist action whose target is the deck (the only target now).
export type DeckTransitionMode =
  | 'trans_crossfade'
  | 'trans_flash'
  | 'trans_color_burst'
  | 'trans_dissolve'
  | 'trans_wipe_right'
  | 'trans_wipe_left'
  | 'trans_wipe_down'
  | 'trans_diagonal_wipe'
  | 'trans_wave_sweep'
  | 'trans_iris'
  | 'trans_iris_close'
  | 'trans_diamond_wipe'
  | 'trans_split_horizontal'
  | 'trans_split_vertical'
  | 'trans_ripple_in'
  | 'trans_morse_blink';

export const DECK_TRANSITION_MODES: DeckTransitionMode[] = [
  'trans_crossfade',
  'trans_flash',
  'trans_color_burst',
  'trans_dissolve',
  'trans_wipe_right',
  'trans_wipe_left',
  'trans_wipe_down',
  'trans_diagonal_wipe',
  'trans_wave_sweep',
  'trans_iris',
  'trans_iris_close',
  'trans_diamond_wipe',
  'trans_split_horizontal',
  'trans_split_vertical',
  'trans_ripple_in',
  'trans_morse_blink',
];

export const DECK_TRANSITION_MODE_LABEL: Record<DeckTransitionMode, string> = {
  trans_crossfade: 'Crossfade',
  trans_flash: 'Flash',
  trans_color_burst: 'Burst',
  trans_dissolve: 'Dissolve',
  trans_wipe_right: 'Wipe Right',
  trans_wipe_left: 'Wipe Left',
  trans_wipe_down: 'Wipe Down',
  trans_diagonal_wipe: 'Diagonal',
  trans_wave_sweep: 'Wave',
  trans_iris: 'Iris Open',
  trans_iris_close: 'Iris Close',
  trans_diamond_wipe: 'Diamond',
  trans_split_horizontal: 'Bay Doors',
  trans_split_vertical: 'Curtain',
  trans_ripple_in: 'Ripple',
  trans_morse_blink: 'SOS',
};

// Cue-level overlay intent on a playlist (deck) action. Absent = leave the
// deck's overlays as-is; 'enable' honors the deck's configured overlays;
// 'disable' blacks all overlays out for this cue.
export type ActionOverlays = 'enable' | 'disable';

// Inline deck transition override on a playlist action. Only the maker's deck
// target emits this; `mode` is required when present, the rest optional. Shape
// matches the engine's playlist-action transition contract EXACTLY.
export interface ActionTransition {
  mode: DeckTransitionMode;
  durationMs?: number;
  enabled?: boolean;
  shuffle?: boolean;
}

// Color-autopilot block on a playlist (deck) action. Cycles the color
// palette over time, distinct from the pattern `autopilot` above. The
// engine's validator is strict: when present it requires active + a
// non-empty `palettes` list + delay_s>0 (+ optional shuffle). Shape matches
// the engine contract EXACTLY (deck target only).
export interface ActionColorAutopilot {
  active: boolean;
  palettes: string[];
  delay_s: number;
  shuffle?: boolean;
  // Crossfade duration (ms) on a palette switch; 0 = hard cut. Optional —
  // absent normalizes to 0 server-side (docs/39).
  transitionMs?: number;
}

export interface ActionPlaylist {
  type: 'playlist';
  name: string;
  target?: PlanTarget;
  autopilot?: PlanAutopilotInline;
  // Color-autopilot override (deck target only). Absent = no color cycling.
  colorAutopilot?: ActionColorAutopilot;
  // Deck transition override (deck target only). Absent = inherit the deck's
  // standing transition config.
  transition?: ActionTransition;
  // Cue-level overlay intent (deck target only). Absent = leave as-is.
  overlays?: ActionOverlays;
  // Global HUE SHIFT (degrees, 0–360) applied when the cue fires. DECK-ONLY:
  // the engine rejects `hue` on a non-deck target. Absent = leave hue as-is.
  hue?: number;
  // Global CPC knobs applied when the cue fires (DECK-ONLY): SPEED / SIZE
  // (0..1) and bpmSpeedSync (0|1, the SYNC toggle). Rig-wide — they route
  // through the same setParams path a look's `globals` uses. Absent = leave
  // globals as-is.
  globals?: { speed?: number; size?: number; bpmSpeedSync?: number };
}
export interface ActionGlobals { type: 'globals'; set: Record<string, unknown> }
// NOTE: the engine also validates a `scene` action, but the maker deliberately
// does NOT author it — a scene switch RESTARTS the engine, which is dangerous
// and irrelevant inside the timeline maker. So `scene` is omitted from this
// union (the maker never emits it; the engine still accepts hand-authored ones).
export type CueAction = ActionLook | ActionPlaylist | ActionGlobals;

export interface PlanTarget { channel: 'deck' | 'mixer' | 'all'; id: string | null }
export interface PlanAutopilotInline {
  active?: boolean;
  delay_s?: number;
  shuffle?: boolean;
  // Pattern-autopilot GROUP LOCALITY (deck daemon dwells inside a rolling
  // window of adjacent playlist entries). All optional; the engine clamps
  // groupSize/groupDwell on apply. Absent → the daemon's own defaults.
  groupMode?: boolean;
  groupSize?: number;
  groupDwell?: number;
}

export type CueDays = 'all' | number[] | string[];

export interface PlanCue {
  id: string;
  label?: string;
  kind?: CueKind;
  enabled?: boolean;
  trigger: CueTrigger;
  action: CueAction;
  hold?: { min: number } | { until: PlanAnchor };
  days?: CueDays;
  // Cue DURATION (minutes): a cue is an EVENT that owns the deck for this many
  // minutes after it fires. Optional; when present it must be > 0 (the engine
  // sibling validates that). Absent / <=0 → the cue is a point event with no
  // owned window (rendered as a marker, not a block, in the day overview).
  durationMin?: number;
}

export interface PlanLocation { lat: number; lon: number; tz: string; elevationM?: number }
export interface PlanFestival { startDate: string; days: number }
export interface PlanAutopilot {
  enabled: boolean;
  playlist?: string;
  delay_s: number;
  shuffle: boolean;
  target?: PlanTarget;
  // Whether mood swaps (calm→party) run during autopilot — a BOOLEAN flag, NOT a
  // mood-state string. The engine validateShowPlan rejects a non-boolean.
  mood?: boolean;
}
export interface PlanLook {
  playlist?: string;
  autopilot?: PlanAutopilotInline;
  palette?: string;
  globals?: Record<string, unknown>;
  tasks?: Record<string, unknown>;
  target?: PlanTarget;
}
export interface PlanPhase { start: PlanAnchor; end: PlanAnchor }

// Plan-level DEFAULT CUE (maker-seeded): the fallback the deck runs in the gaps
// BETWEEN planned cue windows, and whenever the plan is active but has no cues.
// It carries a deck playlist `action` (reusing the same action editor a cue
// uses) plus an optional `label`. It has NO trigger/kind/days — it is not a
// scheduled event, it is the standing fallback. Every maker-authored plan is
// seeded with one (blankPlan / brcStarterPlan).
export interface PlanDefaultCue {
  label?: string;
  action: CueAction;
}

export interface ShowPlan {
  schemaVersion: 2;
  name: string;
  location: PlanLocation;
  festival: PlanFestival;
  autopilot: PlanAutopilot;
  looks: Record<string, PlanLook>;
  phases: Record<string, PlanPhase>;
  cues: PlanCue[];
  // Maker-seeded fallback cue (see PlanDefaultCue). Optional on the wire so
  // hand-authored / legacy plans without one still validate.
  defaultCue?: PlanDefaultCue;
}

// ── Overview (the maker's backbone, GET active / POST draft) ────────────

export interface OverviewSun {
  sunrise: string | null;
  sunset: string | null;
  solarNoon: string | null;
  civilDusk: string | null;
  goldenHourStart: string | null;
  goldenHourEnd: string | null;
  [k: string]: string | null | undefined;
}

export interface OverviewCue {
  id: string;
  label: string;
  kind: CueKind;
  trigger: CueTrigger;
  action: CueAction;
  atLocal: string | null;
  // Cue DURATION (minutes) carried through from the plan cue. Present only for
  // cues that own a deck window; the overview strip renders these as time
  // blocks (start→start+durationMin) rather than point markers.
  durationMin?: number;
}

export interface OverviewDay {
  index: number;
  date: string;
  weekday: string;
  sun: OverviewSun;
  cues: OverviewCue[];
}

export interface TimelineOverview {
  plan: string | null;
  festival: PlanFestival | null;
  location: PlanLocation | null;
  days: OverviewDay[];
}

export function fetchTimelineState(): Promise<ApiResult<TimelineState>> {
  return timelineGet<TimelineState>('/timeline/state');
}

export function fetchTimelineOverview(): Promise<ApiResult<TimelineOverview>> {
  return timelineGet<TimelineOverview>('/timeline/overview');
}

// Overview of an UNSAVED draft plan — live maker preview. The engine
// validates first and returns 400 {error} on a malformed draft; we surface
// that verbatim so the operator sees the error loudly (Codex P0).
export function previewTimelineOverview(
  plan: ShowPlan,
  signal?: AbortSignal,
): Promise<ApiResult<TimelineOverview>> {
  return timelineSend<TimelineOverview>('POST', '/timeline/overview', plan, signal);
}

export function fetchTimelinePlans(): Promise<ApiResult<{ plans: string[] }>> {
  return timelineGet<{ plans: string[] }>('/timeline/plans');
}

export function fetchTimelinePlan(name: string): Promise<ApiResult<ShowPlan>> {
  return timelineGet<ShowPlan>(`/timeline/plans/${encodeURIComponent(name)}`);
}

export function saveTimelinePlan(plan: unknown): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/plans', plan);
}

export function putTimelinePlan(name: string, plan: unknown): Promise<ApiResult<unknown>> {
  return timelineSend('PUT', `/timeline/plans/${encodeURIComponent(name)}`, plan);
}

export function deleteTimelinePlan(name: string): Promise<ApiResult<unknown>> {
  return timelineSend('DELETE', `/timeline/plans/${encodeURIComponent(name)}`);
}

export function activateTimelinePlan(name: string): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/plan/activate', { name });
}

export function setTimelineAutopilot(enabled: boolean): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/autopilot', { enabled });
}

export function resumeTimeline(): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/resume');
}

export function endTimelineProgram(): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/program/end');
}

// Pending-program lease actions (docs/38 §16.5 / §16.7). No body; the engine
// returns the {ok} / {ok:false,error} envelope like the other program routes.
export function enableTimelineProgram(): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/program/enable');
}

export function dismissTimelineProgram(): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/program/dismiss');
}

export function fireTimelineCue(id: string): Promise<ApiResult<unknown>> {
  return timelineSend('POST', `/timeline/cues/${encodeURIComponent(id)}/fire`);
}

// ── Operator-takeover lease actions (DECK/MIXER manual override) ─────────
// The operator manipulates a manual control while a plan is driving the rig:
// the engine flips mode='overridden' / controller='manual' and arms a lease.
// Idempotent — re-firing re-arms/refreshes the lease. No body; the engine
// returns the standard {ok} / {ok:false,error} envelope (Codex P0: fail loud).
export function postTimelineTakeover(): Promise<ApiResult<{ operatorLease?: TimelineOperatorLease }>> {
  return timelineSend('POST', '/timeline/takeover');
}

// Refresh the takeover lease expiry to now+operatorLeaseSec IF a lease is held
// (mode overridden); a harmless no-op (still {ok:true}) otherwise. Throttle the
// caller — this should track real UI interaction, not fire on a fixed idle
// timer, so genuine inactivity actually expires the lease engine-side.
export function postTimelineActivity(): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/activity');
}
