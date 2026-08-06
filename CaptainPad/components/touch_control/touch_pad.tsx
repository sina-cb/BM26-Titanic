// touch_pad — a reusable 2-axis touch surface for the TOUCH CONTROL tab.
//
// The gesture handling here is a deliberate copy of the PROVEN idiom in
// components/ui/HorizontalFader.tsx (measure on layout → grant from
// locationX/Y → move from start + gestureState delta), including its two
// hard-won details:
//
//   1. CAPTURE handlers, so a drag that starts on the pad is never stolen by
//      an ancestor ScrollView (the bug that made mixer faders scroll the row
//      instead of moving).
//   2. onPanResponderTerminate mirrors Release, because a cancelled gesture
//      (browser pointercancel, focus loss) never fires Release and would
//      otherwise leave the drag guard stuck on forever.
//
// Values are UNIT [0,1] in OPERATOR space: y = 1 is the TOP of the pad. The
// screen-down → operator-up flip happens once, here, via flipY().
//
// Codex P0 — no fallback behaviors: if the pad has not been measured yet,
// positionToUnit returns null and we SKIP the frame rather than writing a
// fabricated 0 to the rig.

import React, { useRef, useState } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { clamp01, positionToUnit, flipY } from './touch_control_logic';

export interface TouchPadProps {
  /** Horizontal unit value [0,1]. */
  x: number;
  /** Vertical unit value [0,1], OPERATOR-UP (1 = top of the pad). */
  y: number;
  onChange: (x: number, y: number) => void;
  onDragStart?: () => void;
  /** Fired once on release/terminate with the final value — the caller MUST
   *  send this ungated so the rig never keeps a dropped intermediate value. */
  onRelease?: (x: number, y: number) => void;
  disabled?: boolean;
  /** Painted behind the crosshair (gradient cells, grid, etc.). */
  background?: React.ReactNode;
  /** Crosshair color. Defaults to the palette's text color. */
  thumbColor?: string;
  /** Extra style for the pad root (height, margins…). */
  style?: object;
  /** Accessibility label for the whole surface. */
  label: string;
  /**
   * Every value living on this pad, drawn at once so the operator sees the
   * WHOLE palette rather than just the one being edited. The `active` marker
   * additionally gets the crosshair.
   */
  markers?: PadMarker[];
  /**
   * Touching within PICK_RADIUS of a non-active marker SELECTS it instead of
   * dragging the current one — that is what makes all-dots-at-once useful
   * rather than merely decorative. The write is skipped for that grant frame
   * so a pick never yanks the newly-selected colour to the finger.
   */
  onPickMarker?: (key: string) => void;
}

export interface PadMarker {
  key: string;
  /** Unit position, y in OPERATOR-UP space (1 = top), same as x/y above. */
  x: number;
  y: number;
  /** Fill colour for the dot. */
  color: string;
  /** Short caption drawn inside the dot (e.g. the slot number). */
  label?: string;
  active: boolean;
}

/** How close a touch must land to grab an existing marker (px). */
const PICK_RADIUS = 34;

/** Crosshair thumb size — comfortably above the 44pt touch floor when the
 *  operator grabs it, and large enough to see in the dark and the dust. */
const THUMB = 44;

export function TouchPad({
  x,
  y,
  onChange,
  onDragStart,
  onRelease,
  disabled = false,
  background,
  thumbColor,
  style,
  label,
  markers,
  onPickMarker,
}: TouchPadProps) {
  const C = usePalette();
  const sizeRef = useRef({ w: 0, h: 0 });
  const [measured, setMeasured] = useState({ w: 0, h: 0 });

  // Start-of-drag values, in operator space.
  const startRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  // Latest callbacks behind refs: the PanResponder is built ONCE, so without
  // this it would capture first-render closures forever (the stale-closure
  // data-loss bug documented in HorizontalFader).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onPickMarkerRef = useRef(onPickMarker);
  onPickMarkerRef.current = onPickMarker;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onStartShouldSetPanResponderCapture: () => !disabledRef.current,
      onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => {
        if (disabledRef.current) return;
        const { w, h } = sizeRef.current;
        const ux = positionToUnit(evt.nativeEvent.locationX, w);
        const uy = positionToUnit(evt.nativeEvent.locationY, h);
        // Not measured yet — do not invent a value for a live rig.
        if (ux === null || uy === null) return;
        draggingRef.current = true;
        const next = { x: ux, y: flipY(uy) };
        startRef.current = next;
        if (onDragStartRef.current) onDragStartRef.current();

        // Did the finger land on another marker? If so this touch is a PICK,
        // not a move: select that colour and write nothing this frame, so
        // grabbing a dot never drags it to wherever the finger happened to be.
        const list = markersRef.current;
        const pick = onPickMarkerRef.current;
        if (list && pick) {
          let best: { key: string; d: number } | null = null;
          for (const m of list) {
            if (m.active) continue;
            const dx = (m.x - next.x) * w;
            const dy = (flipY(m.y) - uy) * h;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= PICK_RADIUS && (!best || d < best.d)) best = { key: m.key, d };
          }
          if (best) {
            // Anchor the drag at the PICKED marker so the very next move is
            // relative to it, not to the touch point.
            const picked = list.find((m) => m.key === best!.key)!;
            startRef.current = { x: picked.x, y: picked.y };
            pick(best.key);
            return;
          }
        }

        onChangeRef.current(next.x, next.y);
      },

      onPanResponderMove: (_evt, gs) => {
        if (!draggingRef.current) return;
        const { w, h } = sizeRef.current;
        if (w <= 0 || h <= 0) return;
        const nx = clamp01(startRef.current.x + gs.dx / w);
        // Screen-down drag (positive dy) must DECREASE the operator-up value.
        const ny = clamp01(startRef.current.y - gs.dy / h);
        onChangeRef.current(nx, ny);
      },

      onPanResponderRelease: (_evt, gs) => {
        if (!draggingRef.current) return;
        const { w, h } = sizeRef.current;
        draggingRef.current = false;
        if (w <= 0 || h <= 0) return;
        const nx = clamp01(startRef.current.x + gs.dx / w);
        const ny = clamp01(startRef.current.y - gs.dy / h);
        onChangeRef.current(nx, ny);
        if (onReleaseRef.current) onReleaseRef.current(nx, ny);
      },

      // A cancelled gesture never fires Release — mirror it exactly.
      onPanResponderTerminate: (_evt, gs) => {
        if (!draggingRef.current) return;
        const { w, h } = sizeRef.current;
        draggingRef.current = false;
        if (w <= 0 || h <= 0) return;
        const nx = clamp01(startRef.current.x + gs.dx / w);
        const ny = clamp01(startRef.current.y - gs.dy / h);
        onChangeRef.current(nx, ny);
        if (onReleaseRef.current) onReleaseRef.current(nx, ny);
      },
    }),
  ).current;

  const thumbLeft = measured.w > 0 ? clamp01(x) * measured.w - THUMB / 2 : -THUMB;
  const thumbTop = measured.h > 0 ? flipY(clamp01(y)) * measured.h - THUMB / 2 : -THUMB;
  const crosshair = thumbColor || C.text;

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      style={[
        {
          borderRadius: 16,
          borderWidth: 1,
          borderColor: C.ghostBorder,
          backgroundColor: C.surfaceContainerLow,
          overflow: 'hidden',
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        sizeRef.current = { w: Math.max(0, width), h: Math.max(0, height) };
        // Re-render only when the measurement actually changes, so a layout
        // pass during a drag can't spam renders.
        setMeasured((prev) =>
          prev.w === sizeRef.current.w && prev.h === sizeRef.current.h ? prev : { ...sizeRef.current },
        );
      }}
      {...panResponder.panHandlers}
    >
      {background}

      {/* Every palette entry, drawn at once. The operator can see the whole
          set and tap any dot to grab it (see the pick logic in the grant
          handler). The ACTIVE one also gets the crosshair below. */}
      {measured.w > 0 && measured.h > 0 && markers && markers.length > 0 && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {markers.map((m) => {
            const left = clamp01(m.x) * measured.w;
            const top = flipY(clamp01(m.y)) * measured.h;
            const size = m.active ? 30 : 24;
            return (
              <View
                key={m.key}
                style={{
                  position: 'absolute',
                  left: left - size / 2,
                  top: top - size / 2,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: m.color,
                  borderWidth: m.active ? 3 : 2,
                  // A white ring keeps a dark dot visible on a dark wash and a
                  // light dot visible on white; the active one goes black for
                  // contrast against its own crosshair.
                  borderColor: m.active ? '#000' : '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {m.label ? (
                  <Text
                    style={{
                      fontFamily: 'SpaceGrotesk_700Bold',
                      fontSize: 11,
                      color: '#000',
                    }}
                  >
                    {m.label}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Crosshair — drawn only once the pad has a real measurement, so it
          never flashes at a fabricated origin on first paint. */}
      {measured.w > 0 && measured.h > 0 && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill]}>
          {/* Full-width / full-height guide lines make the position readable
              at a glance in the dark. */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: thumbTop + THUMB / 2,
              height: 1,
              backgroundColor: crosshair,
              opacity: 0.35,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: thumbLeft + THUMB / 2,
              width: 1,
              backgroundColor: crosshair,
              opacity: 0.35,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: thumbLeft,
              top: thumbTop,
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              borderWidth: 3,
              borderColor: crosshair,
              backgroundColor: 'transparent',
            }}
          />
        </View>
      )}
    </View>
  );
}
