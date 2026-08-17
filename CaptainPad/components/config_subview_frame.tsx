// Frame for a surface that lives INSIDE another tab (operator ruling
// 2026-08-15: STUDIO / MIDI / OSC came off the sidebar rail and became
// CONFIG sub-views).
//
// Deliberately NAVIGATION-ONLY: the sub-view is still a real expo-router
// route, so its screen keeps the exact mount / focus / deep-link semantics it
// had as a rail tab (the header's MIDI chip still does router.push('/midi')).
// All this adds is the "‹ CONFIG" way back, because the rail no longer draws
// a pill you can tap to leave — the parent's pill is what stays lit while you
// are in here (see captainPadRailRouteName + the sidebar in app/(tabs)/_layout).

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router, type Href } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import {
  captainPadRouteHref,
  captainPadTabPolicy,
} from '@/utils/captainpad_tab_policy';

interface ConfigSubviewFrameProps {
  routeName: string;
  children: React.ReactNode;
}

export function ConfigSubviewFrame({ routeName, children }: ConfigSubviewFrameProps) {
  const C = usePalette();
  const policy = captainPadTabPolicy(routeName);
  const parentRoute = policy.parentRoute;
  // No fallback: a frame on an unparented route is a policy bug, not a
  // cosmetic one — the back button would have nowhere to go.
  if (!parentRoute) {
    throw new Error(`ConfigSubviewFrame used on non-sub-view route: ${routeName}`);
  }
  const parentPolicy = captainPadTabPolicy(parentRoute);
  const parentHref = captainPadRouteHref(parentRoute);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: C.ghostBorder,
        backgroundColor: C.surfaceContainerLow,
      }}>
        <TouchableOpacity
          onPress={() => router.navigate(parentHref as Href)}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${parentPolicy.title}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLowest,
          }}
        >
          <IconSymbol name="chevron.left" size={16} color={C.primary} />
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 12,
            color: C.primary,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}>
            {parentPolicy.title}
          </Text>
        </TouchableOpacity>

        <IconSymbol name={policy.tabBarIconName} size={18} color={C.secondary} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 12,
          color: C.secondary,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}>
          {policy.title}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        {children}
      </View>
    </View>
  );
}
