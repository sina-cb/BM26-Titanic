/**
 * DayView — the DAY rung of the zoom ladder (report _94 §2.2).
 *
 *   FESTIVAL (8-day strip) ──tap a day──▶ DAY ──tap an event──▶ EVENT (the deck)
 *
 * This is a pure BROWSE level: it makes ZERO engine calls of its own, so
 * reviewing the timeline can never touch the rig. It replaces the old DayEditor
 * modal — same job (a day's vertical timeline, add/edit/delete a cue) promoted
 * to a full-screen level and enriched with the two things a REVIEW needs that
 * the maker never had:
 *
 *   1. PHASE BANDS   — per-day `phases` from the overview, resolved against
 *                      THAT day's own sun anchors. Plan order is the draw
 *                      order (overlap resolves first-in-plan-order) and a band
 *                      that wraps midnight is drawn as two pieces.
 *   2. THE RESOLVED RIBBON — per-day `segments`: what actually OWNS the deck
 *                      and which playlist plays, minute by minute, straight
 *                      from the engine's pure resolver.
 *
 * The ribbon is the HONESTY layer. It shows, correctly, that a hold expiring
 * lands on the autopilot baseline (_91 G1, `source:'hold-expired-baseline'`)
 * and that a single cue can own most of a night. It renders the truth of the
 * shipped plan; it does NOT fix it.
 *
 * One documented limit, inherited from the engine's `_catchUp` day-latch
 * semantics (_95 §5): the ribbon does NOT carry a night's owner across midnight
 * into the next day. A cue that fired at 22:00 yesterday is not the owner at
 * 02:00 today. We render that honestly rather than faking continuity — the
 * header says so in one line.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OverviewDay, OverviewCue, PlanCue } from '@/utils/timelineApi';
import {
  hhmmToMinutes, hhmmTo12h, minutesTo12h, kindColor, KIND_LABEL,
  triggerSummary, actionSummary,
} from './timelineTemplate';
import {
  allPhaseBands, ribbonRows, ribbonSourceNote, DAY_MINUTES,
  type RibbonRow,
} from './zoom_logic';

// 30 px per hour — a whole day is legible on an iPad without pinching, and an
// hour is a comfortable touch target for the bands.
const CHART_HEIGHT = 720;
const HOUR_LABEL_STEP = 3;

// Phase band tints, cycled by PLAN ORDER (never by name, so a rename can't
// re-colour the whole day). Fixed hexes: a band is a structural marker, not a
// theme accent.
const PHASE_TINTS = ['#5b6cf5', '#22c1d6', '#f5a623', '#c05bf5', '#3fbf7f'];

const AMBER = '#f5a623';

function yFor(mins: number): number {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, mins));
  return (clamped / DAY_MINUTES) * CHART_HEIGHT;
}

// ── The resolved-ribbon column ──────────────────────────────────────────

function RibbonColumn({
  rows, C, styles,
}: {
  rows: RibbonRow[];
  C: Palette;
  styles: Styles;
}) {
  return (
    <View style={styles.ribbonColumn}>
      {rows.map((r) => {
        const top = yFor(r.fromMin);
        const h = Math.max(14, yFor(r.toMin) - top);
        // Warn (hold-expired-baseline) is amber; a real cue owner reads in the
        // theme accent; the fallbacks recede to the muted icon colour.
        const accent = r.warn ? AMBER : (r.ownerKind === 'cue' ? C.primary : C.icon);
        return (
          <View
            key={r.key}
            style={[
              styles.ribbonSeg,
              { top, height: h, borderLeftColor: accent, backgroundColor: C.surfaceContainerLowest },
            ]}
          >
            <Text style={[styles.ribbonPlaylist, { color: accent }]} numberOfLines={1}>
              {r.playlist ? `▸ ${r.playlist}` : '▸ —'}
            </Text>
            {h >= 30 ? (
              <Text style={styles.ribbonOwner} numberOfLines={1}>
                {`${r.fromLocal}–${r.toLocal} · ${r.ownerLabel}`}
              </Text>
            ) : null}
            {h >= 46 ? (
              <Text style={[styles.ribbonNote, r.warn && { color: AMBER }]} numberOfLines={1}>
                {`${r.warn ? '⚠ ' : ''}${ribbonSourceNote(r)}${r.palette ? ` · ${r.palette}` : ''}`}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ── The day chart (hours · sun · phase bands · cues · NOW) ──────────────

function DayChart({
  day, nowMinutes, C, styles,
}: {
  day: OverviewDay;
  nowMinutes: number | null;
  C: Palette;
  styles: Styles;
}) {
  const bands = useMemo(() => allPhaseBands(day.phases), [day.phases]);

  const sunriseMin = hhmmToMinutes(day.sun.sunrise);
  const sunsetMin = hhmmToMinutes(day.sun.sunset);

  return (
    <View style={styles.chart}>
      {/* Daylight shade (sunrise → sunset) — the backdrop every sun-anchored
          time is read against. */}
      {sunriseMin !== null && sunsetMin !== null && sunsetMin > sunriseMin ? (
        <View
          style={[
            styles.daylight,
            {
              top: yFor(sunriseMin),
              height: yFor(sunsetMin) - yFor(sunriseMin),
              backgroundColor: C.sidebarActiveBackground,
            },
          ]}
        />
      ) : null}

      {/* Hour grid + labels. */}
      {Array.from({ length: 24 / HOUR_LABEL_STEP + 1 }, (_, i) => i * HOUR_LABEL_STEP).map((h) => (
        <View key={`h${h}`} style={[styles.hourLine, { top: yFor(h * 60), backgroundColor: C.ghostBorder }]}>
          <Text style={styles.hourLabel}>{minutesTo12h(h * 60 === DAY_MINUTES ? 0 : h * 60)}</Text>
        </View>
      ))}

      {/* PHASE BANDS — plan order is the draw order; a midnight-wrapping band
          arrives here already split into its two pieces. */}
      {bands.map((b, i) => {
        const tint = PHASE_TINTS[b.order % PHASE_TINTS.length];
        const top = yFor(b.fromMin);
        const h = Math.max(6, yFor(b.toMin) - top);
        return (
          <View
            key={`ph:${b.name}:${i}`}
            style={[styles.phaseBand, { top, height: h, borderColor: tint, backgroundColor: `${tint}22` }]}
          >
            <Text style={[styles.phaseName, { color: tint }]} numberOfLines={1}>
              {b.name}{b.wrapped ? ' ⤵' : ''}
            </Text>
          </View>
        );
      })}

      {/* Cue BLOCKS (durationMin > 0) and point MARKERS — the same visual
          grammar the FESTIVAL strip uses, at day scale. */}
      {day.cues.map((cue, i) => {
        const startMins = hhmmToMinutes(cue.atLocal);
        if (startMins === null) return null;
        const col = kindColor(cue.kind, C);
        const top = yFor(startMins);
        if (typeof cue.durationMin === 'number' && cue.durationMin > 0) {
          const h = Math.max(4, yFor(Math.min(DAY_MINUTES, startMins + cue.durationMin)) - top);
          return <View key={`${cue.id}:blk:${i}`} style={[styles.cueBlock, { top, height: h, backgroundColor: col }]} />;
        }
        return <View key={`${cue.id}:mk:${i}`} style={[styles.cueMarker, { top: top - 5, backgroundColor: col, borderColor: C.surfaceContainerLowest }]} />;
      })}

      {/* NOW playhead — today only. */}
      {nowMinutes !== null ? (
        <>
          <View style={[styles.nowLine, { top: yFor(nowMinutes), backgroundColor: C.error }]} />
          <View style={[styles.nowDot, { top: yFor(nowMinutes) - 4, backgroundColor: C.error }]} />
        </>
      ) : null}
    </View>
  );
}

// ── The level itself ────────────────────────────────────────────────────

export function DayView({
  day, dayCount, planCues, nowMinutes, activeCueId, canEdit,
  onBackToWeek, onPrevDay, onNextDay, onOpenEvent, onEditCue, onDeleteCue, onAddCue,
}: {
  /** Resolved overview for this day. */
  day: OverviewDay;
  /** Total festival days (gates prev/next). */
  dayCount: number;
  /** Draft plan cues — the EDITABLE objects behind the resolved rows. */
  planCues: PlanCue[];
  /** Minutes-of-day in the plan tz for the NOW playhead; null unless today. */
  nowMinutes: number | null;
  /** The cue the engine says owns the deck right now (marks the LIVE row). */
  activeCueId: string | null;
  /** False when there is no draft to edit (edit affordances are hidden). */
  canEdit: boolean;
  onBackToWeek: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** Tap an event → the EVENT sheet (PERFORM / TIME TRAVEL / Edit). */
  onOpenEvent: (cue: OverviewCue) => void;
  onEditCue: (cue: PlanCue) => void;
  onDeleteCue: (cueId: string) => void;
  onAddCue: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const rows = useMemo(() => ribbonRows(day.segments), [day.segments]);
  const planCueById = useMemo(() => {
    const m = new Map<string, PlanCue>();
    for (const c of planCues) m.set(c.id, c);
    return m;
  }, [planCues]);

  // Time-ordered agenda; time-less (manual / mood) cues sink to the bottom.
  const agenda = useMemo(() => {
    return [...day.cues].sort((a, b) => {
      const am = hhmmToMinutes(a.atLocal);
      const bm = hhmmToMinutes(b.atLocal);
      if (am === null && bm === null) return 0;
      if (am === null) return 1;
      if (bm === null) return -1;
      return am - bm;
    });
  }, [day.cues]);

  const hasReviewData = Array.isArray(day.segments) && Array.isArray(day.phases);

  return (
    <View style={styles.root}>
      {/* ── Header: back to WEEK, the day, prev/next, the reserved SHIFT slot ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBackToWeek} style={styles.weekBtn} accessibilityLabel="Back to the festival week">
          <IconSymbol name="chevron.left" size={14} color={C.text} />
          <Text style={styles.weekBtnText}>WEEK</Text>
        </TouchableOpacity>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {`DAY ${day.index + 1} · ${day.weekday.toUpperCase()}`}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {`${day.date}${day.sun.sunset ? ` · sunset ${hhmmTo12h(day.sun.sunset)}` : ''}`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onPrevDay}
          disabled={day.index <= 0}
          style={[styles.stepBtn, day.index <= 0 && styles.stepBtnOff]}
          accessibilityLabel="Previous day"
        >
          <Text style={styles.stepBtnText}>◀ PREV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onNextDay}
          disabled={day.index >= dayCount - 1}
          style={[styles.stepBtn, day.index >= dayCount - 1 && styles.stepBtnOff]}
          accessibilityLabel="Next day"
        >
          <Text style={styles.stepBtnText}>NEXT ▶</Text>
        </TouchableOpacity>

        {/* RESERVED SLOT (_94 §2.2.5): the postpone/shift affordance lands here
            when that build is green-lit. The day view is where a shift is
            REVIEWED — every band and block moves together — so this is its
            natural home. Inert and labelled as such; it never lies about
            being available. */}
        <View style={styles.shiftSlot} accessibilityLabel="Shift tonight — not built yet">
          <Text style={styles.shiftSlotText}>SHIFT TONIGHT · —</Text>
        </View>

        {canEdit ? (
          <TouchableOpacity onPress={onAddCue} style={styles.addBtn} accessibilityLabel="Add a cue to this day">
            <Text style={styles.addBtnText}>＋ CUE</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* ── The chart + the resolved ribbon, side by side on one 24 h scale ── */}
        <View style={styles.columnHeaderRow}>
          <Text style={[styles.columnHeader, { flex: 1 }]}>PLANNED · phases, sun & events</Text>
          <Text style={[styles.columnHeader, { width: 260 }]}>RESOLVED · what actually plays</Text>
        </View>

        {hasReviewData ? null : (
          <Text style={styles.loudNote}>
            This engine returned no `phases` / `segments` for the day — the resolved ribbon
            needs the timeline-zoom engine slice. Nothing below is a substitute for it.
          </Text>
        )}

        <View style={styles.chartRow}>
          <DayChart day={day} nowMinutes={nowMinutes} C={C} styles={styles} />
          <RibbonColumn rows={rows} C={C} styles={styles} />
        </View>

        <Text style={styles.midnightNote}>
          The ribbon resolves this CALENDAR DAY only — a cue that fired last night is not
          shown owning this morning (the engine&apos;s own day-latch semantics).
        </Text>

        {/* ── The agenda: tap an event to zoom into it ── */}
        <Text style={styles.sectionLabel}>EVENTS · tap to zoom in</Text>
        {agenda.length === 0 ? (
          <Text style={styles.empty}>No events on this day.</Text>
        ) : (
          agenda.map((cue) => {
            const col = kindColor(cue.kind, C);
            const planCue = planCueById.get(cue.id) ?? null;
            const isLive = activeCueId === cue.id;
            return (
              <TouchableOpacity
                key={cue.id}
                onPress={() => onOpenEvent(cue)}
                activeOpacity={0.85}
                style={[styles.eventRow, { borderLeftColor: col }, isLive && { borderColor: '#00a86b' }]}
                accessibilityLabel={`Zoom into ${cue.label || cue.id}`}
              >
                <View style={styles.eventTimeCol}>
                  <Text style={styles.eventTime}>{hhmmTo12h(cue.atLocal, '· · ·')}</Text>
                  <View style={[styles.kindDot, { backgroundColor: col }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.eventLabel} numberOfLines={1}>
                    {isLive ? '● LIVE  ' : ''}{cue.label || cue.id}
                  </Text>
                  <Text style={styles.eventMeta} numberOfLines={1}>
                    {`${KIND_LABEL[cue.kind]} · ${triggerSummary(cue.trigger)} · ${actionSummary(cue.action)}${
                      typeof cue.durationMin === 'number' && cue.durationMin > 0 ? ` · ${cue.durationMin}m block` : ''
                    }`}
                  </Text>
                </View>
                {canEdit && planCue ? (
                  <>
                    <TouchableOpacity
                      onPress={() => onEditCue(planCue)}
                      style={styles.rowBtn}
                      accessibilityLabel={`Edit cue ${cue.label || cue.id}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.rowBtnText}>EDIT</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onDeleteCue(cue.id)}
                      style={styles.rowBtn}
                      accessibilityLabel={`Delete cue ${cue.label || cue.id}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <IconSymbol name="trash" size={15} color={C.error} />
                    </TouchableOpacity>
                  </>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(C: Palette) {
  return StyleSheet.create({
    root: { flex: 1, gap: 10 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    weekBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    weekBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8, color: C.text },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 1,
      color: C.text, textTransform: 'uppercase',
    },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 2 },
    stepBtn: {
      paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    stepBtnOff: { opacity: 0.35 },
    stepBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.6, color: C.text },
    shiftSlot: {
      paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center', opacity: 0.45,
    },
    shiftSlotText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6, color: C.secondary },
    addBtn: {
      paddingHorizontal: 14, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    },
    addBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.6, color: C.onPrimary },

    columnHeaderRow: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 6 },
    columnHeader: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2,
      color: C.secondary, textTransform: 'uppercase',
    },
    loudNote: {
      fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.error,
      borderWidth: 1, borderColor: C.errorContainerBorder, backgroundColor: C.errorContainer,
      borderRadius: 8, padding: 10, marginBottom: 8,
    },
    midnightNote: {
      fontFamily: 'Inter_400Regular', fontSize: 10.5, color: C.secondary,
      marginTop: 8, marginBottom: 4,
    },

    chartRow: { flexDirection: 'row', gap: 10 },
    chart: {
      flex: 1,
      height: CHART_HEIGHT,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceDim,
      position: 'relative',
      overflow: 'hidden',
    },
    daylight: { position: 'absolute', left: 0, right: 0 },
    hourLine: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0.7 },
    hourLabel: {
      position: 'absolute', left: 4, top: 1,
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.icon,
      fontVariant: ['tabular-nums'],
    },
    phaseBand: {
      position: 'absolute', left: 62, right: 52,
      borderWidth: 1, borderRadius: 6,
      paddingHorizontal: 6, paddingTop: 2,
    },
    phaseName: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6 },
    cueBlock: { position: 'absolute', right: 8, width: 34, borderRadius: 4, opacity: 0.9 },
    cueMarker: {
      position: 'absolute', right: 10, width: 11, height: 11, borderRadius: 6, borderWidth: 1.5,
    },
    nowLine: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.95 },
    nowDot: { position: 'absolute', left: -1, width: 9, height: 9, borderRadius: 5 },

    ribbonColumn: {
      width: 260,
      height: CHART_HEIGHT,
      position: 'relative',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceDim,
      overflow: 'hidden',
    },
    ribbonSeg: {
      position: 'absolute', left: 4, right: 4,
      borderLeftWidth: 4, borderRadius: 6,
      paddingHorizontal: 8, paddingTop: 2,
      overflow: 'hidden',
    },
    ribbonPlaylist: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.4 },
    ribbonOwner: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, marginTop: 1 },
    ribbonNote: { fontFamily: 'Inter_400Regular', fontSize: 9.5, color: C.icon, marginTop: 1 },

    sectionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.4,
      color: C.secondary, textTransform: 'uppercase', marginTop: 14, marginBottom: 6,
    },
    empty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, paddingVertical: 12 },
    eventRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 12, paddingHorizontal: 14,
      borderRadius: 12, borderWidth: 1, borderLeftWidth: 4,
      borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest,
      marginBottom: 8,
    },
    eventTimeCol: { alignItems: 'center', width: 74, gap: 4 },
    eventTime: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.text },
    kindDot: { width: 8, height: 8, borderRadius: 4 },
    eventLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text },
    eventMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 3 },
    rowBtn: {
      minWidth: 44, height: 40, paddingHorizontal: 10,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    rowBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.6, color: C.text },
  });
}
