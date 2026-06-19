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

const COLUMN_HEIGHT = 240;
const CARD_WIDTH = 150;

// 06:00 at top reads "morning up", midnight at bottom — but a simple 0–24
// top-to-bottom is more intuitive on a strip. Top = 00:00, bottom = 24:00.
function yFor(mins: number | null): number | null {
  const f = dayFraction(mins);
  if (f === null) return null;
  return f * COLUMN_HEIGHT;
}

function SunColumn({ day, C, styles }: { day: OverviewDay; C: Palette; styles: Styles }) {
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

      {/* Cue markers (timed) */}
      {day.cues.map((cue, i) => {
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
    </View>
  );
}

export function DayCard({
  day, isToday, onPress, C, styles,
}: {
  day: OverviewDay;
  isToday: boolean;
  onPress: () => void;
  C: Palette;
  styles: Styles;
}) {
  const timeless = day.cues.filter((c) => !c.atLocal);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${day.weekday} ${day.date}`}
      style={[
        styles.card,
        { borderColor: isToday ? C.primary : C.ghostBorder },
        isToday && { backgroundColor: C.sidebarActiveBackground },
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardDay, isToday && { color: C.primary }]}>{`D${day.index + 1} · ${day.weekday.toUpperCase()}`}</Text>
        <Text style={styles.cardDate}>{day.date.slice(5)}</Text>
      </View>

      <SunColumn day={day} C={C} styles={styles} />

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
    </TouchableOpacity>
  );
}

export function DayOverviewStrip({
  days, todayIndex, onSelectDay,
}: {
  days: OverviewDay[];
  todayIndex: number | null;
  onSelectDay: (index: number) => void;
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
          onPress={() => onSelectDay(day.index)}
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
  });
}
