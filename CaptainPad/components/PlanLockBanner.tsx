import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, Text } from 'react-native';
import { shadow } from '@/styles/globalStyles';
import { useEngineLock } from '@/hooks/useEngineLock';

// ── PlanLockBanner ─────────────────────────────────────────────────────
// The SOFT counterpart to EngineLockoutOverlay. Lights up whenever the
// engine reports `globalsState.controlLock === 'plan'` (the timeline PLAN —
// not a device — is driving the deck).
//
// Why a banner and NOT the full-screen curtain (EngineLockoutOverlay):
//   The operator's call — "the plan lock is less severe than the portwatch;
//   make it a lower-key YELLOW warning, still allow navigation in the
//   CaptainPad app, don't allow changes in the pattern or mixer
//   activations." So this is a non-blocking, top-anchored AMBER strip:
//     - pointerEvents 'box-none' → taps fall straight through to the UI
//       underneath; navigation, scrolling and read-only viewing stay live.
//     - it never curtains the screen — the deck/mixer screens themselves
//       disable only their activation controls (pattern select / channel
//       activate-bump-mute-solo-fader) while this lock is engaged, and the
//       existing operator-takeover path re-enables them.
//
// The full red lockout overlay stays reserved ONLY for the portwatch HARD
// lock; this banner is its quieter sibling. AMBER (#F5A623) matches the
// app's established "plan / take-over" language (the takeover lease
// countdown, the PANIC tile) rather than the red the portwatch lock uses,
// so the two lock states read as visually distinct severities.
//
// Layout mirrors ViewOverrideBanner (top strip, left:112 to clear the side
// tab bar, zIndex 1000) so the two never collide visually.
const PLAN_LOCK_AMBER = '#F5A623';

export const PlanLockBanner: React.FC = () => {
  const { planLocked } = useEngineLock();
  // 0 = hidden, 1 = fully visible. Slide-in from the top, same easing as
  // the override banner so the two read as one visual family. Purely
  // cosmetic — visibility is gated DIRECTLY on `planLocked`, never on the
  // animation's completion callback. (A previous version mounted/unmounted
  // off `.start(cb)`; that callback is unreliable under react-native-web's
  // `useNativeDriver` shim and left the banner stuck hidden while a plan
  // was driving the deck — the exact bug this banner exists to surface.)
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: planLocked ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      // false: react-native-web has no native animation thread; forcing the
      // native driver here silently no-ops the timing on web (and can drop
      // the completion callback). Match ViewOverrideBanner, which slides
      // reliably because it never depends on the callback to gate render.
      useNativeDriver: false,
    }).start();
  }, [planLocked, slide]);

  // Gate visibility on the lock itself. While `planLocked` is false the
  // banner is fully unmounted; the slide value rests at 0 so the next
  // engage animates in cleanly.
  if (!planLocked) return null;

  return (
    <Animated.View
      style={{
        // box-none: this strip itself is non-interactive and lets every
        // touch pass through to the screen below — navigation stays usable.
        pointerEvents: 'box-none',
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
          // AMBER wash with a solid amber rule — calmer than the portwatch
          // banner's red, but unmistakably a "hands-off" state.
          backgroundColor: 'rgba(245, 166, 35, 0.96)',
          borderBottomWidth: 2,
          borderBottomColor: '#9a6a12',
          paddingHorizontal: 24,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          boxShadow: shadow(0, 4, 12, '#000', 0.3),
          elevation: 8,
        }}
      >
        <PulsingDot />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 14,
              // Dark text on amber for contrast (matches onPrimary-on-amber
              // convention used by the gruvbox theme + the PANIC hint).
              color: '#1a1a1a',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Plan is running — pattern & mixer changes are locked
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 11,
              color: 'rgba(26,26,26,0.82)',
              marginTop: 2,
            }}
          >
            Take over to make changes. Navigation and viewing stay available.
          </Text>
        </View>
      </View>
    </Animated.View>
  );
};

const PulsingDot: React.FC = () => {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
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
        backgroundColor: '#1a1a1a',
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
      }}
    />
  );
};

export { PLAN_LOCK_AMBER };
