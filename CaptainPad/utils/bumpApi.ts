// bumpApi — typed engine client for round-2 #5 FLASH / BUMP (momentary
// "full while held" accent per channel). docs/39 §10.7. The engine is the
// AUTHORITY: `PatternMixer._bumpedChannelIds` (a transient Set) is the SOLE
// source of truth. While a channel is bumped its effective output is overridden
// to FULL (capped only by faderMax), then snaps back to its parked level on
// release.
//
// Dual-path, mirroring groupsSoloApi's solo clients:
//   - LOW-LATENCY path is the WS `{ type:'bump', channelId }` /
//     `{ type:'unbump', channelId? }` message (engineEvents.send in mixer.tsx)
//     — this is what a held button uses, re-sent on a renew cadence so the
//     engine's disconnect lease stays alive.
//   - This REST client is the DURABILITY mirror (POST
//     /mixer/channels/:id/bump {on}). Either way the client reconciles its
//     "held" display from the broadcast's `bumpedChannelIds[]`.
//
// File ownership (multi-agent wave): the shared utils/api.ts + utils/
// groupsSoloApi.ts are owned by other agents, so this client lives in its own
// dedicated leaf file. The engine base URL is read through the dependency-free
// apiBase module (same live-binding pattern api.ts uses) — NOT by editing api.ts.
//
// Codex P0 — fail loud: every client honours `res.ok`. A non-2xx returns
// `{ ok:false, error }` (engine error body when present), never a fabricated
// `{ ok:true }`. The engine's documented failure bodies are surfaced verbatim:
// the bump 404 (unknown channel), the 400 (deck id WRONG_ROLE), and the 400
// (`on` missing / non-boolean).

import { fetchWithTimeout, type ApiResult } from './api';
import { api_base } from './apiBase';

/**
 * Bump (on:true → flash to full) or release (on:false → back to parked) a
 * channel. POST /mixer/channels/:id/bump { on } → 200 { status, bumpedChannelIds }.
 * 404 unknown channel / 400 deck id / 400 bad `on`.
 *
 * The REST durability mirror of the WS bump/unbump. Each on:true also RENEWS
 * the engine's release-on-disconnect lease.
 */
export async function postBump(
  channelId: string,
  on: boolean,
): Promise<ApiResult<{ status?: string; bumpedChannelIds: string[] }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/channels/${encodeURIComponent(channelId)}/bump`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
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
