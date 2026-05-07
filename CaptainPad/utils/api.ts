import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const defaultConfigsRaw: any = require('@/config.yaml');
const defaultConfigs = defaultConfigsRaw?.default || defaultConfigsRaw || {};

let api_base = defaultConfigs.api_base || 'http://10.1.1.172:6968';

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

export async function setApiBase(val: string) {
  api_base = val;
  _resolved = true;
  if (val === defaultConfigs.api_base) {
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
    console.warn('Control request failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchPatterns(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetch(`${api_base}/list-patterns`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    console.warn('Fetch patterns failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchChannelBlends(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetch(`${api_base}/channel-blends`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    console.warn('Fetch channel blends failed:', err);
    return { ok: false, error: err.message, data: [] };
  }
}

export async function fetchTransitions(): Promise<ApiResult<string[]>> {
  try {
    const res = await fetch(`${api_base}/transitions`);
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    console.warn('Fetch transitions failed:', err);
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
    console.warn('Set active pattern failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function fetchExports(): Promise<ApiResult<any[]>> {
  try {
    const res = await fetch(`${api_base}/exports`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    console.warn('Fetch exports failed:', err);
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
    console.warn(`Failed to set section ${sectionId} brightness:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchDimmers(): Promise<ApiResult<Record<string, number>>> {
  try {
    const res = await fetch(`${api_base}/dimmers`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    console.warn('Fetch dimmers failed:', err);
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
    console.warn(`Failed to set global blackout:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchGlobals(): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/globals`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    console.warn('Fetch globals failed:', err);
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
    console.warn(`Failed to set global effect ${effect}:`, err);
    return { ok: false, error: err.message };
  }
}

export async function setMixerView(view: 'deck' | 'mixer', deckChannel?: string | null): Promise<ApiResult<any>> {
  try {
    const body: any = { view };
    if (deckChannel !== undefined) body.deckChannel = deckChannel;
    const res = await fetch(`${api_base}/mixer/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch(err: any) {
    console.warn(`Failed to set mixer view to ${view}:`, err);
    return { ok: false, error: err.message };
  }
}

export async function fetchPatternCode(name: string): Promise<ApiResult<string>> {
  try {
    const res = await fetch(`${api_base}/pattern-code?name=${name}`);
    const text = await res.text();
    return { ok: true, data: text };
  } catch (err: any) {
    console.warn('Fetch pattern code failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function getAutopilot(): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/autopilot`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    console.warn('Fetch autopilot failed:', err);
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
    console.warn('Set autopilot failed:', err);
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

export async function fetchMixerState(): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/mixer`);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function addMixerChannel(pattern: string, name?: string, mode?: string, fader?: number): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/mixer/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, name, mode, fader }),
    });
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function updateMixerChannel(id: string, updates: any): Promise<ApiResult<any>> {
  try {
    const res = await fetch(`${api_base}/mixer/channels/${id}`, {
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
    const res = await fetch(`${api_base}/mixer`, {
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
    const res = await fetch(`${api_base}/mixer/channels/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function setMixerChannelControl(channelId: string, id: number, v0: number, v1?: number, v2?: number): Promise<ApiResult<any>> {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;
    const res = await fetch(`${api_base}/mixer/channels/${channelId}/control`, {
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
