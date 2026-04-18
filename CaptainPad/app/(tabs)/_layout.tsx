import { Tabs } from 'expo-router';
import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

function CustomSideBar({ state, descriptors, navigation }: any) {
  return (
    <View style={{
      width: 112,
      height: '100%',
      position: 'absolute',
      left: 0,
      top: 0,
      backgroundColor: 'rgba(255,255,255,0.6)',
      paddingVertical: 32,
      alignItems: 'center',
      zIndex: 50,
      shadowColor: '#191c1d',
      shadowOffset: { width: 10, height: 0 },
      shadowOpacity: 0.03,
      shadowRadius: 30,
      elevation: 5,
    }}>
      <View style={{ marginBottom: 48, alignItems: 'center' }}>
        <IconSymbol name="house.fill" size={36} color="#191c1d" /> 
        {/* Used house.fill since sailing isn't mapped, user can map later */}
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, marginTop: 8 }}>6969</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: '#00daf3' }}>HELM</Text>
      </View>

      <View style={{ flex: 1, width: '100%', paddingHorizontal: 16 }}>
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const onPress = () => {
             const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
             if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          // Extract icon name from options custom field (we'll set it below)
          const iconName = options.tabBarIconName || 'house.fill';

          return (
            <TouchableOpacity key={route.key} onPress={onPress} style={{
              alignItems: 'center',
              paddingVertical: 16,
              marginBottom: 16,
              borderRadius: 16,
              backgroundColor: isFocused ? 'rgba(0, 229, 255, 0.1)' : 'transparent',
              borderWidth: isFocused ? 1 : 0,
              borderColor: 'rgba(0, 229, 255, 0.3)',
            }}>
               <IconSymbol 
                 name={iconName} 
                 size={32} 
                 color={isFocused ? '#00daf3' : '#bac9cc'} 
               />
               <Text style={{ 
                 fontFamily: 'SpaceGrotesk_700Bold', 
                 fontSize: 10, 
                 marginTop: 8,
                 textTransform: 'uppercase',
                 color: isFocused ? '#00daf3' : '#bac9cc' 
               }}>{options.title}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      tabBar={(props) => <CustomSideBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { marginLeft: 112 }, // Shifts the screens to the right of the sidebar
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Deck',
          // Custom prop for our sidebar to read:
          tabBarIconName: 'slider.vertical.3',
        } as any}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: 'Studio',
          tabBarIconName: 'curlybraces',
        } as any}
      />
      <Tabs.Screen
        name="monitor"
        options={{
          title: 'Monitor',
          tabBarIconName: 'desktopcomputer',
        } as any}
      />
      <Tabs.Screen
        name="shipment"
        options={{
          title: 'Shipment',
          tabBarIconName: 'shippingbox.fill',
        } as any}
      />
    </Tabs>
  );
}
