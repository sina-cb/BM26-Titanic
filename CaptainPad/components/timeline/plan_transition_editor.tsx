import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { DeckTransitionControls } from '@/components/DeckTransitionControls';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import type { DeckTransitionMode, PlanTransition } from '@/utils/timelineApi';

const DEFAULT_PLAN_TRANSITION: PlanTransition = {
  enabled: true,
  mode: 'trans_flash',
  durationMs: 2000,
  shuffle: false,
};

export function PlanTransitionEditor({
  value,
  disabled,
  onChange,
}: {
  value: PlanTransition | undefined;
  disabled?: boolean;
  onChange: (value: PlanTransition | undefined) => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const configured = value !== undefined;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PLAN TRANSITION</Text>
          <Text style={styles.title}>Between every Deck cue</Text>
          <Text style={styles.help}>
            Saved with this plan. It also runs when this plan is activated.
            Flash is the Old Deck → white → New Deck bridge.
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.toggle,
            configured && styles.toggleOn,
            disabled && styles.disabled,
          ]}
          onPress={() => onChange(configured ? undefined : DEFAULT_PLAN_TRANSITION)}
          disabled={disabled}
          accessibilityRole="switch"
          accessibilityState={{ checked: configured, disabled: !!disabled }}
          accessibilityLabel="Use one transition between every Deck cue in this plan"
        >
          <Text style={[styles.toggleText, configured && styles.toggleTextOn]}>
            {configured ? 'PLAN TX ON' : 'USE DECK DEFAULT'}
          </Text>
        </TouchableOpacity>
      </View>

      {value ? (
        <DeckTransitionControls
          bare
          enabled={value.enabled}
          mode={value.mode}
          durationMs={value.durationMs}
          shuffle={value.shuffle}
          onChange={(patch) => onChange({
            enabled: patch.enabled ?? value.enabled,
            mode: (patch.mode ?? value.mode) as DeckTransitionMode,
            durationMs: patch.durationMs ?? value.durationMs,
            shuffle: patch.shuffle ?? value.shuffle,
          })}
        />
      ) : (
        <Text style={styles.inactiveHelp}>
          This plan currently keeps each cue’s saved transition or the Deck’s standing setting.
        </Text>
      )}
    </View>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    wrap: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 12,
      backgroundColor: C.surfaceContainerLowest,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: 14,
      gap: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap',
    },
    headerCopy: { flex: 1, minWidth: 280 },
    eyebrow: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 1.1,
      color: C.primary,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
      color: C.text,
      marginTop: 3,
    },
    help: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 22,
      color: C.secondary,
      marginTop: 4,
    },
    toggle: {
      minHeight: 48,
      minWidth: 170,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleOn: { borderColor: C.primary, backgroundColor: C.primaryContainer },
    toggleText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.8,
      color: C.secondary,
    },
    toggleTextOn: { color: C.primary },
    inactiveHelp: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 21,
      color: C.secondary,
    },
    disabled: { opacity: 0.4 },
  });
}
