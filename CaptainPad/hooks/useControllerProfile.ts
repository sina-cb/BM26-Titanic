// useControllerProfile — shared, module-level subscription to the engine's VSN1
// CONTROLLER PROFILE ('edit' | 'play'). Both GlobalEffectMacros instances (the
// deck grid and the mixer strip) consume this ONE hook so they always agree and
// there's a single REST seed / WS subscription instead of one per instance.
//
// Same shape as usePerformanceMode's module-cache pattern: a module-level cached
// value + a Set of listeners, seeded from REST once and kept live by the
// `controllerProfile` broadcast on the /ws/control bus. The engine's WS broadcast
// is authoritative — the UI never optimistically flips; it awaits the echo (the
// VSN1 sb_2 toggle PATCHes and the grid switches only when the echo lands).
//
// Seeding: on first mount we fetch GET /global-effects/profile, and we re-seed on
// every control-bus (re)connect so a reconnect — or the operator pointing
// CaptainPad at a different engine — re-syncs the presentation without waiting for
// the next broadcast.

import { useEffect, useState } from 'react';
import { engineEvents } from '@/utils/engineEvents';
import { fetchControllerProfile } from '@/utils/api';
import {
  DEFAULT_CONTROLLER_PROFILE,
  reconcileControllerProfile,
  isControllerProfileMessage,
  type ControllerProfile,
} from '@/components/global_effect_macros_logic';

let _cached: ControllerProfile = DEFAULT_CONTROLLER_PROFILE;
const _listeners = new Set<(p: ControllerProfile) => void>();
let _initialized = false;

function _emit(next: ControllerProfile) {
  if (next === _cached) return; // reference-stable no-op guard
  _cached = next;
  _listeners.forEach((cb) => {
    try {
      cb(next);
    } catch {
      // A buggy subscriber must never break the broadcast pipeline.
    }
  });
}

function _seedFromRest() {
  fetchControllerProfile()
    .then((r) => {
      if (!r.ok || !r.data) return;
      _emit(reconcileControllerProfile(_cached, r.data.profile));
    })
    .catch(() => undefined);
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Live updates: the engine broadcasts {type:'controllerProfile', profile} on
  // change and replays it on every /ws/control connect.
  engineEvents.subscribe((msg) => {
    if (isControllerProfileMessage(msg)) {
      _emit(reconcileControllerProfile(_cached, msg.profile));
    }
  });
  // REST seed now + on every control-bus (re)connect (the connect replay also
  // covers this, but the explicit fetch guarantees a seed even if the replay is
  // missed during the handshake race — same belt-and-braces as usePerformanceMode).
  engineEvents.subscribeStatus((s) => {
    if (s.connected) _seedFromRest();
  });
  _seedFromRest();
}

/** Subscribe to the shared VSN1 controller profile ('edit' | 'play'). */
export function useControllerProfile(): ControllerProfile {
  _ensureInitialized();
  const [profile, setProfile] = useState<ControllerProfile>(_cached);
  useEffect(() => {
    const listener = (p: ControllerProfile) => setProfile(p);
    _listeners.add(listener);
    // Resync — handles the race between mount and first emit.
    listener(_cached);
    return () => { _listeners.delete(listener); };
  }, []);
  return profile;
}
