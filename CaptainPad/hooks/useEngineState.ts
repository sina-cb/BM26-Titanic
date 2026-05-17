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
import { fetchParamCenter, fetchMixerState } from '@/utils/api';

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

export interface EngineLiveState {
  sharedParams: SharedParams | null;
  mixerChannels: MixerChannel[];
  blackout: boolean;
}

const EMPTY_STATE: EngineLiveState = {
  sharedParams: null,
  mixerChannels: [],
  blackout: false,
};

let _cached: EngineLiveState = EMPTY_STATE;
const _listeners = new Set<(s: EngineLiveState) => void>();
let _initialized = false;

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
  } else if (msg.type === 'mixer') {
    // The mixer broadcast carries every channel's exports with live
    // v0/v1/v2 — see serializeMixerState() in
    // marsin_engine/lib/api_server.js. Forwarding the array as-is
    // lets the deck card's GlobalParams (variant="deck") and the
    // mixer tab's CPCControls share the same live source.
    const rawChannels = (msg.channels as MixerChannel[] | undefined) ?? [];
    const blackout = msg.blackout === true;
    _emit({
      ..._cached,
      mixerChannels: rawChannels,
      blackout,
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
    })
    .catch(() => undefined);

  fetchMixerState()
    .then((r) => {
      if (!r.ok || !r.data) return;
      const data = r.data as { channels?: MixerChannel[]; blackout?: boolean };
      _emit({
        ..._cached,
        mixerChannels: data.channels ?? [],
        blackout: data.blackout === true,
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
 * Convenience selector — returns the live exports for a specific
 * channel id. Used by GlobalParams in the mixer-base case where we
 * want a "base params" strip that mirrors the deck channel's exports
 * with every external writer (PortWatch local-exports, etc.) reflected
 * instantly.
 */
export function useChannelExports(channelId: string | undefined): MixerChannelExport[] {
  const { mixerChannels } = useEngineState();
  if (!channelId) return [];
  const ch = mixerChannels.find((c) => c.id === channelId);
  return ch?.exports ?? [];
}
