// param_chips — THE chip primitive every parameter-row header paints with, and
// the row-metrics context that makes the whole row respond to its own measured
// width.
//
// Before _190 each chip in a slider header was hand-styled at its call site:
// the KNOB pill at fontSize 8 with 1 px vertical padding, the ⊞ MIDI pill at
// fontSize 9 with radius 6, the ◎ ON pill at fontSize 9 with radius 6, the ♪
// suggestion badge at fontSize 8 with radius 4. Four chips, four boxes, four
// baselines, sitting next to each other in one row. This file gives them one
// box so the header reads as a set.
//
// The VISUAL HIERARCHY is deliberate and is the operator-facing point of the
// redesign (see param_row_layout.ts → "chip tone"):
//   ♪ SIGNAL  loud   — filled with the band's identity colour
//   ◎ ON / !  live   — filled green, the engine is driving this parameter
//   KNOB N, ⊞ quiet  — outlined, low-alpha wash: reference, not status
//
// Colour is never the only carrier: every chip states its meaning in text, and
// every abbreviated chip carries a spelled-out accessibilityLabel.

import React, { createContext, useContext } from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  knobChipAccessibilityLabel, knobChipLabel, paramChipColors, paramRowMetrics,
  suggestionChipAccessibilityLabel,
  type ParamChipTone, type ParamRowMetrics,
} from '@/components/param_row_layout';
import { usePalette } from '@/hooks/use-theme';
import { audioAccentHexForKey, shortSignalLabel } from '@/utils/audioSignals';
import type { AudioSuggestion } from '@/utils/api';

/** The app-wide MIDI accent family — the physical-control violet shared by the
 *  KNOB chip, the ⊞ MIDI chip and MidiMap's own MIDI_VIOLET. */
export const PARAM_CHIP_MIDI_ACCENT = '#7c5cff';

// ── row metrics context ─────────────────────────────────────────────
//
// ParamRow measures itself (onLayout) and publishes the resulting metrics here,
// so a chip nested anywhere inside the row — including ones the row receives as
// an opaque ReactNode slot, like MidiMapBadge — picks up the compact variant
// without any prop drilling. Outside a ParamRow the default is the regular
// variant, which is what the standalone pills (CPCControls' SPEED fader, the
// deck hue row) want.

const DEFAULT_METRICS = paramRowMetrics(0);

export const ParamRowMetricsContext = createContext<ParamRowMetrics>(DEFAULT_METRICS);

export function useParamRowMetrics(): ParamRowMetrics {
  return useContext(ParamRowMetricsContext);
}

// ── the chip ────────────────────────────────────────────────────────

export interface ParamChipProps {
  /** Visible text. Keep it short — the row is the densest surface in the app. */
  label: string;
  /** Identity colour the tone is derived from (ignored by the `ghost` tone). */
  accent: string;
  tone: ParamChipTone;
  /** Palette colours for the `ghost` tone (MATCHED, the "—" marker). */
  neutral?: { surface: string; border: string; text: string };
  onPress?: () => void;
  /** Rendered non-interactive (read-only surface, or performance-mode lock). */
  disabled?: boolean;
  /** REQUIRED whenever `label` is abbreviated or symbolic — a screen reader
   *  must never be left with "K7" or a bare "⊞". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

// A tapped chip is a small target inside a dense stack; hitSlop lifts the
// INTERACTIVE area to ~44 pt without changing the visual footprint (the same
// trick the mixer's icon buttons use).
const CHIP_HIT_SLOP = { top: 14, bottom: 14, left: 8, right: 8 } as const;

export function ParamChip({
  label, accent, tone, neutral, onPress, disabled, accessibilityLabel, accessibilityHint, style,
}: ParamChipProps) {
  const m = useParamRowMetrics();
  const colors = paramChipColors(tone, accent, neutral);
  const loud = tone === 'loud';
  const body = (
    <View
      style={[{
        minHeight: m.chipHeight,
        paddingHorizontal: m.chipPadH,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        // The chips NEVER shrink — the parameter name is the flexible slot.
        flexShrink: 0,
        // Stable colour: no fade animation while React rerenders (a live deck
        // shouldn't shimmer).
        transitionDuration: '0s',
      } as any, style]}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: loud ? m.chipFont + 1 : m.chipFont,
          lineHeight: (loud ? m.chipFont + 1 : m.chipFont) + 3,
          color: colors.text,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
  if (!onPress || disabled) {
    // Still expose the label to assistive tech on a read-only chip.
    return (
      <View accessibilityLabel={accessibilityLabel} style={{ flexShrink: 0 }}>
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={CHIP_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={{ flexShrink: 0 }}
    >
      {body}
    </TouchableOpacity>
  );
}

// ── KNOB N ──────────────────────────────────────────────────────────

/**
 * THE "KNOB N" chip naming the physical MFT encoder that drives an on-screen
 * control. One component so it reads identically on the deck's local-param
 * rows, the mixer strip's rows, the GLOBALS SPEED fader and the hue rows.
 *
 * The knob NUMBERS come from the callers' single sources of truth
 * (`knob_badge.ts` for local params, `knob_page.ts` for the row-0 globals) —
 * this only paints.
 */
export function KnobChip({ knobNumber, style }: {
  /** 1-based PHYSICAL knob number the operator counts ("KNOB 7"). */
  knobNumber: number;
  style?: StyleProp<ViewStyle>;
}) {
  const m = useParamRowMetrics();
  return (
    <ParamChip
      label={knobChipLabel(knobNumber, m)}
      accent={PARAM_CHIP_MIDI_ACCENT}
      tone="quiet"
      accessibilityLabel={knobChipAccessibilityLabel(knobNumber)}
      style={style}
    />
  );
}

// ── neutral status chips ────────────────────────────────────────────
//
// Both were duplicated per surface before _190 (GlobalParams painted its own
// pair; the mixer drew a bare "—" Text and pushed MATCHED into the MiniFader's
// `badge` slot, where it rendered right-aligned in the fader's accent colour
// rather than beside the name). One pair now, in the row's shared box.

/** A kind-1 export with no numeric v0 anchor: it drives nothing and consumes no
 *  physical encoder. */
export function NotKnobMappedChip() {
  const neutral = useNeutralChipColors();
  return (
    <ParamChip
      label="—"
      accent={neutral.text}
      tone="ghost"
      neutral={neutral}
      accessibilityLabel="Not mapped to a physical knob"
    />
  );
}

/** A local export a GLOBAL control owns (e.g. `sliderSize` matches CPC `size`).
 *  Surfaced rather than hidden so operators can see what a pattern declares —
 *  the May 2026 review found hiding it silently confusing. */
export function MatchedChip({ cpcLabel }: { cpcLabel?: string }) {
  const neutral = useNeutralChipColors();
  const m = useParamRowMetrics();
  const label = cpcLabel ? String(cpcLabel).toUpperCase() : null;
  return (
    <ParamChip
      // The compact variant drops the word and keeps the CPC name — which one
      // owns it is the actionable half.
      label={m.compact ? (label ?? 'MATCH') : `MATCHED${label ? ` · ${label}` : ''}`}
      accent={neutral.text}
      tone="ghost"
      neutral={neutral}
      accessibilityLabel={`Owned by the global control${label ? ` ${label}` : ''}`}
    />
  );
}

function useNeutralChipColors() {
  const C = usePalette();
  return { surface: C.surfaceContainerHigh, border: C.ghostBorder, text: C.secondary };
}

// ── ♪ SIGNAL — the pattern author's suggested audio binding ─────────
//
// The recommendation declared in the pattern's AUDIO_MODULATION_V1 header and
// stamped onto the export by the engine (report 20260806_184). It replaced the
// old habit of encoding the recommendation in the PARAMETER NAME
// (`sliderFLUX_StarCount` → "F L U X_ STAR C" on screen).
//
// It is a HINT: it selects nothing, creates nothing and changes no value.
// Tapping it (when `onPress` is given) opens the modulation editor PREFILLED
// with the suggestion — the ◎ badge beside it still opens the same editor
// completely neutral. That two-entry contract is frozen; this component only
// changed how the chip is PAINTED.
//
// The band colour is resolved from the bare key, never from a live descriptor:
// a recommendation may name a signal the Companion is not currently
// publishing, and the chip must still read correctly.
export function AudioSuggestionChip({ suggestion, onPress }: {
  suggestion: AudioSuggestion;
  onPress?: () => void;
}) {
  const label = shortSignalLabel(suggestion.signal);
  return (
    <ParamChip
      label={`♪ ${label}`}
      accent={audioAccentHexForKey(suggestion.signal)}
      tone="loud"
      onPress={onPress}
      accessibilityLabel={suggestionChipAccessibilityLabel(label, suggestion.note)}
      accessibilityHint={onPress ? 'Opens the modulation editor prefilled with this suggestion' : undefined}
    />
  );
}
