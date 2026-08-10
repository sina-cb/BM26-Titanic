import { Tabs } from 'expo-router';
import React from 'react';
import { View, TouchableOpacity, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import { shadow } from '@/styles/globalStyles';
import { RigProvider } from '@/components/RigGlobals';
import { ViewOverrideBanner } from '@/components/ViewOverrideBanner';
import { EngineLockoutOverlay } from '@/components/EngineLockoutOverlay';
import { PendingProgramOverlay } from '@/components/timeline/PendingProgramOverlay';
import { ZoomBanner } from '@/components/timeline/ZoomBanner';

function CustomSideBar({ state, descriptors, navigation }: any) {
  const palette = usePalette();
  return (
    <View style={{
      width: 112,
      height: '100%',
      position: 'absolute',
      left: 0,
      top: 0,
      backgroundColor: palette.sidebarBackground,
      paddingVertical: 32,
      alignItems: 'center',
      zIndex: 50,
      boxShadow: shadow(10, 0, 30, palette.text, 0.03),
      elevation: 5,
    }}>
      <View style={{ marginBottom: 48, alignItems: 'center' }}>
        <IconSymbol name="house.fill" size={36} color={palette.text} />
        {/* Used house.fill since sailing isn't mapped, user can map later */}
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, marginTop: 8, color: palette.text }}>6969</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: palette.primaryFixedDim, textAlign: 'center', marginTop: 2 }}>CAPTAIN{'\n'}PAD</Text>
      </View>

      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
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
              backgroundColor: isFocused ? palette.sidebarActiveBackground : 'transparent',
              borderWidth: isFocused ? 1 : 0,
              borderColor: palette.sidebarActiveBorder,
            }}>
               <IconSymbol
                 name={iconName}
                 size={32}
                 color={isFocused ? palette.primaryFixedDim : palette.tabIconDefault}
               />
               <Text style={{
                 fontFamily: 'SpaceGrotesk_700Bold',
                 fontSize: 10,
                 marginTop: 8,
                 textTransform: 'uppercase',
                 color: isFocused ? palette.primaryFixedDim : palette.tabIconDefault
               }}>{options.title}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

export default function TabLayout() {
  const palette = usePalette();

  return (
    <RigProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
        <Tabs
          tabBar={(props) => <CustomSideBar {...props} />}
          screenOptions={{
            headerShown: false,
            sceneStyle: { marginLeft: 112, backgroundColor: palette.background }, // Shifts the screens to the right of the sidebar
          }}>
          {/* TOUCH CONTROL FIRST. It is the surface the operator drives the
              show from, so it should be the tab their thumb lands on, not the
              last one in the list. */}
          <Tabs.Screen
            name="touch_control"
            options={{
              title: 'Touch Control',
              tabBarIconName: 'square.grid.2x2',
            } as any}
          />
          <Tabs.Screen
            name="mixer"
            options={{
              title: 'Mixer',
              tabBarIconName: 'slider.horizontal.3',
            } as any}
          />
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
            name="audio"
            options={{
              title: 'Audio',
              tabBarIconName: 'waveform',
            } as any}
          />
          <Tabs.Screen
            name="osc"
            options={{
              title: 'OSC',
              tabBarIconName: 'antenna.radiowaves.left.and.right',
            } as any}
          />
          <Tabs.Screen
            name="timeline"
            options={{
              title: 'Timeline',
              tabBarIconName: 'sun.max',
            } as any}
          />
          <Tabs.Screen
            name="scheduler"
            options={{
              title: 'Scheduler',
              tabBarIconName: 'calendar.badge.clock',
            } as any}
          />
          <Tabs.Screen
            name="dimmer_rack"
            options={{
              title: 'Dimmer Rack',
              tabBarIconName: 'lightbulb.fill',
            } as any}
          />
          <Tabs.Screen
            name="midi"
            options={{
              title: 'MIDI',
              tabBarIconName: 'metronome',
            } as any}
          />
          <Tabs.Screen
            name="config"
            options={{
              title: 'Config',
              tabBarIconName: 'gear',
            } as any}
          />
          {/* Manual touch surface: colour pad + tempo/brightness/3D. Declared
              LAST so the existing rail order is untouched — this is exactly
              where the route already sat as an undeclared file route; the
              entry only supplies the label and icon it was missing.
              `tabBarIconName` MUST be a key of the MAPPING table in
              components/ui/icon-symbol.tsx: tsc resolves that import to the
              .ios.tsx variant (broad SF-Symbols union), so an unmapped name
              type-checks and then renders BLANK on web/Android. */}
        </Tabs>
        {/* Sticky overlay; lives outside the Tabs so it survives tab
            switches and renders on top of every screen. The lockout
            overlay sits BELOW the banner (banner zIndex 1000, overlay
            zIndex 900) so the banner's "VIEW DECK" shortcut button
            stays tappable while everything else is curtained off. */}
        <EngineLockoutOverlay />
        <ViewOverrideBanner />
        {/* Global, non-disruptive "scheduled show pending" strip. Lives
            outside <Tabs> so it floats over every tab; box-none lets taps
            fall through to the deck/mixer underneath (see component header). */}
        <PendingProgramOverlay />
        {/* EVENT ZOOM mode banner (green PERFORM / purple TIME TRAVEL). Also
            outside <Tabs> so it floats over every surface — while a zoom is
            held, "which clock is real" must be answerable from any tab. It
            carries the DEFERRED-show notice, so PendingProgramOverlay stands
            down under a zoom (see that component's zoom guard). */}
        <ZoomBanner />
      </SafeAreaView>
    </RigProvider>
  );
}
