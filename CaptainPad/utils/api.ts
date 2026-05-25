import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const defaultConfigsRaw: any = require('@/config.yaml');
const defaultConfigs = defaultConfigsRaw?.default || defaultConfigsRaw || {};

// Fail fast: config.yaml is the single source of truth for the default engine
// address. If the YAML loader returned an asset URI string (because metro's
// assetExts was misconfigured) or the key is missing, surface the misconfig
// instead of silently falling back to a stale hard-coded IP.
if (!defaultConfigs || typeof defaultConfigs !== 'object' || typeof defaultConfigs.api_base !== 'string' || !defaultConfigs.api_base) {
  throw new Error(
    'CaptainPad config error: CaptainPad/config.yaml must define `api_base` as a non-empty string. ' +
      'Got: ' + JSON.stringify(defaultConfigs),
  );
}

let api_base: string = defaultConfigs.api_base;
const DEFAULT_API_BASE: string = defaultConfigs.api_base;

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
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
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

// ── Async-safe API base resolution ────────────────────────────────────────
// Screens must await getApiBaseAsync() before their first network call
// to avoid racing AsyncStorage on cold start.
let _resolved = false;
let _resolvePromise: Promise<string> | null = null;



export function getApiBase(): string {
  return api_base;
}

/**
 * Await this before the first network call on any screen.
 * Returns the resolved api_base (from AsyncStorage or YAML default).
 */
export async function getApiBaseAsync(): Promise<string> {
  if (_resolved) return api_base;
  if (!_resolvePromise) {
    _resolvePromise = AsyncStorage.getItem('API_BASE').then(val => {
      if (val) api_base = val;
      _resolved = true;
      return api_base;
    });
  }
  return _resolvePromise;
}

export function getDefaultApiBase(): string {
  return DEFAULT_API_BASE;
}

export async function setApiBase(val: string) {
  api_base = val;
  _resolved = true;
  if (val === DEFAULT_API_BASE) {
    await AsyncStorage.removeItem('API_BASE');
  } else {
    await AsyncStorage.setItem('API_BASE', val);
  }
}

// ── Connection Health ─────────────────────────────────────────────────────

export interface ConnectionResult {
  ok: boolean;
  data?: {
    activeScene?: string;
    activeModel?: string;
    activePattern?: string;
    unrealState?: string;
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
    const res = await fetch(`${url}/status`, { signal: controller.signal });
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
}

export async function sendControl(id: number, v0: number, v1?: number, v2?: number): Promise<ApiResult<any>> {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;

    const res = await fetch(`${api_base}/control`, {
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

export async function fetchPatterns(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetch(`${api_base}/list-patterns`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch patterns failed:', 'Fetch patterns failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchChannelBlends(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetch(`${api_base}/channel-blends`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch channel blends failed:', 'Fetch channel blends failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchTransitions(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetch(`${api_base}/transitions`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    warnThrottled('Fetch transitions failed:', 'Fetch transitions failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function setActivePattern(pattern: string): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/set-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Set active pattern failed:', 'Set active pattern failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchExports(): Promise<ApiResult<any[]>> {
  try {
    const res = await fetch(`${api_base}/exports`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch exports failed:', 'Fetch exports failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function setSectionBrightness(sectionId: number, brightness: number): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/section-brightness`, {
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
    const res = await fetch(`${api_base}/dimmers`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch dimmers failed:', 'Fetch dimmers failed:', err);
    return { ok: false, error: err.message, data: {} };
  }
}

export async function fetchDimmerGroups(): Promise<ApiResult<Record<string, number>>> {
  try {
    const res = await fetch(`${api_base}/dimmer-groups`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch dimmer groups failed:', 'Fetch dimmer groups failed:', err);
    return { ok: false, error: err.message, data: {} };
  }
}

export async function setGlobalBlackout(state: boolean): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/global-blackout`, {
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
    const res = await fetch(`${api_base}/global-effect`, {
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

export async function setMixerView(view: 'deck' | 'mixer'): Promise<ApiResult<any>> {
  // The deck is always bound to its base channel — the old `deckChannel`
  // override argument was removed along with the TARGET CHANNEL picker
  // in May 2026. See docs/16_captain_pad.md §"Target channel removal".
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view }),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    warnThrottled(`set-mixer-view-${view}`, `Failed to set mixer view to ${view}:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchPatternCode(name: string): Promise<ApiResult<string>> {
  try {
    const res = await fetch(`${api_base}/pattern-code?name=${name}`);
    const text = await res.text();
    return { ok: true, data: text };
  } catch (err: any) {
    warnThrottled('Fetch pattern code failed:', 'Fetch pattern code failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function getAutopilot(): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/autopilot`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    warnThrottled('Fetch autopilot failed:', 'Fetch autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function setAutopilot(active?: boolean, delay_s?: string, shuffle?: boolean): Promise<ApiResult<any>> {
  try {
    const payload: any = {};
    if (active !== undefined) payload.active = active;
    if (delay_s !== undefined) payload.delay_s = delay_s;
    if (shuffle !== undefined) payload.shuffle = shuffle;
    
    const res = await fetch(`${api_base}/autopilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    warnThrottled('Set autopilot failed:', 'Set autopilot failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function savePatternCode(name: string, code: string): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/save-pattern`, {
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
    const res = await fetch(`${api_base}/param-center/schema`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchParamCenter(): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/param-center`);
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    return { ok: false, error: err.message };
  }
}

export async function updateParamCenter(params: Record<string, any>): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/param-center`, {
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
    return { ok: res.ok, data };
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

export async function fetchAudioStatus(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/audio/status`);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function fetchMixerState(): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer`);
    const data = await res.json();
    return { ok: true, data };
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
    const data = await res.json();
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
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function removeMixerChannel(id: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${id}`, { method: 'DELETE' });
    const data = await res.json();
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
  autopilot?: { active: boolean; delay_s: number; shuffle: boolean };
}

export async function fetchPlaylists(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchPlaylist(name: string): Promise<ApiResult<PlaylistData>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists/${encodeURIComponent(name)}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function savePlaylist(playlist: { name: string; entries: PlaylistEntry[] }): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playlist),
    });
    const data = await res.json();
    return { ok: res.ok, data, error: res.ok ? undefined : (data?.error || `HTTP ${res.status}`) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function deletePlaylist(name: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/playlists/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// NOTE: There used to be deck-specific playlist helpers
// (fetchDeckPlaylist/setDeckPlaylist/captureDeckDefaults/setDeckPlaylistAutopilot)
// but the deck's "base" channel is just another mixer channel, so we use
// `/mixer/channels/:id/playlist*` for both deck and mixer. The /deck/playlist
// endpoints in the engine remain as thin aliases for back-compat.

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
    return { ok: res.ok, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function setMixerChannelPlaylistEntry(channelId: string, entryId: string): Promise<ApiResult<any>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels/${channelId}/playlist/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
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

export async function addMixerChannel(opts: { playlist?: string; playlistEntryId?: string; pattern?: string; name?: string; mode?: string; fader?: number }): Promise<ApiResult<{ channelId: string; pattern: string; playlist: PlaylistAssignment | null }>> {
  try {
    const res = await fetchWithTimeout(`${api_base}/mixer/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
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
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
