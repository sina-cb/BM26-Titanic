// ── PlanIndicatorPill ───────────────────────────────────────────────────
// Compact plan-status glyph for the DECK + MIXER globals row (requests #3/#5).
//
// This is a STATUS GLYPH, not a panel. It mirrors the OscStatusPill idiom
// exactly — a fixed 48px-tall tile, neutral surface, with a coloured DOT +
// coloured LABEL + coloured BORDER carrying the signal — so it reads as one of
// the same family of compact status tiles the globals row already shows. It is
// rendered at the RIGHTMOST position of the globals row on both surfaces.
//
// Three states (driven by useOperatorTakeover off the shared engine bus):
//   • plan inactive / no plan  → DIMMED neutral "PLAN —" (like OSC-off; the
//     plan isn't driving the rig, so nothing to flag).
//   • plan active (planActive)  → LIT cyan "PLAN" (the timeline accent), the
//     "plan is driving the rig" signal.
//   • takeover lease held       → AMBER warning "TOOK OVER" + a live
//     "M:SS" countdown to when the plan auto-resumes. This is the
//     plan-active-takeover case (distinct from the program-pending overlay).
//
// Tapping routes to the Timeline tab (a status glyph that's also a shortcut).
// NEVER blocks the live performance — there is no modal here.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { usePalette } from '@/hooks/use-theme';
import { useOperatorTakeover } from '@/hooks/useTimeline';

// Timeline accent (cyan) — the same accent the timeline surfaces use, so the
// "plan is live" tile reads as part of the timeline system at a glance.
const PLAN_CYAN = '#22c1d6';
// Amber/warning — matched to PendingProgramOverlay's AMBER so the two
// timeline-takeover warnings share one high-attention colour.
const PLAN_AMBER = '#f5a623';

// "M:SS" countdown, clamped at 0:00 (never a negative or an em-dash).
function formatMSS(sec: number | null): string {
  const total = sec === null || !Number.isFinite(sec) ? 0 : Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  /** Compact variant for tight horizontal space (portrait). */
  compact?: boolean;
}

export function PlanIndicatorPill({ compact = false }: Props) {
  const C = usePalette();
  const { planActive, leaseHeld, leaseRemainingSec } = useOperatorTakeover();

  // Tile dimensions mirror OscStatusPill / BpmTile so the glyph reads as one of
  // the same row of compact status tiles.
  const w = compact ? 60 : 86;
  const TILE_HEIGHT = 48;

  // Resolve the visual state. Lease (took-over) wins over plain plan-active.
  const visual = useMemo(() => {
    if (leaseHeld) {
      return {
        border: PLAN_AMBER, label: PLAN_AMBER, dot: PLAN_AMBER,
        caption: 'TOOK OVER',
        value: formatMSS(leaseRemainingSec),
      };
    }
    if (planActive) {
      return {
        border: PLAN_CYAN, label: PLAN_CYAN, dot: PLAN_CYAN,
        caption: 'PLAN',
        value: 'LIVE',
      };
    }
    // Inactive / no plan → dimmed like an OSC-off pill.
    return {
      border: C.ghostBorder, label: C.secondary, dot: C.secondary,
      caption: 'PLAN',
      value: '—',
    };
  }, [leaseHeld, planActive, leaseRemainingSec, C.ghostBorder, C.secondary]);

  return (
    <TouchableOpacity
      onPress={() => router.push('/timeline')}
      accessibilityRole="button"
      accessibilityLabel={
        leaseHeld
          ? `Plan taken over, resumes in ${formatMSS(leaseRemainingSec)}. Open timeline.`
          : planActive
            ? 'Plan is active and driving the rig. Open timeline.'
            : 'No plan active. Open timeline.'
      }
      style={{
        width: w, height: TILE_HEIGHT,
        paddingVertical: 4, paddingHorizontal: 6,
        borderRadius: 8, borderWidth: 1,
        // Neutral surface always; the coloured border + dot + label carry the
        // signal (same recipe as OscStatusPill — no flooded tile).
        backgroundColor: C.surface,
        borderColor: visual.border,
        justifyContent: 'space-between',
        // Dim the whole tile when there's no plan (matches OSC-off posture).
        opacity: planActive || leaseHeld ? 1 : 0.55,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: visual.label, textTransform: 'uppercase', letterSpacing: 0.8,
        }}>{visual.caption}</Text>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: visual.dot }} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: visual.label, textAlign: 'center',
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}
      >
        {visual.value}
      </Text>
    </TouchableOpacity>
  );
}

// Re-export the accents so a host screen can match an inline takeover warning
// to the pill's colour without re-declaring the literals.
export const PLAN_INDICATOR_CYAN = PLAN_CYAN;
export const PLAN_INDICATOR_AMBER = PLAN_AMBER;
