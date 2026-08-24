/**
 * DayTimePicker — a VISUAL 24h day column for the cue editor's clock-trigger
 * cues (operator: "show the pane for the day and place the event on the
 * time; allow setting start and duration visually as well").
 *
 * The pane shows:
 *   - the cue being edited as a kind-colored BLOCK at [start, start+duration),
 *     updating LIVE as the steppers / presets change (fully controlled);
 *   - the day's OTHER clock cues as dim kind-colored context blocks (point
 *     cues — no duration — render as hairline markers);
 *   - hour gridlines + 12h labels down the left edge.
 *
 * Interaction (tablet-first, plain PanResponder — the NauticalFader /
 * HorizontalFader idiom):
 *   - TAP anywhere on the column → sets the cue START at that time, snapped
 *     to 15-minute increments (vertical drags remain available to scroll the
 *     Add/Edit Cue sheet);
 *   - DRAG the pill handle on the block's bottom edge → adjusts DURATION in
 *     15-minute steps (two-way synced with the duration presets / stepper).
 *
 * Geometry matches every Timeline calendar — top = 6 PM on the selected date,
 * bottom = 6 PM on the following date — at a taller PANE_HEIGHT (480) so
 * 15-minute targeting is practical. Sunrise/sunset shading is deliberately
 * OMITTED: this sheet only receives the raw ShowPlan (no /timeline/overview
 * sun table), and CaptainPad has no client-side solar math to compute it.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, PanResponder, Platform, Pressable, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { CueKind } from '@/utils/timelineApi';
import { acquireScrollLock, type ScrollLockHandle } from '@/components/ui/scroll_lock';
import { kindColor, minutesTo12h } from './timelineTemplate';
import {
  TIMELINE_DAY_START_MIN,
  TIMELINE_OPERATOR_SNAP_MIN,
  timelineHourOffsets,
} from './night_calendar_logic';

// Tall enough that one 15-min slot = 5px. Dragging/tapping stays easy while
// the exact-time steppers above this picker remain the precision fallback.
export const PANE_HEIGHT = 480;
const SNAP_MIN = TIMELINE_OPERATOR_SNAP_MIN;
const HANDLE_H = 18;
const LABEL_STEP_MIN = 180;

/** A resolvable context cue on the selected day (dim, non-interactive). */
export interface DayTimeContextCue {
  startMinutes: number;
  /** 0 = point cue (renders as a hairline marker, not a block). */
  durationMin: number;
  kind: CueKind;
  label?: string;
}

/** Offset inside the fixed 6 PM→6 PM operator day. */
export function timelineDayOffset(mins: number): number {
  const normalized = ((mins % 1440) + 1440) % 1440;
  return normalized >= TIMELINE_DAY_START_MIN
    ? normalized - TIMELINE_DAY_START_MIN
    : (1440 - TIMELINE_DAY_START_MIN) + normalized;
}

function yFor(mins: number): number {
  return (timelineDayOffset(mins) / 1440) * PANE_HEIGHT;
}

function minutesForY(y: number): number {
  const offset = Math.max(
    0,
    Math.min(1440 - SNAP_MIN, snapMinutes((y / PANE_HEIGHT) * 1440)),
  );
  return (TIMELINE_DAY_START_MIN + offset) % 1440;
}

function minutesForOffset(offset: number): number {
  return (TIMELINE_DAY_START_MIN + offset) % 1440;
}

function formatDuration(minutes: number): string {
  return minutes < 1 ? `${Math.round(minutes * 60)} sec` : `${minutes} min`;
}

function formatTime(minutes: number): string {
  let wholeMinutes = Math.floor(minutes);
  let seconds = Math.round((minutes - wholeMinutes) * 60);
  if (seconds === 60) {
    wholeMinutes += 1;
    seconds = 0;
  }
  const base = minutesTo12h(wholeMinutes);
  return seconds === 0
    ? base
    : base.replace(/ (AM|PM)$/, `:${String(seconds).padStart(2, '0')} $1`);
}

function snapMinutes(mins: number): number {
  return Math.round(mins / SNAP_MIN) * SNAP_MIN;
}

export function DayTimePicker({
  startMinutes, durationMin, kind, others, onChangeStart, onChangeDuration,
  minDuration = 5, maxDuration = 720,
}: {
  /** Cue start, minutes-of-day (0..1439) — controlled by the parent sheet. */
  startMinutes: number;
  /** Cue duration in minutes — controlled by the parent sheet. */
  durationMin: number;
  kind: CueKind;
  /** The plan's OTHER resolvable cues on this day (context, dimmed). */
  others: DayTimeContextCue[];
  /** Fires with a 15-min-snapped minutes-of-day when the column is tapped/dragged. */
  onChangeStart: (mins: number) => void;
  /** Fires with a 15-min-snapped duration when the bottom handle is dragged. */
  onChangeDuration: (mins: number) => void;
  minDuration?: number;
  maxDuration?: number;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  // PanResponders are created ONCE (useRef) so their closures must read live
  // values through refs, never through render-scope props (the fader idiom).
  const propsRef = useRef({
    startMinutes, durationMin, onChangeStart, onChangeDuration, minDuration, maxDuration,
  });
  propsRef.current = {
    startMinutes, durationMin, onChangeStart, onChangeDuration, minDuration, maxDuration,
  };

  // ── Column press: TAP sets START ─────────────────────────────────────
  // A plain Pressable deliberately does NOT claim vertical movement. The
  // owning LockableScrollView can therefore cancel the press and scroll when
  // the operator drags through this tall pane; only a completed tap writes.
  const sendStart = (y: number) => {
    propsRef.current.onChangeStart(minutesForY(y));
  };

  // ── Handle responder: drag the block's bottom edge sets DURATION ─────
  // Grant snapshots the duration; moves convert dy → minutes, snap to 15 and
  // clamp to [minDuration, maxDuration], emitting only on change.
  const dragBaseDurRef = useRef(0);
  const lastDurRef = useRef<number | null>(null);
  const scrollLockRef = useRef<ScrollLockHandle | null>(null);
  const lockScroll = useCallback(() => {
    if (Platform.OS === 'web' || scrollLockRef.current) return;
    scrollLockRef.current = acquireScrollLock();
  }, []);
  const unlockScroll = useCallback(() => {
    scrollLockRef.current?.release();
    scrollLockRef.current = null;
  }, []);
  useEffect(() => unlockScroll, [unlockScroll]);

  // ── Top notch responder: drag the WHOLE window ──────────────────────
  // The cue duration is preserved. Start moves on the same fixed 6 PM axis,
  // snapped to 15 minutes and clamped so the complete block remains visible.
  const dragBaseStartOffsetRef = useRef(0);
  const lastStartRef = useRef<number | null>(null);
  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        lockScroll();
        dragBaseStartOffsetRef.current = timelineDayOffset(propsRef.current.startMinutes);
        lastStartRef.current = null;
      },
      onPanResponderMove: (_evt, gs) => {
        const p = propsRef.current;
        const maxOffset = Math.max(0, 1440 - Math.min(1440, p.durationMin));
        const raw = dragBaseStartOffsetRef.current + (gs.dy / PANE_HEIGHT) * 1440;
        const offset = Math.max(0, Math.min(maxOffset, snapMinutes(raw)));
        const start = minutesForOffset(offset);
        if (lastStartRef.current === start) return;
        lastStartRef.current = start;
        p.onChangeStart(start);
      },
      onPanResponderRelease: unlockScroll,
      onPanResponderTerminate: unlockScroll,
    }),
  ).current;

  const handleResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        lockScroll();
        dragBaseDurRef.current = propsRef.current.durationMin;
        lastDurRef.current = null;
      },
      onPanResponderMove: (_evt, gs) => {
        const p = propsRef.current;
        const raw = dragBaseDurRef.current + (gs.dy / PANE_HEIGHT) * 1440;
        const mins = Math.max(p.minDuration, Math.min(p.maxDuration, snapMinutes(raw)));
        if (lastDurRef.current === mins) return;
        lastDurRef.current = mins;
        p.onChangeDuration(mins);
      },
      onPanResponderRelease: unlockScroll,
      onPanResponderTerminate: unlockScroll,
    }),
  ).current;

  // ── Geometry for the edited block (clamped to the pane like the strip) ──
  const col = kindColor(kind, C);
  const blockTop = yFor(startMinutes);
  const blockEnd = Math.min(PANE_HEIGHT, blockTop + (durationMin / 1440) * PANE_HEIGHT);
  const blockH = Math.max(3, blockEnd - blockTop);
  const runsPastMidnight = startMinutes + durationMin > 1440;
  const moveHandleTop = Math.max(0, Math.min(blockTop - HANDLE_H / 2, PANE_HEIGHT - HANDLE_H));
  const resizeHandleTop = Math.max(
    moveHandleTop + HANDLE_H + 4,
    Math.min(blockTop + blockH - HANDLE_H / 2, PANE_HEIGHT - HANDLE_H),
  );
  const handleTop = Math.min(resizeHandleTop, PANE_HEIGHT - HANDLE_H);

  return (
    <View>
      {/* Live readout — always legible even when the block is a sliver. */}
      <Text style={[styles.readout, { color: col }]}>
        {`${formatTime(startMinutes)} → ${formatTime(startMinutes + durationMin)}${runsPastMidnight ? ' (+1d)' : ''} · ${formatDuration(durationMin)}`}
      </Text>

      <Pressable
        onPress={(event) => sendStart(event.nativeEvent.locationY)}
        style={styles.pane}
        accessibilityLabel="Day column: tap to set the cue start time"
      >
        {/* One horizontal line per hour on the fixed 6 PM → 6 PM axis. */}
        {timelineHourOffsets().map((offset) => (
          <View
            key={`grid:${offset}`}
            pointerEvents="none"
            style={[
              styles.gridLine,
              {
                top: Math.min(PANE_HEIGHT - 1, (offset / 1440) * PANE_HEIGHT),
                backgroundColor: C.ghostBorder,
              },
            ]}
          />
        ))}
        {/* Keep the clean three-hour labels the operator liked, but anchor
            every label to the exact same Y coordinate as its hourly line. */}
        {timelineHourOffsets()
          .filter((offset) => offset % LABEL_STEP_MIN === 0)
          .map((offset) => {
          const minute = (TIMELINE_DAY_START_MIN + offset) % 1440;
          const h = Math.floor(minute / 60);
          const label = offset === 1440
            ? '6 PM +1'
            : h === 0
              ? '12 AM'
              : h < 12
                ? `${h} AM`
                : h === 12
                  ? '12 PM'
                  : `${h - 12} PM`;
          const lineY = Math.min(PANE_HEIGHT - 1, (offset / 1440) * PANE_HEIGHT);
          return (
            <Text
              key={`lbl:${offset}`}
              pointerEvents="none"
              style={[
                styles.gridLabel,
                {
                  top: Math.max(1, Math.min(PANE_HEIGHT - 14, lineY - 6)),
                  color: C.secondary,
                },
              ]}
            >
              {label}
            </Text>
          );
        })}

        {/* OTHER cues on this day — dim context. Point cues (no duration)
            render as hairline markers; windowed cues as dim blocks. */}
        {others.map((o, i) => {
          const oCol = kindColor(o.kind, C);
          if (!(o.durationMin > 0)) {
            return (
              <View
                key={`other:${i}`}
                pointerEvents="none"
                style={[styles.otherMarker, { top: yFor(o.startMinutes), backgroundColor: oCol }]}
              />
            );
          }
          const top = yFor(o.startMinutes);
          const h = Math.max(3, Math.min(PANE_HEIGHT - top, (o.durationMin / 1440) * PANE_HEIGHT));
          return (
            <View
              key={`other:${i}`}
              pointerEvents="none"
              style={[styles.otherBlock, { top, height: h, backgroundColor: oCol }]}
            />
          );
        })}

        {/* The cue being edited — solid kind-colored block. When the block is
            tall enough the end time renders anchored to the bottom edge so the
            operator sees the exact "start → end" range on the timeline. */}
        <View
          pointerEvents="none"
          style={[styles.block, { top: blockTop, height: blockH, backgroundColor: col }]}
        >
          {blockH >= 20 ? (
            <Text style={styles.blockTime} numberOfLines={1}>{minutesTo12h(startMinutes)}</Text>
          ) : null}
          {blockH >= 44 ? (
            <Text style={styles.blockEndTime} numberOfLines={1}>
              {`→ ${minutesTo12h((startMinutes + Math.floor(durationMin)) % 1440)}`}
            </Text>
          ) : null}
        </View>

        {/* Top MOVE notch — drag to reposition the complete cue window. */}
        <View pointerEvents="box-none" style={[styles.handleRow, { top: moveHandleTop }]}>
          <View
            {...moveResponder.panHandlers}
            hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
            accessibilityRole="adjustable"
            accessibilityLabel="Drag to move the cue window"
            style={[
              styles.handle,
              styles.moveHandle,
              { backgroundColor: C.surfaceContainerHigh, borderColor: col },
            ]}
          >
            <Text style={[styles.moveHandleText, { color: col }]}>↕ MOVE</Text>
          </View>
        </View>

        {/* Bottom-edge DURATION handle — the only interactive child; it wins
            the responder negotiation via capture. */}
        <View pointerEvents="box-none" style={[styles.handleRow, { top: handleTop }]}>
          <View
            {...handleResponder.panHandlers}
            hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
            accessibilityRole="adjustable"
            accessibilityLabel="Drag to adjust the cue duration"
            style={[styles.handle, { backgroundColor: C.surfaceContainerHigh, borderColor: col }]}
          >
            <View style={[styles.handleBar, { backgroundColor: col }]} />
            <View style={[styles.handleBar, { backgroundColor: col }]} />
          </View>
        </View>
      </Pressable>

      <Text style={[styles.hint, { color: C.secondary }]}>
        Drag or tap in 15-minute steps · use EXACT START above for finer adjustment.
      </Text>
    </View>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    readout: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.4,
      marginBottom: 6,
      fontVariant: ['tabular-nums'],
    },
    pane: {
      height: PANE_HEIGHT,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceDim,
      position: 'relative',
      overflow: 'hidden',
    },
    gridLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
      opacity: 0.5,
    },
    gridLabel: {
      position: 'absolute',
      left: 4,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.2,
    },
    otherBlock: {
      position: 'absolute',
      left: 44,
      right: 10,
      borderRadius: 4,
      opacity: 0.25,
    },
    otherMarker: {
      position: 'absolute',
      left: 44,
      right: 10,
      height: 2,
      opacity: 0.45,
    },
    block: {
      position: 'absolute',
      left: 44,
      right: 10,
      borderRadius: 4,
      opacity: 0.9,
      paddingHorizontal: 6,
      paddingTop: 2,
    },
    blockTime: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.3,
      color: '#0b0f12',
    },
    blockEndTime: {
      position: 'absolute',
      right: 6,
      bottom: 3,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.3,
      color: '#0b0f12',
    },
    handleRow: {
      position: 'absolute',
      left: 44,
      right: 10,
      height: HANDLE_H,
      alignItems: 'center',
      justifyContent: 'center',
    },
    handle: {
      width: 56,
      height: HANDLE_H,
      borderRadius: HANDLE_H / 2,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    moveHandle: {
      width: 76,
    },
    moveHandleText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.8,
    },
    handleBar: {
      width: 22,
      height: 2,
      borderRadius: 1,
    },
    hint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      marginTop: 6,
    },
  });
}
