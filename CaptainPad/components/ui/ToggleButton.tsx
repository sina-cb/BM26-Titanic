import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';

export const ToggleButton = ({ id, name, initialValue = 0, onChange }: { id: number, name: string, initialValue?: number, onChange: Function }) => {
  const [isOn, setIsOn] = useState(initialValue > 0.5);
  useEffect(() => { setIsOn(initialValue > 0.5) }, [initialValue]);
  
  return (
    <TouchableOpacity 
      onPress={() => { const next = !isOn; setIsOn(next); onChange(id, next ? 1.0 : 0.0); }}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isOn ? { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isOn ? '#fff' : Colors.light.text, textAlign: 'center' }}>
        {name.replace(/^(slider|toggle|trigger|hsvPicker)/i, '').replace(/([A-Z])/g, ' $1').trim().toUpperCase().substring(0, 15)}
      </Text>
    </TouchableOpacity>
  );
};

export const MomentaryButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const [isPressed, setIsPressed] = useState(false);
  
  return (
    <TouchableOpacity 
      onPressIn={() => { setIsPressed(true); onChange(id, 1.0); }}
      onPressOut={() => { setIsPressed(false); onChange(id, 0.0); }}
      activeOpacity={1}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isPressed ? { backgroundColor: Colors.light.error, borderColor: Colors.light.error } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isPressed ? '#fff' : Colors.light.text, textAlign: 'center' }}>
        {name.replace(/^(slider|toggle|trigger|hsvPicker)/i, '').replace(/([A-Z])/g, ' $1').trim().toUpperCase().substring(0, 15)}
      </Text>
    </TouchableOpacity>
  );
};
