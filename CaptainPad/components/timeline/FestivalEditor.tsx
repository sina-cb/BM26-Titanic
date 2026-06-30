/**
 * FestivalEditor — the festival span + estimate-location controls that sit at
 * the TOP of the Timeline maker page (docs/38 §15.3, operator request 2026-06).
 *
 * It edits three things on the DRAFT plan, all of which feed the engine's sun
 * estimate (the engine OVERVIEW is the authoritative sunrise/sunset source —
 * we never hand-roll suncalc client-side):
 *
 *   1. TIMEZONE  → draft.location.tz (IANA). The "estimate location for
 *      sunrise/set": tz + the standing BRC lat/lon drive the engine's sun calc.
 *      A curated US list + free text (the engine validates tz and 400s loudly
 *      on a bad one — Codex P0: no client fallback).
 *   2. START DATE → draft.festival.startDate (YYYY-MM-DD). A tappable chip that
 *      opens a Year/Month/Day wheel picker (DateWheel) so the operator can jump
 *      directly to any date instead of clicking a ±1-day stepper repeatedly.
 *      Setting it moves every day's calendar date (day i = startDate + i).
 *   3. DAYS span → add / remove a festival day (festival.days, capped to the
 *      engine's [1, 31]). Removing a day must keep the draft VALID: the parent's
 *      onRemoveDay cleans any cue `days` target that now points out of range.
 *
 * This component is presentational: it renders the controls and calls back into
 * timeline.tsx, which owns the draft mutation + cue cleanup. Every mutation in
 * the parent bumps draftVersion, which re-previews the overview, so the day
 * strips' sunrise/sunset refresh automatically when tz / start / days change.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DateWheel } from '@/components/timeline/DateWheel';

// Engine festival span bounds (marsin_engine/lib/timeline/show_plan.js:
// festival.days must be an integer in [1, 31]).
export const FESTIVAL_MIN_DAYS = 1;
export const FESTIVAL_MAX_DAYS = 31;

// Curated IANA tz options — the common US zones + BRC default first. The engine
// validates the string, so free-text would also work, but a tap list keeps the
// operator off the keyboard (maker idiom) for the 99% case. Order: playa first.
export const TZ_OPTIONS: { id: string; label: string }[] = [
  { id: 'America/Los_Angeles', label: 'Pacific (BRC)' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
  { id: 'UTC', label: 'UTC' },
];

export function FestivalEditor({
  startDate, days, tz, onSetStartDate, onAddDay, onRemoveDay, onSetTz,
}: {
  /** draft.festival.startDate ('YYYY-MM-DD'). */
  startDate: string;
  /** draft.festival.days (festival span length). */
  days: number;
  /** draft.location.tz (IANA), drives the sun estimate. */
  tz: string;
  /** Set the start date to a chosen 'YYYY-MM-DD' (shifts every day's date). */
  onSetStartDate: (dateKey: string) => void;
  /** Append a day (no-op past FESTIVAL_MAX_DAYS). */
  onAddDay: () => void;
  /** Drop the last day; the parent cleans out-of-range cue day targets. */
  onRemoveDay: () => void;
  /** Set the estimate tz (re-previews the overview → refreshes sun). */
  onSetTz: (tz: string) => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  // The date-picker modal's open state lives here — FestivalEditor owns the
  // wheel sheet and only hands the parent the confirmed 'YYYY-MM-DD'.
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const canAdd = days < FESTIVAL_MAX_DAYS;
  const canRemove = days > FESTIVAL_MIN_DAYS;
  const endDate = addDaysToDateKey(startDate, days - 1);

  return (
    <View style={styles.wrap}>
      {/* Row 1: estimate timezone — "estimate location for sunrise and set". */}
      <View style={styles.row}>
        <View style={styles.labelCol}>
          {/* `sun.max` (mapped to wb-sunny) reads as "the sky drives this" —
              the tz is the estimate location for the sun calc. Mapped names
              only: an unmapped SF-symbol renders a blank glyph on web. */}
          <IconSymbol name="sun.max" size={14} color={C.secondary} />
          <Text style={styles.label}>SUN ESTIMATE TZ</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tzScroll}
        >
          {TZ_OPTIONS.map((opt) => {
            const active = opt.id === tz;
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => onSetTz(opt.id)}
                style={[styles.tzChip, active && { backgroundColor: C.primary, borderColor: C.primary }]}
                accessibilityLabel={`Set sun estimate timezone to ${opt.label}`}
              >
                <Text style={[styles.tzChipText, { color: active ? C.onPrimary : C.text }]} numberOfLines={1}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      {/* The resolved IANA id, so the operator sees exactly what the engine gets
          even when a free-text / non-curated tz is loaded from a saved plan. */}
      <Text style={styles.tzResolved} numberOfLines={1}>{tz}</Text>

      {/* Row 2: festival span — start-date stepper + add/remove day. */}
      <View style={styles.row}>
        <View style={styles.labelCol}>
          <IconSymbol name="calendar.badge.clock" size={14} color={C.secondary} />
          <Text style={styles.label}>FESTIVAL</Text>
        </View>

        <View style={styles.spanControls}>
          {/* Start-date picker trigger — taps open a Year/Month/Day wheel so the
              operator jumps directly to any date (replaces the ±1-day stepper). */}
          <TouchableOpacity
            onPress={() => setDatePickerOpen(true)}
            style={styles.dateChip}
            accessibilityLabel="Pick festival start date"
          >
            <IconSymbol name="calendar.badge.clock" size={14} color={C.text} />
            <Text style={styles.dateChipText}>{startDate}</Text>
            <IconSymbol name="chevron.down" size={12} color={C.secondary} />
          </TouchableOpacity>

          {/* Day-count add / remove. */}
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={onRemoveDay}
              disabled={!canRemove}
              style={[styles.stepBtn, !canRemove && { opacity: 0.35 }]}
              accessibilityLabel="Remove the last festival day"
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.stepValue}>
              <Text style={styles.stepValueText}>{`${days} day${days === 1 ? '' : 's'}`}</Text>
            </View>
            <TouchableOpacity
              onPress={onAddDay}
              disabled={!canAdd}
              style={[styles.stepBtn, !canAdd && { opacity: 0.35 }]}
              accessibilityLabel="Add a festival day"
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Text style={styles.spanSummary} numberOfLines={1}>
        {`${startDate} → ${endDate}  ·  sun estimate updates on change`}
      </Text>

      <DateWheel
        visible={datePickerOpen}
        initialDate={startDate}
        onConfirm={(dateKey) => { onSetStartDate(dateKey); setDatePickerOpen(false); }}
        onClose={() => setDatePickerOpen(false)}
      />
    </View>
  );
}

// ── Date math (UTC-safe, no client suncalc — just calendar arithmetic) ──────
// We parse 'YYYY-MM-DD' at UTC noon so a ±day step never crosses a DST edge or
// a tz offset back into the previous calendar day. The engine owns the festival
// date→sun mapping; this is purely the label/stepper math.
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function addDaysToDateKey(dateKey: string, delta: number): string {
  const m = DATE_KEY_RE.exec(dateKey);
  if (!m) return dateKey; // malformed start — leave as-is; the engine 400s loudly on save.
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const base = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const shifted = new Date(base + delta * 86400000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(C: Palette) {
  return StyleSheet.create({
    wrap: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 12,
      backgroundColor: C.surfaceContainerLowest,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 14,
      gap: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    labelCol: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 132,
    },
    label: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.secondary,
      textTransform: 'uppercase',
    },
    tzScroll: {
      gap: 6,
      paddingRight: 8,
      flexGrow: 1,
    },
    tzChip: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      minHeight: 32,
      justifyContent: 'center',
    },
    tzChipText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
    },
    tzResolved: {
      fontFamily: 'Inter_400Regular',
      fontSize: 10,
      color: C.icon,
      marginLeft: 132,
    },
    spanControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      flexShrink: 1,
    },
    dateChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minHeight: 36,
      backgroundColor: C.surfaceContainerHigh,
    },
    dateChipText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.4,
      color: C.text,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 8,
      overflow: 'hidden',
    },
    stepBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      minWidth: 40,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.surfaceContainerHigh,
    },
    stepBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
      lineHeight: 20,
      color: C.text,
    },
    stepValue: {
      paddingHorizontal: 12,
      minWidth: 96,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepValueText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.4,
      color: C.text,
    },
    spanSummary: {
      fontFamily: 'Inter_400Regular',
      fontSize: 10,
      color: C.secondary,
      marginLeft: 132,
    },
  });
}
