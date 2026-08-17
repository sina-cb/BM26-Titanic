import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text, View } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { fetchLayerSettingsState } from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import {
  handoffCurtainTarget,
  LIVE_TOUCH_BRIDGE_VERSION,
} from '@/utils/live_touch_bridge';
import type { CaptainPadSurfaceBlurMessage } from '@/utils/live_touch_bridge';
import {
  destinationActivationDecision,
  layerSettingsRequireLiveHandoff,
  parseLayerSettingsState,
} from '@/utils/layer_settings';
import type {
  LayerDestination,
  LayerSettingsState,
  RecentLayerHandoff,
} from '@/utils/layer_settings';

const HANDOFF_TIMEOUT_MS = 30_000;

type HostSender = (message: CaptainPadSurfaceBlurMessage) => boolean;

type PendingHandoff = {
  requestId: string;
  target: LayerDestination;
  reason: CaptainPadSurfaceBlurMessage['reason'];
  resolve: (completed: boolean) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LiveTouchCoordinatorValue = {
  handoffTarget: LayerDestination | null;
  registerHost: (sender: HostSender) => () => void;
  setSurfaceFocused: (focused: boolean) => void;
  requestHandoff: (
    target: LayerDestination,
    reason?: CaptainPadSurfaceBlurMessage['reason'],
  ) => Promise<boolean>;
  waitForHandoff: (target: LayerDestination) => Promise<boolean | null>;
  completeHandoff: (
    requestId: string,
    target: LayerDestination,
  ) => CaptainPadSurfaceBlurMessage['reason'] | null;
};

const LiveTouchCoordinatorContext = createContext<LiveTouchCoordinatorValue | null>(null);

export function LiveTouchCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HostSender | null>(null);
  const pendingRef = useRef<PendingHandoff | null>(null);
  const requestSequenceRef = useRef(0);
  const pendingPromiseRef = useRef<Promise<boolean> | null>(null);
  const recentHandoffRef = useRef<RecentLayerHandoff | null>(null);
  const surfaceFocusedRef = useRef(false);
  const layerSettingsRef = useRef<LayerSettingsState | null>(null);
  const layerSettingsFetchRef = useRef<Promise<LayerSettingsState> | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<LayerDestination | null>(null);

  useEffect(() => () => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.reject(new Error('Live Touch coordinator unmounted during handoff'));
    pendingRef.current = null;
    pendingPromiseRef.current = null;
  }, []);

  const registerHost = useCallback((sender: HostSender) => {
    if (hostRef.current && hostRef.current !== sender) {
      throw new Error('A second Live Touch host tried to register');
    }
    hostRef.current = sender;
    return () => {
      if (hostRef.current === sender) hostRef.current = null;
    };
  }, []);

  const setSurfaceFocused = useCallback((focused: boolean) => {
    surfaceFocusedRef.current = focused;
  }, []);

  useEffect(() => engineEvents.subscribe((message) => {
    if (message.type !== 'layerSettings') return;
    try {
      layerSettingsRef.current = parseLayerSettingsState(message);
    } catch (error) {
      layerSettingsRef.current = null;
      console.error('Rejected invalid layerSettings broadcast:', error);
    }
  }), []);

  const readAuthoritativeLayerSettings = useCallback(async (): Promise<LayerSettingsState> => {
    const cached = layerSettingsRef.current;
    if (cached && engineEvents.getStatus().connected) return cached;
    if (layerSettingsFetchRef.current) return layerSettingsFetchRef.current;

    const request = fetchLayerSettingsState().then((result) => {
      if (!result.ok || !result.data) {
        throw new Error(result.error || 'Layer settings state is unavailable');
      }
      /* A WS replay/broadcast may have landed while the GET was in flight.
         Prefer that newer control-plane observation when the bus is live. */
      if (!layerSettingsRef.current || !engineEvents.getStatus().connected) {
        layerSettingsRef.current = result.data;
      }
      return layerSettingsRef.current;
    }).finally(() => {
      if (layerSettingsFetchRef.current === request) layerSettingsFetchRef.current = null;
    });
    layerSettingsFetchRef.current = request;
    return request;
  }, []);

  const requestHandoff = useCallback((
    target: LayerDestination,
    reason: CaptainPadSurfaceBlurMessage['reason'] = 'navigation',
  ): Promise<boolean> => {
    const sender = hostRef.current;
    /* Transport-neutral wording: the surface is an iframe on web and a WebView
       on the iPad, and the operator reads these words on both. */
    if (!sender) {
      return Promise.reject(new Error(
        'LIVE TOUCH HANDOFF UNAVAILABLE - the panel surface is not mounted',
      ));
    }

    if (pendingRef.current) {
      if (pendingRef.current.target === target && pendingPromiseRef.current) {
        return pendingPromiseRef.current;
      }
      clearTimeout(pendingRef.current.timer);
      pendingRef.current.resolve(false);
      pendingRef.current = null;
      pendingPromiseRef.current = null;
    }
    recentHandoffRef.current = null;

    requestSequenceRef.current += 1;
    const requestId = `handoff-${Date.now()}-${requestSequenceRef.current}`;
    const message: CaptainPadSurfaceBlurMessage = {
      type: 'captainpad-surface-blur',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      requestId,
      target,
      reason,
    };

    /* NAVIGATION ONLY (report _261). The curtain covers the blend the operator
       is watching; a background release happens on a screen nobody is looking
       at, and on the iPad its acknowledgement cannot arrive until the app is
       active again — which used to leave the whole pad curtained on return. */
    setHandoffTarget(handoffCurtainTarget(target, reason));
    const promise = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingRef.current?.requestId !== requestId) return;
        pendingRef.current = null;
        pendingPromiseRef.current = null;
        setHandoffTarget(null);
        reject(new Error(`LIVE TOUCH HANDOFF TO ${target.toUpperCase()} TIMED OUT`));
      }, HANDOFF_TIMEOUT_MS);
      pendingRef.current = { requestId, target, reason, resolve, reject, timer };

      if (!sender(message)) {
        clearTimeout(timer);
        pendingRef.current = null;
        pendingPromiseRef.current = null;
        setHandoffTarget(null);
        reject(new Error(
          'LIVE TOUCH HANDOFF UNAVAILABLE - the panel cannot receive messages yet',
        ));
      }
    });
    pendingPromiseRef.current = promise;
    return promise;
  }, []);

  const completeHandoff = useCallback((requestId: string, target: LayerDestination) => {
    const pending = pendingRef.current;
    if (!pending) return null;
    if (pending.requestId !== requestId || pending.target !== target) return null;

    clearTimeout(pending.timer);
    recentHandoffRef.current = { target, completedAtMs: Date.now() };
    pendingRef.current = null;
    pendingPromiseRef.current = null;
    setHandoffTarget(null);
    pending.resolve(true);
    return pending.reason;
  }, []);

  const waitForHandoff = useCallback(async (target: LayerDestination): Promise<boolean | null> => {
    const resolvePendingDecision = (): Promise<boolean> | false | null => {
      const pending = pendingRef.current;
      const decision = destinationActivationDecision(
        target,
        pending?.target ?? null,
        recentHandoffRef.current,
        Date.now(),
      );
      if (decision === 'activate') return null;
      if (decision === 'supersede') return requestHandoff(target);
      if (decision === 'skip') return false;
      const promise = pendingPromiseRef.current;
      if (!promise) throw new Error('Live Touch handoff promise is missing');
      return promise;
    };

    const pendingDecision = resolvePendingDecision();
    if (pendingDecision !== null) return pendingDecision;

    /* A deep link can focus Deck/Mixer before React Navigation runs Live's
       blur cleanup. The focus bit closes that ordering window without the old
       setTimeout(0) latency tax. */
    if (surfaceFocusedRef.current) return requestHandoff(target);

    const layerSettings = await readAuthoritativeLayerSettings();
    const racedDecision = resolvePendingDecision();
    if (racedDecision !== null) return racedDecision;
    if (layerSettingsRequireLiveHandoff(layerSettingsRef.current ?? layerSettings)) {
      return requestHandoff(target);
    }
    return null;
  }, [readAuthoritativeLayerSettings, requestHandoff]);

  const value = useMemo<LiveTouchCoordinatorValue>(() => ({
    handoffTarget,
    registerHost,
    setSurfaceFocused,
    requestHandoff,
    completeHandoff,
    waitForHandoff,
  }), [
    completeHandoff,
    handoffTarget,
    registerHost,
    requestHandoff,
    setSurfaceFocused,
    waitForHandoff,
  ]);

  return (
    <LiveTouchCoordinatorContext.Provider value={value}>
      {children}
    </LiveTouchCoordinatorContext.Provider>
  );
}

export function useLiveTouchCoordinator(): LiveTouchCoordinatorValue {
  const value = useContext(LiveTouchCoordinatorContext);
  if (!value) throw new Error('useLiveTouchCoordinator() called outside its provider');
  return value;
}

export function LiveTouchHandoffOverlay() {
  const palette = usePalette();
  const { handoffTarget } = useLiveTouchCoordinator();
  if (!handoffTarget) return null;

  return (
    <View
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 980,
        elevation: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.sidebarBackground,
      }}>
      <Text style={{ color: palette.text, fontSize: 18, fontWeight: '900' }}>
        HANDING BACK TO {handoffTarget.toUpperCase()}
      </Text>
    </View>
  );
}
