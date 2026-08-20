export interface AudioConfig {
  enabled: boolean;
  capture: {
    backend: string;
    device: string | null;
    deviceLabel?: string | null;
    deviceId?: string | null;
    sampleRate: number;
    channels: number;
    inputFormat: string | null;
  };
  fftSize: number;
  hopSize: number;
  bands: {
    lowMaxHz: number;
    midMaxHz: number;
    attackMs: number;
    releaseMs: number;
    noiseGate: number;
    inputGain?: number;
  };
  kick: {
    minHz: number;
    maxHz: number;
    threshold: number;
    refractoryMs: number;
    decayMs: number;
  };
  structureDetector?: {
    enabled?: boolean;
    dropEdgeMode?: 'level' | 'windowed';
    dropDeltaWindowMs?: number;
    buildThreshold?: number;
    dropEnergyJump?: number;
    eventRefractoryMs?: number;
    stemsTimeoutMs?: number;
  };
}

export interface AudioPageLayout {
  routeWidth: number;
  pagePadding: number;
  meterColumns: 1 | 2 | 3;
  stackBpmControls: boolean;
}

export type AudioRouteBodyState = 'content' | 'authority_pending' | 'redirect';

export function audioRouteBodyState({
  performanceModeReady,
  globalPerformanceActive,
  engineOffline,
}: {
  performanceModeReady: boolean;
  globalPerformanceActive: boolean;
  engineOffline: boolean;
}): AudioRouteBodyState {
  if (globalPerformanceActive) return 'redirect';
  if (!performanceModeReady && !engineOffline) return 'authority_pending';
  return 'content';
}

const CAPTAINPAD_RAIL_WIDTH = 112;

export function audioPageLayout(windowWidth: number): AudioPageLayout {
  if (!Number.isFinite(windowWidth) || windowWidth <= CAPTAINPAD_RAIL_WIDTH) {
    throw new Error(`Audio layout requires a window wider than ${CAPTAINPAD_RAIL_WIDTH}px`);
  }
  const routeWidth = windowWidth - CAPTAINPAD_RAIL_WIDTH;
  const pagePadding = routeWidth >= 900 ? 32 : routeWidth >= 480 ? 24 : 16;
  const contentWidth = routeWidth - pagePadding * 2;
  const meterColumns: AudioPageLayout['meterColumns'] =
    contentWidth >= 720 ? 3 : contentWidth >= 360 ? 2 : 1;
  return {
    routeWidth,
    pagePadding,
    meterColumns,
    stackBpmControls: contentWidth < 360,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`${label}.${key} must be a string`);
  return value;
}

export function parseAudioConfig(value: unknown): AudioConfig {
  const root = requireRecord(value, 'audio config');
  if (typeof root.enabled !== 'boolean') throw new Error('audio config.enabled must be a boolean');
  const capture = requireRecord(root.capture, 'audio config.capture');
  const bands = requireRecord(root.bands, 'audio config.bands');
  const kick = requireRecord(root.kick, 'audio config.kick');
  const device = capture.device;
  if (device !== null && typeof device !== 'string') {
    throw new Error('audio config.capture.device must be a string or null');
  }
  const inputFormat = capture.inputFormat;
  if (inputFormat !== null && typeof inputFormat !== 'string') {
    throw new Error('audio config.capture.inputFormat must be a string or null');
  }
  if (bands.inputGain !== undefined) {
    requireNumber(bands, 'inputGain', 'audio config.bands');
  }
  return {
    ...(root as unknown as AudioConfig),
    enabled: root.enabled,
    capture: {
      ...(capture as AudioConfig['capture']),
      backend: requireString(capture, 'backend', 'audio config.capture'),
      device,
      sampleRate: requireNumber(capture, 'sampleRate', 'audio config.capture'),
      channels: requireNumber(capture, 'channels', 'audio config.capture'),
      inputFormat,
    },
    fftSize: requireNumber(root, 'fftSize', 'audio config'),
    hopSize: requireNumber(root, 'hopSize', 'audio config'),
    bands: {
      ...(bands as AudioConfig['bands']),
      lowMaxHz: requireNumber(bands, 'lowMaxHz', 'audio config.bands'),
      midMaxHz: requireNumber(bands, 'midMaxHz', 'audio config.bands'),
      attackMs: requireNumber(bands, 'attackMs', 'audio config.bands'),
      releaseMs: requireNumber(bands, 'releaseMs', 'audio config.bands'),
      noiseGate: requireNumber(bands, 'noiseGate', 'audio config.bands'),
    },
    kick: {
      ...(kick as AudioConfig['kick']),
      minHz: requireNumber(kick, 'minHz', 'audio config.kick'),
      maxHz: requireNumber(kick, 'maxHz', 'audio config.kick'),
      threshold: requireNumber(kick, 'threshold', 'audio config.kick'),
      refractoryMs: requireNumber(kick, 'refractoryMs', 'audio config.kick'),
      decayMs: requireNumber(kick, 'decayMs', 'audio config.kick'),
    },
  };
}

export interface ApiResultLike {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export function paramCenterWriteError(result: ApiResultLike, key: string): string | null {
  if (!result.ok) return result.error || `failed to save ${key}`;
  const data = requireRecord(result.data, 'param-center response');
  if (typeof data.error === 'string' && data.error) return data.error;
  if (data.status !== 'ok' && data.status !== 'partial') {
    return `param-center returned an invalid status for ${key}`;
  }
  const ignored = Array.isArray(data.ignored) ? data.ignored : [];
  const refusal = ignored.find((entry) => {
    return entry && typeof entry === 'object' && (entry as Record<string, unknown>).key === key;
  }) as Record<string, unknown> | undefined;
  if (!refusal) return null;
  const reason = typeof refusal.reason === 'string' ? refusal.reason : 'write was ignored';
  return `${key}: ${reason}`;
}

export function paramValueMatches(actual: number | undefined, expected: number): boolean {
  return typeof actual === 'number' && Number.isFinite(actual)
    && Math.abs(actual - expected) < 0.0001;
}
