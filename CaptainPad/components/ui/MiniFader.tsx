import React from 'react';
import { View, Text } from 'react-native';
import { Colors } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';

const C = Colors.light;

type MiniFaderProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Optional fill colour for the bar — used to badge "auto-driven" state (e.g. BPM sync). */
  fillColor?: string;
  /** Optional tag rendered to the right of the value, e.g. "BPM". */
  badge?: string;
  /** When true, render at reduced opacity and drop all touch handlers.
   *  Used to surface CPC-matched local exports — the operator can see
   *  what each pattern declares, but the slider is non-interactive
   *  because the next CPC tick would clobber any write anyway. */
  disabled?: boolean;
};

export const MiniFader = ({ label, value, onChange, fillColor, badge, disabled }: MiniFaderProps) => {
  const bar = fillColor || (disabled ? C.secondary : C.primaryFixedDim);
  return (
    <View style={{ marginBottom: 6, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase' }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {badge ? (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: bar, textTransform: 'uppercase', letterSpacing: 0.5 }}>{badge}</Text>
          ) : null}
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>{Math.round(value * 100)}</Text>
        </View>
      </View>
      <HorizontalFader
        value={value}
        onChange={disabled ? (() => {}) : onChange}
        trackStyle={{ height: 16, backgroundColor: C.surfaceContainerHigh, borderRadius: 8, justifyContent: 'center' }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: bar, borderRadius: 8 }}
      />
    </View>
  );
};
