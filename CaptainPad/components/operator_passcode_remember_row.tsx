import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export interface OperatorPasscodeRememberRowProps {
  checked: boolean;
  /** Ref-backed toggle from the parent — never `!checked` here (render lags). */
  onToggle: () => void;
  disabled?: boolean;
}

export function OperatorPasscodeRememberRow({
  checked,
  onToggle,
  disabled = false,
}: OperatorPasscodeRememberRowProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel="Remember for 30 minutes"
    >
      <IconSymbol
        name={checked ? 'checkmark.circle.fill' : 'circle'}
        size={22}
        color={checked ? C.primary : C.secondary}
      />
      <View style={styles.copy}>
        <Text style={styles.title}>Remember for 30 minutes</Text>
        <Text style={styles.hint}>Stores only an opaque token on this CaptainPad.</Text>
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(C: Palette) {
  return {
    row: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: 10,
      marginBottom: 14,
    },
    copy: {
      flex: 1,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.3,
      color: C.text,
    },
    hint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: C.secondary,
      marginTop: 2,
    },
  };
}
