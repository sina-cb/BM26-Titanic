import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { type Palette, Radius, Space, Type } from '@/constants/theme';
import { shadow } from '@/styles/globalStyles';
import { opToneColors } from '@/styles/op_tone';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { type OpNotice } from '@/utils/op_dialog';

// ── OpToastStack ───────────────────────────────────────────────────────────
//
// The NON-BLOCKING half of the op_dialog system (see utils/op_dialog.ts).
// Rendered only by components/op_dialog_host.tsx.
//
// ── WHERE IT SITS, AND WHY THERE ──────────────────────────────────────────
//
// BOTTOM-RIGHT, not top. CaptainPad's top band is already a four-way contest:
// PlanLockBanner and ViewOverrideBanner anchor top-right (zIndex 1000),
// PendingProgramOverlay takes top-centre (1100), and ZoomBanner takes the same
// strip at 1200 because "while a zoom is held, THIS is the mode banner". A
// toast that outranked those would cover the answer to "which clock is real"
// with a transient message about a rejected fader. The bottom edge is free on
// every tab, and it is the conventional home for transient status besides.
//
// zIndex 1300: above the mode banners in the stacking order (a toast raised
// while a banner is up must still be legible) but below the Live Touch webview
// (2147483000) and outside RN `Modal`'s space entirely, so an open
// OpDialogSheet always wins — a toast must never obscure a question.
//
// The wrapper is `pointerEvents="box-none"`, so the full-width column itself is
// never a touch target and only the toast cards (its children) take taps —
// everything else falls straight through to the faders and pads underneath.
// That idiom is copied from PendingProgramOverlay; on a live show surface an
// invisible tap-eating rectangle over the deck is a safety bug.
//
// No safe-area hook: `app/(tabs)/_layout.tsx` wraps the whole app in ONE
// SafeAreaView and every existing overlay just adds padding. Matching that
// keeps the insets from being applied twice.

/** Sidebar width — the toast column clears it so it centres/anchors over the
 *  SCREEN area rather than the app shell (same constant PendingProgramOverlay
 *  and ZoomBanner use for their `left`). */
const SIDEBAR_WIDTH = 112;

export interface OpToastStackProps {
  notices: OpNotice[];
  onDismiss: (id: number) => void;
}

export const OpToastStack: React.FC<OpToastStackProps> = ({ notices, onDismiss }) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  // Render nothing at all when idle — no invisible layer over the show.
  if (notices.length === 0) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {notices.map((notice) => (
        <OpToast key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </View>
  );
};

interface OpToastProps {
  notice: OpNotice;
  onDismiss: (id: number) => void;
}

const OpToast: React.FC<OpToastProps> = ({ notice, onDismiss }) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const tone = useMemo(() => opToneColors(C, notice.tone), [C, notice.tone]);

  // Each toast owns its own dwell timer. Keyed by notice id in the parent, so
  // a re-render never restarts a countdown that is already running.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notice.id), notice.durationMs);
    return () => clearTimeout(timer);
  }, [notice.id, notice.durationMs, onDismiss]);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onDismiss(notice.id)}
      accessibilityRole="alert"
      // Colour is never the only carrier (DESIGN.md): the tone is spoken.
      accessibilityLabel={
        `${tone.label}: ${notice.title}${notice.message ? `. ${notice.message}` : ''}. Tap to dismiss.`
      }
      style={[
        styles.card,
        { backgroundColor: tone.background, borderColor: tone.border },
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: tone.accent }]} />
      <IconSymbol name={tone.icon} size={18} color={tone.accent} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: tone.title }]} numberOfLines={2}>
          {notice.title}
        </Text>
        {notice.message ? (
          <Text style={styles.message} numberOfLines={4}>{notice.message}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

function makeStyles(C: Palette) {
  return {
    wrap: {
      position: 'absolute' as const,
      left: SIDEBAR_WIDTH,
      right: 0,
      bottom: 0,
      zIndex: 1300,
      alignItems: 'flex-end' as const,
      justifyContent: 'flex-end' as const,
      paddingHorizontal: Space.lg,
      paddingBottom: Space.lg,
      gap: Space.sm,
    },
    card: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: Space.md,
      // Caps the width on a 1024pt iPad without letting a long engine reason
      // squeeze into a sliver on a narrow split-view.
      maxWidth: 420,
      minHeight: 56,
      paddingLeft: Space.lg,
      paddingRight: Space.lg,
      paddingVertical: Space.md,
      borderRadius: Radius.card,
      borderWidth: 1,
      // Overflow hidden so the leading accent bar is clipped to the radius.
      overflow: 'hidden' as const,
      boxShadow: shadow(0, 6, 18, '#000000', 0.28),
      elevation: 8,
    },
    // 3px leading rule — the tone's second, non-colour-dependent carrier
    // alongside the icon.
    accentBar: {
      position: 'absolute' as const,
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
    },
    copy: {
      flexShrink: 1,
      gap: Space.xs,
    },
    title: {
      ...Type.labelCaps,
      fontSize: 11,
    },
    message: {
      ...Type.body,
      fontSize: 13,
      lineHeight: 18,
      color: C.text,
    },
  };
}
