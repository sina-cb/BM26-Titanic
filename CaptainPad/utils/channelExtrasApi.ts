// channelExtrasApi — typed engine clients for the 2026-06-20 channel-features
// wave (docs/39 §8): named mixer snapshots / look recall (F-A), per-channel
// intensity clamp `faderMax` (F-C), and per-channel `color` metadata (F-D).
//
// File ownership (multi-agent wave): this file is owned by the
// ui_snapshots_clamp_color slice. The shared utils/api.ts is owned by a
// different agent this wave, so these clients live here instead of being
// folded into api.ts. The engine base URL is read through the dependency-free
// apiBase leaf module (same `${api_base}/...` live-binding pattern api.ts
// uses) — NOT by editing api.ts.
//
// Codex P0 — fail loud: every client honours `res.ok`. A non-2xx returns
// `{ ok: false, error }` (engine error body when present), never a fabricated
// `{ ok: true }`. Snapshot recall surfaces the engine's over-cap (400),
// unknown-name (404), and malformed (400) errors verbatim so the caller can
// Alert on them.

import { fetchWithTimeout, type ApiResult } from './api';
import { api_base } from './apiBase';

// ── Snapshots (F-A) ─────────────────────────────────────────────────────
// A snapshot ("look") is the FULL mixer state captured under a name. The
// engine owns capture/recall/persistence; the iPad just lists names,
// captures the current look, recalls a look, and deletes a look. The WS
// control-plane `snapshots` event ({ action, name, snapshots }) reconciles
// the list on every mutation — these REST clients are the seed + the writes.

/**
 * List the saved snapshot names (sorted by the engine).
 * GET /mixer/snapshots → { snapshots: string[] }.
 */
export async function fetchSnapshots(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/snapshots`);
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    const names = Array.isArray(data?.snapshots) ? (data.snapshots as string[]) : null;
    if (!names) {
      return { ok: false, error: 'Malformed /mixer/snapshots response (expected { snapshots: [] })' };
    }
    return { ok: true, data: names };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Capture the current full mixer state under `name`.
 * POST /mixer/snapshots { name } → { status:'ok', name }.
 * Engine name rule: `^[a-z0-9][a-z0-9_-]{0,63}$`; a bad/empty name ⇒ 400.
 */
export async function saveSnapshot(name: string): Promise<ApiResult<{ status: string; name: string }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
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
 * Delete a snapshot by name.
 * DELETE /mixer/snapshots/:name → { status:'ok' }, or 404 unknown name.
 */
export async function deleteSnapshot(name: string): Promise<ApiResult<{ status: string }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/snapshots/${encodeURIComponent(name)}`,
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
 * Recall (restore) a snapshot's full look.
 * POST /mixer/snapshots/:name/recall → { status:'ok', name }.
 * The engine respects `maxChannels`: an over-cap snapshot ⇒
 * 400 (code:SNAPSHOT_OVER_CAP), an unknown name ⇒ 404, a malformed snapshot ⇒
 * 400 (code:SNAPSHOT_MALFORMED). Recall does NOT optimistically flip local
 * state — the WS mixer broadcast reconciles the strips after the engine
 * rebuilds the deck + overlays.
 */
export async function recallSnapshot(name: string): Promise<ApiResult<{ status: string; name: string }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/snapshots/${encodeURIComponent(name)}/recall`,
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

/**
 * Recall (morph to) a snapshot's full look by RAMPING current→target over
 * `durationMs` instead of the instant cut `recallSnapshot` does (round-2 #1,
 * docs/39 §10.8). POST /mixer/snapshots/:name/recall-fade { durationMs }.
 * The engine validates durationMs (finite > 0 ⇒ else 400), the UNION channel
 * cap (over-cap ⇒ 400 code:SNAPSHOT_OVER_CAP), an unknown name (404), and a
 * malformed snapshot (400 code:SNAPSHOT_MALFORMED). Like recall, this does NOT
 * optimistically flip local state — the WS mixer broadcast reconciles the
 * strips as the ramp progresses, and a `snapshots` recall-fade-complete event
 * fires when it lands.
 */
export async function recallSnapshotFade(
  name: string,
  durationMs: number,
): Promise<ApiResult<{ status: string; name: string }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/snapshots/${encodeURIComponent(name)}/recall-fade`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMs }),
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

// ── Per-channel color (F-D) ───────────────────────────────────────────────
// Channel `color` metadata set through the SAME PATCH /mixer/channels/:id the
// rest of the mixer uses (updateMixerChannel). This thin wrapper pins the
// single field + the validation contract so the caller can't accidentally
// send the wrong shape:
//   - color: string (e.g. hex) or null; any other type ⇒ engine 400.
//
// Deck role: pass { deck: true } to route through PATCH /deck/channel instead
// (the deck channel lives on its own route post channel-split). The mixer
// screen only renders overlays, but the deck variant keeps the client honest
// for any future deck-side use.
//
// NOTE (June 2026): the per-channel intensity clamp `faderMax` (F-C) wrapper
// `setChannelFaderMax` lived here but was removed with the deck CAP control —
// `faderMax` is still a valid engine field, set via deckOverlaysApi / bump /
// snapshot inherit, just not through a standalone clamp wrapper here.

export async function setChannelColor(
  channelId: string,
  color: string | null,
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
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

// ── Per-channel hue (F-hue, docs/39 §F-hue) ───────────────────────────────
// A luminance-preserving RGB-only hue rotation applied PRE-blend on this
// channel's own contribution (W/A/UV are never touched). `hue` is degrees;
// the engine's `validateHue` normalizes into [0,360) (370⇒10, -30⇒330) and
// returns 400 on a non-finite value. Same PATCH /mixer/channels/:id (or
// /deck/channel when { deck: true }) the rest of the channel metadata uses.

export async function setChannelHue(
  channelId: string,
  hue: number,
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hue }),
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

// ── Per-channel phase clock (round-2 #3/#11, docs design 20260620_33) ──────
// Three orthogonal time controls on the SAME PATCH /mixer/channels/:id (or
// /deck/channel when { deck: true }) the rest of the channel metadata uses:
//   - speed:        finite multiplier on this channel's phase accumulator;
//                   engine clamps [0.05, 8]; non-finite ⇒ 400.
//   - phaseOffsetMs: finite constant added to phase (ms); engine clamps
//                   [-10000, 10000]; non-finite ⇒ 400.
//   - followsTempo: bool; when true this channel's speed is scaled by the
//                   global tap-tempo multiplier (120 BPM = 1×). Sent as `!!`.

export async function setChannelSpeed(
  channelId: string,
  speed: number,
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed }),
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

export async function setChannelPhaseOffset(
  channelId: string,
  phaseOffsetMs: number,
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseOffsetMs }),
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

export async function setChannelFollowsTempo(
  channelId: string,
  followsTempo: boolean,
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followsTempo: !!followsTempo }),
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

// ── Per-channel color INVERT (F-invert, docs/39 §F-invert; engine #8) ─────
// A pure-boolean per-channel flag: when true the engine inverts this
// channel's RGB contribution (applied AFTER the per-channel hue —
// hue-then-invert). W/A/UV are never touched and the render loop gates on
// the flag, so invert=false is a no-op. Same PATCH /mixer/channels/:id (or
// /deck/channel when { deck: true }) the rest of the channel metadata uses;
// the engine coerces with `!!`, so a non-bool can't half-apply. Mirrors
// setChannelFollowsTempo exactly (boolean, `!!`, same fail-loud shape).

export async function setChannelInvert(
  channelId: string,
  invert: boolean,
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invert: !!invert }),
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

// ── Per-channel FOLLOW / LINK (round-2 #6, docs/39 §F-follow; engine #6) ───
// Make THIS channel a FOLLOWER of another channel (the leader): its effective
// level becomes the leader's effective level × `followScale` (the follower's
// own manual fader is ignored while linked). Both fields ride the SAME PATCH
// /mixer/channels/:id (or /deck/channel when { deck: true }) the rest of the
// channel metadata uses, and both ride back on the existing mixer-state WS
// broadcast (no new WS type).
//   - followLeaderId: another channel's id, or null to UNFOLLOW. The engine
//                     rejects self-follow and any cycle (A→B→A, longer chains)
//                     with 400 code:'FOLLOW_CYCLE', and an unknown leader with
//                     404 code:'FOLLOW_LEADER_NOT_FOUND'. A non-string/non-null
//                     payload ⇒ 400. Validated BEFORE mutation (no half-apply).
//   - followScale:    finite number clamped [0,2] (default 1.0); non-finite ⇒
//                     400. Independent of followLeaderId — an operator can
//                     pre-set the scale before linking.
//
// Codex P0 — fail loud: the client honours res.ok and returns { ok:false,
// error, data } carrying the engine error body (incl. the 4xx `code`) verbatim
// so the caller can Alert on FOLLOW_CYCLE / FOLLOW_LEADER_NOT_FOUND specifically.

/** The engine's 400 cycle/self-follow code. */
export const FOLLOW_CYCLE = 'FOLLOW_CYCLE';
/** The engine's 404 unknown-leader code. */
export const FOLLOW_LEADER_NOT_FOUND = 'FOLLOW_LEADER_NOT_FOUND';

/**
 * Set this channel's follow link and/or follow scale in one PATCH. Pass only
 * the fields you want to change:
 *   - { followLeaderId: '<id>' }  → follow that channel
 *   - { followLeaderId: null }    → unfollow (revert to own manual fader)
 *   - { followScale: 1.5 }        → set the scale (engine clamps [0,2])
 * Returns { ok:false, error, data } on a non-2xx; `data.code` carries
 * FOLLOW_CYCLE / FOLLOW_LEADER_NOT_FOUND when present.
 */
export async function setChannelFollow(
  channelId: string,
  fields: { followLeaderId?: string | null; followScale?: number },
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const body: { followLeaderId?: string | null; followScale?: number } = {};
    if (Object.prototype.hasOwnProperty.call(fields, 'followLeaderId')) {
      body.followLeaderId = fields.followLeaderId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'followScale')) {
      body.followScale = fields.followScale;
    }
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
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

// ── Per-channel auto-cycle / autopilot (engine #2, docs/39 §6.v) ──────────
// Arm an overlay channel's playlist to AUTO-ADVANCE its active entry every
// `delay_s` seconds. All three fields live inside the channel's
// `playlist.autopilot` and ride the SAME PATCH /mixer/channels/:id (or
// /deck/channel when { deck: true }) the rest of the channel metadata uses;
// they ride back on the existing mixer-state WS broadcast (no new WS type).
//   - active:   bool — arms/disarms auto-advance. Engine coerces with `!!`.
//   - delay_s:  finite number, floored to 1s by the engine. A non-finite or
//               ≤0 value ⇒ 400 code:'AUTOCYCLE_BAD_DELAY'. The UI also clamps
//               to ≥1 client-side, but still surfaces the engine 400 fail-loud.
//   - shuffle:  bool — random next entry instead of in-order. `!!` coerced.
// The engine rejects arming a channel with no assigned playlist
// (no playlist.name) ⇒ 400 code:'AUTOCYCLE_NO_PLAYLIST', and a non-object
// autopilot payload ⇒ 400 code:'AUTOCYCLE_BAD_PAYLOAD'.
//
// Codex P0 — fail loud: the client honours res.ok and returns { ok:false,
// error, data } carrying the engine error body (incl. the 4xx `code`) verbatim
// so the caller can Alert on AUTOCYCLE_BAD_DELAY / _NO_PLAYLIST specifically.

/** The engine's 400 bad-delay code (delay_s non-finite or ≤0). */
export const AUTOCYCLE_BAD_DELAY = 'AUTOCYCLE_BAD_DELAY';
/** The engine's 400 no-playlist code (arming a channel with no playlist). */
export const AUTOCYCLE_NO_PLAYLIST = 'AUTOCYCLE_NO_PLAYLIST';

/**
 * Set this channel's auto-cycle (autopilot) fields in one PATCH. Pass only
 * the fields you want to change — they are merged into playlist.autopilot:
 *   - { active: true }    → arm auto-advance
 *   - { active: false }   → disarm
 *   - { delay_s: 30 }     → interval seconds (engine floors to 1)
 *   - { shuffle: true }   → random next entry
 * Returns { ok:false, error, data } on a non-2xx; `data.code` carries
 * AUTOCYCLE_BAD_DELAY / AUTOCYCLE_NO_PLAYLIST when present.
 */
export async function setChannelAutoCycle(
  channelId: string,
  fields: { active?: boolean; delay_s?: number; shuffle?: boolean },
  opts?: { deck?: boolean },
): Promise<ApiResult<any>> {
  try {
    const path = opts?.deck
      ? `${api_base}/deck/channel`
      : `${api_base}/mixer/channels/${encodeURIComponent(channelId)}`;
    const autopilot: { active?: boolean; delay_s?: number; shuffle?: boolean } = {};
    if (Object.prototype.hasOwnProperty.call(fields, 'active')) {
      autopilot.active = !!fields.active;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'delay_s')) {
      autopilot.delay_s = fields.delay_s;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'shuffle')) {
      autopilot.shuffle = !!fields.shuffle;
    }
    const res = await fetchWithTimeout(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autopilot }),
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

// ── Global tap-tempo (round-2 #4) ─────────────────────────────────────────
// The client computes BPM from tap intervals and posts the resolved BPM. The
// engine validates finite [20,400] (else 400), sets _tempoMultiplier =
// clamp(bpm/120, 0.05, 8), persists, and broadcasts the new tempoBpm on the
// existing mixer-state WS. Affects ONLY followsTempo channels (opt-in).
// POST /mixer/tempo { bpm }.

export async function postTapTempo(
  bpm: number,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/tempo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bpm }),
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

// ── Tempo re-sync to OSC (tempo arbitration, engine feat/optimize_channels) ─
// A manual tap (postTapTempo) OVERRIDES the OSC auto-follow for a fixed hold
// window (the engine's MANUAL_HOLD_MS, ~12s) so the operator's deliberate tap
// can't be reclaimed by the live OSC BPM on the very next frame. This is the
// explicit "hand it back to OSC NOW" affordance: it drops the manual-override
// hold immediately, so the live OSC BPM reclaims the tempo on the next tick
// (if OSC is live; otherwise the last value just holds). No body.
// POST /mixer/tempo/sync → { status:'ok', tempoBpm, tempoSource, oscTempoBpm }.
//
// Codex P0 — fail loud: the engine returns 500 when the arbiter is missing
// (it cannot drop an override that doesn't exist); the client surfaces that
// error verbatim rather than fabricating a success. The new state rides the
// existing mixer-state WS broadcast — no optimistic local flip needed.

export async function postTempoSync(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/tempo/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
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

// ── Sticky tempo source selector (operator request 2026-06-29) ─────────────
// Sets the PERSISTED source preference the OSC/TAP selector reflects on BOTH
// the deck and mixer (one source of truth — no per-surface guess, no OSC↔TAP
// jumping). 'osc' follows the live OSC BPM; 'tap' holds the current/tapped
// tempo with OSC auto-follow suppressed. The new state rides the existing
// mixer-state WS broadcast, so every surface updates together.
// POST /mixer/tempo/source { source } → { status:'ok', tempoBpm, tempoSource,
//   tempoSourcePref, oscTempoBpm }. Codex P0 — the engine 400s an invalid
//   source and 500s a missing arbiter; the client surfaces that verbatim.

export async function postTempoSource(
  source: 'osc' | 'tap',
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/tempo/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
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

// ── Global hue shifter — REMOVED (2026-07, operator decision) ─────────────
// `setGlobalHue` / POST /global-effect-hue are GONE: hue is PER-CHANNEL ONLY
// now (the engine answers that route with 410 GLOBAL_HUE_REMOVED). Use
// `setChannelHue(channelId, hue, { deck?: true })` above — the same client
// every on-screen HUE trim and the MFT hue knob dispatch through.

// ── Per-channel param presets (#9 engine, merged at 8ec8a7d) ──────────────
// A param preset is a NAMED capture of ONE channel's current local pattern
// params, scoped to the pattern it was captured on. Unlike a snapshot (the
// full mixer look), a preset is the per-channel analogue: capture this
// channel's knobs under a name, then recall those knobs onto any channel
// *running the same pattern*. The list is GLOBAL (GET /mixer/param-presets
// returns every preset, each carrying its `name` + the `pattern` it is scoped
// to); recall/capture/delete are the writes. The WS control-plane
// `paramPresets` event ({ action:'captured'|'recalled'|'deleted', name,
// paramPresets:[{name,pattern,savedAt}] }) reconciles the list on every
// mutation — these REST clients are the seed + the writes.
//
// Codex P0 — fail loud: every client honours `res.ok`; a non-2xx returns
// { ok:false, error, data } carrying the engine error body (incl. the 409
// `code:'PARAM_PRESET_PATTERN_MISMATCH'`) verbatim so the caller can Alert on
// the pattern mismatch specifically.

/** One entry in the global param-preset list (header only; not the controls). */
export interface ParamPresetInfo {
  name: string;
  pattern: string;
  savedAt?: string;
}

/** The engine's 409 mismatch code — recall onto a channel running a
 *  different pattern than the preset was captured on. */
export const PARAM_PRESET_PATTERN_MISMATCH = 'PARAM_PRESET_PATTERN_MISMATCH';

/**
 * List every saved param preset (sorted by the engine).
 * GET /mixer/param-presets → { paramPresets: [{ name, pattern, savedAt }] }.
 */
export async function listParamPresets(): Promise<ApiResult<ParamPresetInfo[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/param-presets`);
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    const list = Array.isArray(data?.paramPresets) ? (data.paramPresets as ParamPresetInfo[]) : null;
    if (!list) {
      return { ok: false, error: 'Malformed /mixer/param-presets response (expected { paramPresets: [] })' };
    }
    return { ok: true, data: list };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Capture the addressed channel's current pattern params under `name`.
 * POST /mixer/channels/:id/param-presets { name } → { status:'ok', name, pattern }.
 * A bad/empty name ⇒ 400; an unknown channel ⇒ 404.
 */
export async function captureParamPreset(
  channelId: string,
  name: string,
): Promise<ApiResult<{ status: string; name: string; pattern: string }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/channels/${encodeURIComponent(channelId)}/param-presets`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
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
 * Recall a named preset onto the addressed channel.
 * POST /mixer/channels/:id/param-presets/:name/recall → { status:'ok', name, channelId }.
 * The engine guards everything BEFORE applying: an unknown channel/preset ⇒
 * 404, a malformed preset ⇒ 400, and — critically — a preset captured on a
 * DIFFERENT pattern than the channel is running ⇒ 409 with
 * code:'PARAM_PRESET_PATTERN_MISMATCH'. Recall does NOT optimistically flip
 * local state — the WS mixer broadcast reconciles the strips after the engine
 * replays the saved controls. The caller inspects `data.code` to surface the
 * friendly pattern-mismatch Alert.
 */
export async function recallParamPreset(
  channelId: string,
  name: string,
): Promise<ApiResult<{ status: string; name: string; channelId: string }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/channels/${encodeURIComponent(channelId)}/param-presets/${encodeURIComponent(name)}/recall`,
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

/**
 * Delete a param preset by name (global — not channel-scoped).
 * DELETE /mixer/param-presets/:name → { status:'ok' }, or 404 unknown name.
 */
export async function deleteParamPreset(name: string): Promise<ApiResult<{ status: string }>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/mixer/param-presets/${encodeURIComponent(name)}`,
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
