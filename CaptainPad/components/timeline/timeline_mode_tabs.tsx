import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import type { TimelineOperatorView } from '@/utils/timeline_operator_model';

const MODES: readonly { id: TimelineOperatorView; label: string }[] = [
  { id: 'live', label: 'LIVE' },
  { id: 'calendar', label: 'CALENDAR' },
  { id: 'travel', label: 'TIME TRAVEL' },
  { id: 'edit', label: 'EDIT PLAN' },
];

interface TimelineModeTabsProps {
  value: TimelineOperatorView;
  onChange: (next: TimelineOperatorView) => void;
  editDisabled?: boolean;
  travelDisabled?: boolean;
}

export function TimelineModeTabs({
  value,
  onChange,
  editDisabled = false,
  travelDisabled = false,
}: TimelineModeTabsProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  return (
    <View style={styles.shell} accessibilityRole="tablist">
      {MODES.map((mode) => {
        const selected = mode.id === value;
        const disabled = (mode.id === 'edit' && editDisabled)
          || (mode.id === 'travel' && travelDisabled);
        return (
          <TouchableOpacity
            key={mode.id}
            style={[
              styles.tab,
              selected && styles.tabSelected,
              disabled && styles.disabled,
            ]}
            onPress={() => onChange(mode.id)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={disabled
              ? `${mode.label}, unavailable while Performance Mode is live`
              : mode.label}
          >
            <Text
              style={[styles.label, selected && styles.labelSelected]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {mode.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    shell: {
      flexDirection: 'row' as const,
      alignSelf: 'center' as const,
      width: '100%' as const,
      maxWidth: 720,
      padding: 4,
      borderRadius: 14,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      gap: 4,
    },
    tab: {
      flex: 1,
      minHeight: 48,
      minWidth: 0,
      paddingHorizontal: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: 10,
    },
    tabSelected: {
      backgroundColor: C.primary,
    },
    label: {
      ...Type.timelineMeta,
      color: C.secondary,
      letterSpacing: 0.7,
      textAlign: 'center' as const,
    },
    labelSelected: {
      color: C.onPrimary,
    },
    disabled: {
      opacity: 0.38,
    },
  };
}
