import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getApiBase, setApiBase } from '@/utils/api';

// Native yaml parsing from our metro injection!
import defaultConfigs from '@/configs.yaml';

export default function ConfigScreen() {
  const [ip, setIp] = useState(getApiBase());
  const [saved, setSaved] = useState(false);

  // Sync to API state on mount
  useEffect(() => {
    setIp(getApiBase());
  }, []);

  const handleSave = async () => {
    await setApiBase(ip);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    setIp(defaultConfigs.api_base);
    await setApiBase(defaultConfigs.api_base);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={globalStyles.container}>
      <View style={{ padding: 48, flex: 1, alignItems: 'center' }}>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 48, gap: 16 }}>
           <IconSymbol name="gear" size={32} color={Colors.light.primary} />
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: Colors.light.text, letterSpacing: 2 }}>
             CONFIGURATION
           </Text>
        </View>

        <View style={[globalStyles.card, { alignSelf: 'stretch', alignItems: 'flex-start', padding: 32 }]}>
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: Colors.light.secondary, marginBottom: 16 }}>
             ENGINE API BASE URL
           </Text>
           
           <TextInput
             style={{
               width: '100%',
               backgroundColor: Colors.light.surfaceContainerLowest,
               color: Colors.light.text,
               height: 56,
               borderRadius: 12,
               paddingHorizontal: 16,
               fontFamily: 'Inter_400Regular',
               fontSize: 18,
               borderWidth: 1,
               borderColor: Colors.light.outlineVariant,
               marginBottom: 24
             }}
             value={ip}
             onChangeText={setIp}
             autoCapitalize="none"
             autoCorrect={false}
           />

           <View style={{ flexDirection: 'row', gap: 16 }}>
             <TouchableOpacity 
               onPress={handleSave}
               style={{
                 backgroundColor: Colors.light.primary,
                 paddingVertical: 16,
                 paddingHorizontal: 32,
                 borderRadius: 12,
                 ...globalStyles.ambientShadow
               }}
             >
               <Text style={{ color: 'white', fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16 }}>
                 {saved ? 'SAVED ✓' : 'SAVE CONFIG'}
               </Text>
             </TouchableOpacity>

             <TouchableOpacity 
               onPress={handleReset}
               style={{
                 backgroundColor: 'transparent',
                 borderWidth: 1,
                 borderColor: Colors.light.primary,
                 paddingVertical: 16,
                 paddingHorizontal: 32,
                 borderRadius: 12,
               }}
             >
               <Text style={{ color: Colors.light.primary, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16 }}>
                 RESET TO YAML
               </Text>
             </TouchableOpacity>
           </View>
        </View>

      </View>
    </View>
  );
}
