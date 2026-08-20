import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchWithTimeout, getApiBaseAsync } from './api';
import {
  isValidPasscodeWaiver,
  passcodeWaiverBelongsToEngineOrigin,
  passcodeWaiverFromResponse,
  type PasscodeWaiverShape,
} from './passcode_waiver_logic';
import { normalizedOrigin } from './privileged_request_scope';

const STORAGE_KEY = '@CaptainPad:operator_passcode:waiver';

/** Opaque operator-passcode waiver header — scoped separately from privileged sessions. */
export const PASSCODE_WAIVER_HEADER = 'X-CaptainPad-Passcode-Waiver';

export type PasscodeWaiver = PasscodeWaiverShape;

let currentWaiver: PasscodeWaiver | null = null;
/** Bumped on every clear so in-flight cold-storage hydrations cannot resurrect a revoked waiver. */
let hydrationGeneration = 0;
const listeners = new Set<(waiver: PasscodeWaiver | null) => void>();

function emit(waiver: PasscodeWaiver | null) {
  currentWaiver = isValidPasscodeWaiver(waiver) ? waiver : null;
  listeners.forEach((listener) => listener(currentWaiver));
}

export function getPasscodeWaiver(): PasscodeWaiver | null {
  if (currentWaiver !== null && !isValidPasscodeWaiver(currentWaiver)) emit(null);
  return currentWaiver;
}

/** Opaque token for engine-side revocation (logout/lock). Never the raw passcode. */
export function getPasscodeWaiverToken(): string | null {
  return getPasscodeWaiver()?.token ?? null;
}

export async function setPasscodeWaiver(waiver: PasscodeWaiver): Promise<void> {
  if (!isValidPasscodeWaiver(waiver)) throw new Error('Passcode waiver is already expired');
  const generationAtStart = hydrationGeneration;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(waiver));
  } catch (error) {
    emit(null);
    throw error;
  }
  if (generationAtStart !== hydrationGeneration) return;
  emit(waiver);
}

export async function clearPasscodeWaiver(): Promise<void> {
  hydrationGeneration += 1;
  emit(null);
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function restorePasscodeWaiver(): Promise<PasscodeWaiver | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PasscodeWaiver;
    if (!isValidPasscodeWaiver(parsed)) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function subscribePasscodeWaiver(listener: (waiver: PasscodeWaiver | null) => void) {
  listeners.add(listener);
  listener(getPasscodeWaiver());
  return () => { listeners.delete(listener); };
}

/** Load the waiver from memory, or hydrate from AsyncStorage when memory is cold. */
async function loadPasscodeWaiverCandidate(): Promise<PasscodeWaiver | null> {
  const inMemory = getPasscodeWaiver();
  if (inMemory) return inMemory;
  const generationAtStart = hydrationGeneration;
  const restored = await restorePasscodeWaiver();
  if (generationAtStart !== hydrationGeneration) return null;
  if (restored) emit(restored);
  return restored;
}

async function validatePasscodeWaiver(waiver: PasscodeWaiver): Promise<PasscodeWaiver | null> {
  const base = await getApiBaseAsync();
  const engineOrigin = normalizedOrigin(base);
  if (!engineOrigin || !passcodeWaiverBelongsToEngineOrigin(waiver, engineOrigin)) return null;
  const requestStartedAt = Date.now();
  const response = await fetchWithTimeout(`${base}/captainpad/auth/passcode-waiver`, {
    headers: { [PASSCODE_WAIVER_HEADER]: waiver.token },
  }, 5000);
  if (!response.ok) return null;
  const body = await response.json();
  if (body.ok !== true || typeof body.remainingMs !== 'number') return null;
  return passcodeWaiverFromResponse(
    { ok: true, token: waiver.token, principal: body.principal, remainingMs: body.remainingMs },
    requestStartedAt,
    engineOrigin,
  );
}

/** Mint and persist a 30-minute waiver after the engine validates the passcode. */
export async function mintPasscodeWaiver(passcode: string): Promise<PasscodeWaiver> {
  const base = await getApiBaseAsync();
  const engineOrigin = normalizedOrigin(base);
  if (!engineOrigin) throw new Error('CaptainPad engine address is invalid');
  const requestStartedAt = Date.now();
  const response = await fetchWithTimeout(`${base}/captainpad/auth/passcode-waiver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  }, 5000);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Passcode waiver could not be minted');
  }
  if (!response.ok || !body || typeof body !== 'object' || (body as { ok?: unknown }).ok !== true) {
    throw new Error('Passcode waiver could not be minted');
  }
  const waiver = passcodeWaiverFromResponse(
    body as Parameters<typeof passcodeWaiverFromResponse>[0],
    requestStartedAt,
    engineOrigin,
  );
  await setPasscodeWaiver(waiver);
  return waiver;
}

/** Return a validated waiver for this engine origin, or null. */
export async function getValidPasscodeWaiver(): Promise<PasscodeWaiver | null> {
  const base = await getApiBaseAsync();
  const engineOrigin = normalizedOrigin(base);
  const candidate = await loadPasscodeWaiverCandidate();
  if (!passcodeWaiverBelongsToEngineOrigin(candidate, engineOrigin)) {
    if (candidate) await clearPasscodeWaiver();
    return null;
  }
  if (!candidate) return null;
  const generationAtValidate = hydrationGeneration;
  try {
    const validated = await validatePasscodeWaiver(candidate);
    if (generationAtValidate !== hydrationGeneration) return null;
    if (!validated) {
      if (generationAtValidate === hydrationGeneration) await clearPasscodeWaiver();
      return null;
    }
    if (validated.expiresAt !== candidate.expiresAt) await setPasscodeWaiver(validated);
    if (generationAtValidate !== hydrationGeneration) return null;
    return validated;
  } catch {
    if (generationAtValidate !== hydrationGeneration) return null;
    return candidate;
  }
}
