// 🎹 APC header chip — same visual language as the engine connection badge
// (DeckTopBar / mixer header). Colour encodes MIDI controller state:
//   grey  = no device / not available on this platform
//   green = a controller is connected
//   red   = error (tap to read the message)
//
// Reads the module store via useMidiStatus(); it does NOT drive the lifecycle
// (that's useMidiControl in RootShell), so it is safe to render anywhere.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { useMidiStatus, midiChipState } from '@/hooks/useMidiControl';

// '#00a86b' MOD_GREEN — matches the engine "CONNECTED" badge on both themes.
const MOD_GREEN = '#00a86b';

export function MidiStatusChip() {
  const palette = usePalette();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const state = useMidiStatus();
  const chip = midiChipState(state);

  const color =
    chip.kind === 'connected' ? MOD_GREEN
      : chip.kind === 'error' ? palette.error
        : palette.icon; // unavailable / disconnected → grey

  // Tap → open the MIDI tab (full status, monitor, mapping). Per Sina: when
  // connected, the chip jumps to the MIDI config tab; we do the same for the
  // other states since that tab is where the message/detail lives.
  const onPress = () => router.push('/midi');

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`MIDI ${chip.kind}${chip.message ? `: ${chip.message}` : ''} — open MIDI tab`}
      style={[styles.badge, isPortrait && { paddingHorizontal: 8, paddingVertical: 4 }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      {!isPortrait && (
        <Text style={[styles.label, { color }]}>🎹 APC</Text>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(C: Palette) {
  return {
    badge: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: 'uppercase' as const,
    },
  };
}
