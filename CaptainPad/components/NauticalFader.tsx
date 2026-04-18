import React, { useState, useRef, useEffect } from 'react';
import { View, Text, PanResponder, Animated } from 'react-native';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';

interface Props {
  id: number;
  label: string;
  initialValue?: number;
  min?: number;
  max?: number;
  suffix?: string;
  isColor?: boolean;
  onChange: (id: number, val: number) => void;
}

export function NauticalFader({ id, label, initialValue = 0, min = 0, max = 1, suffix = '', isColor = false, onChange }: Props) {
  const [value, setValue] = useState(initialValue);
  
  // Strict physical tracking bounds
  const trackHeight = 160; 
  const handleHeight = 48; 
  const maxTravel = trackHeight - handleHeight;

  const panY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ratio = (initialValue - min) / (max - min);
    panY.setValue(maxTravel * (1 - ratio));
  }, []);

  const lastSendTime = useRef(0);
  const updateEngine = (val: number, force: boolean = false) => {
    const now = Date.now();
    if (force || now - lastSendTime.current > 100) {
      onChange(id, val);
      lastSendTime.current = now;
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panY.extractOffset();
      },
      onPanResponderMove: (evt, gestureState) => {
        const currentOffset = (panY as any)._offset || 0;
        let newY = gestureState.dy;

        // Strict hard-stop clamping for the visual handle
        if (currentOffset + newY <= 0) {
          newY = -currentOffset; // Lock to top (max value)
        } else if (currentOffset + newY >= maxTravel) {
          newY = maxTravel - currentOffset; // Lock to bottom (min value)
        }

        panY.setValue(newY);

        const yOffset = currentOffset + newY;
        const ratio = 1 - (yOffset / maxTravel);
        const engineValue = min + ratio * (max - min);
        
        setValue(engineValue);
        updateEngine(engineValue);
      },
      onPanResponderRelease: () => {
        panY.flattenOffset();
        const finalY = (panY as any)._value;
        const ratio = 1 - (finalY / maxTravel);
        const engineValue = min + ratio * (max - min);
        setValue(engineValue);
        updateEngine(engineValue, true);
      },
    })
  ).current;

  return (
    <View style={{ alignItems: 'center', gap: 24, height: '100%', width: 80 }}>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: Colors.light.secondary }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: Colors.light.text }}>
          {value.toFixed(2)}{suffix}
        </Text>
      </View>
      
      {/* Track Background */}
      <View style={{ height: trackHeight, width: 32, backgroundColor: Colors.light.surfaceContainerHigh, borderRadius: 16, alignItems: 'center' }}>
        {/* The Track Canvas */}
        <View style={{ height: trackHeight, width: '100%', alignItems: 'center' }}>
          <Animated.View
            {...panResponder.panHandlers}
            style={{
              position: 'absolute',
              top: 0,
              width: 64,
              height: handleHeight,
              ...globalStyles.surfaceLowest,
              borderRadius: 12,
              justifyContent: 'center',
              alignItems: 'center',
              ...globalStyles.ambientShadow,
              transform: [{ translateY: panY }],
            }}
          >
            <View style={{ 
               width: isColor ? 48 : 32, 
               height: isColor ? 16 : 4, 
               backgroundColor: isColor ? `hsl(${Math.round(((value - min) / (max - min)) * 360)}, 100%, 50%)` : Colors.light.primaryFixedDim, 
               borderRadius: isColor ? 8 : 2 
            }} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
