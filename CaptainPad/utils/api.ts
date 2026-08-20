import { Platform } from 'react-native';
import { engineEvents } from './engineEvents';
import {
  parseLayerSettingsState,
} from './layer_settings';
import type { LayerSettingId, LayerSettingsState } from './layer_settings';
// Engine address resolution lives in the dependency-free apiBase.ts —
// engineBus.ts needs it too, and importing it from here created the
// require cycle api → engineEvents → engineBus → api. Re-exported so
// every existing `from './api'` call site keeps working.
import {
  api_base,
  getApiBase,
  getApiBaseAsync,
  getDefaultApiBase,
  setApiBase as setApiBaseValue,
} from './apiBase';
import {
  clearPrivilegedSession,
  getPrivilegedSession,
  type PrivilegedSession,
} from './privileged_session';
import { sessionBelongsToEngineOrigin } from './captainpad_access_logic';
import { principalReadonlyMessage, TAKEOVER_PASSCODE_HEADER } from './edit_session';
import {
  isEngineOriginRequest,
  normalizedOrigin,
  shouldClearPrivilegedSession,
  shouldClearSessionForEngineOriginChange,
} from './privileged_request_scope';

export { getApiBase, getApiBaseAsync, getDefaultApiBase };

export async function setApiBase(value: string): Promise<void> {
  const previousBase = api_base;
  await setApiBaseValue(value);
  if (shouldClearSessionForEngineOriginChange(previousBase, value)) {
    await clearPrivilegedSession();
    await (await import('./passcode_waiver')).clearPasscodeWaiver();
  }
}

// ── Fetch with timeout ────────────────────────────────────────────────────
// RN's `fetch` has NO default timeout. A flaky packet or a server that
// hangs mid-response leaves the promise pending forever. Three bugs in
// the iPad app traced back to that:
//   1. PlaylistPanel.handleEntryTap sets busy=true, awaits the fetch,
//      then setBusy(false). Hung fetch ⇒ "cannot change patterns".
//   2. mixer.addMixerChannel call hangs ⇒ operator mashes the button ⇒
//      5 POSTs queued ⇒ when the connection un-stalls all 5 land at once.
//   3. PlaylistPanel.refresh() on mount fails silently ⇒ "mixer can't
//      see playlists for channels".
// Wrapping the fetches in an AbortController-based timeout converts all
// three into a clean rejection that the existing error paths already
// handle (busy is released in a finally, the user can retry, etc.).
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  sessionOverride: PrivilegedSession | null = null,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // Honor a caller-supplied AbortSignal (e.g. to cancel a superseded request)
  // by chaining it onto our timeout controller.
  const caller = init.signal;
  const onCallerAbort = () => ctrl.abort();
  if (caller) {
    if (caller.aborted) ctrl.abort();
    else caller.addEventListener('abort', onCallerAbort);
  }
  try {
    const headers = new Headers(init.headers || {});
    const currentSession = getPrivilegedSession();
    const candidateSession = sessionOverride ?? currentSession;
    const engineOrigin = normalizedOrigin(api_base);
    const engineOriginRequest = isEngineOriginRequest(url, api_base);
    const scopedSession = sessionBelongsToEngineOrigin(candidateSession, engineOrigin)
      ? candidateSession
      : null;
    if (currentSession && !sessionBelongsToEngineOrigin(currentSession, engineOrigin)) {
      await clearPrivilegedSession();
    }
    if (!engineOriginRequest || !scopedSession) {
      headers.delete('X-CaptainPad-Session');
    } else {
      headers.set('X-CaptainPad-Session', scopedSession.token);
    }
    const response = await fetch(url, { ...init, headers, signal: ctrl.signal });
    if (shouldClearPrivilegedSession(response.status, engineOriginRequest, !!scopedSession)) {
      await clearPrivilegedSession();
    }
    return response;
  } finally {
    clearTimeout(t);
    if (caller) caller.removeEventListener('abort', onCallerAbort);
  }
}

// ── Throttled warn ────────────────────────────────────────────────────────
// When the engine is offline every screen's polling timer spams
// `TypeError: Network request failed` once per fetch. The errors are
// real but identical, so we only log each "tag" once per WARN_THROTTLE_MS.
// On the next successful call the operator can clear it explicitly via
// `resetWarnThrottle()` if we wire that in later — for now it just
// re-arms after the window.
const WARN_THROTTLE_MS = 30_000;
const _lastWarnAt: Record<string, number> = {};

function isOfflineError(err: unknown): boolean {
  // RN's fetch throws TypeError with message 'Network request failed'
  // when the host is unreachable; treat that as offline and downgrade.
  const m = (err && typeof err === 'object' && 'message' in err) ? String((err as any).message) : '';
  return m.includes('Network request failed');
}

function warnThrottled(tag: string, msg: string, err: unknown) {
  const now = Date.now();
  if ((now - (_lastWarnAt[tag] || 0)) < WARN_THROTTLE_MS) return;
  _lastWarnAt[tag] = now;
  if (isOfflineError(err)) {
    console.warn(`${msg} (engine offline; suppressing further warnings for ${WARN_THROTTLE_MS / 1000}s)`);
  } else {
    console.warn(msg, err);
  }
}

// ── Connection Health ─────────────────────────────────────────────────────

// Engine render-health snapshot, surfaced on GET /status as `renderHealth`
// (see marsin_engine/lib/pattern_mixer.js → getRenderHealth() and
// docs/39_channels_deck_mixer.md). `ok === false` means at least one channel
// blend is degraded — compositing via the host-side linear-interp fallback
// because its WASM blend script is missing / failed to compile. `blendErrors`
// names the offending modes. A healthy engine reports `{ ok:true, blendErrors:[] }`.
export interface RenderHealthBlendError {
  blend: string;
  message?: string;
  sinceFrame?: number;
  count?: number;
}

export interface RenderHealth {
  ok: boolean;
  frame?: number;
  blendErrors?: RenderHealthBlendError[];
}

// Deck-restore degrade descriptor, surfaced on GET /status as
// `deckRestoreDegraded` (see marsin_engine/lib/api_server.js FIX A). Non-null
// ONLY when the saved DECK pattern failed to restore at boot and the engine
// fell back to a known-good default to keep the mission-critical exterior LIT.
// Null on a clean boot.
export interface DeckRestoreDegraded {
  failedPattern: string | null;
  reason: string;
  fellBackTo: string;
}

export interface ConnectionResult {
  ok: boolean;
  data?: {
    activeScene?: string;
    activeModel?: string;
    activePattern?: string;
    unrealState?: string;
    // Operator-visibility health signals (additive — older engines omit
    // these and are treated as healthy by useEngineHealth). This is the
    // Codex P0 "loud, VISIBLE degrade" channel: a degraded engine literally
    // reports the degrade here, so treating absence as healthy is NOT a
    // silent fallback (a healthy engine reports `renderHealth.ok:true` and
    // `deckRestoreDegraded:null`).
    renderHealth?: RenderHealth | null;
    deckRestoreDegraded?: DeckRestoreDegraded | null;
    // SIZE LOCK (engine: marsin_engine/lib/size_lock.js). The global SIZE
    // fader is pinned at 0.5 (coordinate identity) by operator ruling
    // 2026-08-06 and the engine refuses every write. There is no SIZE
    // control left in this app, so this string is the ONLY way the operator
    // learns that a saved state file carried a stale size, or that something
    // is still trying to change it. A string (not an object) so the health
    // snapshot stays reference-stable across probes. Null / absent = clean.
    sizeLockWarning?: string | null;
  };
  error?: string;
  latencyMs?: number;
}

/**
 * Probe the engine's /status endpoint with a 3-second timeout.
 * Returns structured result with latency and status data.
 */
export async function testConnection(baseUrl?: string): Promise<ConnectionResult> {
  const url = baseUrl || api_base;
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetchWithTimeout(`${url}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, latencyMs };
    }
    const data = await res.json();
    return { ok: true, data, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out (3s)', latencyMs };
    }
    return { ok: false, error: err.message || 'Connection failed', latencyMs };
  }
}

// ── API Methods ───────────────────────────────────────────────────────────
// Each method now returns a structured result that lets the caller
// distinguish "no data" from "network error".

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** HTTP status when the response was received (absent on transport failures). */
  status?: number;
  /** Machine-readable error code from the engine's rejection body (e.g.
   *  'PERFORMANCE_MODE', 'WRONG_ROLE'). Absent on success + transport failures.
   *  Lets callers branch on the reason (the MIDI runtime quiets a 409 that is a
   *  performance-mode lock rather than counting it as a dispatch failure). */
  code?: string;
}

/**
 * Turn an engine rejection body into operator-facing copy.
 *
 * Almost always the engine's own `error` string is the right thing to show — it
 * is written for humans and is the honest reason. The one substitution is the
 * principal-readonly 403 (docs/56): "this edit session may not write rig state"
 * is accurate but says nothing about what to DO, so `principalReadonlyMessage`
 * names the session and the way out. Never echoes a passcode: that string is
 * fixed client copy keyed off the machine code, and the engine's own refusals
 * never contain the attempted secret either.
 */
function refusalMessage(data: any, status: number): string {
  return principalReadonlyMessage({ ok: false, code: data?.code, data })
    || data?.error
    || `HTTP ${status}`;
}

export async function sendControl(id: number, v0: number, v1?: number, v2?: number): Promise<ApiResult<any>> {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;

    const res = await fetchWithTimeout(`${api_base}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Control request failed:', 'Control request failed:', err);
    return { ok: false, error: err.message };
  }
}

// In-flight + short-TTL cache for fetchPatterns. The pattern list is
// engine-global; when the user adds N mixer channels in quick
// succession, N PlaylistPanels mount at once and each one fires its
// own /list-patterns GET. With N=3-4 that's enough parallel requests
// (alongside per-channel /playlist + global /playlists) to push some
// requests past the 8 s timeout and leave their panels stuck in
// "loading" forever. The dedupe collapses those parallel fetches
// into ONE request; the cache stops the next batch of mounts from
// hitting the network at all.
let _patternsCache: { data: string[]; at: number } | null = null;
let _patternsInflight: Promise<ApiResult<string[]>> | null = null;
const PATTERNS_CACHE_MS = 5_000;

export async function fetchPatterns(): Promise<ApiResult<string[]>> {
  if (_patternsCache && Date.now() - _patternsCache.at < PATTERNS_CACHE_MS) {
    return { ok: true, data: _patternsCache.data };
  }
  if (_patternsInflight) return _patternsInflight;
  _patternsInflight = (async () => {
    try {
      const res = await fetchWithTimeout(`${api_base}/list-patterns`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      _patternsCache = { data: list, at: Date.now() };
      return { ok: true as const, data: list };
    } catch (err: any) {
      warnThrottled('Fetch patterns failed:', 'Fetch patterns failed:', err);
      return { ok: false as const, error: err.message, data: [] };
    } finally {
      _patternsInflight = null;
    }
  })();
  return _patternsInflight;
}

export function invalidatePatternsCache() {
  _patternsCache = null;
}

// ── Pattern directories ("load directory") ─────────────────────────────
// patterns/ has sub-directories (e.g. transitions, channel_blends). The
// "load directory" affordance lets an operator bulk-add every pattern in
// one of those folders into a playlist. `fetchPatternDirs` lists the
// folder names; `fetchPatternsInDir` lists the `<dir>/<name>` slugs in
// one folder, ready to append as playlist entries.
export async function fetchPatternDirs(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/pattern-dirs`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch pattern dirs failed:', 'Fetch pattern dirs failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchPatternsInDir(dir: string): Promise<ApiResult<string[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/pattern-dirs/${encodeURIComponent(dir)}`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch patterns in dir failed:', 'Fetch patterns in dir failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchChannelBlends(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/channel-blends`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch channel blends failed:', 'Fetch channel blends failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchTransitions(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/transitions`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch transitions failed:', 'Fetch transitions failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

// ── Deck transition config ─────────────────────────────────────────────
// The DECK TRANSITIONS row in the deck tab writes through these. When
// enabled, playlist entry swaps on the deck base channel run as soft
// double-buffer swaps via the mixer's hidden shadow channel — see
// `triggerDeckPatternSwap` in marsin_engine/lib/pattern_mixer.js.
//
// Shape on the wire:
//   { enabled: boolean, mode: string, durationMs: number, shuffle: boolean }
//
// Partial PATCH-style writes are supported (POST any subset of fields).
export type DeckTransitionConfig = {
  enabled: boolean;
  mode: string;
  durationMs: number;
  shuffle: boolean;
};

export async function fetchDeckTransitionConfig(): Promise<ApiResult<DeckTransitionConfig>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/transition-config`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch deck transition config failed:', 'Fetch deck transition config failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function setDeckTransitionConfig(patch: Partial<DeckTransitionConfig>): Promise<ApiResult<DeckTransitionConfig>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/transition-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    // Codex P0 — fail loud: surface an engine rejection so the deck's
    // optimistic transition-config update can roll back instead of
    // showing a value the engine never accepted.
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Set deck transition config failed:', 'Set deck transition config failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Engine settings (auto-save toggle) ─────────────────────────────────────
// Engine-wide persistence gate. When autoSave is ON (default), all deck
// tuning, playlists, and mixer/global state persist automatically (mixer
// channel PARAMETERS are never saved). When OFF, nothing persists until the
// operator saves explicitly — a restart reverts to the last save. Mirrors the
// deck-transition-config fetch/set posture (GET returns it, POST accepts a
// partial patch; the engine 400s a non-boolean autoSave — no coercion).
//
// `bootMode` (report _236) is a persisted ENGINE preference — which face the
// engine comes up in on its NEXT start ('performance' = the docs/56 D1 boot
// lock, 'edit' = boot unlocked with the passcode gate still shut). It rides
// this same route because it lives in the same file the engine already persists
// `autoSave` in (settings_state.yaml); the engine 400s an unknown value rather
// than coercing it, and OMITTING the field leaves the stored preference alone.
export type EngineSettings = {
  autoSave: boolean;
  bootMode?: 'performance' | 'edit';
};

export async function fetchEngineSettings(): Promise<ApiResult<EngineSettings>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/settings`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch engine settings failed:', 'Fetch engine settings failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function setEngineSettings(patch: Partial<EngineSettings>): Promise<ApiResult<EngineSettings>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    // Codex P0 — fail loud: surface an engine rejection so the toggle's
    // optimistic update can roll back instead of showing a value the engine
    // never accepted.
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Set engine settings failed:', 'Set engine settings failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Performance mode (live-show structural lock) ───────────────────────────
// The engine's in-memory "show is running" lock. While active it freezes
// auto-persistence and 409s every structural/persistent-change route (the
// engine is the enforcement layer — CaptainPad only mirrors + greys). GET
// returns {active, enteredAt}; POST enters ({active:true}) or exits
// ({active:false, exitAction:'keep'|'restore'}). The engine's WS broadcast is
// authoritative — the UI never optimistically flips. Mirrors the fetch/set
// posture of engine settings; the engine 400s a non-boolean active (no coercion).
export type PerformanceModeState = {
  active: boolean;
  enteredAt: string | null;
  // Pending dirty deck tuning (present since the save-ask exit sheet landed).
  dirtyCount?: number;
  dirtyEntries?: { playlist: string; entryId: string; label: string | null }[];
  // WHO holds the engine-global edit session (docs/56). The public enum NAME
  // only — never credential material, never a session token.
  editPrincipal?: 'owner' | 'collaborator' | 'bringup' | null;
  // Whether this engine has privileged auth enabled (i.e. whether the
  // persistence gates exist at all). Stated by the engine, never guessed.
  authRequired?: boolean;
};

export type PerformanceExitAction = 'keep' | 'keep-save' | 'restore';

/** Canonical home: utils/edit_session.ts (a dependency-free leaf, so a suite
 *  that mocks this transport cannot make the header vanish). Re-exported
 *  because `from '@/utils/api'` is where callers already look for it. */
export { TAKEOVER_PASSCODE_HEADER };

export async function fetchPerformanceMode(): Promise<ApiResult<PerformanceModeState>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/performance-mode`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch performance mode failed:', 'Fetch performance mode failed:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Enter or leave the show lock.
 *
 * ENTERING is never gated. LEAVING requires operator passcode or a valid
 * 30-minute passcode waiver (docs/56 D2, operator ruling 2026-08-18).
 */
export async function setPerformanceMode(
  body: { active: true } | { active: false; exitAction: PerformanceExitAction },
  auth?: import('./takeover_passcode').OperatorAuthSendInput,
): Promise<ApiResult<PerformanceModeState>> {
  try {
    const headers = await (await import('./operator_auth')).operatorAuthHeaders(auth || {});
    const res = await fetchWithTimeout(`${api_base}/performance-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      await (await import('./operator_auth')).clearOperatorAuthOnRefusal(
        headers,
        res.status,
        `${api_base}/performance-mode`,
      );
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data, code: data?.code };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Set performance mode failed:', 'Set performance mode failed:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Re-assert WHO owns persistence while already in edit mode (docs/56 D3).
 */
export async function assertEditSession(
  auth: import('./takeover_passcode').OperatorAuthSendInput,
): Promise<ApiResult<PerformanceModeState>> {
  try {
    const headers = await (await import('./operator_auth')).operatorAuthHeaders(auth);
    const res = await fetchWithTimeout(`${api_base}/edit-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: '{}',
    });
    const data = await res.json();
    if (!res.ok) {
      await (await import('./operator_auth')).clearOperatorAuthOnRefusal(
        headers,
        res.status,
        `${api_base}/edit-session`,
      );
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data, code: data?.code };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Assert edit session failed:', 'Assert edit session failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Deck COLOR autopilot (operator request: "in the autopilot, select a set
// of palettes that switch on their own timer") ─────────────────────────────
// A second, INDEPENDENT autopilot on the deck that cycles a chosen SET of
// color palettes on a timer (the pattern autopilot cycles PATTERNS; this one
// cycles PALETTES). Palette ids come from the engine's color-palette library
// (the same `config.colorPalettes` {id,name} list surfaced by
// fetchColorPalettes / getCachedColorPalettes).
//
// Wire shape (GET returns it, POST accepts the same subset):
//   { active: boolean, palettes: (string | {c1,c2})[] (>=1 entry),
//     delay_s: number > 0, shuffle?: boolean, transitionMs?: number >= 0 }
//
// A palettes entry is EITHER a known library id OR an INLINE colour pair
// `{ c1, c2 }` — the Deck COLORS window's PALETTE TURNS rotates
// five ad-hoc colours that have no library id, and inventing one would be a
// lie (docs/53 §5.3, engine slice E1). Both forms resolve to the same CPC
// params engine-side; a UI that renders palette chips MUST handle both (an
// id-only `byId.get()` lookup silently hides the TURNS entries).
//
// Each CHANNEL of an inline pair is EITHER a hue number in 0..1 (which the
// engine resolves at s=1, v=1 — the original wire, byte-unchanged) OR a full
// `{h,s,v}` object (D2, docs/55 §1). The full form exists because the Live
// Touch MASTER/HUE scheme generators vary brightness, and a hue-only wire
// could not express them at all. Clients emit the NUMBER form whenever
// s=1 ∧ v=1, so no existing config changes shape.
//
// `transitionMs` is the CROSSFADE duration on a palette switch (0 = hard cut),
// the palette analogue of the DECK TX crossfade time — the engine ramps the
// palette params old→new over this window instead of snapping (docs/39).
//
// Partial PATCH-style writes are supported (POST any subset of fields — the
// engine merges over the live config before validating), so the deck UI can
// post a single toggle/stepper change optimistically.
/** One channel of an inline pair: a HUE in 0..1 (engine pins S/V to 1) or a
 *  full colour. See the D2 note above for why both forms exist. */
export type ColorPairChannel = number | { h: number; s: number; v: number };
/** An inline colour pair — the two CPC slots for one turn of a rotation. */
export type InlineColorPair = { c1: ColorPairChannel; c2: ColorPairChannel };
/** One entry of a colour-autopilot set: a library id or an inline pair. */
export type ColorPaletteEntry = string | InlineColorPair;

/** The FOLLOW NOTE block (docs/59 §4.1) — the note drives the base hue, the
 *  scheme generator applied to it cycles on `methodHoldS`. */
export type DeckFollowNoteConfig = {
  schemes: string[];
  methodHoldS: number;
  methodFadeS: number;
  noteFadeMs: number;
  sel: [number, number];
  shuffle: boolean;
  /** The scheme-tap override, present only in flight. */
  method?: string;
};

export type DeckColorAutopilotConfig = {
  active: boolean;
  palettes: ColorPaletteEntry[];
  /** Hold between turns, in seconds. 0 == CONTINUOUS (no hold — the fades run
   *  back to back), which the engine only accepts with transitionMs >= 100. */
  delay_s: number;
  shuffle: boolean;
  // Optional so existing seed objects (e.g. the deck screen's initial state)
  // stay valid without churn; the engine ALWAYS returns it on GET, and the UI
  // defaults an absent value to 0 (hard cut).
  transitionMs?: number;
  /** WHICH ROTATION FAMILY the daemon is running (docs/59 §4.1). Absent ≡
   *  'palettes', so every config written before FOLLOW NOTE existed reads
   *  unchanged; a live engine always sends it. The payload is MODE-SCOPED —
   *  a follow-note broadcast carries no `palettes` at all — so decide what is
   *  running from THIS, never by sniffing palette shapes. */
  mode?: 'palettes' | 'followNote';
  /** Present in follow-note mode; also carried INERT in palettes mode so a mode
   *  toggle round-trips the operator's cycle tuning instead of erasing it. */
  followNote?: DeckFollowNoteConfig;
  // ── Runtime facts, follow-note mode only (read-only; never posted back) ──
  /** The generator on the rig right now. */
  currentScheme?: string | null;
  /** The committed pitch class (0-11) the daemon last acted on. */
  notePc?: number | null;
  /** The hue that pitch class maps to through the companion's noteColors wheel. */
  noteHue?: number | null;
  /** Wall-clock ms of the next METHOD advance — the card's countdown. */
  nextMethodAtMs?: number | null;
};

export async function fetchDeckColorAutopilot(): Promise<ApiResult<DeckColorAutopilotConfig>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/color-autopilot`);
    const data = await res.json();
    // Codex P0 — fail loud: a non-ok GET surfaces the engine error rather
    // than handing the deck a half-formed config it would render as truth.
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch deck color autopilot failed:', 'Fetch deck color autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function setDeckColorAutopilot(patch: Partial<DeckColorAutopilotConfig>): Promise<ApiResult<DeckColorAutopilotConfig>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/color-autopilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    // Codex P0 — fail loud: surface an engine rejection so the deck's
    // optimistic color-autopilot update can roll back instead of showing a
    // value the engine never accepted.
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Set deck color autopilot failed:', 'Set deck color autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * LIVE RETUNE (docs/59 §5.2): PATCH the moved knob of a RUNNING rotation.
 *
 * The difference from `setDeckColorAutopilot` is the whole feature. A POST is a
 * full replace — the daemon bumps its generation, kills the in-flight tween,
 * resets the cursor and re-arms the hold from zero, so the rotation visibly
 * restarts under the operator's finger. A PATCH applies the field in place:
 * generation untouched, tween never cancelled, holds re-armed
 * phase-preserving, fades landing from the next fade.
 *
 * `active` and `mode` are REFUSED by the engine here on purpose — starting,
 * stopping and switching mode are takeovers and belong on the POST, where the
 * clean break is the point rather than a bug.
 */
export async function patchDeckColorAutopilot(patch: Record<string, unknown>): Promise<ApiResult<DeckColorAutopilotConfig>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/color-autopilot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    // Codex P0 — fail loud: a refused retune must surface, or the pill would
    // show a cadence the daemon is not running.
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Patch deck color autopilot failed:', 'Patch deck color autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function setActivePattern(pattern: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/set-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
    });
    const data = await res.json();
    // Codex P0 — fail loud + thread `code`: a pattern swap is gated (409
    // PERFORMANCE_MODE) while a show is live. Surface the rejection + its code
    // so a pattern-bound MIDI pad quiets to "locked" instead of counting a
    // dispatch failure, and so callers never see a phantom success.
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data, code: data?.code };
    }
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Set active pattern failed:', 'Set active pattern failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchExports(): Promise<ApiResult<any[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/exports`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch exports failed:', 'Fetch exports failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function setSectionBrightness(sectionId: number, brightness: number): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/section-brightness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId, brightness }),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    warnThrottled('set-section-brightness', `Failed to set section ${sectionId} brightness:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchDimmers(): Promise<ApiResult<Record<string, number>>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/dimmers`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch dimmers failed:', 'Fetch dimmers failed:', err);
    return { ok: false, error: err.message, data: {} };
  }
}

export async function fetchDimmerGroups(): Promise<ApiResult<Record<string, number>>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/dimmer-groups`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch dimmer groups failed:', 'Fetch dimmer groups failed:', err);
    return { ok: false, error: err.message, data: {} };
  }
}

// ── Group fixed colors (docs/32) ──────────────────────────────────────────
// Per-group color locks owned by the Dimmer Rack's FIXED COLORS strip.
// The engine validates everything (unknown group / bad color / bad
// brightness → 400 with a human-readable message), so these helpers
// surface the response body on failure instead of a bare status code.

export type GroupFixedColorOverride = {
  color: number[];      // RGBWAU, each 0..1
  brightness: number;   // 0..1
};

export type GroupFixedColorsState = {
  groups: string[];
  overrides: Record<string, GroupFixedColorOverride>;
};

export async function fetchGroupFixedColors(): Promise<ApiResult<GroupFixedColorsState>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/group-fixed-colors`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fetch-group-fixed-colors', 'Failed to fetch group fixed colors:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Paint a group a flat colour.
 *
 * `ownerId` opts the write into the engine's TOUCH CONTROL deadman lease: the
 * override is held only while that owner keeps renewing (WS
 * `touchControlHeartbeat`), is released the moment the owner's socket closes,
 * and is NOT persisted to globals_state.yaml — so a panel that dies can never
 * leave a group frozen, and a restart cannot resurrect it.
 *
 * Omit `ownerId` for a PERMANENT, persisted override (the pre-existing
 * behaviour that saved operator looks depend on). The engine echoes
 * `{ leased, leaseMs }` so the caller can verify which it got.
 */
export async function setGroupFixedColor(
  group: string,
  color: number[],
  brightness: number,
  ownerId?: string,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/group-fixed-colors/${encodeURIComponent(group)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ownerId ? { color, brightness, ownerId } : { color, brightness }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`set-group-fixed-color-${group}`, `Failed to set fixed color for group ${group}:`, err);
    return { ok: false, error: err.message };
  }
}

export async function clearGroupFixedColor(group: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/group-fixed-colors/${encodeURIComponent(group)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`clear-group-fixed-color-${group}`, `Failed to clear fixed color for group ${group}:`, err);
    return { ok: false, error: err.message };
  }
}

/**
 * Ramp the grand master to `target` over `durationMs` instead of snapping.
 *
 * `PATCH /mixer { master }` routes to setMaster(), whose FIRST statement is
 * `this._masterFade = null` — a direct write deliberately cancels any in-flight
 * fade, so it can only ever snap. That is correct for a fader the operator is
 * dragging, and wrong for engaging a manual surface, where the rig should ease
 * in. This uses the engine's existing timed-fade path instead.
 */
export async function fadeMaster(target: number, durationMs: number): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/master/fade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, durationMs }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fade-master', 'Failed to fade master:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Per-pixel geometry for surfaces that must reproduce the sim's 2D pixel view.
 *
 * Carries RAW world x/y/z as well as normalized nx/ny/nz — the sim's gap
 * compression works in WORLD units, so a client given only the normalized
 * coords could not compute the same bands and could not match the picture.
 *
 * ~168 KB on titanic (964 pixels). Fetch ONCE when the spatial pad opens, not
 * per frame.
 */
export async function fetchPixelLayout(): Promise<ApiResult<{
  scene: string | null;
  pixelCount: number;
  returnedCount: number;
  pixels: Array<{
    i: number; x: number; y: number; z: number;
    nx: number; ny: number; nz: number;
    group: string | null; type: string | null; fixtureType: string | null;
    fId: number; sId: number; localIndex: number;
  }>;
}>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/model/pixel-layout`, {}, 20000);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fetch-pixel-layout', 'Failed to fetch pixel layout:', err);
    return { ok: false, error: err.message };
  }
}

export async function setGlobalBlackout(state: boolean): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-blackout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    warnThrottled('set-global-blackout', 'Failed to set global blackout:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchGlobals(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/globals`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch globals failed:', 'Fetch globals failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function setGlobalEffect(effect: string, state: boolean): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effect, state }),
    });
    if (!res.ok) {
      console.warn(`Endpoint global-effect returned ${res.status}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    warnThrottled(`set-global-effect-${effect}`, `Failed to set global effect ${effect}:`, err);
    return { ok: false, error: err.message };
  }
}

export type ActivateLayerSettingOptions = {
  durationMs?: number;
  reason?: string;
  ownerId?: string;
};

async function layerSettingsError(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`Layer settings returned HTTP ${response.status} with invalid JSON: ${String(error)}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Layer settings returned HTTP ${response.status} with an invalid error body`);
  }
  const errorBody = body as { code?: unknown; error?: unknown };
  if (typeof errorBody.code !== 'string' || typeof errorBody.error !== 'string') {
    throw new Error(`Layer settings returned HTTP ${response.status} without code and error`);
  }
  return `${errorBody.code}: ${errorBody.error}`;
}

export async function fetchLayerSettingsState(): Promise<ApiResult<LayerSettingsState>> {
  try {
    const response = await fetchWithTimeout(`${api_base}/layers/state`);
    if (!response.ok) return { ok: false, error: await layerSettingsError(response) };
    return { ok: true, data: parseLayerSettingsState(await response.json()) };
  } catch (err: any) {
    warnThrottled('fetch-layer-settings', 'Failed to fetch layer settings:', err);
    return { ok: false, error: err.message };
  }
}

export async function activateLayerSetting(
  target: LayerSettingId,
  options: ActivateLayerSettingOptions = {},
): Promise<ApiResult<LayerSettingsState>> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.ownerId) headers['X-Touch-Control-Owner'] = options.ownerId;

    const response = await fetchWithTimeout(`${api_base}/layers/activate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        target,
        ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }),
      }),
    });
    if (!response.ok) return { ok: false, error: await layerSettingsError(response) };
    return { ok: true, data: parseLayerSettingsState(await response.json()) };
  } catch (err: any) {
    warnThrottled(`activate-layer-setting-${target}`, `Failed to activate layer setting ${target}:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchPatternCode(name: string): Promise<ApiResult<string>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/pattern-code?name=${name}`);
    const text = await res.text();
    return { ok: true, data: text };
  } catch (err: any) {
    warnThrottled('Fetch pattern code failed:', 'Fetch pattern code failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function getAutopilot(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/autopilot`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch autopilot failed:', 'Fetch autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

// PATTERN-GROUP LOCALITY (feat/optimize_channels): the DECK autopilot can
// dwell within a window of `groupSize` adjacent playlist entries for
// `groupDwell` swaps before grabbing a fresh window. These knobs live on the
// deck base channel's `playlist.autopilot` and are written through
// `POST /deck/playlist/autopilot` (the active/delay/shuffle fields keep going
// to `/autopilot` so the autopilot daemon's own state stays authoritative).
// All three are optional — pass a subset to patch just those keys; the engine
// coerces groupMode with `!!` and clamps groupSize 2..8 / groupDwell 1..50.
export type AutopilotGroupFields = {
  groupMode?: boolean;
  groupSize?: number;
  groupDwell?: number;
};

export async function setAutopilot(
  active?: boolean,
  delay_s?: string,
  shuffle?: boolean,
  group?: AutopilotGroupFields,
): Promise<ApiResult<any>> {
  try {
    const payload: any = {};
    if (active !== undefined) payload.active = active;
    if (delay_s !== undefined) payload.delay_s = delay_s;
    if (shuffle !== undefined) payload.shuffle = shuffle;

    const res = await fetchWithTimeout(`${api_base}/autopilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    // Group-locality knobs ride a SECOND POST to the deck-playlist endpoint
    // (the daemon's /autopilot state has no slot for them). Only fired when
    // at least one group field is present, so the legacy active/delay/shuffle
    // call path is byte-for-byte unchanged.
    if (group && (group.groupMode !== undefined
        || group.groupSize !== undefined
        || group.groupDwell !== undefined)) {
      const groupPayload: AutopilotGroupFields = {};
      if (group.groupMode !== undefined) groupPayload.groupMode = group.groupMode;
      if (group.groupSize !== undefined) groupPayload.groupSize = group.groupSize;
      if (group.groupDwell !== undefined) groupPayload.groupDwell = group.groupDwell;
      const gRes = await fetchWithTimeout(`${api_base}/deck/playlist/autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupPayload),
      });
      const gData = await gRes.json();
      if (!gRes.ok) {
        return { ok: false, error: gData?.error || `HTTP ${gRes.status}`, data: gData };
      }
    }
    return { ok: true, data };
  } catch(err: any) {
    warnThrottled('Set autopilot failed:', 'Set autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

// Set the DECK autopilot PROFILE (engine `playlist.autopilot.profile`). Lives on
// the deck base channel's playlist.autopilot alongside the group-locality knobs,
// so it rides the SAME `POST /deck/playlist/autopilot` endpoint (NOT the
// autopilot daemon's /autopilot state). The engine 400s an unknown profile
// (fail loud — no silent coercion); the caller optimistically applies + rolls
// back on !ok exactly like handleDeckTxChange.
export async function setAutopilotProfile(profile: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/playlist/autopilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : (data?.error || `HTTP ${res.status}`) };
  } catch (err: any) {
    warnThrottled('Set autopilot profile failed:', 'Set autopilot profile failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function savePatternCode(name: string, code: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/save-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code }),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    console.warn('Save pattern failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchParamCenterSchema(): Promise<ApiResult<any[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/param-center/schema`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchParamCenter(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/param-center`);
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    return { ok: false, error: err.message };
  }
}

export async function updateParamCenter(params: Record<string, any>): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/param-center`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Audio Analysis (docs/25) ──────────────────────────────────────────────
// `/audio/config` GET returns the full merged audio config the engine
// is running with right now (post `config.yaml` + `audio_config.yaml`
// overrides). PATCH accepts a partial of just the live-tunable
// `bands.*` / `kick.*` subset — anything else returns 400 with a
// clear message that engine restart is required.
export async function fetchAudioConfig(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/config`);
    const data = await res.json();
    // Surface the server's `{ error: "..." }` body on non-2xx instead
    // of swallowing it into a generic "unknown error" upstream. Mirrors
    // the shape patchAudioConfig / resetAudioConfig already use.
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function patchAudioConfig(partial: any): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Roll the analyzer (bands + kick + enabled / fftSize / hopSize) back
 * to the engine's `config.yaml` defaults. Mic selection is preserved.
 * Server returns the new merged config so the caller can refresh.
 */
export async function resetAudioConfig(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/config/reset`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Audio chains (docs/29 Phase 5) ───────────────────────────────────────
// Per-signal post-processing chains for the 7 live audio signals
// (micLow/Mid/High/Kick, stemsBass/Drums/Vocals). The engine owns the
// math (lib/signal_post_processor.js); the iPad just edits config and
// renders the engine's `signalChain` debug previews. See
// docs/29_[todo]_node_based_audio_post_processing.md §REST endpoints.

// Phase 7 expanded the catalog with `boolean` params (slope.bipolar) and
// `string` params constrained to `oneOf` enums (curve.shape). The op
// payload's `params` map can therefore hold number | string | boolean,
// and the catalog entry exposes both new shapes so the iPad renderer
// can drive the right control (segmented picker for oneOf, toggle for
// boolean) without re-deriving from the runtime payload.
export type AudioChainOp = {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
};

export type AudioChainsMap = Record<string, AudioChainOp[]>;

export type AudioChainOpSchemaParam = {
  type: 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  default?: number | string | boolean;
  oneOf?: string[];
  optional?: boolean;
};

export type AudioChainOpSchemaEntry = {
  type: string;
  description: string;
  paramKeyOrValue: boolean;
  params: Record<string, AudioChainOpSchemaParam>;
};

export type AudioChainCatalog = Record<string, AudioChainOpSchemaEntry>;

export async function fetchAudioChains(): Promise<ApiResult<AudioChainsMap>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/chains`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function fetchAudioChainsCatalog(): Promise<ApiResult<AudioChainCatalog>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/chains/catalog`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function putAudioChain(
  signalKey: string,
  ops: AudioChainOp[],
): Promise<ApiResult<AudioChainOp[]>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/audio/chains/${encodeURIComponent(signalKey)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ops),
      },
    );
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function patchAudioChainOp(
  signalKey: string,
  opId: string,
  partial: { enabled?: boolean; params?: Record<string, number | string | boolean> },
): Promise<ApiResult<AudioChainOp>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/audio/chains/${encodeURIComponent(signalKey)}/${encodeURIComponent(opId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      },
    );
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function resetAudioChainSignal(
  signalKey: string,
): Promise<ApiResult<AudioChainOp[]>> {
  try {
    const res = await fetchWithTimeout(
      `${api_base}/audio/chains/${encodeURIComponent(signalKey)}/reset`,
      { method: 'POST' },
    );
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function resetAllAudioChains(): Promise<ApiResult<AudioChainsMap>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/chains/reset`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Curated CPC colour-pair presets. Surfaces the rig's house palette
// (config.yaml → colorPalettes) so the COLORS picker's Presets tab can
// render tap-to-apply cards. Each entry: { id, name, c1: hue, c2: hue }.
// Empty array is a valid response (hide the Presets tab).
export async function fetchColorPalettes(): Promise<ApiResult<Array<{ id: string; name: string; c1: number; c2: number }>>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/color-palettes`);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err: any) {
    warnThrottled('color-palettes', 'Fetch color palettes failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Saved colour pairs (the COLORS window's SAVE PAIR gallery) ────────────
// SCENE-OWNED, not per-tablet. The operator ruled saved pairs are SHARED across
// every iPad, so they live in the engine's scene state dir
// (states/<scene>/color_pairs_state.yaml) and reach every tablet — a browser
// localStorage copy would be a per-device shadow of show state, and the
// prototype's localStorage is scaffolding only (report _199 §1.6).
//
// Distinct from /color-palettes: that is the CURATED, named library from
// config.yaml; this is the operator's own gallery (max 24, whole-list writes).
//
// _242 widened the ENTRY, not the protocol: `{c1,c2}` is still required and
// still means the same thing, and an entry may additionally carry `name`,
// `ring`/`sel` and `scheme`/`base` (see `PalettePreset` in
// components/deck/colors_window_logic.ts). The wire stays untyped here on
// purpose — this module moves the bytes; the deck module owns what they mean
// and validates them loudly on the way in.
export type ColorPairWire = Record<string, unknown> & { c1: number; c2: number };

export async function fetchColorPairs(): Promise<ApiResult<ColorPairWire[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/color-pairs`);
    const data = await res.json();
    // Codex P0 — fail loud: a non-ok GET surfaces the engine error rather than
    // handing the gallery a half-formed list it would render as truth.
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data: Array.isArray(data?.pairs) ? data.pairs : [] };
  } catch (err: any) {
    warnThrottled('color-pairs', 'Fetch saved colour pairs failed:', err);
    return { ok: false, error: err.message };
  }
}

/** Replace the whole gallery. The engine validates strictly and 400s on junk. */
export async function saveColorPairs(pairs: ColorPairWire[]): Promise<ApiResult<ColorPairWire[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/color-pairs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data: Array.isArray(data?.pairs) ? data.pairs : [] };
  } catch (err: any) {
    warnThrottled('color-pairs-save', 'Save colour pairs failed:', err);
    return { ok: false, error: err.message };
  }
}

export type ColorPaletteVisibility = { hiddenPaletteIds: string[] };

/** Scene-shared menu visibility for curated palettes. */
export async function fetchColorPaletteVisibility(): Promise<ApiResult<ColorPaletteVisibility>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/color-palette-visibility`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    if (!data || !Array.isArray(data.hiddenPaletteIds)) {
      return { ok: false, error: 'Engine returned malformed color palette visibility state' };
    }
    return { ok: true, data: { hiddenPaletteIds: data.hiddenPaletteIds } };
  } catch (err: any) {
    warnThrottled('color-palette-visibility', 'Fetch color palette visibility failed:', err);
    return { ok: false, error: err.message };
  }
}

/** Replace the scene-shared hidden curated-palette id list. */
export async function saveColorPaletteVisibility(
  hiddenPaletteIds: string[],
): Promise<ApiResult<ColorPaletteVisibility>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/color-palette-visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenPaletteIds }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    if (!data || !Array.isArray(data.hiddenPaletteIds)) {
      return { ok: false, error: 'Engine returned malformed color palette visibility state' };
    }
    return { ok: true, data: { hiddenPaletteIds: data.hiddenPaletteIds } };
  } catch (err: any) {
    warnThrottled('color-palette-visibility-save', 'Save color palette visibility failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── Color palette cache ─────────────────────────────────────────────────
// Reported bug: "color palette presets are not showing again" — the modal
// re-fetches on every open and that fetch can race the engine's first
// boot, the api_base resolve, or a transient WS reconnect. Symptom: empty
// Presets tab even though /color-palettes returns a healthy list.
//
// Fix: cache the presets in module-level state and pre-warm on app boot
// (see CaptainPad/app/_layout.tsx). The modal reads synchronously from
// the cache so it can render presets immediately; a background refresh
// keeps the cache fresh and self-heals if the first warm hit an
// offline window.
type ColorPalette = { id: string; name: string; c1: number; c2: number };
let _colorPaletteCache: ColorPalette[] = [];
let _colorPaletteWarmInflight: Promise<ColorPalette[]> | null = null;

export function getCachedColorPalettes(): ColorPalette[] {
  return _colorPaletteCache;
}

/**
 * Fetch palettes once and cache them. Subsequent callers either reuse the
 * cached list (instant) or piggy-back on the in-flight fetch. Pass
 * `{ force: true }` to bypass the cache and re-hit the engine — used by
 * the color picker's "refresh if empty" path.
 */
export async function warmColorPalettesCache(opts?: { force?: boolean }): Promise<ColorPalette[]> {
  if (!opts?.force && _colorPaletteCache.length > 0) return _colorPaletteCache;
  if (_colorPaletteWarmInflight) return _colorPaletteWarmInflight;
  _colorPaletteWarmInflight = (async () => {
    try {
      await getApiBaseAsync();
      const res = await fetchColorPalettes();
      if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
        _colorPaletteCache = res.data as ColorPalette[];
      }
      return _colorPaletteCache;
    } finally {
      _colorPaletteWarmInflight = null;
    }
  })();
  return _colorPaletteWarmInflight;
}

export async function fetchAudioStatus(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/status`);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Microphone discovery on the ENGINE machine. The iPad needs the rig's
// mic list, not its own — server shells out to ffmpeg and parses the
// platform-specific output (avfoundation / dshow / pulse). Cached
// server-side for 2 s so opening the picker doesn't fork ffmpeg per
// re-render. Returns `{ platform, inputFormat, devices, current }`.
export async function fetchAudioDevices(): Promise<ApiResult<{
  platform: string;
  inputFormat: string;
  devices: Array<{ id: string; label: string; platform: string; inputFormat: string; ffmpegDevice: string; isDefault?: boolean; alternativeName?: string }>;
  current: { device: string | null; deviceLabel: string | null; deviceId: string | null; inputFormat: string | null };
}>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/devices`, undefined, 8000);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// OSC config surface for the new OSC tab. GET returns the engine's
// current OSC config (enabled / port / host / allowedSenders + a
// bindings count). PATCH supports `enabled`, `allowedSenders`,
// `port`, `host` — listener stops + respawns on every successful
// PATCH so changes take effect immediately.
export async function fetchOscConfig(): Promise<ApiResult<{
  enabled: boolean;
  port: number | null;
  host: string | null;
  gainMax: number | null;
  allowedSenders: Array<{ name: string; ip: string }>;
  bindingsCount: number;
  running: boolean;
  status?: any;
}>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/osc/config`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function patchOscConfig(partial: {
  enabled?: boolean;
  allowedSenders?: Array<{ name: string; ip: string }>;
  port?: number;
  host?: string;
}): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/osc/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Shape of GET /mixer. `channels` are mixer overlays only (the deck
// channel lives on /deck/channel post channel-split). Channel internals
// stay loosely typed (`MixerChannel`) because the strip renders many
// engine-authored fields (exports, viewSelection, transition*) that the
// UI passes through verbatim; the fields the screen actually reads at the
// top level are pinned here.
export interface MixerChannel {
  id: string;
  name?: string;
  fader?: number;
  mode?: string;
  enabled?: boolean;
  locked?: boolean;
  faderLocked?: boolean;
  dirty?: boolean;
  transitionTime?: number;
  transitionMode?: string;
  exports?: any[];
  playlist?: PlaylistAssignment | null;
  viewSelection?: { type: string; target: string | number | null; invert?: boolean } | null;
  // Global tap-tempo opt-in: `followsTempo` opts the channel into the global
  // tap-tempo multiplier. The engine still serializes this on every mixer-state
  // broadcast; its per-channel STRIP UI was removed (mixer declutter, the
  // operator's marked-up screenshot) but the engine endpoint remains.
  followsTempo?: boolean;
  // FOLLOW / LINK (round-2 #6, docs/39 §F-follow). When `followLeaderId` names
  // another channel, THIS channel becomes a FOLLOWER: its effective level is
  // the leader's effective level × `followScale` (the follower's own manual
  // fader is ignored while linked). Both ride the existing mixer-state
  // broadcast (no new WS type). `followLeaderId` is the leader channel id, or
  // null when not following — the engine CLEARS a follower's `followLeaderId`
  // (and broadcasts) when its leader is deleted, so the UI can go unfollowed
  // without local action. `followScale` is clamped to [0,2] (default 1.0).
  followLeaderId?: string | null;
  followScale?: number;
  [key: string]: any;
}

export interface MixerState {
  master: number;
  channels: MixerChannel[];
  baseChannelId?: string;
  maxChannels?: number;
  // Global tap-tempo (round-2 #4). 120 BPM = 1×; null when never set. Affects
  // only `followsTempo` channels. Rides the existing mixer-state broadcast.
  tempoBpm?: number | null;
  [key: string]: any;
}

export async function fetchMixerState(): Promise<ApiResult<MixerState>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer`);
    // Hard-fail on non-2xx instead of treating an error body as state —
    // the old `return { ok: true, data }` would have fed a
    // `{ error: '...' }` payload straight into the mixer screen, which
    // reads data.master / data.channels and would have rendered NaN /
    // an empty rig. Codex P0: fail loud, no silent fallback.
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data || typeof data !== 'object' || typeof data.master !== 'number' || !Array.isArray(data.channels)) {
      return { ok: false, error: 'Malformed /mixer response (expected { master:number, channels:[] })' };
    }
    return { ok: true, data: data as MixerState };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch the model's available view-selection targets (groups, sections,
 * fixtures, and the union of viewMask bits actually used). Consumed by
 * the mixer channel strip so it can populate the per-channel
 * view-selection picker without having to ship the whole pixel list.
 * Pure read — safe to hit on mount.
 */
export async function fetchViewSelectionOptions(): Promise<ApiResult<{
  groups: string[];
  sections: number[];
  fixtures: number[];
  viewMaskUnion: number;
  // Named view-mask presets the model author declared (model inline
  // export). Each entry maps a
  // human-readable name to its 1-hot bit and a hint whether any pixel
  // in the live model actually has that bit set (`inUse`). The mixer
  // strip's view-selection picker renders these in a dedicated
  // "VIEW MASKS" section, alongside ALL and GROUPS.
  viewMasks: { name: string; bit: number; inUse: boolean }[];
  // The FULL Tier-A named-view catalog the engine's MaskRegistry interns:
  // base groups (kind:'group'), composites (kind:'composite'), and every
  // derived auto-view (kind:'pixelSet' — LEFT/RIGHT/FRONT/BACK, the scene's
  // structural bands if any survive dedup, Strands / TE Signs / @PAR / @BAR /
  // @VINTAGE, CTRL_<n>). `bit` is the in-VM viewMask
  // bit (0 for bit-less Tier-A views); `memberCount` is the live pixel count.
  // Consumed by the shared ViewSelectionPicker (report 20260724_8). Optional
  // in the type so a stale engine that omits it is detectable — the picker
  // fails LOUD (visible banner) rather than silently hiding the catalog.
  namedViews?: {
    name: string;
    kind: string;
    bit: number;
    memberCount: number;
    groupNames?: string[];
    partialGroupNames?: string[];
  }[];
  pixelCount: number;
}>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/model/view-selection-options`);
    // Codex P0 — fail loud: a non-2xx or non-object body must not be fed to
    // the picker as if it were a valid enumeration (the old `return {ok:true,
    // data}` would have handed an `{error:...}` payload straight through).
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Malformed /model/view-selection-options response' };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Post-channel-split (May 2026): the deck channel is no longer in
// /mixer.channels — it lives on its own /deck/channel route. The
// deck tab reads this; useEngineState seeds from it on cold boot.
export async function fetchDeckChannel(): Promise<ApiResult<{ master: number; blackout: boolean; channel: any | null }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/channel`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// PATCH the deck channel. Mirrors updateMixerChannel for the deck
// role (mute toggle, fader drag, lock toggle, blend mode pick).
export async function updateDeckChannel(updates: any): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/channel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : data?.error, code: res.ok ? undefined : data?.code };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// POST a per-control write to the deck channel. Mirrors
// setMixerChannelControl for the deck role.
export async function setDeckChannelControl(id: number, v0: number, v1?: number, v2?: number): Promise<ApiResult<any>> {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;
    const res = await fetchWithTimeout(`${api_base}/deck/channel/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : data?.error };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function updateMixerChannel(id: string, updates: any): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    // Codex P0 — fail loud: an engine rejection (400 unknown group /
    // bad viewMask, 400 WRONG_ROLE, 404, 500) used to come back as
    // { ok: true } with the error body as `data`, so callers that
    // branch on `ok` (e.g. mixer view-selection) could never see a
    // rejected PATCH. Mirror updateDeckChannel's res.ok handling.
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data, code: data?.code };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function updateMixerMaster(master: number): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ master }),
    });
    const data = await res.json();
    // Codex P0 — fail loud: the engine 400s a non-finite master (api_server
    // /mixer PATCH). Surface that instead of reporting a phantom success, so
    // the MasterFadeGroup 0s (instant TO BLACK / UP) Alert can actually fire.
    // Matches the res.ok guard the sibling /mixer writers carry.
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function removeMixerChannel(id: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${id}`, { method: 'DELETE' });
    // Codex P0 — fail loud: a DELETE the engine rejected (404 unknown
    // id, 400 WRONG_ROLE for the deck channel, 500) used to return
    // { ok: true } unconditionally, so the delete-confirm handler
    // assumed success on a destructive, live-show action that never
    // landed. Surface the engine's error body on non-2xx, mirroring
    // fetchMixerState / updateDeckChannel.
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Playlist API ─────────────────────────────────────────────────────────

export interface PlaylistEntry {
  id: string;
  pattern: string;
  label: string | null;
  defaults: Record<string, any>;
  notes?: string | null;
  // Per-entry binding arrays, persisted with the pattern. `modulations` are
  // audio-reactive (engine-applied); `midiMappings` bind a physical MIDI
  // control to a local param's STATIC value (CaptainPad-applied — see MidiMap).
  modulations?: ModulationMapping[];
  midiMappings?: MidiMapping[];
  _missing?: boolean;
}

export interface PlaylistData {
  schemaVersion: number;
  name: string;
  entries: PlaylistEntry[];
}

export interface PlaylistAssignment {
  name: string;
  activeEntryId: string | null;
  cursor: number;
  // Auto-cycle / autopilot (engine #2, docs/39 §6.v). When `active`, the engine
  // auto-advances `activeEntryId` every `delay_s` seconds (floored to 1s;
  // `shuffle` picks a random next entry instead of in-order). Set via
  // PATCH /mixer/channels/:id { autopilot:{...} } (utils/channelExtrasApi
  // setChannelAutoCycle); rides back on the existing mixer-state WS broadcast
  // inside this `playlist` object (no new WS type), so an auto-advance shows up
  // live as `activeEntryId` changes. Absent on playlists never armed.
  autopilot?: { active: boolean; delay_s: number; shuffle: boolean };
}

// Same dedupe + cache shape as fetchPatterns above. The playlist
// library is engine-global so N PlaylistPanels mounting at once now
// share a single GET /playlists instead of issuing N of them.
let _playlistsCache: { data: string[]; at: number } | null = null;
let _playlistsInflight: Promise<ApiResult<string[]>> | null = null;
const PLAYLISTS_CACHE_MS = 5_000;

export async function fetchPlaylists(): Promise<ApiResult<string[]>> {
  if (_playlistsCache && Date.now() - _playlistsCache.at < PLAYLISTS_CACHE_MS) {
    return { ok: true, data: _playlistsCache.data };
  }
  if (_playlistsInflight) {
    // Mirror the per-name fetchPlaylist guard: if the shared in-flight
    // promise resolves with ok:false BUT a fresher cache entry has
    // landed since (e.g. via a sibling success or a WS playlistLibrary
    // prime), prefer the cache. This is the third-channel-add safety
    // net: panel 3 dedupes onto panel 1's promise, panel 1 errors
    // transiently, panel 2 has already cached good data via its own
    // chain — without this guard panel 3 sees ok:false and renders
    // "no playlists yet" until the 1.5s retry.
    const inflight = _playlistsInflight;
    const res = await inflight;
    if (!res.ok) {
      const c = _playlistsCache;
      if (c && Date.now() - c.at < PLAYLISTS_CACHE_MS) {
        return { ok: true, data: c.data };
      }
    }
    return res;
  }
  _playlistsInflight = (async () => {
    try {
      const res = await fetchWithTimeout(`${api_base}/playlists`);
      // The pre-May-2026 version skipped this check and treated a
      // non-2xx response as success. A 500 with JSON body
      // `{ error: '...' }` would set _playlistsCache.data to [], the
      // dropdown would render "no playlists yet", and the cache TTL
      // would lock the bad state in for 5 s. Hard-fail on non-ok
      // status instead — the caller's scheduleRetry path takes over.
      if (!res.ok) {
        return { ok: false as const, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      // Empty list could be legit (fresh install with no playlists)
      // but is far more often a transient mishap from the engine
      // serving a sync fs read under load. Either way we DON'T
      // poison the cache with [] when we previously had a populated
      // list — that's the operator-visible "no playlists yet" bug
      // on the 3rd added channel. We still return the empty list
      // (so a truly-empty engine renders correctly on cold boot),
      // but only CACHE non-empty lists so the next call hits the
      // network and re-converges fast.
      if (!Array.isArray(data)) {
        return { ok: false as const, error: 'unexpected payload shape' };
      }
      if (data.length > 0) {
        _playlistsCache = { data, at: Date.now() };
      }
      return { ok: true as const, data };
    } catch (err: any) {
      return { ok: false as const, error: err.message };
    } finally {
      _playlistsInflight = null;
    }
  })();
  return _playlistsInflight;
}

export function invalidatePlaylistsCache() {
  _playlistsCache = null;
}

// Per-name dedupe + short-TTL cache for fetchPlaylist. The mixer
// scenario that motivated this: adding a 3rd channel kicks off
// 3 PlaylistPanels each fetching /playlists/default in parallel.
// The engine handles them serially behind sync fs.readFileSync
// calls, and under load (broadcastMixerState, vis flood) one of
// them can blow past the 8 s timeout — leaving the panel forever
// "loading". Dedupe collapses concurrent fetches for the SAME
// playlist name onto one promise; the TTL means a sibling panel
// mounted 100ms later doesn't even hit the network.
const _playlistCache = new Map<string, { data: PlaylistData; at: number }>();
const _playlistInflight = new Map<string, Promise<ApiResult<PlaylistData>>>();
const PLAYLIST_CACHE_MS = 5_000;

export async function fetchPlaylist(name: string): Promise<ApiResult<PlaylistData>> {
  const cached = _playlistCache.get(name);
  if (cached && Date.now() - cached.at < PLAYLIST_CACHE_MS) {
    return { ok: true, data: cached.data };
  }
  const inflight = _playlistInflight.get(name);
  if (inflight) {
    // Wait for the shared in-flight result. But if a primePlaylistCache
    // call from a WS `channelPlaylistData` event populated the cache
    // WHILE the inflight was running, prefer the cached data over a
    // potentially-stale {ok:false} from the original fetch. This is the
    // critical guard for the rapid-add-3-channels scenario: panel 1's
    // fetch could time out or transient-fail, and without this guard
    // panels 2/3 sharing that same promise would also see ok:false and
    // never render — even though the engine's channelPlaylistData WS
    // event has already primed the cache with the right data.
    const res = await inflight;
    if (!res.ok) {
      const c2 = _playlistCache.get(name);
      if (c2 && Date.now() - c2.at < PLAYLIST_CACHE_MS) {
        return { ok: true, data: c2.data };
      }
    }
    return res;
  }
  const p = (async () => {
    try {
      const res = await fetchWithTimeout(`${api_base}/playlists/${encodeURIComponent(name)}`);
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` };
      const data = await res.json();
      _playlistCache.set(name, { data: data as PlaylistData, at: Date.now() });
      return { ok: true as const, data: data as PlaylistData };
    } catch (err: any) {
      // Last-chance cache check: a WS prime could have landed between
      // the fetch starting and erroring out. Same rationale as above.
      const c2 = _playlistCache.get(name);
      if (c2 && Date.now() - c2.at < PLAYLIST_CACHE_MS) {
        return { ok: true as const, data: c2.data };
      }
      return { ok: false as const, error: err.message };
    } finally {
      _playlistInflight.delete(name);
    }
  })();
  _playlistInflight.set(name, p);
  return p;
}

export function invalidatePlaylistCache(name?: string) {
  if (name) _playlistCache.delete(name);
  else _playlistCache.clear();
}

/**
 * Seed the per-name playlist cache with data that came inline on
 * another response (e.g. POST /mixer/channels now returns the full
 * playlist alongside the new channel). Lets the next PlaylistPanel
 * to call fetchPlaylist(name) hit the cache instantly instead of
 * racing the network — the only reliable way to stop the
 * "panel stuck on Loading" bug when many channels are added in a
 * burst.
 */
export function primePlaylistCache(name: string, data: PlaylistData) {
  if (!name || !data) return;
  _playlistCache.set(name, { data, at: Date.now() });
}

// ── Global cache-prime listener ───────────────────────────────────────
// Subscribe ONCE at module load to the engineEvents bus so EVERY
// `channelPlaylistData` WS event primes the per-name cache,
// regardless of whether a PlaylistPanel for that channel has mounted
// yet. This is the critical guarantee that fixes the rapid-add bug:
// the engine emits this event BEFORE the mixer broadcast that
// announces the new channel, so by the time React mounts the new
// PlaylistPanel and it calls fetchPlaylist(name), the cache already
// has the data — no slow GET, no race, no "stuck on Loading".
//
// Static import (NOT dynamic) so the listener is registered
// SYNCHRONOUSLY on module load. The previous dynamic-import
// version had a window of ~1 tick where the listener wasn't yet
// installed; for the user's 3rd-channel-add scenario the
// channelPlaylistData WS event could fire DURING that window and
// the cache would never be primed, leaving the new PlaylistPanel
// to fall back to a slow GET. engineEvents/engineBus import only the
// dependency-free apiBase.ts, so this static import is cycle-free.
engineEvents.subscribe((msg: { type: string; [k: string]: unknown }) => {
  if (msg && msg.type === 'channelPlaylistData') {
    const pd = msg.playlistData as PlaylistData | undefined;
    if (pd && typeof pd === 'object' && typeof pd.name === 'string') {
      primePlaylistCache(pd.name, pd);
    }
  } else if (msg && msg.type === 'playlistSaved') {
    // Some tab saved a playlist; if the broadcast carries the
    // full data (most engine paths do) prime us with it.
    const pd = msg.playlist as PlaylistData | undefined;
    if (pd && typeof pd === 'object' && typeof pd.name === 'string') {
      primePlaylistCache(pd.name, pd);
    } else if (typeof msg.name === 'string') {
      // Some engine paths (notably the modulation CRUD endpoints'
      // DELETE / PUT / PATCH) broadcast just { type, name } without
      // the full playlist payload. We MUST invalidate the cache in
      // that case so the next fetchPlaylist doesn't return stale
      // mapping data — otherwise the deck's ◎ ON badge would linger
      // after the operator hit the ✕ clear button.
      invalidatePlaylistCache(msg.name);
    }
  } else if (msg && msg.type === 'playlistDeleted' && typeof msg.name === 'string') {
    invalidatePlaylistCache(msg.name);
    invalidatePlaylistsCache();
  } else if (msg && msg.type === 'playlistLibrary') {
    // Engine broadcasts the latest names list on save / delete.
    // Prime the cache from the broadcast so the next fetchPlaylists
    // is an instant hit instead of a re-fetch; only fall back to
    // invalidation if the broadcast didn't carry names (older engine).
    const names = Array.isArray(msg.names) ? (msg.names as string[]) : null;
    if (names && names.length > 0) {
      _playlistsCache = { data: names, at: Date.now() };
    } else {
      invalidatePlaylistsCache();
    }
  }
});

export async function savePlaylist(
  playlist: { name: string; entries: PlaylistEntry[] },
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playlist),
    });
    const data = await res.json();
    invalidatePlaylistCache(playlist.name);
    invalidatePlaylistsCache();
    return {
      ok: res.ok,
      data,
      code: res.ok ? undefined : data?.code,
      error: res.ok ? undefined : refusalMessage(data, res.status),
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function deletePlaylist(name: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    invalidatePlaylistCache(name);
    invalidatePlaylistsCache();
    return {
      ok: res.ok,
      data,
      code: res.ok ? undefined : data?.code,
      error: res.ok ? undefined : refusalMessage(data, res.status),
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Post slot 6 channel_isolation (May 2026): the deck channel is now
// structurally separate from mixer overlays. /mixer/channels/:id/* and
// /deck/* routes reject the wrong role with HTTP 400 `WRONG_ROLE`. The
// PlaylistPanel UI component is shared between the deck tab and the
// mixer tab, so it accepts a `role` prop and we dispatch the playlist
// API call to the matching endpoint here.

// 'deckOverlay' is a deck dynamic VIEW OVERRIDE (engine #deck-overlays):
// a view-scoped overlay deck layered over the main deck. Its playlist
// routes mirror the deck's (/deck/overlays/:id/playlist + /entry + /swap),
// so the polymorphic helpers below dispatch a third branch for it and the
// reused PlaylistPanel can drive an overlay's playlist exactly like the
// deck's. There is intentionally NO GET /deck/overlays/:id/playlist on the
// engine — the overlay's assignment rides the `deck` WS message's
// `overlays[]` array, so fetchChannelPlaylist reads the list for the role.
// 'deckSlot' is one of the deck's two split-playlist PANES (feat/
// autopilot_deck_improvement). The deck still plays exactly one pattern; the two
// panes are stable playlist BINDINGS by name (`primary` / `secondary`) that the
// operator browses/drives from. `channelId` IS the slot key
// ('primary' | 'secondary'). Its GET/POST route through the deck's slot
// endpoints (see the branches below); the reused PlaylistPanel drives a slot's
// playlist exactly like the deck's, reconciling off the `deck` WS message's
// `playlistSlots` map. See .agent/projects/deck_split_playlists.md.
export type ChannelRole = 'deck' | 'mixer' | 'deckOverlay' | 'deckSlot';

// Polymorphic playlist GET. Use this instead of fetchMixerChannelPlaylist
// from any consumer that may be wired to the deck channel.
export async function fetchChannelPlaylist(
  role: ChannelRole,
  channelId: string,
): Promise<ApiResult<PlaylistAssignment | null>> {
  if (role === 'deck') {
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/playlist`);
      const data = await res.json();
      return { ok: res.ok, data: data ?? null };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  if (role === 'deckOverlay') {
    // No per-overlay playlist GET on the engine: read the overlay's
    // assignment out of the /deck/overlays list (the same shape the WS
    // `deck` message folds in). Fail loud on a non-2xx / missing overlay.
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/overlays`);
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
      const list = Array.isArray(data?.overlays) ? data.overlays : [];
      const ov = list.find((o: any) => o && o.id === channelId);
      return { ok: true, data: (ov && ov.playlist) || null };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  if (role === 'deckSlot') {
    // Both panes read from ONE slots endpoint: GET /deck/playlist/slots returns
    // { primary, secondary, splitRatio } — pick the slot for this pane's
    // channelId. A slot is null when unbound (pane shows its empty state). Fail
    // loud on a non-2xx.
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/playlist/slots`);
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
      const slot = data && typeof data === 'object' ? (data as any)[channelId] : null;
      return { ok: true, data: (slot as PlaylistAssignment) || null };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  return fetchMixerChannelPlaylist(channelId);
}

// Polymorphic playlist POST (assign a playlist to the channel). The
// mixer response carries `playlistData` inline so we can prime the
// per-name cache; the deck response currently only carries
// `{ status, playlist }` so we do NOT prime from it (a follow-up
// fetchPlaylist call will handle that).
export async function setChannelPlaylist(
  role: ChannelRole,
  channelId: string,
  name: string | null,
): Promise<ApiResult<any>> {
  if (role === 'deck') {
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      return { ok: res.ok, data, error: res.ok ? undefined : data?.error };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  if (role === 'deckOverlay') {
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/overlays/${encodeURIComponent(channelId)}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      return { ok: res.ok, data, error: res.ok ? undefined : data?.error };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  if (role === 'deckSlot') {
    // primary === the deck's main playlist: assigning it activates (POST
    // /deck/playlist loads the first entry, today's behaviour). secondary is
    // BROWSE-ONLY: POST /deck/playlist/secondary binds the pane without changing
    // what's playing (the operator taps an entry to drive it); passing null
    // clears the slot (clearing a live secondary promotes it to primary on the
    // engine side). The engine 404s an unknown name and 400s secondary===primary
    // (fail loud).
    if (channelId === 'secondary') {
      try {
        const res = await fetchWithTimeout(`${api_base}/deck/playlist/secondary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        return { ok: res.ok, data, error: res.ok ? undefined : (data?.error || `HTTP ${res.status}`) };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }
    // primary slot → existing deck playlist route (assign = activate).
    return setChannelPlaylist('deck', '', name);
  }
  return setMixerChannelPlaylist(channelId, name);
}

// Polymorphic playlist entry switch. Same EBUSY (409) contract for
// both roles (deck soft-swaps return 409 mid-transition; mixer
// instant-swaps don't but the helper still surfaces `code` consistently).
export async function setChannelPlaylistEntry(
  role: ChannelRole,
  channelId: string,
  entryId: string,
): Promise<ApiResult<any> & { code?: string }> {
  if (role === 'deck') {
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/playlist/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId }),
      });
      const data = await res.json();
      const code = !res.ok && data && data.code
        ? String(data.code)
        : (!res.ok && res.status === 409 ? 'EBUSY' : undefined);
      return { ok: res.ok, data, code, error: !res.ok ? (data && data.error) : undefined };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  if (role === 'deckOverlay') {
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/overlays/${encodeURIComponent(channelId)}/playlist/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId }),
      });
      const data = await res.json();
      const code = !res.ok && data && data.code
        ? String(data.code)
        : (!res.ok && res.status === 409 ? 'EBUSY' : undefined);
      return { ok: res.ok, data, code, error: !res.ok ? (data && data.error) : undefined };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  if (role === 'deckSlot') {
    // Tap = DRIVE. Both panes route through the deck's back-compat-extended
    // entry endpoint with an explicit `slot` so the engine resolves the slot's
    // playlist name and swaps via loadPlaylistEntryWithTransition — the deck
    // still plays one pattern. Same 409/EBUSY mid-transition contract as the
    // deck branch.
    try {
      const res = await fetchWithTimeout(`${api_base}/deck/playlist/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, slot: channelId }),
      });
      const data = await res.json();
      const code = !res.ok && data && data.code
        ? String(data.code)
        : (!res.ok && res.status === 409 ? 'EBUSY' : undefined);
      return { ok: res.ok, data, code, error: !res.ok ? (data && data.error) : undefined };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
  return setMixerChannelPlaylistEntry(channelId, entryId);
}

// The deck split-playlist slots as one object: { primary, secondary, splitRatio }.
// `primary`/`secondary` are the virtual slot assignments (null when unbound);
// `splitRatio` is the divider's pane-1 share. Used by the deck seed to hydrate
// the divider + secondary-presence before the first `deck` WS broadcast lands.
export interface DeckPlaylistSlots {
  primary: PlaylistAssignment | null;
  secondary: PlaylistAssignment | null;
  splitRatio: number;
}

export async function fetchDeckPlaylistSlots(): Promise<ApiResult<DeckPlaylistSlots | null>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/playlist/slots`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data: data as DeckPlaylistSlots };
  } catch (err: any) {
    warnThrottled('Fetch deck playlist slots failed:', 'Fetch deck playlist slots failed:', err);
    return { ok: false, error: err.message };
  }
}

// Set the deck split-pane divider RATIO (0..1, pane-1 share). Called once per
// drag gesture on RELEASE (not per move). The engine 400s a non-finite ratio or
// one outside [0.15, 0.85] (fail loud — no clamp-on-write); the caller clamps
// its OWN drag range so a valid gesture always lands. The new ratio rides the
// `deck` WS broadcast's `playlistSlots.splitRatio` back to every iPad.
export async function setDeckPlaylistSplit(ratio: number): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/deck/playlist/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratio }),
    });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : (data?.error || `HTTP ${res.status}`) };
  } catch (err: any) {
    warnThrottled('Set deck playlist split failed:', 'Set deck playlist split failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchMixerChannelPlaylist(channelId: string): Promise<ApiResult<PlaylistAssignment | null>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/playlist`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function setMixerChannelPlaylist(channelId: string, name: string | null): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    // The engine now bundles the FULL playlist data inline in this
    // response. Seed the per-name cache with it so the next consumer
    // (PlaylistPanel rendering the entry list, deck/mixer rendering
    // their own labels) hits the cache instead of issuing a slow
    // GET /playlists/<name>. See engine_inline_playlist in api_server.js.
    if (res.ok && data && data.playlistData && data.playlistData.name) {
      primePlaylistCache(data.playlistData.name, data.playlistData as PlaylistData);
    }
    return { ok: res.ok, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function setMixerChannelPlaylistEntry(channelId: string, entryId: string): Promise<ApiResult<any> & { code?: string }> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/playlist/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId }),
    });
    const data = await res.json();
    // Surface the server's 'EBUSY' marker explicitly so the deck
    // PlaylistPanel can swallow "swap in flight" rejections silently
    // (the operator gets visual disabled-state instead of alert spam
    // when they double-tap during a transition).
    const code = !res.ok && data && data.code
      ? String(data.code)
      : (!res.ok && res.status === 409 ? 'EBUSY' : undefined);
    return { ok: res.ok, data, code, error: !res.ok ? (data && data.error) : undefined };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function captureMixerChannelDefaults(channelId: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/playlist/capture`, { method: 'POST' });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : data?.error };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Throw away in-memory edits and reset the channel to the saved playlist
// entry defaults. Paired with captureMixerChannelDefaults() to give the
// user the "save or discard" choice on unlock.
export async function discardMixerChannelDefaults(channelId: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/playlist/discard`, { method: 'POST' });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : data?.error };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function addMixerChannel(opts: { playlist?: string; playlistEntryId?: string; pattern?: string; name?: string; mode?: string; fader?: number }): Promise<ApiResult<{ channelId: string; pattern: string; playlist: PlaylistAssignment | null; playlistData?: PlaylistData | null }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    // Engine response carries the full playlist content inline. Seed
    // the cache so the brand-new channel's PlaylistPanel renders the
    // entry list from the in-memory cache on first mount instead of
    // racing a follow-up GET /playlists/<name>. THIS IS THE FIX for
    // the "stuck on Loading" bug when adding multiple channels
    // quickly. See api_server.js (POST /mixer/channels handler).
    if (res.ok && data && data.playlistData && data.playlistData.name) {
      primePlaylistCache(data.playlistData.name, data.playlistData as PlaylistData);
    }
    return { ok: res.ok, data, error: res.ok ? undefined : data?.error };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function setMixerChannelControl(channelId: string, id: number, v0: number, v1?: number, v2?: number): Promise<ApiResult<any>> {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // Codex P0 — fail loud: an engine rejection of a mixer control write
    // (404 unknown channel, 400 bad param id, 500) used to be swallowed as
    // { ok: true }, so the manager's surfaceApiResult never saw the failure and
    // a rejected mixer knob looked like a silent no-op. Report the real status,
    // mirroring setDeckChannelControl / updateMixerChannel.
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : (data?.error || `HTTP ${res.status}`) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Global Effect Macros (docs/28) ─────────────────────────────────
export type GlobalEffectSlot = {
  slotId: number;
  enabled: boolean;
  label: string;
  effectId: string;
  presetId: string;
  behavior: string;
  paramsOverride: Record<string, any>;
};

export type GlobalEffectSlotStatus = GlobalEffectSlot & {
  active: boolean;
  safetyTier: string | null;
  resolveError: string | null;
  // Driver #3 (VSN1) intensity surface. The slot's current intensity (0..1),
  // its default (the jog-press reset target), and a display label — carried on
  // the status so the VSN1 jog's soft-takeover pickup guard can seed the
  // selected slot's live value. Optional for staleness safety: an engine that
  // predates the field leaves them undefined and the jog stays inert until the
  // value threads through (never anchors on a fabricated 0).
  intensity?: number;
  intensityDefault?: number;
  intensityLabel?: string;
  // Effects v2 (32 paged slots): the slot's discrete `primaryMode`. `mode` is the
  // current value (a boolean, a tempo division like '1/4', or any registry value);
  // `modeLabel` is the display label (e.g. 'Direction'); `modeValues` is the full
  // ordered value list the VSN1 encoder-press cycles through. Optional for
  // staleness safety — a pre-field engine leaves them undefined and the mode UI /
  // MIDI cycle stays inert (never invents a value).
  mode?: string | number | boolean | null;
  modeLabel?: string;
  modeValues?: (string | number | boolean)[];
  // Declarative value-encoder opt-out mirrored from the engine effect
  // (global_effect_library.js — e.g. fogger.valueParam='none'). When 'none' the
  // effect has NO magnitude knob and the UI/VSN1 disables the value encoder for
  // this slot. Optional for staleness safety: a pre-field engine leaves it
  // undefined and the UI falls back to its own override table
  // (effect_picker_logic.ts slotDisablesEncoder).
  valueParam?: string | null;
};

// Effects v2: the active effects PAGE (0..3). Page p views the 32 flat slots
// `8p+1 .. 8p+8`. The engine is the single source of truth — every surface
// (CaptainPad page switcher, VSN1 side buttons) reads/writes it through here and
// follows the WS `effectsPage` broadcast, so no surface keeps a private page.
export async function fetchEffectsPage(): Promise<ApiResult<{ effectsPage: number }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/page`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fetch-effects-page', 'Failed to fetch effects page:', err);
    return { ok: false, error: err.message };
  }
}

// PATCH the active effects page (0..3). The engine's canonical contract is the
// body key `effectsPage` (GET/PATCH + the `effectsPage` WS broadcast all use it);
// it 400s on `undefined`. On success the engine broadcasts `effectsPage` so every
// surface converges. Mirrors the fail-loud error shape.
export async function setEffectsPage(page: number): Promise<ApiResult<{ effectsPage: number }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/page`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effectsPage: page }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('set-effects-page', 'Failed to set effects page:', err);
    return { ok: false, error: err.message };
  }
}

// ── Named effect banks — an ORDERED LIST of NAMED effect sets, cycled by the
// VSN1 sb_2 (always >= 1). The ENGINE is the single source of truth: state YAML
// v3 `{ version:3, activeBankId, effectsPage, banks:[{id,name,slots}] }`,
// GET /global-effects/banks, WS-broadcast `{type:'effectBanks', banks, activeBankId,
// source?}` on any switch/create/delete/rename + replayed on connect. A switch
// broadcasts the new bank's `globalEffectMacroStatus` so the grid swaps slot
// CONTENT. Every surface follows the broadcast — no surface keeps a private bank.
export interface EffectBankSummary {
  id: string;
  name: string;
  slotCount: number;
}

export interface EffectBanksPayload {
  banks: EffectBankSummary[];
  activeBankId: string | null;
}

// GET the ordered bank list + the active id (the seed for the UI badge/controls
// and the MIDI snapshot). Fail-loud on a non-ok status.
export async function fetchEffectBanks(): Promise<ApiResult<EffectBanksPayload>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/banks`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, data: { banks: json.banks, activeBankId: json.activeBankId } };
  } catch (err: any) {
    warnThrottled('fetch-effect-banks', 'Failed to fetch effect banks:', err);
    return { ok: false, error: err.message };
  }
}

export interface EffectBankCycleResult {
  activeBankId: string;
  bankName: string;
  index: number;
  count: number;
}

// POST an ATOMIC cycle+wrap to the NEXT bank (the VSN1 sb_2 dispatch). The engine
// computes the target server-side — NO client-computed target — and broadcasts
// `effectBanks` so every surface converges (no optimistic switch). Optional
// `source` is a provenance tag threaded into the body so the engine can log +
// echo WHICH surface cycled (e.g. 'vsn1_sb2'); omitted → the body key is not sent.
export async function nextEffectBank(source?: string): Promise<ApiResult<EffectBankCycleResult>> {
  try {
    const body: { source?: string } = {};
    if (source) body.source = source;
    const res = await fetchWithTimeout(`${api_base}/global-effects/banks/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('next-effect-bank', 'Failed to cycle effect bank:', err);
    return { ok: false, error: err.message };
  }
}

// PATCH the ACTIVE bank directly to `bankId` (a UI bank tap). The engine
// broadcasts `effectBanks` so every surface converges. Optional `source` provenance
// tag, same contract as nextEffectBank. Fail-loud on a non-ok status.
export async function setActiveEffectBank(
  bankId: string,
  source?: string,
): Promise<ApiResult<{ activeBankId: string }>> {
  try {
    const body: { bankId: string; source?: string } = { bankId };
    if (source) body.source = source;
    const res = await fetchWithTimeout(`${api_base}/global-effects/banks/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('set-active-effect-bank', 'Failed to set active effect bank:', err);
    return { ok: false, error: err.message };
  }
}

// POST a new bank (optional `name`; the engine names an untitled one). The engine
// broadcasts `effectBanks` so the list converges. Fail-loud on a non-ok status.
export async function createEffectBank(name?: string): Promise<ApiResult<{ id: string; name: string }>> {
  try {
    const body: { name?: string } = {};
    if (name) body.name = name;
    const res = await fetchWithTimeout(`${api_base}/global-effects/banks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('create-effect-bank', 'Failed to create effect bank:', err);
    return { ok: false, error: err.message };
  }
}

// DELETE a bank by id. The engine 409s on the LAST bank (>= 1 invariant) — that
// status is surfaced verbatim (fail-loud), not swallowed. On success it
// broadcasts `effectBanks`. `id` is path-encoded so an arbitrary bank id is safe.
export async function deleteEffectBank(id: string): Promise<ApiResult<{ activeBankId: string }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/banks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('delete-effect-bank', 'Failed to delete effect bank:', err);
    return { ok: false, error: err.message };
  }
}

// PATCH a bank's `name` by id. The engine broadcasts `effectBanks` so the badge +
// list converge. Fail-loud on a non-ok status.
export async function renameEffectBank(id: string, name: string): Promise<ApiResult<{ id: string; name: string }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/banks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('rename-effect-bank', 'Failed to rename effect bank:', err);
    return { ok: false, error: err.message };
  }
}

// Effects v2: cycle a slot's discrete `primaryMode` to the NEXT value in its
// `modeValues` list (the VSN1 encoder press). POST /global-effect-slots/:id/mode/cycle.
export async function cycleGlobalEffectSlotMode(slotId: number): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/${slotId}/mode/cycle`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`slot-${slotId}-mode-cycle`, `Failed to cycle slot ${slotId} mode:`, err);
    return { ok: false, error: err.message };
  }
}

// Effects v2 (VSN1 small buttons, 2026-07-09): reset EVERY global-effect slot's
// primary intensity + mode back to its default. POST /global-effects/reset-all.
// Bound to VSN1 small button sb_2. The engine broadcasts the change so every
// surface converges.
export async function resetAllGlobalEffects(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/reset-all`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('global-effects-reset-all', 'Failed to reset all global effects:', err);
    return { ok: false, error: err.message };
  }
}

// Effects v2 (VSN1 small buttons, 2026-07-09): turn OFF every currently-active
// global effect (values kept). POST /global-effects/disable-all. Bound to VSN1
// small button sb_3. The engine broadcasts the change so every surface converges.
export async function disableAllGlobalEffects(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effects/disable-all`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('global-effects-disable-all', 'Failed to disable all global effects:', err);
    return { ok: false, error: err.message };
  }
}

// Effects v2: SET a slot's discrete `primaryMode` to an explicit value (the UI
// mode picker). POST /global-effect-slots/:id/mode { value }.
export async function setGlobalEffectSlotMode(
  slotId: number,
  value: string | number | boolean,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/${slotId}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`slot-${slotId}-mode-set`, `Failed to set slot ${slotId} mode:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchGlobalEffectSlots(): Promise<ApiResult<{ slots: GlobalEffectSlot[] }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fetch-global-effect-slots', 'Failed to fetch global effect slots:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchGlobalEffectSlotsStatus(): Promise<ApiResult<{ slots: GlobalEffectSlotStatus[]; controller: any }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/status`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fetch-global-effect-slots-status', 'Failed to fetch global effect slot status:', err);
    return { ok: false, error: err.message };
  }
}

export async function dispatchGlobalEffectSlotAction(
  slotId: number,
  action: 'activate' | 'deactivate' | 'trigger' | 'toggle' | 'down' | 'up',
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/${slotId}/${action}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`slot-${slotId}-${action}`, `Failed to ${action} slot ${slotId}:`, err);
    return { ok: false, error: err.message };
  }
}

// Driver #3 (Intech VSN1): write a global-effect slot's `intensity` (0..1). The
// VSN1 jog wheel (absolute mode) drives this for whichever slot the operator
// last pressed on that surface. POST /global-effect-slots/:slotId/intensity
// { value }. Mirrors dispatchGlobalEffectSlotAction's fail-loud error shape.
export async function setGlobalEffectSlotIntensity(
  slotId: number,
  value: number,
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/${slotId}/intensity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`slot-${slotId}-intensity`, `Failed to set slot ${slotId} intensity:`, err);
    return { ok: false, error: err.message };
  }
}

// Driver #3 (Intech VSN1): reset a global-effect slot's intensity to its
// default (the VSN1 jog press). POST /global-effect-slots/:slotId/intensity/reset.
export async function resetGlobalEffectSlotIntensity(slotId: number): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/${slotId}/intensity/reset`, {
      method: 'POST',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`slot-${slotId}-intensity-reset`, `Failed to reset slot ${slotId} intensity:`, err);
    return { ok: false, error: err.message };
  }
}

export async function panicStopGlobalEffectMacros(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-macros/panic-stop`, {
      method: 'POST',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Unified e-stop endpoint. POST /global-effect-macros/blackout
// sets the engine's pixel-level blackout AND clears every active
// macro / legacy global effect so the rig stays dark until released.
// Body: { enabled: boolean }. Server returns the resolved flag so
// the UI can confirm the round-trip without waiting for the WS push.
export async function setGlobalEffectBlackout(enabled: boolean): Promise<ApiResult<{ blackout: boolean }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-macros/blackout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('global-effect-blackout', 'Failed to set global effect blackout:', err);
    return { ok: false, error: err.message };
  }
}

// Global color INVERT toggle (docs/39 §F-invert). A first-class boolean
// toggle (sibling of blackout, NOT a GEM slot): inverts the RGB triad of
// the whole post-mixer buffer (1 - v), leaving W/A/UV untouched so the
// mission-critical exterior whites never flip. POST /global-effect-invert
// { enabled: boolean } → { status:'ok', invert } and broadcasts
// { type:'globalInvert', invert } on /ws/control. Mirrors
// setGlobalEffectBlackout's shape + fail-loud error handling exactly.
export async function setGlobalInvert(enabled: boolean): Promise<ApiResult<{ status: string; invert: boolean }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-invert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('global-effect-invert', 'Failed to set global effect invert:', err);
    return { ok: false, error: err.message };
  }
}

// PATCH a single slot binding. Sub-helper of the GlobalEffectMacros
// hold-to-swap sheet — operator long-presses a slot, picks a new
// effect/preset, and we round-trip the change here. The engine
// broadcasts `globalEffectSlots` on success so connected clients
// refresh in lockstep without us awaiting the response.
export async function patchGlobalEffectSlot(
  slotId: number,
  patch: { effectId?: string; presetId?: string; behavior?: string; label?: string; enabled?: boolean; paramsOverride?: Record<string, any> },
): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-slots/${slotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`patch-slot-${slotId}`, `Failed to patch slot ${slotId}:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchGlobalEffectLibrary(): Promise<ApiResult<{ effects: Record<string, any> }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/global-effect-library`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled('fetch-global-effect-library', 'Failed to fetch global effect library:', err);
    return { ok: false, error: err.message };
  }
}

// ── Scheduled tasks (docs/31 v3) ───────────────────────────────────────
// Engine-owned scheduler. Each task binds to (effectId, presetId) from
// the global effect library and fires on a server-side 250 ms tick. The
// scheduler keeps running while the iPad is asleep / closed; CaptainPad
// is purely a UI surface. See the Phase 1 engine report
// (.agent/reports/202605/20260527_2_scheduler_engine.md) for the
// full wire contract and the docs/31_scheduled_tasks.md design doc.
//
// All optimistic state lives in the caller — these helpers just
// surface the engine's response (or its 400 error message) so the
// codex P0 "no fallback behaviors" rule holds (no retry-on-400, no
// silent clamp).

export type ScheduledTaskStatus = 'disabled' | 'armed' | 'firing' | 'error';

export type ScheduledTask = {
  id: string;
  label: string;
  effectId: string;
  presetId: string;
  params: Record<string, number | string | boolean | null> | null;
  enabled: boolean;
  mode: 'duration';
  onDurationMs: number;
  intervalMs: number;
  nextFireAtMs: number | null;
  firingUntilMs: number | null;
  lastFiredAtMs: number | null;
  lastStoppedAtMs: number | null;
  status: ScheduledTaskStatus;
  lastError: string | null;
  lastMissedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ScheduledTaskPresets = {
  onDurationMs: number[];
  intervalMs: number[];
};

export type ScheduledTaskCreate = {
  label?: string;
  effectId: string;
  presetId: string;
  params?: Record<string, number | string | boolean | null>;
  enabled: boolean;
  mode: 'duration';
  onDurationMs: number;
  intervalMs: number;
};

export type ScheduledTaskPatch = Partial<{
  label: string;
  effectId: string;
  presetId: string;
  params: Record<string, number | string | boolean | null> | null;
  enabled: boolean;
  onDurationMs: number;
  intervalMs: number;
}>;

export async function fetchScheduledTasks(): Promise<ApiResult<{ tasks: ScheduledTask[]; presets: ScheduledTaskPresets }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/scheduled-tasks`);
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('fetch-scheduled-tasks', 'Failed to fetch scheduled tasks:', err);
    return { ok: false, error: err.message };
  }
}

export async function createScheduledTask(body: ScheduledTaskCreate): Promise<ApiResult<{ task: ScheduledTask }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/scheduled-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function patchScheduledTask(id: string, partial: ScheduledTaskPatch): Promise<ApiResult<{ task: ScheduledTask }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/scheduled-tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function deleteScheduledTask(id: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/scheduled-tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function fireScheduledTaskNow(id: string): Promise<ApiResult<{ task: ScheduledTask }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/scheduled-tasks/${encodeURIComponent(id)}/fire-now`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function stopScheduledTask(id: string): Promise<ApiResult<{ task: ScheduledTask }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/scheduled-tasks/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── Playlist modulation CRUD (docs/26 Phase 1A) ──────────────────────────
// Endpoints expose mappings scoped to (playlist, item, mappingId). All
// validation lives in the engine; these wrappers surface 4xx errors as
// `{ ok: false, error }`.

// Mic-band sources are populated by the engine's audio analysis
// pipeline (the Audio Companion routes them into the CPC over OSC).
// When the pipeline is OFF the value defaults to 0 and the mapping
// evaluates as a no-op (so the operator's "no change when source
// disabled" expectation holds). The legacy `stems*` sources were
// removed engine-side (the Audio Companion is the sole analyzer); a
// modulation referencing one would never receive a value.
//
// The mod-source picker is rendered DYNAMICALLY from the live audio CPC
// keys (the contract's curated set), so this type is the open `string`
// the engine accepts rather than a hand-listed enum that could drift.
export type ModulationSourceKey = string;
// Modulation modes mirror marsin_engine/lib/modulation_engine.js:
//   offset   — add the scaled signal to the static value.
//   multiply — use the scaled signal as a MULTIPLIER over the static value.
//   override — drive the param directly from the scaled signal (the `!`).
// 'scale' was the legacy name for 'multiply'; the engine migrates it on load
// and so does CaptainPad (see migrateModulationMode) — it is NOT a valid mode
// to write, so it is intentionally absent from this union.
export type ModulationMode = 'offset' | 'multiply' | 'override';

// Migrate a loaded mode string to the current contract. The engine accepts
// 'scale' as a legacy alias for 'multiply'; mirror that here when reading an
// existing mapping so editing it doesn't surface an unknown mode.
export function migrateModulationMode(mode: unknown): ModulationMode {
  if (mode === 'scale') return 'multiply';
  if (mode === 'multiply' || mode === 'override') return mode;
  return 'offset';
}
export type ModulationPolarity = 'unipolar' | 'bipolar';
export type ModulationCurve = 'linear' | 'easeIn' | 'easeOut' | 'exp';

/**
 * The pattern author's RECOMMENDED audio binding for one parameter, as
 * declared in the pattern source's `AUDIO_MODULATION_V1` header block and
 * stamped onto the export by the engine (`annotateCodeDefaults` in
 * api_server.js). See report 20260806_184.
 *
 * It is METADATA and nothing else:
 *   - it never changes the parameter's name or value;
 *   - it is never applied automatically — the operator's saved mapping is the
 *     only truth, and a suggestion only ever PREFILLS the create flow when the
 *     operator explicitly taps the suggestion badge;
 *   - absent means absent. A parameter with no suggestion simply has no field,
 *     and nothing infers one.
 *
 * `curve` is the token the header declared; `modulationCurve` is the same
 * curve named in this app's `ModulationCurve` vocabulary, translated ONCE by
 * the engine so no client keeps a private lookup table.
 */
export type AudioSuggestion = {
  version: string;
  signal: ModulationSourceKey;
  range: [number, number];
  curve: 'linear' | 'pow2' | 'ease';
  modulationCurve: ModulationCurve;
  note?: string;
};

export type ModulationMapping = {
  id: string;
  type: 'continuous';
  enabled: boolean;
  source: { scope: 'cpc'; key: ModulationSourceKey; label?: string };
  target: { scope: 'pattern'; parameter: string };
  mode: ModulationMode;
  polarity: ModulationPolarity;
  range: [number, number];
  curve: ModulationCurve;
};

function modulationUrl(playlistName: string, itemId: string, mappingId: string): string {
  return `${api_base}/api/playlists/${encodeURIComponent(playlistName)}` +
    `/items/${encodeURIComponent(itemId)}` +
    `/modulations/${encodeURIComponent(mappingId)}`;
}

export async function putModulation(
  playlistName: string, itemId: string, mapping: ModulationMapping,
): Promise<ApiResult<{ status: string; entry: any }>> {
  try {
    const res = await fetchWithTimeout(modulationUrl(playlistName, itemId, mapping.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    // Symmetric with savePlaylist (line 1059): drop the cached
    // playlist immediately so the popover's onChanged → refetch
    // doesn't race the engine's `playlistSaved` WS broadcast and
    // return the pre-save snapshot. Without this, the ◎ ON badge
    // didn't light up until the next WS event invalidated the
    // cache (or the operator restarted the app).
    invalidatePlaylistCache(playlistName);
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('put-modulation', `Failed to PUT modulation:`, err);
    return { ok: false, error: err.message };
  }
}

export async function patchModulation(
  playlistName: string, itemId: string, mappingId: string, patch: Partial<ModulationMapping>,
): Promise<ApiResult<{ status: string; entry: any }>> {
  try {
    const res = await fetchWithTimeout(modulationUrl(playlistName, itemId, mappingId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    invalidatePlaylistCache(playlistName);
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('patch-modulation', `Failed to PATCH modulation:`, err);
    return { ok: false, error: err.message };
  }
}

export async function deleteModulation(
  playlistName: string, itemId: string, mappingId: string,
): Promise<ApiResult<{ status: string; entry: any }>> {
  try {
    const res = await fetchWithTimeout(modulationUrl(playlistName, itemId, mappingId), {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    invalidatePlaylistCache(playlistName);
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('delete-modulation', `Failed to DELETE modulation:`, err);
    return { ok: false, error: err.message };
  }
}

// ── MIDI mappings (docs/34) ────────────────────────────────────────
//
// Binds a physical MIDI control (a fader/knob) to a pattern's LOCAL
// parameter. Stored per playlist entry, MIRRORING the modulation CRUD
// above (same endpoint shape, same cache invalidation, same
// `playlistSaved` broadcast) so bindings persist with the pattern and
// sync across every connected client.
//
// UNLIKE modulations these are PURE METADATA to the engine — its render
// loop never applies them. CaptainPad reads the focused pattern's
// midiMappings and, when the bound control moves, writes the param's
// STATIC value through the existing control path. Audio modulators stay
// layered on top untouched. Schema mirrors
// marsin_engine/lib/midi_mapping_engine.js validateMidiMapping.
export type MidiControlType = 'cc' | 'note';

export type MidiMapping = {
  id: string;
  enabled: boolean;
  // The physical control. channel 0-15, number 0-127 (cc number / note).
  control: { type: MidiControlType; channel: number; number: number };
  target: { scope: 'pattern'; parameter: string };
  // [min, max] the 0-127 control scales into. Same generous [-4, 4] window
  // the engine allows (a learned fader may invert/scale a [0,1] param).
  range: [number, number];
};

// Same [-4, 4] window as RANGE_MIN/RANGE_MAX in midi_mapping_engine.js (and
// modulation_engine.js). The learn + modulation popovers pre-clamp so a typo
// can't bounce the save with a 400.
export const MIDI_RANGE_LIMIT = 4;

/** Clamp a range value into the engine's [-MIDI_RANGE_LIMIT, MIDI_RANGE_LIMIT]
 *  window. Non-finite → 0. The single clamp both popovers share (was three
 *  parallel copies). */
export function clampToRangeLimit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < -MIDI_RANGE_LIMIT) return -MIDI_RANGE_LIMIT;
  if (x > MIDI_RANGE_LIMIT) return MIDI_RANGE_LIMIT;
  return x;
}

function midiMappingUrl(playlistName: string, itemId: string, mappingId: string): string {
  return `${api_base}/api/playlists/${encodeURIComponent(playlistName)}` +
    `/items/${encodeURIComponent(itemId)}` +
    `/midi-mappings/${encodeURIComponent(mappingId)}`;
}

export async function putMidiMapping(
  playlistName: string, itemId: string, mapping: MidiMapping,
): Promise<ApiResult<{ status: string; entry: any }>> {
  try {
    const res = await fetchWithTimeout(midiMappingUrl(playlistName, itemId, mapping.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    // Drop the cached playlist immediately (same race-avoidance as
    // putModulation) so the next refetch sees the new binding before the
    // engine's `playlistSaved` WS broadcast lands.
    invalidatePlaylistCache(playlistName);
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('put-midi-mapping', `Failed to PUT midi mapping:`, err);
    return { ok: false, error: err.message };
  }
}

export async function patchMidiMapping(
  playlistName: string, itemId: string, mappingId: string, patch: Partial<MidiMapping>,
): Promise<ApiResult<{ status: string; entry: any }>> {
  try {
    const res = await fetchWithTimeout(midiMappingUrl(playlistName, itemId, mappingId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    invalidatePlaylistCache(playlistName);
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('patch-midi-mapping', `Failed to PATCH midi mapping:`, err);
    return { ok: false, error: err.message };
  }
}

export async function deleteMidiMapping(
  playlistName: string, itemId: string, mappingId: string,
): Promise<ApiResult<{ status: string; entry: any }>> {
  try {
    const res = await fetchWithTimeout(midiMappingUrl(playlistName, itemId, mappingId), {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    invalidatePlaylistCache(playlistName);
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('delete-midi-mapping', `Failed to DELETE midi mapping:`, err);
    return { ok: false, error: err.message };
  }
}

// Fetch the saved playlist (entries + per-entry modulations). Used by
// the modulation popover so it can pre-fill an existing mapping for
// the current entry. Distinct from the inline-cached version used by
// PlaylistPanel — this is on-demand and uncached.
export async function fetchPlaylistByName(name: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists/${encodeURIComponent(name)}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err: any) {
    warnThrottled(`fetch-playlist-${name}`, `Failed to fetch playlist ${name}:`, err);
    return { ok: false, error: err.message };
  }
}
