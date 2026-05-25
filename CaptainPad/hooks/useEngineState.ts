// useEngineState — centralized, module-level subscription to the engine
// WebSocket events that the deck/mixer tabs fan into engineEvents.
//
// Why this exists:
//   Previously every component that wanted "live" engine data (global
//   params, mixer channels, blackout, etc.) had to plumb a wsRef down
//   from the tab and bind addEventListener('message', …) inside its own
//   useEffect. That had two failure modes the operators kept hitting:
//
//     1. wsRef.current was null at mount, the effect returned early,
//        and the listener was never attached when the WS finally
//        connected.
//     2. When the auto-reconnect loop replaced the WS instance, the
//        listener stayed bound to the dead socket and silently stopped
//        firing.
//
//   The same trap was being re-introduced for every new live-state
//   surface (PortWatch global-param mirroring, local export mirroring,
//   …). Centralizing here turns every "we want this to stay in sync"
//   surface into a one-line hook call.
//
// Design notes:
//   - We follow the same shape as useEngineLock: module-level cache,
//     module-level Set of listeners, and a useState + effect inside the
//     hook so components subscribe declaratively.
//   - The deck tab AND the mixer tab both forward every parsed WS
//     message through engineEvents.emit; we subscribe once at the
//     module level and stay subscribed for the app's lifetime. Tab
//     switches do NOT cycle this subscription.
//   - We seed from /param-center and /mixer once so the very first
//     render on a cold boot already has the right values; the WS
//     subscription then keeps us live.
//
// What this hook returns:
//   - `sharedParams`: canonical /param-center state ({revision, params,
//     sourceLock}). Components flatten params[k].value to drive their
//     UI. Reflects every writer (CaptainPad, PortWatch, scripts).
//   - `mixerChannels`: latest array from the `mixer` WS broadcast.
//     Channels include their `exports` array with live v0/v1/v2 — that
//     is the channel for *local* per-pattern params and is what lets
//     PortWatch's local-export writes show up in CaptainPad's deck UI.
//   - `blackout`: the engine's blackout state, broadcast inside `mixer`
//     events (engine attaches `blackout: globalsState.blackout`).

import { useEffect, useState } from 'react';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';
import { fetchParamCenter, fetchMixerState, fetchParamCenterSchema } from '@/utils/api';

export interface SharedParamValue {
  // The engine emits HSV objects for color palettes and plain floats
  // for scalar params; UI components inspect by key.
  value: unknown;
  lastSource?: string;
  lastOrigin?: string;
  lastRevision?: number;
}

export interface SharedParams {
  revision: number;
  sourceLock: unknown;
  params: Record<string, SharedParamValue>;
}

export interface MixerChannelExport {
  id: number;
  name: string;
  kind: number;
  v0?: number;
  v1?: number;
  v2?: number;
}

export interface MixerChannel {
  id: string;
  name?: string;
  pattern?: string;
  exports?: MixerChannelExport[];
  // Other fields are forwarded as-is — components only narrow what they need.
  [k: string]: unknown;
}

/**
 * Snapshot of the OSC listener's last published telemetry. See
 * docs/24_osc_integration.md §10 ("Status & Telemetry"). The
 * engine sends one `oscStats` message per second when the
 * listener is running, and synthesises a {enabled: false} payload
 * at boot when the listener is off — so this field is `null` only
 * for the brief moment before the first WS message lands.
 *
 * The api_server caches the latest payload and replays it on
 * every new WS connection, so a freshly-mounted CaptainPad sees
 * the correct pill state inside one frame instead of waiting up
 * to one second for the next stats tick.
 */
export interface OscStats {
  enabled: boolean;
  port: number | null;
  host: string | null;
  allowedSendersCount: number;
  bindingsCount: number;
  rxMessagesPerSec: number;
  mappedMessagesPerSec: number;
  droppedMessagesPerSec: number;
  invalidMessagesPerSec: number;
  lastSeenMs: number;
  lastSender: string | null;
  now?: number;
}

/**
 * Subset of the CPC schema entry that the iPad UIs care about for
 * range-aware controls (e.g. per-stem gain sliders that need
 * `range[1]` to map slider position → CPC value).
 *
 * Fetched once at boot via `GET /param-center/schema` — the schema
 * is fixed for the lifetime of an engine process so there's no need
 * to subscribe to changes. If `osc.gainMax` is changed in
 * `config.yaml` the operator restarts the engine and any open
 * CaptainPad picks up the new range on next reload.
 */
export interface ParamSchemaEntry {
  key: string;
  label: string;
  type: 'float' | 'int' | 'hsv';
  range: [number, number];
  default: number | { h: number; s: number; v: number };
  persist: boolean;
  live: boolean;
  broadcastHz: number;
  portWatch: boolean;
}

/**
 * Live-only CPC subset, broadcast on the `liveParams` WS message
 * type. This is the high-rate audio-derived state — mic bands + kick,
 * OSC stems, tempoBpm — that used to ride the same `sharedParams`
 * broadcast as colors/speed/size and force the mixer / deck UIs to
 * parse a 1.5 KB snapshot ~30× / second whenever the analyser was
 * running.
 *
 * Engine: `liveParams` only contains the keys whose schema entry has
 * `live: true`. The full canonical doc still lives on `sharedParams`
 * (REST + WS) and is broadcast only when a STEADY key actually
 * changes.
 *
 * Consumers:
 *   - audio.tsx — meters + BPM read from useLiveParamValues
 *   - everything else — keeps reading useSharedParamValues, never
 *     re-renders just because the analyser ticked
 */
export interface LiveParams {
  revision: number;
  params: Record<string, SharedParamValue>;
}

export interface EngineLiveState {
  sharedParams: SharedParams | null;
  /**
   * Audio-derived live params (see LiveParams). Null until the first
   * liveParams broadcast or REST seed lands. Components that depend
   * on these MUST go through useLiveParamValues / useLiveParams so a
   * UI that needs a single live key (e.g. the deck's BPM badge)
   * still re-renders cheaply when the field changes.
   */
  liveParams: LiveParams | null;
  mixerChannels: MixerChannel[];
  blackout: boolean;
  /**
   * Global mixer master fader (0..1). Sourced from the same `mixer`
   * WS broadcast as channels/blackout — exposing it here so the deck
   * top bar can mirror the mixer's master without owning its own WS
   * binding.
   */
  master: number;
  oscStats: OscStats | null;
  /**
   * Latest `audioStatus` broadcast from the engine (docs/25 §6.3).
   * Cached & replayed by api_server on WS connect, so this converges
   * to the live state within ~1 s of mounting. Null until the first
   * message arrives or while audio support is unwired.
   */
  audioStatus: AudioStatus | null;
  /** Map of CPC key → schema entry. Empty until the first /param-center/schema fetch resolves. */
  paramSchema: Record<string, ParamSchemaEntry>;
}

export interface AudioStatus {
  enabled: boolean;
  backend?: string;
  device?: string;
  sampleRate?: number;
  channels?: number;
  captureFps?: number;
  /** `'starting' | 'running' | 'exited' | 'restarting' | 'stopped' | 'error'` */
  phase?: string;
  error?: string | null;
  lastKickMs?: number;
}

const EMPTY_STATE: EngineLiveState = {
  sharedParams: null,
  liveParams: null,
  mixerChannels: [],
  blackout: false,
  master: 1.0,
  oscStats: null,
  audioStatus: null,
  paramSchema: {},
};

let _cached: EngineLiveState = EMPTY_STATE;
const _listeners = new Set<(s: EngineLiveState) => void>();
let _initialized = false;

// liveParams rides its own micro-bus on purpose. It updates 15-30 Hz
// while the audio analyser is running and we don't want every
// useEngineState() consumer (mixer chrome, deck top bar, playlist
// panel) to re-render at that rate just because the mic kick fired.
// Only useLiveParams / useLiveParamValues subscribe here, so the
// fan-out is bounded to the components that actually visualise live
// audio data (audio.tsx meters + the BPM badge).
let _liveCached: LiveParams | null = null;
const _liveListeners = new Set<(s: LiveParams | null) => void>();

function _emit(next: EngineLiveState) {
  _cached = next;
  _listeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // A buggy subscriber must never break the broadcast pipeline.
    }
  });
}

function _emitLive(next: LiveParams | null) {
  _liveCached = next;
  // Mirror onto _cached.liveParams too so an audio-tab cold mount
  // that reads useEngineState().liveParams sees the latest known
  // value without having to subscribe via useLiveParams first.
  _cached = { ..._cached, liveParams: next };
  _liveListeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // Same defensive isolation as _emit — a buggy subscriber must
      // never break the audio meter pipeline.
    }
  });
}

function _onMessage(msg: EngineMessage) {
  if (msg.type === 'sharedParams') {
    const raw = msg as unknown as SharedParams & { type: string };
    // The engine sends the whole canonical doc on every change; we
    // store it verbatim so UIs can read sourceLock + revision too.
    _emit({
      ..._cached,
      sharedParams: {
        revision: typeof raw.revision === 'number' ? raw.revision : 0,
        sourceLock: raw.sourceLock ?? null,
        params: (raw.params as Record<string, SharedParamValue>) || {},
      },
    });
  } else if (msg.type === 'liveParams') {
    // Audio-derived high-rate keys. Routed onto its own micro-bus so
    // only audio meters / BPM badge re-render at the analyser's
    // 15-30 Hz cadence; the rest of the UI stays still even when the
    // analyser is hot. See engine `broadcastCpcSplit` in
    // lib/api_server.js.
    const raw = msg as unknown as { revision?: number; params?: Record<string, SharedParamValue> };
    _emitLive({
      revision: typeof raw.revision === 'number' ? raw.revision : 0,
      params: raw.params || {},
    });
  } else if (msg.type === 'mixer') {
    // The mixer broadcast carries every channel's exports with live
    // v0/v1/v2 — see serializeMixerState() in
    // marsin_engine/lib/api_server.js. Forwarding the array as-is
    // lets the deck card's GlobalParams (variant="deck") and the
    // mixer tab's CPCControls share the same live source.
    const rawChannels = (msg.channels as MixerChannel[] | undefined) ?? [];
    const blackout = msg.blackout === true;
    const master = typeof msg.master === 'number' ? msg.master : _cached.master;
    _emit({
      ..._cached,
      mixerChannels: rawChannels,
      blackout,
      master,
    });
  } else if (msg.type === 'oscStats') {
    // OSC listener telemetry — one per second when enabled, plus a
    // {enabled:false} snapshot when the listener is off. Replayed
    // on WS reconnect, so this always converges to the real state
    // within a tick. See docs/24 §10.
    _emit({
      ..._cached,
      oscStats: {
        enabled: msg.enabled === true,
        port: (msg.port as number | null) ?? null,
        host: (msg.host as string | null) ?? null,
        allowedSendersCount: Number(msg.allowedSendersCount) || 0,
        bindingsCount: Number(msg.bindingsCount) || 0,
        rxMessagesPerSec: Number(msg.rxMessagesPerSec) || 0,
        mappedMessagesPerSec: Number(msg.mappedMessagesPerSec) || 0,
        droppedMessagesPerSec: Number(msg.droppedMessagesPerSec) || 0,
        invalidMessagesPerSec: Number(msg.invalidMessagesPerSec) || 0,
        lastSeenMs: Number(msg.lastSeenMs) || 0,
        lastSender: (msg.lastSender as string | null) ?? null,
        now: typeof msg.now === 'number' ? msg.now : undefined,
      },
    });
  } else if (msg.type === 'audioStatus') {
    // Mic-listener heartbeat (docs/25 §6.3). Sent at 1 Hz from the
    // engine, plus on every lifecycle event (start/stop/restart) so
    // the Audio Analysis tab reflects state changes immediately.
    _emit({
      ..._cached,
      audioStatus: {
        enabled: msg.enabled === true,
        backend: (msg.backend as string | undefined),
        device:  (msg.device  as string | undefined),
        sampleRate: typeof msg.sampleRate === 'number' ? msg.sampleRate : undefined,
        channels:   typeof msg.channels   === 'number' ? msg.channels   : undefined,
        captureFps: typeof msg.captureFps === 'number' ? msg.captureFps : 0,
        phase:      (msg.phase as string | undefined),
        error:      (msg.error as string | null | undefined) ?? null,
        lastKickMs: typeof msg.lastKickMs === 'number' ? msg.lastKickMs : 0,
      },
    });
  }
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  engineEvents.subscribe(_onMessage);

  // Seed from REST so the first paint is already correct even before
  // the first WS message lands. Both endpoints fail silently — the WS
  // path will catch us up within a couple of seconds.
  //
  // The REST seed also feeds the liveParams cache: /param-center
  // returns the WHOLE CPC doc (steady + live keys), so we extract the
  // live-flagged subset and prime _liveCached too. Without this,
  // useLiveParamValues would return defaults until the first WS
  // liveParams broadcast lands (which can take up to ~70 ms with the
  // analyser idle, or longer if the analyser is disabled — see
  // engine.js audio bootstrap).
  fetchParamCenter()
    .then((r) => {
      if (!r.ok || !r.data) return;
      const data = r.data as SharedParams;
      _emit({
        ..._cached,
        sharedParams: {
          revision: data.revision ?? 0,
          sourceLock: data.sourceLock ?? null,
          params: data.params || {},
        },
      });
      // Best-effort live-key extraction. We don't have the schema
      // yet (the fetchParamCenterSchema chain races us), so we use a
      // hardcoded list of the live keys defined in
      // marsin_engine/lib/param_center.js. Adding a new live key
      // there requires updating this set too; if the set drifts the
      // worst case is a one-frame stale meter on cold boot.
      const liveKeys = new Set([
        'micLow', 'micMid', 'micHigh', 'micKick',
        'stemsVocals', 'stemsBass', 'stemsDrums',
        'tempoBpm',
      ]);
      const liveSlice: Record<string, SharedParamValue> = {};
      for (const k of liveKeys) {
        const slot = data.params?.[k];
        if (slot) liveSlice[k] = slot;
      }
      if (Object.keys(liveSlice).length > 0) {
        _emitLive({ revision: data.revision ?? 0, params: liveSlice });
      }
    })
    .catch(() => undefined);

  fetchParamCenterSchema()
    .then((r) => {
      if (!r.ok || !r.data) return;
      const flat: Record<string, ParamSchemaEntry> = {};
      for (const e of r.data as ParamSchemaEntry[]) {
        if (e && typeof e.key === 'string') flat[e.key] = e;
      }
      _emit({ ..._cached, paramSchema: flat });
    })
    .catch(() => undefined);

  fetchMixerState()
    .then((r) => {
      if (!r.ok || !r.data) return;
      const data = r.data as { channels?: MixerChannel[]; blackout?: boolean; master?: number };
      _emit({
        ..._cached,
        mixerChannels: data.channels ?? [],
        blackout: data.blackout === true,
        master: typeof data.master === 'number' ? data.master : _cached.master,
      });
    })
    .catch(() => undefined);
}

/**
 * Subscribe to live engine state. Re-renders the caller whenever the
 * underlying broadcast fires. Safe to call from any component, any
 * tab — it shares one subscription across the whole app.
 */
export function useEngineState(): EngineLiveState {
  _ensureInitialized();
  const [state, setState] = useState<EngineLiveState>(_cached);
  useEffect(() => {
    _listeners.add(setState);
    // Resync to whatever's current in case we missed an update between
    // mount and effect run (same pattern as useEngineLock).
    setState(_cached);
    return () => {
      _listeners.delete(setState);
    };
  }, []);
  return state;
}

/**
 * Convenience selector — returns the flattened {key: value} map for
 * the canonical shared params. Components that only need values
 * (CPCControls' sliders / colour swatches) avoid the boilerplate of
 * walking sharedParams.params[k].value themselves.
 *
 * Pass `defaults` so callers don't have to deal with the "not loaded
 * yet" case — values get merged on top.
 */
export function useSharedParamValues<T extends Record<string, unknown>>(
  defaults: T,
): T {
  const { sharedParams } = useEngineState();
  if (!sharedParams) return defaults;
  const flat: Record<string, unknown> = { ...defaults };
  for (const key in sharedParams.params) {
    const v = sharedParams.params[key]?.value;
    if (v !== undefined) flat[key] = v;
  }
  return flat as T;
}

/**
 * Subscribe to the live audio-derived CPC subset. Components that
 * only need a single live key (e.g. the deck's BPM badge) should use
 * useLiveParamValues with just that key in `defaults` so they only
 * re-render on liveParams broadcasts. Mixer / deck chrome should NOT
 * call this — they'd re-render at the analyser's 15-30 Hz cadence.
 */
export function useLiveParams(): LiveParams | null {
  _ensureInitialized();
  const [state, setState] = useState<LiveParams | null>(_liveCached);
  useEffect(() => {
    _liveListeners.add(setState);
    // Resync — see useEngineState for rationale.
    setState(_liveCached);
    return () => { _liveListeners.delete(setState); };
  }, []);
  return state;
}

/**
 * Convenience selector mirroring useSharedParamValues but bound to
 * the live audio bus. Defaults are merged on top so callers don't
 * have to deal with the pre-load null case.
 *
 * Examples:
 *   const { micLow, micMid } = useLiveParamValues({ micLow: 0, micMid: 0 });
 *   const { tempoBpm } = useLiveParamValues({ tempoBpm: 0 });
 */
export function useLiveParamValues<T extends Record<string, unknown>>(
  defaults: T,
): T {
  const live = useLiveParams();
  if (!live) return defaults;
  const flat: Record<string, unknown> = { ...defaults };
  for (const key in live.params) {
    const v = live.params[key]?.value;
    if (v !== undefined) flat[key] = v;
  }
  return flat as T;
}

/**
 * Convenience selector — returns the live exports for a specific
 * channel id. Used by GlobalParams in the mixer-base case where we
 * want a "base params" strip that mirrors the deck channel's exports
 * with every external writer (PortWatch local-exports, etc.) reflected
 * instantly.
 */
/**
 * Returns `[min, max]` for a CPC key, falling back to a safe default
 * before the schema fetch has landed. Used by range-aware controls
 * (per-stem gain sliders) so the UI sweeps the actual engine-side
 * range instead of guessing 0..1.
 */
export function useParamRange(key: string, fallback: [number, number] = [0, 1]): [number, number] {
  const { paramSchema } = useEngineState();
  const entry = paramSchema[key];
  if (entry && Array.isArray(entry.range) && entry.range.length === 2) return entry.range;
  return fallback;
}

export function useChannelExports(channelId: string | undefined): MixerChannelExport[] {
  const { mixerChannels } = useEngineState();
  if (!channelId) return [];
  const ch = mixerChannels.find((c) => c.id === channelId);
  return ch?.exports ?? [];
}

/**
 * Derived OSC listener state for the status pill in CPCControls.
 * Translates raw counters into one of four UI states per
 * docs/24_osc_integration.md §10.2:
 *
 *   - 'off'       : listener disabled (engine boot flag, or boot threw).
 *   - 'idle'      : enabled, but no packets in the last STALE_MS window.
 *   - 'unmapped'  : enabled, rx > 0 but mapped == 0 — packets are
 *                   arriving but no binding matches them. This is the
 *                   "your TouchOSC layout is sending /1/fader1 and your
 *                   config has no /1/fader1 binding" case.
 *   - 'live'      : enabled, mapped > 0 — values are flowing into the CPC.
 *
 * Returns null only for the very first frame before the first WS message
 * lands; callers should render an "OSC …" pill in that case.
 */
export type OscDerivedState = 'off' | 'idle' | 'unmapped' | 'live';

export interface OscPillState {
  state: OscDerivedState;
  /** Human-readable label for the pill body (e.g. "60 msg/s"). */
  label: string;
  /** Full snapshot for the diagnostic sheet. */
  stats: OscStats;
}

// "No packets in this many ms" → idle. Two seconds is twice the
// stats publish cadence, so a single dropped stats event doesn't
// flicker the pill amber.
const STALE_MS = 2_000;

export function useOscStatus(): OscPillState | null {
  const { oscStats } = useEngineState();
  if (!oscStats) return null;

  if (!oscStats.enabled) {
    return { state: 'off', label: 'OFF', stats: oscStats };
  }

  const referenceTime = oscStats.now ?? Date.now();
  const stale = oscStats.lastSeenMs === 0
    ? true
    : referenceTime - oscStats.lastSeenMs > STALE_MS;

  if (oscStats.mappedMessagesPerSec > 0 || (!stale && oscStats.lastSeenMs > 0)) {
    return {
      state: 'live',
      label: oscStats.mappedMessagesPerSec > 0
        ? `${oscStats.mappedMessagesPerSec} msg/s`
        : 'live',
      stats: oscStats,
    };
  }
  if (oscStats.rxMessagesPerSec > 0) {
    return {
      state: 'unmapped',
      label: `RX ${oscStats.rxMessagesPerSec}, 0 mapped`,
      stats: oscStats,
    };
  }
  return {
    state: 'idle',
    label: stale ? 'IDLE' : 'WAITING',
    stats: oscStats,
  };
}

/**
 * Selector for the mic listener's live status (docs/25 §6.3).
 * Returns null until the first audioStatus broadcast arrives.
 */
export function useAudioStatus(): AudioStatus | null {
  return useEngineState().audioStatus;
}

