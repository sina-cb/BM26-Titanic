import { getApiBaseAsync } from './apiBase';
import { companionUrlFromApiBase } from './companion_url';

export type PartyTestOverride = 'auto' | 'party' | 'off';

export interface PartyDetectorState {
  party: boolean;
  publishedParty: boolean | null;
  qualify: boolean;
  levelOk: boolean;
  beatOk: boolean;
  shapeOk: boolean;
  quietOk: boolean;
  loudness: number;
  kickRate: number;
  kickReg: number;
  lowShare: number;
  highShare: number;
  silence: number;
  qualifyingForMs: number;
  disqualifyingForMs: number;
  overrideMode: PartyTestOverride;
  params: {
    ambientFloor: number;
    marginX: number;
    kickRateMin: number;
    kickRateMax: number;
    kickRegMin: number;
    shapeLowMin: number;
    shapeHighMin: number;
    silenceMax: number;
    onSustainMs: number;
    offConfirmMs: number;
  };
}

function finite(o: Record<string, unknown>, key: string): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Party detector '${key}' must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function bool(o: Record<string, unknown>, key: string): boolean {
  const value = o[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Party detector '${key}' must be a boolean, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parsePartyDetectorState(raw: unknown): PartyDetectorState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Party detector state must be an object, got ${JSON.stringify(raw)}`);
  }
  const o = raw as Record<string, unknown>;
  const params = o.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error(`Party detector 'params' must be an object, got ${JSON.stringify(params)}`);
  }
  const p = params as Record<string, unknown>;
  if (!['auto', 'party', 'off'].includes(String(o.overrideMode))) {
    throw new Error(`Party detector overrideMode is invalid: ${JSON.stringify(o.overrideMode)}`);
  }
  if (o.publishedParty !== null && typeof o.publishedParty !== 'boolean') {
    throw new Error(`Party detector publishedParty must be boolean|null, got ${JSON.stringify(o.publishedParty)}`);
  }
  return {
    party: bool(o, 'party'),
    publishedParty: o.publishedParty as boolean | null,
    qualify: bool(o, 'qualify'),
    levelOk: bool(o, 'levelOk'),
    beatOk: bool(o, 'beatOk'),
    shapeOk: bool(o, 'shapeOk'),
    quietOk: bool(o, 'quietOk'),
    loudness: finite(o, 'loudness'),
    kickRate: finite(o, 'kickRate'),
    kickReg: finite(o, 'kickReg'),
    lowShare: finite(o, 'lowShare'),
    highShare: finite(o, 'highShare'),
    silence: finite(o, 'silence'),
    qualifyingForMs: finite(o, 'qualifyingForMs'),
    disqualifyingForMs: finite(o, 'disqualifyingForMs'),
    overrideMode: o.overrideMode as PartyTestOverride,
    params: {
      ambientFloor: finite(p, 'ambientFloor'),
      marginX: finite(p, 'marginX'),
      kickRateMin: finite(p, 'kickRateMin'),
      kickRateMax: finite(p, 'kickRateMax'),
      kickRegMin: finite(p, 'kickRegMin'),
      shapeLowMin: finite(p, 'shapeLowMin'),
      shapeHighMin: finite(p, 'shapeHighMin'),
      silenceMax: finite(p, 'silenceMax'),
      onSustainMs: finite(p, 'onSustainMs'),
      offConfirmMs: finite(p, 'offConfirmMs'),
    },
  };
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

/** Same-host, fixed-port Companion URL; reject public/ambiguous destinations. */
export function partyTestWsUrlFromApiBase(apiBase: string): string {
  const companion = new URL(companionUrlFromApiBase(apiBase));
  const hostname = companion.hostname.replace(/^\[|\]$/g, '');
  if (hostname !== 'localhost' && hostname !== '::1' && !isPrivateIpv4(hostname)) {
    throw new Error(
      `Force Party requires a private-LAN engine address; refusing Companion host ${JSON.stringify(hostname)}.`,
    );
  }
  companion.protocol = companion.protocol === 'https:' ? 'wss:' : 'ws:';
  companion.pathname = '/ws';
  companion.search = '';
  companion.hash = '';
  return companion.toString();
}

/** Runtime-only detector override. `auto` immediately restores live audio truth. */
export async function setPartyTestOverride(mode: PartyTestOverride): Promise<void> {
  const wsUrl = partyTestWsUrlFromApiBase(await getApiBaseAsync());
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Audio Companion did not confirm the Force Party override.'));
    }, 4000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    socket.onerror = () => finish(new Error('Audio Companion Force Party connection failed.'));
    socket.onopen = () => socket.send(JSON.stringify({ type: 'setPartyOverride', mode }));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message && message.type === 'partyOverride' && message.mode === mode) finish();
      } catch {
        // Other Companion broadcasts are unrelated; wait for the typed ack.
      }
    };
  });
}

/** Subscribe to the Companion's read-only detector telemetry. */
export async function subscribePartyDetector(
  onState: (state: PartyDetectorState) => void,
  onError: (error: Error) => void,
): Promise<() => void> {
  const wsUrl = partyTestWsUrlFromApiBase(await getApiBaseAsync());
  const socket = new WebSocket(wsUrl);
  let closed = false;
  socket.onerror = () => {
    if (!closed) onError(new Error('Audio Companion detector connection failed.'));
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message && message.type === 'partyState') {
        onState(parsePartyDetectorState(message));
      }
    } catch (caught: any) {
      if (!closed) onError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  };
  return () => {
    closed = true;
    socket.close();
  };
}
