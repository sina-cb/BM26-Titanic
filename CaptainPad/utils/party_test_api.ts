import { getApiBaseAsync } from './apiBase';
import { companionUrlFromApiBase } from './companion_url';

export type PartyTestOverride = 'auto' | 'party' | 'off';

/**
 * WHICH companion detector is published as `audioPartyStrong`.
 *
 *   qualified — the gated detector (LEVEL+BEAT+SHAPE+QUIET, then a sustain)
 *   simple    — the plain band-loudness flag also published as `audioParty`
 *
 * The choice LIVES in the companion's config (`config.yaml` → `party.source`)
 * and is made on its PARTY tab. The pad only exposes the same switch.
 */
export const PARTY_SIGNAL_SOURCES = ['qualified', 'simple'] as const;
export type PartySignalSource = (typeof PARTY_SIGNAL_SOURCES)[number];

export interface PartyDetectorState {
  party: boolean;
  publishedParty: boolean | null;
  /**
   * Null when the companion does not report a source at all — an older build.
   * The pad HIDES the selector in that case rather than defaulting it: showing
   * QUALIFIED selected when nothing said so would be an invented value.
   */
  source: PartySignalSource | null;
  /** The gated detector's own latch (same value as `party`, named for clarity). */
  qualifiedParty: boolean | null;
  /** The simple band-loudness detector's latch, whether or not it is selected. */
  simpleParty: boolean | null;
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

/**
 * A field an older companion may not send at all. ABSENT is null (the caller
 * hides the control); PRESENT but the wrong type is a loud error, never a
 * coerced value.
 */
function optionalBool(o: Record<string, unknown>, key: string): boolean | null {
  const value = o[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new Error(`Party detector '${key}' must be a boolean when present, got ${JSON.stringify(value)}`);
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
  // SIGNAL SOURCE: absent ⇒ null (the companion predates the selector, and the
  // card hides the control). Present but unknown ⇒ loud, never silently mapped.
  let source: PartySignalSource | null = null;
  if (o.source !== undefined && o.source !== null) {
    if (!PARTY_SIGNAL_SOURCES.includes(o.source as PartySignalSource)) {
      throw new Error(
        `Party detector source must be one of ${PARTY_SIGNAL_SOURCES.join('/')}, got ${JSON.stringify(o.source)}`);
    }
    source = o.source as PartySignalSource;
  }
  return {
    party: bool(o, 'party'),
    publishedParty: o.publishedParty as boolean | null,
    source,
    qualifiedParty: optionalBool(o, 'qualifiedParty'),
    simpleParty: optionalBool(o, 'simpleParty'),
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

/**
 * Select WHICH detector the companion publishes as `audioPartyStrong`.
 *
 * The companion writes `party.source` into its config.yaml BEFORE it switches,
 * so a rejected write leaves both the file and the running detector untouched —
 * and the typed `partySource` ack is what proves the change landed.
 */
export async function setPartySignalSource(source: PartySignalSource): Promise<void> {
  const wsUrl = partyTestWsUrlFromApiBase(await getApiBaseAsync());
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Audio Companion did not confirm the party signal source.'));
    }, 4000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    socket.onerror = () => finish(new Error('Audio Companion signal source connection failed.'));
    socket.onopen = () => socket.send(JSON.stringify({ type: 'setPartySource', source }));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (!message || message.type !== 'partySource') return;
        if (message.persisted === true && message.source === source) finish();
        else if (message.persisted === false) {
          finish(new Error(
            `The Audio Companion refused the signal source: ${message.error || 'no reason given'}`));
        }
      } catch {
        // Other Companion broadcasts are unrelated; wait for the typed ack.
      }
    };
  });
}

/** What the pad's SIGNAL SOURCE segmented control may show and do right now. */
export interface PartySignalSourceControl {
  /** False ⇒ render `hiddenNote` instead of the control (never a default). */
  visible: boolean;
  hiddenNote: string | null;
  source: PartySignalSource | null;
  disabled: boolean;
  options: { id: PartySignalSource; label: string }[];
  /** One line naming what is actually driving `audioPartyStrong`. */
  note: string | null;
}

const SOURCE_LABELS: Record<PartySignalSource, string> = {
  qualified: 'QUALIFIED',
  simple: 'SIMPLE',
};

/**
 * The one rule set behind the pad's SIGNAL SOURCE control. The card decides
 * nothing itself: no companion state, or a companion that does not report a
 * source, means the control is HIDDEN — never a guessed selection.
 */
export function partySignalSourceControl(input: {
  detector: PartyDetectorState | null;
  connected: boolean;
  locked: boolean;
  pending: boolean;
}): PartySignalSourceControl {
  const { detector, connected, locked, pending } = input;
  const options = PARTY_SIGNAL_SOURCES.map((id) => ({ id, label: SOURCE_LABELS[id] }));
  if (!detector) {
    return { visible: false, hiddenNote: null, source: null, disabled: true, options, note: null };
  }
  if (detector.source === null) {
    return {
      visible: false,
      hiddenNote: 'COMPANION DOES NOT REPORT A SIGNAL SOURCE',
      source: null,
      disabled: true,
      options,
      note: null,
    };
  }
  return {
    visible: true,
    hiddenNote: null,
    source: detector.source,
    disabled: !connected || locked || pending,
    options,
    note: detector.source === 'simple'
      ? 'SIMPLE — the gates below are the QUALIFIED detector and are NOT driving the signal.'
      : 'QUALIFIED — the four gates below are what drives the signal.',
  };
}

/**
 * The detector panel's SIGNAL headline, including which source is on the wire.
 * A companion without a source reports the state alone, unqualified.
 */
export function partySignalHeadline(detector: PartyDetectorState): string {
  const state = detector.publishedParty === null
    ? 'SIGNAL …'
    : detector.publishedParty ? 'SIGNAL ON' : 'SIGNAL OFF';
  if (detector.source === null) return state;
  return `${state} · VIA ${SOURCE_LABELS[detector.source]}`;
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
