import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { setSectionBrightness, setGlobalBlackout, fetchDimmers } from '@/utils/api';

export default function DimmerRackScreen() {
  const [isBlackout, setIsBlackout] = useState(false);
  const [dimmerStates, setDimmerStates] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchDimmers().then(states => {
      setDimmerStates(states || {});
    });
  }, []);
  
  const handleDimmerChange = (id: number, val: number) => {
    // API Call (Mocked for now, awaiting Engine Gap closure)
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
           onPress={() => {
             const next = !isBlackout;
             setIsBlackout(next);
             setGlobalBlackout(next);
           }} 
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

        <View style={[globalStyles.card, { alignSelf: 'stretch', flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', paddingBottom: 64, paddingTop: 32 }]}>
          
          <NauticalFader 
            id={1} 
            label="PAR WASH" 
            initialValue={dimmerStates['1'] ?? 1.0} 
            min={0} 
            max={1.0} 
            onChange={handleDimmerChange} 
          />
          
          <NauticalFader 
            id={2} 
            label="VINTAGE" 
            initialValue={dimmerStates['2'] ?? 1.0} 
            min={0} 
            max={1.0} 
            onChange={handleDimmerChange} 
          />
          
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
    </View>
  );
}
