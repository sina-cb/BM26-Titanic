import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { fetchPatterns, setActivePattern, sendControl, getApiBase, fetchExports, setGlobalEffect } from '@/utils/api';

const ToggleButton = ({ id, name, initialValue = 0, onChange }: { id: number, name: string, initialValue?: number, onChange: Function }) => {
  const [isOn, setIsOn] = useState(initialValue > 0.5);
  useEffect(() => { setIsOn(initialValue > 0.5) }, [initialValue]);
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

const GlobalEffectButton = ({ effectId, label, activeDefault = false, disabled = false }: { effectId: string, label: string, activeDefault?: boolean, disabled?: boolean }) => {
  const [isOn, setIsOn] = useState(activeDefault);
  return (
    <TouchableOpacity 
      onPress={() => { 
        if (disabled) return;
        const next = !isOn; 
        setIsOn(next); 
        setGlobalEffect(effectId, next); 
      }}
      activeOpacity={disabled ? 1.0 : 0.7}
      style={{
        flexBasis: '30%', flexGrow: 1, height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', 
        backgroundColor: disabled ? 'transparent' : (isOn ? Colors.light.primary : Colors.light.surfaceContainerHigh),
        borderWidth: 1, borderColor: disabled ? Colors.light.ghostBorder : (isOn ? 'transparent' : Colors.light.ghostBorder),
        ...(!disabled && globalStyles.ambientShadow)
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: disabled ? Colors.light.ghostBorder : (isOn ? '#FFF' : Colors.light.text), fontSize: 13, textAlign: 'center' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export default function ControlDeckScreen() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [active, setActive] = useState<string>('...');
  const [exports, setExports] = useState<any[]>([]);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [isScrollEnabled, setScrollEnabled] = useState<boolean>(true);

  useEffect(() => {
    fetchPatterns().then(data => {
      if (Array.isArray(data)) setPatterns(data);
    });

    const apiBaseStr = getApiBase();
    const engineHost = apiBaseStr.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const wsUrl = `ws://${engineHost}:${apiBaseStr.split(':').pop()}`;
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

  const handleSelectPattern = async (pattern: string) => {
    setActive(pattern);
    const res = await setActivePattern(pattern); 
    if (res && res.error) {
      setCompileError(res.error);
    } else {
      setCompileError(null);
      const freshExports = await fetchExports();
      if (freshExports) setExports(freshExports);
    }
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

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 32, paddingBottom: 32 }} style={{ flex: 1 }}>
          <View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {patterns.map((ptn) => {
                const isLive = ptn === active;
                return (
                  <TouchableOpacity 
                    key={ptn} 
                    onPress={() => handleSelectPattern(ptn)}
                    style={{ 
                       height: 48, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center',
                       backgroundColor: isLive ? Colors.light.primary : Colors.light.surfaceContainerHigh,
                       borderWidth: 1, borderColor: isLive ? 'transparent' : Colors.light.ghostBorder,
                       ...(isLive && globalStyles.ambientShadow),
                       flexGrow: 1
                    }}
                  >
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: isLive ? '#FFF' : Colors.light.text, textAlign: 'center' }}>
                       {ptn}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              {patterns.length === 0 && (
                <Text style={{color: Colors.light.secondary, fontStyle: 'italic'}}>No patterns loaded...</Text>
              )}
            </View>
          </View>
        </ScrollView>

        <TouchableOpacity onPress={() => fetchPatterns().then(setPatterns)} style={{ marginVertical: 16, padding: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: Colors.light.ghostBorder }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.primary, fontSize: 13 }}>REFRESH QUEUE</Text>
        </TouchableOpacity>

        <View style={{ paddingTop: 24, paddingBottom: 16, borderTopWidth: 1, borderTopColor: Colors.light.ghostBorder }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={globalStyles.headline}>Rig Globals</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <GlobalEffectButton effectId="vintageWhite" label="VINTAGE WHT" />
            <GlobalEffectButton effectId="fogger" label="FOGGER" />
            <GlobalEffectButton effectId="uvBlast" label="UV BLAST" />
            <GlobalEffectButton effectId="placeholder1" label="---" disabled={true} />
            <GlobalEffectButton effectId="placeholder2" label="---" disabled={true} />
            <GlobalEffectButton effectId="placeholder3" label="---" disabled={true} />
          </View>
        </View>
      </View>

      {/* Right Pane - Parameters & Macros */}
      <View style={[globalStyles.rightPane, { padding: 0 }]}>
        <ScrollView scrollEnabled={isScrollEnabled} contentContainerStyle={{ padding: 48, paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
        
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={globalStyles.headline}>Parameters</Text>
          <TouchableOpacity 
            onPress={async () => {
              if (active !== '...') {
                const res = await setActivePattern(active);
                if (res && res.error) {
                  setCompileError(res.error);
                } else {
                  setCompileError(null);
                  const freshExports = await fetchExports();
                  if (freshExports) setExports(freshExports);
                }
              }
            }} 
            style={{ padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <IconSymbol name="arrow.clockwise" size={20} color={Colors.light.primary} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.primary, fontSize: 12 }}>REFRESH</Text>
          </TouchableOpacity>
        </View>

        {compileError && (
          <View style={{ backgroundColor: 'rgba(255, 60, 60, 0.1)', borderColor: Colors.light.error, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
               <IconSymbol name="exclamationmark.triangle.fill" size={20} color={Colors.light.error} />
               <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.error }}>COMPILATION ERROR</Text>
             </View>
             <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.error, fontSize: 14 }}>
               {compileError}
             </Text>
          </View>
        )}

        {/* Top Section - Dynamic Faders */}
        <View style={[globalStyles.surfaceLow, globalStyles.ghostBorder, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', alignItems: 'flex-start', padding: 32, gap: 48 }]}>
          {sliders.map((e) => (
             <NauticalFader 
               key={`slider-${e.id}`} 
               id={e.id} 
               label={e.name.replace('slider', '').toUpperCase().substring(0, 8)} 
               initialValue={e.v0 ?? 0.5} 
               min={0} 
               max={1.0} 
               onChange={(id, val) => triggerControl(id, val)}
               onDragStart={() => setScrollEnabled(false)}
               onDragEnd={() => setScrollEnabled(true)}
             />
          ))}
          {colorPickers.map((e) => (
             <NauticalFader 
               key={`color-${e.id}`} 
               id={e.id} 
               label="HUE" 
               initialValue={e.v0 ?? 0.0} 
               min={0} 
               max={1.0} 
               isColor={true}
               onChange={(id, val) => triggerControl(id, val, 1.0, 1.0)}
               onDragStart={() => setScrollEnabled(false)}
               onDragEnd={() => setScrollEnabled(true)}
             />
          ))}
          {sliders.length === 0 && colorPickers.length === 0 && (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.secondary, alignSelf: 'center' }}>NO SLIDERS EXPORTED</Text>
          )}
        </View>

        {/* Dynamic Macro Grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 32, gap: 16 }}>
          {toggles.map((e) => (
            <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} initialValue={e.v0 ?? 0} onChange={triggerControl} />
          ))}
          {triggers.map((e) => (
            <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={triggerControl} />
          ))}
        </View>

        </ScrollView>
      </View>
    </View>
  );
}
