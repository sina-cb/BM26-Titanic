import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { shadow } from '@/styles/globalStyles';
import { useEngineLock } from '@/hooks/useEngineLock';
import { useOperatorTakeover, useTimeline } from '@/hooks/useTimeline';

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

// "M:SS", clamped at 0:00 (mirrors PlanIndicatorPill.formatMSS).
function formatMSS(sec: number | null): string {
  const total = sec === null || !Number.isFinite(sec) ? 0 : Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const PlanLockBanner: React.FC<{
  // Optional surface-specific takeover. The MIXER passes a handler that ALSO
  // switches the engine output to the mixer (so the master isn't left black);
  // the DECK omits it and uses the default plain takeover (its output already
  // is the deck). Both engage the same operator lease.
  onTemporaryTakeOver?: () => void | Promise<void>;
}> = ({ onTemporaryTakeOver }) => {
  const { planLocked } = useEngineLock();
  const { takeover, state } = useTimeline();
  // The live event driving the deck (engine `activeCue`), named in the banner
  // so the operator sees WHAT is running while it's locked (operator request
  // 2026-07-02). Null → the autopilot baseline is driving (no specific cue).
  const activeCue = state?.activeCue ?? null;
  // Second banner state (operator request 2026-07-02): the TAKEN-OVER lease.
  // The mixer header used to carry an inline "TOOK OVER · RESUMES M:SS ·
  // RESUME NOW" chip + the PlanIndicatorPill; both crowded the row off a
  // single iPad line. The lease warning now lives HERE — floating on top of
  // the header (zero row width) in the same amber family. The two states are
  // mutually exclusive by construction: while a lease is held the engine's
  // controlLock is NOT 'plan' (planActive false under 'overridden'), so
  // exactly one variant renders at a time.
  const { leaseHeld, leaseRemainingSec, resumeNow } = useOperatorTakeover();
  const handleGoToPlan = () => {
    try { router.push('/timeline'); } catch { /* router not ready during very early boot */ }
  };
  // TEMPORARY TAKE OVER — engage the operator lease so the deck/mixer unlock
  // for a while. The lease auto-resumes the plan after inactivity (each control
  // touch extends it); the banner then flips to the amber countdown variant.
  // Surface-specific override (mixer switches output too) or the plain lease.
  const [takingOver, setTakingOver] = useState(false);
  const handleTakeOver = async () => {
    if (takingOver) return;
    setTakingOver(true);
    try {
      if (onTemporaryTakeOver) await onTemporaryTakeOver();
      else {
        const ok = await takeover();
        if (!ok) Alert.alert('Take over failed', 'The engine rejected the takeover. The plan may still be running.');
      }
    } finally {
      setTakingOver(false);
    }
  };
  // 0 = hidden, 1 = fully visible. Slide-in from the top, same easing as
  // the override banner so the two read as one visual family. Purely
  // cosmetic — visibility is gated DIRECTLY on `planLocked`, never on the
  // animation's completion callback. (A previous version mounted/unmounted
  // off `.start(cb)`; that callback is unreliable under react-native-web's
  // `useNativeDriver` shim and left the banner stuck hidden while a plan
  // was driving the deck — the exact bug this banner exists to surface.)
  const slide = useRef(new Animated.Value(0)).current;

  const visible = planLocked || leaseHeld;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      // false: react-native-web has no native animation thread; forcing the
      // native driver here silently no-ops the timing on web (and can drop
      // the completion callback). Match ViewOverrideBanner, which slides
      // reliably because it never depends on the callback to gate render.
      useNativeDriver: false,
    }).start();
  }, [visible, slide]);

  // Gate visibility on the states themselves. While neither is active the
  // banner is fully unmounted; the slide value rests at 0 so the next
  // engage animates in cleanly.
  if (!visible) return null;

  return (
    <Animated.View
      style={{
        // box-none: this strip itself is non-interactive and lets every
        // touch pass through to the screen below — navigation stays usable.
        pointerEvents: 'box-none',
        position: 'absolute',
        top: 12,
        right: 16,
        maxWidth: 460,
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
          borderWidth: 2,
          borderColor: '#9a6a12',
          borderRadius: 10,
          paddingHorizontal: 18,
          paddingVertical: 10,
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
            {leaseHeld
              ? `Taken over — plan resumes in ${formatMSS(leaseRemainingSec)}`
              : 'Plan is running — pattern & mixer changes are locked'}
          </Text>
          {/* Name the LIVE event (engine activeCue) — shown in BOTH the locked
              and taken-over states so the operator always knows what the plan
              is running / will resume to. */}
          {activeCue ? (
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 12,
                color: '#1a1a1a',
                marginTop: 3,
              }}
              numberOfLines={1}
            >
              {`▶ ${activeCue.label}${activeCue.kind === 'program' ? ' (show)' : ''}`}
            </Text>
          ) : null}
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 11,
              color: 'rgba(26,26,26,0.82)',
              marginTop: 2,
            }}
          >
            {leaseHeld
              ? 'You hold manual control; the plan auto-resumes when you stop. Hand it back early with RESUME NOW.'
              : 'Take over to make changes. Navigation and viewing stay available.'}
          </Text>
          {/* TAKEN-OVER state → a single RESUME NOW hand-back + GO TO PLAN.
              LOCKED state → TEMPORARY TAKE OVER (primary, full width) on its
              own row, then GO TO PLAN below. DISABLE PLAN was removed
              (2026-07-03 simplification): TEMPORARY TAKE OVER is the only way to
              interrupt a running plan, and it always auto-resumes. */}
          {leaseHeld ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TouchableOpacity
                onPress={() => { void resumeNow(); }}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 8,
                  backgroundColor: '#1a1a1a',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Hand control back and resume the plan now"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8, color: PLAN_LOCK_AMBER }}>
                  RESUME NOW
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGoToPlan}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: '#1a1a1a',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Go to the timeline plan tab"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8, color: '#1a1a1a' }}>
                  GO TO PLAN
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                onPress={handleTakeOver}
                disabled={takingOver}
                style={{
                  minHeight: 40,
                  borderRadius: 8,
                  backgroundColor: '#1a1a1a',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 8,
                  opacity: takingOver ? 0.6 : 1,
                }}
                accessibilityRole="button"
                accessibilityLabel="Temporarily take over — unlock the deck and mixer for manual control"
                accessibilityState={{ disabled: takingOver }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.8, color: PLAN_LOCK_AMBER }}>
                  {takingOver ? 'TAKING OVER…' : 'TEMPORARY TAKE OVER'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGoToPlan}
                style={{
                  minHeight: 36,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: '#1a1a1a',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 8,
                }}
                accessibilityRole="button"
                accessibilityLabel="Go to the timeline plan tab"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8, color: '#1a1a1a' }}>
                  GO TO PLAN
                </Text>
              </TouchableOpacity>
            </>
          )}
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
