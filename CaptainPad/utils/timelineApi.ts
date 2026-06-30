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

export interface TimelineRecentFire {
  cueId: string;
  atMs: number;
  reason: string;
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

// Pending-program lease (docs/38 §16.5 / §16.7): a program cue is due while the
// deck is in MANUAL; the engine arms a lease and CaptainPad shows the
// "SCHEDULED SHOW PENDING" sign with a countdown until `expiresAtMs` (when the
// lease auto-starts the program). One lease at a time; null when none is armed.
export interface TimelinePendingProgram {
  cueId: string;
  label: string;
  expiresAtMs: number;
}

export type TimelineMode = 'armed' | 'paused' | 'holding' | 'overridden';
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
  // The armed pending-program lease (docs/38 §16.5), or null when none is due.
  pendingProgram: TimelinePendingProgram | null;
  // True when the controller is autopilot/program AND the mode is not
  // paused/overridden — i.e. the plan is actively driving the rig. This is the
  // primary "plan is live" signal the deck/mixer plan indicator reads.
  planActive: boolean;
  // True when the plan is active AND the output view is pinned to the DECK
  // under plan control (the plan is forcing the deck output). When this is set,
  // the operator manually switching to the mixer must be gated by a takeover
  // confirm (the CP-VIEWSWITCH feature) rather than silently stealing the
  // output from the running plan. The engine does NOT auto-take-over on a view
  // change — taking over is the explicit POST /timeline/takeover.
  forcingDeckView: boolean;
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
export type DeckTransitionMode = 'trans_crossfade' | 'trans_flash' | 'trans_dissolve';

export const DECK_TRANSITION_MODES: DeckTransitionMode[] = [
  'trans_crossfade',
  'trans_flash',
  'trans_dissolve',
];

export const DECK_TRANSITION_MODE_LABEL: Record<DeckTransitionMode, string> = {
  trans_crossfade: 'Crossfade',
  trans_flash: 'Flash',
  trans_dissolve: 'Dissolve',
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
}

export interface ActionPlaylist {
  type: 'playlist';
  name: string;
  target?: PlanTarget;
  autopilot?: PlanAutopilotInline;
  // Deck transition override (deck target only). Absent = inherit the deck's
  // standing transition config.
  transition?: ActionTransition;
  // Cue-level overlay intent (deck target only). Absent = leave as-is.
  overlays?: ActionOverlays;
}
export interface ActionGlobals { type: 'globals'; set: Record<string, unknown> }
// NOTE: the engine also validates a `scene` action, but the maker deliberately
// does NOT author it — a scene switch RESTARTS the engine, which is dangerous
// and irrelevant inside the timeline maker. So `scene` is omitted from this
// union (the maker never emits it; the engine still accepts hand-authored ones).
export type CueAction = ActionLook | ActionPlaylist | ActionGlobals;

export interface PlanTarget { channel: 'deck' | 'mixer' | 'all'; id: string | null }
export interface PlanAutopilotInline { active?: boolean; delay_s?: number; shuffle?: boolean }

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

export interface ShowPlan {
  schemaVersion: 2;
  name: string;
  location: PlanLocation;
  festival: PlanFestival;
  autopilot: PlanAutopilot;
  looks: Record<string, PlanLook>;
  phases: Record<string, PlanPhase>;
  cues: PlanCue[];
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

export function setTimelineMode(mode: 'armed' | 'paused'): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/mode', { mode });
}

export function setTimelineAutopilot(enabled: boolean): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/autopilot', { enabled });
}

export function holdTimeline(minutes: number): Promise<ApiResult<unknown>> {
  return timelineSend('POST', '/timeline/hold', { minutes });
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
