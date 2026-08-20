import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  isValidPrivilegedSession,
  type PrivilegedSessionShape,
} from './captainpad_access_logic';

const STORAGE_KEY = '@CaptainPad:privileged_access:session';

export type PrivilegedSession = PrivilegedSessionShape;

let currentSession: PrivilegedSession | null = null;
const listeners = new Set<(session: PrivilegedSession | null) => void>();

function emit(session: PrivilegedSession | null) {
  currentSession = isValidPrivilegedSession(session) ? session : null;
  listeners.forEach((listener) => listener(currentSession));
}

export function getPrivilegedSession(): PrivilegedSession | null {
  // Null is already the canonical locked state. Broadcasting null on every
  // read makes useState(getPrivilegedSession()) notify its own subscriber
  // during render and causes an infinite React render loop.
  if (currentSession !== null && !isValidPrivilegedSession(currentSession)) emit(null);
  return currentSession;
}

export function getPrivilegedSessionToken(): string | null {
  return getPrivilegedSession()?.token || null;
}

export async function setPrivilegedSession(session: PrivilegedSession): Promise<void> {
  if (!isValidPrivilegedSession(session)) throw new Error('Privileged session is already expired');
  try {
    if (session.remembered) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    emit(null);
    throw error;
  }
  emit(session);
}

export async function clearPrivilegedSession(): Promise<void> {
  emit(null);
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function restorePrivilegedSession(): Promise<PrivilegedSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PrivilegedSession;
    if (!isValidPrivilegedSession(parsed) || parsed.remembered !== true) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function subscribePrivilegedSession(listener: (session: PrivilegedSession | null) => void) {
  listeners.add(listener);
  listener(getPrivilegedSession());
  return () => { listeners.delete(listener); };
}
