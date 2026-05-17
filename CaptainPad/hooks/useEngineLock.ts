// useEngineLock — single source of truth for "is the rig locked by an
// external owner right now?".
//
// Subscribes to the engine WebSocket events forwarded through
// engineEvents:
//
//   - `viewOverride` carries the canonical `controlLock` value
//     (engine-side: globalsState.controlLock). When equal to
//     "portwatch", every UI in the building should refuse writes
//     until the owner releases.
//
// Why a hook (and not a context provider): the lock state is
// global and mutates rarely — a module-level subscription kept in
// useState gives us re-renders for free without restructuring
// _layout.tsx, and the hook can be dropped into any component that
// wants to gate interaction (the sidebar tabs, individual cards,
// etc.) without piping props.
//
// On boot we also fetch /globals once to seed the value before the
// first WS message lands; without that, a user opening CaptainPad
// while the override is already engaged would briefly see an
// interactive UI before the first broadcast pulls the curtain.

import { useEffect, useState } from 'react';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';
import { fetchGlobals } from '@/utils/api';

export type LockOwner = null | 'portwatch';

interface LockState {
  /** Who owns the lock right now, or null if free. */
  owner: LockOwner;
  /** Convenience boolean — true when any external owner is holding. */
  locked: boolean;
}

let _cached: LockState = { owner: null, locked: false };
const _listeners = new Set<(s: LockState) => void>();
let _initialized = false;

function _emit(next: LockState) {
  _cached = next;
  _listeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // A buggy subscriber must never break the broadcast pipeline.
    }
  });
}

function _normalizeOwner(value: unknown): LockOwner {
  return value === 'portwatch' ? 'portwatch' : null;
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // 1. Subscribe to live broadcasts. The deck/mixer tabs already
  //    forward every WS message through engineEvents, so we don't
  //    need our own socket.
  engineEvents.subscribe((msg: EngineMessage) => {
    if (msg.type === 'viewOverride') {
      // controlLock is the canonical field as of v2; fall back to
      // `override === 'deck'` for older engines that haven't been
      // restarted yet.
      const owner = _normalizeOwner(
        (msg.controlLock as unknown) ??
          (msg.override === 'deck' ? 'portwatch' : null),
      );
      _emit({ owner, locked: owner !== null });
    } else if (msg.type === 'globals') {
      // Reserved for the future "globals" broadcast (engine doesn't
      // currently emit one for controlLock alone, but adding here
      // ahead of time costs nothing and means a future server-side
      // refactor doesn't need a coordinated client release).
      const owner = _normalizeOwner(msg.controlLock);
      _emit({ owner, locked: owner !== null });
    }
  });

  // 2. Seed from /globals once so the lock is honored on cold-boot
  //    even before the first WS broadcast lands. Failures are silent;
  //    the WS subscription will catch us up within a couple of seconds
  //    once the engine is reachable.
  fetchGlobals()
    .then((res) => {
      if (!res.ok || !res.data) return;
      const owner = _normalizeOwner((res.data as Record<string, unknown>).controlLock);
      if (owner !== _cached.owner) {
        _emit({ owner, locked: owner !== null });
      }
    })
    .catch(() => undefined);
}

export function useEngineLock(): LockState {
  _ensureInitialized();
  const [state, setState] = useState<LockState>(_cached);
  useEffect(() => {
    _listeners.add(setState);
    // Resync to whatever's current right now in case we missed an
    // update between mount and effect run.
    setState(_cached);
    return () => {
      _listeners.delete(setState);
    };
  }, []);
  return state;
}
