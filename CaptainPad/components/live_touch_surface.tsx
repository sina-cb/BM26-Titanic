/**
 * LiveTouchSurface (NATIVE) — the iPad's Live Touch embed.
 *
 * The panel is the same sim-served page the web build embeds in an iframe: a
 * ~5.8k-line instrument with its own wire, lifecycle, deadman lease, takeover
 * passcode and spatial surface. Re-implementing that in React Native would fork
 * the exact code where correctness is safety-critical, so the iPad loads the
 * SAME page in a WebView and speaks the SAME versioned bridge (report _252,
 * docs/60 §4).
 *
 * ── THE TRANSPORT ───────────────────────────────────────────────────────────
 *
 * Out: the page calls `window.ReactNativeWebView.postMessage(JSON)`, which
 * lands in `onMessage` below and goes straight into the shared
 * `parseTouchControlBridgeMessage` — byte-for-byte the same message objects the
 * iframe path parses.
 *
 * In: `injectJavaScript` calls `window.__captainpadDeliver(...)`, which the
 * page installs BEFORE it posts `touch-control-theme-ready`. This host marks
 * itself ready on that event — NOT on `onLoadEnd` — so the host can never
 * inject a call to a function that does not exist yet. `webViewRef.postMessage`
 * is deliberately unused: its delivery target ('message' on `window` vs on
 * `document`) has differed across react-native-webview versions, while an
 * injected call is deterministic.
 *
 * An injected call is also UNACKNOWLEDGED, so this surface tracks whether the
 * hook exists RIGHT NOW (`panelReadyRef`: raised by `touch-control-theme-ready`,
 * cleared by every `onLoadStart` — the panel's RELOAD button, a RETRY remount,
 * and the reload iOS performs after reclaiming a backgrounded WebView) and
 * refuses to claim delivery when it does not. The iframe peer gets that answer
 * free from `contentWindow`; report _261 is what it cost to invent it here.
 *
 * ── THE PAGE OWNS EVERY TOUCH ───────────────────────────────────────────────
 *
 * The wheel, the brush and the spatial pad assume they own the gesture. The
 * prop set below stops the WebView, iOS and the tab navigator from fighting
 * them: no scrolling, no bounce, no back-swipe, no link preview, no text
 * selection or magnifier, no new windows.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import { EMBEDDED_SURFACE_TEARDOWN_SCRIPT } from '@/components/embedded_surface_lifecycle';
import type { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  canDeliverToNativePanel,
  parseTouchControlBridgeMessage,
  type TouchControlBridgeMessage,
} from '@/utils/live_touch_bridge';

const LOAD_TIMEOUT_MS = 15_000;

export type LiveTouchSender = (message: object) => boolean;

export interface LiveTouchSurfaceProps {
  url: string;
  /** Origin of `url`. Unused on native — the channel is host-authenticated by
   *  construction (only this app can inject into this WebView) — but kept in
   *  the shared contract so the screen stays platform-neutral. */
  panelOrigin: string;
  /** Hands the screen an imperative sender, or null when the surface goes. */
  onSender: (send: LiveTouchSender | null) => void;
  /** The surface can receive host messages. Native: `touch-control-theme-ready`. */
  onReady: () => void;
  /** A parsed, versioned bridge message from the panel. */
  onMessage: (message: TouchControlBridgeMessage) => void;
  /** Anything the bridge refused, verbatim, for the screen's banner. */
  onBridgeError: (message: string) => void;
  /** Spatial performance surface. Style-only here: the rail is collapsed by
   *  the tab layout, and the WebView NEVER changes position in the React tree
   *  (RN remounts native views on reparent — the same reload hazard the iframe
   *  has). */
  fullscreen: boolean;
  /** CaptainPad's own themed ground behind the panel. The WebView is painted
   *  transparent over it, which is the native half of the `_223` first-paint
   *  gate: the page's `theme-pending` CSS is transparent too, so the operator
   *  never sees a flash of the standalone blue. */
  backgroundColor: string;
}

export function LiveTouchSurface({
  url,
  onSender,
  onReady,
  onMessage,
  onBridgeError,
  backgroundColor,
}: LiveTouchSurfaceProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const webViewRef = useRef<WebView>(null);
  /* Whether `window.__captainpadDeliver` exists in the page RIGHT NOW. Set by
     the panel's own `touch-control-theme-ready` (posted after it installs the
     hook) and cleared by every main-frame load start — the panel's RELOAD
     button, a RETRY remount, and the reload iOS performs when it reclaims a
     backgrounded WebView's content process all pass through there. */
  const panelReadyRef = useRef(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const callbacksRef = useRef({ onSender, onReady, onMessage, onBridgeError });
  callbacksRef.current = { onSender, onReady, onMessage, onBridgeError };

  /* `injectJavaScript` is fire-and-forget: it reports nothing, and a call into
     a page that has not installed the inbound hook throws inside the WebView
     where nobody hears it. Returning `true` there was the native transport
     LYING — the coordinator then hung a release request, and its full-pad
     curtain, on an acknowledgement that could never come (report _261). The
     iframe peer answers the same question with `contentWindow`; this is the
     WebView's honest equivalent. */
  const send = useCallback((message: object): boolean => {
    const webView = webViewRef.current;
    if (!canDeliverToNativePanel(webView !== null, panelReadyRef.current)) return false;
    if (!webView) return false;
    webView.injectJavaScript(
      `window.__captainpadDeliver(${JSON.stringify(message)}); true;`,
    );
    return true;
  }, []);

  useEffect(() => {
    callbacksRef.current.onSender(send);
    return () => { callbacksRef.current.onSender(null); };
  }, [send]);

  useEffect(() => () => {
    webViewRef.current?.stopLoading();
    webViewRef.current?.injectJavaScript(EMBEDDED_SURFACE_TEARDOWN_SCRIPT);
  }, []);

  /* First-load watchdog. A WebView that never calls back at all is the one
     failure that would otherwise be a silent blank rectangle. */
  useEffect(() => {
    if (!loading || loadError) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setLoadError('Live Touch did not finish loading within 15 seconds');
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading, loadError, reloadToken]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const { onMessage: deliver, onBridgeError: refuse, onReady: ready } = callbacksRef.current;
    try {
      const message = parseTouchControlBridgeMessage(JSON.parse(event.nativeEvent.data));
      // Ready BEFORE the message is forwarded: the screen's theme send is what
      // this event exists to unblock, and the screen's own duplicate guard
      // (`shouldSendLiveTouchThemeOnReady`) then sees the request already in
      // flight — exactly the ordering the iframe's load event produces.
      if (message.type === 'touch-control-theme-ready') {
        panelReadyRef.current = true;
        ready();
      }
      deliver(message);
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const fail = useCallback((message: string) => {
    setLoading(false);
    setLoadError(message);
  }, []);

  const retry = useCallback(() => {
    panelReadyRef.current = false;
    setLoadError(null);
    setLoading(true);
    setReloadToken((current) => current + 1);
  }, []);

  return (
    <View style={[styles.host, { backgroundColor }]}>
      <WebView
        ref={webViewRef}
        key={`${url}:${reloadToken}`}
        source={{ uri: url }}
        style={styles.surface}
        originWhitelist={['http://*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        /* Every main-frame load discards the page's JS world, hook included.
           The panel re-announces readiness when the new document has installed
           it; until then this surface must refuse to pretend it can deliver. */
        onLoadStart={() => { panelReadyRef.current = false; }}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          fail(`Live Touch could not load — ${event.nativeEvent.description}`);
        }}
        onHttpError={(event) => {
          fail(
            `Live Touch returned HTTP ${event.nativeEvent.statusCode} — `
            + event.nativeEvent.description,
          );
        }}
        // The page owns every touch — see the header.
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        setSupportMultipleWindows={false}
        textInteractionEnabled={false}
        startInLoadingState={false}
      />

      {loading && !loadError ? (
        <View pointerEvents="none" style={styles.statusOverlay}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={styles.statusText}>CONNECTING TO LIVE TOUCH</Text>
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>LIVE TOUCH UNAVAILABLE</Text>
          <Text selectable style={styles.errorBody}>{loadError}</Text>
          <Text selectable style={styles.errorUrl}>{url}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Retry Live Touch"
            activeOpacity={0.72}
            onPress={retry}
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    host: {
      flex: 1,
    },
    surface: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    statusOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    statusText: {
      color: C.secondary,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
    },
    errorPanel: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: C.errorContainer,
    },
    errorTitle: {
      color: C.error,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      letterSpacing: 0.8,
    },
    errorBody: {
      maxWidth: 680,
      marginTop: 8,
      color: C.text,
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    errorUrl: {
      maxWidth: 680,
      marginTop: 8,
      color: C.secondary,
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      textAlign: 'center',
    },
    retryButton: {
      minWidth: 96,
      minHeight: 42,
      marginTop: 16,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: C.primary,
    },
    retryLabel: {
      color: C.onPrimary,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.9,
    },
  });
}
