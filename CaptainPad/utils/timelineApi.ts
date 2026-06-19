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

export type TimelineMode = 'armed' | 'paused' | 'holding' | 'overridden';
export type TimelineController = 'autopilot' | 'program' | 'manual';

export interface TimelineState {
  mode: TimelineMode;
  scene: string | null;
  activePlan: string | null;
  // Control-precedence layer (docs/38 §14), now first-class in the engine.
  controller: TimelineController;
  autopilotEnabled: boolean;
  activeProgram: TimelineActiveProgram | null;
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
export interface ActionPlaylist {
  type: 'playlist';
  name: string;
  target?: PlanTarget;
  autopilot?: PlanAutopilotInline;
}
export interface ActionScene { type: 'scene'; scene: string }
export interface ActionGlobals { type: 'globals'; set: Record<string, unknown> }
export type CueAction = ActionLook | ActionPlaylist | ActionScene | ActionGlobals;

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
  mood?: string;
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

export function fireTimelineCue(id: string): Promise<ApiResult<unknown>> {
  return timelineSend('POST', `/timeline/cues/${encodeURIComponent(id)}/fire`);
}
