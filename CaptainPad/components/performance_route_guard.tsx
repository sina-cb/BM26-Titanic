import React from 'react';
import { Redirect } from 'expo-router';

import { usePerformanceMode, usePerformanceModeReady } from '@/hooks/usePerformanceMode';
import {
  canMountCaptainPadRoute,
  performanceNavigationLocked,
} from '@/utils/captainpad_tab_policy';

interface PerformanceRouteGuardProps {
  routeName: string;
  children: React.ReactNode;
}

export function PerformanceRouteGuard({ routeName, children }: PerformanceRouteGuardProps) {
  const { active: globalPerformanceActive, engineOffline } = usePerformanceMode();
  const performanceModeReady = usePerformanceModeReady();
  const canMount = canMountCaptainPadRoute(
    routeName,
    performanceNavigationLocked({
      ready: performanceModeReady,
      active: globalPerformanceActive,
      engineOffline,
    }),
  );

  // State has not been read from the engine yet: do not mount the unsafe
  // surface, but also do not redirect an Edit-mode deep link on a transient
  // cold-start. Once the server says Performance is active, Expo's focus-aware
  // Redirect moves the device to Deck without calling router.replace before
  // the root navigator has mounted.
  //
  // OFFLINE is exempt (report `_283`). That hold is for a cold start whose
  // answer is milliseconds away; with the control bus down no answer is coming,
  // so holding here renders a PERMANENT blank screen — and CONFIG is precisely
  // the surface the operator opens to point the pad at an engine that answers.
  // `canMount` above already applies the offline navigation rule, so a locked
  // offline face still redirects rather than mounting a frozen-out surface.
  if (!performanceModeReady && !engineOffline) return null;
  if (!canMount) return <Redirect href="/" />;
  return <>{children}</>;
}
