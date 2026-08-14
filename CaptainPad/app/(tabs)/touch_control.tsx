// TOUCH CONTROL tab — hosts the operator touch panel.
//
// The panel itself is NOT React Native. It is a self-contained page served by
// the simulation's HTTP server at :6969/docs/ui/touch_control.html, wired
// straight to the engine's REST API. This tab embeds it so the operator reaches
// it from the same CaptainPad tab bar as everything else, instead of having to
// remember a URL.
//
// WHY AN IFRAME AND NOT react-native-webview:
// the dependency is installed, but it ships no web build — package.json has no
// `browser` field and only WebView.android/.ios variants. CaptainPad is used as
// a WEB app (the launcher opens http://localhost:6967/ and that is what runs on
// the iPad), so importing it here would break the bundle this tab actually runs
// in. On web an iframe is the native answer.
//
// On a NATIVE build this tab says so plainly and shows the URL rather than
// rendering an empty box — a surface that silently shows nothing is worse than
// one that tells you where to go (codex: no fallback behaviours).

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, ActivityIndicator, AppState } from 'react-native';

import { useLiveTouchCoordinator } from '@/components/live_touch_coordinator';
import { PlanLockBanner } from '@/components/PlanLockBanner';
import { useTheme } from '@/hooks/use-theme';
import { getApiBaseAsync } from '@/utils/api';
import {
  buildLiveTouchThemeMessage,
  canSendLiveTouchTheme,
  LIVE_TOUCH_BRIDGE_VERSION,
  parseTouchControlBridgeMessage,
  resolveLiveTouchPanelUrl,
  shouldSendLiveTouchThemeOnReady,
} from '@/utils/live_touch_bridge';
import {
  layerDestinationForNavigationAction,
  layerDestinationForNavigationState,
} from '@/utils/layer_settings';

/** The panel lives on the SIM server, one port below the engine. */
const SIM_PORT = '6969';
const PANEL_PATH = '/docs/ui/touch_control.html';

/**
 * Work out where the panel is served from.
 *
 * `pageHost` WINS when present, and that is the whole point: config.yaml ships
 * `api_base: http://127.0.0.1:6968`, which is correct for the show machine and
 * WRONG for every other device. An iPad that loads CaptainPad from
 * 192.168.50.4:6967 and then asks 127.0.0.1:6969 for the panel is asking
 * ITSELF, and gets nothing. The host the operator actually reached CaptainPad
 * on is the host that can serve the panel.
 *
 * The api_base port/scheme is still the fallback, for a native build where
 * there is no page host to read.
 */
export function resolvePanelUrl(apiBase: string, pageOrigin?: string | null): string {
  return resolveLiveTouchPanelUrl(apiBase, PANEL_PATH, SIM_PORT, pageOrigin);
}

export default function TouchControlScreen() {
  const { mode, scheme, palette } = useTheme();
  const {
    completeHandoff,
    registerHost,
    requestHandoff,
    setSurfaceFocused,
  } = useLiveTouchCoordinator();
  const navigation = useNavigation();
  const [apiBase, setApiBase] = useState<string | null>(null);
  const [pageOrigin, setPageOrigin] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameLoadedRef = useRef(false);
  const frameFocusedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const pendingThemeRequestRef = useRef<string | null>(null);
  const themeAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoffCompletedRef = useRef(false);
  const backgroundHandoffSentRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getApiBaseAsync().then(base => { if (alive) setApiBase(base); });
    return () => { alive = false; };
  }, []);

  /* Read the host in an EFFECT, not during render. expo-router server-renders
     this route, and on the server `window` does not exist — computing it inline
     silently produced the config.yaml host (127.0.0.1) and kept it after
     hydration. An effect only ever runs on the client, so this is the value the
     device actually loaded the app from. */
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      setPageOrigin(window.location.origin);
    }
  }, []);

  const url = useMemo(
    () => {
      if (!apiBase) return null;
      if (Platform.OS === 'web' && !pageOrigin) return null;
      return resolvePanelUrl(apiBase, pageOrigin);
    },
    [apiBase, pageOrigin],
  );
  const panelOrigin = useMemo(() => (url ? new URL(url).origin : null), [url]);

  const nextRequestId = useCallback((kind: string): string => {
    requestSequenceRef.current += 1;
    return `${kind}-${Date.now()}-${requestSequenceRef.current}`;
  }, []);

  const postToPanel = useCallback((message: object): boolean => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !panelOrigin) return false;
    targetWindow.postMessage(message, panelOrigin);
    return true;
  }, [panelOrigin]);

  useEffect(() => registerHost(postToPanel), [postToPanel, registerHost]);

  const sendTheme = useCallback(() => {
    if (!canSendLiveTouchTheme(frameLoadedRef.current)) return;
    const requestId = nextRequestId('theme');
    const message = buildLiveTouchThemeMessage(requestId, mode, scheme, palette);
    if (!postToPanel(message)) {
      setBridgeError('LIVE TOUCH THEME LINK UNAVAILABLE - iframe is not ready');
      return;
    }

    pendingThemeRequestRef.current = requestId;
    if (themeAckTimerRef.current) clearTimeout(themeAckTimerRef.current);
    themeAckTimerRef.current = setTimeout(() => {
      if (pendingThemeRequestRef.current === requestId) {
        setBridgeError('LIVE TOUCH THEME LINK UNAVAILABLE - no acknowledgement');
      }
    }, 1000);
  }, [mode, nextRequestId, palette, postToPanel, scheme]);

  const sendSurfaceFocus = useCallback(() => {
    postToPanel({
      type: 'captainpad-surface-focus',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      requestId: nextRequestId('focus'),
    });
  }, [nextRequestId, postToPanel]);

  useFocusEffect(
    useCallback(() => {
      handoffCompletedRef.current = false;
      frameFocusedRef.current = true;
      setSurfaceFocused(true);
      if (frameLoadedRef.current) sendSurfaceFocus();
      return () => {
        frameFocusedRef.current = false;
        /* The navigation state is already committed when blur cleanup runs.
           Deck/Mixer start their exact handback synchronously so the newly
           focused route can await it. Non-Layers destinations stay passive and
           deliberately leave Live armed. */
        if (handoffCompletedRef.current) {
          setSurfaceFocused(false);
          return;
        }
        const target = layerDestinationForNavigationState(navigation.getState());
        if (target) {
          void requestHandoff(target).catch((error) => {
            setBridgeError(error instanceof Error ? error.message : String(error));
          });
        }
        setSurfaceFocused(false);
      };
    }, [navigation, requestHandoff, sendSurfaceFocus, setSurfaceFocused]),
  );

  useEffect(() => {
    const handoffForBackground = () => {
      /* Tabs remain mounted. Live may still own output while the operator is
         reading Audio/Config/Dimmer Rack, so background safety cannot depend
         on the Live tab still being focused. */
      if (!frameLoadedRef.current || backgroundHandoffSentRef.current) return;
      backgroundHandoffSentRef.current = true;
      void requestHandoff('deck', 'background').catch((error) => {
        setBridgeError(error instanceof Error ? error.message : String(error));
      });
    };
    const foregrounded = () => { backgroundHandoffSentRef.current = false; };
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') foregrounded();
      else handoffForBackground();
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handoffForBackground();
      else foregrounded();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      appStateSubscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [requestHandoff]);

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (handoffCompletedRef.current) return;
    const target = layerDestinationForNavigationAction(event.data.action);
    if (!target) return;
    event.preventDefault();
    void requestHandoff(target)
      .then((completed) => {
        if (!completed) return;
        handoffCompletedRef.current = true;
        navigation.dispatch(event.data.action);
      })
      .catch((error) => {
        setBridgeError(error instanceof Error ? error.message : String(error));
      });
  }), [navigation, requestHandoff]);

  useEffect(() => {
    sendTheme();
  }, [sendTheme]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !panelOrigin) return;

    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.origin !== panelOrigin) {
        setBridgeError(`LIVE TOUCH BRIDGE REJECTED ORIGIN ${event.origin}`);
        return;
      }

      try {
        const message = parseTouchControlBridgeMessage(event.data);
        if (message.type === 'touch-control-theme-ready') {
          if (shouldSendLiveTouchThemeOnReady(
            frameLoadedRef.current,
            pendingThemeRequestRef.current,
          )) sendTheme();
          return;
        }

        if (message.type === 'touch-control-surface-released') {
          const reason = completeHandoff(message.requestId, message.target);
          if (reason === 'navigation') handoffCompletedRef.current = true;
          return;
        }

        if (pendingThemeRequestRef.current !== message.requestId) {
          throw new Error(`Live Touch acknowledged stale theme ${message.requestId}`);
        }
        pendingThemeRequestRef.current = null;
        if (themeAckTimerRef.current) {
          clearTimeout(themeAckTimerRef.current);
          themeAckTimerRef.current = null;
        }
        setBridgeError(null);
      } catch (error) {
        setBridgeError(error instanceof Error ? error.message : String(error));
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [completeHandoff, panelOrigin, sendTheme]);

  useEffect(() => () => {
    if (themeAckTimerRef.current) clearTimeout(themeAckTimerRef.current);
  }, []);

  if (!url) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: palette.background }}>
        <Text style={{ color: palette.text, fontSize: 16, fontWeight: '800', marginBottom: 8 }}>
          Touch Control runs in the browser
        </Text>
        <Text style={{ color: palette.icon, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
          This tab embeds the panel on web builds. On a native build, open it directly:
        </Text>
        <Text selectable style={{ color: palette.tint, fontSize: 13, marginTop: 10 }}>{url}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* The panel carries its own RELOAD button in its header now, so the
          floating overlay that used to sit over the groups bank is gone. */}
      {/* react-native-web passes an unknown string tag through as a real DOM
          element, which is how the iframe gets rendered from RN code. */}
      {React.createElement('iframe', {
        ref: (element: HTMLIFrameElement | null) => { iframeRef.current = element; },
        src: url,
        title: 'Live Touch',
        style: { border: 'none', width: '100%', height: '100%', display: 'block' },
        allow: 'fullscreen',
        onLoad: () => {
          frameLoadedRef.current = true;
          sendTheme();
          if (frameFocusedRef.current) sendSurfaceFocus();
        },
      })}
      <PlanLockBanner />
      {bridgeError ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: 12,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: palette.error,
            backgroundColor: palette.surfaceContainerLowest,
          }}>
          <Text style={{ color: palette.error, fontSize: 12, fontWeight: '800' }}>
            {bridgeError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
