import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, AppState } from 'react-native';
import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { setSectionBrightness, setGlobalBlackout, fetchDimmers, fetchDimmerGroups } from '@/utils/api';
import { RigContext } from '@/components/RigGlobals';

const BypassCheckbox = ({ effectId, label }: { effectId: string, label: string }) => {
  const C = usePalette();
  const { effects, toggleEffect } = useContext(RigContext);
  const isOn = !!effects[effectId];
  return (
    <TouchableOpacity onPress={() => toggleEffect(effectId, false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: isOn ? C.primary : C.ghostBorder, backgroundColor: isOn ? C.primary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
        {isOn && <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
      </View>
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.secondary }}>{label}</Text>
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
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const { blackout: isBlackout, toggleBlackout } = useContext(RigContext);
  const [dimmerStates, setDimmerStates] = useState<Record<string, number>>({});
  const [groups, setGroups] = useState<Record<string, number>>({});
  // Tri-state: 'loading' on first attempt, 'ready' after any response
  // (success OR failure), 'error' when the engine is offline so the
  // operator gets a Retry button instead of a stuck spinner. Earlier
  // we used a plain boolean and forgot to flip it inside a try/finally,
  // which meant any rejected promise (e.g. engine offline at app boot)
  // left the rack permanently stuck on "Loading dimmer groups…".
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lastError, setLastError] = useState<string>('');

  const refreshGroups = useCallback(async () => {
    let okAny = false;
    let err = '';
    try {
      const [groupsResult, dimmersResult] = await Promise.all([
        fetchDimmerGroups(),
        fetchDimmers(),
      ]);
      if (groupsResult.ok && groupsResult.data) {
        setGroups(groupsResult.data);
        okAny = true;
      } else if (groupsResult.error) {
        err = groupsResult.error;
      }
      if (dimmersResult.ok && dimmersResult.data) {
        setDimmerStates(dimmersResult.data);
        okAny = true;
      } else if (dimmersResult.error && !err) {
        err = dimmersResult.error;
      }
    } catch (e: any) {
      // Belt-and-braces: api helpers already swallow errors, but if
      // anything ever throws here we must still flip out of 'loading'.
      err = e?.message || String(e);
    } finally {
      setLastError(err);
      setLoadState(okAny ? 'ready' : 'error');
    }
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

  // Build sectionId -> [groupNames] so we can flag faders that share a section.
  // Multiple group names mapping to the same sectionId is a real (if rare)
  // outcome of the engine's /dimmer-groups endpoint, which dedupes by group
  // name but not by section. Each such fader still controls its section, so we
  // render all of them and mark them as linked to their siblings.
  const sectionIdToNames: Record<number, string[]> = {};
  for (const [name, sectionId] of groupEntries) {
    if (!sectionIdToNames[sectionId]) sectionIdToNames[sectionId] = [];
    sectionIdToNames[sectionId].push(name);
  }

  return (
    <View style={[globalStyles.container, { padding: 32, flexDirection: 'column' }]}>
        
      {/* Header */}
      <View style={{ alignItems: 'center', marginBottom: 24, gap: 8 }}>
         <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
           <IconSymbol name="lightbulb.fill" size={36} color={C.primary} />
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: C.text, letterSpacing: 2 }}>
             DIMMER RACK
           </Text>
         </View>
         <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary, textAlign: 'center' }}>
           GLOBAL SECTION CONTROL AND PATTERN SCALING
         </Text>
      </View>
         
      {/* Global Blackout */}
      <TouchableOpacity 
         onPress={toggleBlackout} 
         style={{ 
           alignSelf: 'stretch',
           backgroundColor: isBlackout ? C.surfaceContainerHigh : C.error, 
           height: 64, 
           borderRadius: 16, 
           justifyContent: 'center', 
           alignItems: 'center', 
           marginBottom: 24,
           borderWidth: isBlackout ? 1 : 0,
           borderColor: isBlackout ? C.ghostBorder : 'transparent',
           ...globalStyles.ambientShadow 
         }}
      >
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: isBlackout ? C.text : '#FFF', letterSpacing: 2 }}>
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
        {loadState === 'loading' && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: C.secondary }}>
              Loading dimmer groups...
            </Text>
          </View>
        )}

        {loadState === 'error' && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 20, color: C.error }}>
              Engine offline
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, textAlign: 'center', opacity: 0.7, maxWidth: 400 }}>
              {lastError || 'Could not reach the engine to load dimmer groups.'}
            </Text>
            <TouchableOpacity
              onPress={() => { setLoadState('loading'); refreshGroups(); }}
              style={{ marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 12, letterSpacing: 1 }}>RETRY</Text>
            </TouchableOpacity>
          </View>
        )}

        {loadState === 'ready' && groupEntries.length === 0 && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 20, color: C.secondary }}>
              No Dimmer Groups Found
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary, textAlign: 'center', opacity: 0.7, maxWidth: 400 }}>
              Auto-patch your fixtures in the simulation to generate section groups, then re-export the model.
            </Text>
          </View>
        )}

        {loadState === 'ready' && groupEntries.length > 0 && (
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: 32 }}>
            {groupEntries.map(([name, sectionId]) => {
              const siblings = (sectionIdToNames[sectionId] || []).filter((n) => n !== name);
              const isLinked = siblings.length > 0;
              return (
                // Key by group name (always unique — it's the object key) instead
                // of sectionId. Multiple group-name aliases can legitimately point
                // at the same physical section in the model, which collides on
                // key={sectionId} and produces React duplicate-key warnings.
                <View
                  key={name}
                  style={{
                    alignItems: 'center',
                    paddingHorizontal: isLinked ? 12 : 0,
                    paddingVertical: isLinked ? 8 : 0,
                    borderRadius: isLinked ? 12 : 0,
                    borderWidth: isLinked ? 1 : 0,
                    borderColor: isLinked ? C.primary : 'transparent',
                    borderStyle: 'dashed',
                    backgroundColor: isLinked ? C.surfaceContainerHigh : 'transparent',
                  }}
                >
                  <NauticalFader
                    id={sectionId}
                    label={groupLabel(name)}
                    initialValue={dimmerStates[String(sectionId)] ?? 1.0}
                    min={0}
                    max={1.0}
                    onChange={handleDimmerChange}
                  />
                  {isLinked && (
                    <View style={{ marginTop: 8, alignItems: 'center', maxWidth: 140 }}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.primary, letterSpacing: 1 }}>
                        {`\u{1F517} SHARES SECTION ${sectionId}`}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={{ marginTop: 2, fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, textAlign: 'center', opacity: 0.85 }}
                      >
                        {siblings.map(groupLabel).join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

    </View>
  );
}
