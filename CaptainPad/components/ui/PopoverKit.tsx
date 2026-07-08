// PopoverKit — the tiny shared primitives the Modulation (◎) and MIDI-map (⊞)
// popovers both draw with. They were byte-identical copies in each file; the
// two surfaces are explicitly meant to read as a pair, so they share one kit.
//
// The only per-surface difference is the ACCENT colour (modulation green /
// primary blue vs MIDI violet), so `Chip` takes an `accent` prop and
// `SectionLabel` takes its accent as before.

import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { usePalette } from '@/hooks/use-theme';

// Section header — an accent dot + uppercase title + a hairline rule, so a
// popup reads as clear zones (SOURCE / MAPPING / TARGET, or CONTROL / RANGE).
export function SectionLabel({ accent, children }: { accent: string; children: React.ReactNode }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent }} />
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        {children}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.ghostBorder }} />
    </View>
  );
}

// A toggle/selector chip. `active` fills it with `accent`; the MIDI popover
// passes MIDI_VIOLET, the modulation popover passes C.primary / MOD_GREEN.
export function Chip({
  active, onPress, accent, children,
}: {
  active: boolean;
  onPress: () => void;
  accent: string;
  children: React.ReactNode;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
        backgroundColor: active ? accent : 'transparent',
        borderWidth: 1, borderColor: active ? accent : C.ghostBorder,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
        color: active ? '#fff' : C.text, letterSpacing: 0.5,
      }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}

// A numeric text input (range boxes). Same styling on both popovers.
export function NumberInput({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const C = usePalette();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.secondary}
      keyboardType="numbers-and-punctuation"
      style={{
        flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
        borderWidth: 1, borderColor: C.ghostBorder, color: C.text,
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12,
      }}
    />
  );
}
