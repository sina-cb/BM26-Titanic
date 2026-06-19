// timelineApi — Timeline Companion address resolution + REST helpers.
//
// The Timeline Companion (docs/38) is a SEPARATE server-side process from
// the engine. It listens on its OWN port (6965), not the engine's (6968).
// It runs on the SAME host as the engine, though — both come up together
// under the launcher on the rig — so we derive the timeline base URL from
// the operator-configured `api_base` by swapping ONLY the port to 6965.
//
// Why derive instead of hardcode 127.0.0.1: on the iPad `api_base` is the
// rig's LAN address (e.g. http://10.0.0.5:6968). Hardcoding localhost would
// point the iPad at itself and never reach the companion. Reusing the
// configured host means the timeline tab works wherever the engine tab
// works — same machine, just a different port.
//
// LEAF-ish module: it imports only the dependency-free apiBase resolver
// (same discipline as engineBus.ts) plus the shared fetch-with-timeout.

import { getApiBase, getApiBaseAsync } from './apiBase';
import { fetchWithTimeout, ApiResult } from './api';

export const TIMELINE_PORT = 6965;

/**
 * Rewrite an engine base URL (`http://host:6968`) to the timeline
 * companion base on the same host (`http://host:6965`). If the URL has
 * no port we still append :6965. Falls back to swapping a trailing
 * `:<digits>` so this works even if `URL` isn't polyfilled on a given
 * RN runtime.
 */
export function timelineBaseFromApiBase(apiBase: string): string {
  // Prefer the WHATWG URL parser when available (web + modern RN) — it
  // handles hosts, IPv6, and missing ports cleanly.
  try {
    const u = new URL(apiBase);
    u.port = String(TIMELINE_PORT);
    // URL keeps a trailing slash off the origin; strip any path so we
    // get a clean origin to append routes onto.
    return `${u.protocol}//${u.host}`;
  } catch {
    // Defensive fallback: regex-swap a trailing :<port>, else append.
    if (/:\d+$/.test(apiBase)) {
      return apiBase.replace(/:\d+$/, `:${TIMELINE_PORT}`);
    }
    return `${apiBase.replace(/\/+$/, '')}:${TIMELINE_PORT}`;
  }
}

/** Synchronous timeline base from the currently-resolved api_base. */
export function getTimelineBase(): string {
  return timelineBaseFromApiBase(getApiBase());
}

/**
 * Await this before the first timeline network call so we don't race
 * AsyncStorage resolving the operator-overridden api_base on cold boot
 * (mirrors getApiBaseAsync's contract).
 */
export async function getTimelineBaseAsync(): Promise<string> {
  const base = await getApiBaseAsync();
  return timelineBaseFromApiBase(base);
}

/** ws://host:6965/ws derived from the resolved api_base. */
export async function getTimelineWsUrlAsync(): Promise<string> {
  const base = await getTimelineBaseAsync();
  return `${base.replace(/^http/, 'ws')}/ws`;
}

// ── Wire types (the companion contract, docs/38 §7) ────────────────────

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

export type TimelineMode = 'armed' | 'paused' | 'holding' | 'overridden';

export interface TimelineState {
  mode: TimelineMode;
  scene: string | null;
  activePlan: string | null;
  currentPhase: string | null;
  currentMood: string | null;
  party: boolean;
  moodValue: number;
  engineConnected: boolean;
  nextCue: TimelineNextCue | null;
  sun: TimelineSun;
  phases: Record<string, TimelinePhaseWindow>;
  cues: TimelineCue[];
  recentFires: TimelineRecentFire[];
  lastError: string | null;
}

// ── REST helpers ───────────────────────────────────────────────────────
// Same {ok, data, error} envelope the engine `api.ts` helpers return so
// the hook + tab handle failures uniformly. We surface the companion's
// `{error}` body verbatim on non-2xx (Codex P0: fail loud, no fallback).

async function timelineGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const base = await getTimelineBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Timeline companion unreachable' };
  }
}

async function timelinePost<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const base = await getTimelineBaseAsync();
    const res = await fetchWithTimeout(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Some POSTs may return an empty body; tolerate that without
    // pretending success on a non-2xx.
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) return { ok: false, error: (data && data.error) || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Timeline companion unreachable' };
  }
}

export function fetchTimelineState(): Promise<ApiResult<TimelineState>> {
  return timelineGet<TimelineState>('/state');
}

export function fetchTimelinePlans(): Promise<ApiResult<string[]>> {
  return timelineGet<string[]>('/plans');
}

export function activateTimelinePlan(name: string): Promise<ApiResult<unknown>> {
  return timelinePost('/plan/activate', { name });
}

export function setTimelineMode(mode: 'armed' | 'paused'): Promise<ApiResult<unknown>> {
  return timelinePost('/mode', { mode });
}

export function holdTimeline(minutes: number): Promise<ApiResult<unknown>> {
  return timelinePost('/hold', { minutes });
}

export function resumeTimeline(): Promise<ApiResult<unknown>> {
  return timelinePost('/resume');
}

export function fireTimelineCue(id: string): Promise<ApiResult<unknown>> {
  return timelinePost(`/cues/${encodeURIComponent(id)}/fire`);
}
