import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { fetchPatterns, setActivePattern, sendControl, API_BASE } from '@/utils/api';

const ToggleButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const [isOn, setIsOn] = useState(false);
  return (
    <TouchableOpacity 
      onPress={() => { const next = !isOn; setIsOn(next); onChange(id, next ? 1.0 : 0.0); }}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isOn ? { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isOn ? '#fff' : Colors.light.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

const MomentaryButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const [isPressed, setIsPressed] = useState(false);
  return (
    <TouchableOpacity 
      onPressIn={() => { setIsPressed(true); onChange(id, 1.0); }}
      onPressOut={() => { setIsPressed(false); onChange(id, 0.0); }}
      activeOpacity={1}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isPressed ? { backgroundColor: Colors.light.error, borderColor: Colors.light.error } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isPressed ? '#fff' : Colors.light.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

export default function ControlDeckScreen() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [active, setActive] = useState<string>('...');
  const [exports, setExports] = useState<any[]>([]);

  useEffect(() => {
    fetchPatterns().then(data => {
      if (Array.isArray(data)) setPatterns(data);
    });

    const engineHost = API_BASE.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const wsUrl = `ws://${engineHost}:${API_BASE.split(':').pop()}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pattern') {
            setActive(msg.name);
          } else if (msg.type === 'exports') {
            setExports(msg.data || []);
          }
        } catch {}
      };
    } catch {}

    return () => { if (ws) ws.close(); };
  }, []);

  const handleSelectPattern = (pattern: string) => {
    setActive(pattern);
    setActivePattern(pattern); 
  };

  const triggerControl = (id: number, v0: number, v1?: number, v2?: number) => {
    sendControl(id, v0, v1, v2);
  };

  const sliders = exports.filter(e => e.kind === 1);
  const toggles = exports.filter(e => e.kind === 2);
  const triggers = exports.filter(e => e.kind === 3);
  const colorPickers = exports.filter(e => e.kind === 6);

  return (
    <View style={globalStyles.container}>
      {/* Left Pane - Pattern Queue */}
      <View style={globalStyles.leftPane}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Text style={globalStyles.headline}>Pattern Queue</Text>
          <IconSymbol name="slider.vertical.3" size={24} color={Colors.light.secondary} />
        </View>

        <ScrollView contentContainerStyle={{ gap: 16 }}>
          {patterns.map((ptn) => {
            const isLive = ptn === active;
            return (
              <TouchableOpacity key={ptn} onPress={() => handleSelectPattern(ptn)}>
                <View style={[
                  globalStyles.card, 
                  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                  isLive ? { borderColor: Colors.light.primaryFixedDim, borderWidth: 2 } : {}
                ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isLive ? Colors.light.primaryFixedDim : 'transparent' }} />
                    <Text style={{ fontFamily: 'Inter_600SemiBold', color: isLive ? Colors.light.primary : Colors.light.text }}>
                      {ptn}
                    </Text>
                  </View>
                  {isLive ? (
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: Colors.light.primaryFixedDim }}>LIVE</Text>
                  ) : (
                    <IconSymbol name="chevron.right" size={20} color={Colors.light.icon} />
                  )}
                </View>
              </TouchableOpacity>
            )
          })}
          {patterns.length === 0 && (
            <Text style={{color: Colors.light.secondary, fontStyle: 'italic'}}>No patterns loaded...</Text>
          )}
        </ScrollView>

        <TouchableOpacity onPress={() => fetchPatterns().then(setPatterns)} style={{ marginTop: 32, padding: 16, alignItems: 'center', ...globalStyles.surfaceLowest, ...globalStyles.ambientShadow }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.primary }}>REFRESH QUEUE</Text>
        </TouchableOpacity>
      </View>

      {/* Right Pane - Parameters & Macros */}
      <View style={globalStyles.rightPane}>
        
        {/* Top Section - Dynamic Faders */}
        <View style={[globalStyles.surfaceLow, globalStyles.ghostBorder, { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', padding: 32 }]}>
          {sliders.map((e) => (
             <NauticalFader 
               key={`slider-${e.id}`} 
               id={e.id} 
               label={e.name.replace('slider', '').toUpperCase().substring(0, 8)} 
               initialValue={0.5} 
               min={0} 
               max={1.0} 
               onChange={(id, val) => triggerControl(id, val)}
             />
          ))}
          {colorPickers.map((e) => (
             <NauticalFader 
               key={`color-${e.id}`} 
               id={e.id} 
               label="HUE" 
               initialValue={0.0} 
               min={0} 
               max={1.0} 
               isColor={true}
               onChange={(id, val) => triggerControl(id, val, 1.0, 1.0)}
             />
          ))}
          {sliders.length === 0 && colorPickers.length === 0 && (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.secondary, alignSelf: 'center' }}>NO SLIDERS EXPORTED</Text>
          )}
        </View>

        {/* Dynamic Macro Grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 32, gap: 16 }}>
          {toggles.map((e) => (
            <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} onChange={triggerControl} />
          ))}
          {triggers.map((e) => (
            <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={triggerControl} />
          ))}
        </View>

        {/* Global Blackout - Hardcoded override logic */}
        <TouchableOpacity onPress={() => triggerControl(2, 0.0)} style={{ marginTop: 32, backgroundColor: Colors.light.error, height: 96, borderRadius: 16, justifyContent: 'center', alignItems: 'center', ...globalStyles.ambientShadow }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, color: '#FFF', letterSpacing: 2 }}>GLOBAL BLACKOUT</Text>
        </TouchableOpacity>

      </View>
    </View>
  );
}
