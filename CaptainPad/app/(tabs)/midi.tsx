// MIDI tab — dedicated surface for direct MIDI controller status + mapping
// (sibling of Config / OSC / Audio). v1 is read-only status + a live event
// monitor; the per-tab mapping editor is a follow-up. The 🎹 APC header chip
// navigates here when a controller is connected.

import React from 'react';
import { View, Text, ScrollView } from 'react-native';

import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { MidiConfigSection } from '@/components/MidiConfigSection';

export default function MidiScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();

  return (
    <View style={globalStyles.container}>
      <ScrollView contentContainerStyle={{ padding: 48, alignItems: 'center' }} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32, gap: 16 }}>
          <IconSymbol name="metronome" size={32} color={C.primary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: C.text, letterSpacing: 2 }}>
            MIDI
          </Text>
        </View>

        <MidiConfigSection />

        <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24 }]}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text, marginBottom: 8, letterSpacing: 1 }}>
            MAPPING
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, lineHeight: 19 }}>
            The controller maps differently per tab: a <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>Deck</Text> layout
            and a <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>Mixer</Text> layout switch automatically with the active
            tab. Mappings are authored as data in <Text style={{ color: C.text }}>CaptainPad/midi_profiles/*.yaml</Text> (one or more
            profiles per device). An on-device mapping editor is a follow-up — for now the layout is edited in the profile and the
            live state is shown above.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
