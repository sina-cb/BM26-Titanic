// deckOverlaysApi — typed engine clients for DECK DYNAMIC VIEW OVERRIDES
// (engine #deck-overlays, merged at 2185d64 on feat/optimize_channels).
//
// A deck overlay is a view-scoped overlay deck layered OVER the main deck:
// it owns its own VIEW (required, never "all"), its own playlist, a blend
// mode (screen/add/over), a fader, and an accent `color`. Overlays stack
// (order[0]=bottom … order[last]=top), cap at 4, and auto-cycle on ONE
// SHARED autopilot cadence for the whole group (NOT per-overlay).
//
// File ownership (multi-agent wave): the shared utils/api.ts polymorphic
// playlist helpers were extended with a `deckOverlay` ChannelRole so the
// reused PlaylistPanel can drive an overlay's playlist; the CRUD / reorder /
// shared-autopilot writes live here (mirroring channelExtrasApi.ts) instead
// of bloating api.ts. The engine base URL is read through the dependency-free
// apiBase leaf module — same live-binding pattern api.ts uses.
//
// Codex P0 — fail loud: every client honours `res.ok`. A non-2xx returns
// { ok:false, error, data } carrying the engine error body (incl. the 4xx
// `code`) VERBATIM so the caller can Alert on the specific code:
//   - DECK_OVERLAY_VIEW_REQUIRED (400) — viewSelection missing / "all".
//   - DECK_OVERLAY_VIEW_TAKEN    (409) — another overlay already owns the view.
//   - DECK_OVERLAY_OVER_CAP      (400) — would exceed the 4-overlay cap.
//   - REORDER_BAD_SET            (400) — reorder ids aren't a permutation.
//   - AUTOCYCLE_BAD_DELAY        (400) — shared-autopilot delay floor is 1s.

import { fetchWithTimeout, type ApiResult, type PlaylistAssignment } from './api';
import { api_base } from './apiBase';

// ── Engine error codes (surfaced VERBATIM via data.code) ──────────────────
export const DECK_OVERLAY_VIEW_REQUIRED = 'DECK_OVERLAY_VIEW_REQUIRED';
export const DECK_OVERLAY_VIEW_TAKEN = 'DECK_OVERLAY_VIEW_TAKEN';
export const DECK_OVERLAY_OVER_CAP = 'DECK_OVERLAY_OVER_CAP';
export const REORDER_BAD_SET = 'REORDER_BAD_SET';
export const AUTOCYCLE_BAD_DELAY = 'AUTOCYCLE_BAD_DELAY';

/** The engine's hard cap on simultaneous deck overlays. */
export const DECK_OVERLAY_MAX = 4;

/** Only steady channel-blend modes are valid for an overlay (no trans_*). */
export const DECK_OVERLAY_BLEND_MODES = ['blend_screen', 'blend_add', 'blend_over'] as const;
export type DeckOverlayBlendMode = (typeof DECK_OVERLAY_BLEND_MODES)[number];

// ── Types ─────────────────────────────────────────────────────────────────
// An overlay is serialized with the full channel shape (serializeChannel)
// PLUS its compiled view + accent color. We pin only the fields the UI reads
// at the top level; the rest pass through verbatim (exports etc.).
export interface ViewSelection {
  type: string; // 'all' | 'group' | 'section' | 'fixture' | 'viewMask'
  target: string | number | null;
  invert?: boolean;
}

export interface DeckOverlay {
  id: string;
  name?: string;
  pattern?: string;
  mode?: string; // blend_screen | blend_add | blend_over
  fader?: number;
  faderMax?: number;
  enabled?: boolean;
  locked?: boolean;
  color?: string | null;
  hue?: number;
  viewSelection?: ViewSelection | null;
  playlist?: PlaylistAssignment | null;
  [key: string]: any;
}

// The SHARED auto-cycle cadence for ALL overlays (one unison clock).
export interface DeckOverlayAutopilot {
  active: boolean;
  delay_s: number;
  shuffle: boolean;
}

export interface DeckOverlaysState {
  overlays: DeckOverlay[];
  overlayAutopilot: DeckOverlayAutopilot;
}

// ── List ────────────────────────────────────────────────────────────────
// GET /deck/overlays → { overlays:[...], overlayAutopilot:{...} }.
// The live source of truth is the `deck` WS message (overlays ride it); this
// is the seed + a reconcile fallback. Fail loud on a malformed shape.
export async function fetchDeckOverlays(): Promise<ApiResult<DeckOverlaysState>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    if (!data || !Array.isArray(data.overlays)) {
      return { ok: false, error: 'Malformed /deck/overlays response (expected { overlays: [] })' };
    }
    const ap = data.overlayAutopilot || {};
    return {
      ok: true,
      data: {
        overlays: data.overlays as DeckOverlay[],
        overlayAutopilot: {
          active: !!ap.active,
          delay_s: typeof ap.delay_s === 'number' ? ap.delay_s : 30,
          shuffle: !!ap.shuffle,
        },
      },
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Add ───────────────────────────────────────────────────────────────────
// POST /deck/overlays { viewSelection(REQUIRED, non-'all'), playlist|pattern,
// mode, enabled } → { status:'ok', overlayId, color, playlist, playlistData }.
// Surfaces DECK_OVERLAY_VIEW_REQUIRED / _VIEW_TAKEN (409) / _OVER_CAP via
// data.code. The engine auto-assigns a distinct accent color.
export async function addDeckOverlay(opts: {
  viewSelection: ViewSelection;
  playlist?: string;
  pattern?: string;
  mode?: DeckOverlayBlendMode | string;
  enabled?: boolean;
}): Promise<ApiResult<any>> {
  try {
    const body: any = { viewSelection: opts.viewSelection };
    if (opts.playlist !== undefined) body.playlist = opts.playlist;
    if (opts.pattern !== undefined) body.pattern = opts.pattern;
    if (opts.mode !== undefined) body.mode = opts.mode;
    if (opts.enabled !== undefined) body.enabled = opts.enabled;
    const res = await fetchWithTimeout(`${api_base}/deck/overlays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Patch (edit one overlay) ──────────────────────────────────────────────
// PATCH /deck/overlays/:id { mode, fader, enabled, faderMax, color, hue,
// viewSelection }. A viewSelection change can also fail 409
// DECK_OVERLAY_VIEW_TAKEN on collision. Pass only the fields to change.
export async function patchDeckOverlay(
  id: string,
  fields: {
    mode?: string;
    fader?: number;
    enabled?: boolean;
    faderMax?: number;
    color?: string | null;
    hue?: number;
    viewSelection?: ViewSelection;
  },
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Delete ────────────────────────────────────────────────────────────────
// DELETE /deck/overlays/:id → { status:'ok' } (404 unknown id).
export async function deleteDeckOverlay(id: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Reorder ───────────────────────────────────────────────────────────────
// POST /deck/overlays/reorder { order:[ids] } — order[0]=bottom, last=top.
// A bad set (wrong length / dup / unknown id) ⇒ 400 REORDER_BAD_SET.
export async function reorderDeckOverlays(order: string[]): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Shared auto-cycle (autopilot) ─────────────────────────────────────────
// POST /deck/overlays/autopilot { active?, delay_s?, shuffle? } — the ONE
// SHARED cadence for the WHOLE overlay group (the timer is unison, NOT
// per-overlay). delay floor 1s ⇒ 400 AUTOCYCLE_BAD_DELAY. Pass only the
// fields to change.
export async function setDeckOverlayAutopilot(fields: {
  active?: boolean;
  delay_s?: number;
  shuffle?: boolean;
}): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays/autopilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Overlay playlist helpers (mirror the deck's playlist routes) ──────────
// These are thin wrappers for callers that want the explicit overlay route
// without going through the polymorphic ChannelRole helper in api.ts. The
// reused PlaylistPanel uses role="deckOverlay" (which dispatches to these
// same routes); these stay for direct/programmatic use.

/** POST /deck/overlays/:id/playlist { name|null } — assign / clear playlist. */
export async function setDeckOverlayPlaylist(
  id: string,
  name: string | null,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays/${encodeURIComponent(id)}/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/** POST /deck/overlays/:id/playlist/entry { entryId } — load a specific entry. */
export async function setDeckOverlayPlaylistEntry(
  id: string,
  entryId: string,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/overlays/${encodeURIComponent(id)}/playlist/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
