import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, Text } from 'react-native';
import { shadow } from '@/styles/globalStyles';
import { useEngineLock } from '@/hooks/useEngineLock';

// ── EngineLockoutOverlay ──────────────────────────────────────────
// Full-screen scrim that appears whenever an external owner (today:
// PortWatch via /mixer/view-override → globalsState.controlLock)
// holds the rig. Blocks ALL touches on the underlying CaptainPad UI
// so the operator can't accidentally fight the takeover by tapping
// faders / pattern rows / autopilot toggles whose writes the engine
// would silently honor regardless of the lock.
//
// Why a separate component (and not just the existing
// ViewOverrideBanner): the banner is an informational strip at the
// top of the screen — it leaves the rest of the UI tappable. The
// new requirement is to actually *prevent* writes from CaptainPad
// while PortWatch holds the override. Doing that with disabled
// states scattered across every Pressable would miss something;
// a single overlay with `pointerEvents: 'auto'` is hermetic and
// can't be accidentally bypassed by a future tab/component.
//
// Layout: positioned absolute over the entire window. Sits BELOW
// the ViewOverrideBanner (which has zIndex 1000) so the banner's
// "VIEW DECK" button stays tappable as a navigation aid; sits
// ABOVE the tab bar (which has its own implicit z-order) so even
// the sidebar's tab buttons are blocked. Operators who want to
// switch to Config / Studio while locked have to release on
// PortWatch first — that's the entire point of the lock.
export const EngineLockoutOverlay: React.FC = () => {
  const { locked, owner } = useEngineLock();
  // 0 = invisible, 1 = full scrim. Animated separately from `locked`
  // so the fade-out plays before the overlay unmounts.
  const opacity = useRef(new Animated.Value(0)).current;
  // Mounted flag — keep the View around for one fade cycle after
  // `locked` flips false so the operator sees the curtain drop
  // instead of just popping away.
  const [mounted, setMounted] = React.useState(false);

  useEffect(() => {
    if (locked) setMounted(true);
    Animated.timing(opacity, {
      toValue: locked ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!locked) setMounted(false);
    });
  }, [locked, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View
      style={{
        // pointerEvents 'auto' = catch every touch and do nothing
        // with it. This is what prevents CaptainPad from issuing any
        // writes while the lock is engaged.
        pointerEvents: locked ? 'auto' : 'none',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // zIndex chain (top → bottom): banner (1000) > overlay (900)
        // > Tabs container. Banner stays tappable; everything below
        // is blocked.
        zIndex: 900,
        backgroundColor: 'rgba(11, 11, 14, 0.55)',
        opacity,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Diagonal "LOCKED" pill — large enough to read across a
          camp-stage room, calm enough not to look like an error.
          The colour matches the override banner so the visual
          language ("PortWatch is overriding the deck view" up top
          → "rig locked" centered) is recognizably one event. */}
      <View
        style={{
          backgroundColor: 'rgba(220, 38, 38, 0.92)',
          paddingHorizontal: 28,
          paddingVertical: 18,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: '#7f1d1d',
          alignItems: 'center',
          gap: 6,
          boxShadow: shadow(0, 6, 16, '#000', 0.4),
          elevation: 12,
          maxWidth: 520,
        }}
      >
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            color: '#fff',
            fontSize: 20,
            letterSpacing: 2,
          }}
        >
          {(owner ?? 'EXTERNAL').toString().toUpperCase()} HAS THE RIG
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: 'rgba(255,255,255,0.92)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          CaptainPad is locked while the deck override is engaged.
          {'\n'}
          Release the override on the holding device to regain control.
        </Text>
      </View>
    </Animated.View>
  );
};
