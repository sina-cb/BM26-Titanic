import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, AppState } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { setSectionBrightness, setGlobalBlackout, fetchDimmers, fetchDimmerGroups } from '@/utils/api';
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

/** Convert group name to a human-readable label */
function groupLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toUpperCase();
}

export default function DimmerRackScreen() {
  const { blackout: isBlackout, toggleBlackout } = useContext(RigContext);
  const [dimmerStates, setDimmerStates] = useState<Record<string, number>>({});
  const [groups, setGroups] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);


  const refreshGroups = useCallback(async () => {
    const [groupsResult, dimmersResult] = await Promise.all([
      fetchDimmerGroups(),
      fetchDimmers(),
    ]);
    if (groupsResult.ok && groupsResult.data) setGroups(groupsResult.data);
    if (dimmersResult.ok && dimmersResult.data) setDimmerStates(dimmersResult.data);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refreshGroups();

    // Refresh when app/tab comes to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshGroups();
    });

    return () => sub.remove();
  }, [refreshGroups]);
  
  const handleDimmerChange = (id: number, val: number) => {
    setSectionBrightness(id, val);
  };

  const groupEntries = Object.entries(groups);

  return (
    <View style={[globalStyles.container, { padding: 32, flexDirection: 'column' }]}>
        
      {/* Header */}
      <View style={{ alignItems: 'center', marginBottom: 24, gap: 8 }}>
         <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
           <IconSymbol name="lightbulb.fill" size={36} color={Colors.light.primary} />
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: Colors.light.text, letterSpacing: 2 }}>
             DIMMER RACK
           </Text>
         </View>
         <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.light.secondary, textAlign: 'center' }}>
           GLOBAL SECTION CONTROL AND PATTERN SCALING
         </Text>
      </View>
         
      {/* Global Blackout */}
      <TouchableOpacity 
         onPress={toggleBlackout} 
         style={{ 
           alignSelf: 'stretch',
           backgroundColor: isBlackout ? Colors.light.surfaceContainerHigh : Colors.light.error, 
           height: 64, 
           borderRadius: 16, 
           justifyContent: 'center', 
           alignItems: 'center', 
           marginBottom: 24,
           borderWidth: isBlackout ? 1 : 0,
           borderColor: isBlackout ? Colors.light.ghostBorder : 'transparent',
           ...globalStyles.ambientShadow 
         }}
      >
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: isBlackout ? Colors.light.text : '#FFF', letterSpacing: 2 }}>
          {isBlackout ? 'RESTORE RIG' : 'GLOBAL BLACKOUT'}
        </Text>
      </TouchableOpacity>

      {/* Bypass Toggles */}
      <View style={{ flexDirection: 'row', gap: 32, marginBottom: 24, paddingHorizontal: 16 }}>
        <BypassCheckbox effectId="uvBlastBypassDimmer" label="UV BLAST BYPASS" />
        <BypassCheckbox effectId="vintageWhiteBypassDimmer" label="VINTAGE WHT BYPASS" />
        <BypassCheckbox effectId="blastWhiteBypassDimmer" label="BLAST WHT BYPASS" />
      </View>

      {/* Main Fader Area (Takes remaining space) */}
      <View style={[globalStyles.card, { flex: 1, padding: 32, justifyContent: 'center' }]}>
        {!loaded && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.light.secondary }}>
              Loading dimmer groups...
            </Text>
          </View>
        )}

        {loaded && groupEntries.length === 0 && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 20, color: Colors.light.secondary }}>
              No Dimmer Groups Found
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.light.secondary, textAlign: 'center', opacity: 0.7, maxWidth: 400 }}>
              Auto-patch your fixtures in the simulation to generate section groups, then re-export the model.
            </Text>
          </View>
        )}

        {loaded && groupEntries.length > 0 && (
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: 32 }}>
            {groupEntries.map(([name, sectionId]) => (
              <View key={sectionId} style={{ alignItems: 'center' }}>
                <NauticalFader 
                  id={sectionId} 
                  label={groupLabel(name)} 
                  initialValue={dimmerStates[String(sectionId)] ?? 1.0} 
                  min={0} 
                  max={1.0} 
                  onChange={handleDimmerChange} 
                />
              </View>
            ))}
          </View>
        )}
      </View>

    </View>
  );
}
