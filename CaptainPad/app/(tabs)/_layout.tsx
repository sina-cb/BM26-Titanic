import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
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
import { TimelineLeaseActivitySurface } from '@/components/timeline/timeline_lease_activity_surface';
import { TakeoverPasscodeHost } from '@/components/takeover_passcode_host';
import { OpDialogHost } from '@/components/op_dialog_host';
import { opError } from '@/utils/op_dialog';
import {
  LiveTouchCoordinatorProvider,
  LiveTouchHandoffOverlay,
  useLiveTouchCoordinator,
} from '@/components/live_touch_coordinator';
import { layerSettingForRoute } from '@/utils/layer_settings';
import { PerformanceModeControl } from '@/components/PerformanceModeControl';
import { EditSessionChip } from '@/components/edit_session_chip';
import { DeckGlobalStatus } from '@/components/ui/deck_global_status';
import { editSessionChip as editSessionChipModel } from '@/components/performance_mode_logic';
import { usePerformanceMode, usePerformanceModeReady } from '@/hooks/usePerformanceMode';
import { useSpatialFullscreen } from '@/hooks/use_spatial_fullscreen';
import {
  captainPadRailOrder,
  captainPadRailRouteName,
  captainPadTabOptions,
  CAPTAINPAD_DEFAULT_TAB,
  isCaptainPadRailTab,
  isCaptainPadTabVisible,
  performanceNavigationLocked as performanceNavigationLockedFor,
} from '@/utils/captainpad_tab_policy';

export const unstable_settings = {
  initialRouteName: CAPTAINPAD_DEFAULT_TAB,
};

function CustomSideBar({ state, descriptors, navigation }: any) {
  const palette = usePalette();
  const { requestHandoff } = useLiveTouchCoordinator();
  /* Live Touch's spatial performance surface owns the whole pad while it is
     open (docs/60 §4.5). The rail stands down — style/tree only; the Live
     Touch screen and its WebView never move. */
  const spatialFullscreen = useSpatialFullscreen();
  const {
    active: globalPerformanceActive,
    engineOffline,
    editPrincipal,
    authRequired,
  } = usePerformanceMode();
  const performanceModeReady = usePerformanceModeReady();
  const editSessionVisible = performanceModeReady
    && editSessionChipModel(editPrincipal, globalPerformanceActive, authRequired) !== null;
  /* ONE shared rule with performance_route_guard.tsx — see
     performanceNavigationLocked(). Offline it follows the presented face so the
     operator can always exit the lock and reach CONFIG (report `_283`). */
  const performanceNavigationLocked = performanceNavigationLockedFor({
    ready: performanceModeReady,
    active: globalPerformanceActive,
    engineOffline,
  });
  const currentRoute = state.routes[state.index];
  // Sub-view routes (STUDIO / MIDI / OSC — operator ruling 2026-08-15) are
  // real routes that are simply not drawn here; CONFIG lists them as cards.
  // While one is on screen its PARENT's pill stays lit, so the rail always
  // answers "where am I".
  const visibleRoutes = state.routes.filter((route: any) => (
    isCaptainPadRailTab(route.name)
    && isCaptainPadTabVisible(route.name, performanceNavigationLocked)
  )).sort((left: any, right: any) => (
    captainPadRailOrder(left.name) - captainPadRailOrder(right.name)
  ));
  const focusedRailRoute = currentRoute ? captainPadRailRouteName(currentRoute.name) : null;

  useEffect(() => {
    if (currentRoute && !isCaptainPadTabVisible(currentRoute.name, performanceNavigationLocked)) {
      navigation.navigate('index');
    }
  }, [currentRoute, navigation, performanceNavigationLocked]);

  if (spatialFullscreen) return null;

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
        {visibleRoutes.map((route: any, index: number) => {
           const { options } = descriptors[route.key];
           // A pill is lit either because it IS the current route, or because
           // the current route is one of its sub-views (CONFIG ← STUDIO /
           // MIDI / OSC). `isCurrentRoute` is the stricter of the two: tapping
           // a lit CONFIG while a sub-view is open must still navigate — it is
           // the operator's way back out of the sub-view.
           const isCurrentRoute = currentRoute?.key === route.key;
           const isFocused = focusedRailRoute === route.name;
           const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (isCurrentRoute || event.defaultPrevented) return;

              const currentRoute = state.routes[state.index];
              if (currentRoute?.name !== 'touch_control' || route.name === 'touch_control') {
                navigation.navigate(route.name);
                return;
              }

              const requestedLayer = layerSettingForRoute(route.name);
              if (requestedLayer !== 'deck' && requestedLayer !== 'mixer') {
                /* Browsing a non-Layers surface is intentionally passive:
                   Live keeps ownership until Deck/Mixer or ARM-off is chosen. */
                navigation.navigate(route.name);
                return;
              }
              void requestHandoff(requestedLayer)
                .then((completed) => {
                  if (completed) navigation.navigate(route.name);
                })
                .catch((error) => {
                  opError(
                    'Live Touch handoff failed',
                    error instanceof Error ? error.message : String(error),
                  );
                });
           };

          // Extract icon name from options custom field (we'll set it below)
          const iconName = options.tabBarIconName || 'house.fill';
          const groupTitle = options.tabBarGroup as string | undefined;
          const previousRoute = index > 0 ? visibleRoutes[index - 1] : null;
          const previousGroup = previousRoute
            ? descriptors[previousRoute.key].options.tabBarGroup
            : undefined;
          const showGroupTitle = !!groupTitle && groupTitle !== previousGroup;

          return (
            <React.Fragment key={route.key}>
              {showGroupTitle ? (
                <Text style={{
                  marginBottom: 6,
                  color: palette.secondary,
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 9,
                  letterSpacing: 1.2,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                }}>
                  {groupTitle}
                </Text>
              ) : null}
              <TouchableOpacity onPress={onPress} style={{
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
            </React.Fragment>
          )
        })}
      </ScrollView>
      <View style={{ width: 80, marginTop: 8, marginBottom: 8 }}>
        <Text style={{
          color: palette.secondary,
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 9,
          letterSpacing: 1.2,
          textAlign: 'center',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          Global mode
        </Text>
        <PerformanceModeControl isPortrait />
        {/* PERF owns row one. Row two is one persistent, auto-scrolling status
            viewport: the edit-session warning and every active Deck-global chip
            share it, so this rail can never grow past two rows total. */}
        <View style={{ marginTop: 8 }}>
          <DeckGlobalStatus
            maxRows={1}
            leadingKey="edit-session"
            leading={editSessionVisible ? <EditSessionChip /> : null}
          />
        </View>
      </View>
    </View>
  )
}

export default function TabLayout() {
  const palette = usePalette();
  /* Same fact as the rail's, one level up: while the Live Touch spatial
     surface is open the scene fills the pad edge to edge. A style change, so
     no screen is remounted (docs/60 §4.5). */
  const spatialFullscreen = useSpatialFullscreen();

  return (
    <RigProvider>
      <LiveTouchCoordinatorProvider>
        <TimelineLeaseActivitySurface>
          <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
        <Tabs
          initialRouteName={CAPTAINPAD_DEFAULT_TAB}
          // iOS Fabric + Reanimated 4.1 can recurse through a detached tab's
          // removal mutations and abort in LayoutAnimationsProxy. Keeping
          // inactive screens attached avoids that native deletion path while
          // preserving Expo Router/EAS as the sole source of the iOS project.
          detachInactiveScreens={false}
          tabBar={(props) => <CustomSideBar {...props} />}
          screenOptions={{
            headerShown: false,
            // Shifts the screens to the right of the sidebar — except while the
            // Live Touch spatial surface has the whole pad.
            sceneStyle: {
              flex: 1,
              minHeight: 0,
              marginLeft: spatialFullscreen ? 0 : 112,
              backgroundColor: palette.background,
            },
          }}>
          <Tabs.Screen
            name="timeline"
            options={captainPadTabOptions('timeline') as any}
          />
          {/* Default live controls. Layer settings share one transition
              router: Deck and Mixer take over on tab selection; Live Touch
              only takes over after ARM. */}
          <Tabs.Screen
            name="index"
            options={captainPadTabOptions('index') as any}
          />
          <Tabs.Screen
            name="mixer"
            options={captainPadTabOptions('mixer') as any}
          />
          <Tabs.Screen
            name="touch_control"
            options={captainPadTabOptions('touch_control') as any}
          />
          <Tabs.Screen
            name="audio"
            options={captainPadTabOptions('audio') as any}
          />
          {/* SPECIAL EVENTS (docs/52): staged one-button shows. It is still a
              PERFORMANCE surface and stays visible in performance mode
              alongside Timeline/Deck/Mixer/Live Touch. */}
          <Tabs.Screen
            name="special_events"
            options={captainPadTabOptions('special_events') as any}
          />
          <Tabs.Screen
            name="simulation"
            options={captainPadTabOptions('simulation') as any}
          />
          <Tabs.Screen
            name="scheduler"
            options={captainPadTabOptions('scheduler') as any}
          />
          <Tabs.Screen
            name="dimmer_rack"
            options={captainPadTabOptions('dimmer_rack') as any}
          />
          <Tabs.Screen
            name="studio"
            options={captainPadTabOptions('studio') as any}
          />
          <Tabs.Screen
            name="midi"
            options={captainPadTabOptions('midi') as any}
          />
          <Tabs.Screen
            name="bike_link"
            options={captainPadTabOptions('bike_link') as any}
          />
          <Tabs.Screen
            name="osc"
            options={captainPadTabOptions('osc') as any}
          />
          <Tabs.Screen
            name="config"
            options={captainPadTabOptions('config') as any}
          />
        </Tabs>
        {/* Sticky overlay; lives outside the Tabs so it survives tab
            switches and renders on top of every screen. The lockout
            overlay sits BELOW the banner (banner zIndex 1000, overlay
            zIndex 900) so the banner's "VIEW DECK" shortcut button
            stays tappable while everything else is curtained off. */}
        <EngineLockoutOverlay />
        <LiveTouchHandoffOverlay />
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
        {/* PER-ATTEMPT takeover passcode prompt (operator ruling 2026-08-14).
            Mounted ONCE, outside <Tabs>, because a takeover can be triggered
            from the deck, the mixer, the touch-control tab or the timeline
            EVENT sheet — and a Modal owned by a screen would unmount on a tab
            switch mid-prompt. Renders nothing until a takeover asks for it. */}
        <TakeoverPasscodeHost />
        {/* Operator notices + dialogs (operator ruling 2026-08-15 — "not like
            this regular HTML shit"). Mounted ONCE, outside <Tabs>, because a
            refusal usually lands while a request is still in flight and the
            operator has already moved on; a host owned by a screen would
            unmount mid-message. Renders nothing until something is raised.
            LAST in the tree so its Modal wins over the banners above. */}
        <OpDialogHost />
          </SafeAreaView>
        </TimelineLeaseActivitySurface>
      </LiveTouchCoordinatorProvider>
    </RigProvider>
  );
}
