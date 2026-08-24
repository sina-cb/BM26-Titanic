import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import type { TimelineAlert, TimelineAlertTone } from '@/utils/timeline_alert_model';
import { timelineLiveStatus } from '@/utils/timeline_operator_model';
import type { TimelineState } from '@/utils/timelineApi';

interface TimelineStatusHeaderProps {
  state: TimelineState | null;
  connected: boolean;
  syncAgeSec: number | null;
  dayLabel: string | null;
  alert: TimelineAlert | null;
}

export function TimelineStatusHeader({
  state,
  connected,
  syncAgeSec,
  dayLabel,
  alert,
}: TimelineStatusHeaderProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const liveStatus = timelineLiveStatus(state);
  const statusColors = {
    primary: [C.primaryContainer, C.primary],
    warning: [C.warningContainer, C.warning],
    danger: [C.errorContainer, C.error],
  }[liveStatus.tone];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.identity}>
          <Text style={styles.kicker}>TIMELINE OPERATOR</Text>
          <Text style={styles.plan}>LIVE STATUS</Text>
        </View>
        <View style={[styles.statusSentence, { backgroundColor: statusColors[0] }]}>
          <Text style={[styles.statusSentenceText, { color: statusColors[1] }]}>
            {liveStatus.sentence}
          </Text>
        </View>
        <View style={styles.clockBlock}>
          <Text style={styles.day}>{dayLabel || '—'}</Text>
          <Text style={[styles.sync, !connected && styles.syncBad]}>
            {connected
              ? `SYNC ${syncAgeSec === null ? 'WAITING' : `${syncAgeSec}s`}`
              : 'ENGINE OFFLINE'}
          </Text>
        </View>
      </View>
      {alert ? <TimelineAlertSlot alert={alert} /> : null}
    </View>
  );
}

function TimelineAlertSlot({ alert }: { alert: TimelineAlert }) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const toneColors: Record<TimelineAlertTone, [string, string, string]> = {
    danger: [C.errorContainer, C.errorContainerBorder, C.error],
    warning: [C.warningContainer, C.warningContainerBorder, C.warning],
    info: [C.secondaryContainer, C.tertiary, C.text],
    success: [C.secondaryContainer, C.tertiary, C.tertiary],
  };
  const colors = toneColors[alert.tone];
  return (
    <View
      style={[
        styles.alert,
        { backgroundColor: colors[0], borderColor: colors[1] },
      ]}
      accessibilityRole="alert"
    >
      <Text style={[styles.alertTitle, { color: colors[2] }]}>{alert.title}</Text>
      {alert.detail ? (
        <Text style={styles.alertDetail} numberOfLines={2}>{alert.detail}</Text>
      ) : null}
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    wrap: {
      gap: 10,
    },
    row: {
      minHeight: 78,
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      gap: 10,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 16,
      backgroundColor: C.surfaceContainerLow,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    identity: {
      minWidth: 150,
    },
    kicker: {
      ...Type.labelCaps,
      color: C.primary,
      marginBottom: 4,
    },
    plan: {
      ...Type.timelineCue,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    statusSentence: {
      flex: 1,
      minWidth: 320,
      minHeight: 52,
      justifyContent: 'center' as const,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 12,
    },
    statusSentenceText: {
      ...Type.timelineBody,
      fontFamily: 'Inter_600SemiBold',
      lineHeight: 21,
    },
    clockBlock: {
      minWidth: 120,
      alignItems: 'flex-end' as const,
    },
    day: {
      ...Type.timelineMeta,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    sync: {
      ...Type.body,
      color: C.tertiary,
      marginTop: 4,
    },
    syncBad: {
      color: C.error,
    },
    alert: {
      minHeight: 56,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 14,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
    },
    alertTitle: {
      ...Type.timelineMeta,
      minWidth: 190,
      textTransform: 'uppercase' as const,
    },
    alertDetail: {
      ...Type.timelineBody,
      color: C.text,
      flex: 1,
    },
  };
}
