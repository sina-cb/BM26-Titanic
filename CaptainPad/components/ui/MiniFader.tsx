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
};

export const MiniFader = ({ label, value, onChange, fillColor, badge }: MiniFaderProps) => {
  const bar = fillColor || C.primaryFixedDim;
  return (
    <View style={{ marginBottom: 6 }}>
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
        onChange={onChange}
        trackStyle={{ height: 16, backgroundColor: C.surfaceContainerHigh, borderRadius: 8, justifyContent: 'center' }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: bar, borderRadius: 8 }}
      />
    </View>
  );
};
