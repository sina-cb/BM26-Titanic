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
 *   - TAP or DRAG anywhere on the column → sets the cue START at that time,
 *     snapped to 5-minute increments (two-way synced with the HH/MM steppers);
 *   - DRAG the pill handle on the block's bottom edge → adjusts DURATION in
 *     5-minute steps (two-way synced with the duration presets / stepper).
 *
 * Geometry reuses the DayOverviewStrip idiom — top = 00:00 → bottom = 24:00
 * via dayFraction from timelineTemplate — at a taller PANE_HEIGHT (480) so
 * 5-minute targeting is practical. Sunrise/sunset shading is deliberately
 * OMITTED: this sheet only receives the raw ShowPlan (no /timeline/overview
 * sun table), and CaptainPad has no client-side solar math to compute it.
 */
import React, { useMemo, useRef } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { CueKind } from '@/utils/timelineApi';
import { dayFraction, kindColor, minutesTo12h } from './timelineTemplate';

// Tall enough that one 5-min slot ≈ 1.7px — a tap lands within a slot or two
// and the snap does the rest; the steppers stay the precision fallback.
export const PANE_HEIGHT = 480;
const SNAP_MIN = 5;
const HANDLE_H = 18;

/** A resolvable context cue on the selected day (dim, non-interactive). */
export interface DayTimeContextCue {
  startMinutes: number;
  /** 0 = point cue (renders as a hairline marker, not a block). */
  durationMin: number;
  kind: CueKind;
  label?: string;
}

// Top-of-pane Y for a minutes-of-day value — the DayOverviewStrip mapping
// (dayFraction clamps to [0,1]) scaled to this pane's height. dayFraction is
// null only for a null input, which can't happen here (mins is a number).
function yFor(mins: number): number {
  return (dayFraction(mins) ?? 0) * PANE_HEIGHT;
}

function snap5(mins: number): number {
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
  /** Fires with a 5-min-snapped minutes-of-day when the column is tapped/dragged. */
  onChangeStart: (mins: number) => void;
  /** Fires with a 5-min-snapped duration when the bottom handle is dragged. */
  onChangeDuration: (mins: number) => void;
  minDuration?: number;
  maxDuration?: number;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  // PanResponders are created ONCE (useRef) so their closures must read live
  // values through refs, never through render-scope props (the fader idiom).
  const propsRef = useRef({ durationMin, onChangeStart, onChangeDuration, minDuration, maxDuration });
  propsRef.current = { durationMin, onChangeStart, onChangeDuration, minDuration, maxDuration };

  // ── Column responder: tap / drag sets START ──────────────────────────
  // Grant records the pane-relative touch Y (locationY is column-relative
  // because every decorative child is pointerEvents:none); moves offset it by
  // gestureState.dy. Each position snaps to 5 min and emits only on change.
  const grantYRef = useRef(0);
  const lastStartRef = useRef<number | null>(null);
  const sendStart = useRef((y: number) => {
    const mins = Math.max(0, Math.min(1440 - SNAP_MIN, snap5((y / PANE_HEIGHT) * 1440)));
    if (lastStartRef.current === mins) return;
    lastStartRef.current = mins;
    propsRef.current.onChangeStart(mins);
  }).current;
  const columnResponder = useRef(
    PanResponder.create({
      // No capture on start: the duration handle (a descendant with capture)
      // must win the negotiation for touches that begin on it.
      onStartShouldSetPanResponderCapture: () => false,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        grantYRef.current = evt.nativeEvent.locationY;
        lastStartRef.current = null;
        sendStart(evt.nativeEvent.locationY);
      },
      onPanResponderMove: (_evt, gs) => sendStart(grantYRef.current + gs.dy),
    }),
  ).current;

  // ── Handle responder: drag the block's bottom edge sets DURATION ─────
  // Grant snapshots the duration; moves convert dy → minutes, snap to 5 and
  // clamp to [minDuration, maxDuration], emitting only on change.
  const dragBaseDurRef = useRef(0);
  const lastDurRef = useRef<number | null>(null);
  const handleResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        dragBaseDurRef.current = propsRef.current.durationMin;
        lastDurRef.current = null;
      },
      onPanResponderMove: (_evt, gs) => {
        const p = propsRef.current;
        const raw = dragBaseDurRef.current + (gs.dy / PANE_HEIGHT) * 1440;
        const mins = Math.max(p.minDuration, Math.min(p.maxDuration, snap5(raw)));
        if (lastDurRef.current === mins) return;
        lastDurRef.current = mins;
        p.onChangeDuration(mins);
      },
    }),
  ).current;

  // ── Geometry for the edited block (clamped to the pane like the strip) ──
  const col = kindColor(kind, C);
  const blockTop = yFor(startMinutes);
  const blockEnd = yFor(Math.min(1440, startMinutes + durationMin));
  const blockH = Math.max(3, blockEnd - blockTop);
  const runsPastMidnight = startMinutes + durationMin > 1440;
  const handleTop = Math.min(blockTop + blockH - HANDLE_H / 2, PANE_HEIGHT - HANDLE_H);

  return (
    <View>
      {/* Live readout — always legible even when the block is a sliver. */}
      <Text style={[styles.readout, { color: col }]}>
        {`${minutesTo12h(startMinutes)} → ${minutesTo12h(startMinutes + durationMin)}${runsPastMidnight ? ' (+1d)' : ''} · ${durationMin} min`}
      </Text>

      <View
        {...columnResponder.panHandlers}
        style={styles.pane}
        accessibilityLabel="Day column: tap to set the cue start time"
      >
        {/* Hour grid — hairline every 2h, 12h labels at 12AM/6AM/12PM/6PM. */}
        {[2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
          <View
            key={`grid:${h}`}
            pointerEvents="none"
            style={[styles.gridLine, { top: yFor(h * 60), backgroundColor: C.ghostBorder }]}
          />
        ))}
        {[0, 6, 12, 18].map((h) => (
          <Text
            key={`lbl:${h}`}
            pointerEvents="none"
            style={[styles.gridLabel, { top: yFor(h * 60) + 2, color: C.secondary }]}
          >
            {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
          </Text>
        ))}

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
          const h = Math.max(3, yFor(Math.min(1440, o.startMinutes + o.durationMin)) - top);
          return (
            <View
              key={`other:${i}`}
              pointerEvents="none"
              style={[styles.otherBlock, { top, height: h, backgroundColor: oCol }]}
            />
          );
        })}

        {/* The cue being edited — solid kind-colored block. */}
        <View
          pointerEvents="none"
          style={[styles.block, { top: blockTop, height: blockH, backgroundColor: col }]}
        >
          {blockH >= 20 ? (
            <Text style={styles.blockTime} numberOfLines={1}>{minutesTo12h(startMinutes)}</Text>
          ) : null}
        </View>

        {/* Bottom-edge DURATION handle — the only interactive child; it wins
            the responder negotiation via capture. */}
        <View pointerEvents="box-none" style={[styles.handleRow, { top: handleTop }]}>
          <View
            {...handleResponder.panHandlers}
            hitSlop={{ top: 10, bottom: 10, left: 14, right: 14 }}
            accessibilityLabel="Drag to adjust the cue duration"
            style={[styles.handle, { backgroundColor: C.surfaceContainerHigh, borderColor: col }]}
          >
            <View style={[styles.handleBar, { backgroundColor: col }]} />
            <View style={[styles.handleBar, { backgroundColor: col }]} />
          </View>
        </View>
      </View>

      <Text style={[styles.hint, { color: C.secondary }]}>
        Tap the column to set start (snaps to 5 min) · drag the pill to set duration.
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
