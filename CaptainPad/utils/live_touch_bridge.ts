import type { Palette, ThemeId } from '../constants/theme';
import type { ResolvedScheme, ThemeMode } from '../hooks/use-theme';

export const LIVE_TOUCH_BRIDGE_VERSION = 1 as const;
export const LIVE_TOUCH_PARENT_ORIGIN_PARAM = 'captainpad_origin';
/** Marks the panel URL as loaded inside CaptainPad's iPad build (report _252).
 *  A react-native-webview makes the page the TOP frame, so the page's own
 *  `window.parent !== window` iframe test cannot see the host — this param is
 *  the only synchronous signal, which is why the first-paint gate reads it too. */
export const LIVE_TOUCH_EMBED_PARAM = 'captainpad_embed';
export const LIVE_TOUCH_NATIVE_EMBED = 'native' as const;

export type LiveTouchEmbedMode = typeof LIVE_TOUCH_NATIVE_EMBED;

export const LIVE_TOUCH_THEME_KEYS = [
  'text',
  'background',
  'tint',
  'icon',
  'surface',
  'surfaceContainerLow',
  'surfaceContainerLowest',
  'surfaceContainerHigh',
  'primary',
  'onPrimary',
  'secondary',
  'tertiary',
  'error',
  'ghostBorder',
  'ambientShadow',
] as const satisfies readonly (keyof Palette)[];

export type LiveTouchThemePalette = Pick<Palette, (typeof LIVE_TOUCH_THEME_KEYS)[number]>;

export type CaptainPadThemeMessage = {
  type: 'captainpad-theme';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
  themeId: ThemeMode;
  resolvedThemeId: ThemeId;
  scheme: ResolvedScheme;
  palette: LiveTouchThemePalette;
};

export type CaptainPadSurfaceFocusMessage = {
  type: 'captainpad-surface-focus';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
};

export type CaptainPadSurfaceBlurMessage = {
  type: 'captainpad-surface-blur';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
  target: 'deck' | 'mixer';
  reason: 'navigation' | 'background';
};

export type CaptainPadSurfaceMessage =
  | CaptainPadSurfaceFocusMessage
  | CaptainPadSurfaceBlurMessage;

export type CaptainPadSpatialFullscreenAppliedMessage = {
  type: 'captainpad-spatial-fullscreen-applied';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
  active: boolean;
};

export type TouchControlThemeReadyMessage = {
  type: 'touch-control-theme-ready';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
};

export type TouchControlThemeAppliedMessage = {
  type: 'touch-control-theme-applied';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
};

export type TouchControlSurfaceReleasedMessage = {
  type: 'touch-control-surface-released';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
  target: 'deck' | 'mixer';
};

export type TouchControlSpatialFullscreenMessage = {
  type: 'touch-control-spatial-fullscreen';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  requestId: string;
  active: boolean;
};

export type TouchControlBridgeMessage =
  | TouchControlThemeReadyMessage
  | TouchControlThemeAppliedMessage
  | TouchControlSurfaceReleasedMessage
  | TouchControlSpatialFullscreenMessage;

const THEME_IDS = new Set<ThemeId>(['light', 'dark', 'midnight', 'sunset', 'gruvbox']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolvedThemeId(mode: ThemeMode, scheme: ResolvedScheme): ThemeId {
  if (mode === 'system') return scheme;
  if (!THEME_IDS.has(mode)) throw new Error(`Unsupported CaptainPad theme: ${String(mode)}`);
  return mode;
}

/** A completed iframe load proves the child message listener is installed.
 * Theme delivery must not depend on receiving the child's earlier ready event:
 * that event can beat React's parent listener on a cached local load. */
export function canSendLiveTouchTheme(frameLoaded: boolean): boolean {
  return frameLoaded;
}

/** Avoid a duplicate send when iframe load already created an acknowledged
 * request and the child's ready event arrives immediately afterwards. */
export function shouldSendLiveTouchThemeOnReady(
  frameLoaded: boolean,
  pendingRequestId: string | null,
): boolean {
  return frameLoaded && pendingRequestId === null;
}

/**
 * Does THIS release deserve the full-pad "HANDING BACK TO …" curtain?
 *
 * The curtain covers a blend the operator is WATCHING: docs/47 defines it as
 * part of the navigation handshake ("acknowledge the CaptainPad navigation
 * request and remove its curtain"), raised when Deck/Mixer is selected and
 * dropped when the panel acknowledges the release.
 *
 * A `background` release has no viewer by construction — the app is leaving the
 * screen — and on the iPad it is also the ONE release whose acknowledgement can
 * never come back in time: iOS suspends both the app's JS and the WebView's the
 * moment the app resigns active, so the panel cannot answer until the operator
 * returns (report _261). Raising a full-pad, opaque, touch-swallowing curtain
 * for it meant the operator came back from a home-swipe or an auto-lock to a
 * Live Touch tab that was covered by "HANDING BACK TO DECK" and took no touches.
 *
 * The release itself is unchanged — still requested, still acknowledged, still
 * loudly timed out. Only the curtain is navigation-only.
 */
export function handoffCurtainTarget(
  target: CaptainPadSurfaceBlurMessage['target'],
  reason: CaptainPadSurfaceBlurMessage['reason'],
): CaptainPadSurfaceBlurMessage['target'] | null {
  if (reason === 'navigation') return target;
  if (reason === 'background') return null;
  throw new Error(`Live Touch handoff has an unsupported reason ${String(reason)}`);
}

/**
 * Can the NATIVE surface actually hand a message to the panel right now?
 *
 * The iframe transport gets a delivery answer for free — no `contentWindow`,
 * no post. `injectJavaScript` gives none: it is fire-and-forget, and a call to
 * `window.__captainpadDeliver` inside a page that has not installed it yet (or
 * has just been reloaded — by the panel's own RELOAD button, by a `retry`, or
 * by iOS reclaiming a backgrounded WebView's content process) throws inside the
 * WebView where nobody is listening. Reporting `true` for that made the
 * coordinator believe an undeliverable release was on the wire and hang its
 * pending request — and its curtain — for the full 30 s timeout.
 *
 * `panelReady` is the panel's own `touch-control-theme-ready`, which it posts
 * only AFTER installing the inbound hook, and which the surface clears again on
 * every `onLoadStart`. So this is the truthful answer to "does the hook exist".
 */
export function canDeliverToNativePanel(
  webViewMounted: boolean,
  panelReady: boolean,
): boolean {
  return webViewMounted && panelReady;
}

export function buildLiveTouchThemeMessage(
  requestId: string,
  mode: ThemeMode,
  scheme: ResolvedScheme,
  palette: Palette,
): CaptainPadThemeMessage {
  if (!requestId) throw new Error('Live Touch theme messages require a requestId');

  const selected = {} as LiveTouchThemePalette;
  for (const key of LIVE_TOUCH_THEME_KEYS) {
    const value = palette[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`CaptainPad theme token ${key} is missing`);
    }
    selected[key] = value;
  }

  return {
    type: 'captainpad-theme',
    version: LIVE_TOUCH_BRIDGE_VERSION,
    requestId,
    themeId: mode,
    resolvedThemeId: resolvedThemeId(mode, scheme),
    scheme,
    palette: selected,
  };
}

export function parseTouchControlBridgeMessage(value: unknown): TouchControlBridgeMessage {
  if (!isObject(value)) throw new Error('Live Touch sent a non-object bridge message');
  if (value.version !== LIVE_TOUCH_BRIDGE_VERSION) {
    throw new Error(`Live Touch sent unsupported bridge version ${String(value.version)}`);
  }

  if (value.type === 'touch-control-theme-ready') {
    return {
      type: 'touch-control-theme-ready',
      version: LIVE_TOUCH_BRIDGE_VERSION,
    };
  }

  if (value.type === 'touch-control-theme-applied') {
    if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
      throw new Error('Live Touch theme acknowledgement is missing requestId');
    }
    return {
      type: 'touch-control-theme-applied',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      requestId: value.requestId,
    };
  }

  if (value.type === 'touch-control-surface-released') {
    if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
      throw new Error('Live Touch handoff acknowledgement is missing requestId');
    }
    if (value.target !== 'deck' && value.target !== 'mixer') {
      throw new Error('Live Touch handoff acknowledgement has an invalid target');
    }
    return {
      type: 'touch-control-surface-released',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      requestId: value.requestId,
      target: value.target,
    };
  }

  if (value.type === 'touch-control-spatial-fullscreen') {
    if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
      throw new Error('Live Touch fullscreen request is missing requestId');
    }
    if (typeof value.active !== 'boolean') {
      throw new Error('Live Touch fullscreen request has an invalid active state');
    }
    return {
      type: 'touch-control-spatial-fullscreen',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      requestId: value.requestId,
      active: value.active,
    };
  }

  throw new Error(`Live Touch sent unknown bridge message ${String(value.type)}`);
}

/**
 * Where the Live Touch panel is served from, and which host is embedding it.
 *
 * `pageOrigin` (web) and `embed` (native) are mutually exclusive by
 * construction, and that is the point: on native there is NO web origin to
 * declare, and inventing one would be a lie the page's own origin check would
 * then bless. The hostname comes from `apiBase` there instead, which on native
 * is already metro-host-derived (report _246).
 */
export function resolveLiveTouchPanelUrl(
  apiBase: string,
  panelPath: string,
  simulationPort: string,
  pageOrigin?: string | null,
  embed?: LiveTouchEmbedMode | null,
): string {
  if (pageOrigin && embed) {
    throw new Error('Live Touch cannot declare both a parent origin and a native embed');
  }

  const panelUrl = new URL(apiBase);
  panelUrl.port = simulationPort;
  panelUrl.pathname = panelPath;
  panelUrl.search = '';
  panelUrl.hash = '';

  if (pageOrigin) {
    const parentUrl = new URL(pageOrigin);
    panelUrl.hostname = parentUrl.hostname;
    panelUrl.searchParams.set(LIVE_TOUCH_PARENT_ORIGIN_PARAM, parentUrl.origin);
  }

  if (embed) panelUrl.searchParams.set(LIVE_TOUCH_EMBED_PARAM, embed);

  return panelUrl.toString();
}
