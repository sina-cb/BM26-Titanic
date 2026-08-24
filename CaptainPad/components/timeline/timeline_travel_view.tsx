import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  timelineTravelCuesForDay,
  timelineTravelDayLabel,
  type TimelineTravelCue,
} from '@/utils/timeline_operator_model';
import {
  frameNowSentence,
  frameNowStatus,
  type DayFrame,
} from './day_frame_logic';
import type {
  OverviewCue,
  TimelineOverview,
  TimelineResolve,
  TimelineZoom,
} from '@/utils/timelineApi';
import { shiftTimelineLocalTime } from '@/utils/timeline_travel_model';

// §D.5: one copy line so the operator can never mis-read which calendar day an
// ADVANCED time lands on.
const TRAVEL_FRAME_NOTE =
  'Times are plan-local. In the working-day frame, times before 6 PM fall on the next morning.';

interface TimelineTravelViewProps {
  overview: TimelineOverview | null;
  frame: DayFrame;
  todayDate: string | null;
  /** Minutes-of-day in the plan tz — decides which span is badged TODAY. */
  nowMinutes: number | null;
  targetDate: string | null;
  targetTime: string;
  selectedCueId: string | null;
  advancedOpen: boolean;
  resolved: TimelineResolve | null;
  previewError: string | null;
  resolving: boolean;
  busy: boolean;
  pendingLeadSeconds: number | null;
  actionsDisabled: boolean;
  zoom: TimelineZoom | null | undefined;
  onTargetDate: (date: string) => void;
  onTargetTime: (time: string) => void;
  onSelectCue: (entry: TimelineTravelCue) => void;
  onToggleAdvanced: () => void;
  onTravel: () => void;
  onTravelBefore: () => void;
  onResumeLive: () => void;
}

function cueActionSummary(cue: OverviewCue): string {
  if (cue.action.type === 'playlist') {
    return [cue.action.name, cue.action.palette].filter(Boolean).join(' · ');
  }
  if (cue.action.type === 'look') return cue.action.look;
  if (cue.action.type === 'sequence') return `${cue.action.steps.length} step sequence`;
  return cue.action.type.replace(/_/g, ' ');
}

function deckSummary(resolved: TimelineResolve | null, cue: OverviewCue | null): string[] {
  if (!resolved) return [];
  return [
    cue ? `CUE · ${cue.label}` : null,
    `DECK OWNER · ${resolved.owner?.label || 'AUTOPILOT BASELINE'}`,
    resolved.playlist ? `PLAYLIST · ${resolved.playlist}` : null,
    resolved.palette ? `PALETTE · ${resolved.palette}` : null,
    resolved.windowUntilLocal ? `HOLDS UNTIL · ${resolved.windowUntilLocal}` : null,
  ].filter((line): line is string => line !== null);
}

export function TimelineTravelView({
  overview,
  frame,
  todayDate,
  nowMinutes,
  targetDate,
  targetTime,
  selectedCueId,
  advancedOpen,
  resolved,
  previewError,
  resolving,
  busy,
  pendingLeadSeconds,
  actionsDisabled,
  zoom,
  onTargetDate,
  onTargetTime,
  onSelectCue,
  onToggleAdvanced,
  onTravel,
  onTravelBefore,
  onResumeLive,
}: TimelineTravelViewProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { width } = useWindowDimensions();
  const ipadLayout = width < 1280;
  const active = zoom?.scope === 'travel';
  const travelCues = useMemo(
    () => timelineTravelCuesForDay(overview, frame, targetDate),
    [frame, overview, targetDate],
  );
  // The badge follows the FRAME, not the calendar (C-08): only the span that
  // actually contains NOW is TODAY, and before the first night opens the first
  // card reads TONIGHT instead (C-01).
  const nowStatus = frameNowStatus(frame, overview?.days ?? [], todayDate, nowMinutes);
  const nowSentence = frameNowSentence(frame, overview?.days ?? [], todayDate, nowMinutes);
  const selectedEntry = travelCues.find((entry) => entry.cue.id === selectedCueId) ?? null;
  const selectedCue = selectedEntry?.cue ?? null;
  const summary = deckSummary(resolved, selectedCue);
  const selectionReady = selectedCue !== null || advancedOpen;
  const travelDisabled = actionsDisabled
    || busy
    || resolving
    || !!previewError
    || !resolved
    || !selectionReady;

  return (
    <View style={styles.wrap}>
      {active ? (
        <View style={styles.activeLine} accessibilityRole="alert">
          <Text style={styles.activeDetail}>
            TIME TRAVEL ACTIVE · {zoom.label || zoom.targetLocal || 'SAVED SNAPSHOT'}
          </Text>
          <TouchableOpacity
            style={[styles.resumeButton, (actionsDisabled || busy) && styles.disabled]}
            onPress={onResumeLive}
            disabled={actionsDisabled || busy}
            accessibilityRole="button"
          >
            <Text style={styles.resumeLabel}>RESUME LIVE</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.columns, ipadLayout && styles.columnsIpad]}>
        <View style={[styles.card, styles.targetCard]}>
          <Text style={styles.eyebrow}>
            {frame === 'working' ? '1 · CHOOSE A FESTIVAL NIGHT' : '1 · CHOOSE A FESTIVAL DAY'}
          </Text>
          {nowSentence ? <Text style={styles.error}>{nowSentence}</Text> : null}
          <Text style={styles.title}>Run a saved cue as if it is happening now</Text>
          <Text style={styles.body}>
            Choosing only previews the result. The rig changes after a separate confirmation.
          </Text>

          <View style={styles.dayGrid}>
            {(overview?.days || []).map((day, index) => {
              const selected = day.date === targetDate;
              const isNow = nowStatus.kind === 'inside' && nowStatus.index === index;
              const isTonight = nowStatus.kind === 'before-first' && index === 0;
              return (
                <TouchableOpacity
                  key={day.date}
                  style={[styles.dayButton, selected && styles.dayButtonSelected]}
                  onPress={() => onTargetDate(day.date)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.dayLabel, selected && styles.dayLabelSelected]}>
                    {timelineTravelDayLabel(overview, frame, index) ?? day.weekday.slice(0, 3)}
                  </Text>
                  <Text style={[styles.dayDate, selected && styles.dayLabelSelected]}>
                    {day.date.slice(5)}
                  </Text>
                  {isNow ? (
                    <Text style={[styles.todayLabel, selected && styles.dayLabelSelected]}>
                      TODAY
                    </Text>
                  ) : isTonight ? (
                    <Text style={[styles.todayLabel, selected && styles.dayLabelSelected]}>
                      TONIGHT
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.eyebrow}>2 · CHOOSE A CUE</Text>
          <ScrollView style={styles.cueList} nestedScrollEnabled>
            {travelCues.map((entry) => {
              const cue = entry.cue;
              const selected = cue.id === selectedCueId;
              return (
                <TouchableOpacity
                  key={cue.id}
                  style={[styles.cueButton, selected && styles.cueButtonSelected]}
                  onPress={() => onSelectCue(entry)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <View style={styles.cueTimeBlock}>
                    <Text style={[styles.cueTime, selected && styles.cueTextSelected]}>
                      {entry.rowLabel}
                    </Text>
                  </View>
                  <View style={styles.cueBody}>
                    <Text style={[styles.cueLabel, selected && styles.cueTextSelected]}>
                      {cue.label}
                    </Text>
                    <Text
                      style={[styles.cueMeta, selected && styles.cueTextSelected]}
                      numberOfLines={1}
                    >
                      {cueActionSummary(cue)}
                    </Text>
                  </View>
                  <Text style={[styles.chooseLabel, selected && styles.cueTextSelected]}>
                    {selected ? 'SELECTED' : 'SELECT ›'}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {travelCues.length === 0 ? (
              <Text style={styles.body}>This day has no timed cues to run.</Text>
            ) : null}
          </ScrollView>

          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={onToggleAdvanced}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
          >
            <Text style={styles.advancedToggleText}>
              {advancedOpen ? 'HIDE ADVANCED TIME' : 'ADVANCED · CHOOSE AN EXACT TIME'}
            </Text>
          </TouchableOpacity>
          {advancedOpen ? (
            <View style={styles.advancedPanel}>
              <Text style={styles.body}>
                Exact-time travel is for rehearsal between cues.
              </Text>
              <Text style={styles.body}>{TRAVEL_FRAME_NOTE}</Text>
              <View style={styles.timeRow}>
                <TouchableOpacity
                  style={styles.stepButton}
                  onPress={() => onTargetTime(shiftTimelineLocalTime(targetTime, -15))}
                  accessibilityRole="button"
                  accessibilityLabel="Move Time Travel target back 15 minutes"
                >
                  <Text style={styles.stepLabel}>−15</Text>
                </TouchableOpacity>
                <View style={styles.timeDisplay}>
                  <Text style={styles.timeValue}>{targetTime}</Text>
                  <Text style={styles.timeMeta}>PLAN LOCAL TIME</Text>
                </View>
                <TouchableOpacity
                  style={styles.stepButton}
                  onPress={() => onTargetTime(shiftTimelineLocalTime(targetTime, 15))}
                  accessibilityRole="button"
                  accessibilityLabel="Move Time Travel target forward 15 minutes"
                >
                  <Text style={styles.stepLabel}>+15</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, styles.previewCard]}>
          <View style={styles.previewHeader}>
            <Text style={styles.eyebrow}>3 · REVIEW WHAT THE DECK WILL SHOW</Text>
            {resolving ? <ActivityIndicator size="small" color={C.primary} /> : null}
          </View>
          <Text style={styles.previewMoment}>
            {selectedCue
              ? `${selectedCue.label} · ${selectedCue.atLocal}`
              : advancedOpen
                ? `${targetDate || 'NO DAY'} · ${targetTime}`
                : 'SELECT A CUE'}
          </Text>
          {previewError ? (
            <Text style={styles.error} accessibilityRole="alert">{previewError}</Text>
          ) : summary.length > 0 ? summary.map((line) => (
            <Text key={line} style={styles.previewLine}>{line}</Text>
          )) : (
            <Text style={styles.body}>Waiting for an authoritative resolver response.</Text>
          )}
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>THIS CHANGES THE LIVE RIG</Text>
            <Text style={styles.warningBody}>
              The chosen cue becomes NOW. Timeline autopilot pauses until RESUME LIVE.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.travelButton, travelDisabled && styles.disabled]}
            onPress={onTravel}
            disabled={travelDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: travelDisabled }}
          >
            {busy && pendingLeadSeconds === null
              ? <ActivityIndicator size="small" color={C.onPrimary} /> : (
              <Text style={styles.travelLabel}>
                {selectedCue ? 'RUN THIS CUE AS NOW' : 'RUN THIS TIME AS NOW'}
              </Text>
            )}
          </TouchableOpacity>
          {selectedCue ? (
            <TouchableOpacity
              style={[styles.preRollButton, travelDisabled && styles.disabled]}
              onPress={onTravelBefore}
              disabled={travelDisabled}
              accessibilityRole="button"
              accessibilityLabel="Start Time Travel ten seconds before this cue"
              accessibilityState={{ disabled: travelDisabled }}
            >
              {busy && pendingLeadSeconds === 10
                ? <ActivityIndicator size="small" color={C.primary} /> : (
                <>
                  <Text style={styles.preRollLabel}>⏪ START 10 SEC BEFORE CUE</Text>
                  <Text style={styles.preRollHelp}>
                    inspect the Deck, then tap ▶ to apply this cue
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    wrap: {
      gap: 14,
    },
    columns: {
      flexDirection: 'row' as const,
      alignItems: 'stretch' as const,
      gap: 14,
    },
    columnsIpad: {
      flexDirection: 'column' as const,
    },
    card: {
      borderRadius: 18,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 20,
      gap: 12,
    },
    targetCard: {
      flex: 1.15,
    },
    previewCard: {
      flex: 1,
    },
    activeLine: {
      minHeight: 54,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 14,
      paddingHorizontal: 18,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.tertiary,
      backgroundColor: C.secondaryContainer,
    },
    activeDetail: {
      ...Type.timelineMeta,
      color: C.tertiary,
      flex: 1,
    },
    resumeButton: {
      minHeight: 42,
      minWidth: 140,
      borderRadius: 10,
      backgroundColor: C.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 18,
    },
    resumeLabel: {
      ...Type.timelineMeta,
      color: C.onPrimary,
    },
    eyebrow: {
      ...Type.timelineMeta,
      color: C.primary,
      letterSpacing: 0.8,
    },
    title: {
      ...Type.timelineTitle,
      color: C.text,
    },
    body: {
      ...Type.timelineBody,
      color: C.secondary,
    },
    dayGrid: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 8,
    },
    dayButton: {
      minWidth: 66,
      minHeight: 56,
      borderRadius: 10,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    dayButtonSelected: {
      backgroundColor: C.primary,
      borderColor: C.primary,
    },
    dayLabel: {
      ...Type.timelineMeta,
      fontSize: 14,
      color: C.text,
    },
    dayDate: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
      marginTop: 2,
    },
    dayLabelSelected: {
      color: C.onPrimary,
    },
    todayLabel: {
      ...Type.labelCaps,
      fontSize: 9,
      color: C.error,
      marginTop: 2,
    },
    cueList: {
      maxHeight: 310,
    },
    cueButton: {
      minHeight: 68,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 13,
      paddingVertical: 9,
      marginBottom: 8,
    },
    cueButtonSelected: {
      backgroundColor: C.primary,
      borderColor: C.primary,
    },
    cueTimeBlock: {
      minWidth: 64,
    },
    cueTime: {
      ...Type.timelineCue,
      color: C.primary,
    },
    cueBody: {
      flex: 1,
      minWidth: 0,
    },
    cueLabel: {
      ...Type.timelineCue,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    cueMeta: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
      marginTop: 2,
      textTransform: 'uppercase' as const,
    },
    chooseLabel: {
      ...Type.timelineMeta,
      color: C.primary,
    },
    cueTextSelected: {
      color: C.onPrimary,
    },
    advancedToggle: {
      minHeight: 48,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 14,
    },
    advancedToggleText: {
      ...Type.timelineMeta,
      color: C.secondary,
    },
    advancedPanel: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 12,
      gap: 8,
    },
    timeRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      marginTop: 4,
    },
    stepButton: {
      minWidth: 72,
      minHeight: 58,
      borderRadius: 12,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    stepLabel: {
      ...Type.timelineCue,
      color: C.primary,
    },
    timeDisplay: {
      flex: 1,
      minHeight: 80,
      borderRadius: 14,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    timeValue: {
      ...Type.timelineHero,
      color: C.text,
    },
    timeMeta: {
      ...Type.labelCaps,
      color: C.secondary,
      marginTop: 3,
    },
    previewHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
    },
    previewMoment: {
      ...Type.timelineTitle,
      color: C.text,
    },
    previewLine: {
      ...Type.timelineCue,
      color: C.text,
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: C.ghostBorder,
    },
    error: {
      ...Type.timelineBody,
      color: C.error,
    },
    warning: {
      marginTop: 'auto' as const,
      borderRadius: 12,
      padding: 13,
      backgroundColor: C.warningContainer,
      borderWidth: 1,
      borderColor: C.warningContainerBorder,
    },
    warningTitle: {
      ...Type.timelineMeta,
      color: C.warning,
    },
    warningBody: {
      ...Type.timelineBody,
      color: C.text,
      marginTop: 3,
    },
    travelButton: {
      minHeight: 56,
      borderRadius: 12,
      backgroundColor: C.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    preRollButton: {
      minHeight: 64,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: C.primary,
      backgroundColor: C.surfaceContainerLowest,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    preRollLabel: {
      ...Type.timelineMeta,
      color: C.primary,
      textAlign: 'center' as const,
    },
    preRollHelp: {
      ...Type.timelineBody,
      color: C.secondary,
      textAlign: 'center' as const,
      marginTop: 4,
    },
    travelLabel: {
      ...Type.timelineMeta,
      color: C.onPrimary,
    },
    disabled: {
      opacity: 0.38,
    },
  };
}
