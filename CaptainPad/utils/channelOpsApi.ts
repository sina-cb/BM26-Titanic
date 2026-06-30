// channelOpsApi — typed engine clients for the 2026-06-20 channel-ops cluster
// (docs/39 §6b): #6 duplicate an overlay, #7 reorder the overlay stack, and
// #9 panic/home (mission-critical safe LIT reset). The engine side merged on
// `dev/channel_ops_engine`; the EXACT API surface is captured in
// `.agent/02_reports/202606/20260620_22_channel_ops_engine.md`.
//
// File ownership (multi-agent wave): the shared utils/api.ts is owned by a
// different agent, so these clients live in this dedicated file (mirroring
// channelExtrasApi.ts + groupsSoloApi.ts). The engine base URL is read through
// the dependency-free apiBase leaf module (same `${api_base}/...` live-binding
// pattern api.ts uses) — NOT by editing api.ts.
//
// Codex P0 — fail loud: every client honours `res.ok`. A non-2xx returns
// `{ ok: false, error }` (the engine error body when present, plus the raw
// `data` so the caller can read structured codes), never a fabricated
// `{ ok: true }`. The engine's documented failure bodies are surfaced verbatim
// so the caller can Alert on them — notably duplicate's over-cap / deck
// (WRONG_ROLE) 400 + missing-source 404, reorder's `REORDER_BAD_SET` 400, and
// panic's `PANIC_HOME_MALFORMED` / `PANIC_HOME_RECALL_FAILED` 400 (the ONE
// sanctioned loud fallback — the rig STAYS LIT, `rigLit:true`).

import { fetchWithTimeout, type ApiResult } from './api';
import { api_base } from './apiBase';

// ── #6 Duplicate ──────────────────────────────────────────────────────────
// Deep-copies a mixer overlay into a NEW overlay that lands on TOP of the
// stack (inherits faderMax/color/mixGroupId/soloSafe/viewSelection/locks/
// transition prefs via the serialized blob; fresh compiled WASM handle). The
// new channel arrives via the `mixer` WS broadcast — the caller reconciles the
// strip list from that, NOT from this response (which is just the seed +
// confirmation). Over-cap or the deck id ⇒ 400; a missing source id ⇒ 404.

export interface DuplicateChannelResult {
  status: string;
  channelId: string;
  sourceChannelId: string;
  pattern?: string;
  playlist?: string;
  playlistData?: any;
}

/**
 * Duplicate a mixer overlay.
 * POST /mixer/channels/:id/duplicate (no body) → 200 DuplicateChannelResult.
 *   400 — the id is the DECK (WRONG_ROLE) OR the mixer is at capacity
 *         ("Maximum of N mixer channels allowed").
 *   404 — { error: "mixer channel '<id>' not found" }.
 */
export async function duplicateMixerChannel(
  channelId: string,
): Promise<ApiResult<DuplicateChannelResult>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/channels/${encodeURIComponent(channelId)}/duplicate`,
      { method: 'POST' },
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

// ── #7 Reorder ────────────────────────────────────────────────────────────
// Reassigns the overlay stack order. `orderIds` MUST be a permutation of the
// CURRENT overlay ids (exact same set, exact length, no dups) — validated by
// the engine BEFORE any mutation; any deviation ⇒ 400 REORDER_BAD_SET (no
// partial apply). `order[0]` = BOTTOM of the mix (seed layer), `order[last]` =
// TOP. Accepted mid-transition (no 409). The applied order arrives on the
// `mixer` broadcast — the caller reconciles from that.

export interface ReorderChannelsResult {
  status: string;
  order: string[];
}

/**
 * Reorder the mixer overlay stack.
 * POST /mixer/channels/reorder { order: [ids] } → 200 { status, order }.
 *   400 — { error, code:'REORDER_BAD_SET' } (not array / wrong length / dup /
 *         unknown id).
 */
export async function reorderMixerChannels(
  orderIds: string[],
): Promise<ApiResult<ReorderChannelsResult>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderIds }),
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

// ── #9 Panic / Home ───────────────────────────────────────────────────────
// Mission-critical: ALWAYS leaves the rig LIT. `home` defaults to true on the
// engine — passing it explicitly keeps the wire shape honest. Effect: master→
// 1.0 (in-flight master fade cancelled), blackout cleared, deck-swap cancelled,
// all overlay transitions cancelled, solo cleared, groups un-muted, overlays
// enabled@1.0 (faderLocked + faderMax respected), view→mixer. If a snapshot
// named `home` exists it is recalled; else a safe LIT default is applied. The
// engine broadcasts fresh mixer/deck/globals — the caller reconciles from those.
//
// THE ONE sanctioned loud fallback: a malformed / over-cap `home` snapshot
// returns 400 (`PANIC_HOME_MALFORMED` / `PANIC_HOME_RECALL_FAILED`) BUT the rig
// is STILL lit (blackout cleared + master up). The 400 carries `rigLit:true`;
// the caller should Alert that the home look couldn't load while reassuring the
// operator the rig is lit.

export interface PanicResult {
  status: string;
  mode: 'home' | 'safeDefault';
  home?: string;
  rigLit: boolean;
}

/**
 * Panic the mixer to a safe LIT state (recalling `home` when present).
 * POST /mixer/panic { home? } → 200 PanicResult.
 *   400 — { error, code:'PANIC_HOME_MALFORMED'|'PANIC_HOME_RECALL_FAILED',
 *         rigLit:true } — broken/over-cap home; the rig is STILL lit.
 */
export async function panicMixer(home?: boolean): Promise<ApiResult<PanicResult>> {
  try {
    const body = home === undefined ? {} : { home };
    const res = await fetchWithTimeout(`${api_base}/mixer/panic`, {
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
