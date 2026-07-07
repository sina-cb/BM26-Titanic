import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

// ── PlanLockScrim ─────────────────────────────────────────────────────
// The GENERIC, hermetic disable layer for the deck & mixer control
// surfaces while a plan holds the soft lock (controlLock === 'plan').
//
// Why a scrim and NOT per-control `disabled` props: scattering `disabled`
// across every Pressable is fragile — it missed the deck overlay controls
// (they stayed tappable under the lock) and would miss any control added in
// the future. Mirroring EngineLockoutOverlay's proven idiom, ONE absolutely
// positioned layer with `pointerEvents: 'auto'` catches every touch over the
// region and does nothing with it. A child that sets its own
// `pointerEvents: 'auto'` can escape a parent's `pointerEvents: 'none'`
// (CSS semantics on the web build), but it can NEVER escape a sibling that
// sits on top of it in the z-order — so this is bulletproof against future
// controls by construction.
//
// SCOPE: the caller wraps ONLY the mutating content region in a
// position:'relative' container and drops this in as an absolute-fill child.
// The floating PlanLockBanner (zIndex 1000) stays ABOVE the scrim so its
// TEMPORARY TAKE OVER / DISABLE PLAN / GO TO PLAN buttons stay tappable, and
// the bottom safety bar (PANIC / BLACKOUT) is a sibling OUTSIDE the wrapper,
// so emergency recovery is never locked behind a takeover.
//
// The dim wash IS the lock's visual — a single uniform layer reads as
// "hands off" far more clearly than the old scattered 45%-opacity per-card
// dims (which the operator found too subtle on the deck). Taking over
// (operator lease) clears the lock, this unmounts, and the surface is live.
export const PlanLockScrim: React.FC<{ active: boolean }> = ({ active }) => {
  // 0 = invisible, 1 = full wash. Animated apart from `active` so the fade-out
  // plays before we unmount (same pattern as EngineLockoutOverlay).
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (active) setMounted(true);
    Animated.timing(opacity, {
      toValue: active ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !active) setMounted(false);
    });
  }, [active, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View
      // pointerEvents 'auto' = be the top hit-target over the whole content
      // region and swallow every touch. While fading out (active false) we
      // flip to 'none' so the last frame doesn't block the surface it's
      // about to reveal.
      pointerEvents={active ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // Below the PlanLockBanner (1000) so its buttons stay live; above the
        // content it covers.
        zIndex: 500,
        // A calm unifying wash over the whole region — reads as "hands off"
        // even over controls that carry no per-control dim of their own (e.g.
        // the deck overlay stack), while staying light enough that it doesn't
        // compound with the existing per-section dims into an unreadable murk
        // or hide the live state the operator is monitoring.
        backgroundColor: 'rgba(11, 11, 14, 0.28)',
        opacity,
      }}
    />
  );
};
