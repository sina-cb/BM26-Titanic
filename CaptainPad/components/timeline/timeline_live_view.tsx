import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  timelineOwnerKindLabel,
  type TimelineNextCue,
  type TimelineNowOwner,
} from '@/utils/timeline_operator_model';
import type { OverviewCue as TimelineCueWire, TimelineState } from '@/utils/timelineApi';

interface TimelineLiveViewProps {
  state: TimelineState | null;
  nowOwner: TimelineNowOwner;
  nextCues: TimelineNextCue[];
  manualCues: TimelineCueWire[];
  nowMs: number;
  actionsDisabled: boolean;
  actionPending: boolean;
  actionFeedback: string | null;
  partyCard: React.ReactNode;
  onReviewCue: (cue: TimelineCueWire, date: string) => void;
  onReviewManualCue: (cue: TimelineCueWire) => void;
  onOpenBabyReveal: () => void;
  onTakeover: () => void;
  onPausePlan: () => void;
  onResumeLive: () => void;
  onEndProgram: () => void;
}

function formatCountdown(untilMs: number | null | undefined, nowMs: number): string | null {
  if (!untilMs) return null;
  const seconds = Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} REMAINING`;
}

// Format the OPERATOR-lease countdown as "M:SS UNTIL TIMELINE RESUMES" so the
// live view surfaces the exact number of seconds an inactive lease has left
// before the engine hands the deck back to the plan. Null when no lease.
function formatLeaseCountdown(
  lease: { expiresAtMs: number } | null | undefined,
  nowMs: number,
): string | null {
  if (!lease || !Number.isFinite(lease.expiresAtMs)) return null;
  const seconds = Math.max(0, Math.ceil((lease.expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} UNTIL TIMELINE RESUMES`;
}

function actionSummary(cue: TimelineCueWire): string {
  const action = cue.action;
  const parts = [
    action.type === 'playlist'
      ? action.name
      : action.type === 'look'
        ? action.look
        : action.type === 'special_event'
          ? `Special Event · ${action.showId}`
          : action.type,
    action.type === 'playlist' ? action.palette : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Review resolved deck action';
}

function isBabyCue(cue: TimelineCueWire): boolean {
  return cue.id === 'c_baby_reveal_pink' || cue.id === 'c_baby_reveal_blue';
}

export function TimelineLiveView({
  state,
  nowOwner,
  nextCues,
  manualCues,
  nowMs,
  actionsDisabled,
  actionPending,
  actionFeedback,
  partyCard,
  onReviewCue,
  onReviewManualCue,
  onOpenBabyReveal,
  onTakeover,
  onPausePlan,
  onResumeLive,
  onEndProgram,
}: TimelineLiveViewProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { width } = useWindowDimensions();
  const ipadLayout = width < 1280;
  const narrowLayout = width < 900;
  const countdown = formatCountdown(state?.activeCue?.untilMs, nowMs);
  const leaseCountdown = formatLeaseCountdown(state?.operatorLease, nowMs);
  const leaseSec = state?.operatorLeaseSec ?? null;
  const babyCues = manualCues.filter(isBabyCue);
  const otherManualCues = manualCues.filter((cue) => !isBabyCue(cue));
  const isManual = state?.controller === 'manual';
  const leaseHeld = !!state?.operatorLease;
  const planActive = state?.planActive === true;
  const inFestivalWindow = state?.inFestivalWindow !== false;

  // The RESUME button's contextual explanation. Autopilot is an engine
  // mechanism; the operator-facing owner is the Timeline (or the active
  // plan), so we call the return "RESUME TIMELINE NOW" and describe what
  // will actually happen when it fires.
  const resumeHint = (() => {
    if (state?.zoom) return 'Exit Time Travel and let the live plan resolve now.';
    if (!state?.activePlan) return 'Activate a plan in PLANS before resuming Timeline.';
    if (!inFestivalWindow) {
      return 'The active plan is dormant (outside its festival window). Timeline will not take the deck back.';
    }
    if (state?.autopilotEnabled === false) {
      return 'Timeline is off. RESUME TIMELINE NOW will enable the active plan and resolve what should run now.';
    }
    if (!planActive) return 'The active plan is inside its schedule but is not driving yet. Resume Timeline now.';
    if (leaseHeld) {
      return leaseSec !== null
        ? `Return the deck to the plan now. Otherwise Timeline will resume automatically after ${leaseSec} s of inactivity.`
        : 'Return the deck to the plan now.';
    }
    return 'TAKE OVER is temporary and auto-resumes. PAUSE PLAN stays off until you resume it.';
  })();

  return (
    <View style={[styles.columns, ipadLayout && styles.columnsIpad]}>
      <View style={[styles.mainColumn, ipadLayout && styles.mainColumnIpad]}>
        <View style={[styles.card, styles.nowCard]}>
          <View style={styles.cardHeader}>
            <Text style={styles.eyebrow}>NOW · {timelineOwnerKindLabel(nowOwner.kind)}</Text>
            <Text style={styles.ownerSource}>{nowOwner.sourceLabel}</Text>
          </View>
          <Text style={styles.nowTitle} numberOfLines={2}>{nowOwner.label}</Text>
          <View style={styles.ownerMetaRow}>
            <Text style={styles.ownerMeta}>
              {nowOwner.rangeLabel || 'Operator-controlled window'}
            </Text>
            {countdown ? <Text style={styles.countdown}>{countdown}</Text> : null}
          </View>
          <Text style={styles.action}>
            {[nowOwner.playlist, nowOwner.palette].filter(Boolean).join(' · ')
              || (isManual ? 'Operator takeover owns Deck output' : 'Resolved baseline look')}
          </Text>
          {state?.activeSequence ? (
            <View style={styles.sequence}>
              <Text style={styles.sequenceTitle}>
                SEQUENCE STEP {Math.min(state.activeSequence.nextStepIndex + 1, state.activeSequence.totalSteps)}
                {' / '}{state.activeSequence.totalSteps}
              </Text>
              <Text style={styles.sequenceBody}>
                Next transition in {Math.max(0, state.activeSequence.nextInSec)}s
              </Text>
            </View>
          ) : null}
          <View style={styles.actionRow}>
            {state?.zoom ? (
              <PrimaryButton
                label="RESUME TIMELINE NOW"
                onPress={onResumeLive}
                disabled={actionsDisabled || actionPending}
                pending={actionPending}
                tone="primary"
              />
            ) : state?.activeProgram ? (
              <>
                <PrimaryButton
                  label="END PROGRAM"
                  onPress={onEndProgram}
                  disabled={actionsDisabled || actionPending}
                  tone="warning"
                />
                <PrimaryButton
                  label="PAUSE PLAN"
                  onPress={onPausePlan}
                  disabled={actionsDisabled || actionPending}
                  tone="neutral"
                />
              </>
            ) : isManual ? (
              <PrimaryButton
                label="RESUME TIMELINE NOW"
                onPress={onResumeLive}
                disabled={actionsDisabled || actionPending}
                pending={actionPending}
                tone="primary"
              />
            ) : (
              <>
                <PrimaryButton
                  label="TAKE OVER"
                  onPress={onTakeover}
                  disabled={actionsDisabled || actionPending}
                  tone="neutral"
                />
                <PrimaryButton
                  label="PAUSE PLAN"
                  onPress={onPausePlan}
                  disabled={actionsDisabled || actionPending}
                  tone="warning"
                />
              </>
            )}
          </View>
          {leaseCountdown ? (
            <Text style={styles.leaseCountdown} accessibilityLiveRegion="polite">
              {leaseCountdown}
            </Text>
          ) : null}
          {resumeHint ? (
            <Text style={styles.actionHint}>{resumeHint}</Text>
          ) : null}
          {actionFeedback ? (
            <Text style={styles.actionFeedback} accessibilityLiveRegion="polite">
              {actionFeedback}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>NEXT</Text>
          {nextCues.length === 0 ? (
            <Text style={styles.empty}>No later timed cues in the saved live plan.</Text>
          ) : nextCues.map((item, index) => (
            <TouchableOpacity
              key={`${item.date}-${item.cue.id}`}
              style={styles.nextRow}
              onPress={() => onReviewCue(item.cue, item.date)}
              accessibilityRole="button"
              accessibilityLabel={`Review ${item.cue.label} at ${item.time}`}
            >
              <View style={styles.nextTimeBlock}>
                <Text style={styles.nextTime} numberOfLines={1}>
                  {item.rowLabel}
                </Text>
                <Text style={styles.nextOrdinal}>NEXT {index + 1}</Text>
              </View>
              <View style={styles.nextBody}>
                <Text style={styles.nextLabel}>{item.cue.label}</Text>
                <Text style={styles.nextAction} numberOfLines={1}>{actionSummary(item.cue)}</Text>
              </View>
              <Text style={styles.review}>REVIEW ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[
        styles.sideColumn,
        ipadLayout && styles.sideRow,
        narrowLayout && styles.sideColumnNarrow,
      ]}>
        <View style={ipadLayout && !narrowLayout ? styles.sideCard : undefined}>
          {partyCard}
        </View>
        <View style={[styles.card, ipadLayout && !narrowLayout && styles.sideCard]}>
          <Text style={styles.sectionTitle}>ON DEMAND</Text>
          <Text style={styles.sectionNote}>
            Human-triggered only. Tap to review; nothing fires immediately.
          </Text>
          {babyCues.length > 0 ? (
            <TouchableOpacity
              style={styles.manualButton}
              onPress={onOpenBabyReveal}
              accessibilityRole="button"
              accessibilityLabel="Review protected Baby Reveal choice"
            >
              <View style={styles.manualBody}>
                <Text style={styles.manualLabel}>BABY REVEAL…</Text>
                <Text style={styles.manualMeta}>PROTECTED PINK / BLUE CHOICE</Text>
              </View>
              <Text style={styles.review}>REVIEW ›</Text>
            </TouchableOpacity>
          ) : null}
          {otherManualCues.map((cue) => (
            <TouchableOpacity
              key={cue.id}
              style={styles.manualButton}
              onPress={() => onReviewManualCue(cue)}
              accessibilityRole="button"
              accessibilityLabel={`Review on-demand cue ${cue.label}`}
            >
              <View style={styles.manualBody}>
                <Text style={styles.manualLabel}>{cue.label}</Text>
                <Text style={styles.manualMeta}>{actionSummary(cue)}</Text>
              </View>
              <Text style={styles.review}>REVIEW ›</Text>
            </TouchableOpacity>
          ))}
          {manualCues.length === 0 ? (
            <Text style={styles.empty}>
              This live plan has no ON-DEMAND cues, so there is nothing to review here.
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  pending = false,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  pending?: boolean;
  tone: 'primary' | 'warning' | 'neutral';
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const backgroundColor = tone === 'primary'
    ? C.primary
    : tone === 'warning'
      ? C.warning
      : C.surfaceContainerHigh;
  const color = tone === 'primary' ? C.onPrimary : C.text;
  return (
    <TouchableOpacity
      style={[styles.primaryButton, { backgroundColor }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      {pending ? <ActivityIndicator size="small" color={color} /> : null}
      <Text
        style={[styles.primaryButtonText, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
      >
        {pending ? 'RETURNING CONTROL…' : label}
      </Text>
    </TouchableOpacity>
  );
}

function makeStyles(C: Palette) {
  return {
    columns: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: 14,
    },
    columnsIpad: {
      flexDirection: 'column' as const,
      alignItems: 'stretch' as const,
    },
    mainColumn: {
      flex: 1.6,
      gap: 14,
    },
    mainColumnIpad: {
      width: '100%' as const,
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 'auto' as const,
    },
    sideColumn: {
      flex: 1,
      gap: 14,
    },
    sideRow: {
      width: '100%' as const,
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 'auto' as const,
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
    },
    sideColumnNarrow: {
      flexDirection: 'column' as const,
    },
    sideCard: {
      flex: 1,
      minWidth: 0,
    },
    card: {
      borderRadius: 18,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 18,
      gap: 10,
    },
    nowCard: {
      borderColor: C.primary,
      borderWidth: 2,
    },
    cardHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
    },
    eyebrow: {
      ...Type.timelineMeta,
      color: C.primary,
      letterSpacing: 0.8,
    },
    ownerSource: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
    },
    nowTitle: {
      ...Type.timelineHero,
      color: C.text,
      textTransform: 'uppercase' as const,
      marginVertical: 6,
    },
    ownerMetaRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    ownerMeta: {
      ...Type.timelineMeta,
      color: C.secondary,
    },
    countdown: {
      ...Type.timelineMeta,
      color: C.warning,
    },
    action: {
      ...Type.timelineCue,
      color: C.text,
    },
    sequence: {
      borderRadius: 12,
      backgroundColor: C.secondaryContainer,
      padding: 13,
      gap: 3,
    },
    sequenceTitle: {
      ...Type.timelineMeta,
      color: C.tertiary,
    },
    sequenceBody: {
      ...Type.timelineBody,
      color: C.text,
    },
    actionRow: {
      flexDirection: 'row' as const,
      gap: 8,
      marginTop: 4,
      alignSelf: 'stretch' as const,
    },
    primaryButton: {
      minHeight: 54,
      flex: 1,
      minWidth: 0,
      borderRadius: 12,
      paddingHorizontal: 22,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      flexDirection: 'row' as const,
      gap: 9,
    },
    primaryButtonText: {
      ...Type.timelineMeta,
      letterSpacing: 0.7,
      textAlign: 'center' as const,
    },
    disabled: {
      opacity: 0.38,
    },
    actionFeedback: {
      ...Type.timelineBody,
      fontFamily: 'Inter_600SemiBold',
      color: C.tertiary,
    },
    leaseCountdown: {
      ...Type.timelineMeta,
      color: C.warning,
      marginTop: 4,
    },
    actionHint: {
      ...Type.timelineBody,
      color: C.secondary,
      marginTop: 4,
    },
    sectionTitle: {
      ...Type.timelineTitle,
      color: C.text,
    },
    sectionNote: {
      ...Type.timelineBody,
      color: C.secondary,
    },
    nextRow: {
      minHeight: 72,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 14,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: C.ghostBorder,
    },
    nextTimeBlock: {
      // Wide enough for the longest frame row label ("TOMORROW NIGHT 7:14 PM"),
      // which replaced the bare clock time in _359 §D.7.
      width: 190,
    },
    nextTime: {
      ...Type.timelineCue,
      color: C.primary,
    },
    nextOrdinal: {
      ...Type.labelCaps,
      color: C.secondary,
      marginTop: 3,
    },
    nextBody: {
      flex: 1,
      gap: 2,
    },
    nextLabel: {
      ...Type.timelineCue,
      color: C.text,
    },
    nextAction: {
      ...Type.timelineBody,
      color: C.secondary,
    },
    review: {
      ...Type.timelineMeta,
      color: C.primary,
    },
    manualButton: {
      minHeight: 56,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 12,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    manualBody: {
      flex: 1,
      minWidth: 0,
    },
    manualLabel: {
      ...Type.timelineCue,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    manualMeta: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
      marginTop: 2,
    },
    empty: {
      ...Type.timelineBody,
      color: C.secondary,
      paddingVertical: 10,
    },
  };
}
