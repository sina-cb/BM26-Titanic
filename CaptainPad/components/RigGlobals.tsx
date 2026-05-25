import React, { useState, createContext, useContext } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { setGlobalEffect, setGlobalBlackout, fetchGlobals } from '@/utils/api';
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

export const RigProvider = ({ children }: { children: React.ReactNode }) => {
  const [effects, setEffects] = useState<Record<string, boolean>>({});
  const [blackout, setBlackout] = useState(false);
  
  React.useEffect(() => {
    fetchGlobals().then(res => {
      if (res.ok && res.data) {
        if (res.data.effects) setEffects(res.data.effects);
        if (res.data.blackout !== undefined) setBlackout(res.data.blackout);
      }
    });

    // This provider mounts at the (tabs) layout level and stays alive
    // for the whole app session — unlike the per-tab WSes in
    // mixer.tsx / index.tsx which are torn down when you swipe to
    // another tab. So we use this WS to feed engineEvents (the bus
    // useEngineState / useLiveParams subscribe to) so the audio tab
    // and any other tab without its own socket still gets live updates
    // for sharedParams / liveParams / mixer / audioStatus / etc.
    let ws: WebSocket;
    import('@/utils/api').then(({ getApiBaseAsync }) => {
      getApiBaseAsync().then(apiBase => {
        const wsUrl = apiBase.replace(/^http/, 'ws');
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Fan-out first so the rest of the app stays warm regardless
            // of which tab is mounted.
            engineEvents.emit(data);
            if (data.type === 'mixer' && data.blackout !== undefined) {
              setBlackout(data.blackout);
            }
          } catch (e) {}
        };
      });
    });

    return () => {
      if (ws) ws.close();
    };
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
    setGlobalBlackout(nextState);
  };

  return <RigContext.Provider value={{ effects, blackout, toggleEffect, toggleBlackout }}>{children}</RigContext.Provider>;
};

const GlobalEffectButton = ({ effectId, label, activeDefault = false, disabled = false, variant }: { effectId: string, label: string, activeDefault?: boolean, disabled?: boolean, variant: 'deck' | 'mixer' }) => {
  const { effects, toggleEffect } = useContext(RigContext);
  const isOn = effects[effectId] !== undefined ? effects[effectId] : activeDefault;

  // Deck variant was compacted on 2026-05-25 so the deck-tab Rig
  // globals strip stops eating playlist real estate. Height dropped
  // from 50 → 34, ambientShadow removed (the shadow added ~16 px of
  // visual weight per row), font 13 → 11.
  const deckStyle = {
    flexBasis: '30%', flexGrow: 1, height: 34, borderRadius: 6, justifyContent: 'center', alignItems: 'center',
    backgroundColor: disabled ? 'transparent' : (isOn ? Colors.light.primary : Colors.light.surfaceContainerHigh),
    borderWidth: 1, borderColor: disabled ? Colors.light.ghostBorder : (isOn ? 'transparent' : Colors.light.ghostBorder),
  };

  const mixerStyle = {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, borderWidth: 1,
    backgroundColor: disabled ? 'transparent' : (isOn ? Colors.light.primary : Colors.light.surfaceContainerHigh),
    borderColor: disabled ? Colors.light.ghostBorder : (isOn ? Colors.light.primary : Colors.light.ghostBorder)
  };

  const style = variant === 'mixer' ? mixerStyle : deckStyle;

  return (
    <TouchableOpacity
      onPress={() => {
        if (disabled) return;
        toggleEffect(effectId, activeDefault);
      }}
      activeOpacity={disabled ? 1.0 : 0.7}
      style={style as any}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: disabled ? Colors.light.ghostBorder : (isOn ? '#FFF' : Colors.light.text), fontSize: variant === 'mixer' ? 11 : 11, textAlign: 'center', letterSpacing: 0.4 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const BlackoutButton = ({ variant }: { variant: 'deck' | 'mixer' }) => {
  const { blackout, toggleBlackout } = useContext(RigContext);

  const deckStyle = {
    flexBasis: '30%', flexGrow: 1, height: 34, borderRadius: 6, justifyContent: 'center', alignItems: 'center',
    backgroundColor: blackout ? Colors.light.error : Colors.light.surfaceContainerHigh,
    borderWidth: 1, borderColor: blackout ? 'transparent' : Colors.light.ghostBorder,
  };

  const mixerStyle = {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, borderWidth: 1,
    backgroundColor: blackout ? Colors.light.error : Colors.light.surfaceContainerHigh,
    borderColor: blackout ? Colors.light.error : Colors.light.ghostBorder
  };

  const style = variant === 'mixer' ? mixerStyle : deckStyle;

  return (
    <TouchableOpacity
      onPress={toggleBlackout}
      activeOpacity={0.7}
      style={style as any}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: blackout ? '#FFF' : Colors.light.text, fontSize: variant === 'mixer' ? 11 : 11, textAlign: 'center', letterSpacing: 0.4 }}>
        BLACKOUT
      </Text>
    </TouchableOpacity>
  );
};

export const RigGlobals = ({ variant = 'deck' }: { variant?: 'deck' | 'mixer' }) => {
  if (variant === 'mixer') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: Colors.light.secondary, marginRight: 16 }}>RIG CONTROLS</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <GlobalEffectButton variant="mixer" effectId="vintageWhite" label="VINTAGE WHT" />
          <GlobalEffectButton variant="mixer" effectId="blastWhite" label="BLAST WHT" />
          <GlobalEffectButton variant="mixer" effectId="uvBlast" label="UV BLAST" />
          <GlobalEffectButton variant="mixer" effectId="fogger" label="FOGGER" />
          <BlackoutButton variant="mixer" />
        </View>
      </View>
    );
  }

  // Compact deck strip — single header line (10pt) + a row of 34pt
  // pill buttons. The old layout had `globalStyles.headline` (20pt
  // text + 16pt marginBottom) and 50pt buttons with ambientShadow,
  // which together stole ~110 px of vertical space below the playlist
  // and left only 2 entries visible on an 11" iPad landscape. The
  // placeholder slot was dropped — it served no operator-visible
  // purpose and the row now flows cleanly without it.
  return (
    <View style={{ paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: Colors.light.ghostBorder }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: Colors.light.secondary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>
        RIG GLOBALS
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <GlobalEffectButton variant="deck" effectId="vintageWhite" label="VINTAGE WHT" />
        <GlobalEffectButton variant="deck" effectId="blastWhite" label="BLAST WHT" />
        <GlobalEffectButton variant="deck" effectId="uvBlast" label="UV BLAST" />
        <GlobalEffectButton variant="deck" effectId="fogger" label="FOGGER" />
        <BlackoutButton variant="deck" />
      </View>
      {/* New 2x3 performance grid for engine-side Global Effect Macros
          (docs/28). Rendered below the legacy rig globals so existing
          buttons stay where the operator expects them. */}
      <GlobalEffectMacros />
    </View>
  );
};
