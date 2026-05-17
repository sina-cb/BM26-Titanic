import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import { router, usePathname } from 'expo-router';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';

// ── ViewOverrideBanner ─────────────────────────────────────────────
// Sticky warning banner that lights up whenever PortWatch (or any
// other client) pins the engine's view to "deck" via the
// /mixer/view-override endpoint.
//
// Why this exists:
//   When PortWatch takes the deck override, the engine forces the
//   live mixer panel's targetViewFader to 0 regardless of what the
//   live operator does. Without a UI signal, that operator sees
//   their MIXER pixels disappear with no explanation — looks like
//   a bug. This banner makes the cause unmistakable AND auto-routes
//   the user to the Deck tab so they can see what PortWatch is
//   actually doing on the rig.
//
// Behaviour:
//   - Stays visible the entire time `override === "deck"`. Operators
//     can dismiss the auto-navigation but the banner remains as a
//     reminder.
//   - Auto-navigates to "/" (the Deck tab) ONCE per override-engage
//     edge. We deliberately don't keep navigating away from later
//     manual tab changes — that would turn the banner into a
//     hostage.
//   - When override clears (PortWatch released or some other client
//     POSTed `{override: null}`) the banner slides out and we don't
//     touch the user's current tab.
//
// Subscribing to `engineEvents` rather than owning a WS keeps this
// out of the data-fetching path; the deck/mixer tabs already pump
// every parsed message through that bus.
export const ViewOverrideBanner: React.FC = () => {
  const [override, setOverride] = useState<string | null>(null);
  const [savedView, setSavedView] = useState<string | null>(null);
  const wasActive = useRef(false);
  const pathname = usePathname();
  // 0 = hidden, 1 = fully visible. Spring-ish slide-in from the top.
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return engineEvents.subscribe((msg: EngineMessage) => {
      if (msg.type !== 'viewOverride') return;
      const next = (msg.override as string | null) ?? null;
      const sv = (msg.savedView as string | null) ?? null;
      setOverride(next);
      setSavedView(sv);
    });
  }, []);

  useEffect(() => {
    const isActive = override === 'deck';
    Animated.timing(slide, {
      toValue: isActive ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Edge: just engaged — auto-route to the Deck tab so the
    // operator sees what PortWatch is actually pushing. The
    // /(tabs)/index.tsx route IS the deck tab; navigating there
    // is a no-op when we're already on it.
    if (isActive && !wasActive.current) {
      // Don't yank the user away from Config or Studio in the middle
      // of a destructive task; only auto-route from mixer (the only
      // visual surface PortWatch actually steals from).
      if (pathname && (pathname === '/mixer' || pathname.endsWith('/mixer'))) {
        try {
          router.replace('/');
        } catch {
          // Router may not be ready during very early boot; the user
          // can still tap Deck in the sidebar. The banner stays up.
        }
      }
    }
    wasActive.current = isActive;
  }, [override, slide, pathname]);

  if (override !== 'deck') return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 112,
        right: 0,
        zIndex: 1000,
        transform: [
          {
            translateY: slide.interpolate({
              inputRange: [0, 1],
              outputRange: [-80, 0],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          backgroundColor: 'rgba(220, 38, 38, 0.96)',
          borderBottomWidth: 2,
          borderBottomColor: '#7f1d1d',
          paddingHorizontal: 24,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        {/* Pulsing dot — pure CSS-style animated value to keep
            attention on the banner without it being obnoxious. */}
        <PulsingDot />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 14,
              color: '#fff',
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}
          >
            PortWatch is overriding the deck view
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              marginTop: 2,
            }}
          >
            Engine is pinned to deck output regardless of mixer changes.
            {savedView ? ` Will restore to ${savedView.toUpperCase()} on release.` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            // No "release" button here on purpose: only the device
            // that engaged the override (PortWatch) can clear it.
            // This affordance just jumps to the Deck tab so the
            // operator can see what's actually happening on stage.
            try { router.replace('/'); } catch { /* ignore */ }
          }}
          style={({ pressed }) => ({
            backgroundColor: 'rgba(255,255,255,0.18)',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 6,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              color: '#fff',
              fontSize: 11,
              letterSpacing: 1.5,
            }}
          >
            VIEW DECK
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
};

const PulsingDot: React.FC = () => {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#fff',
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
      }}
    />
  );
};
