export const LAYER_SETTING_IDS = ['deck', 'mixer', 'live_touch'] as const;

export type LayerSettingId = (typeof LAYER_SETTING_IDS)[number];
export type LayerDestination = Exclude<LayerSettingId, 'live_touch'>;

export const LIVE_HANDOFF_COMPLETION_TTL_MS = 1_000;

export type RecentLayerHandoff = {
  target: LayerDestination;
  completedAtMs: number;
};

export type DestinationActivationDecision = 'activate' | 'wait' | 'supersede' | 'skip';

export function destinationActivationDecision(
  target: LayerDestination,
  pendingTarget: LayerDestination | null,
  recent: RecentLayerHandoff | null,
  nowMs: number,
): DestinationActivationDecision {
  if (!Number.isFinite(nowMs)) throw new Error('Layer activation clock is invalid');
  if (pendingTarget !== null) return pendingTarget === target ? 'wait' : 'supersede';
  if (recent && recent.target === target
      && nowMs >= recent.completedAtMs
      && nowMs - recent.completedAtMs <= LIVE_HANDOFF_COMPLETION_TTL_MS) {
    return 'skip';
  }
  return 'activate';
}

export type LayerTransitionState = {
  id: string;
  from: LayerSettingId;
  to: LayerSettingId;
  progress: number;
  durationMs: number;
  curve: 'linear';
};

export type LayerSettingsState = {
  type: 'layerSettings';
  active: LayerSettingId;
  target: LayerSettingId;
  transition: LayerTransitionState | null;
  queued: LayerSettingId | null;
  liveTouch: {
    armed: boolean;
    ownerId: string | null;
    ready: boolean;
    pattern: string | null;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLayerSettingId(value: unknown): value is LayerSettingId {
  return typeof value === 'string' && LAYER_SETTING_IDS.includes(value as LayerSettingId);
}

function requireLayerSetting(value: unknown, field: string): LayerSettingId {
  if (!isLayerSettingId(value)) throw new Error(`Layer settings ${field} is invalid`);
  return value;
}

function requireUnitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Layer settings ${field} must be a finite number in [0,1]`);
  }
  return value;
}

function parseTransition(value: unknown): LayerTransitionState | null {
  if (value === null) return null;
  if (!isObject(value)) throw new Error('Layer settings transition is invalid');
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Layer settings transition.id is invalid');
  }
  if (typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0) {
    throw new Error('Layer settings transition.durationMs is invalid');
  }
  if (value.curve !== 'linear') throw new Error('Layer settings transition.curve is invalid');

  return {
    id: value.id,
    from: requireLayerSetting(value.from, 'transition.from'),
    to: requireLayerSetting(value.to, 'transition.to'),
    progress: requireUnitInterval(value.progress, 'transition.progress'),
    durationMs: value.durationMs,
    curve: 'linear',
  };
}

export function parseLayerSettingsState(value: unknown): LayerSettingsState {
  if (!isObject(value)) throw new Error('Layer settings response is not an object');
  if (value.type !== 'layerSettings') throw new Error('Layer settings response type is invalid');
  if (!isObject(value.liveTouch)) throw new Error('Layer settings liveTouch is invalid');
  if (typeof value.liveTouch.armed !== 'boolean') {
    throw new Error('Layer settings liveTouch.armed is invalid');
  }
  if (value.liveTouch.ownerId !== null && typeof value.liveTouch.ownerId !== 'string') {
    throw new Error('Layer settings liveTouch.ownerId is invalid');
  }
  if (typeof value.liveTouch.ready !== 'boolean') {
    throw new Error('Layer settings liveTouch.ready is invalid');
  }
  if (value.liveTouch.pattern !== null && typeof value.liveTouch.pattern !== 'string') {
    throw new Error('Layer settings liveTouch.pattern is invalid');
  }
  if (value.queued !== null && !isLayerSettingId(value.queued)) {
    throw new Error('Layer settings queued destination is invalid');
  }

  return {
    type: 'layerSettings',
    active: requireLayerSetting(value.active, 'active'),
    target: requireLayerSetting(value.target, 'target'),
    transition: parseTransition(value.transition),
    queued: value.queued,
    liveTouch: {
      armed: value.liveTouch.armed,
      ownerId: value.liveTouch.ownerId,
      ready: value.liveTouch.ready,
      pattern: value.liveTouch.pattern,
    },
  };
}

export function layerSettingsRequireLiveHandoff(state: LayerSettingsState): boolean {
  if (state.liveTouch.armed) return true;
  if (state.active === 'live_touch' || state.target === 'live_touch' || state.queued === 'live_touch') {
    return true;
  }
  return state.transition?.from === 'live_touch' || state.transition?.to === 'live_touch';
}

export function mixerFocusMayActivate(planActive: boolean, leaseHeld: boolean): boolean {
  return !planActive || leaseHeld;
}

export function layerSettingForRoute(routeName: string): LayerSettingId | null {
  if (routeName === 'index') return 'deck';
  if (routeName === 'mixer') return 'mixer';
  if (routeName === 'touch_control') return 'live_touch';
  return null;
}

export function layerDestinationForNavigationAction(action: unknown): LayerDestination | null {
  if (!isObject(action) || !isObject(action.payload)) return null;
  const payload = action.payload;
  const params = isObject(payload.params) ? payload.params : null;
  const routeName = typeof payload.name === 'string'
    ? payload.name
    : typeof payload.screen === 'string'
      ? payload.screen
      : params && typeof params.screen === 'string'
        ? params.screen
        : null;
  if (routeName === 'index') return 'deck';
  if (routeName === 'mixer') return 'mixer';
  return null;
}

export function layerDestinationForNavigationState(state: unknown): LayerDestination | null {
  if (!isObject(state) || !Array.isArray(state.routes)
    || typeof state.index !== 'number' || !Number.isInteger(state.index)) {
    return null;
  }
  const route = state.routes[state.index];
  if (!isObject(route)) return null;
  if (route.name === 'index') return 'deck';
  if (route.name === 'mixer') return 'mixer';
  if (isObject(route.state)) return layerDestinationForNavigationState(route.state);
  return null;
}
