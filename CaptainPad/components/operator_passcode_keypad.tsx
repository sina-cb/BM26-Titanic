import React, { useMemo, useRef } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  OPERATOR_PASSCODE_CHARS,
  OPERATOR_PASSCODE_KEYPAD_INSTRUCTION,
  appendOperatorPasscodeChar,
  clearOperatorPasscode,
  deleteOperatorPasscodeChar,
  maskOperatorPasscode,
} from '@/utils/operator_passcode_keypad';

/** Big-thumb minimum for every touch target (well over the 44pt floor). */
const TOUCH_TARGET = 56;

export interface OperatorPasscodeKeypadProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function OperatorPasscodeKeypad({
  value,
  onChange,
  disabled = false,
}: OperatorPasscodeKeypadProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const masked = maskOperatorPasscode(value);
  const countLabel = value.length === 1 ? '1 character entered' : `${value.length} characters entered`;
  // Rapid key taps can land before the parent re-render feeds a fresh `value`
  // prop back down. Read through a ref (same stale-closure discipline as
  // HorizontalFader) so consecutive letter+digit taps accumulate faithfully.
  const valueRef = useRef(value);
  valueRef.current = value;

  const append = (char: string) => {
    if (disabled) return;
    const next = appendOperatorPasscodeChar(valueRef.current, char);
    valueRef.current = next;
    onChange(next);
  };

  const backspace = () => {
    if (disabled) return;
    const next = deleteOperatorPasscodeChar(valueRef.current);
    valueRef.current = next;
    onChange(next);
  };

  const clear = () => {
    if (disabled) return;
    valueRef.current = '';
    onChange(clearOperatorPasscode(valueRef.current));
  };

  return (
    <View style={styles.root}>
      <Text style={styles.instruction}>{OPERATOR_PASSCODE_KEYPAD_INSTRUCTION}</Text>
      <View
        style={styles.display}
        accessibilityRole="text"
        accessibilityLabel={
          value.length > 0
            ? `Operator passcode, ${countLabel}`
            : 'Operator passcode, empty'
        }
      >
        <Text style={[styles.displayText, !masked && styles.displayPlaceholder]}>
          {masked || 'Operator passcode'}
        </Text>
      </View>
      <View style={styles.grid}>
        {OPERATOR_PASSCODE_CHARS.map((char) => (
          <TouchableOpacity
            key={char}
            style={[styles.key, disabled && styles.keyDisabled]}
            onPress={() => append(char)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Enter character ${char}`}
            accessibilityState={{ disabled }}
          >
            <Text style={styles.keyLabel}>{char}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionButton, disabled && styles.keyDisabled]}
          onPress={backspace}
          disabled={disabled || value.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Delete last character"
          accessibilityState={{ disabled: disabled || value.length === 0 }}
        >
          <Text style={styles.actionLabel}>DELETE</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, disabled && styles.keyDisabled]}
          onPress={clear}
          disabled={disabled || value.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Clear passcode"
          accessibilityState={{ disabled: disabled || value.length === 0 }}
        >
          <Text style={styles.actionLabel}>CLEAR</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    root: {
      marginBottom: 16,
    },
    instruction: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: C.secondary,
      marginBottom: 10,
    },
    display: {
      minHeight: 64,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 18,
      justifyContent: 'center' as const,
      marginBottom: 14,
    },
    displayText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 22,
      letterSpacing: 4,
      color: C.text,
    },
    displayPlaceholder: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      letterSpacing: 0,
      color: C.secondary,
    },
    grid: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 8,
      justifyContent: 'center' as const,
      marginBottom: 10,
    },
    key: {
      width: '22%' as const,
      minWidth: 72,
      maxWidth: 96,
      minHeight: TOUCH_TARGET,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    keyDisabled: {
      opacity: 0.45,
    },
    keyLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 20,
      letterSpacing: 0.5,
      color: C.text,
    },
    actionRow: {
      flexDirection: 'row' as const,
      gap: 10,
    },
    actionButton: {
      flex: 1,
      minHeight: TOUCH_TARGET,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    actionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.5,
      color: C.text,
    },
  };
}
