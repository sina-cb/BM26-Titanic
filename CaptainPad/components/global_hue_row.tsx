/**
 * GlobalHueRow — standalone global rig HUE shifter row (June 2026).
 *
 * A compact, full-width "HUE [fader] [°] [swatch]" row that owns the
 * global hue-shift wiring end to end: the live degrees state, the mount
 * seed off /globals.hueShift, the `globalHueShift` WS reconciliation, the
 * one-shot persisted-spin clear, the mid-drag broadcast suppression, and
 * the POST via setGlobalHue(deg, 0).
 *
 * WHY a standalone component (not a prop on GlobalEffectMacros):
 *   The deck renders the GEM grid in its `mixer-strip` variant, which
 *   intentionally OMITS the hue row (no room on the bottom strip). The
 *   operator still wants a global HUE control on the deck — placed at the
 *   TOP of the deck's playlist (mirroring how the mixer shows a HUE row
 *   above each channel's playlist). Pulling the hue wiring into its own
 *   self-contained component lets index.tsx mount it there WITHOUT
 *   resurrecting the (currently unused) GEM `deck` variant or duplicating
 *   any hue state — the engine writes are byte-for-byte identical to the
 *   GEM implementation (same setGlobalHue(deg, 0), same seed, same WS
 *   reconcile), so the global hue-shift behavior is unchanged.
 *
 * SPIN was removed from the hue UI (June 2026): the auto-rotate control is
 * gone, so EVERY hue write forces autoRotateDegPerSec: 0 and the mount
 * clear zeroes any persisted spin once, so the hue can never rotate
 * invisibly with no control to stop it.
 *
 * The fader is normalized 0..1 (HorizontalFader's contract); engineering
 * units (degrees) map across that range at the boundary. The row is ≥44pt
 * tall for a comfortable touch target; a live swatch previews the hue.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { fetchGlobals } from '@/utils/api';
import { setGlobalHue } from '@/utils/channelExtrasApi';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { engineEvents } from '@/utils/engineEvents';

export const GlobalHueRow: React.FC = () => {
  const C = usePalette();
  // Live rig hue offset, reflecting the engine's `globalHueShift` broadcast.
  const [degrees, setDegrees] = useState(0);
  // While the operator is dragging the fader the engine may also be
  // broadcasting — we don't want an incoming broadcast to yank the thumb out
  // from under their finger. This holds the live drag state; cleared on release.
  const hueDraggingRef = useRef(false);
  // One-shot guard so we send exactly ONE setGlobalHue(degrees, 0) at mount to
  // force any persisted auto-rotate off — once the seeded degrees have landed,
  // not while the operator is dragging, and never more than once per mount.
  const spinClearedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Seed the knob from /globals (the engine's persisted hueShift). The
      // globalHueShift WS broadcast keeps it live afterwards.
      const globals = await fetchGlobals();
      if (alive && globals.ok && globals.data?.hueShift && !hueDraggingRef.current) {
        const hs = globals.data.hueShift;
        if (typeof hs.degrees === 'number') {
          setDegrees(hs.degrees);
        }
        // SPIN control was removed (June 2026): force any persisted auto-rotate
        // off exactly once at mount so the hue can't keep spinning invisibly.
        // Use the SEEDED degrees as the start offset and only fire if there's
        // actually a residual spin and the operator isn't mid-drag.
        if (!spinClearedRef.current && !hueDraggingRef.current
            && typeof hs.autoRotateDegPerSec === 'number' && Math.round(hs.autoRotateDegPerSec) !== 0) {
          spinClearedRef.current = true;
          const seededDegrees = typeof hs.degrees === 'number' ? hs.degrees : 0;
          setGlobalHue(seededDegrees, 0).then(r => {
            if (!r.ok) console.warn('[GlobalHueRow] failed to clear persisted hue spin:', r.error);
          });
        }
      }
    })();
    const unsub = engineEvents.subscribe((msg: any) => {
      if (!alive) return;
      if (msg?.type === 'globalHueShift' && msg.hueShift) {
        // The engine is authoritative for the live degrees. Reflect them UNLESS
        // the operator is mid-drag on the fader, in which case we'd be fighting
        // their finger. SPIN was removed (June 2026), so we no longer reconcile
        // autoRotateDegPerSec — only the hue degrees.
        const hs = msg.hueShift;
        const deg = typeof hs.degrees === 'number' ? hs.degrees : 0;
        setDegrees(prev => (hueDraggingRef.current ? prev : deg));
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // Global hue degrees fader (0-360°). Optimistic local set + POST. The
  // HorizontalFader throttles onChange to ~50 ms during a drag, so each POST is
  // naturally rate-limited. Fail-loud: surface a rejection.
  //
  // SPIN removed (June 2026): EVERY hue write FORCES autoRotateDegPerSec: 0.
  // Without this, a previously persisted spin would survive (the engine keeps
  // the last rate) and the hue would keep rotating invisibly with no control to
  // stop it. Pairs with the one-shot mount clear above.
  const onDegreesChange = useCallback(async (deg: number) => {
    setDegrees(deg);
    const r = await setGlobalHue(deg, 0);
    if (!r.ok) {
      console.warn('[GlobalHueRow] global hue degrees rejected:', r.error);
      Alert.alert('Hue not applied', r.error || 'The engine rejected the global hue.');
    }
  }, []);

  // QA round7: tap the degree readout to reset the hue to 0° ("no shift").
  // Same wiring/endpoint as the fader — just a one-tap shortcut back to
  // neutral. No-op if already at 0 to avoid a redundant POST.
  const onResetDegrees = useCallback(() => {
    if (Math.round(degrees) === 0) return;
    onDegreesChange(0);
  }, [degrees, onDegreesChange]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: 6 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 40, letterSpacing: 0.5, textTransform: 'uppercase' }}>HUE</Text>
      {/* The track is wrapped in a flex:1 / minWidth:0 spacer (it fills that
          wrapper at width:100%) so it spans the row on react-native-web; the
          value stays right-aligned in its fixed column. */}
      <View style={{ flex: 1, minWidth: 0, marginHorizontal: 8 }}>
        <HorizontalFader
          value={Math.max(0, Math.min(1, degrees / 360))}
          onChange={(v: number) => onDegreesChange(Math.round(v * 360))}
          onDragStart={() => { hueDraggingRef.current = true; }}
          onRelease={() => { hueDraggingRef.current = false; }}
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
      {/* Tap the degree readout to reset the hue to 0° ("no shift"). */}
      <TouchableOpacity onPress={onResetDegrees} accessibilityLabel="Reset global hue to zero degrees" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, width: 40, textAlign: 'right' }}>{Math.round(degrees)}°</Text>
      </TouchableOpacity>
      {/* QA round7: the live-hue preview is now a CIRCLE (was a rounded
          square that mimicked the destructive Blackout/Invert chips and
          looked tappable). A circle reads as a non-interactive status dot,
          not a button. */}
      <View
        style={{
          width: 18, height: 18, borderRadius: 9, marginLeft: 8,
          borderWidth: 1, borderColor: C.ghostBorder,
          backgroundColor: `hsl(${Math.round(degrees)}, 80%, 55%)`,
        }}
        accessibilityLabel={`Current global hue ${Math.round(degrees)} degrees`}
      />
    </View>
  );
};
