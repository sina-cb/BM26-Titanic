/**
 * KnobPill — THE tiny violet "KNOB N" badge that names the physical MFT
 * encoder driving an on-screen control. One shared component so the pill
 * reads identically everywhere it appears:
 *   - the deck's local-param sliders (GlobalParams.tsx),
 *   - the mixer focused strip's local-param MiniFaders (mixer.tsx),
 *   - the GLOBALS row SPEED fader (CPCControls.tsx — MFT knob 1),
 *   - the hue controls (deck DeckHueRow = the deck channel's hue, mixer
 *     focused strip's per-channel HUE trim — MFT knob 2 always drives the
 *     FOCUSED channel's hue; hue is per-channel only).
 *
 * Violet = the app-wide MIDI accent family (MidiMap's MIDI_VIOLET). The knob
 * NUMBERS come from the callers' single sources of truth (knob_badge.ts for
 * the local params, knob_page.ts KNOB_PAGE_GLOBALS for the row-0 globals) —
 * this component only paints.
 */
import React from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';

// The app-wide MIDI accent (mirrors MidiMap's MIDI_VIOLET / the deck's
// KNOB_ACCENT) so every "KNOB N" pill reads as the same family.
export const KNOB_PILL_ACCENT = '#7c5cff';

export function KnobPill({ knobNumber, style }: {
  /** 1-based PHYSICAL knob number the operator counts ("KNOB 2"). */
  knobNumber: number;
  /** Optional layout overrides (e.g. alignSelf/margins at the call site). */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{
      paddingHorizontal: 5, paddingVertical: 1,
      borderRadius: 4, borderWidth: 1, borderColor: KNOB_PILL_ACCENT,
      backgroundColor: 'rgba(124,92,255,0.12)',
    }, style]}>
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8,
          color: KNOB_PILL_ACCENT, textTransform: 'uppercase', letterSpacing: 0.5,
        }}
        numberOfLines={1}
      >
        KNOB {knobNumber}
      </Text>
    </View>
  );
}
