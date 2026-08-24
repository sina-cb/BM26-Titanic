/**
 * ZoomBanner — the EVENT-ZOOM mode banner (reports _94 §3.2/§3.3, _95 §3.5).
 *
 * Mounted ONCE in app/(tabs)/_layout.tsx as a sibling of <Tabs>, so it floats
 * over EVERY surface — deck, mixer, timeline, config. That is deliberate: while
 * a zoom is held, "which clock is real" must be answerable from any tab without
 * navigating. Two variants, unmistakably different from each other and from the
 * amber pending-show strip and the yellow plan lock:
 *
 *   GREEN  🎚 PERFORMING     — you have the deck; the plan is holding
 *   PURPLE 🕰 TIME TRAVELING — the deck shows the PLAN at a target instant,
 *                              not tonight
 *
 * Every exit funnels through POST /timeline/resume → catchUp at NOW, so the rig
 * can NEVER stay stuck in a zoom:
 *   • returning to the TIMELINE tab (handled in the timeline tab; D1 — only from
 *     the client that entered the zoom, so tab-browsing on pad B never yanks
 *     pad A's performance),
 *   • the EXIT button here — available on EVERY client, including one that
 *     never zoomed,
 *   • lease expiry after two minutes without a real app touch,
 *   • engine restart / autopilot OFF / plan save — engine-side lease clears.
 *
 * Second CaptainPads see the same banner because it renders off the shared
 * `timelineState` broadcast: nobody can walk up to a pad and not know.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  useTimeline, zoomEnteredHere, zoomExitRequested, clearZoomClaims,
} from '@/hooks/useTimeline';
import { shadow } from '@/styles/globalStyles';
import { zoomBannerModel, shouldAnnounceZoomEnd } from './zoom_logic';

const GREEN = '#00a86b';
const PURPLE = '#8b5cf6';
const AMBER = '#f5a623';

// How long the "zoom ended without you asking" notice stays up.
const ENDED_TOAST_MS = 6000;
const TRAVEL_EXPANDED_MS = 7000;

export const ZoomBanner: React.FC = () => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { state, resume, travel, enableProgram } = useTimeline();
  const zoom = state?.zoom ?? null;
  const model = useMemo(() => zoomBannerModel(zoom), [zoom]);
  const modelTone = model?.tone ?? null;
  const modelDeferredText = model?.deferredText ?? null;
  const [expanded, setExpanded] = useState(true);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleTravelCollapse = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
      collapseTimer.current = null;
    }, TRAVEL_EXPANDED_MS);
  }, []);
  useEffect(() => {
    if (!modelTone) return;
    setExpanded(true);
    if (modelTone === 'travel' && !modelDeferredText) scheduleTravelCollapse();
    return () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = null;
      }
    };
  }, [
    modelDeferredText,
    modelTone,
    scheduleTravelCollapse,
    zoom?.cueId,
    zoom?.targetDate,
    zoom?.targetLocal,
  ]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current); }, []);
  const flashError = (msg: string) => {
    setExpanded(true);
    setActionError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setActionError(null), 5000);
  };

  // ── "The zoom ended and it wasn't me" ──────────────────────────────────
  // Engine restart, lease expiry, autopilot OFF, or the maker's auto-save all
  // drop the zoom engine-side. When that happens to the client that ENTERED it,
  // say so and put them back on the TIMELINE tab, rather than silently leaving
  // them on a deck they no longer own.
  const [endedNote, setEndedNote] = useState<string | null>(null);
  const hadZoomRef = useRef(false);
  const endedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (endedTimer.current) clearTimeout(endedTimer.current); }, []);

  useEffect(() => {
    const has = !!zoom;
    if (hadZoomRef.current && !has) {
      // `ours` covers BOTH operator-initiated exits — the EXIT button here and
      // the timeline-tab return — because each goes through resume(), which
      // stakes the claim before its request leaves. Anything else (lease
      // expiry, engine restart, autopilot OFF, a maker auto-save) is news.
      const ours = zoomExitRequested();
      const entered = zoomEnteredHere();
      clearZoomClaims();
      if (shouldAnnounceZoomEnd({ ours, entered })) {
        setEndedNote('Zoom ended — the plan resumed at now.');
        if (endedTimer.current) clearTimeout(endedTimer.current);
        endedTimer.current = setTimeout(() => setEndedNote(null), ENDED_TOAST_MS);
        try { router.push('/timeline'); } catch { /* router not ready — the note still shows */ }
      }
    }
    hadZoomRef.current = has;
  }, [zoom]);

  if (!model) {
    // No zoom. Still render the "it ended" note if one is pending, so the
    // operator learns WHY the deck changed under them.
    if (!endedNote) return null;
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.strip, { borderColor: C.ghostBorder }]} pointerEvents="auto">
          <Text style={[styles.title, { color: C.text }]}>ZOOM ENDED</Text>
          <Text style={[styles.detail, { color: C.secondary }]} numberOfLines={1}>{endedNote}</Text>
        </View>
      </View>
    );
  }

  const accent = model.tone === 'perform' ? GREEN : PURPLE;

  if (!expanded) {
    return (
      <View style={[styles.wrap, styles.wrapCompact]} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.compactChip, { borderColor: accent }]}
          onPress={() => {
            setExpanded(true);
            scheduleTravelCollapse();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${model.title}. Expand Time Travel controls`}
        >
          <Text style={[styles.glyph, { color: accent }]}>🕰</Text>
          <Text style={[styles.compactTitle, { color: accent }]}>TIME TRAVEL</Text>
          <Text style={styles.compactDetail} numberOfLines={1}>
            {zoom?.label || zoom?.targetLocal || 'SAVED SNAPSHOT'}
          </Text>
          <Text style={[styles.compactExpand, { color: accent }]}>EXPAND</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const onExit = async () => {
    setBusy(true);
    const ok = await resume();
    setBusy(false);
    if (!ok) flashError('Could not hand the plan back — try EXIT again');
  };

  const onStep = async (step: 'prev' | 'next') => {
    setBusy(true);
    // The engine 400s at the first/last event of the day with a named message
    // ("no prev event on 2026-09-04") — it never clamps, and neither do we.
    const outcome = await travel({ step });
    setBusy(false);
    if (!outcome.ok) flashError(outcome.error);
  };

  const onEnableDeferred = async () => {
    setBusy(true);
    const ok = await enableProgram();
    setBusy(false);
    if (!ok) flashError('Could not start the show');
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.strip, { borderColor: accent, backgroundColor: C.surfaceContainerHigh }]} pointerEvents="auto">
        <View style={styles.mainRow}>
          <Text style={[styles.glyph, { color: accent }]}>{model.tone === 'perform' ? '🎚' : '🕰'}</Text>
          <Text style={[styles.title, { color: accent }]}>{model.title}</Text>
          <Text style={[styles.detail, { color: C.text }]} numberOfLines={1}>{model.detail}</Text>

          {model.showSteppers ? (
            <>
              <TouchableOpacity
                onPress={() => { void onStep('prev'); }}
                disabled={busy}
                style={[styles.stepBtn, { borderColor: accent }, busy && { opacity: 0.5 }]}
                accessibilityLabel="Travel to the previous event of this day"
              >
                <Text style={[styles.stepBtnText, { color: accent }]}>◀</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { void onStep('next'); }}
                disabled={busy}
                style={[styles.stepBtn, { borderColor: accent }, busy && { opacity: 0.5 }]}
                accessibilityLabel="Travel to the next event of this day"
              >
                <Text style={[styles.stepBtnText, { color: accent }]}>▶</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {model.tone === 'travel' ? (
            <TouchableOpacity
              onPress={() => setExpanded(false)}
              disabled={busy}
              style={[styles.minimizeBtn, { borderColor: accent }, busy && { opacity: 0.5 }]}
              accessibilityLabel="Minimize the Time Travel reminder"
            >
              <Text style={[styles.minimizeBtnText, { color: accent }]}>MINIMIZE</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => { void onExit(); }}
            disabled={busy}
            style={[styles.exitBtn, { backgroundColor: accent }, busy && { opacity: 0.5 }]}
            accessibilityLabel="Exit the zoom and hand the plan back"
          >
            <Text style={styles.exitBtnText}>EXIT</Text>
          </TouchableOpacity>
        </View>

        {/* D3: a program that came due mid-zoom is DEFERRED, never dismissed.
            ENABLE starts it now; exiting the zoom starts it via catchUp. */}
        {model.deferredText ? (
          <View style={styles.deferredRow}>
            <Text style={[styles.deferredText, { color: AMBER }]} numberOfLines={1}>
              {`⚠ ${model.deferredText}`}
            </Text>
            <TouchableOpacity
              onPress={() => { void onEnableDeferred(); }}
              disabled={busy}
              style={[styles.enableBtn, { borderColor: AMBER }, busy && { opacity: 0.5 }]}
              accessibilityLabel="Start the deferred show now"
            >
              <Text style={[styles.enableBtnText, { color: AMBER }]}>ENABLE</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {actionError ? (
          <Text style={styles.errorText} numberOfLines={2}>{actionError}</Text>
        ) : null}
      </View>
    </View>
  );
};

function makeStyles(C: Palette) {
  return StyleSheet.create({
    // Full-width across the SCREEN area (left:112 clears the sidebar). box-none
    // so taps outside the strip fall through to the tab underneath. zIndex above
    // the pending-show strip: while a zoom is held, THIS is the mode banner.
    wrap: {
      position: 'absolute',
      top: 0,
      left: 112,
      right: 0,
      zIndex: 1200,
      paddingTop: 8,
      paddingHorizontal: 10,
    },
    wrapCompact: {
      alignItems: 'flex-end',
    },
    strip: {
      borderRadius: 12,
      borderWidth: 2,
      paddingHorizontal: 14,
      paddingVertical: 8,
      gap: 6,
      boxShadow: shadow(0, 6, 18, '#000', 0.3),
      elevation: 9,
    },
    compactChip: {
      minHeight: 44,
      maxWidth: 390,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 22,
      borderWidth: 2,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 14,
      boxShadow: shadow(0, 4, 14, '#000', 0.3),
      elevation: 9,
    },
    compactTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 1,
    },
    compactDetail: {
      flexShrink: 1,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
      color: C.text,
    },
    compactExpand: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
    },
    mainRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    glyph: { fontSize: 18 },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    detail: {
      flex: 1, minWidth: 0,
      fontFamily: 'Inter_400Regular', fontSize: 12.5,
    },
    stepBtn: {
      width: 44, minHeight: 36, borderRadius: 8, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center',
    },
    stepBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14 },
    minimizeBtn: {
      minHeight: 36,
      borderRadius: 8,
      borderWidth: 1.5,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    minimizeBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
    },
    exitBtn: {
      paddingHorizontal: 16, minHeight: 36, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
    },
    exitBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 1, color: '#FFFFFF',
    },
    deferredRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    deferredText: { flex: 1, minWidth: 0, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
    enableBtn: {
      paddingHorizontal: 12, minHeight: 32, borderRadius: 8, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center',
    },
    enableBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8 },
    errorText: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5, color: C.error },
  });
}
