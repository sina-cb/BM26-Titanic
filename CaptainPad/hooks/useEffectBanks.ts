// useEffectBanks — shared, module-level subscription to the engine's ORDERED,
// NAMED effect banks. Both GlobalEffectMacros instances (the deck grid and the
// mixer strip) consume this ONE hook so they always agree, and there's a single
// REST seed / WS subscription instead of one per instance.
//
// NOTE (snake_case-law tension): the GoL convention is snake_case source files,
// but this hooks dir is uniformly camelCase (useMidiControl.ts,
// usePerformanceMode.ts, useControllerProfile.ts before this rename). A lone
// snake_case file here would be the odd one out and break sibling-consistency,
// so this rename keeps camelCase (useEffectBanks.ts) DELIBERATELY. Flagged for
// the operator — if the whole dir is ever migrated to snake_case, this goes with
// it.
//
// Same shape as usePerformanceMode's module-cache pattern: a module-level cached
// value + a Set of listeners, seeded from REST once and kept live by the
// `effectBanks` broadcast on the /ws/control bus. The engine's WS broadcast is
// authoritative — the UI never optimistically switches; it awaits the echo (the
// VSN1 sb_2 cycle POSTs and the badge/content switch only when the echo lands).
//
// Seeding: on first mount we fetch GET /global-effects/banks, and we re-seed on
// every control-bus (re)connect so a reconnect — or the operator pointing
// CaptainPad at a different engine — re-syncs the badge without waiting for the
// next broadcast. The value we hand out is always run through ensureAtLeastOneBank
// so consumers see >= 1 bank (a synthetic Default is surfaced, never hidden).

import { useEffect, useState } from 'react';
import { engineEvents } from '@/utils/engineEvents';
import { fetchEffectBanks } from '@/utils/api';
import {
  DEFAULT_EFFECT_BANKS_STATE,
  ensureAtLeastOneBank,
  reconcileEffectBanks,
  type EffectBanksState,
} from '@/components/global_effect_macros_logic';

let _cached: EffectBanksState = DEFAULT_EFFECT_BANKS_STATE;
const _listeners = new Set<(s: EffectBanksState) => void>();
let _initialized = false;

/** Structural equality for the bank state — the cache holds objects, so a
 *  reference compare would fire on every identical broadcast. Compare the active
 *  id + the ordered (id, name) list so a genuine no-op never churns subscribers. */
function _banksEqual(a: EffectBanksState, b: EffectBanksState): boolean {
  if (a.activeBankId !== b.activeBankId) return false;
  if (a.banks.length !== b.banks.length) return false;
  for (let i = 0; i < a.banks.length; i += 1) {
    if (a.banks[i].id !== b.banks[i].id || a.banks[i].name !== b.banks[i].name) return false;
  }
  return true;
}

function _emit(next: EffectBanksState) {
  if (_banksEqual(next, _cached)) return; // no-op guard
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
  fetchEffectBanks()
    .then((r) => {
      if (!r.ok || !r.data) return;
      _emit(ensureAtLeastOneBank({ banks: r.data.banks, activeBankId: r.data.activeBankId }));
    })
    .catch(() => undefined);
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Live updates: the engine broadcasts {type:'effectBanks', banks, activeBankId}
  // on any switch/create/delete/rename and replays it on every /ws/control connect.
  engineEvents.subscribe((msg) => {
    const next = reconcileEffectBanks(_cached, msg);
    if (next !== _cached) _emit(ensureAtLeastOneBank(next));
  });
  // REST seed now + on every control-bus (re)connect (the connect replay also
  // covers this, but the explicit fetch guarantees a seed even if the replay is
  // missed during the handshake race — same belt-and-braces as usePerformanceMode).
  engineEvents.subscribeStatus((s) => {
    if (s.connected) _seedFromRest();
  });
  _seedFromRest();
}

/** Subscribe to the shared, ordered, named effect banks (always >= 1). */
export function useEffectBanks(): EffectBanksState {
  _ensureInitialized();
  const [state, setState] = useState<EffectBanksState>(_cached);
  useEffect(() => {
    const listener = (s: EffectBanksState) => setState(s);
    _listeners.add(listener);
    // Resync — handles the race between mount and first emit.
    listener(_cached);
    return () => { _listeners.delete(listener); };
  }, []);
  return state;
}
