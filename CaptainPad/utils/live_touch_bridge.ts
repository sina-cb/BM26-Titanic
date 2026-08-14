import type { Palette, ThemeId } from '../constants/theme';
import type { ResolvedScheme, ThemeMode } from '../hooks/use-theme';

export const LIVE_TOUCH_BRIDGE_VERSION = 1 as const;
export const LIVE_TOUCH_PARENT_ORIGIN_PARAM = 'captainpad_origin';

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

export type TouchControlBridgeMessage =
  | TouchControlThemeReadyMessage
  | TouchControlThemeAppliedMessage
  | TouchControlSurfaceReleasedMessage;

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

  throw new Error(`Live Touch sent unknown bridge message ${String(value.type)}`);
}

export function resolveLiveTouchPanelUrl(
  apiBase: string,
  panelPath: string,
  simulationPort: string,
  pageOrigin?: string | null,
): string {
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

  return panelUrl.toString();
}
