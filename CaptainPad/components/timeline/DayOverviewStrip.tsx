/**
 * DayOverviewStrip — the maker's backbone: a horizontally-scannable strip of
 * festival day-cards (docs/38 §15.3), now drawn entirely from the FRAME MODEL
 * (report _359 §D.3).
 *
 * One card per span in the active frame — NIGHT k (6 PM → 6 PM) or DAY k
 * (midnight → midnight). Each card carries:
 *   - the frame's own title (`N1 · SUN → MON` / `D1 · SUN`),
 *   - a vertical column with a LEFT GUTTER of labelled structural bars: NOW,
 *     SUNSET, DUSK, SUNRISE, DAWN — every one of them in the shared legend,
 *   - the PARTY WINDOW band, drawn from the engine's per-day `partyWindow`
 *     ALONE, so a night the party cue does not apply to shows nothing (C-03),
 *   - cue blocks / markers coloured by kind,
 *   - an agenda whose every row carries the weekday of its calendar date in the
 *     working frame (C-04).
 *
 * The red NOW line is ALWAYS drawn, on exactly one card. When NOW is inside no
 * span at all — the pre-6 PM half of festival day 0 — the first night CARRIES
 * it at the position whose clock label matches (11:27 AM sits 17 h 27 m into a
 * 6 PM-anchored card), and the strip still prints the explanatory sentence above
 * the legend and badges that night TONIGHT (C-01, as overridden by the
 * operator: the line is mandatory, the sentence is the words for it).
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette, useTheme } from '@/hooks/use-theme';
import { OverviewDay } from '@/utils/timelineApi';
import { hhmmTo12h, kindColor, KIND_LABEL, KIND_COLORS } from './timelineTemplate';
import { CalendarLegend } from './calendar_legend';
import { isPartyWindowCue } from './party_window_logic';
import {
  frameCueEntries,
  frameGutterLabels,
  frameHatchOffset,
  frameHourLabels,
  frameNowMarker,
  frameNowSentence,
  frameNowStatus,
  framePartyBands,
  frameHeader,
  frameSpan,
  frameSunLabelColor,
  frameSunMarkers,
  FRAME_MIDNIGHT_COLOR,
  FRAME_PARTY_COLOR,
  FRAME_SUN_COLORS,
  type DayFrame,
  type FrameCueEntry,
  type FrameSpan,
} from './day_frame_logic';

export const COLUMN_HEIGHT = 240;
const CARD_WIDTH = 232;
/** §D.2: the strip's left gutter. Hour + marker labels live here; bands start after it. */
const GUTTER_WIDTH = 64;

function yFor(offset: number, span: FrameSpan): number {
  return (Math.max(0, Math.min(span.durationMin, offset)) / span.durationMin) * COLUMN_HEIGHT;
}

/** Keep a gutter label fully inside the column (see DayView.clampLabelTop). */
function clampLabelTop(labelY: number, labelHeight: number): number {
  return Math.max(0, Math.min(COLUMN_HEIGHT - labelHeight, labelY - labelHeight / 2));
}

function SunColumn({
  span, nowDate, nowMinutes, scheme, C, styles,
}: {
  span: FrameSpan;
  scheme: 'light' | 'dark';
  nowDate: string | null;
  nowMinutes: number | null;
  C: Palette;
  styles: Styles;
}) {
  const now = frameNowMarker(span, nowDate, nowMinutes);
  const sun = frameSunMarkers(span);
  const gutter = frameGutterLabels({
    sun,
    hours: frameHourLabels(span),
    now,
    height: COLUMN_HEIGHT,
    durationMin: span.durationMin,
    short: true,
  });
  const cueEntries = frameCueEntries(span);
  const partyBands = framePartyBands(span);
  const hatchOffset = frameHatchOffset(span);
  const hatchFrom = hatchOffset === null ? null : yFor(hatchOffset, span);

  return (
    <View style={styles.column}>
      {/* The morning half of the LAST night is outside the festival span. */}
      {hatchFrom !== null ? (
        <View
          pointerEvents="none"
          style={[styles.hatch, {
            top: hatchFrom,
            backgroundColor: C.surfaceContainerHigh,
            borderTopColor: C.secondary,
          }]}
        >
          <Text style={styles.hatchText}>AFTER THE FESTIVAL</Text>
        </View>
      ) : null}

      {/* Structural bars. Sun bars start after the gutter; NOW crosses both. */}
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

      {/* PARTY WINDOW — from the engine's partyWindow only (C-03). */}
      {partyBands.map((band, i) => {
        const top = yFor(band.fromOffset, span);
        const h = Math.max(4, yFor(band.toOffset, span) - top);
        return (
          <View
            key={`party:${i}`}
            pointerEvents="none"
            style={[styles.partyBand, { top, height: h }]}
          />
        );
      })}

      {/* Cue BLOCKS (durationMin > 0) then point MARKERS. */}
      {cueEntries.map((entry, i) => {
        const { cue, offset, endOffset, date } = entry;
        if (offset === null) return null;
        if (!(typeof cue.durationMin === 'number' && cue.durationMin > 0)) return null;
        const top = yFor(offset, span);
        const h = Math.max(3, yFor(endOffset ?? offset, span) - top);
        const col = isPartyWindowCue(cue) ? FRAME_PARTY_COLOR : kindColor(cue.kind, C);
        return (
          <View
            key={`${date}:${cue.id}:blk:${i}`}
            style={[styles.cueBlock, { top, height: h, backgroundColor: col }]}
          />
        );
      })}
      {cueEntries.map((entry, i) => {
        const { cue, offset, date } = entry;
        if (offset === null) return null;
        if (typeof cue.durationMin === 'number' && cue.durationMin > 0) return null;
        const col = isPartyWindowCue(cue) ? FRAME_PARTY_COLOR : kindColor(cue.kind, C);
        return (
          <View
            key={`${date}:${cue.id}:${i}`}
            style={[
              styles.cueMarker,
              {
                top: yFor(offset, span) - 4,
                backgroundColor: col,
                borderColor: C.surfaceContainerLowest,
              },
            ]}
          />
        );
      })}

      {/* NOW — 2 px solid across gutter + chart, on top of everything. */}
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
                { top: clampLabelTop(label.labelY, 16), backgroundColor: C.error },
              ]}
            >
              <Text style={styles.nowPillText} numberOfLines={1}>{label.text}</Text>
            </View>
          );
        }
        // The midnight label ("12 AM MON") is the card's date change — the same
        // muted green the DAY view draws its midnight divider in.
        const color = label.kind === 'sun' && label.id
          ? frameSunLabelColor(label.id, scheme)
          : (label.midnight ? FRAME_MIDNIGHT_COLOR : C.icon);
        return (
          <React.Fragment key={label.key}>
            {label.stacked ? (
              <View
                pointerEvents="none"
                style={[styles.leader, { top: label.y, backgroundColor: color }]}
              />
            ) : null}
            <Text
              pointerEvents="none"
              numberOfLines={1}
              style={[
                label.kind === 'sun' ? styles.gutterSun : styles.gutterHour,
                { top: clampLabelTop(label.labelY, 12), color },
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

// THEME BADGE (_94 §2.2): the day's headline PROGRAM cue, derived entirely
// client-side from the cues the frame already resolved onto this card.
function themeBadgeFor(entries: FrameCueEntry[]): string | null {
  const program = entries.find((e) => e.cue.kind === 'program' && !!e.cue.label);
  return program?.cue.label ?? null;
}

export function DayCard({
  span, isNow, isTonight, isSelected, nowDate, nowMinutes, scheme, onPress, onOpen, C, styles,
}: {
  span: FrameSpan;
  scheme: 'light' | 'dark';
  /** This card's span contains NOW. */
  isNow: boolean;
  /** NOW is before the first night opens and this is that night (C-01). */
  isTonight: boolean;
  /** Operator-selected span (drives the cue filter below the strip). */
  isSelected: boolean;
  nowDate: string | null;
  nowMinutes: number | null;
  onPress: () => void;
  onOpen: () => void;
  C: Palette;
  styles: Styles;
}) {
  const header = frameHeader(span);
  const entries = frameCueEntries(span);
  const listed = entries.filter((e) => e.timing !== 'manual');
  const showWeekday = span.frame === 'working';
  const borderColor = isSelected ? C.primary : (isNow ? C.tertiary : C.ghostBorder);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Open ${header.title}`}
      style={[
        styles.card,
        { borderColor, borderWidth: isSelected ? 2.5 : 1.5 },
        isNow && { backgroundColor: C.sidebarActiveBackground },
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardDay, isSelected && { color: C.primary }]} numberOfLines={1}>
          {header.cardTitle}
        </Text>
        <Text style={styles.cardDate}>{span.startDate.slice(5)}</Text>
      </View>

      {isNow ? (
        <View style={[styles.todayBadge, { borderColor: C.error }]}>
          <Text style={[styles.todayBadgeText, { color: C.error }]}>● TODAY</Text>
        </View>
      ) : isTonight ? (
        <View style={[styles.todayBadge, { borderColor: C.tertiary }]}>
          <Text style={[styles.todayBadgeText, { color: C.tertiary }]}>TONIGHT · opens 6:00 PM</Text>
        </View>
      ) : null}

      {(() => {
        const theme = themeBadgeFor(entries);
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
        span={span}
        nowDate={nowDate}
        nowMinutes={nowMinutes}
        scheme={scheme}
        C={C}
        styles={styles}
      />

      {/* Event agenda — the span's cues as a readable, time-sorted list. In the
          working frame every row states the weekday of its own calendar date,
          so a Monday-morning cue can never read as Sunday morning (C-04). */}
      <View style={styles.cardFooter}>
        <Text style={styles.cueCount}>
          {`${listed.length} lighting cue${listed.length === 1 ? '' : 's'}`}
        </Text>
        {listed.slice(0, 4).map((entry, i) => (
          <View key={`${entry.date}:${entry.cue.id}:ev:${i}`} style={styles.eventRow}>
            <View style={[styles.eventDot, {
              backgroundColor: isPartyWindowCue(entry.cue)
                ? FRAME_PARTY_COLOR
                : kindColor(entry.cue.kind, C),
            }]} />
            <Text style={styles.eventTime} numberOfLines={1}>
              {showWeekday
                ? `${entry.weekday} ${hhmmTo12h(entry.cue.atLocal, '· · ·')}`
                : hhmmTo12h(entry.cue.atLocal, '· · ·')}
            </Text>
            <Text style={styles.eventName} numberOfLines={1} ellipsizeMode="tail">
              {entry.cue.label || KIND_LABEL[entry.cue.kind]}
            </Text>
          </View>
        ))}
        {listed.length > 4 ? (
          <Text style={styles.eventMore}>{`+${listed.length - 4} more`}</Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${header.title}`}
        style={styles.editBtn}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={styles.editBtnText}>
          {span.frame === 'working' ? 'OPEN NIGHT ▸' : 'OPEN DAY ▸'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export interface DayOverviewStripProps {
  days: OverviewDay[];
  frame: DayFrame;
  /** Operator-selected frame index (highlighted, drives the cue filter). */
  selectedIndex: number | null;
  /** Today's calendar date in the plan tz (null when no tz could be read). */
  nowDate: string | null;
  /** Live minutes-of-day in the plan tz (null when off-festival / no tz). */
  nowMinutes: number | null;
  /** Zoom in: FESTIVAL → DAY. Both the card body and its button call this. */
  onOpenDay: (index: number) => void;
}

export function DayOverviewStrip({
  days, frame, selectedIndex, nowDate, nowMinutes, onOpenDay,
}: DayOverviewStripProps) {
  const C = usePalette();
  const { scheme } = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);

  const status = frameNowStatus(frame, days, nowDate, nowMinutes);
  const sentence = frameNowSentence(frame, days, nowDate, nowMinutes);

  if (days.length === 0) {
    return <Text style={styles.empty}>No festival days in this plan yet.</Text>;
  }

  return (
    <View style={{ gap: 6 }}>
      {sentence ? <Text style={styles.nowSentence}>{sentence}</Text> : null}
      <CalendarLegend />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 8, paddingVertical: 4 }}
      >
        {days.map((day, index) => {
          const span = frameSpan(frame, days, index);
          return (
            <DayCard
              key={day.index}
              span={span}
              isNow={status.kind === 'inside' && status.index === index}
              isTonight={status.kind === 'before-first' && index === 0}
              isSelected={selectedIndex === index}
              nowDate={nowDate}
              nowMinutes={nowMinutes}
              scheme={scheme}
              onPress={() => onOpenDay(index)}
              onOpen={() => onOpenDay(index)}
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
    nowSentence: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.4,
      color: C.error,
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
      gap: 6,
    },
    cardDay: {
      flex: 1,
      minWidth: 0,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 15,
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
    hatch: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      opacity: 0.85,
      borderTopWidth: 1,
      borderStyle: 'dashed',
      alignItems: 'center',
      paddingTop: 6,
    },
    hatchText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.6,
      color: C.secondary,
    },
    sunBar: {
      position: 'absolute',
      left: GUTTER_WIDTH,
      right: 0,
      height: 0,
      borderTopWidth: 2,
      borderStyle: 'dashed',
    },
    partyBand: {
      position: 'absolute',
      left: GUTTER_WIDTH,
      right: 0,
      backgroundColor: `${FRAME_PARTY_COLOR}33`,
      borderColor: FRAME_PARTY_COLOR,
      borderWidth: 1,
      borderRadius: 3,
    },
    nowLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 2,
      opacity: 0.95,
      zIndex: 3,
    },
    nowPill: {
      position: 'absolute',
      left: 2,
      height: 16,
      maxWidth: GUTTER_WIDTH - 4,
      borderRadius: 4,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 4,
    },
    nowPillText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 8,
      letterSpacing: 0,
      color: '#ffffff',
    },
    gutterSun: {
      position: 'absolute',
      left: 3,
      width: GUTTER_WIDTH - 5,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 8,
      letterSpacing: 0,
      zIndex: 2,
    },
    gutterHour: {
      position: 'absolute',
      left: 3,
      width: GUTTER_WIDTH - 5,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 8,
      letterSpacing: 0,
      fontVariant: ['tabular-nums'],
    },
    leader: {
      position: 'absolute',
      left: 3,
      width: GUTTER_WIDTH - 8,
      height: 1,
      opacity: 0.6,
    },
    cueMarker: {
      position: 'absolute',
      right: 6,
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 1.5,
      zIndex: 2,
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
      fontSize: 13,
      letterSpacing: 0.2,
      color: C.secondary,
      fontVariant: ['tabular-nums'],
      width: 94,
    },
    eventName: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
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
      zIndex: 2,
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
      fontSize: 12,
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
