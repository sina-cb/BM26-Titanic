/**
 * DeckHueRow — the DECK CHANNEL's per-channel HUE trim row (July 2026).
 *
 * Replaces the old GlobalHueRow (global_hue_row.tsx): the GLOBAL rig hue
 * shifter was REMOVED end to end by operator decision ("only the channel
 * hue shifts, no global hidden one") — hue is PER-CHANNEL ONLY now. This
 * row is the deck's equivalent of the mixer strip's per-channel HUE trim:
 * a compact, full-width "HUE [fader] [°] [swatch]" row that edits the DECK
 * CHANNEL's `hue` field (engine F-hue, docs/39 — pre-blend RGB rotation on
 * the deck's own contribution; W/A/UV never touched).
 *
 * Wiring mirrors the mixer strip trim (reuse, don't duplicate state): the
 * parent (index.tsx) owns the live value (`deckChannel.hue`, reconciled by
 * the WS `deck` broadcast) and the optimistic write
 * (setChannelHue(deckId, deg, { deck: true }) + revert on rejection), so
 * this component is a pure controlled row — value in, onHueChange out.
 *
 * The fader is normalized 0..1 (HorizontalFader's contract); engineering
 * units (degrees) map across that range at the boundary. The row is ≥44pt
 * tall for a comfortable touch target; a live swatch previews the hue.
 */
import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Type } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { KnobPill } from '@/components/ui/knob_pill';
import { globalKnobNumber } from '@/utils/midi/knob_page';
import { useMidiControllerConnected } from '@/hooks/useMidiControl';

export const DeckHueRow: React.FC<{
  /** The deck channel's live hue in degrees [0,360) (engine F-hue). */
  hue: number;
  /** Write path — the parent PATCHes the deck channel (optimistic + revert). */
  onHueChange: (degrees: number) => void;
  /** Soft PLAN lock gate (planLocked && !leaseHeld). When true the hue fader
   *  and the tap-to-reset readout are disabled — dimmed, handlers blocked —
   *  until the operator takes over. The row still renders (and reconciles the
   *  live plan-driven hue) read-only. Default false. */
  disabled?: boolean;
}> = ({ hue, onHueChange, disabled = false }) => {
  const C = usePalette();
  const mftConnected = useMidiControllerConnected('mft');
  const degrees = Number.isFinite(hue) ? hue : 0;

  const onDegreesChange = useCallback((deg: number) => {
    // Soft PLAN lock — the fader/reset are pointerEvents-blocked/disabled
    // below; this is the belt-and-suspenders write-path gate.
    if (disabled) return;
    onHueChange(deg);
  }, [disabled, onHueChange]);

  // Tap the degree readout to reset the hue to 0° ("no shift"). Same wiring
  // as the fader — just a one-tap shortcut back to neutral. No-op if already
  // at 0 to avoid a redundant PATCH.
  const onResetDegrees = useCallback(() => {
    if (Math.round(degrees) === 0) return;
    onDegreesChange(0);
  }, [degrees, onDegreesChange]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: 6 }}>
      {/* This row is the deck's canonical HUE control, so it wears the
          physical-knob badge directly: on the DECK tab, MFT knob 2 (row-0
          global, knob_page.ts) drives this exact value — the DECK CHANNEL's
          per-channel hue (push = reset to 0°). On the mixer tab the same
          knob drives the FOCUSED channel's HUE trim, which wears its own
          badge there. */}
      {mftConnected
        ? <KnobPill knobNumber={globalKnobNumber('hue')} style={{ marginRight: 6 }} />
        : null}
      {/* The shared caps recipe (docs/54 §1.1) — the row label is the same
          object as every other 10pt caps label on the deck. */}
      <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary, width: 40 }}>HUE</Text>
      {/* The track is wrapped in a flex:1 / minWidth:0 spacer (it fills that
          wrapper at width:100%) so it spans the row on react-native-web; the
          value stays right-aligned in its fixed column.
          Soft PLAN lock: pointerEvents 'none' blocks the fader's PanResponder
          entirely (a gated onChange alone would still let the thumb track the
          finger locally); the dim marks it disabled. WS reconcile stays live
          so plan-driven hue moves still show. */}
      <View
        style={{ flex: 1, minWidth: 0, marginHorizontal: 8, opacity: disabled ? 0.45 : 1 }}
        pointerEvents={disabled ? 'none' : 'auto'}
      >
        <HorizontalFader
          value={Math.max(0, Math.min(1, degrees / 360))}
          onChange={(v: number) => onDegreesChange(Math.round(v * 360))}
          // QA round7: at 0° the row read as "broken/empty". The track is a
          // subtle FULL-WIDTH neutral bar (a 1px ghost border makes the empty
          // track look intentional, not missing) and the thumb sits FULLY
          // INSIDE the track's left edge at 0° so it clearly reads "no shift"
          // rather than an unrendered control. (HorizontalFader clips its
          // track with overflow:hidden, so the thumb's old translateX:-8 hid
          // half of it off the left edge at 0° — dropping the negative offset
          // keeps the whole thumb visible against the left edge.)
          trackStyle={{ width: '100%', height: 12, backgroundColor: C.surfaceContainerHigh, borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder, justifyContent: 'center' }}
          fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 6 }}
          thumbStyle={{ position: 'absolute', width: 14, height: 22, backgroundColor: C.surfaceContainerLowest, borderRadius: 4, borderWidth: 1, borderColor: C.secondary }}
        />
      </View>
      {/* Tap the degree readout to reset the hue to 0° ("no shift"). Gated
          under the soft PLAN lock like the fader — it's a write path too. */}
      <TouchableOpacity
        onPress={onResetDegrees}
        disabled={disabled}
        accessibilityLabel="Reset deck channel hue to zero degrees"
        accessibilityState={{ disabled }}
        style={disabled ? { opacity: 0.45 } : null}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, width: 40, textAlign: 'right' }}>{Math.round(degrees)}°</Text>
      </TouchableOpacity>
      {/* QA round7: the live-hue preview is a CIRCLE (a rounded square
          mimicked the destructive Blackout/Invert chips and looked
          tappable). A circle reads as a non-interactive status dot. */}
      <View
        style={{
          width: 18, height: 18, borderRadius: 9, marginLeft: 8,
          borderWidth: 1, borderColor: C.ghostBorder,
          backgroundColor: `hsl(${Math.round(degrees)}, 80%, 55%)`,
        }}
        accessibilityLabel={`Current deck channel hue ${Math.round(degrees)} degrees`}
      />
    </View>
  );
};
