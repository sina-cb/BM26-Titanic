// apiBase — engine address resolution, extracted from api.ts.
//
// LEAF MODULE by design: it must import nothing from utils/, because
// both api.ts AND the WS buses (engineBus.ts) need the resolved
// engine base. When engineBus imported it from api.ts the dependency
// ring api → engineEvents → engineBus → api appeared — harmless until
// it isn't (require cycles resolve to partially-initialized modules
// depending on import order). Keep this file dependency-free.
//
// `expo-constants`, react-native's `Platform` and `@/config.yaml` are the ONLY
// things this file may import (report _246). They are PLATFORM leaves: none of
// them imports anything from utils/, so no ring can form through them, and the
// rule above stays intact.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Static ESM import (not `require`) so the YAML default is a normal module edge:
// metro's yaml-transformer emits `export default { … }` and this is the same
// shape hooks/useMidiControl.ts imports its MIDI profiles with.
import defaultConfigsRaw from '@/config.yaml';

const defaultConfigs: any = (defaultConfigsRaw as any)?.default || defaultConfigsRaw || {};

// Fail fast: config.yaml is the single source of truth for the LAST-RESORT engine
// address. If the YAML loader returned an asset URI string (because metro's
// assetExts was misconfigured) or the key is missing, surface the misconfig
// instead of silently falling back to a stale hard-coded IP.
if (!defaultConfigs || typeof defaultConfigs !== 'object' || typeof defaultConfigs.api_base !== 'string' || !defaultConfigs.api_base) {
  throw new Error(
    'CaptainPad config error: CaptainPad/config.yaml must define `api_base` as a non-empty string. ' +
      'Got: ' + JSON.stringify(defaultConfigs),
  );
}

/** The engine's REST/WS port. Pinned — marsin_engine always listens here. */
export const ENGINE_API_PORT = 6968;

/**
 * Which of the documented sources the effective `api_base` came from.
 * Ordered the way they are consulted — see `resolveDefaultApiBase()`.
 */
export type ApiBaseSource = 'async-storage' | 'served-host' | 'metro-host' | 'config-yaml';

/** The raw `api_base` value shipped in CaptainPad/config.yaml. */
const CONFIG_YAML_API_BASE: string = defaultConfigs.api_base;

// ── Engine address RESOLUTION ─────────────────────────────────────────────
// This is address RESOLUTION, not a fallback behaviour: every step below reads
// a DIFFERENT, explicitly-named source of truth, in a fixed documented order,
// and logs which one won. Nothing here guesses an address or silently repairs a
// broken one — an unusable source yields `null` and we move to the next NAMED
// source, loudly.
//
//   1. AsyncStorage `API_BASE` — the operator's explicit per-device override
//      (Config tab). Always wins; resolved asynchronously in getApiBaseAsync().
//   2. THE HOST THE APP WAS SERVED FROM. The device that loaded CaptainPad from
//      10.1.1.151:6967 reached the show machine at 10.1.1.151 — so that is where
//      its engine is. Deriving means an iPad works on first launch with nothing
//      typed in. (Before _246 the default was config.yaml's 127.0.0.1, which is
//      the iPad ASKING ITSELF and dying on every call.)
//        · web  → window.location.hostname (covers prod's :6967 static dist, a
//                 dev-profile :6967 Metro, an agent's ephemeral 71xx
//                 verification server, and any future serve — hostname only,
//                 port pinned).
//        · native (Expo Go / dev client) → the Metro host from expo-constants.
//   3. CaptainPad/config.yaml `api_base` — the last resort, correct exactly when
//      the app runs ON the engine host (bench/dev) or in a bare test env where
//      there is no serving host at all.

/**
 * Wrap a bare IPv6 literal in brackets so it is legal inside a URL authority.
 * `window.location.hostname` yields `::1`, never `[::1]`.
 */
function urlHost(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

/**
 * Engine base for a host the app was reached on, or `null` when the hostname is
 * unusable (so the caller moves to the next NAMED source instead of inventing
 * an address).
 *
 * The scheme is pinned to `http` and the port to {@link ENGINE_API_PORT}: the
 * engine's API server is plain HTTP on 6968, so mirroring an https page scheme
 * would derive an address nothing answers on.
 */
export function engineBaseFromHostname(hostname: string | null | undefined): string | null {
  if (typeof hostname !== 'string') return null;
  const trimmed = hostname.trim();
  if (!trimmed) return null;
  return `http://${urlHost(trimmed)}:${ENGINE_API_PORT}`;
}

/**
 * Pull the HOSTNAME out of an Expo dev-server host string — `10.1.1.151:8081`,
 * `exp://10.1.1.151:8081`, `[::1]:8081`, `localhost:8081`.
 *
 * Only the host survives: Metro's port is not the engine's.
 * Returns `null` for anything that does not carry a host.
 */
export function hostnameFromMetroHostUri(hostUri: string | null | undefined): string | null {
  if (typeof hostUri !== 'string') return null;
  let rest = hostUri.trim();
  if (!rest) return null;

  const schemeAt = rest.indexOf('://');
  if (schemeAt >= 0) rest = rest.slice(schemeAt + 3);
  rest = rest.split('/')[0];
  if (!rest) return null;

  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) return null;
    return rest.slice(1, close) || null;
  }

  const colonAt = rest.indexOf(':');
  const host = colonAt >= 0 ? rest.slice(0, colonAt) : rest;
  return host || null;
}

/**
 * Source 2 for a NATIVE bundle: the Metro/dev-server host this bundle was
 * downloaded from. `expoConfig.hostUri` is the SDK 54 field (present whenever
 * the app is served by @expo/cli); `expoGoConfig.debuggerHost` is the same fact
 * under the key Expo Go populates. A standalone production build has neither —
 * it was never served by a dev server — and that correctly yields `null`.
 */
function metroHostname(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? null;
  return hostnameFromMetroHostUri(hostUri);
}

/** Source 2 for WEB: the hostname the browser loaded CaptainPad from. */
function servedWebHostname(): string | null {
  // expo-router prerenders routes in Node during `expo export`, where there is
  // no `window`. That pass legitimately has no serving host; the CLIENT bundle
  // re-evaluates this module in the browser, where it does.
  if (typeof window === 'undefined') return null;
  const hostname = window.location?.hostname;
  return typeof hostname === 'string' && hostname ? hostname : null;
}

function resolveDefaultApiBase(): { base: string; source: ApiBaseSource } {
  const hostname = Platform.OS === 'web' ? servedWebHostname() : metroHostname();
  const derived = engineBaseFromHostname(hostname);
  if (derived) {
    return { base: derived, source: Platform.OS === 'web' ? 'served-host' : 'metro-host' };
  }
  return { base: CONFIG_YAML_API_BASE, source: 'config-yaml' };
}

const _default = resolveDefaultApiBase();
const DEFAULT_API_BASE: string = _default.base;
const DEFAULT_API_BASE_SOURCE: ApiBaseSource = _default.source;

// One line, at load, naming the winning source — debuggability without spam.
if (DEFAULT_API_BASE_SOURCE === 'config-yaml') {
  console.warn(
    `[apiBase] no serving host to derive the engine address from (platform=${Platform.OS}) — ` +
      `using CaptainPad/config.yaml api_base: ${DEFAULT_API_BASE}`,
  );
} else {
  console.info(
    `[apiBase] engine address derived from the ${DEFAULT_API_BASE_SOURCE} ` +
      `(platform=${Platform.OS}): ${DEFAULT_API_BASE}`,
  );
}

// Exported as a LIVE BINDING: api.ts reads `${api_base}/...` at call
// time and ESM import bindings track reassignments made here (the only
// writers are setApiBase / getApiBaseAsync below).
export let api_base: string = DEFAULT_API_BASE;
let api_base_source: ApiBaseSource = DEFAULT_API_BASE_SOURCE;

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
 * Returns the resolved api_base (AsyncStorage override, else the resolved default).
 */
export async function getApiBaseAsync(): Promise<string> {
  if (_resolved) return api_base;
  if (!_resolvePromise) {
    _resolvePromise = AsyncStorage.getItem('API_BASE').then(val => {
      if (val) {
        api_base = val;
        api_base_source = 'async-storage';
      }
      _resolved = true;
      return api_base;
    });
  }
  return _resolvePromise;
}

/**
 * The address used when the operator has set NO override — derived from the
 * serving host when there is one, else CaptainPad/config.yaml's `api_base`.
 */
export function getDefaultApiBase(): string {
  return DEFAULT_API_BASE;
}

/** Which named source {@link getDefaultApiBase} came from. */
export function getDefaultApiBaseSource(): ApiBaseSource {
  return DEFAULT_API_BASE_SOURCE;
}

/** Which named source the CURRENTLY effective {@link getApiBase} came from. */
export function getApiBaseSource(): ApiBaseSource {
  return api_base_source;
}

export async function setApiBase(val: string) {
  api_base = val;
  _resolved = true;
  if (val === DEFAULT_API_BASE) {
    api_base_source = DEFAULT_API_BASE_SOURCE;
    await AsyncStorage.removeItem('API_BASE');
  } else {
    api_base_source = 'async-storage';
    await AsyncStorage.setItem('API_BASE', val);
  }
}
