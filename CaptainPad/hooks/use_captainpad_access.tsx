import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { fetchWithTimeout, getApiBaseAsync } from '@/utils/api';
import {
  clearCaptainPadAuthOnBootFailure,
  lockCaptainPadAuth,
  restoreCaptainPadAuthOnBoot,
} from '@/utils/captainpad_auth_boot';
import { engineEvents } from '@/utils/engineEvents';
import {
  captainPadAuthFailureMessage,
  privilegedSessionFromResponse,
  sessionBelongsToEngineOrigin,
  shouldRevalidatePrivilegedSession,
} from '@/utils/captainpad_access_logic';
import { normalizedOrigin } from '@/utils/privileged_request_scope';
import {
  clearPrivilegedSession,
  getPrivilegedSession,
  setPrivilegedSession,
  subscribePrivilegedSession,
  type PrivilegedSession,
} from '@/utils/privileged_session';

interface CaptainPadAccessContextValue {
  session: PrivilegedSession | null;
  loading: boolean;
  authenticate: (passphrase: string, remember30: boolean) => Promise<void>;
  lock: () => Promise<void>;
}

const CaptainPadAccessContext = createContext<CaptainPadAccessContextValue | null>(null);

async function validateSession(session: PrivilegedSession): Promise<PrivilegedSession | null> {
  const base = await getApiBaseAsync();
  const engineOrigin = normalizedOrigin(base);
  if (!engineOrigin || !sessionBelongsToEngineOrigin(session, engineOrigin)) return null;
  const requestStartedAt = Date.now();
  const response = await fetchWithTimeout(
    `${base}/captainpad/auth/session`,
    {},
    5000,
    session,
  );
  if (!response.ok) return null;
  const body = await response.json();
  return privilegedSessionFromResponse(body, session.token, requestStartedAt, engineOrigin);
}

export function CaptainPadAccessProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<PrivilegedSession | null>(getPrivilegedSession());
  const [loading, setLoading] = useState(true);

  useEffect(() => subscribePrivilegedSession(setSession), []);
  useEffect(() => {
    let cancelled = false;
    restoreCaptainPadAuthOnBoot()
      .catch(() => clearCaptainPadAuthOnBootFailure())
      .finally(() => { if (!cancelled) setLoading(false); })
      .catch((error) => {
        console.warn('CaptainPad session restore cleanup failed:', error);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const remainingMs = session.expiresAt - Date.now();
    if (remainingMs <= 0) {
      void clearPrivilegedSession().catch((error) => {
        console.warn('CaptainPad expired-session cleanup failed:', error);
      });
      return;
    }
    const timeout = setTimeout(() => {
      void clearPrivilegedSession().catch((error) => {
        console.warn('CaptainPad expired-session cleanup failed:', error);
      });
    }, remainingMs);
    return () => clearTimeout(timeout);
  }, [session]);

  useEffect(() => {
    const unsubscribe = engineEvents.subscribeStatus((status) => {
      if (!status.connected) {
        if (getPrivilegedSession()) setLoading(true);
        return;
      }
      const candidate = getPrivilegedSession();
      setLoading(shouldRevalidatePrivilegedSession(candidate));
      if (!candidate) return;
      void (async () => {
        let validated: PrivilegedSession | null = null;
        try {
          validated = await validateSession(candidate);
        } catch {
          validated = null;
        } finally {
          try {
            const latest = getPrivilegedSession();
            if (latest?.token === candidate.token) {
              if (validated) await setPrivilegedSession(validated);
              else await clearPrivilegedSession();
            }
          } finally {
            setLoading(false);
          }
        }
      })().catch((error) => {
        console.warn('CaptainPad session revalidation cleanup failed:', error);
      });
    });
    return () => { unsubscribe(); };
  }, []);

  const authenticate = useCallback(async (passphrase: string, remember30: boolean) => {
    const base = await getApiBaseAsync();
    const engineOrigin = normalizedOrigin(base);
    if (!engineOrigin) throw new Error('CaptainPad engine address is invalid');
    const requestStartedAt = Date.now();
    const response = await fetchWithTimeout(`${base}/captainpad/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, remember30 }),
    }, 5000);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(captainPadAuthFailureMessage(null));
    }
    if (!response.ok || !body || typeof body !== 'object'
        || (body as { authenticated?: unknown }).authenticated !== true
        || typeof (body as { token?: unknown }).token !== 'string') {
      throw new Error(captainPadAuthFailureMessage(
        body && typeof body === 'object' ? (body as { code?: unknown }).code : null,
      ));
    }
    await setPrivilegedSession(privilegedSessionFromResponse(
      body as Parameters<typeof privilegedSessionFromResponse>[0],
      null,
      requestStartedAt,
      engineOrigin,
    ));
  }, []);

  const lock = useCallback(async () => {
    await lockCaptainPadAuth();
  }, []);

  const value = useMemo(() => ({ session, loading, authenticate, lock }), [session, loading, authenticate, lock]);
  return <CaptainPadAccessContext.Provider value={value}>{children}</CaptainPadAccessContext.Provider>;
}

export function useCaptainPadAccess(): CaptainPadAccessContextValue {
  const value = useContext(CaptainPadAccessContext);
  if (!value) throw new Error('useCaptainPadAccess must be used inside CaptainPadAccessProvider');
  return value;
}
