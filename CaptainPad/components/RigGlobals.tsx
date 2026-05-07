import React, { useState, createContext, useContext } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';
import { setGlobalEffect, setGlobalBlackout, fetchGlobals } from '@/utils/api';

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

    let ws: WebSocket;
    import('@/utils/api').then(({ getApiBaseAsync }) => {
      getApiBaseAsync().then(apiBase => {
        const wsUrl = apiBase.replace(/^http/, 'ws');
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
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
  
  const deckStyle = {
    flexBasis: '30%', flexGrow: 1, height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', 
    backgroundColor: disabled ? 'transparent' : (isOn ? Colors.light.primary : Colors.light.surfaceContainerHigh),
    borderWidth: 1, borderColor: disabled ? Colors.light.ghostBorder : (isOn ? 'transparent' : Colors.light.ghostBorder),
    ...(!disabled && globalStyles.ambientShadow)
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
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: disabled ? Colors.light.ghostBorder : (isOn ? '#FFF' : Colors.light.text), fontSize: variant === 'mixer' ? 11 : 13, textAlign: 'center' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const BlackoutButton = ({ variant }: { variant: 'deck' | 'mixer' }) => {
  const { blackout, toggleBlackout } = useContext(RigContext);
  
  const deckStyle = {
    flexBasis: '30%', flexGrow: 1, height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', 
    backgroundColor: blackout ? Colors.light.error : Colors.light.surfaceContainerHigh,
    borderWidth: 1, borderColor: blackout ? 'transparent' : Colors.light.ghostBorder,
    ...globalStyles.ambientShadow
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
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: blackout ? '#FFF' : Colors.light.text, fontSize: variant === 'mixer' ? 11 : 13, textAlign: 'center' }}>
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
          <GlobalEffectButton variant="mixer" effectId="fogger" label="FOGGER" />
          <GlobalEffectButton variant="mixer" effectId="uvBlast" label="UV BLAST" />
          <BlackoutButton variant="mixer" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 24, paddingBottom: 16, borderTopWidth: 1, borderTopColor: Colors.light.ghostBorder }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={globalStyles.headline}>Rig Globals</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <GlobalEffectButton variant="deck" effectId="vintageWhite" label="VINTAGE WHT" />
        <GlobalEffectButton variant="deck" effectId="fogger" label="FOGGER" />
        <GlobalEffectButton variant="deck" effectId="uvBlast" label="UV BLAST" />
        <BlackoutButton variant="deck" />
        <GlobalEffectButton variant="deck" effectId="placeholder1" label="---" disabled={true} />
        <GlobalEffectButton variant="deck" effectId="placeholder2" label="---" disabled={true} />
      </View>
    </View>
  );
};
