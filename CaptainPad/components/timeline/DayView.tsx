/**
 * DayView — the DAY rung of the zoom ladder (report _94 §2.2), redrawn on the
 * FRAME MODEL (report _359 §D.6).
 *
 *   FESTIVAL (week strip) ──tap a card──▶ DAY ──tap an event──▶ EVENT (the deck)
 *
 * The level shows ONE span of the active frame — NIGHT k (6 PM → 6 PM) or DAY k
 * (midnight → midnight) — and nothing about it is inferred:
 *
 *   1. STRUCTURAL BARS — NOW, SUNSET, DUSK, SUNRISE, DAWN, each with a labelled
 *      gutter entry in the shared legend (C-02). The morning pair comes from the
 *      engine's per-day `nextSun`, so the LAST night has a real sunrise too. The
 *      red NOW line is always drawn on the span that carries it — including
 *      before NIGHT 1 opens, at the position whose clock label matches NOW.
 *   2. PARTY WINDOW    — from the engine's per-day `partyWindow` ALONE, so a
 *      night the party cue does not apply to shows no band at all (C-03).
 *   3. PHASE BANDS     — every OTHER phase, resolved against its own day's sun.
 *   4. THE RESOLVED RIBBON — per-day `segments`: what actually OWNS the deck.
 *
 * This is a pure BROWSE level: it makes ZERO engine calls of its own, so
 * reviewing the timeline can never touch the rig. Tapping a cue opens the EVENT
 * sheet; tapping empty time opens the MOMENT sheet. A tap in the LAST night's
 * hatched tail — a date past the festival, where the engine cannot hold a cue —
 * opens nothing and says why.
 *
 * The ribbon is the HONESTY layer. It shows, correctly, that a hold expiring
 * lands on the autopilot baseline (_91 G1, `source:'hold-expired-baseline'`).
 * It renders the truth of the shipped plan; it does NOT fix it.
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, PanResponder, ScrollView, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette, useTheme } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OverviewCue, OverviewDay, PlanCue } from '@/utils/timelineApi';
import {
  hhmmTo12h, kindColor, KIND_LABEL,
  triggerSummary, actionSummary,
} from './timelineTemplate';
import { localToMinutes, ribbonSourceNote } from './zoom_logic';
import { CalendarLegend } from './calendar_legend';
import { isPartyWindowCue } from './party_window_logic';
import {
  frameCueEntries,
  frameDaysSummary,
  frameExplainer,
  frameGutterLabels,
  frameHatchOffset,
  frameHeader,
  frameHourLabels,
  frameHourOffsets,
  frameInstantAt,
  frameMidnightOffset,
  frameMissingSunNote,
  frameNowMarker,
  frameNowSentence,
  framePartyBands,
  framePhaseBands,
  frameRibbonEntries,
  frameSpan,
  frameSunLabelColor,
  frameSunMarkers,
  FRAME_MIDNIGHT_COLOR,
  FRAME_PARTY_COLOR,
  FRAME_SUN_COLORS,
  type DayFrame,
  type FrameCueEntry,
  type FrameRibbonEntry,
  type FrameSpan,
} from './day_frame_logic';

// 30 px per hour — a whole day is legible on an iPad without pinching, and an
// hour is a comfortable touch target for the bands.
const CHART_HEIGHT = 720;
/**
 * §D.2 puts the DAY chart's gutter at 84 px. 92 is the smallest width that
 * holds the LONGEST label the frame can produce — "SUNRISE 6:18 AM" and the
 * midnight stamp "12:00 AM (TUE)" — without an ellipsis. A truncated marker
 * label is not a marker label.
 */
const GUTTER_WIDTH = 92;

// Phase band tints, cycled by PLAN ORDER (never by name, so a rename can't
// re-colour the whole day). Fixed hexes: a band is a structural marker, not a
// theme accent.
const PHASE_TINTS = ['#5b6cf5', '#22c1d6', '#f5a623', '#c05bf5', '#3fbf7f'];

const AMBER = '#f5a623';

const TAIL_HINT =
  'That time is past the last festival night — nothing can be scheduled or replayed there.';

function yFor(offset: number, span: FrameSpan): number {
  return (Math.max(0, Math.min(span.durationMin, offset)) / span.durationMin) * CHART_HEIGHT;
}

/**
 * Keep a gutter label fully inside the chart. The 6 PM and 6 PM +1 ruler ticks
 * sit exactly on the chart's edges, and a label centred on them would be
 * clipped by `overflow: hidden` — an unreadable label is worse than a nudged one.
 */
function clampLabelTop(labelY: number, labelHeight: number): number {
  return Math.max(0, Math.min(CHART_HEIGHT - labelHeight, labelY - labelHeight / 2));
}

// ── The resolved-ribbon column ──────────────────────────────────────────

function RibbonColumn({
  rows, span, C, styles,
}: {
  rows: FrameRibbonEntry[];
  span: FrameSpan;
  C: Palette;
  styles: Styles;
}) {
  return (
    <View style={styles.ribbonColumn}>
      {rows.map(({ row: r, date, fromLocal, toLocal, fromOffset, toOffset }) => {
        const top = yFor(fromOffset, span);
        const h = Math.max(14, yFor(toOffset, span) - top);
        // Warn (hold-expired-baseline) is amber; a real cue owner reads in the
        // theme accent; the fallbacks recede to the muted icon colour.
        const accent = r.warn ? AMBER : (r.ownerKind === 'cue' ? C.primary : C.icon);
        return (
          <View
            key={`${date}:${r.key}`}
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
                {`${fromLocal}–${toLocal} · ${r.ownerLabel}`}
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

// ── The day chart (hours · sun · phase bands · party · cues · NOW) ──────

function DayChart({
  span, nowMinutes, nowDate, onOpenEvent, onOpenMoment, onTailTap, scheme, C, styles,
}: {
  span: FrameSpan;
  scheme: 'light' | 'dark';
  nowMinutes: number | null;
  nowDate: string | null;
  /** Tap a cue BLOCK / MARKER on the calendar → the EVENT sheet for that cue. */
  onOpenEvent: (cue: OverviewCue, date: string) => void;
  /** Tap EMPTY calendar time → the MOMENT sheet (time travel to that instant). */
  onOpenMoment: (time: string, date: string) => void;
  /** Tap in the hatched, past-the-festival tail → say so, open nothing. */
  onTailTap: () => void;
  C: Palette;
  styles: Styles;
}) {
  const phases = useMemo(() => framePhaseBands(span), [span]);
  const cues = useMemo(() => frameCueEntries(span), [span]);
  const partyBands = useMemo(() => framePartyBands(span), [span]);
  const sun = useMemo(() => frameSunMarkers(span), [span]);
  const now = frameNowMarker(span, nowDate, nowMinutes);
  const gutter = useMemo(
    () => frameGutterLabels({
      sun,
      hours: frameHourLabels(span),
      now,
      height: CHART_HEIGHT,
      durationMin: span.durationMin,
    }),
    [now, span, sun],
  );
  const hourOffsets = frameHourOffsets(span);
  const midnightOffset = frameMidnightOffset(span);
  const hatchOffset = frameHatchOffset(span);

  // The calendar itself is a TIME-TRAVEL entry point. Tap capture is the
  // DayTimePicker idiom — a PanResponder (RN-web only normalizes
  // locationX/locationY for RESPONDER events; a Pressable's press event
  // carries none on web) on an absolute-fill underlay, with every decorative
  // layer pointerEvents:none so the grant's locationY is chart-relative. Cue
  // blocks/markers render ABOVE the underlay as their own touchables and win
  // the tap for their cue. The responder is created ONCE, so its closure reads
  // the live handler through a ref (the fader idiom). A tap whose geometry
  // can't be read opens NOTHING (no guessed time, ever); a real drag (> 8 px)
  // is not a tap and opens nothing either.
  const openMomentRef = useRef<(y: number) => void>(() => undefined);
  openMomentRef.current = (y: number) => {
    const offset = (Math.max(0, Math.min(CHART_HEIGHT, y)) / CHART_HEIGHT) * span.durationMin;
    const target = frameInstantAt(span, offset);
    if (target) onOpenMoment(target.time, target.date);
    else onTailTap();
  };
  const grantYRef = useRef(0);
  const momentResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => { grantYRef.current = evt.nativeEvent.locationY; },
      onPanResponderRelease: (_evt, gs) => {
        if (Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8) return; // drag, not a tap
        openMomentRef.current(grantYRef.current);
      },
    }),
  ).current;

  return (
    <View style={styles.chart}>
      <View
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Day calendar — tap a cue block to zoom into it, or an empty time to time travel there"
        {...momentResponder.panHandlers}
      />
      <View pointerEvents="none" style={[styles.nightBackdrop, { backgroundColor: '#5b6cf518' }]} />

      {/* The morning half of the LAST night lies past the festival. */}
      {hatchOffset !== null ? (
        <View
          pointerEvents="none"
          style={[
            styles.hatch,
            { top: yFor(hatchOffset, span), backgroundColor: C.surfaceContainerHigh },
          ]}
        >
          <Text style={styles.hatchText}>AFTER THE FESTIVAL — nothing can be scheduled here</Text>
        </View>
      ) : null}

      {/* One aligned line per hour; labels come from the gutter layout. The
          MIDNIGHT line is the one that changes the DATE, so it is the one hour
          line with its own colour — a muted green (FRAME_MIDNIGHT_COLOR). */}
      {hourOffsets.map((offset) => {
        const isMidnight = offset === midnightOffset;
        return (
          <View
            key={`h${offset}`}
            pointerEvents="none"
            style={[
              styles.hourLine,
              {
                top: Math.min(CHART_HEIGHT - 1, yFor(offset, span)),
                backgroundColor: isMidnight ? FRAME_MIDNIGHT_COLOR : C.ghostBorder,
              },
              isMidnight && styles.midnightLine,
            ]}
          />
        );
      })}

      {/* PHASE BANDS — plan order is the draw order; the party phase is never
          here (it is drawn from partyWindow instead — C-03). */}
      {phases.map((entry) => {
        const tint = PHASE_TINTS[entry.order % PHASE_TINTS.length];
        const top = yFor(entry.fromOffset, span);
        const h = Math.max(6, yFor(entry.toOffset, span) - top);
        return (
          <View
            key={entry.key}
            pointerEvents="none"
            style={[styles.phaseBand, { top, height: h, borderColor: tint, backgroundColor: `${tint}22` }]}
          >
            <Text style={[styles.phaseName, { color: tint }]} numberOfLines={1}>
              {entry.phase.name}
            </Text>
          </View>
        );
      })}

      {/* PARTY WINDOW band(s). */}
      {partyBands.map((band, i) => {
        const top = yFor(band.fromOffset, span);
        const h = Math.max(6, yFor(band.toOffset, span) - top);
        return (
          <View key={`party:${i}`} pointerEvents="none" style={[styles.partyBand, { top, height: h }]}>
            <Text style={styles.partyBandLabel} numberOfLines={1}>
              {band.continuesFrom !== undefined
                ? `PARTY WINDOW · continues from DAY ${band.continuesFrom + 1}`
                : `PARTY WINDOW · ${band.label}`}
            </Text>
          </View>
        );
      })}

      {/* SUN bars — dashed, under the cue blocks, over the phase bands. */}
      {sun.map((marker) => (
        <View
          key={`bar:${marker.id}`}
          pointerEvents="none"
          style={[
            styles.sunBar,
            { top: yFor(marker.offset, span) - 1, borderTopColor: FRAME_SUN_COLORS[marker.id] },
          ]}
        />
      ))}

      {/* Cue BLOCKS (durationMin > 0) and point MARKERS — both TAP TARGETS. */}
      {cues.map((entry, i) => {
        const { cue, date, offset, endOffset } = entry;
        if (offset === null) return null;
        const col = isPartyWindowCue(cue) ? FRAME_PARTY_COLOR : kindColor(cue.kind, C);
        const top = yFor(offset, span);
        if (typeof cue.durationMin === 'number' && cue.durationMin > 0) {
          const h = Math.max(8, yFor(endOffset ?? offset, span) - top);
          const startMin = localToMinutes(cue.atLocal);
          const startClock = cue.atLocal ? hhmmTo12h(cue.atLocal) : null;
          const endClock = startMin !== null
            ? hhmmTo12h(minutesToHHMM((startMin + Math.floor(cue.durationMin)) % 1440))
            : null;
          return (
            <TouchableOpacity
              key={`${date}:${cue.id}:blk:${i}`}
              onPress={() => onOpenEvent(cue, date)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Zoom into ${cue.label || cue.id}`}
              style={[styles.cueBlock, { top, height: h, backgroundColor: col }]}
            >
              {h >= 22 ? (
                <Text style={styles.cueBlockLabel} numberOfLines={1}>
                  {cue.label || KIND_LABEL[cue.kind]}
                </Text>
              ) : null}
              {h >= 42 && startClock && endClock ? (
                <Text style={styles.cueBlockRange} numberOfLines={1}>
                  {`${startClock} → ${endClock}`}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        }
        return (
          <TouchableOpacity
            key={`${date}:${cue.id}:mk:${i}`}
            onPress={() => onOpenEvent(cue, date)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Zoom into ${cue.label || cue.id}`}
            style={[styles.cueMarker, { top: top - 5, backgroundColor: col, borderColor: C.surfaceContainerLowest }]}
          />
        );
      })}

      {/* NOW — 2 px solid across gutter + chart, z-top (C-01/D.2). */}
      {now ? (
        <View
          pointerEvents="none"
          style={[styles.nowLine, { top: yFor(now.offset, span), backgroundColor: C.error }]}
        />
      ) : null}

      {/* The gutter: NOW pill, sun labels in their bar colour, hour labels. */}
      {gutter.map((label) => {
        if (label.kind === 'now') {
          return (
            <View
              key={label.key}
              pointerEvents="none"
              style={[
                styles.nowPill,
                { top: clampLabelTop(label.labelY, 18), backgroundColor: C.error },
              ]}
            >
              <Text style={styles.nowPillText} numberOfLines={1}>{label.text}</Text>
            </View>
          );
        }
        const color = label.kind === 'sun' && label.id
          ? frameSunLabelColor(label.id, scheme)
          : (label.midnight ? FRAME_MIDNIGHT_COLOR : C.secondary);
        return (
          <React.Fragment key={label.key}>
            {label.stacked ? (
              <View pointerEvents="none" style={[styles.leader, { top: label.y, backgroundColor: color }]} />
            ) : null}
            <Text
              pointerEvents="none"
              numberOfLines={1}
              style={[
                label.kind === 'sun' ? styles.gutterSun : styles.gutterHour,
                { top: clampLabelTop(label.labelY, 14), color },
              ]}
            >
              {label.text}
            </Text>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function minutesToHHMM(mins: number): string {
  const norm = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

/** The tag under an agenda row's time: WHERE in the span this cue sits. */
function timingTag(entry: FrameCueEntry, span: FrameSpan): string {
  if (entry.timing === 'lead-in') return 'BEFORE 6 PM';
  if (entry.timing === 'manual') return 'ON DEMAND';
  if (span.frame === 'regular') return 'THIS DAY';
  const midnight = frameMidnightOffset(span);
  return midnight !== null && entry.offset !== null && entry.offset >= midnight
    ? 'MORNING HALF'
    : 'TONIGHT';
}

// ── The level itself ────────────────────────────────────────────────────

export interface DayViewProps {
  /** The whole festival, in calendar days — the frame slices it. */
  days: OverviewDay[];
  frame: DayFrame;
  /** Which span of the frame to show. */
  index: number;
  /** Draft plan cues — the EDITABLE objects behind the resolved rows. */
  planCues: PlanCue[];
  /** Minutes-of-day in the plan tz for the NOW playhead; null when unknown. */
  nowMinutes: number | null;
  nowDate: string | null;
  /** The cue the engine says owns the deck right now (marks the LIVE row). */
  activeCueId: string | null;
  /** False when there is no draft to edit (edit affordances are hidden). */
  canEdit: boolean;
  /**
   * Whether to render the "RESOLVED · what actually plays" ribbon column. The
   * ribbon reveals the engine's live baseline programming which is
   * authoritative on the LIVE view but confusing when the operator is browsing
   * a selected/draft plan — hiding it keeps the CALENDAR / EDIT rungs to the
   * cues the operator authored.
   */
  showRibbon?: boolean;
  onBackToWeek: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** Tap an event (agenda row OR calendar block) → the EVENT sheet. */
  onOpenEvent: (cue: OverviewCue, date: string) => void;
  /**
   * Tap EMPTY calendar time → the MOMENT sheet: time travel to that instant.
   * Still browse-safe: the tap only opens a sheet — the rig moves only on the
   * sheet's explicit TIME TRAVEL button.
   */
  onOpenMoment: (time: string, date: string) => void;
  onEditCue: (cue: PlanCue) => void;
  onDeleteCue: (cueId: string) => void;
  onAddCue: () => void;
}

export function DayView({
  days, frame, index, planCues, nowMinutes, nowDate, activeCueId, canEdit,
  showRibbon = true,
  onBackToWeek, onPrevDay, onNextDay, onOpenEvent, onOpenMoment, onEditCue, onDeleteCue, onAddCue,
}: DayViewProps) {
  const C = usePalette();
  const { scheme } = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [tailHint, setTailHint] = useState<string | null>(null);

  const span = useMemo(() => frameSpan(frame, days, index), [days, frame, index]);
  const header = frameHeader(span);
  const rows = useMemo(() => frameRibbonEntries(span), [span]);
  const agenda = useMemo(() => frameCueEntries(span), [span]);
  const planCueById = useMemo(() => {
    const m = new Map<string, PlanCue>();
    for (const c of planCues) m.set(c.id, c);
    return m;
  }, [planCues]);

  const nowSentence = frameNowSentence(frame, days, nowDate, nowMinutes);
  const missingSun = frameMissingSunNote(span);
  const hasReviewData = Array.isArray(span.day.segments)
    && Array.isArray(span.day.phases)
    && (!span.nextDay || (Array.isArray(span.nextDay.segments) && Array.isArray(span.nextDay.phases)));

  return (
    <View style={styles.root}>
      {/* ── Header: back to WEEK, the span, prev/next ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBackToWeek}
          style={styles.weekBtn}
          accessibilityRole="button"
          accessibilityLabel="Back to the festival week"
        >
          <IconSymbol name="chevron.left" size={14} color={C.text} />
          <Text style={styles.weekBtnText}>WEEK</Text>
        </TouchableOpacity>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{header.title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{header.subtitle}</Text>
        </View>

        <TouchableOpacity
          onPress={onPrevDay}
          disabled={span.index <= 0}
          style={[styles.stepBtn, span.index <= 0 && styles.stepBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Text style={styles.stepBtnText}>◀ PREV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onNextDay}
          disabled={span.index >= span.count - 1}
          style={[styles.stepBtn, span.index >= span.count - 1 && styles.stepBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Text style={styles.stepBtnText}>NEXT ▶</Text>
        </TouchableOpacity>

        {canEdit ? (
          <TouchableOpacity
            onPress={onAddCue}
            style={styles.addBtn}
            accessibilityRole="button"
            accessibilityLabel="Add a cue to this day"
          >
            <Text style={styles.addBtnText}>＋ CUE</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.columnHeaderRow}>
          <Text style={[styles.columnHeader, { flex: 1 }]}>
            {showRibbon
              ? 'PLANNED · tap a block or an empty time to zoom'
              : 'AUTHORED CUES · tap a block or an empty time to zoom'}
          </Text>
          {showRibbon ? (
            <Text style={[styles.columnHeader, { width: 260 }]}>RESOLVED · what actually plays</Text>
          ) : null}
        </View>

        {/* C-01: when NOW is inside no span, say exactly where it is. */}
        {nowSentence ? <Text style={styles.nowSentence}>{nowSentence}</Text> : null}
        {header.tailNote ? <Text style={styles.tailNote}>{header.tailNote}</Text> : null}
        {missingSun ? <Text style={styles.loudNote}>{missingSun}</Text> : null}
        {tailHint ? <Text style={styles.tailNote}>{tailHint}</Text> : null}

        <CalendarLegend />

        {showRibbon && !hasReviewData ? (
          <Text style={styles.loudNote}>
            This engine returned no `phases` / `segments` for the day — the resolved ribbon
            needs the timeline-zoom engine slice. Nothing below is a substitute for it.
          </Text>
        ) : null}

        <View style={styles.chartRow}>
          <DayChart
            span={span}
            nowMinutes={nowMinutes}
            nowDate={nowDate}
            onOpenEvent={onOpenEvent}
            onOpenMoment={(time, date) => { setTailHint(null); onOpenMoment(time, date); }}
            onTailTap={() => setTailHint(TAIL_HINT)}
            scheme={scheme}
            C={C}
            styles={styles}
          />
          {showRibbon ? <RibbonColumn rows={rows} span={span} C={C} styles={styles} /> : null}
        </View>

        <Text style={styles.frameNote}>{frameExplainer(frame)}</Text>

        {/* ── The agenda: tap an event to zoom into it ── */}
        <Text style={styles.sectionLabel}>EVENTS · tap to zoom in</Text>
        {agenda.length === 0 ? (
          <Text style={styles.empty}>No events on this day.</Text>
        ) : (
          agenda.map((entry) => {
            const { cue, date, weekday } = entry;
            const col = isPartyWindowCue(cue) ? FRAME_PARTY_COLOR : kindColor(cue.kind, C);
            const planCue = planCueById.get(cue.id) ?? null;
            const isLive = activeCueId === cue.id;
            const recurrence = planCue
              ? ` · ${frameDaysSummary(frame, planCue.days, cue.atLocal, span.count).toLowerCase()}`
              : '';
            return (
              <TouchableOpacity
                key={`${date}:${cue.id}`}
                onPress={() => onOpenEvent(cue, date)}
                activeOpacity={0.85}
                style={[styles.eventRow, { borderLeftColor: col }, isLive && { borderColor: '#00a86b' }]}
                accessibilityRole="button"
                accessibilityLabel={`Zoom into ${cue.label || cue.id}`}
              >
                <View style={styles.eventTimeCol}>
                  <Text style={styles.eventTime} numberOfLines={1}>
                    {frame === 'working'
                      ? `${weekday} ${hhmmTo12h(cue.atLocal, '· · ·')}`
                      : hhmmTo12h(cue.atLocal, '· · ·')}
                  </Text>
                  <Text style={styles.eventDate}>{timingTag(entry, span)}</Text>
                  <View style={[styles.kindDot, { backgroundColor: col }]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.eventLabel} numberOfLines={1}>
                    {isLive ? '● LIVE  ' : ''}{cue.label || cue.id}
                  </Text>
                  <Text style={styles.eventMeta} numberOfLines={1}>
                    {`${KIND_LABEL[cue.kind]} · ${triggerSummary(cue.trigger)} · ${actionSummary(cue.action)}${
                      typeof cue.durationMin === 'number' && cue.durationMin > 0 ? ` · ${cue.durationMin}m block` : ''
                    }${recurrence}`}
                  </Text>
                </View>
                {canEdit && planCue ? (
                  <>
                    <TouchableOpacity
                      onPress={() => onEditCue(planCue)}
                      style={styles.rowBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit cue ${cue.label || cue.id}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.rowBtnText}>EDIT</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onDeleteCue(cue.id)}
                      style={styles.rowBtn}
                      accessibilityRole="button"
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
    weekBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 0.8, color: C.text },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, letterSpacing: 0.8,
      color: C.text, textTransform: 'uppercase',
    },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.secondary, marginTop: 2 },
    stepBtn: {
      paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    stepBtnOff: { opacity: 0.35 },
    stepBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 0.6, color: C.text },
    addBtn: {
      paddingHorizontal: 14, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    },
    addBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 0.6, color: C.onPrimary },

    columnHeaderRow: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 6 },
    columnHeader: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, letterSpacing: 1,
      color: C.secondary, textTransform: 'uppercase',
    },
    loudNote: {
      fontFamily: 'Inter_600SemiBold', fontSize: 16, color: C.error,
      borderWidth: 1, borderColor: C.errorContainerBorder, backgroundColor: C.errorContainer,
      borderRadius: 8, padding: 10, marginBottom: 8,
    },
    nowSentence: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, letterSpacing: 0.4,
      color: C.error, marginBottom: 6,
    },
    tailNote: {
      fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary, marginBottom: 6,
    },
    frameNote: {
      fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary,
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
    nightBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    hatch: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      opacity: 0.5, alignItems: 'center', paddingTop: 8,
    },
    hatchText: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.8, color: C.secondary,
    },
    hourLine: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0.7 },
    // The date-changing line: same hairline geometry, full opacity so the muted
    // green reads without being brightened.
    midnightLine: { opacity: 1 },
    sunBar: {
      position: 'absolute', left: GUTTER_WIDTH, right: 0,
      height: 0, borderTopWidth: 2, borderStyle: 'dashed', zIndex: 2,
    },
    gutterSun: {
      position: 'absolute', left: 4, width: GUTTER_WIDTH - 6,
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0, zIndex: 3,
    },
    gutterHour: {
      position: 'absolute', left: 4, width: GUTTER_WIDTH - 6,
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0,
      fontVariant: ['tabular-nums'],
    },
    leader: {
      position: 'absolute', left: 4, width: GUTTER_WIDTH - 10, height: 1, opacity: 0.6, zIndex: 3,
    },
    phaseBand: {
      position: 'absolute', left: GUTTER_WIDTH + 4, right: 190,
      borderWidth: 1, borderRadius: 6,
      paddingHorizontal: 6, paddingTop: 2,
    },
    phaseName: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, letterSpacing: 0.6 },
    partyBand: {
      position: 'absolute', left: GUTTER_WIDTH + 4, right: 190,
      borderWidth: 1, borderRadius: 6,
      borderColor: FRAME_PARTY_COLOR, backgroundColor: `${FRAME_PARTY_COLOR}22`,
      paddingHorizontal: 6, paddingTop: 2,
    },
    partyBandLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, letterSpacing: 0.6,
      color: FRAME_PARTY_COLOR,
    },
    cueBlock: {
      position: 'absolute', right: 8, width: 168, borderRadius: 5, opacity: 0.94,
      paddingHorizontal: 7, justifyContent: 'center', zIndex: 3,
    },
    cueBlockLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.3,
      color: '#101114',
    },
    cueBlockRange: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.2,
      color: '#101114', marginTop: 2, opacity: 0.85,
    },
    cueMarker: {
      position: 'absolute', right: 10, width: 11, height: 11, borderRadius: 6, borderWidth: 1.5,
      zIndex: 3,
    },
    nowLine: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.95, zIndex: 4 },
    nowPill: {
      position: 'absolute', left: 4, maxWidth: GUTTER_WIDTH - 6, height: 18,
      borderRadius: 4, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center',
      zIndex: 5,
    },
    nowPillText: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.2, color: '#ffffff',
    },

    ribbonColumn: {
      width: 300,
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
    ribbonPlaylist: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 0.3 },
    ribbonOwner: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary, marginTop: 1 },
    ribbonNote: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, marginTop: 1 },

    sectionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 1.1,
      color: C.secondary, textTransform: 'uppercase', marginTop: 14, marginBottom: 6,
    },
    empty: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.secondary, paddingVertical: 12 },
    eventRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 12, paddingHorizontal: 14,
      borderRadius: 12, borderWidth: 1, borderLeftWidth: 4,
      borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest,
      marginBottom: 8,
    },
    eventTimeCol: { alignItems: 'center', width: 104, gap: 4 },
    eventTime: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text },
    eventDate: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.6,
      color: C.secondary,
    },
    kindDot: { width: 8, height: 8, borderRadius: 4 },
    eventLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: C.text },
    eventMeta: { fontFamily: 'Inter_400Regular', fontSize: 16, color: C.secondary, marginTop: 3 },
    rowBtn: {
      minWidth: 48, height: 48, paddingHorizontal: 10,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    rowBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, letterSpacing: 0.6, color: C.text },
  });
}
