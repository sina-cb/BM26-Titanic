// groupsSoloApi — typed engine clients for the WAVE 15 (2026-06-20) channel
// groups (gang-faders) + server-authoritative solo / solo-safe feature
// (docs/39 §10). The engine is the AUTHORITY: group CRUD + membership + solo
// are mutate→saveAllState→broadcastMixerState on the engine; the client render
// dim/active state is DISPLAY-ONLY, reconciled from the `mixer` broadcast's
// `soloedChannelIds[]` + per-channel `mixGroupId`/`soloSafe` on every frame.
//
// File ownership (multi-agent wave): the shared utils/api.ts is owned by a
// different agent, so these clients live in this dedicated file (mirroring
// channelExtrasApi.ts). The engine base URL is read through the dependency-
// free apiBase leaf module (same `${api_base}/...` live-binding pattern api.ts
// uses) — NOT by editing api.ts.
//
// Codex P0 — fail loud: every client honours `res.ok`. A non-2xx returns
// `{ ok: false, error }` (engine error body when present), never a fabricated
// `{ ok: true }`. The engine's documented failure bodies are surfaced verbatim
// so the caller can Alert on them — notably the group-membership 400s
// ("already in a different group" single-membership / deck `WRONG_ROLE`),
// the solo 400 (deck id) / 404 (unknown channel), and group 404 (unknown gid).

import { fetchWithTimeout, type ApiResult } from './api';
import { api_base } from './apiBase';

// ── Types ───────────────────────────────────────────────────────────────
// A mix group ("gang-fader"). `fader`/`muted` scale every member channel's
// contribution at composite time; `name`/`color` are operator-facing metadata.
export interface MixGroup {
  id: string;
  name: string | null;
  fader: number;
  muted: boolean;
  color: string | null;
}

// ── Groups ──────────────────────────────────────────────────────────────

/**
 * List all mix groups.
 * GET /mixer/groups → { mixGroups: [...] }.
 */
export async function fetchMixGroups(): Promise<ApiResult<MixGroup[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/groups`);
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    const groups = Array.isArray(data?.mixGroups) ? (data.mixGroups as MixGroup[]) : null;
    if (!groups) {
      return { ok: false, error: 'Malformed /mixer/groups response (expected { mixGroups: [] })' };
    }
    return { ok: true, data: groups };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Create a new mix group.
 * POST /mixer/groups { name?, color? } → 201 { status, group } (fader 1, muted false).
 */
export async function createMixGroup(
  opts?: { name?: string; color?: string | null },
): Promise<ApiResult<{ status: string; group: MixGroup }>> {
  try {
    const body: Record<string, unknown> = {};
    if (opts?.name !== undefined) body.name = opts.name;
    if (opts?.color !== undefined) body.color = opts.color;
    const res = await fetchWithTimeout(`${api_base}/mixer/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Update a mix group's fader / mute / name / color.
 * PATCH /mixer/groups/:gid { name?, fader?, muted?, color? } → 200 { status, group }.
 * `fader` validated by the engine (NaN ⇒ 400); unknown gid ⇒ 404.
 */
export async function updateMixGroup(
  gid: string,
  patch: { name?: string; fader?: number; muted?: boolean; color?: string | null },
): Promise<ApiResult<{ status: string; group: MixGroup }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/groups/${encodeURIComponent(gid)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Delete a mix group. The engine clears every member's `mixGroupId` first.
 * DELETE /mixer/groups/:gid → 200; unknown gid ⇒ 404.
 */
export async function deleteMixGroup(gid: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/groups/${encodeURIComponent(gid)}`,
      { method: 'DELETE' },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Add a channel to a group (single-membership).
 * POST /mixer/groups/:gid/members { channelId } → 200.
 * Fail-loud bodies surfaced verbatim:
 *   400 — missing channelId, the channel is the DECK (`WRONG_ROLE`), or the
 *         channel is already in a DIFFERENT group (single membership).
 *   404 — unknown gid / unknown channel.
 * Re-adding to the SAME group is an idempotent 200.
 */
export async function addChannelToGroup(
  gid: string,
  channelId: string,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/groups/${encodeURIComponent(gid)}/members`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Remove a channel from a group (idempotent clear of `mixGroupId`).
 * DELETE /mixer/groups/:gid/members/:channelId → 200; unknown gid/channel ⇒ 404.
 */
export async function removeChannelFromGroup(
  gid: string,
  channelId: string,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/groups/${encodeURIComponent(gid)}/members/${encodeURIComponent(channelId)}`,
      { method: 'DELETE' },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Solo (server-authoritative) ───────────────────────────────────────────
// `PatternMixer.soloedChannelIds` is the SOLE source of truth. These REST
// clients are the durability mirror; the low-latency path is the WS
// setSolo/clearSolo message (see engineEvents.send in mixer.tsx). Either way
// the client reconciles the dim/active display from the broadcast's
// `soloedChannelIds[]` — it NEVER mutates sibling enabled/fader.

/**
 * Solo a channel.
 * POST /mixer/solo { channelId, additive? } → 200 { status, soloedChannelIds }.
 * `additive:true` adds to the set; otherwise REPLACES it. 404 unknown / 400 deck.
 */
export async function postSolo(
  channelId: string,
  additive: boolean = false,
): Promise<ApiResult<{ status?: string; soloedChannelIds: string[] }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/solo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, additive }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Un-solo a single channel.
 * DELETE /mixer/solo/:channelId → 200 { soloedChannelIds }; 404 unknown.
 */
export async function deleteSolo(
  channelId: string,
): Promise<ApiResult<{ soloedChannelIds: string[] }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/solo/${encodeURIComponent(channelId)}`,
      { method: 'DELETE' },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Clear ALL solos.
 * DELETE /mixer/solo → 200 { soloedChannelIds: [] }.
 */
export async function clearAllSolo(): Promise<ApiResult<{ soloedChannelIds: string[] }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/solo`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Solo-safe (rig-config flag) ───────────────────────────────────────────
// `soloSafe` (default false) protects a channel from being gated off by
// ANOTHER channel's solo (protects the mission-critical exterior). Set through
// the SAME PATCH /mixer/channels/:id the rest of the mixer uses. This thin
// wrapper pins the single boolean field. Persisted like `faderLocked`.

export async function setChannelSoloSafe(
  channelId: string,
  soloSafe: boolean,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soloSafe }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
