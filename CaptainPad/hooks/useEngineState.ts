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

import { useEffect, useMemo, useRef, useState } from 'react';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';
import { engineParamsEvents } from '@/utils/engineParamsEvents';
import { engineSignalsEvents } from '@/utils/engineSignalsEvents';
import { fetchParamCenter, fetchMixerState, fetchParamCenterSchema, fetchDeckChannel } from '@/utils/api';

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
  /**
   * Mixer overlay channels ONLY. Post-channel-split (May 2026) the
   * deck channel lives in its own field (`deckChannel`) below — it is
   * NOT included in this array and never will be. UIs that want "the
   * deck slot" must read `deckChannel`; UIs that want "the overlays"
   * read this.
   */
  mixerChannels: MixerChannel[];
  /**
   * Singleton deck channel (PFL preview). Sourced from the engine's
   * `deck` WS event (and the REST `/deck/channel` seed). Null while
   * the WS is establishing or if the engine has no deck channel.
   */
  deckChannel: MixerChannel | null;
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

/**
 * Mic device shape carried inside `availableDevices` of an audioStatus
 * `configured_mic_not_found` error payload. Same wire shape as
 * `/audio/devices` returns (see fetchAudioDevices), so the iPad can
 * reuse the existing MicPickerRow without re-fetching.
 */
export interface AudioStatusDevice {
  id: string;
  label: string;
  platform: string;
  inputFormat: string;
  ffmpegDevice: string;
  isDefault?: boolean;
  alternativeName?: string;
}

export interface AudioStatusMissingDevice {
  device: string | null;
  deviceLabel: string | null;
  deviceId: string | null;
  platform: string | null;
}

export interface AudioStatusEnumerationError {
  /** Engine-side code: `'ffmpeg_missing' | 'unsupported_platform' | 'unknown'` */
  code: string;
  message: string;
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
  /**
   * Engine error code when audio capture cannot start. Currently
   * `'configured_mic_not_found' | 'device_enumeration_failed'` from
   * engine commit 5d830d6 (cross-machine mic-not-found guard), plus
   * the original free-form string for legacy lifecycle errors. CaptainPad
   * surfaces the two coded states as a prominent banner in the AUDIO
   * tab; everything else falls back to the inline picker error line.
   */
  error?: string | null;
  /** Populated only when `error === 'configured_mic_not_found'`. */
  missingDevice?: AudioStatusMissingDevice;
  /**
   * Engine-enumerated devices, same shape as `/audio/devices`. Populated
   * when `error === 'configured_mic_not_found'` so the iPad can offer a
   * one-tap picker without round-tripping `/audio/devices` again.
   */
  availableDevices?: AudioStatusDevice[];
  /** Populated only when `error === 'device_enumeration_failed'`. */
  enumerationError?: AudioStatusEnumerationError;
  platform?: string;
  inputFormat?: string;
  lastKickMs?: number;
}

const EMPTY_STATE: EngineLiveState = {
  sharedParams: null,
  liveParams: null,
  mixerChannels: [],
  deckChannel: null,
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

// ── useEngineSlice — per-key short-circuit primitive (May 2026 perf pass) ──
//
// Before this primitive existed, every derived hook (useSharedParamValues,
// useOscStatus, useAudioStatus, useChannelExports, useParamRange) called
// useEngineState() and re-rendered on every WS message — even though it
// only cared about one field. With 7 hooks mounted across the deck/mixer/
// audio surface that meant a 10 Hz mixer-event burst caused ~70 setState
// calls per second across the React tree, queueing reconciliation work
// behind any other in-flight microtask (notably `fetchAudioConfig().then`,
// which was the "audio tab hangs for 30s" symptom).
//
// useEngineSlice subscribes to the SHARED `_listeners` Set (one entry
// per call site) but each listener computes a per-call-site slice and
// only calls setState when the selector's output actually changes by
// reference equality. So a sharedParams broadcast that only touched
// `speed` no longer forces useOscStatus / useAudioStatus / useChannelExports
// to re-render; only the consumers whose slice actually changed do.
//
// Contract: `selector` must be reference-stable across calls when its
// input slice hasn't changed. The default selector returned by
// `_pickField` and `_pickFields` honors this by returning the same
// reference when the picked field(s) are === to the previous value.
function useEngineSlice<T>(selector: (s: EngineLiveState) => T): T {
  _ensureInitialized();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const [slice, setSlice] = useState<T>(() => selector(_cached));
  const sliceRef = useRef<T>(slice);
  sliceRef.current = slice;
  useEffect(() => {
    const listener = (s: EngineLiveState) => {
      const next = selectorRef.current(s);
      if (next !== sliceRef.current) setSlice(next);
    };
    _listeners.add(listener);
    // Resync — handles the race between mount and first emit.
    listener(_cached);
    return () => { _listeners.delete(listener); };
  }, []);
  return slice;
}

// rAF-coalesced live emit (May 2026 perf). Even with the engine's
// 20 Hz bucket cap, a busy network can queue multiple liveParams
// messages between two React render passes. Without coalescing, each
// triggers its own setState wave through every live subscriber. Here
// we accumulate into `_pendingLive` and flush once per frame via
// rAF / setImmediate — so multiple incoming messages collapse into a
// single setState per consumer per frame, with no perceptual loss
// (meters can't paint faster than the device's frame rate anyway).
let _pendingLive: LiveParams | null = null;
let _flushScheduled = false;
const _scheduleFlush: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(() => cb())
    : (cb) => setTimeout(cb, 16);

function _flushLive() {
  _flushScheduled = false;
  const next = _pendingLive;
  _pendingLive = null;
  if (next === null) return;
  _liveCached = next;
  _cached = { ..._cached, liveParams: next };
  _liveListeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // A buggy subscriber must never break the audio meter pipeline.
    }
  });
}

function _emitLive(next: LiveParams | null) {
  _pendingLive = next;
  if (_flushScheduled) return;
  _flushScheduled = true;
  _scheduleFlush(_flushLive);
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
    // marsin_engine/lib/api_server.js. Post-channel-split the deck
    // channel is NOT included here; it arrives on its own `deck`
    // event below.
    const rawChannels = (msg.channels as MixerChannel[] | undefined) ?? [];
    const blackout = msg.blackout === true;
    const master = typeof msg.master === 'number' ? msg.master : _cached.master;
    _emit({
      ..._cached,
      mixerChannels: rawChannels,
      blackout,
      master,
    });
  } else if (msg.type === 'deck') {
    // Singleton deck channel — counterpart to the mixer broadcast.
    // The engine fires this whenever deck state changes (and
    // back-to-back with the mixer event after any saveAllState).
    const rawDeck = (msg.channel as MixerChannel | null | undefined) ?? null;
    const blackout = msg.blackout === true;
    const master = typeof msg.master === 'number' ? msg.master : _cached.master;
    _emit({
      ..._cached,
      deckChannel: rawDeck,
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
    //
    // Engine commit 5d830d6 added two coded error states (cross-machine
    // mic-not-found guard) — we widen the payload here so the AUDIO tab
    // can surface a fix-it banner. Unknown / legacy payloads with no
    // missingDevice / availableDevices / enumerationError just leave
    // those fields undefined.
    const rawMsg = msg as unknown as Record<string, unknown>;
    const missingRaw = rawMsg.missingDevice as Record<string, unknown> | undefined;
    const enumErrRaw = rawMsg.enumerationError as Record<string, unknown> | undefined;
    const availableRaw = rawMsg.availableDevices;
    // Strict-ish device shape coercion — drop entries missing the keys
    // MicPickerRow expects so a broken engine payload can't render a
    // half-empty picker row (Codex P0: malformed devices must not
    // silently surface). Anything that's missing id/label/inputFormat/
    // ffmpegDevice/platform is filtered out; consumers can compare the
    // filtered length to availableRaw.length to detect schema drift.
    const availableDevices: AudioStatusDevice[] | undefined = Array.isArray(availableRaw)
      ? (availableRaw as Array<Record<string, unknown>>)
          .filter((d) =>
            d && typeof d === 'object' &&
            typeof d.id === 'string' && typeof d.label === 'string' &&
            typeof d.platform === 'string' && typeof d.inputFormat === 'string' &&
            typeof d.ffmpegDevice === 'string'
          )
          .map((d) => ({
            id:           d.id as string,
            label:        d.label as string,
            platform:     d.platform as string,
            inputFormat:  d.inputFormat as string,
            ffmpegDevice: d.ffmpegDevice as string,
            isDefault:        typeof d.isDefault === 'boolean' ? d.isDefault : undefined,
            alternativeName:  typeof d.alternativeName === 'string' ? d.alternativeName : undefined,
          }))
      : undefined;
    const missingDevice: AudioStatusMissingDevice | undefined = missingRaw
      ? {
          device:      (missingRaw.device      as string | null | undefined) ?? null,
          deviceLabel: (missingRaw.deviceLabel as string | null | undefined) ?? null,
          deviceId:    (missingRaw.deviceId    as string | null | undefined) ?? null,
          platform:    (missingRaw.platform    as string | null | undefined) ?? null,
        }
      : undefined;
    const enumerationError: AudioStatusEnumerationError | undefined = enumErrRaw
      ? {
          code:    typeof enumErrRaw.code === 'string' ? enumErrRaw.code : 'unknown',
          message: typeof enumErrRaw.message === 'string' ? enumErrRaw.message : '',
        }
      : undefined;
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
        missingDevice,
        availableDevices,
        enumerationError,
        platform:    typeof msg.platform    === 'string' ? msg.platform    : undefined,
        inputFormat: typeof msg.inputFormat === 'string' ? msg.inputFormat : undefined,
        lastKickMs: typeof msg.lastKickMs === 'number' ? msg.lastKickMs : 0,
      },
    });
  }
}

// Signals-bus subscription is SEPARATE from control/params init
// (May 2026 perf). The /ws/signals topic carries `liveParams` at
// ~20 Hz; subscribing pays JSON.parse + dispatch on every message,
// which on the iPad starves the audio.tsx / osc.tsx HTTP-fetch
// continuations and produces the ~30s tab-load hang. Only consumers
// that actually NEED live data (useLiveParamValues, and the deck
// BPM badge via the same hook) should pay this cost.
let _signalsInitialized = false;
function _ensureSignalsInitialized() {
  if (_signalsInitialized) return;
  _signalsInitialized = true;
  engineSignalsEvents.subscribe(_onMessage);
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Control plane: mixer, oscStats, audioStatus, and the ONE-SHOT
  // sharedParams warm-up the engine sends on /ws/control connect.
  engineEvents.subscribe(_onMessage);
  // Params plane (post-May-2026 topic split): the canonical CPC
  // updates (sharedParams) arrive here when operators turn knobs.
  // Without this subscribe sharedParams would be frozen at the
  // warm-up snapshot for the lifetime of the app.
  engineParamsEvents.subscribe(_onMessage);
  // NOTE: signals plane (/ws/signals → liveParams) is opened lazily
  // by _ensureSignalsInitialized() — see useLiveParamValues below.

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

  fetchDeckChannel()
    .then((r) => {
      if (!r.ok || !r.data) return;
      const data = r.data as { channel?: MixerChannel | null; blackout?: boolean; master?: number };
      _emit({
        ..._cached,
        deckChannel: data.channel ?? null,
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
 *
 * Performance contract (May 2026 perf pass — mirrors useLiveParamValues):
 *   The returned object is REFERENCE-STABLE across renders when the
 *   subscribed values (keys taken from the FIRST `defaults` object) are
 *   unchanged. So a sharedParams broadcast that only nudged `speed`
 *   doesn't re-render audio.tsx's three FaderRow children if they only
 *   subscribed to {bpmSpeedMin, bpmSpeedMax}. Only the keys actually
 *   listed in `defaults` participate in the equality check.
 */
export function useSharedParamValues<T extends Record<string, unknown>>(
  defaults: T,
): T {
  // Pin the keys this caller subscribes to. `defaults` is usually a
  // fresh object literal on each render; its key SET (not identity)
  // is what matters for our short-circuit.
  const keysRef = useRef<readonly string[] | null>(null);
  if (keysRef.current === null) keysRef.current = Object.keys(defaults);
  const keys = keysRef.current;
  const defaultsRef = useRef<T | null>(null);
  if (defaultsRef.current === null) defaultsRef.current = { ...defaults };

  return useEngineSlice<T>(useMemo(() => {
    // Stable per-caller closure: captures `keys` + `defaultsRef` once.
    // Returns the SAME `prev` reference when no subscribed key changed.
    let prev: T | null = null;
    return (s: EngineLiveState): T => {
      const src = s.sharedParams?.params;
      if (!src) return (prev ?? defaultsRef.current) as T;
      const prevR = prev as Record<string, unknown> | null;
      let changed = prevR === null;
      const next: Record<string, unknown> = {};
      for (const key of keys) {
        const slot = src[key];
        const v = slot && slot.value !== undefined
          ? slot.value
          : (defaultsRef.current as Record<string, unknown>)[key];
        next[key] = v;
        if (!changed && prevR![key] !== v) changed = true;
      }
      if (changed) prev = next as T;
      return prev as T;
    };
  }, []));
}

/**
 * Subscribe to the live audio-derived CPC subset. Returns the whole
 * LiveParams document, so every consumer re-renders on every
 * liveParams broadcast. PREFER `useLiveParamValues({ key: default })`
 * for everything except code that genuinely needs to walk all live
 * keys — `useLiveParamValues` short-circuits at the per-key level
 * and so an audio meter that only reads micLow doesn't re-render
 * when tempoBpm ticks.
 *
 * The deck and mixer CPCControls share the live bus via
 * useLiveParamValues, but the per-key short-circuit there means
 * neither pays the 15-30 Hz re-render cost when its own keys are
 * idle. Audio tab + deck + mixer all subscribe to ONE module-level
 * cache (a single WS connection + a single JSON.parse per tick), so
 * there is no duplicated WS bandwidth and no duplicated parse work.
 */
export function useLiveParams(): LiveParams | null {
  _ensureInitialized();
  _ensureSignalsInitialized();
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
 *
 * Performance contract (May 2026 operator optimisation):
 *   The returned object is REFERENCE-STABLE across renders when the
 *   subscribed values haven't changed. This lets downstream useMemo /
 *   React.memo short-circuit at the 15-30 Hz analyser cadence — only
 *   the keys the caller actually pulls (via `defaults`) participate
 *   in the equality check, so a meter strip that only reads micLow
 *   doesn't re-render when micHigh ticks. Without this, every
 *   subscriber re-rendered on every liveParams broadcast and the
 *   Audio tab + deck CPCControls + mixer CPCControls all did the
 *   same React reconciliation work for the same data.
 */
export function useLiveParamValues<T extends Record<string, unknown>>(
  defaults: T,
): T {
  _ensureInitialized();
  _ensureSignalsInitialized();
  // Pin the keys this caller subscribes to. `defaults` is usually a
  // fresh object literal on each render; its key SET, not identity,
  // is what matters for our short-circuit.
  const keysRef = useRef<readonly string[] | null>(null);
  if (keysRef.current === null) keysRef.current = Object.keys(defaults);
  const keys = keysRef.current;

  // Pin the defaults snapshot once for pre-load + per-key fallback.
  const defaultsRef = useRef<T | null>(null);
  if (defaultsRef.current === null) defaultsRef.current = { ...defaults };

  // Compute the current slice from the module-level cache. Returns the
  // SAME reference as `prev` when no subscribed key changed.
  const buildSlice = (prev: T | null): T => {
    const src = _liveCached?.params;
    if (!src) return prev || (defaultsRef.current as T);
    const prevR = prev as Record<string, unknown> | null;
    let changed = prevR === null;
    const next: Record<string, unknown> = {};
    for (const key of keys) {
      const slot = src[key];
      const v = slot && slot.value !== undefined ? slot.value : (defaultsRef.current as Record<string, unknown>)[key];
      next[key] = v;
      if (!changed && prevR![key] !== v) changed = true;
    }
    return (changed ? (next as T) : (prev as T));
  };

  const [slice, setSlice] = useState<T>(() => buildSlice(null));
  const sliceRef = useRef<T>(slice);
  sliceRef.current = slice;

  useEffect(() => {
    // Subscribe to the SHARED live bus. The listener computes a
    // per-key slice and only calls setSlice when one of THIS caller's
    // keys actually changed. The Audio tab + deck CPCControls + mixer
    // CPCControls all share one WS, one parse, one module-level
    // cache — and each component re-renders ONLY when its own keys
    // tick. A meter strip pulling only micLow doesn't re-render when
    // tempoBpm nudges, etc.
    const listener = () => {
      const next = buildSlice(sliceRef.current);
      if (next !== sliceRef.current) setSlice(next);
    };
    _liveListeners.add(listener);
    // Resync once — a tick that landed between mount and effect
    // would otherwise stay invisible until the NEXT broadcast.
    listener();
    return () => { _liveListeners.delete(listener); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return slice;
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
  // paramSchema is loaded once at boot and never mutates after — but
  // it's part of EngineLiveState, so without slicing we'd re-render
  // every GainRow on every mixer/oscStats/audioStatus event. Per-key
  // slice keeps us still after the initial schema load lands.
  const keyRef = useRef(key);
  keyRef.current = key;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  return useEngineSlice<[number, number]>(useMemo(() => {
    let prev: [number, number] | null = null;
    return (s: EngineLiveState): [number, number] => {
      const entry = s.paramSchema[keyRef.current];
      const range = entry && Array.isArray(entry.range) && entry.range.length === 2
        ? (entry.range as [number, number])
        : fallbackRef.current;
      if (prev && prev[0] === range[0] && prev[1] === range[1]) return prev;
      prev = range;
      return prev;
    };
  }, []));
}

export function useChannelExports(channelId: string | undefined): MixerChannelExport[] {
  // Per-channel-id slice: only re-renders when THIS channel's exports
  // array reference changes (engine emits a fresh array on every
  // mixer/deck broadcast, but only the strip that actually changed
  // gets re-rendered if the underlying channel object reference is
  // stable). Without this, every mixer broadcast re-rendered every
  // GlobalParams variant — including the deck base strip on the
  // mixer page even when only an overlay's fader nudged.
  const idRef = useRef(channelId);
  idRef.current = channelId;
  const EMPTY: MixerChannelExport[] = useMemo(() => [], []);
  return useEngineSlice<MixerChannelExport[]>(useMemo(() => {
    let prev: MixerChannelExport[] = EMPTY;
    return (s: EngineLiveState): MixerChannelExport[] => {
      const id = idRef.current;
      if (!id) return EMPTY;
      // Look up across both deck and mixer collections. The deck channel
      // is intentionally NOT in `mixerChannels` post-split, but consumers
      // that want "this channel's live exports" don't usually know or
      // care which role it plays — they just have an id.
      let next: MixerChannelExport[] | undefined;
      if (s.deckChannel && s.deckChannel.id === id) {
        next = s.deckChannel.exports ?? EMPTY;
      } else {
        const ch = s.mixerChannels.find((c) => c.id === id);
        next = ch?.exports ?? EMPTY;
      }
      if (next !== prev) prev = next;
      return prev;
    };
  }, [EMPTY]));
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
  // Per-slice subscription: only re-renders when the oscStats object
  // reference changes (engine emits it 1×/s, plus on lifecycle events).
  // The pill state derivation is a pure function of oscStats so we can
  // safely memoize it across emits that didn't touch this slice.
  return useEngineSlice<OscPillState | null>(useMemo(() => {
    let lastStats: OscStats | null = null;
    let lastResult: OscPillState | null = null;
    return (s: EngineLiveState): OscPillState | null => {
      const oscStats = s.oscStats;
      if (oscStats === lastStats) return lastResult;
      lastStats = oscStats;
      if (!oscStats) { lastResult = null; return lastResult; }
      if (!oscStats.enabled) {
        lastResult = { state: 'off', label: 'OFF', stats: oscStats };
        return lastResult;
      }
      const referenceTime = oscStats.now ?? Date.now();
      const stale = oscStats.lastSeenMs === 0
        ? true
        : referenceTime - oscStats.lastSeenMs > STALE_MS;
      if (oscStats.mappedMessagesPerSec > 0 || (!stale && oscStats.lastSeenMs > 0)) {
        lastResult = {
          state: 'live',
          label: oscStats.mappedMessagesPerSec > 0
            ? `${oscStats.mappedMessagesPerSec} msg/s`
            : 'live',
          stats: oscStats,
        };
        return lastResult;
      }
      if (oscStats.rxMessagesPerSec > 0) {
        lastResult = {
          state: 'unmapped',
          label: `RX ${oscStats.rxMessagesPerSec}, 0 mapped`,
          stats: oscStats,
        };
        return lastResult;
      }
      lastResult = {
        state: 'idle',
        label: stale ? 'IDLE' : 'WAITING',
        stats: oscStats,
      };
      return lastResult;
    };
  }, []));
}

/**
 * Selector for the mixer master fader (0..1). Reference-stable
 * per-key slice so DeckTopBar stays still through every mixer / vis
 * tick that didn't actually move the master.
 */
export function useMaster(): number {
  return useEngineSlice<number>((s) => s.master);
}

/**
 * Selector for the deck (PFL) channel. Reference-stable so GlobalParams
 * stays still on overlay-fader broadcasts that didn't touch the deck.
 */
export function useDeckChannel(): MixerChannel | null {
  return useEngineSlice<MixerChannel | null>((s) => s.deckChannel);
}

/**
 * Selector for the mic listener's live status (docs/25 §6.3).
 * Returns null until the first audioStatus broadcast arrives.
 *
 * Per-slice subscription (May 2026 perf pass): only re-renders when
 * the audioStatus object reference changes. The engine emits this at
 * 1 Hz plus on lifecycle events, so a calling component (audio.tsx)
 * is no longer redrawn by every mixer broadcast.
 */
export function useAudioStatus(): AudioStatus | null {
  return useEngineSlice<AudioStatus | null>((s) => s.audioStatus);
}

