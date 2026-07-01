/**
 * DayOverviewStrip — the maker's backbone: a horizontally-scannable strip
 * of festival day-cards (docs/38 §15.3). Each card shows:
 *   - weekday + date,
 *   - a vertical 24h sun column: sunrise→sunset shaded "day", golden hour +
 *     civil dusk marked,
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
import { hhmmToMinutes, dayFraction, kindColor, KIND_LABEL } from './timelineTemplate';

export const COLUMN_HEIGHT = 240;
const CARD_WIDTH = 150;

// 06:00 at top reads "morning up", midnight at bottom — but a simple 0–24
// top-to-bottom is more intuitive on a strip. Top = 00:00, bottom = 24:00.
// Exported so the day editor's NOW playhead reuses the exact same mapping.
export function yForMinutes(mins: number | null): number | null {
  const f = dayFraction(mins);
  if (f === null) return null;
  return f * COLUMN_HEIGHT;
}
const yFor = yForMinutes;

function SunColumn({
  day, nowMinutes, C, styles,
}: {
  day: OverviewDay;
  /** Minutes-of-day for the live NOW playhead (only set on today's card). */
  nowMinutes: number | null;
  C: Palette;
  styles: Styles;
}) {
  const sunriseY = yFor(hhmmToMinutes(day.sun.sunrise));
  const sunsetY = yFor(hhmmToMinutes(day.sun.sunset));
  const ghStartY = yFor(hhmmToMinutes(day.sun.goldenHourStart));
  const civilDuskY = yFor(hhmmToMinutes(day.sun.civilDusk));
  const noonY = yFor(hhmmToMinutes(day.sun.solarNoon));

  // Day-shade band between sunrise and sunset.
  const bandTop = sunriseY;
  const bandHeight = sunriseY !== null && sunsetY !== null ? Math.max(0, sunsetY - sunriseY) : null;

  return (
    <View style={styles.column}>
      {/* Day shade */}
      {bandTop !== null && bandHeight !== null ? (
        <View
          style={[
            styles.dayBand,
            { top: bandTop, height: bandHeight, backgroundColor: C.sidebarActiveBackground },
          ]}
        />
      ) : null}

      {/* Solar noon hairline */}
      {noonY !== null ? (
        <View style={[styles.sunLine, { top: noonY, backgroundColor: C.primary, opacity: 0.5 }]} />
      ) : null}

      {/* Golden hour marker (amber tick) */}
      {ghStartY !== null ? (
        <View style={[styles.sunTick, { top: ghStartY - 1, backgroundColor: '#f5a623' }]} />
      ) : null}

      {/* Civil dusk marker (indigo tick) */}
      {civilDuskY !== null ? (
        <View style={[styles.sunTick, { top: civilDuskY - 1, backgroundColor: '#5b6cf5' }]} />
      ) : null}

      {/* Sunrise / sunset edge labels */}
      {sunriseY !== null ? (
        <Text style={[styles.edgeTime, { top: Math.max(0, sunriseY - 7), left: 2, color: C.secondary }]}>
          ☀ {day.sun.sunrise}
        </Text>
      ) : null}
      {sunsetY !== null ? (
        <Text style={[styles.edgeTime, { top: Math.min(COLUMN_HEIGHT - 14, sunsetY - 7), left: 2, color: C.secondary }]}>
          ☾ {day.sun.sunset}
        </Text>
      ) : null}

      {/* Cue BLOCKS (timed + durationMin>0) — a filled bar in the cue's kind
          colour spanning start→start+duration, so the operator sees the
          "planned areas" (the deck-owned windows). A duration that runs past
          24:00 is clamped to the column bottom. Point cues (no duration) fall
          through to the marker pass below. */}
      {day.cues.map((cue, i) => {
        const startMins = hhmmToMinutes(cue.atLocal);
        if (startMins === null) return null;
        if (!(typeof cue.durationMin === 'number' && cue.durationMin > 0)) return null;
        const topY = yFor(startMins);
        if (topY === null) return null;
        const endY = yFor(Math.min(1440, startMins + cue.durationMin)) ?? COLUMN_HEIGHT;
        const h = Math.max(3, endY - topY); // keep short windows visible
        const col = kindColor(cue.kind, C);
        return (
          <View
            key={`${cue.id}:blk:${i}`}
            style={[styles.cueBlock, { top: topY, height: h, backgroundColor: col }]}
          />
        );
      })}

      {/* Cue markers (timed, point cues only — duration cues render as blocks). */}
      {day.cues.map((cue, i) => {
        if (typeof cue.durationMin === 'number' && cue.durationMin > 0) return null;
        const y = yFor(hhmmToMinutes(cue.atLocal));
        if (y === null) return null;
        const col = kindColor(cue.kind, C);
        return (
          <View
            key={`${cue.id}:${i}`}
            style={[styles.cueMarker, { top: y - 4, backgroundColor: col, borderColor: C.surfaceContainerLowest }]}
          />
        );
      })}

      {/* Cue LABELS — the cue's time + name at its position, so the day plot
          reads as a list of events (not anonymous dots/bars). */}
      {day.cues.map((cue, i) => {
        const startMins = hhmmToMinutes(cue.atLocal);
        if (startMins === null) return null;
        const y = yFor(startMins);
        if (y === null) return null;
        const col = kindColor(cue.kind, C);
        const text = cue.label ? `${cue.atLocal} ${cue.label}` : cue.atLocal;
        return (
          <Text
            key={`${cue.id}:lbl:${i}`}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.cueLabel, { top: y - 6, color: col }]}
          >
            {text}
          </Text>
        );
      })}

      {/* NOW playhead — only on today's card. A bright thin line + a dot at the
          current local time (top=00:00, bottom=24:00), driven by a 1s ticker
          in the parent. Reuses yFor() so it lines up with the sun + cue math. */}
      {nowMinutes !== null && (() => {
        const nowY = yFor(nowMinutes);
        if (nowY === null) return null;
        return (
          <React.Fragment key="now-playhead">
            <View style={[styles.nowLine, { top: nowY, backgroundColor: C.error }]} />
            <View style={[styles.nowDot, { top: nowY - 3, backgroundColor: C.error, borderColor: C.surfaceContainerLowest }]} />
          </React.Fragment>
        );
      })()}
    </View>
  );
}

export function DayCard({
  day, isToday, isSelected, nowMinutes, onPress, onEdit, C, styles,
}: {
  day: OverviewDay;
  isToday: boolean;
  /** Operator-selected day (drives the cue filter below the strip). */
  isSelected: boolean;
  /** Minutes-of-day for the NOW playhead — non-null only on today's card. */
  nowMinutes: number | null;
  /** Single tap: select / view this day. */
  onPress: () => void;
  /** Explicit EDIT affordance: open the day editor. */
  onEdit: () => void;
  C: Palette;
  styles: Styles;
}) {
  const timeless = day.cues.filter((c) => !c.atLocal);
  // Selection ring takes precedence as the dominant border; today still tints
  // the background. The two may be different days.
  const borderColor = isSelected ? C.primary : (isToday ? C.tertiary : C.ghostBorder);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Select ${day.weekday} ${day.date}`}
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

      <SunColumn day={day} nowMinutes={nowMinutes} C={C} styles={styles} />

      {/* Timed cue count + time-less chips */}
      <View style={styles.cardFooter}>
        <Text style={styles.cueCount}>{`${day.cues.length} cue${day.cues.length === 1 ? '' : 's'}`}</Text>
        {timeless.slice(0, 2).map((c: OverviewCue, i) => (
          <View key={`${c.id}:tl:${i}`} style={[styles.timelessChip, { borderColor: kindColor(c.kind, C) }]}>
            <Text style={[styles.timelessChipText, { color: kindColor(c.kind, C) }]} numberOfLines={1}>
              {c.trigger.type === 'manual' ? 'MANUAL' : KIND_LABEL[c.kind]}
            </Text>
          </View>
        ))}
      </View>

      {/* Explicit EDIT DAY affordance — single tap selects/views, this opens
          the day editor so selection no longer collides with editing. */}
      <TouchableOpacity
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${day.weekday} ${day.date}`}
        style={styles.editBtn}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={styles.editBtnText}>EDIT DAY</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export function DayOverviewStrip({
  days, todayIndex, selectedIndex, nowMinutes, onSelectDay, onEditDay,
}: {
  days: OverviewDay[];
  todayIndex: number | null;
  /** Operator-selected day index (highlighted, drives the cue filter). */
  selectedIndex: number | null;
  /** Live minutes-of-day in the plan tz for the NOW playhead (null when off-festival). */
  nowMinutes: number | null;
  onSelectDay: (index: number) => void;
  onEditDay: (index: number) => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  if (days.length === 0) {
    return <Text style={styles.empty}>No festival days in this plan yet.</Text>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingRight: 8, paddingVertical: 4 }}
    >
      {days.map((day) => (
        <DayCard
          key={day.index}
          day={day}
          isToday={todayIndex === day.index}
          isSelected={selectedIndex === day.index}
          nowMinutes={todayIndex === day.index ? nowMinutes : null}
          onPress={() => onSelectDay(day.index)}
          onEdit={() => onEditDay(day.index)}
          C={C}
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(C: Palette) {
  return StyleSheet.create({
    empty: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
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
      fontSize: 11,
      letterSpacing: 0.4,
      color: C.text,
    },
    cardDate: {
      fontFamily: 'Inter_400Regular',
      fontSize: 10,
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
    dayBand: {
      position: 'absolute',
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
    nowDot: {
      position: 'absolute',
      left: -1,
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1,
    },
    edgeTime: {
      position: 'absolute',
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
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
    cueLabel: {
      position: 'absolute',
      left: 4,
      right: 18,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.2,
    },
    cueBlock: {
      position: 'absolute',
      right: 4,
      width: 6,
      borderRadius: 3,
      opacity: 0.85,
    },
    cardFooter: {
      gap: 4,
    },
    cueCount: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.6,
      color: C.icon,
      textTransform: 'uppercase',
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
      fontSize: 9,
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
      fontSize: 8.5,
      letterSpacing: 0.6,
    },
    editBtn: {
      alignSelf: 'stretch',
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 6,
      paddingVertical: 6,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 30,
    },
    editBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.text,
    },
  });
}
