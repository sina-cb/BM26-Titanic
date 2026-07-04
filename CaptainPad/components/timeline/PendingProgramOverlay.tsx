// ── PendingProgramOverlay ───────────────────────────────────────────────
// GLOBAL, NON-DISRUPTIVE "scheduled show pending" strip (docs/38 §16.5/§16.7).
//
// Why global: the pending-program lease only arms while the operator is
// hand-driving in MANUAL and a scheduled show wants the deck. The operator
// could be on ANY tab (Mixer, Deck, Studio, Audio, OSC, Monitor, Timeline,
// Scheduler, Dimmer, Config) when that happens — so the warning has to float
// over all of them, not hide inside the Timeline tab. This component is mounted
// ONCE in app/(tabs)/_layout.tsx as an absolutely-positioned sibling of <Tabs>.
//
// Why non-disruptive: a modal or a full-width blocking wall would interrupt a
// LIVE performance — exactly the moment the operator is mid-cue on the faders.
// So this is a COMPACT floating strip anchored top-center. The wrapping
// container is pointerEvents="box-none" and only the strip itself is
// pointerEvents="auto", so taps PASS THROUGH to the deck/mixer/faders
// underneath. The strip never reflows page layout (pure absolute overlay) and
// is slim enough to clear the primary control cluster of every tab.
//
// It reads `pendingProgram` off useTimeline() — the SHARED engine control bus
// (no new socket), safe from an app-level component. Renders NOTHING when the
// lease is null.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { useTimeline } from '@/hooks/useTimeline';
import { shadow } from '@/styles/globalStyles';

// Amber/warning accent — the same high-attention amber the in-tab sign used,
// deliberately distinct from the muted error red so it reads at a glance.
const AMBER = '#f5a623';

// "M:SS" countdown, clamped at 0:00 so the operator never sees a negative or
// an em-dash on an armed lease (leases are short — default 30 s).
function formatMSS(sec: number | null): string {
  const total = sec === null || !Number.isFinite(sec) ? 0 : Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const PendingProgramOverlay: React.FC = () => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { state, enableProgram, dismissProgram } = useTimeline();
  const pending = state?.pendingProgram ?? null;

  // 1 s ticker LOCAL to this component, so the countdown is live no matter
  // which tab the operator is on. Only runs while a lease is armed.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  // Surface an enable/dismiss failure briefly — but NEVER block. Auto-clears.
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current); }, []);
  const flashError = (msg: string) => {
    setActionError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setActionError(null), 4000);
  };

  // Countdown derived each render (the 1 s tick re-runs this). Clamp >= 0.
  const countdownSec = useMemo(() => {
    if (!pending || !Number.isFinite(pending.expiresAtMs)) return null;
    return Math.max(0, Math.round((pending.expiresAtMs - Date.now()) / 1000));
    // pending identity + tick (via render) keep this fresh.
  }, [pending, pending?.expiresAtMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Null lease → render nothing (additive; the rest of the app is untouched).
  if (!pending) return null;

  const onEnable = () => { enableProgram().then((ok) => { if (!ok) flashError('Could not enable — still manual'); }); };
  const onDismiss = () => { dismissProgram().then((ok) => { if (!ok) flashError('Could not dismiss lease'); }); };

  return (
    // box-none: the wrapper itself never captures touches, so taps fall
    // through to the tab underneath; left:112 clears the sidebar so the strip
    // centers over the SCREEN area, not the whole window.
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.strip} pointerEvents="auto">
        <Text style={styles.glyph}>⚠</Text>
        <Text style={styles.message} numberOfLines={1}>
          {`SHOW PENDING · ${pending.label} · ${formatMSS(countdownSec)}`}
        </Text>
        <TouchableOpacity
          onPress={onEnable}
          style={[styles.btn, styles.btnEnable]}
          accessibilityLabel="Enable scheduled show now"
        >
          <Text style={styles.btnEnableText}>ENABLE</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDismiss}
          style={[styles.btn, styles.btnDismiss]}
          accessibilityLabel="Keep manual control, dismiss scheduled show"
        >
          <Text style={styles.btnDismissText}>KEEP MANUAL</Text>
        </TouchableOpacity>
      </View>
      {actionError ? (
        <View style={styles.errorPill} pointerEvents="auto">
          <Text style={styles.errorText} numberOfLines={1}>{actionError}</Text>
        </View>
      ) : null}
    </View>
  );
};

function makeStyles(C: Palette) {
  return StyleSheet.create({
    // Full-screen-area overlay. box-none lets taps through everywhere except
    // the strip. left:112 clears the 112px sidebar so the strip centers over
    // the content area. High zIndex so it floats above all tab content but
    // below nothing that matters (peer of the lockout/override overlays).
    wrap: {
      position: 'absolute',
      top: 0,
      left: 112,
      right: 0,
      zIndex: 1100,
      alignItems: 'center',
      paddingTop: 14, // sit just below the status bar, top-center
    },
    // Compact single row (~52px tall), rounded, subtle shadow, amber accent,
    // NOT full-bleed (capped width, centered). pointerEvents="auto" so its own
    // buttons capture touches.
    strip: {
      maxWidth: 560,
      width: '92%',
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: AMBER,
      backgroundColor: C.surfaceContainerHigh,
      boxShadow: shadow(0, 6, 18, '#000', 0.28),
      elevation: 8,
    },
    glyph: { fontSize: 18, color: AMBER },
    message: {
      flex: 1,
      minWidth: 0,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.4,
      color: AMBER,
      textTransform: 'uppercase',
    },
    btn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnEnable: { backgroundColor: AMBER },
    btnEnableText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.6, color: '#1a1100' },
    btnDismiss: { borderWidth: 1.5, borderColor: AMBER, backgroundColor: 'transparent' },
    btnDismissText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.6, color: AMBER },
    // Brief error toast under the strip — never blocks.
    errorPill: {
      marginTop: 8,
      maxWidth: 560,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: C.errorContainer,
      borderWidth: 1,
      borderColor: C.errorContainerBorder,
    },
    errorText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.error },
  });
}
