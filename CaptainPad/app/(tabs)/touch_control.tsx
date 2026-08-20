// TOUCH CONTROL tab — hosts the operator touch panel.
//
// The panel itself is NOT React Native. It is a self-contained page served by
// the simulation's HTTP server at :6969/CaptainPad/live_touch/touch_control.html, wired
// straight to the engine's REST API. This tab embeds it so the operator reaches
// it from the same CaptainPad tab bar as everything else, instead of having to
// remember a URL.
//
// ── ONE SCREEN, TWO EMBEDS ──────────────────────────────────────────────────
//
// This tab used to say "Touch Control runs in the browser" on a native build,
// because react-native-webview ships no web build and an iframe is the only
// answer on web. Report _252 kept BOTH truths and stopped refusing: the
// browser-only and iPad-only halves live in the platform pair
// `components/live_touch_surface.web.tsx` / `.tsx` (the same idiom the 2D
// Simulator tab has used all along), so neither transport is ever bundled into
// the other platform, and the page itself is the same instrument on both.
//
// EVERYTHING platform-neutral stays here: coordinator registration, the theme
// build/ack/timeout, focus and blur handoffs, `beforeRemove`, the AppState
// background handoff, and the spatial fullscreen handshake. The surface owns
// only the transport.

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, ActivityIndicator, AppState } from 'react-native';

import { useLiveTouchCoordinator } from '@/components/live_touch_coordinator';
import { LiveTouchSurface, type LiveTouchSender } from '@/components/live_touch_surface';
import { PlanLockBanner } from '@/components/PlanLockBanner';
import { useTheme } from '@/hooks/use-theme';
import { getApiBaseAsync } from '@/utils/api';
import {
  buildLiveTouchThemeMessage,
  canSendLiveTouchTheme,
  LIVE_TOUCH_BRIDGE_VERSION,
  LIVE_TOUCH_NATIVE_EMBED,
  resolveLiveTouchPanelUrl,
  shouldSendLiveTouchThemeOnReady,
  type TouchControlBridgeMessage,
} from '@/utils/live_touch_bridge';
import {
  layerDestinationForNavigationAction,
  layerDestinationForNavigationState,
} from '@/utils/layer_settings';
import { setSpatialFullscreenActive } from '@/utils/spatial_fullscreen';

/** The panel lives on the SIM server, one port below the engine. */
const SIM_PORT = '6969';
const PANEL_PATH = '/CaptainPad/live_touch/touch_control.html';

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
 * On a NATIVE build there is no page host to read, so the hostname comes from
 * `apiBase` — which is itself metro-host-derived there (report _246) — and the
 * URL declares `captainpad_embed=native` instead of a parent origin. There is
 * no web origin to declare on native, and inventing one would be a lie the
 * page's own origin check would then bless.
 */
export function resolvePanelUrl(apiBase: string, pageOrigin?: string | null): string {
  return resolveLiveTouchPanelUrl(
    apiBase,
    PANEL_PATH,
    SIM_PORT,
    pageOrigin,
    pageOrigin ? null : LIVE_TOUCH_NATIVE_EMBED,
  );
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
  const [spatialFullscreen, setSpatialFullscreen] = useState(false);
  const senderRef = useRef<LiveTouchSender | null>(null);
  const frameLoadedRef = useRef(false);
  const frameFocusedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const pendingThemeRequestRef = useRef<string | null>(null);
  const themeAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifierReadyRef = useRef(false);
  const verifierDocumentRef = useRef<string | null>(null);
  const pixelVerificationAcknowledgedRef = useRef(false);
  const pendingPixelVerificationRequestRef = useRef<string | null>(null);
  const pixelVerificationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /* Stable by construction: the transport lives behind a ref the surface fills
     in, so the coordinator registration and the theme sender never churn when
     the URL resolves or the surface remounts. */
  const postToPanel = useCallback((message: object): boolean => {
    const send = senderRef.current;
    if (!send) return false;
    return send(message);
  }, []);

  const attachSender = useCallback((send: LiveTouchSender | null) => {
    senderRef.current = send;
  }, []);

  useEffect(() => registerHost(postToPanel), [postToPanel, registerHost]);

  const sendTheme = useCallback(() => {
    if (!canSendLiveTouchTheme(frameLoadedRef.current)) return;
    const requestId = nextRequestId('theme');
    const message = buildLiveTouchThemeMessage(requestId, mode, scheme, palette);
    if (!postToPanel(message)) {
      setBridgeError('LIVE TOUCH THEME LINK UNAVAILABLE - the panel is not ready');
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

  const sendPixelVerificationStart = useCallback(() => {
    const documentId = verifierDocumentRef.current;
    if (!frameLoadedRef.current || !verifierReadyRef.current || !documentId
        || pixelVerificationAcknowledgedRef.current) return;
    const requestId = pendingPixelVerificationRequestRef.current
      ?? nextRequestId('pixel-verify');
    pendingPixelVerificationRequestRef.current = requestId;
    const message = {
      type: 'captainpad-pixel-verification-start' as const,
      version: LIVE_TOUCH_BRIDGE_VERSION,
      documentId,
      requestId,
    };
    if (pixelVerificationRetryTimerRef.current) {
      clearTimeout(pixelVerificationRetryTimerRef.current);
    }
    const transmit = () => {
      if (pendingPixelVerificationRequestRef.current !== requestId
          || verifierDocumentRef.current !== documentId
          || pixelVerificationAcknowledgedRef.current) return;
      postToPanel(message);
      pixelVerificationRetryTimerRef.current = setTimeout(transmit, 250);
    };
    transmit();
  }, [nextRequestId, postToPanel]);

  /* The surface says when it can RECEIVE: the iframe's load event on web, the
     page's own `touch-control-theme-ready` on native (an injected theme can
     only land once the page has installed its inbound hook, and the page
     installs it before announcing readiness). */
  const handleSurfaceReady = useCallback(() => {
    frameLoadedRef.current = true;
    sendTheme();
    if (frameFocusedRef.current) sendSurfaceFocus();
    sendPixelVerificationStart();
  }, [sendPixelVerificationStart, sendSurfaceFocus, sendTheme]);

  const reportHandoffFailure = useCallback(() => {
    setBridgeError(
      'LIVE TOUCH HANDOFF DID NOT COMPLETE — remain on Live Touch and try again. '
      + 'The engine deadman remains authoritative.',
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      handoffCompletedRef.current = false;
      frameFocusedRef.current = true;
      setSurfaceFocused(true);
      if (frameLoadedRef.current) sendSurfaceFocus();
      return () => {
        setSpatialFullscreen(false);
        setSpatialFullscreenActive(false);
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
          void requestHandoff(target).catch(reportHandoffFailure);
        }
        setSurfaceFocused(false);
      };
    }, [
      navigation,
      reportHandoffFailure,
      requestHandoff,
      sendSurfaceFocus,
      setSurfaceFocused,
    ]),
  );

  useEffect(() => {
    const handoffForBackground = () => {
      /* Tabs remain mounted. Live may still own output while the operator is
         reading Audio/Config/Dimmer Rack, so background safety cannot depend
         on the Live tab still being focused.

         NATIVE TRUTH (report _261): docs/47 specified this release for a
         browser, "while the iframe and WebSocket are still alive". On the iPad
         neither is: iOS suspends the app's JS and the WebView's on resign, and
         may reclaim the WebView's content process outright. So this request can
         fail — loudly, into the banner below — and the engine's deadman owns the
         lease in that case. What it must NEVER do is curtain the pad on return,
         which is why `reason: 'background'` raises no handoff curtain. */
      if (!frameLoadedRef.current || backgroundHandoffSentRef.current) return;
      backgroundHandoffSentRef.current = true;
      void requestHandoff('deck', 'background').catch(reportHandoffFailure);
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
  }, [reportHandoffFailure, requestHandoff]);

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
      .catch(reportHandoffFailure);
  }), [navigation, reportHandoffFailure, requestHandoff]);

  useEffect(() => {
    sendTheme();
  }, [sendTheme]);

  /* NATIVE ONLY. Collapsing the rail and zeroing the scene margin is the iPad's
     equivalent of what the web surface does by elevating the iframe's DOM
     ancestors above it (docs/60 §4.5) — doing BOTH on web would reflow the tab
     tree underneath an already-covering fixed iframe for no visible gain. The
     clears below are unconditional and idempotent, so a web session can never
     leave the flag set for a later native one. */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    setSpatialFullscreenActive(spatialFullscreen);
  }, [spatialFullscreen]);

  useEffect(() => () => setSpatialFullscreenActive(false), []);

  const handleBridgeMessage = useCallback((message: TouchControlBridgeMessage) => {
    try {
      if (message.type === 'touch-control-theme-ready') {
        if (shouldSendLiveTouchThemeOnReady(
          frameLoadedRef.current,
          pendingThemeRequestRef.current,
        )) sendTheme();
        return;
      }

      if (message.type === 'touch-control-pixel-verifier-ready') {
        const isNewDocument = verifierDocumentRef.current !== message.documentId;
        if (!isNewDocument && pixelVerificationAcknowledgedRef.current) return;
        if (isNewDocument) {
          if (pixelVerificationRetryTimerRef.current) {
            clearTimeout(pixelVerificationRetryTimerRef.current);
            pixelVerificationRetryTimerRef.current = null;
          }
          verifierDocumentRef.current = message.documentId;
          pendingPixelVerificationRequestRef.current = null;
          pixelVerificationAcknowledgedRef.current = false;
        }
        verifierReadyRef.current = true;
        setBridgeError(current => current?.startsWith('LIVE TOUCH PIXEL VERIFICATION')
          ? null
          : current);
        sendPixelVerificationStart();
        return;
      }

      if (message.type === 'touch-control-pixel-verification') {
        const prefix = 'LIVE TOUCH PIXEL VERIFICATION';
        if (message.documentId !== verifierDocumentRef.current
            || message.requestId !== pendingPixelVerificationRequestRef.current) {
          throw new Error(
            `Live Touch pixel verification replied for stale document/request during ${message.status}`,
          );
        }
        pixelVerificationAcknowledgedRef.current = true;
        if (pixelVerificationRetryTimerRef.current) {
          clearTimeout(pixelVerificationRetryTimerRef.current);
          pixelVerificationRetryTimerRef.current = null;
        }
        if (message.status === 'ready') {
          setBridgeError(current => current?.startsWith(prefix) ? null : current);
          return;
        }
        if (message.status === 'checking') {
          setBridgeError(current => current?.startsWith(prefix) ? null : current);
          return;
        }
        setBridgeError(
          'LIVE TOUCH NOT READY — pixel-map verification did not complete. '
          + 'Reload Live Touch after the lighting engine is ready.',
        );
        return;
      }

      if (message.type === 'touch-control-surface-released') {
        const reason = completeHandoff(message.requestId, message.target);
        if (reason === 'navigation') handoffCompletedRef.current = true;
        return;
      }

      if (message.type === 'touch-control-spatial-fullscreen') {
        setSpatialFullscreen(message.active);
        /* A frame boundary makes the acknowledgement truthful: the host has
           applied its fullscreen layout before the child reports success. */
        requestAnimationFrame(() => {
          if (!postToPanel({
            type: 'captainpad-spatial-fullscreen-applied',
            version: LIVE_TOUCH_BRIDGE_VERSION,
            requestId: message.requestId,
            active: message.active,
          })) {
            setBridgeError('LIVE TOUCH FULLSCREEN LINK UNAVAILABLE - the panel is not ready');
          }
        });
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
      setBridgeError(current => current?.startsWith('LIVE TOUCH THEME') ? null : current);
    } catch {
      setBridgeError(
        'LIVE TOUCH CONNECTION CHECK FAILED — reload Live Touch. '
        + 'Controls remain unavailable until verification succeeds.',
      );
    }
  }, [completeHandoff, postToPanel, sendPixelVerificationStart, sendTheme]);

  useEffect(() => () => {
    if (themeAckTimerRef.current) clearTimeout(themeAckTimerRef.current);
    if (pixelVerificationRetryTimerRef.current) clearTimeout(pixelVerificationRetryTimerRef.current);
  }, []);

  if (!url || !panelOrigin) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* The panel carries its own RELOAD button in its header now, so the
          floating overlay that used to sit over the groups bank is gone. */}
      <LiveTouchSurface
        url={url}
        panelOrigin={panelOrigin}
        onSender={attachSender}
        onReady={handleSurfaceReady}
        onMessage={handleBridgeMessage}
        onBridgeError={setBridgeError}
        fullscreen={spatialFullscreen}
        backgroundColor={palette.background}
      />
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
