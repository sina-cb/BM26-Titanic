import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, Text, TouchableOpacity } from 'react-native';
import { opError } from '@/utils/op_dialog';
import { router } from 'expo-router';
import { readableInk, shadow, withAlpha } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { Radius } from '@/constants/theme';
import { useEngineLock } from '@/hooks/useEngineLock';
import { useOperatorTakeover, useTimeline } from '@/hooks/useTimeline';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { subscribePlanLeaseNoticeRequests } from '@/utils/plan_lease_notice_requests';
import {
  formatPlanClock,
  planRemainingStatus,
  planRunningQuote,
} from './plan_lock_banner_logic';

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
// lock; this banner is its quieter sibling. AMBER matches the app's
// established "plan / take-over" language (the takeover lease countdown, the
// PANIC tile) rather than the red the portwatch lock uses, so the two lock
// states read as visually distinct severities.
//
// RESTYLE (docs/54 row 4): the amber is now the palette's `warning` token
// rather than a fixed loud hex, and every dark-on-amber ink is DERIVED with
// `readableInk()` instead of the ten hardcoded near-black literals this file
// used to carry. That matters on the LIGHT theme, where the loud amber is
// ~2:1 on white: `warning` there is a deep gold whose derived ink is white,
// so the banner stays legible instead of turning into a bright smear. The
// PANIC bar keeps the frozen `PANIC_AMBER` identity hex — that one control
// must read identically forever (docs/54 row 17); a caution banner must not.
//
// Layout mirrors ViewOverrideBanner (top strip, left:112 to clear the side
// tab bar, zIndex 1000) so the two never collide visually.

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
  surface?: 'DECK' | 'MIXER' | 'LIVE TOUCH';
}> = ({ onTemporaryTakeOver, surface = 'DECK' }) => {
  const { planLocked } = useEngineLock();
  const C = usePalette();
  // The whole banner is painted from ONE pair: the theme's caution amber and
  // the ink WCAG-derived from it (docs/54 §1.1 `accentFill` discipline).
  const tone = useMemo(() => {
    const ink = readableInk(C.warning);
    return {
      fill: C.warning,
      ink,
      // A solid rule against the amber field. Derived from the ink rather
      // than a second amber literal, so it darkens the dark-theme amber and
      // lifts the light-theme deep gold — one rule, five themes.
      rule: withAlpha(ink, 0.35),
      inkSoft: withAlpha(ink, 0.82),
      panel: withAlpha(ink, 0.1),
    };
  }, [C.warning]);
  const { takeover, state } = useTimeline();
  // ENGINE-GLOBAL performance flag (not this device's privilege): while it is
  // on, taking the rig from the timeline costs a fresh operator passcode, and
  // the button says so up front. Ruling 2026-08-14; gate in
  // utils/takeover_passcode.ts.
  const { active: performanceActive } = usePerformanceMode();
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
  const [leaseDismissed, setLeaseDismissed] = useState(false);
  useEffect(() => {
    if (!leaseHeld) setLeaseDismissed(false);
  }, [leaseHeld]);
  useEffect(
    () => subscribePlanLeaseNoticeRequests(() => {
      if (leaseHeld) setLeaseDismissed(false);
    }),
    [leaseHeld],
  );
  const handleGoToPlan = () => {
    try { router.push('/timeline'); } catch { /* router not ready during very early boot */ }
  };
  // TEMPORARY TAKE OVER — engage the operator lease so the deck/mixer unlock
  // for a while. The lease auto-resumes the plan after inactivity (each control
  // touch extends it); the banner then flips to the amber countdown variant.
  // Surface-specific override (mixer switches output too) or the plain lease.
  //
  // While PERFORMANCE MODE is live this button first opens the per-attempt
  // operator passcode prompt (operator ruling 2026-08-14 — see
  // utils/takeover_passcode.ts). A DISMISSED prompt returns 'cancelled': no
  // request was made, the plan is still running exactly as before, and an
  // alert would be a lie — only a real engine refusal alerts.
  const [takingOver, setTakingOver] = useState(false);
  const handleTakeOver = async () => {
    if (takingOver) return;
    setTakingOver(true);
    try {
      if (onTemporaryTakeOver) await onTemporaryTakeOver();
      else {
        const outcome = await takeover();
        if (outcome === 'failed') {
          opError('Take over failed', 'The engine rejected the takeover. The plan may still be running.');
        }
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

  const visible = planLocked || (leaseHeld && !leaseDismissed);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);
  const planName = state?.activePlan ?? 'UNNAMED PLAN';
  const cueLabel = activeCue?.label ?? 'AUTOPILOT BASELINE';
  const remaining = planRemainingStatus(state, nowMs);
  const burnQuote = planRunningQuote(nowMs);
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
        // Compact so it doesn't blanket the deck/mixer (operator request
        // 2026-07-03: the takeover warning was covering too much UI).
        width: 390,
        maxWidth: '90%',
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
          // AMBER field with a solid rule — calmer than the portwatch
          // banner's red, but unmistakably a "hands-off" state.
          backgroundColor: tone.fill,
          borderWidth: 2,
          borderColor: tone.rule,
          borderRadius: Radius.card,
          paddingHorizontal: 12,
          paddingRight: leaseHeld ? 34 : 12,
          paddingVertical: 8,
          boxShadow: shadow(0, 4, 12, '#000', 0.3),
          elevation: 8,
        }}
      >
        {leaseHeld ? (
          <TouchableOpacity
            onPress={() => setLeaseDismissed(true)}
            style={{
              position: 'absolute',
              right: 5,
              top: 5,
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss takeover lease notice"
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, lineHeight: 20, color: tone.ink }}>
              ×
            </Text>
          </TouchableOpacity>
        ) : null}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PulsingDot color={tone.ink} />
            <Text
              style={{
                flex: 1,
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 11.5,
                // Ink derived from the amber field, never a literal — the
                // light theme's warning wants WHITE here, the dark ones black.
                color: tone.ink,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
              numberOfLines={1}
            >
              {leaseHeld
                ? `Taken over · resumes ${formatMSS(leaseRemainingSec)}`
                : 'Plan running · controls locked'}
            </Text>
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 10.5,
                color: tone.ink,
                fontVariant: ['tabular-nums'],
              }}
              accessibilityLabel={`Current time ${formatPlanClock(nowMs)}`}
            >
              {formatPlanClock(nowMs)}
            </Text>
          </View>

          {/* Compact status check: exact active cue/baseline, plan, and the
              authoritative window/next-cue countdown. */}
          <View
            style={{
              marginTop: 6,
              borderRadius: Radius.control,
              backgroundColor: tone.panel,
              paddingHorizontal: 9,
              paddingVertical: 7,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 9,
                  color: tone.inkSoft,
                  letterSpacing: 0.8,
                }}
              >
                {leaseHeld ? '↩ RESUME TARGET' : '✓ CUE LIVE'}
              </Text>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 12,
                  color: tone.ink,
                  marginTop: 1,
                }}
                numberOfLines={1}
              >
                {cueLabel}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 9.5,
                  color: tone.inkSoft,
                  marginTop: 1,
                }}
                numberOfLines={1}
              >
                {`PLAN · ${planName}`}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 15,
                  color: tone.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {remaining.value}
              </Text>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 8.5,
                  color: tone.inkSoft,
                  letterSpacing: 0.8,
                }}
              >
                {remaining.label}
              </Text>
            </View>
          </View>

          {leaseHeld ? null : (
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 9.5,
                lineHeight: 13,
                color: tone.inkSoft,
                fontStyle: 'italic',
                marginTop: 5,
              }}
              numberOfLines={2}
            >
              {`“${burnQuote}”`}
            </Text>
          )}
          {/* TAKEN-OVER state → a single RESUME NOW hand-back + GO TO PLAN.
              LOCKED state → TEMPORARY TAKE OVER (primary, full width) on its
              own row, then GO TO PLAN below. DISABLE PLAN was removed
              (2026-07-03 simplification): TEMPORARY TAKE OVER is the only way to
              interrupt a running plan, and it always auto-resumes. */}
          {leaseHeld ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              <TouchableOpacity
                onPress={() => { void resumeNow(); }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: Radius.control,
                  backgroundColor: tone.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Hand control back and resume the plan now"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6, color: tone.fill }}>
                  RESUME NOW
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGoToPlan}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: Radius.control,
                  borderWidth: 1.5,
                  borderColor: tone.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Go to the timeline plan tab"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6, color: tone.ink }}>
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
                  minHeight: 44,
                  borderRadius: Radius.control,
                  backgroundColor: tone.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 6,
                  opacity: takingOver ? 0.6 : 1,
                }}
                accessibilityRole="button"
                accessibilityLabel={performanceActive
                  ? `Take over ${surface.toLowerCase()} — asks for the operator passcode first`
                  : `Take over ${surface.toLowerCase()} for manual control`}
                accessibilityState={{ disabled: takingOver }}
              >
                {/* Say the passcode is coming BEFORE the tap: mid-show, a modal
                    that appears unannounced reads as a fault. */}
                <Text
                  style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.6, color: tone.fill }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                >
                  {takingOver
                    ? 'TAKING OVER…'
                    : performanceActive
                      ? `TAKE OVER ${surface} · PASSCODE`
                      : `TAKE OVER ${surface}`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGoToPlan}
                style={{
                  minHeight: 40,
                  borderRadius: Radius.control,
                  borderWidth: 1.5,
                  borderColor: tone.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Go to the timeline plan tab"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6, color: tone.ink }}>
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

const PulsingDot: React.FC<{ color: string }> = ({ color }) => {
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
        backgroundColor: color,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
      }}
    />
  );
};
