import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { useDayFrame } from '@/hooks/use_day_frame';
import type { TimelineAlert } from '@/utils/timeline_alert_model';
import type { TimelineOperatorView } from '@/utils/timeline_operator_model';
import type { TimelineState } from '@/utils/timelineApi';
import type { DayFrame } from './day_frame_logic';
import { Segmented } from './makerControls';
import { TimelineModeTabs } from './timeline_mode_tabs';
import { TimelineStatusHeader } from './timeline_status_header';

// §D.1: the frame toggle is visible on ALL FOUR views (LIVE NEXT reads it too)
// and changes NOTHING except how time is sliced for rendering. Persisted per
// device (hooks/use_day_frame.tsx).
const FRAME_OPTIONS: { id: DayFrame; label: string }[] = [
  { id: 'working', label: 'WORKING DAY · 6 PM → 6 PM' },
  { id: 'regular', label: 'CALENDAR DAY · 12 AM → 12 AM' },
];

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
  const { frame, setFrame } = useDayFrame();
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
        <View style={styles.frameRow}>
          <View style={styles.frameToggle}>
            <Segmented options={FRAME_OPTIONS} value={frame} onChange={setFrame} />
          </View>
        </View>
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
    frameRow: {
      flexDirection: 'row' as const,
      justifyContent: 'flex-end' as const,
      marginTop: -6,
    },
    frameToggle: {
      minWidth: 420,
      minHeight: 44,
    },
  };
}
