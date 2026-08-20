// param_row — THE parameter control. One component, every surface.
//
// A parameter row is exactly two lines:
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ [KNOB 7] BEAM WIDTH  [◎]  [♪ FLUX]  [⊞ MIDI]  …      0.38   │  header
//   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  slider
//   └─────────────────────────────────────────────────────────────┘
//
// Before this existed, the deck put the KNOB badge on a line of ITS OWN, the
// name/badges shared a second line and wrapped unpredictably (the name Text had
// no `numberOfLines`), the author's note took a third, and the slider a fourth.
// The mixer had the same information in a DIFFERENT order with the name buried
// inside the fader instead. Two surfaces, two layouts, one concept.
//
// The layout contract — slot order, responsive metrics, the "the name yields,
// the chips never do" rule — lives in the pure `components/param_row_layout.ts`
// so it is unit-tested in the node vitest env (RN `.tsx` cannot load there).
// This file paints that contract and nothing else.
//
// WHAT THIS DOES NOT TOUCH: runtime parameter names, knob order, slider
// behaviour, the audioSuggestion metadata contract, modulation semantics, MIDI
// behaviour.

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { paramRowMetrics } from '@/components/param_row_layout';
import { AudioSuggestionChip, KnobChip, ParamRowMetricsContext, useParamRowMetrics } from '@/components/ui/param_chips';
import type { AudioSuggestion } from '@/utils/api';

export interface ParamRowHeaderProps {
  /** Physical MFT knob number driving this row; null / undefined renders no
   *  chip (an excluded or overflow row consumes no encoder). */
  knobNumber?: number | null;
  /** The display name, already run through `paramDisplayName`. */
  name: string;
  /** The untruncated name for assistive tech, when `name` may be clipped. */
  accessibleName?: string;
  /** The surface's existing small status/control indicator(s) — the ◎
   *  modulation pill, MATCHED · <CPC>, the "—" not-knob-mapped marker. Passed
   *  as a node because each surface owns its own semantics; they all paint with
   *  the shared ParamChip, so they share the row's box. */
  status?: React.ReactNode;
  /** The pattern author's recommended audio binding, when the parameter
   *  declares one. Absent means ABSENT — no placeholder is rendered. */
  suggestion?: AudioSuggestion | null;
  /** Tap handler for the ♪ chip. Omitted ⇒ the chip is visible but inert
   *  (a mapping already exists, or there is no entry to write to). */
  onSuggestionPress?: () => void;
  /** The ⊞ MIDI chip, when the surface shows one. */
  midi?: React.ReactNode;
  /** Right-aligned readout(s) — the value, and any live modulation figure. */
  trailing?: React.ReactNode;
}

/**
 * The header line. Never wraps: `flexWrap: 'nowrap'` plus a single-line name
 * with `flexShrink: 1` means a long name ELLIPSIZES and every chip keeps its
 * full width. On a genuinely narrow row (< 200 px measured — the deck's
 * PARAMETERS column at a 900 px window) the compact variant engages: shorter
 * chip labels, tighter spacing, no note.
 */
export function ParamRowHeader({
  knobNumber, name, accessibleName, status, suggestion, onSuggestionPress, midi, trailing,
}: ParamRowHeaderProps) {
  const C = usePalette();
  const m = useParamRowMetrics();
  const note = m.showNote ? suggestion?.note : null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: m.gap,
        minHeight: m.rowMinHeight,
        marginBottom: 3,
        // A row that somehow over-fills clips at its own edge rather than
        // spilling over the neighbouring column.
        overflow: 'hidden',
      }}
    >
      {knobNumber !== null && knobNumber !== undefined ? <KnobChip knobNumber={knobNumber} /> : null}
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        // The visible text may be clipped by the layout; the label never is.
        accessibilityLabel={accessibleName ?? name}
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: m.nameFont,
          lineHeight: m.nameFont + 4,
          color: C.secondary,
          textTransform: 'uppercase',
          // THE flexible slot. Everything else in the row is flexShrink: 0.
          flexShrink: 1,
          minWidth: m.nameMinWidth,
        }}
      >
        {name}
      </Text>
      {status}
      {suggestion ? <AudioSuggestionChip suggestion={suggestion} onPress={onSuggestionPress} /> : null}
      {midi}
      {note ? (
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: m.nameFont - 1,
            color: C.secondary,
            opacity: 0.75,
            // Shrinks BEFORE the name does — the note is the first thing to
            // give up room, the parameter's identity is the last.
            flexShrink: 8,
            minWidth: 0,
          }}
        >
          {note}
        </Text>
      ) : null}
      {/* Pushes the readout right; collapses to zero when the row is full. */}
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }} />
      {trailing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.gap, flexShrink: 0 }}>
          {trailing}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The row's right-aligned numeric readout ('0.38', '65', '220°').
 *
 * A component rather than a style object so it can size itself from the row's
 * metrics — it has to shrink with everything else on a compact row. Used by
 * every surface's `trailing` slot that shows a plain value.
 */
export function ParamValueText({ children, color }: { children: React.ReactNode; color?: string }) {
  const C = usePalette();
  const m = useParamRowMetrics();
  return (
    <Text
      numberOfLines={1}
      style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: m.nameFont + 1,
        color: color ?? C.text,
        flexShrink: 0,
      }}
    >
      {children}
    </Text>
  );
}

export interface ParamRowProps extends ParamRowHeaderProps {
  /** The slider, plus any overlays (range envelope, live ghost marker). They
   *  are rendered inside a `position: relative` box that is exactly the
   *  slider's own size, so an overlay positions against the TRACK — no
   *  hand-tuned `top: 14` offsets that break when the header height changes. */
  children: React.ReactNode;
  /** Excluded / CPC-owned rows render at reduced opacity. */
  dimmed?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Header + full-width slider, measuring itself so the row (and every chip
 * inside it, including ones handed in as opaque nodes) responds to the space it
 * actually has rather than to the window size — the deck's PARAMETERS column
 * and a mixer strip are very different widths inside the same window.
 */
export function ParamRow({ children, dimmed, style, ...header }: ParamRowProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    // Guard the setState: onLayout fires on every re-render in RN web, and an
    // unconditional set would spin this row forever.
    setWidth((prev) => (prev === w ? prev : w));
  }, []);
  const metrics = useMemo(() => paramRowMetrics(width), [width]);
  return (
    <ParamRowMetricsContext.Provider value={metrics}>
      <View style={[{ opacity: dimmed ? 0.5 : 1 }, style]} onLayout={onLayout}>
        <ParamRowHeader {...header} />
        <View style={{ position: 'relative' }}>{children}</View>
      </View>
    </ParamRowMetricsContext.Provider>
  );
}
