// 🎹 MIDI header chip — same visual language as the engine connection badge
// (DeckTopBar / mixer header). Colour encodes MIDI controller state:
//   grey  = no device / not available on this platform
//   green = one or more controllers connected
//   red   = error (tap to read the message)
//
// The label reads `🎹 MIDI` (not `🎹 APC`) — CaptainPad runs three profiles
// concurrently (APC mini mk2 + MIDI Fighter Twister + Intech VSN1) and a
// controller-specific label misleads the operator when THAT one is unplugged
// but the others are live. When more than one controller is connected we
// show the count so a glance tells you how many surfaces are up (`2/3`).
//
// Reads the module store via useMidiStatus(); it does NOT drive the lifecycle
// (that's useMidiControl in RootShell), so it is safe to render anywhere.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { usePalette } from '@/hooks/use-theme';
import { Palette, Radius, Type } from '@/constants/theme';
import { useMidiStatus, midiChipState } from '@/hooks/useMidiControl';
import { midiChipLabel } from '@/components/midi_chip_label';

// Re-export so the header-layout source-text test can find `midiChipLabel`
// in this file without a second import path.
export { midiChipLabel } from '@/components/midi_chip_label';

export function MidiStatusChip() {
  const palette = usePalette();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const state = useMidiStatus();
  const chip = midiChipState(state);
  const connectedCount = state.statuses.filter((s) => s.kind === 'connected').length;
  // Count only detected controllers. Configured-but-unplugged profiles are
  // intentionally absent from the UI; "MIDI 1/3" while only one physical
  // controller is present makes the healthy setup look incomplete.
  const totalCount = state.statuses.filter((s) => s.kind !== 'disconnected').length;
  const label = midiChipLabel(chip.kind, connectedCount, totalCount);

  // `tertiary` is the palette's "connected / auto-driven" green — the SAME
  // token the engine CONNECTED badge two chips to the left now wears (docs/54
  // §1.1 retires the old shared '#00a86b' literal). Keeping them on one token
  // is the point: two greens side by side in one toolbar was the drift.
  const color =
    chip.kind === 'connected' ? palette.tertiary
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
        <Text numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(C: Palette) {
  return {
    badge: {
      minHeight: 44,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: Radius.control,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: {
      ...Type.labelCaps,
      textTransform: Type.labelCaps.textTransform as 'uppercase',
    },
  };
}
