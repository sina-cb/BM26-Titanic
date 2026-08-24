/**
 * DayView — the DAY rung of the zoom ladder (report _94 §2.2).
 *
 *   FESTIVAL (8-day strip) ──tap a day──▶ DAY ──tap an event──▶ EVENT (the deck)
 *
 * This is a pure BROWSE level: it makes ZERO engine calls of its own, so
 * reviewing the timeline can never touch the rig. The CALENDAR itself is a
 * zoom entry point (operator ruling 2026-08-03): tapping a cue block/marker
 * opens the EVENT sheet for that cue, and tapping EMPTY time opens the MOMENT
 * sheet (time travel to that instant) — both still just open a sheet; the rig
 * moves only on the sheet's explicit button. It replaces the old DayEditor
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
import React, { useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, PanResponder, ScrollView, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OverviewDay, OverviewCue, PlanCue } from '@/utils/timelineApi';
import {
  hhmmTo12h, minutesTo12h, kindColor, KIND_LABEL,
  triggerSummary, actionSummary,
} from './timelineTemplate';
import {
  localToMinutes,
  ribbonSourceNote,
} from './zoom_logic';
import { CalendarLegend } from './calendar_legend';
import { isPartyWindowCue } from './party_window_logic';
import {
  nightAxisFor,
  nightCueEntries,
  nightLeadInCueEntries,
  nightOffset,
  nightPhaseEntries,
  nightRibbonEntries,
  nightTapTarget,
  timelineHourOffsets,
  yForNightOffset,
  type NightAxis,
  type NightRibbonEntry,
} from './night_calendar_logic';

// 30 px per hour — a whole day is legible on an iPad without pinching, and an
// hour is a comfortable touch target for the bands.
const CHART_HEIGHT = 720;
const HOUR_LABEL_STEP_MIN = 180;

// Phase band tints, cycled by PLAN ORDER (never by name, so a rename can't
// re-colour the whole day). Fixed hexes: a band is a structural marker, not a
// theme accent.
const PHASE_TINTS = ['#5b6cf5', '#22c1d6', '#f5a623', '#c05bf5', '#3fbf7f'];

const AMBER = '#f5a623';

// ── The resolved-ribbon column ──────────────────────────────────────────

function RibbonColumn({
  rows, axis, C, styles,
}: {
  rows: NightRibbonEntry[];
  axis: NightAxis;
  C: Palette;
  styles: Styles;
}) {
  const yFor = (offset: number) => yForNightOffset(offset, CHART_HEIGHT, axis) ?? 0;
  return (
    <View style={styles.ribbonColumn}>
      {rows.map(({ row: r, date, fromLocal, toLocal, fromOffset, toOffset }) => {
        const top = yFor(fromOffset);
        const h = Math.max(14, yFor(toOffset) - top);
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

// ── The day chart (hours · sun · phase bands · cues · NOW) ──────────────

function DayChart({
  day, nextDay, nowMinutes, nowDate, onOpenEvent, onOpenMoment, C, styles,
}: {
  day: OverviewDay;
  nextDay: OverviewDay | null;
  nowMinutes: number | null;
  nowDate: string | null;
  /** Tap a cue BLOCK / MARKER on the calendar → the EVENT sheet for that cue. */
  onOpenEvent: (cue: OverviewCue, date: string) => void;
  /** Tap EMPTY calendar time → the MOMENT sheet (time travel to that instant). */
  onOpenMoment: (time: string, date: string) => void;
  C: Palette;
  styles: Styles;
}) {
  const axis = useMemo(() => nightAxisFor(day, nextDay), [day, nextDay]);
  const phases = useMemo(
    () => axis ? nightPhaseEntries(day, nextDay, axis) : [],
    [axis, day, nextDay],
  );
  const cues = useMemo(
    () => axis ? nightCueEntries(day, nextDay, axis) : [],
    [axis, day, nextDay],
  );
  const yFor = (offset: number | null) => axis
    ? yForNightOffset(offset, CHART_HEIGHT, axis)
    : null;
  const hourOffsets = axis ? timelineHourOffsets(axis.durationMin) : [];
  const sunsetY = axis
    ? yFor(nightOffset(localToMinutes(day.sun.sunset) ?? -1, 0, axis))
    : null;
  const sunriseY = axis && nextDay
    ? yFor(nightOffset(localToMinutes(nextDay.sun.sunrise) ?? -1, 1, axis))
    : null;

  // The calendar itself is a TIME-TRAVEL entry point. Tap capture is the
  // DayTimePicker idiom — a PanResponder (RN-web only normalizes
  // locationX/locationY for RESPONDER events; a Pressable's press event
  // carries none on web) on an absolute-fill underlay, with every decorative
  // layer (daylight, hour grid, phase bands, NOW) pointerEvents:none so the
  // grant's locationY is chart-relative. Cue blocks/markers render ABOVE the
  // underlay as their own touchables and win the tap for their cue. The
  // responder is created ONCE, so its closure reads the live handler through
  // a ref (the fader idiom). A tap whose geometry can't be read maps to null
  // and opens NOTHING (no guessed time, ever); a real drag (> 8 px) is not a
  // tap and opens nothing either.
  const openMomentRef = useRef<(y: number) => void>(() => undefined);
  openMomentRef.current = (y: number) => {
    if (!axis) return;
    const target = nightTapTarget(y, CHART_HEIGHT, axis, day, nextDay);
    if (target) onOpenMoment(target.time, target.date);
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

  if (!axis) {
    return <Text style={styles.loudNote}>THE 6 PM OPERATOR DAY COULD NOT BE DRAWN.</Text>;
  }

  const nowDayOffset = nowDate === day.date ? 0 : (nextDay && nowDate === nextDay.date ? 1 : null);
  const nowY = nowMinutes !== null && nowDayOffset !== null
    ? yFor(nightOffset(nowMinutes, nowDayOffset, axis))
    : null;

  return (
    <View style={styles.chart}>
      <View
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Day calendar — tap a cue block to zoom into it, or an empty time to time travel there"
        {...momentResponder.panHandlers}
      />
      <View pointerEvents="none" style={[styles.nightBackdrop, { backgroundColor: '#5b6cf518' }]} />

      {/* One aligned line per hour; retain the clean three-hour label cadence. */}
      {hourOffsets.map((offset) => (
        <View
          key={`h${offset}`}
          pointerEvents="none"
          style={[
            styles.hourLine,
            {
              top: Math.min(CHART_HEIGHT - 1, yFor(offset) ?? 0),
              backgroundColor: C.ghostBorder,
            },
          ]}
        >
          {offset % HOUR_LABEL_STEP_MIN === 0 ? (
            <Text style={styles.hourLabel}>
              {offset === axis.durationMin
                ? '6:00 PM +1'
                : minutesTo12h((axis.sunsetMin + offset) % 1440)}
            </Text>
          ) : null}
        </View>
      ))}
      {sunsetY !== null ? (
        <View pointerEvents="none" style={[styles.sunEdgeLine, { top: sunsetY, backgroundColor: '#5b6cf5' }]} />
      ) : null}
      {sunriseY !== null ? (
        <View pointerEvents="none" style={[styles.sunEdgeLine, { top: sunriseY, backgroundColor: '#f5a623' }]} />
      ) : null}

      {/* PHASE BANDS — plan order is the draw order; a midnight-wrapping band
          arrives here already split into its two pieces. Bands are DECOR for
          tap purposes: a tap inside one is an empty-time tap at that instant. */}
      {phases.map((entry) => {
        const partyWindow = entry.phase.name.startsWith('pw_');
        const tint = partyWindow ? '#b56dff' : PHASE_TINTS[entry.order % PHASE_TINTS.length];
        const top = yFor(entry.fromOffset) ?? 0;
        const h = Math.max(6, (yFor(entry.toOffset) ?? 0) - top);
        return (
          <View
            key={entry.key}
            pointerEvents="none"
            style={[styles.phaseBand, { top, height: h, borderColor: tint, backgroundColor: `${tint}22` }]}
          >
            <Text style={[styles.phaseName, { color: tint }]} numberOfLines={1}>
              {partyWindow ? 'PARTY WINDOW' : entry.phase.name}
            </Text>
          </View>
        );
      })}

      {/* Cue BLOCKS (durationMin > 0) and point MARKERS — the same visual
          grammar the FESTIVAL strip uses, at day scale. Both are TAP TARGETS
          now: tapping one zooms into that cue (the same EVENT sheet the agenda
          rows open — perform if live, time travel otherwise). */}
      {cues.map(({ cue, date, startOffset, endOffset }, i) => {
        if (startOffset === null) return null;
        const col = isPartyWindowCue(cue) ? '#b56dff' : kindColor(cue.kind, C);
        const top = yFor(startOffset) ?? 0;
        if (typeof cue.durationMin === 'number' && cue.durationMin > 0) {
          const h = Math.max(8, (yFor(endOffset) ?? CHART_HEIGHT) - top);
          // Human range for the block label so the calendar's tall
          // ranges reveal exactly the "start → end" the operator authored.
          const startClock = cue.atLocal ? hhmmTo12h(cue.atLocal) : null;
          const startMin = cue.atLocal ? localToMinutes(cue.atLocal) : null;
          const endClock = startMin !== null
            ? minutesTo12h((startMin + Math.floor(cue.durationMin)) % 1440)
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

      {/* NOW playhead — one red grammar across every Timeline calendar. */}
      {nowY !== null ? (
        <>
          <View pointerEvents="none" style={[styles.nowLine, { top: nowY, backgroundColor: C.error }]} />
          <View pointerEvents="none" style={[styles.nowLabel, { top: nowY - 9, backgroundColor: C.error }]}>
            <Text style={styles.nowLabelText}>NOW</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── The level itself ────────────────────────────────────────────────────

export function DayView({
  day, nextDay, dayCount, planCues, nowMinutes, nowDate, activeCueId, canEdit,
  showRibbon = true,
  onBackToWeek, onPrevDay, onNextDay, onOpenEvent, onOpenMoment, onEditCue, onDeleteCue, onAddCue,
}: {
  /** Resolved overview for this day. */
  day: OverviewDay;
  /** Following calendar day, whose pre-sunrise data completes this night. */
  nextDay: OverviewDay | null;
  /** Total festival days (gates prev/next). */
  dayCount: number;
  /** Draft plan cues — the EDITABLE objects behind the resolved rows. */
  planCues: PlanCue[];
  /** Minutes-of-day in the plan tz for the NOW playhead; null unless today. */
  nowMinutes: number | null;
  nowDate: string | null;
  /** The cue the engine says owns the deck right now (marks the LIVE row). */
  activeCueId: string | null;
  /** False when there is no draft to edit (edit affordances are hidden). */
  canEdit: boolean;
  /**
   * Whether to render the "RESOLVED · what actually plays" ribbon column. The
   * ribbon reveals the engine's live baseline programming (e.g. `dust_beacon`
   * and other autopilot-baseline entries) which is authoritative on the LIVE
   * view but confusing when the operator is browsing a selected/draft plan —
   * hiding it keeps the CALENDAR / EDIT rungs to the cues the operator authored.
   * Defaults to true for backward-compat with the LIVE surface.
   */
  showRibbon?: boolean;
  onBackToWeek: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** Tap an event (agenda row OR calendar block) → the EVENT sheet. */
  onOpenEvent: (cue: OverviewCue, date: string) => void;
  /**
   * Tap EMPTY calendar time → the MOMENT sheet: time travel to that instant
   * ("HH:MM" on this day), resolved via the same read-only peek the event
   * sheet uses. Still browse-safe: the tap only opens a sheet — the rig moves
   * only on the sheet's explicit TIME TRAVEL button.
   */
  onOpenMoment: (time: string, date: string) => void;
  onEditCue: (cue: PlanCue) => void;
  onDeleteCue: (cueId: string) => void;
  onAddCue: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const axis = useMemo(() => nightAxisFor(day, nextDay), [day, nextDay]);
  const rows = useMemo(
    () => axis ? nightRibbonEntries(day, nextDay, axis) : [],
    [axis, day, nextDay],
  );
  const planCueById = useMemo(() => {
    const m = new Map<string, PlanCue>();
    for (const c of planCues) m.set(c.id, c);
    return m;
  }, [planCues]);

  // Time-ordered agenda; time-less (manual / mood) cues sink to the bottom.
  const agenda = useMemo(() => {
    return axis
      ? [...nightLeadInCueEntries(day, axis), ...nightCueEntries(day, nextDay, axis)]
      : [];
  }, [axis, day, nextDay]);

  const hasReviewData = Array.isArray(day.segments)
    && Array.isArray(day.phases)
    && (!nextDay || (Array.isArray(nextDay.segments) && Array.isArray(nextDay.phases)));

  return (
    <View style={styles.root}>
      {/* ── Header: back to WEEK, the day, prev/next, the reserved SHIFT slot ── */}
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
          <Text style={styles.title} numberOfLines={1}>
            {`DAY ${day.index + 1} · ${day.weekday.toUpperCase()}`}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {`${day.date} · 6:00 PM → ${nextDay?.date ?? 'next day'} 6:00 PM`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onPrevDay}
          disabled={day.index <= 0}
          style={[styles.stepBtn, day.index <= 0 && styles.stepBtnOff]}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Text style={styles.stepBtnText}>◀ PREV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onNextDay}
          disabled={day.index >= dayCount - 1}
          style={[styles.stepBtn, day.index >= dayCount - 1 && styles.stepBtnOff]}
          accessibilityRole="button"
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
        {/* ── The chart + the resolved ribbon, side by side on one 24 h scale.
            The resolved ribbon reveals the engine's live baseline (autopilot
            and internal fill like `dust_beacon`) — it is only meaningful on
            the LIVE surface. CALENDAR / EDIT views hide it so the operator
            sees only the cues they authored. ── */}
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
        <CalendarLegend />

        {showRibbon && !hasReviewData ? (
          <Text style={styles.loudNote}>
            This engine returned no `phases` / `segments` for the day — the resolved ribbon
            needs the timeline-zoom engine slice. Nothing below is a substitute for it.
          </Text>
        ) : null}

        <View style={styles.chartRow}>
          <DayChart
            day={day}
            nextDay={nextDay}
            nowMinutes={nowMinutes}
            nowDate={nowDate}
            onOpenEvent={onOpenEvent}
            onOpenMoment={onOpenMoment}
            C={C}
            styles={styles}
          />
          {showRibbon && axis ? (
            <RibbonColumn rows={rows} axis={axis} C={C} styles={styles} />
          ) : null}
        </View>

        <Text style={styles.midnightNote}>
          This operator day starts at 6:00 PM on {day.date} and continues through
          {nextDay ? ` 6:00 PM on ${nextDay.date}` : ' 6:00 PM the following day'}.
          The ribbon keeps the engine&apos;s own midnight day-latch semantics visible.
        </Text>

        {/* ── The agenda: tap an event to zoom into it ── */}
        <Text style={styles.sectionLabel}>EVENTS · tap to zoom in</Text>
        {agenda.length === 0 ? (
          <Text style={styles.empty}>No events on this day.</Text>
        ) : (
          agenda.map(({ cue, date, timing }) => {
            const col = isPartyWindowCue(cue) ? '#b56dff' : kindColor(cue.kind, C);
            const planCue = planCueById.get(cue.id) ?? null;
            const isLive = activeCueId === cue.id;
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
                  <Text style={styles.eventTime}>{hhmmTo12h(cue.atLocal, '· · ·')}</Text>
                  <Text style={styles.eventDate}>
                    {timing === 'lead-in' ? 'BEFORE 6 PM' : date === day.date ? 'TONIGHT' : 'NEXT DAY'}
                  </Text>
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
    shiftSlot: {
      paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center', opacity: 0.45,
    },
    shiftSlotText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, letterSpacing: 0.6, color: C.secondary },
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
    midnightNote: {
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
    hourLine: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0.7 },
    hourLabel: {
      position: 'absolute', left: 4, top: -7,
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.icon,
      fontVariant: ['tabular-nums'],
    },
    sunEdgeLine: { position: 'absolute', left: 0, right: 0, height: 3 },
    phaseBand: {
      position: 'absolute', left: 62, right: 52,
      borderWidth: 1, borderRadius: 6,
      paddingHorizontal: 6, paddingTop: 2,
    },
    phaseName: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, letterSpacing: 0.6 },
    cueBlock: {
      position: 'absolute', right: 8, width: 168, borderRadius: 5, opacity: 0.94,
      paddingHorizontal: 7, justifyContent: 'center',
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
    },
    nowLine: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.95 },
    nowLabel: {
      position: 'absolute', left: 4, minWidth: 36, height: 18,
      borderRadius: 4, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center',
    },
    nowLabelText: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.8, color: '#ffffff',
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
    eventTimeCol: { alignItems: 'center', width: 74, gap: 4 },
    eventTime: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text },
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
