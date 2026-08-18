import type { Palette, ThemeId } from '../constants/theme';
import type { ResolvedScheme, ThemeMode } from '../hooks/use-theme';

export const LIVE_TOUCH_BRIDGE_VERSION = 1 as const;
export const LIVE_TOUCH_PARENT_ORIGIN_PARAM = 'captainpad_origin';
export const LIVE_TOUCH_ENGINE_ORIGIN_PARAM = 'captainpad_engine_origin';
export const LIVE_TOUCH_PROTOCOL_PARAM = 'captainpad_live_touch_protocol';
export const LIVE_TOUCH_PROTOCOL_VERSION = 2 as const;
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

export type CaptainPadPixelVerificationStartMessage = {
  type: 'captainpad-pixel-verification-start';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  documentId: string;
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
  | CaptainPadSurfaceBlurMessage
  | CaptainPadPixelVerificationStartMessage;

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

export type TouchControlPixelVerificationMessage = {
  type: 'touch-control-pixel-verification';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  documentId: string;
  requestId: string;
  status: 'checking' | 'ready' | 'failed';
  phase: string;
  staticVerified: boolean;
  engineVerified: boolean;
  readyStatus: 'idle' | 'pending' | 'fulfilled' | 'rejected' | 'unavailable';
  error: string | null;
};

export type TouchControlPixelVerifierReadyMessage = {
  type: 'touch-control-pixel-verifier-ready';
  version: typeof LIVE_TOUCH_BRIDGE_VERSION;
  documentId: string;
  phase: string;
  staticVerified: boolean;
  engineVerified: boolean;
  readyStatus: 'idle' | 'pending' | 'fulfilled' | 'rejected' | 'unavailable';
};

export type TouchControlBridgeMessage =
  | TouchControlThemeReadyMessage
  | TouchControlThemeAppliedMessage
  | TouchControlSurfaceReleasedMessage
  | TouchControlSpatialFullscreenMessage
  | TouchControlPixelVerificationMessage
  | TouchControlPixelVerifierReadyMessage;

const THEME_IDS = new Set<ThemeId>(['light', 'dark', 'midnight', 'sunset', 'gruvbox']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHttpUrl(value: string, label: string): URL {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials`);
  }
  return parsed;
}

function requireExactHttpOrigin(value: string, label: string): string {
  const parsed = parseHttpUrl(value, label);
  if (value !== parsed.origin) {
    throw new Error(`${label} must be an exact origin without a path, query, or fragment`);
  }
  return parsed.origin;
}

function requireSingleQueryParam(url: URL, name: string, label: string): string {
  const values = url.searchParams.getAll(name);
  if (values.length === 0 || values[0].length === 0) {
    throw new Error(`Live Touch panel URL is missing ${label}`);
  }
  if (values.length !== 1) {
    throw new Error(`Live Touch panel URL has multiple ${label} values`);
  }
  return values[0];
}

/**
 * Validate the endpoint identity carried by an already-built panel URL.
 *
 * The document is served from the simulation port, so its own origin cannot
 * prove which engine CaptainPad resolved. The explicit query contract keeps
 * native WKWebView, web iframe, REST, and WS endpoint selection tied to the
 * same source of truth instead of asking the document to reconstruct a host.
 */
export function validateLiveTouchPanelUrl(
  panelUrl: string,
  expectedEngineOrigin: string,
): string {
  const parsed = parseHttpUrl(panelUrl, 'Live Touch panel URL');
  const expected = requireExactHttpOrigin(
    expectedEngineOrigin,
    'Live Touch expected engine origin',
  );
  const declared = requireExactHttpOrigin(
    requireSingleQueryParam(
      parsed,
      LIVE_TOUCH_ENGINE_ORIGIN_PARAM,
      'engine origin',
    ),
    'Live Touch declared engine origin',
  );
  if (declared !== expected) {
    throw new Error(
      `Live Touch panel engine origin mismatch: expected ${expected}, received ${declared}`,
    );
  }

  const protocol = requireSingleQueryParam(
    parsed,
    LIVE_TOUCH_PROTOCOL_PARAM,
    'protocol version',
  );
  if (protocol !== String(LIVE_TOUCH_PROTOCOL_VERSION)) {
    const expectedProtocol = LIVE_TOUCH_PROTOCOL_VERSION;
    throw new Error(
      `Live Touch panel protocol mismatch: expected ${expectedProtocol}, received ${protocol}`,
    );
  }
  return parsed.toString();
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

/**
 * Give every native WebView document a distinct URL without changing where
 * the launcher routes it. `cacheEnabled={false}` is only advisory on some iOS
 * WebKit paths; a per-document query also prevents a reclaimed/remounted
 * WebView from reviving an older Live Touch HTML entry document.
 */
export function nativePanelDocumentUrl(url: string, documentToken: string): string {
  if (!url) throw new Error('Live Touch native document URL is missing');
  if (!documentToken) throw new Error('Live Touch native document token is missing');
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}captainpad_document=${encodeURIComponent(documentToken)}${hash}`;
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

  if (value.type === 'touch-control-pixel-verifier-ready') {
    const readyStatuses = new Set(['idle', 'pending', 'fulfilled', 'rejected', 'unavailable']);
    if (typeof value.documentId !== 'string' || value.documentId.length === 0) {
      throw new Error('Live Touch pixel verifier ready is missing documentId');
    }
    if (typeof value.phase !== 'string' || value.phase.length === 0 || value.phase.length > 80) {
      throw new Error('Live Touch pixel verifier ready has an invalid phase');
    }
    if (typeof value.staticVerified !== 'boolean' || typeof value.engineVerified !== 'boolean') {
      throw new Error('Live Touch pixel verifier ready has invalid gate state');
    }
    if (!readyStatuses.has(String(value.readyStatus))) {
      throw new Error('Live Touch pixel verifier ready has an invalid load state');
    }
    return {
      type: 'touch-control-pixel-verifier-ready',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      documentId: value.documentId,
      phase: value.phase,
      staticVerified: value.staticVerified,
      engineVerified: value.engineVerified,
      readyStatus: value.readyStatus as TouchControlPixelVerifierReadyMessage['readyStatus'],
    };
  }

  if (value.type === 'touch-control-pixel-verification') {
    const statuses = new Set(['checking', 'ready', 'failed']);
    const readyStatuses = new Set(['idle', 'pending', 'fulfilled', 'rejected', 'unavailable']);
    if (typeof value.documentId !== 'string' || value.documentId.length === 0) {
      throw new Error('Live Touch pixel verification is missing documentId');
    }
    if (typeof value.phase !== 'string' || value.phase.length === 0 || value.phase.length > 80) {
      throw new Error('Live Touch pixel verification has an invalid phase');
    }
    if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
      throw new Error('Live Touch pixel verification is missing requestId');
    }
    if (!statuses.has(String(value.status))) {
      throw new Error('Live Touch pixel verification has an invalid status');
    }
    if (typeof value.staticVerified !== 'boolean' || typeof value.engineVerified !== 'boolean') {
      throw new Error('Live Touch pixel verification has invalid gate state');
    }
    if (!readyStatuses.has(String(value.readyStatus))) {
      throw new Error('Live Touch pixel verification has an invalid load state');
    }
    if (value.error !== null && typeof value.error !== 'string') {
      throw new Error('Live Touch pixel verification has an invalid error');
    }
    if (typeof value.error === 'string' && value.error.length > 500) {
      throw new Error('Live Touch pixel verification error is too long');
    }
    return {
      type: 'touch-control-pixel-verification',
      version: LIVE_TOUCH_BRIDGE_VERSION,
      documentId: value.documentId,
      requestId: value.requestId,
      status: value.status as TouchControlPixelVerificationMessage['status'],
      phase: value.phase,
      staticVerified: value.staticVerified,
      engineVerified: value.engineVerified,
      readyStatus: value.readyStatus as TouchControlPixelVerificationMessage['readyStatus'],
      error: value.error as string | null,
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
  if (embed !== undefined && embed !== null && embed !== LIVE_TOUCH_NATIVE_EMBED) {
    throw new Error(`Live Touch has an unsupported embed mode ${String(embed)}`);
  }
  if (!/^\d+$/.test(simulationPort)) {
    throw new Error('Live Touch simulation port must be a decimal integer');
  }
  const parsedSimulationPort = Number(simulationPort);
  if (parsedSimulationPort < 1 || parsedSimulationPort > 65535) {
    throw new Error('Live Touch simulation port must be in [1, 65535]');
  }

  const apiUrl = parseHttpUrl(apiBase, 'Live Touch API base');
  const engineOrigin = apiUrl.origin;
  const panelUrl = new URL(apiUrl.toString());
  panelUrl.port = simulationPort;
  panelUrl.pathname = panelPath;
  panelUrl.search = '';
  panelUrl.hash = '';

  if (pageOrigin) {
    const parentOrigin = requireExactHttpOrigin(pageOrigin, 'Live Touch parent origin');
    const parentUrl = new URL(parentOrigin);
    panelUrl.hostname = parentUrl.hostname;
    panelUrl.searchParams.set(LIVE_TOUCH_PARENT_ORIGIN_PARAM, parentOrigin);
  }

  if (embed) panelUrl.searchParams.set(LIVE_TOUCH_EMBED_PARAM, embed);
  panelUrl.searchParams.set(LIVE_TOUCH_ENGINE_ORIGIN_PARAM, engineOrigin);
  panelUrl.searchParams.set(LIVE_TOUCH_PROTOCOL_PARAM, String(LIVE_TOUCH_PROTOCOL_VERSION));

  return validateLiveTouchPanelUrl(panelUrl.toString(), engineOrigin);
}
