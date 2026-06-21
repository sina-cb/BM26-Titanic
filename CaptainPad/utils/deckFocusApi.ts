// deckFocusApi — typed engine client for cue-to-deck (docs/39 §F-cue).
//
// Cue-to-deck lets the operator audition a MIXER overlay's pattern on the
// DECK preview buffer at 100% (PFL) before pushing it live. The engine's
// render path already honours `mixer.deckFocusChannelId`; this client just
// arms/clears it via `POST /deck/focus { channelId }`.
//
// File ownership (multi-agent wave): this slice owns this NEW file. The
// shared utils/api.ts is owned by a different agent, so this client lives
// here and reads the engine base through the dependency-free apiBase leaf
// module (same `${api_base}/...` live-binding pattern api.ts uses).
//
// Codex P0 — fail loud: honours `res.ok`. A non-2xx returns
// `{ ok: false, error }` with the engine error body when present, never a
// fabricated `{ ok: true }`. The engine surfaces 404 (no such overlay) and
// 400 (the deck channel itself / malformed channelId) which this client
// passes through verbatim so the caller can Alert on them.

import { fetchWithTimeout, type ApiResult } from './api';
import { api_base } from './apiBase';

/**
 * Cue a mixer overlay onto the deck preview buffer (PFL @ 100%), or clear
 * the cue (restore the canonical deck view) by passing `null`.
 *
 * POST /deck/focus { channelId } → { status, deckFocusChannelId }.
 * Returns the engine-confirmed focus id (or null when cleared) on success.
 */
export async function setDeckFocus(channelId: string | null): Promise<ApiResult<string | null>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    const focus = (data && typeof data.deckFocusChannelId === 'string')
      ? (data.deckFocusChannelId as string)
      : null;
    return { ok: true, data: focus };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'request failed' };
  }
}
