/**
 * DayOverviewStrip — the maker's backbone: a horizontally-scannable strip
 * of festival day-cards (docs/38 §15.3). Each card shows:
 *   - weekday + date,
 *   - a vertical nocturnal column: this sunset → the following sunrise,
 *   - cue markers placed by `atLocal` along the column, coloured by kind
 *     (program=amber, mood=cyan, ambient=grey); manual / time-less cues
 *     surface as chips below.
 * Today is highlighted (primary border). Tapping a card opens the day editor.
 *
 * Layout is fluid: a single horizontal ScrollView; 8 cards sit legibly on an
 * iPad-Pro-11 (1194pt landscape) — ~150pt each.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { OverviewDay, OverviewCue } from '@/utils/timelineApi';
import { hhmmToMinutes, hhmmTo12h, kindColor, KIND_LABEL, KIND_COLORS } from './timelineTemplate';
import { CalendarLegend } from './calendar_legend';
import { isPartyWindowCue } from './party_window_logic';
import {
  nightAxisFor,
  nightCueEntries,
  nightLeadInCueEntries,
  nightNowDayOffset,
  nightOffset,
  nightPhaseEntries,
  yForNightOffset,
} from './night_calendar_logic';

export const COLUMN_HEIGHT = 240;
const CARD_WIDTH = 210;

function SunColumn({
  day, nextDay, nowMinutes, nowDayOffset, C, styles,
}: {
  day: OverviewDay;
  nextDay: OverviewDay | null;
  /** Minutes-of-day for the live NOW playhead when this NIGHT contains now. */
  nowMinutes: number | null;
  nowDayOffset: 0 | 1 | null;
  C: Palette;
  styles: Styles;
}) {
  const axis = nightAxisFor(day, nextDay);
  if (!axis) {
    return <Text style={styles.sunError}>SUNSET / SUNRISE DATA MISSING</Text>;
  }
  const yFor = (offset: number | null) => yForNightOffset(offset, COLUMN_HEIGHT, axis);
  const cueEntries = nightCueEntries(day, nextDay, axis);
  const partyWindows = nightPhaseEntries(day, nextDay, axis)
    .filter((entry) => entry.phase.name.startsWith('pw_'));
  const ghStartY = yFor(nightOffset(hhmmToMinutes(day.sun.goldenHourStart) ?? -1, 0, axis));
  const civilDuskY = yFor(nightOffset(hhmmToMinutes(day.sun.civilDusk) ?? -1, 0, axis));
  const sunsetY = yFor(nightOffset(hhmmToMinutes(day.sun.sunset) ?? -1, 0, axis));
  const sunriseY = yFor(nightOffset(hhmmToMinutes(nextDay?.sun.sunrise) ?? -1, 1, axis));

  return (
    <View style={styles.column}>
      <View style={[styles.nightBand, { backgroundColor: '#5b6cf518' }]} />

      {/* Golden hour marker (amber tick) */}
      {ghStartY !== null ? (
        <View style={[styles.sunTick, { top: ghStartY - 1, backgroundColor: '#f5a623' }]} />
      ) : null}

      {/* Civil dusk marker (indigo tick) */}
      {civilDuskY !== null ? (
        <View style={[styles.sunTick, { top: civilDuskY - 1, backgroundColor: '#5b6cf5' }]} />
      ) : null}

      {sunsetY !== null ? (
        <View style={[styles.sunTick, { top: sunsetY - 1, backgroundColor: '#5b6cf5' }]} />
      ) : null}
      {sunriseY !== null ? (
        <View style={[styles.sunTick, { top: sunriseY - 1, backgroundColor: '#f5a623' }]} />
      ) : null}

      {/* Stable operator day: 6 PM on this date through next-date 6 PM. */}
      <Text style={[styles.edgeTime, { top: 3, left: 4, color: '#5b6cf5' }]}>
        ☾ 6 PM
      </Text>
      <Text style={[styles.edgeTime, { bottom: 3, left: 4, color: '#f5a623' }]}>
        6 PM +1
      </Text>

      {partyWindows.map((entry) => {
        const topY = yFor(entry.fromOffset);
        const endY = yFor(entry.toOffset);
        if (topY === null || endY === null) return null;
        return (
          <View
            key={entry.key}
            style={[
              styles.cueBlock,
              {
                top: topY,
                height: Math.max(4, endY - topY),
                backgroundColor: '#b56dff44',
                borderColor: '#b56dff',
                borderWidth: 1,
              },
            ]}
          />
        );
      })}

      {/* Cue BLOCKS (timed + durationMin>0) — a filled bar in the cue's kind
          colour spanning start→start+duration, so the operator sees the
          "planned areas" (the deck-owned windows). A duration that runs past
          24:00 is clamped to the column bottom. Point cues (no duration) fall
          through to the marker pass below. */}
      {cueEntries.map(({ cue, startOffset, endOffset, date }, i) => {
        if (startOffset === null) return null;
        if (!(typeof cue.durationMin === 'number' && cue.durationMin > 0)) return null;
        const topY = yFor(startOffset);
        if (topY === null) return null;
        const endY = yFor(endOffset) ?? COLUMN_HEIGHT;
        const h = Math.max(3, endY - topY); // keep short windows visible
        const col = isPartyWindowCue(cue) ? '#b56dff' : kindColor(cue.kind, C);
        return (
          <View
            key={`${date}:${cue.id}:blk:${i}`}
            style={[styles.cueBlock, { top: topY, height: h, backgroundColor: col }]}
          />
        );
      })}

      {/* Cue markers (timed, point cues only — duration cues render as blocks). */}
      {cueEntries.map(({ cue, startOffset, date }, i) => {
        if (typeof cue.durationMin === 'number' && cue.durationMin > 0) return null;
        const y = yFor(startOffset);
        if (y === null) return null;
        const col = isPartyWindowCue(cue) ? '#b56dff' : kindColor(cue.kind, C);
        return (
          <View
            key={`${date}:${cue.id}:${i}`}
            style={[styles.cueMarker, { top: y - 4, backgroundColor: col, borderColor: C.surfaceContainerLowest }]}
          />
        );
      })}

      {/* NOW playhead — on whichever displayed 6 PM → 6 PM operator day
          actually contains the current instant. The line and its left-edge
          label are always red so NOW has one grammar across every calendar. */}
      {nowMinutes !== null && nowDayOffset !== null && (() => {
        const nowY = yFor(nightOffset(nowMinutes, nowDayOffset, axis));
        if (nowY === null) return null;
        return (
          <React.Fragment key="now-playhead">
            <View style={[styles.nowLine, { top: nowY, backgroundColor: C.error }]} />
            <View style={[styles.nowLabel, { top: nowY - 8, backgroundColor: C.error }]}>
              <Text style={styles.nowLabelText}>NOW</Text>
            </View>
          </React.Fragment>
        );
      })()}
    </View>
  );
}

// THEME BADGE (_94 §2.2): the day's headline PROGRAM cue, derived entirely
// client-side. A `days:[6]` cue only appears on day 6 in the overview
// (timeline_service buildOverview + festival.js), so the badge needs no new
// wire data — it IS that day's program cue label. Null when the day has none.
function themeBadgeFor(day: OverviewDay): string | null {
  const program = day.cues.find((c) => c.kind === 'program' && !!c.label);
  return program?.label ?? null;
}

export function DayCard({
  day, nextDay, isToday, isSelected, nowMinutes, nowDayOffset, onPress, onOpen, C, styles,
}: {
  day: OverviewDay;
  nextDay: OverviewDay | null;
  isToday: boolean;
  /** Operator-selected day (drives the cue filter below the strip). */
  isSelected: boolean;
  /** Minutes-of-day for the NOW playhead — non-null only on today's card. */
  nowMinutes: number | null;
  nowDayOffset: 0 | 1 | null;
  /** Single tap: ZOOM IN to this day (the FESTIVAL → DAY rung). */
  onPress: () => void;
  /**
   * The same zoom-in, from the card's explicit button. Kept as a labelled
   * affordance so "tap a card to open the day" is discoverable on a card whose
   * body is otherwise a dense agenda — one navigation model, two hit targets.
   */
  onOpen: () => void;
  C: Palette;
  styles: Styles;
}) {
  // Time-sorted cues for the agenda list: timed cues ascending, then timeless.
  const axis = nightAxisFor(day, nextDay);
  const nightCues = axis ? nightCueEntries(day, nextDay, axis) : [];
  const leadInCues = axis ? nightLeadInCueEntries(day, axis) : [];
  const lightingCues = [...leadInCues, ...nightCues];
  const sortedCues = lightingCues.map((entry) => entry.cue);
  // Selection ring takes precedence as the dominant border; today still tints
  // the background. The two may be different days.
  const borderColor = isSelected ? C.primary : (isToday ? C.tertiary : C.ghostBorder);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Open ${day.weekday} ${day.date}`}
      style={[
        styles.card,
        { borderColor, borderWidth: isSelected ? 2.5 : 1.5 },
        isToday && { backgroundColor: C.sidebarActiveBackground },
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardDay, isSelected && { color: C.primary }]}>{`D${day.index + 1} · ${day.weekday.toUpperCase()}`}</Text>
        <Text style={styles.cardDate}>{day.date.slice(5)}</Text>
      </View>

      {/* TODAY badge — independent of selection so the operator can tell which
          card is "now" even when viewing another day. */}
      {isToday ? (
        <View style={[styles.todayBadge, { borderColor: C.error }]}>
          <Text style={[styles.todayBadgeText, { color: C.error }]}>● TODAY</Text>
        </View>
      ) : null}

      {/* THEME BADGE — this day's program cue, so a themed night (burn, temple)
          is legible from the week view without opening it. */}
      {(() => {
        const theme = themeBadgeFor(day);
        if (!theme) return null;
        return (
          <View style={[styles.timelessChip, { borderColor: KIND_COLORS.program }]}>
            <Text style={[styles.timelessChipText, { color: KIND_COLORS.program }]} numberOfLines={1}>
              {theme.toUpperCase()}
            </Text>
          </View>
        );
      })()}

      <SunColumn
        day={day}
        nextDay={nextDay}
        nowMinutes={nowMinutes}
        nowDayOffset={nowDayOffset}
        C={C}
        styles={styles}
      />

      {/* Event agenda — the day's cues as a readable, time-sorted list
          (kind dot · time · name). The column above is the visual plot; this
          is the legible detail the narrow column can't hold. */}
      <View style={styles.cardFooter}>
        <Text style={styles.cueCount}>{`${lightingCues.length} lighting cue${lightingCues.length === 1 ? '' : 's'}`}</Text>
        {sortedCues.slice(0, 4).map((c: OverviewCue, i) => (
          <View key={`${c.id}:ev:${i}`} style={styles.eventRow}>
            <View style={[styles.eventDot, { backgroundColor: isPartyWindowCue(c) ? '#b56dff' : kindColor(c.kind, C) }]} />
            <Text style={styles.eventTime}>{hhmmTo12h(c.atLocal, '· · ·')}</Text>
            <Text style={styles.eventName} numberOfLines={1} ellipsizeMode="tail">
              {c.label || KIND_LABEL[c.kind]}
            </Text>
          </View>
        ))}
        {lightingCues.length > 4 ? (
          <Text style={styles.eventMore}>{`+${lightingCues.length - 4} more`}</Text>
        ) : null}
      </View>

      {/* The zoom-in affordance, spelled out. Same destination as tapping the
          card — FESTIVAL → DAY (_94 §1). */}
      <TouchableOpacity
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${day.weekday} ${day.date}`}
        style={styles.editBtn}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={styles.editBtnText}>OPEN DAY ▸</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export function DayOverviewStrip({
  days, todayIndex, selectedIndex, nowMinutes, onOpenDay,
}: {
  days: OverviewDay[];
  todayIndex: number | null;
  /** Operator-selected day index (highlighted, drives the cue filter). */
  selectedIndex: number | null;
  /** Live minutes-of-day in the plan tz for the NOW playhead (null when off-festival). */
  nowMinutes: number | null;
  /** Zoom in: FESTIVAL → DAY. Both the card body and its button call this. */
  onOpenDay: (index: number) => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  if (days.length === 0) {
    return <Text style={styles.empty}>No festival days in this plan yet.</Text>;
  }

  return (
    <View style={{ gap: 6 }}>
      <CalendarLegend />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 8, paddingVertical: 4 }}
      >
        {days.map((day, index) => {
          const nextDay = days[index + 1] ?? null;
          const axis = nightAxisFor(day, nextDay);
          const nowDayOffset = axis
            ? nightNowDayOffset(day, nextDay, todayIndex, nowMinutes, axis)
            : null;
          const containsNow = nowDayOffset !== null;
          return (
            <DayCard
              key={day.index}
              day={day}
              nextDay={nextDay}
              isToday={todayIndex === day.index}
              isSelected={selectedIndex === day.index}
              nowMinutes={containsNow ? nowMinutes : null}
              nowDayOffset={nowDayOffset}
              onPress={() => onOpenDay(day.index)}
              onOpen={() => onOpenDay(day.index)}
              C={C}
              styles={styles}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(C: Palette) {
  return StyleSheet.create({
    empty: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      color: C.secondary,
      paddingVertical: 12,
    },
    card: {
      width: CARD_WIDTH,
      borderRadius: 12,
      borderWidth: 1.5,
      backgroundColor: C.surfaceContainerLowest,
      padding: 10,
      gap: 8,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cardDay: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      letterSpacing: 0.4,
      color: C.text,
    },
    cardDate: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: C.secondary,
    },
    column: {
      height: COLUMN_HEIGHT,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceDim,
      position: 'relative',
      overflow: 'hidden',
    },
    nightBand: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    },
    sunLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
    },
    sunTick: {
      position: 'absolute',
      left: 0,
      width: 8,
      height: 2,
    },
    nowLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 2,
      opacity: 0.95,
    },
    nowLabel: {
      position: 'absolute',
      left: 3,
      height: 16,
      minWidth: 30,
      borderRadius: 4,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nowLabelText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.7,
      color: '#ffffff',
    },
    edgeTime: {
      position: 'absolute',
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.2,
    },
    cueMarker: {
      position: 'absolute',
      right: 6,
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 1.5,
    },
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minHeight: 28,
      paddingVertical: 2,
    },
    eventDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    eventTime: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.2,
      color: C.secondary,
      fontVariant: ['tabular-nums'],
      width: 78,
    },
    eventName: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      color: C.text,
    },
    eventMore: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: C.secondary,
      marginTop: 1,
    },
    cueBlock: {
      position: 'absolute',
      right: 4,
      width: 42,
      borderRadius: 3,
      opacity: 0.85,
    },
    sunError: {
      height: COLUMN_HEIGHT,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.error,
      padding: 8,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      color: C.error,
    },
    cardFooter: {
      gap: 2,
      marginTop: 2,
      alignSelf: 'stretch',
    },
    cueCount: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.6,
      color: C.icon,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    timelessChip: {
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      alignSelf: 'flex-start',
    },
    timelessChipText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
    todayBadge: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 1,
      marginTop: -2,
    },
    todayBadgeText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.6,
    },
    editBtn: {
      alignSelf: 'stretch',
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 6,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    editBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.8,
      color: C.text,
    },
  });
}
