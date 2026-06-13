/**
 * TimerWheel — vertical, snap-to-row preset picker styled after the
 * iPhone alarm/clock time spinner. Compact single-row variant.
 *
 * Operator brief (2026-05-27, round 3): round 2 shipped a 3-row tall
 * wheel (96 px) — operator's words "no, I don't want it tall, just
 * show a tiny indication that it can be scrolled, and only show 1
 * item to not waste vertical space in the mixer tab please". This
 * round shrinks the visible area to a SINGLE row (the selected value)
 * and adds two thin tick marks at the top/bottom edges as the "this
 * is scrollable" affordance. Scroll/snap/onChange behavior is
 * unchanged — only the visible window shrinks.
 *
 * API mirrors `TimerPillBar` so swap sites can flip widget without
 * touching the surrounding callback contracts:
 *
 *   <TimerWheel
 *     presets={TRANSITION_DURATION_PRESETS_MS}
 *     value={transTimeMs}
 *     onChange={(ms) => …}
 *     formatter={(ms) => `${ms}ms`}
 *     label="DURATION"   // optional
 *   />
 *
 * Sizing target: 32 px tall (one row) to match the mode dropdown's
 * height in the mixer `transitionBar` row — the wheel now reads as a
 * peer to the other controls in that bar instead of a giant block.
 * Off-screen rows still exist in the FlatList; only the visible
 * window is clipped to one row by `overflow: 'hidden'`.
 *
 * Snap math: we use a vertical FlatList with
 *   - contentContainerStyle paddingVertical = 0  (with a 1-row window,
 *     the first/last preset already sits at the only visible slot
 *     when scrollY = 0 / (N-1)*ROW_HEIGHT — no extra padding needed)
 *   - snapToInterval = ROW_HEIGHT (snap-to-item, NOT snap-to-page)
 *   - decelerationRate = 'fast'
 *   - getItemLayout for predictable initial scrollToIndex
 *   - onMomentumScrollEnd to compute the centered index and dispatch.
 *
 * "Value not in preset list" handling: the wheel snaps the *visible
 * highlight* to the nearest preset (so the UI shows something sensible)
 * but does NOT silently call `onChange` with a substituted value —
 * that would violate the codex P0 "no fallback behaviors" rule by
 * mutating engine state without the user touching anything. The
 * upstream `ChannelStrip` already throws loudly if `transitionTime`
 * is missing or non-finite; this component handles the milder case
 * where the engine reports a legitimate-but-off-preset value
 * (e.g. 750 ms because someone PATCHed via REST). The user sees the
 * nearest preset highlighted; the engine value stays untouched until
 * the user actively flicks/taps a preset.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Palette } from '@/constants/theme';
import {
  Animated,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePalette } from '@/hooks/use-theme';

// 32 px row, 1 visible row → 32 px total. Matches the mode-dropdown
// height in the mixer `transitionBar` so the wheel sits flush with
// its row-mates. Changing this requires re-checking the strip's
// transitionBar layout AND the tick-mark inset math below.
const ROW_HEIGHT = 32;
const VISIBLE_ROWS = 1;
const WHEEL_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS;
// Tiny tick marks at the top/bottom edge are the "scrollable" hint.
// 6 px wide × 1.5 px tall, low opacity, centered horizontally. Chose
// ticks over chevrons to avoid pulling in an SF Symbol mapping for
// `chevron.up/down` — a pair of thin Views is cheaper and renders
// identically on iOS/Android/web.
const TICK_WIDTH = 8;
const TICK_HEIGHT = 1.5;

export function TimerWheel({
  presets,
  value,
  onChange,
  formatter,
  label,
}: {
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  formatter: (v: number) => string;
  label?: string;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  // Caller-provided preset list is assumed non-empty and sorted; the
  // codex P0 stance is "fail loud" rather than substitute a placeholder
  // list. If a caller hands us an empty list, throw so the bug surfaces
  // at the call site instead of silently rendering an empty wheel.
  if (!presets || presets.length === 0) {
    throw new Error('TimerWheel: presets must be a non-empty array');
  }

  // Snap the highlighted row to the nearest preset for the *visual*
  // initial state. We do NOT call onChange here — see header comment
  // re: "value not in preset list".
  const nearestIndex = useMemo(() => {
    let best = 0;
    let bestDelta = Math.abs(presets[0] - value);
    for (let i = 1; i < presets.length; i++) {
      const d = Math.abs(presets[i] - value);
      if (d < bestDelta) {
        best = i;
        bestDelta = d;
      }
    }
    return best;
  }, [presets, value]);

  const listRef = useRef<FlatList<number>>(null);
  const scrollY = useRef(new Animated.Value(nearestIndex * ROW_HEIGHT)).current;
  // Local "selected index for highlight band" mirrors what scroll snaps
  // to; kept in state so the center band's preset readout (and a11y
  // label) stays in sync with the wheel position even before the
  // parent re-renders us with a new `value`.
  const [selectedIndex, setSelectedIndex] = useState(nearestIndex);

  // When the parent pushes a new `value` (engine broadcast, etc.) that
  // maps to a different preset than what we're currently centered on,
  // animate the wheel to that preset.
  useEffect(() => {
    if (nearestIndex !== selectedIndex) {
      setSelectedIndex(nearestIndex);
      listRef.current?.scrollToOffset({
        offset: nearestIndex * ROW_HEIGHT,
        animated: true,
      });
    }
    // selectedIndex is intentionally NOT in deps — we only want to
    // react to upstream value changes, not to our own snap updates
    // (which set selectedIndex first and then scroll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearestIndex]);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const idx = Math.max(0, Math.min(presets.length - 1, Math.round(y / ROW_HEIGHT)));
      if (idx === selectedIndex && presets[idx] === value) return;
      setSelectedIndex(idx);
      onChange(presets[idx]);
    },
    [presets, value, selectedIndex, onChange],
  );

  const handleRowPress = useCallback(
    (idx: number) => {
      listRef.current?.scrollToOffset({
        offset: idx * ROW_HEIGHT,
        animated: true,
      });
      if (idx !== selectedIndex || presets[idx] !== value) {
        setSelectedIndex(idx);
        onChange(presets[idx]);
      }
    },
    [presets, value, selectedIndex, onChange],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<number> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
      }),
    [scrollY],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: number; index: number }) => {
      // Opacity gradient relative to the centered slot. With the
      // round-3 single-row window, off-screen rows are clipped by the
      // wheelWrap's `overflow: 'hidden'`; the interpolation matters
      // mid-flick when a row is sliding through the viewport, giving
      // it a soft fade-in / fade-out as it passes. Native-driven, so
      // it stays smooth without a reanimated worklet.
      const inputRange = [
        (index - 2) * ROW_HEIGHT,
        (index - 1) * ROW_HEIGHT,
        index * ROW_HEIGHT,
        (index + 1) * ROW_HEIGHT,
        (index + 2) * ROW_HEIGHT,
      ];
      const opacity = scrollY.interpolate({
        inputRange,
        outputRange: [0.18, 0.45, 1, 0.45, 0.18],
        extrapolate: 'clamp',
      });
      const scale = scrollY.interpolate({
        inputRange,
        outputRange: [0.85, 0.92, 1, 0.92, 0.85],
        extrapolate: 'clamp',
      });
      const isCenter = index === selectedIndex;
      return (
        <Pressable
          onPress={() => handleRowPress(index)}
          accessibilityRole="button"
          accessibilityLabel={`Set to ${formatter(item)}`}
          accessibilityState={{ selected: isCenter }}
          style={styles.row}
        >
          <Animated.Text
            style={[
              styles.rowText,
              { opacity, transform: [{ scale }] },
              isCenter && styles.rowTextCenter,
            ]}
          >
            {formatter(item)}
          </Animated.Text>
        </Pressable>
      );
    },
    [scrollY, selectedIndex, formatter, handleRowPress],
  );

  return (
    <View style={{ width: '100%' }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.wheelWrap}>
        <Animated.FlatList
          ref={listRef as React.Ref<Animated.FlatList<number>>}
          data={presets}
          keyExtractor={(item) => String(item)}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          showsVerticalScrollIndicator={false}
          snapToInterval={ROW_HEIGHT}
          decelerationRate="fast"
          onMomentumScrollEnd={handleMomentumEnd}
          onScroll={onScroll}
          scrollEventThrottle={16}
          initialScrollIndex={nearestIndex}
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />
        {/* Tiny scroll-affordance ticks — two thin marks at top and
            bottom edges, low opacity. Operator brief round 3: "show a
            tiny indication that it can be scrolled". pointerEvents
            none so they never steal the flick. */}
        <View style={[styles.tick, styles.tickTop]} />
        <View style={[styles.tick, styles.tickBottom]} />
      </View>
    </View>
  );
}


function makeStyles(C: Palette) {
  return StyleSheet.create({
  label: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 9,
    letterSpacing: 1.2,
    color: C.icon,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  wheelWrap: {
    height: WHEEL_HEIGHT,
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    backgroundColor: C.surfaceContainerLowest,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    // No padding: with VISIBLE_ROWS = 1, the only visible slot IS the
    // top of the viewport. The first preset shows at scrollY = 0; the
    // last preset shows at scrollY = (N-1) * ROW_HEIGHT. Adding
    // padding here would break the snap math.
    paddingVertical: 0,
  },
  row: {
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 13,
    letterSpacing: 0.5,
    color: C.text,
  },
  rowTextCenter: {
    // The single visible row IS the selected value — paint it in the
    // accent color so it reads as "this is the active preset" without
    // needing a separate highlight band behind it.
    color: C.primary,
  },
  tick: {
    pointerEvents: 'none',
    position: 'absolute',
    width: TICK_WIDTH,
    height: TICK_HEIGHT,
    left: '50%',
    marginLeft: -TICK_WIDTH / 2,
    backgroundColor: C.icon,
    opacity: 0.35,
    borderRadius: TICK_HEIGHT / 2,
  },
  tickTop: { top: 3 },
  tickBottom: { bottom: 3 },
});
}
