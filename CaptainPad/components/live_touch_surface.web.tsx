/**
 * LiveTouchSurface (WEB) — the iframe half of the Live Touch embed.
 *
 * Everything here was moved VERBATIM out of `app/(tabs)/touch_control.tsx`
 * (report _252) when the iPad grew a WebView peer. The screen kept every piece
 * of platform-neutral logic — coordinator registration, theme build/ack,
 * focus/blur handoffs, `beforeRemove`, AppState — and handed this file the
 * three things that are only true in a browser: the `<iframe>`, the `window`
 * message channel with its origin checks, and the ancestor z-elevation that
 * makes spatial fullscreen cover the navigation rail.
 *
 * The DOM this produces is unchanged: a function component returning the same
 * iframe element adds no wrapper node, so the web build renders exactly the
 * tree it rendered before.
 */
import React, { useCallback, useEffect, useRef } from 'react';

import {
  parseTouchControlBridgeMessage,
  type TouchControlBridgeMessage,
} from '@/utils/live_touch_bridge';

const SPATIAL_FULLSCREEN_HOST_Z_INDEX = '2147482999';

export type LiveTouchSender = (message: object) => boolean;

export interface LiveTouchSurfaceProps {
  url: string;
  /** Origin of `url`. The postMessage target AND the accepted sender origin. */
  panelOrigin: string;
  /** Hands the screen an imperative sender, or null when the surface goes. */
  onSender: (send: LiveTouchSender | null) => void;
  /** The surface can receive host messages. Web: the iframe load event. */
  onReady: () => void;
  /** A parsed, versioned bridge message from the panel. */
  onMessage: (message: TouchControlBridgeMessage) => void;
  /** Anything the bridge refused, verbatim, for the screen's banner. */
  onBridgeError: (message: string) => void;
  /** Spatial performance surface: fill the browser viewport over the rail. */
  fullscreen: boolean;
  /** CaptainPad's own themed ground behind the panel (the `_223` first-paint
   *  gate: the page paints transparent until the theme lands). */
  backgroundColor: string;
}

export function LiveTouchSurface({
  url,
  panelOrigin,
  onSender,
  onReady,
  onMessage,
  onBridgeError,
  fullscreen,
  backgroundColor,
}: LiveTouchSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const ancestorStylesRef = useRef<{
    element: HTMLElement;
    position: string;
    zIndex: string;
  }[]>([]);
  const callbacksRef = useRef({ onSender, onReady, onMessage, onBridgeError });
  callbacksRef.current = { onSender, onReady, onMessage, onBridgeError };

  const send = useCallback((message: object): boolean => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !panelOrigin) return false;
    targetWindow.postMessage(message, panelOrigin);
    return true;
  }, [panelOrigin]);

  useEffect(() => {
    callbacksRef.current.onSender(send);
    return () => { callbacksRef.current.onSender(null); };
  }, [send]);

  /* A fixed descendant cannot out-rank a sibling that sits in a higher CSS
     stacking context. CaptainPad's navigation rail is one such sibling, so a
     fixed iframe left inside the route tree still showed the rail over the
     supposedly fullscreen Spatial surface. Elevate every host ancestor while
     open, then restore its exact inline styles. Do NOT reparent the iframe:
     browsers reload its browsing context when it moves in the DOM, which
     would discard the live performance surface and its bridge state. */
  const setHostElevated = useCallback((active: boolean) => {
    if (typeof document === 'undefined') return;
    if (active) {
      const iframe = iframeRef.current;
      if (!iframe || ancestorStylesRef.current.length) return;
      let ancestor = iframe.parentElement;
      while (ancestor && ancestor !== document.body) {
        ancestorStylesRef.current.push({
          element: ancestor,
          position: ancestor.style.position,
          zIndex: ancestor.style.zIndex,
        });
        if (getComputedStyle(ancestor).position === 'static') {
          ancestor.style.position = 'relative';
        }
        ancestor.style.zIndex = SPATIAL_FULLSCREEN_HOST_Z_INDEX;
        ancestor = ancestor.parentElement;
      }
      return;
    }

    const savedStyles = ancestorStylesRef.current;
    ancestorStylesRef.current = [];
    savedStyles.forEach(({ element, position, zIndex }) => {
      element.style.position = position;
      element.style.zIndex = zIndex;
    });
  }, []);

  useEffect(() => {
    setHostElevated(fullscreen);
  }, [fullscreen, setHostElevated]);

  useEffect(() => () => setHostElevated(false), [setHostElevated]);

  /* CSS-only, so iPad Safari never depends on a Fullscreen API permission
     prompt, and cleanup restores the page even on route teardown. */
  useEffect(() => {
    if (typeof document === 'undefined' || !fullscreen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!panelOrigin) return;

    function handle(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const { onMessage: deliver, onBridgeError: refuse } = callbacksRef.current;
      if (event.origin !== panelOrigin) {
        refuse(`LIVE TOUCH BRIDGE REJECTED ORIGIN ${event.origin}`);
        return;
      }
      try {
        deliver(parseTouchControlBridgeMessage(event.data));
      } catch (error) {
        refuse(error instanceof Error ? error.message : String(error));
      }
    }

    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [panelOrigin]);

  /* react-native-web passes an unknown string tag through as a real DOM
     element, which is how the iframe gets rendered from RN code. */
  return React.createElement('iframe', {
    ref: (element: HTMLIFrameElement | null) => { iframeRef.current = element; },
    src: url,
    title: 'Live Touch',
    style: fullscreen ? {
      border: 'none',
      display: 'block',
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: '100vw',
      height: '100dvh',
      zIndex: 2147483000,
      backgroundColor,
    } : {
      border: 'none', width: '100%', height: '100%', display: 'block',
    },
    allow: 'fullscreen',
    onLoad: () => { callbacksRef.current.onReady(); },
  });
}
