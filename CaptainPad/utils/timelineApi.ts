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
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

async function timelineSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const base = await getApiBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Some responses may be empty; tolerate that without faking success on a
    // non-2xx.
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Engine unreachable' };
  }
}

export function fetchTimelineState(): Promise<ApiResult<TimelineState>> {
  return timelineGet<TimelineState>('/timeline/state');
}

export function fetchTimelinePlans(): Promise<ApiResult<{ plans: string[] }>> {
  return timelineGet<{ plans: string[] }>('/timeline/plans');
}

export function fetchTimelinePlan(name: string): Promise<ApiResult<unknown>> {
  return timelineGet<unknown>(`/timeline/plans/${encodeURIComponent(name)}`);
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
