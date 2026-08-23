import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import type { TimelineAlert } from '@/utils/timeline_alert_model';
import type { TimelineOperatorView } from '@/utils/timeline_operator_model';
import type { TimelineState } from '@/utils/timelineApi';
import { TimelineModeTabs } from './timeline_mode_tabs';
import { TimelineStatusHeader } from './timeline_status_header';

interface TimelineOperatorShellProps {
  state: TimelineState | null;
  connected: boolean;
  syncAgeSec: number | null;
  dayLabel: string | null;
  alert: TimelineAlert | null;
  view: TimelineOperatorView;
  editDisabled?: boolean;
  travelDisabled?: boolean;
  onView: (view: TimelineOperatorView) => void;
  children: React.ReactNode;
}

export function TimelineOperatorShell({
  state,
  connected,
  syncAgeSec,
  dayLabel,
  alert,
  view,
  editDisabled = false,
  travelDisabled = false,
  onView,
  children,
}: TimelineOperatorShellProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <TimelineStatusHeader
          state={state}
          connected={connected}
          syncAgeSec={syncAgeSec}
          dayLabel={dayLabel}
          alert={alert}
        />
        <TimelineModeTabs
          value={view}
          onChange={onView}
          editDisabled={editDisabled}
          travelDisabled={travelDisabled}
        />
        {children}
      </ScrollView>
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    container: {
      flex: 1,
      backgroundColor: C.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 36,
      gap: 14,
    },
  };
}
