import React from 'react';
import { View, Text } from 'react-native';
import { Colors } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';

const C = Colors.light;

export const MiniFader = ({ label, value, onChange }: {label: string, value: number, onChange: (v: number) => void}) => {
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>{Math.round(value * 100)}</Text>
      </View>
      <HorizontalFader 
        value={value} 
        onChange={onChange} 
        trackStyle={{ height: 16, backgroundColor: C.surfaceContainerHigh, borderRadius: 8, justifyContent: 'center' }} 
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 8 }} 
      />
    </View>
  );
};
