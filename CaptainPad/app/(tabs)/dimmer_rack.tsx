import React, { useState, useEffect, useContext } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { setSectionBrightness, setGlobalBlackout, fetchDimmers } from '@/utils/api';
import { RigContext } from '@/components/RigGlobals';

const BypassCheckbox = ({ effectId, label }: { effectId: string, label: string }) => {
  const { effects, toggleEffect } = useContext(RigContext);
  const isOn = !!effects[effectId];
  return (
    <TouchableOpacity onPress={() => toggleEffect(effectId, false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: isOn ? Colors.light.primary : Colors.light.ghostBorder, backgroundColor: isOn ? Colors.light.primary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
        {isOn && <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
      </View>
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.light.secondary }}>{label}</Text>
    </TouchableOpacity>
  );
};

export default function DimmerRackScreen() {
  const { blackout: isBlackout, toggleBlackout } = useContext(RigContext);
  const [dimmerStates, setDimmerStates] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchDimmers().then(result => {
      if (result.ok && result.data) {
        setDimmerStates(result.data);
      }
      setLoaded(true);
    });
  }, []);
  
  const handleDimmerChange = (id: number, val: number) => {
    setSectionBrightness(id, val);
  };

  return (
    <View style={globalStyles.container}>
      <View style={{ padding: 48, flex: 1, alignItems: 'center' }}>
        
        <View style={{ alignItems: 'center', marginBottom: 48, gap: 16 }}>
           <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
             <IconSymbol name="lightbulb.fill" size={32} color={Colors.light.primary} />
             <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: Colors.light.text, letterSpacing: 2 }}>
               DIMMER RACK
             </Text>
           </View>
           <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.light.secondary, textAlign: 'center' }}>
             GLOBAL SECTION CONTROL AND PATTERN INTENSITY SCALING
           </Text>
        </View>

        <TouchableOpacity 
           onPress={toggleBlackout} 
           style={{ 
             alignSelf: 'stretch', 
             marginBottom: 24, 
             backgroundColor: isBlackout ? Colors.light.surfaceContainerHigh : Colors.light.error, 
             height: 96, 
             borderRadius: 16, 
             justifyContent: 'center', 
             alignItems: 'center', 
             borderWidth: isBlackout ? 1 : 0,
             borderColor: isBlackout ? Colors.light.ghostBorder : 'transparent',
             ...globalStyles.ambientShadow 
           }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, color: isBlackout ? Colors.light.text : '#FFF', letterSpacing: 2 }}>
            {isBlackout ? 'RESTORE RIG' : 'GLOBAL BLACKOUT'}
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, marginBottom: 32, justifyContent: 'center' }}>
          <BypassCheckbox effectId="uvBlastBypassDimmer" label="UV BLAST DIMMER BYPASS" />
          <BypassCheckbox effectId="vintageWhiteBypassDimmer" label="VINTAGE WHT DIMMER BYPASS" />
          <BypassCheckbox effectId="blastWhiteBypassDimmer" label="BLAST WHT DIMMER BYPASS" />
        </View>

        {loaded && (
          <View style={[globalStyles.card, { alignSelf: 'stretch', flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 64, paddingTop: 32 }]}>
            
            <View style={{ alignItems: 'center' }}>
              <NauticalFader 
                id={1} 
                label="PAR WASH" 
                initialValue={dimmerStates['1'] ?? 1.0} 
                min={0} 
                max={1.0} 
                onChange={handleDimmerChange} 
              />
            </View>
            
            <View style={{ alignItems: 'center' }}>
              <NauticalFader 
                id={2} 
                label="VINTAGE" 
                initialValue={dimmerStates['2'] ?? 1.0} 
                min={0} 
                max={1.0} 
                onChange={handleDimmerChange} 
              />
            </View>
            
            <View style={{ alignItems: 'center' }}>
              <NauticalFader 
                id={3} 
                label="SHEDH BARS" 
                initialValue={dimmerStates['3'] ?? 1.0} 
                min={0} 
                max={1.0} 
                onChange={handleDimmerChange} 
              />
            </View>
            
          </View>
        )}

      </View>
    </View>
  );
}
