/**
 * RigGlobals — thin wrapper around the unified GlobalEffectMacros grid.
 *
 * Pre-May-2026 this file held a parallel set of buttons (vintageWhite,
 * blastWhite, uvBlast, fogger) plus a BLACKOUT toggle, rendered next to
 * the new engine-side GEM grid. Operator feedback ("two parallel UIs,
 * too much space, GEM stuck on Loading") drove a unification:
 *   - The four legacy effects became real Global Effect Macro slots
 *     (see marsin_engine/lib/global_effect_library.js).
 *   - The BLACKOUT button moved into GEM and routes through the new
 *     /global-effect-macros/blackout endpoint (proper e-stop).
 *   - This file now exposes the original `RigContext` surface so
 *     existing consumers (dimmer_rack BypassCheckbox / RESTORE RIG
 *     toggle) keep working, but the rendered <RigGlobals /> body is
 *     just the unified <GlobalEffectMacros /> grid.
 *
 * `RigContext` semantics preserved:
 *   - `effects[id]` is the live boolean state of an engine effect, kept
 *     in sync with WS broadcasts (`globalEffectMacroStatus` /
 *     `globalEffectSlots`) and seeded from /globals on mount.
 *   - `toggleEffect(id, def)` flips an effect via the legacy
 *     POST /global-effect route. Dimmer-bypass checkboxes in
 *     dimmer_rack.tsx still write to `vintageWhiteBypassDimmer` etc.
 *     this way — that contract is unchanged.
 *   - `toggleBlackout()` posts to the new e-stop route so the dimmer
 *     rack's RESTORE RIG / GLOBAL BLACKOUT button is a true e-stop too,
 *     not just a pixel dimmer.
 */
import React, { useState, createContext, useEffect } from 'react';
import { View } from 'react-native';
import { setGlobalEffect, fetchGlobals, setGlobalEffectBlackout } from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import { GlobalEffectMacros } from '@/components/GlobalEffectMacros';

interface RigState {
  effects: Record<string, boolean>;
  blackout: boolean;
  toggleEffect: (id: string, def: boolean) => void;
  toggleBlackout: () => void;
}

export const RigContext = createContext<RigState>({
  effects: {},
  blackout: false,
  toggleEffect: () => {},
  toggleBlackout: () => {},
});

// Exported so RigGlobals can fan a non-API-firing blackout setter
// out to the GEM component (it owns the API call itself).
export const _setBlackoutNoCall = { current: (_v: boolean) => {} };

export const RigProvider = ({ children }: { children: React.ReactNode }) => {
  const [effects, setEffects] = useState<Record<string, boolean>>({});
  const [blackout, setBlackout] = useState(false);
  // Park the raw setter so RigGlobals/GEM can sync the cached blackout
  // value WITHOUT triggering toggleBlackout() (which would re-fire
  // the API call already issued by GEM's button handler).
  _setBlackoutNoCall.current = setBlackout;

  useEffect(() => {
    let alive = true;
    fetchGlobals().then(res => {
      if (!alive || !res.ok || !res.data) return;
      if (res.data.effects) setEffects(res.data.effects);
      if (res.data.blackout !== undefined) setBlackout(res.data.blackout);
    });

    // This provider mounts at the (tabs) layout level and stays alive
    // for the whole app session — unlike the per-tab WSes in
    // mixer.tsx / index.tsx which are torn down when you swipe to
    // another tab. So we use this WS to feed engineEvents (the bus
    // useEngineState / useLiveParams subscribe to) so the audio tab
    // and any other tab without its own socket still gets live updates
    // for sharedParams / liveParams / mixer / audioStatus / etc.
    let ws: WebSocket | null = null;
    import('@/utils/api').then(({ getApiBaseAsync }) => {
      getApiBaseAsync().then(apiBase => {
        if (!alive) return;
        const wsUrl = apiBase.replace(/^http/, 'ws');
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            engineEvents.emit(data);
          } catch {}
        };
      });
    });

    const unsub = engineEvents.subscribe((data: any) => {
      if (!alive || !data) return;
      if (data.type === 'mixer' && data.blackout !== undefined) setBlackout(data.blackout);
      if (data.type === 'globalEffectMacroStatus' && typeof data.blackout === 'boolean') {
        setBlackout(data.blackout);
      }
      if (data.type === 'globalEffectMacroStatus' && data.controller) {
        // Mirror legacy-effect state into the RigContext so
        // dimmer_rack's bypass checkboxes pick up GEM-driven toggles.
        const c = data.controller;
        if (c.effects) setEffects(prev => ({ ...prev, ...c.effects }));
      }
    });

    return () => { alive = false; unsub(); if (ws) ws.close(); };
  }, []);

  const toggleEffect = (id: string, def: boolean) => {
    const currentState = effects[id] !== undefined ? effects[id] : def;
    const nextState = !currentState;
    setEffects(prev => ({ ...prev, [id]: nextState }));
    setGlobalEffect(id, nextState);
  };

  const toggleBlackout = () => {
    const nextState = !blackout;
    setBlackout(nextState);
    setGlobalEffectBlackout(nextState);
  };

  return <RigContext.Provider value={{ effects, blackout, toggleEffect, toggleBlackout }}>{children}</RigContext.Provider>;
};

/**
 * RigGlobals — the unified rig control surface for both the deck and
 * mixer tabs. Renders the engine-side GEM grid plus a compact BLACKOUT
 * e-stop. `variant` is preserved as an API for backwards-compat with
 * callers (mixer/deck) but currently both render the same grid; we
 * found no need for two layouts after the unification.
 */
export const RigGlobals = ({ variant: _variant = 'deck' }: { variant?: 'deck' | 'mixer' } = {}) => {
  // RigGlobals binds the unified GEM component to the RigContext's
  // blackout state so the dimmer rack's RESTORE RIG button and the
  // deck/mixer BLACKOUT button stay in lockstep (single source of
  // truth on the engine, mirrored via WS).
  return (
    <RigContextBridge>
      {({ blackout, setBlackout }) => (
        <View style={{ paddingTop: 6 }}>
          <GlobalEffectMacros
            blackout={blackout}
            onBlackoutChange={setBlackout}
          />
        </View>
      )}
    </RigContextBridge>
  );
};

const RigContextBridge: React.FC<{
  children: (args: { blackout: boolean; setBlackout: (v: boolean) => void }) => React.ReactElement;
}> = ({ children }) => {
  const ctx = React.useContext(RigContext);
  // Important: this setter must NOT re-fire the API call. GEM owns
  // the POST /global-effect-macros/blackout round trip; this setter
  // exists purely to keep the cached RigContext.blackout in sync
  // with the WS-derived value GEM hands us back.
  const setBlackout = (next: boolean) => _setBlackoutNoCall.current(next);
  return children({ blackout: ctx.blackout, setBlackout });
};
