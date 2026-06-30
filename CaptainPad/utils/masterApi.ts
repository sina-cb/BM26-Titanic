// masterApi — grand-master timed-fade client.
//
// Thin typed wrapper around the engine's `POST /mixer/master/fade`
// route (docs/39_channels_deck_mixer.md §8.2 — F-B). The engine fades
// `master` toward `target` over `durationMs` on the 40 Hz render tick;
// a direct `PATCH /mixer { master }` (updateMixerMaster) cancels any
// in-flight fade so the operator's hand always wins.
//
// Ownership note (multi-agent wave): the shared engine-base resolver
// lives in the dependency-free leaf module `apiBase.ts`, so we import
// `api_base` from there directly — NOT by editing or duplicating
// `utils/api.ts` (owned by another agent this wave). `fetchWithTimeout`
// and the `ApiResult<T>` shape ARE owned by `api.ts`; we import them
// (read-only — importing does not mutate the module) so this client
// behaves identically to every other CaptainPad client: an 8 s timeout
// and a structured `{ ok, data?, error? }` result.

import { api_base } from './apiBase';
import { fetchWithTimeout, type ApiResult } from './api';

/**
 * Animate the grand master from its current value toward `target` over
 * `durationMs` on the engine's 40 Hz tick. `target:0` is a timed
 * blackout; a non-zero target is a timed restore.
 *
 * Codex P0 — fail loud: the engine rejects a non-finite / out-of-range
 * `target` or a `durationMs <= 0` with a 400, and we surface that
 * rejection (`{ ok:false, error }`) instead of fabricating success.
 * Callers MUST honor `res.ok` (Alert / console.error) — no silent
 * swallow.
 *
 * @param target     finite number in [0,1] — the master value to land on.
 * @param durationMs finite number > 0 — fade duration in milliseconds.
 */
export async function fadeMaster(
  target: number,
  durationMs: number,
): Promise<ApiResult<{ status?: string; master?: number; masterFade?: unknown }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/master/fade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, durationMs }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Master fade request failed' };
  }
}
