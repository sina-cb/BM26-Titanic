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
import { setGlobalEffect, fetchGlobals, setGlobalEffectBlackout, getApiBaseAsync } from '@/utils/api';
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

    // The singleton topic buses (engineEvents → /ws/control,
    // engineParamsEvents → /ws/params, engineVizEvents → /ws/viz)
    // auto-connect lazily on first subscribe and self-heal on close,
    // so we don't pre-init them here. We do nudge engineEvents into
    // discovering the API base early — the subscribe() below opens
    // /ws/control which calls getApiBaseAsync internally on first
    // open. Warm the resolver so that path is cached.
    getApiBaseAsync().catch(() => { /* swallow — bus will retry */ });

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

    return () => { alive = false; unsub(); };
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
 * e-stop.
 *
 * `variant` selects the layout:
 *   - 'deck'  → 2-row grid, 44 px buttons so slot labels fit cleanly
 *     in portrait (operator feedback May 2026).
 *   - 'mixer' → single-row full-width strip (52 px buttons), designed
 *     to be pinned to the bottom of the mixer surface where the
 *     operator's thumb naturally lands.
 */
export const RigGlobals = ({ variant = 'deck' }: { variant?: 'deck' | 'mixer' } = {}) => {
  // RigGlobals binds the unified GEM component to the RigContext's
  // blackout state so the dimmer rack's RESTORE RIG button and the
  // deck/mixer BLACKOUT button stay in lockstep (single source of
  // truth on the engine, mirrored via WS).
  const gemVariant = variant === 'mixer' ? 'mixer-strip' : 'deck';
  // CRITICAL: in mixer-strip mode the wrapper MUST be flex:1 so the
  // inner GEM (which is also flex:1) actually stretches to fill the
  // parent globalRigBar width. Without this the inner View collapses
  // to its intrinsic content width and the row floats left of the
  // viewport. Deck mode keeps the natural width — the deck right
  // column is already constrained.
  const isStrip = gemVariant === 'mixer-strip';
  return (
    <RigContextBridge>
      {({ blackout, setBlackout }) => (
        <View style={isStrip ? { flex: 1, paddingTop: 6 } : { paddingTop: 6 }}>
          <GlobalEffectMacros
            blackout={blackout}
            onBlackoutChange={setBlackout}
            variant={gemVariant}
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
  // Operator review May 2026 #15 — TOGGLE BUTTON FLICKER ROOT CAUSE.
  // Pre-fix this was a fresh closure on every render:
  //     const setBlackout = (next) => _setBlackoutNoCall.current(next);
  // GEM consumes onBlackoutChange in a useEffect dep array. Each
  // RigContext mutation (every blackout / effects WS event) re-rendered
  // the bridge, which handed GEM a NEW function reference, which tore
  // GEM's main useEffect down and re-fired its boot sequence —
  // `fetchGlobalEffectSlots()` first sets every slot to active:false
  // (because it's the base layout call without status), then refresh()
  // restores the real active flags. That two-step is exactly the
  // "off → on" flicker operators kept reporting. Memoising the
  // setter so it has a STABLE ref across renders kills the tear-
  // down loop entirely. The underlying setter still routes through
  // `_setBlackoutNoCall.current` which is mutated in place by
  // RigProvider, so we never end up with a stale closure.
  const setBlackout = React.useCallback((next: boolean) => {
    _setBlackoutNoCall.current(next);
  }, []);
  return children({ blackout: ctx.blackout, setBlackout });
};
