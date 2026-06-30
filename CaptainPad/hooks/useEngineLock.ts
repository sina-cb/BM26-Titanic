// useEngineLock — single source of truth for "who/what is driving the rig
// right now, and how hard is that lock?".
//
// Subscribes to the engine WebSocket events forwarded through
// engineEvents:
//
//   - `viewOverride` carries the canonical `controlLock` value
//     (engine-side: globalsState.controlLock). The contract is:
//
//        globalsState.controlLock ∈ { null, 'portwatch', 'plan' }
//
//     * 'portwatch' → a DEVICE (PortWatch) has seized the rig. This is a
//       FULL hard lockout: every UI in the building must refuse writes
//       until the owner releases (EngineLockoutOverlay curtains the app).
//     * 'plan'      → the PLAN (timeline program, not a device) is driving
//       the deck. This is a SOFTER lock: navigation/viewing stay fully
//       usable, but the controls that change WHAT IS PLAYING (deck pattern
//       selection, mixer activations) are disabled until the operator
//       takes over (the existing useOperatorTakeover path re-enables them).
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

/** Who/what owns the lock right now. */
export type LockKind = null | 'portwatch' | 'plan';

/** Legacy alias — the lock OWNER used to be the only concept; it is now
 *  the hard-lock owner specifically ('portwatch' or null). Kept so existing
 *  call-sites that read `owner` for the portwatch overlay copy keep working. */
export type LockOwner = null | 'portwatch';

interface LockState {
  /** What is driving the rig right now: a device, the plan, or nothing. */
  kind: LockKind;
  /** Who HARD-owns the lock right now (portwatch), or null. */
  owner: LockOwner;
  /** Convenience boolean — true ONLY for the portwatch HARD lock. The
   *  full-screen EngineLockoutOverlay keys off this, so a soft 'plan' lock
   *  never curtains the app. */
  locked: boolean;
  /** True for the SOFT 'plan' lock (yellow banner + disabled activation
   *  controls, navigation stays usable). */
  planLocked: boolean;
}

let _cached: LockState = { kind: null, owner: null, locked: false, planLocked: false };
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

function _normalizeKind(value: unknown): LockKind {
  if (value === 'portwatch') return 'portwatch';
  if (value === 'plan') return 'plan';
  return null;
}

function _stateFromKind(kind: LockKind): LockState {
  return {
    kind,
    // The hard-lock owner is ONLY the portwatch device; the plan is not an
    // "owner" in the curtain-the-app sense.
    owner: kind === 'portwatch' ? 'portwatch' : null,
    locked: kind === 'portwatch',
    planLocked: kind === 'plan',
  };
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
      // restarted yet (those predate 'plan', so this only ever yields
      // the hard portwatch lock).
      const kind = _normalizeKind(
        (msg.controlLock as unknown) ??
          (msg.override === 'deck' ? 'portwatch' : null),
      );
      _emit(_stateFromKind(kind));
    } else if (msg.type === 'globals') {
      // Reserved for the future "globals" broadcast (engine doesn't
      // currently emit one for controlLock alone, but adding here
      // ahead of time costs nothing and means a future server-side
      // refactor doesn't need a coordinated client release).
      _emit(_stateFromKind(_normalizeKind(msg.controlLock)));
    }
  });

  // 2. Seed from /globals once so the lock is honored on cold-boot
  //    even before the first WS broadcast lands. Failures are silent;
  //    the WS subscription will catch us up within a couple of seconds
  //    once the engine is reachable.
  fetchGlobals()
    .then((res) => {
      if (!res.ok || !res.data) return;
      const kind = _normalizeKind((res.data as Record<string, unknown>).controlLock);
      if (kind !== _cached.kind) {
        _emit(_stateFromKind(kind));
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
