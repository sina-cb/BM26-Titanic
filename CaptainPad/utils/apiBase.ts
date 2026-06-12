// apiBase — engine address resolution, extracted from api.ts.
//
// LEAF MODULE by design: it must import nothing from utils/, because
// both api.ts AND the WS buses (engineBus.ts) need the resolved
// engine base. When engineBus imported it from api.ts the dependency
// ring api → engineEvents → engineBus → api appeared — harmless until
// it isn't (require cycles resolve to partially-initialized modules
// depending on import order). Keep this file dependency-free.

import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Exported as a LIVE BINDING: api.ts reads `${api_base}/...` at call
// time and ESM import bindings track reassignments made here (the only
// writers are setApiBase / getApiBaseAsync below).
export let api_base: string = defaultConfigs.api_base;
const DEFAULT_API_BASE: string = defaultConfigs.api_base;

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
