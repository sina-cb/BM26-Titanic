// color_panel — the LEFT half of the TOUCH CONTROL tab.
//
// A hue × saturation pad plus a brightness fader, driving a FIVE-COLOUR
// palette. Slots 1 and 2 are backed by the engine's `colorPalette1` /
// `colorPalette2` (the only two colour params the CPC has), so they colour
// EVERY running pattern. Slots 3-5 are tab-local palette storage; they tint the
// colour-capable EFFECTS and the PAINT zones, and they also reach any pattern
// that declares this tab's own five-colour sliders (`sliderHue3/4/5` plus
// `sliderVal3/4/5` — 66_five_colour_prism and 67_five_colour_stations do).
// A pattern without those sliders simply never sees slots 3-5; the UI says so
// rather than hiding it.
//
// The palette params are SLEWED engine-side: paramCenter re-arms a ramp toward
// each new target over `colorTransitionMs` (docs/36), which is why the fade
// control sits on this panel next to the colours it governs.
//
// PRESENTATIONAL BY DESIGN: this component owns no engine I/O. It reports drag
// frames via `onColorDrag`, the settled value via `onColorCommit`, and palette
// actions via `onPalette`; the screen decides what to send and when. Keeping
// every write in one file makes the Codex P0 rules auditable in one place.
//
// The gradient is drawn with `react-native-svg`, which is ALREADY a CaptainPad
// dependency (15.10.0, used by components/Modulation.tsx and
// components/audio/AudioTraceCanvas.tsx). Nothing new was installed, so the
// playa's no-internet / vendored-deps requirement still holds.

import React, { useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { TouchPad } from './touch_pad';
import {
  hsvToCss,
  hueDegrees,
  unitPercent,
  clamp01,
  COLOR_FADE_MAX_MS,
  COLOR_SLOTS,
  isEngineBackedSlot,
  type Hsv,
  type ColorTarget,
  type ColorSlot,
} from './touch_control_logic';

// Re-exported so the screen and this panel can never drift onto two different
// HSV shapes. The canonical definitions live in the pure logic module.
export type { Hsv, ColorTarget, ColorSlot };

/** Hue stops around the wheel. 13 stops (0°…360° inclusive) is plenty for a
 *  CONTINUOUS gradient — the interpolation between stops is done by the
 *  renderer, not by us, so this is smoothness-per-stop, not a swatch count. */
const HUE_STOPS = 13;

/** 8pt on every edge turns a 28×28 visual button into a 44×44 target — the
 *  same floor the deck and mixer use. */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Palette-generator actions offered under the dots. */
export type PaletteAction = 'master' | 'monochrome' | 'complement' | 'contrast';

export interface ColorPanelProps {
  /** Which slot (1-5) or 'all' the pad is editing. */
  active: ColorTarget;
  onSelectActive: (target: ColorTarget) => void;
  /** The five colours, index 0 = slot 1. Entries may be null (unknown). */
  colors: (Hsv | null)[];
  /** Continuous drag frame — the screen rate-gates this. */
  onColorDrag: (target: ColorTarget, next: Hsv) => void;
  /** Settled value — the screen MUST send this ungated. */
  onColorCommit: (target: ColorTarget, next: Hsv) => void;
  /** MASTER / HUE / COMPLEMENT / CONTRAST. */
  onPalette: (action: PaletteAction) => void;
  /** PAINT SHIP — is the five-colour zone paint currently live on the rig? */
  painting: boolean;
  onTogglePaint: () => void;
  /** CYCLE — are the patterns being walked through all five colours? */
  cycling: boolean;
  onToggleCycle: () => void;
  /** `colorTransitionMs`, or null while unknown. */
  fadeMs: number | null;
  onFadeDrag: (ms: number) => void;
  onFadeCommit: (ms: number) => void;
  /** Soft PLAN lock / offline — every mutating control dims and stops. */
  disabled: boolean;
}

/** Smooth hue × saturation wash — two real gradients, not a swatch grid. */
function GradientWash({ value }: { value: number }) {
  const hueStops = useMemo(
    () =>
      Array.from({ length: HUE_STOPS }, (_, i) => {
        const t = i / (HUE_STOPS - 1);
        return { offset: `${t * 100}%`, color: hsvToCss(t, 1, value) };
      }),
    [value],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="tcHue" x1="0" y1="0" x2="1" y2="0">
            {hueStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity="1" />
            ))}
          </LinearGradient>
          {/* Saturation: clear at the top (full chroma), white at the bottom. */}
          <LinearGradient id="tcSat" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tcHue)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tcSat)" />
      </Svg>
    </View>
  );
}

/**
 * One colour DOT. Selected slot gets a ring; slots 3-5 carry a small mark
 * because they have no engine palette home — they reach effects, paint zones,
 * and the five-colour patterns, but NOT a stock two-colour pattern.
 */
function ColorDot({
  slot,
  color,
  isActive,
  onPress,
  disabled,
}: {
  slot: ColorSlot;
  color: Hsv | null;
  isActive: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  const C = usePalette();
  const engineBacked = isEngineBackedSlot(slot);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`Color ${slot}`}
      accessibilityState={{ selected: isActive }}
      style={{ alignItems: 'center', gap: 4, opacity: disabled ? 0.4 : 1 }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          borderWidth: isActive ? 4 : 2,
          borderColor: isActive ? C.primary : C.ghostBorder,
          // A null slot renders as the surface, not black — black is a real
          // colour an operator can set and must not double as "unknown".
          backgroundColor: color ? hsvToCss(color.h, color.s, color.v) : C.surfaceContainerHigh,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 11,
            color: color && color.v > 0.6 && color.s < 0.7 ? '#000' : '#fff',
          }}
        >
          {slot}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 8,
          color: isActive ? C.primary : C.icon,
        }}
      >
        {engineBacked ? 'every pattern' : 'fx + 5-col'}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Per-colour brightness (operator request: "brightness options for each colour
 * number"). Each colour already carries its own V — this exposes all five at
 * once so relative levels can be set without selecting each colour first.
 *
 * Lives OUTSIDE the dot's TouchableOpacity: nesting a drag surface inside a
 * button makes the press and the drag fight for the gesture.
 */
function DotBrightness({
  color,
  onChange,
  onCommit,
  disabled,
}: {
  color: Hsv | null;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  disabled: boolean;
}) {
  const C = usePalette();
  const v = color ? clamp01(color.v) : 0;
  const latest = useRef(v);
  latest.current = v;
  return (
    <View style={{ width: 56, gap: 2, opacity: disabled || !color ? 0.35 : 1 }}>
      <HorizontalFader
        value={v}
        onChange={(nv: number) => {
          if (disabled || !color) return;
          latest.current = nv;
          onChange(nv);
        }}
        onRelease={() => {
          if (disabled || !color) return;
          onCommit(latest.current);
        }}
        trackStyle={{
          height: 16,
          backgroundColor: C.surfaceContainerHigh,
          borderRadius: 8,
        }}
        fillStyle={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          backgroundColor: color ? hsvToCss(color.h, color.s, 1) : C.ghostBorder,
          borderRadius: 8,
        }}
      />
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 8,
          color: C.icon,
          textAlign: 'center',
        }}
      >
        {color ? `${unitPercent(v)}%` : '—'}
      </Text>
    </View>
  );
}

function PaletteButton({
  label,
  hint,
  onPress,
  disabled,
  active,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled: boolean;
  active?: boolean;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={{
        // grow-with-a-floor, not flex:1 — adding HUE made this row SIX buttons,
        // and an even split squashed "COMPLEMENT" past legibility on a half
        // panel. Same idiom the effects row uses: they wrap to a second line
        // rather than shrink. (EffectsBar: flexGrow 1 / flexBasis 110.)
        flexGrow: 1,
        flexBasis: 96,
        minHeight: 52,
        paddingHorizontal: 8,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: active ? 3 : 1,
        borderColor: active ? C.primary : C.ghostBorder,
        backgroundColor: C.surfaceContainerLowest,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 11,
          letterSpacing: 1,
          color: active ? C.primary : C.text,
        }}
      >
        {label}
      </Text>
      <Text
        style={{ fontFamily: 'Inter_400Regular', fontSize: 9, color: C.icon, textAlign: 'center' }}
      >
        {hint}
      </Text>
    </TouchableOpacity>
  );
}

export function ColorPanel({
  active,
  onSelectActive,
  colors,
  onColorDrag,
  onColorCommit,
  onPalette,
  painting,
  onTogglePaint,
  cycling,
  onToggleCycle,
  fadeMs,
  onFadeDrag,
  onFadeCommit,
  disabled,
}: ColorPanelProps) {
  const C = usePalette();
  // In MASTER mode the pad reads from slot 1 — every slot is being written
  // together, so slot 1 is the authoritative crosshair position.
  const current = active === 'all' ? colors[0] : colors[active - 1];

  // The pad needs a concrete position. When a colour is unknown we park the
  // crosshair centre-screen and write NOTHING until the operator touches it.
  const h = current ? clamp01(current.h) : 0.5;
  const s = current ? clamp01(current.s) : 1;
  const v = current ? clamp01(current.v) : 1;

  const emit = (next: Hsv, commit: boolean) => {
    if (disabled) return;
    if (commit) onColorCommit(active, next);
    else onColorDrag(active, next);
  };

  // HorizontalFader's onRelease takes NO arguments and fires immediately after
  // its final onChange — before React has re-rendered. Reading `v` / `fadeMs`
  // from the render closure there yields a ONE-FRAME-STALE value, and since
  // drag sends are rate-gated the stale number could be the last thing the rig
  // receives. These refs carry the true latest value into onRelease. (The
  // TouchPad needs no such thing — it passes the final x/y as arguments.)
  const latestVRef = useRef(v);
  latestVRef.current = v;
  const latestFadeRef = useRef(fadeMs);
  latestFadeRef.current = fadeMs;

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 16,
            letterSpacing: 2,
            color: C.text,
          }}
        >
          COLOR
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, flex: 1 }}>
          drag: ← hue → · ↑ saturation
        </Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary }}>
          {active === 'all' ? 'ALL' : `#${active}`} · {hueDegrees(h)}°
        </Text>
      </View>

      {/* PAD ON TOP — operator layout rule for this tab: the surface you drag
          is always the top of the panel, and every button lives below it. */}
      <TouchPad
        label={active === 'all' ? 'All colors hue and saturation pad' : `Color ${active} hue and saturation pad`}
        x={h}
        y={s}
        disabled={disabled}
        thumbColor="#ffffff"
        background={<GradientWash value={v} />}
        style={{ flex: 1, minHeight: 180 }}
        onChange={(nx, ny) => emit({ h: nx, s: ny, v }, false)}
        onRelease={(nx, ny) => emit({ h: nx, s: ny, v }, true)}
        // ALL FIVE colours are drawn on the pad at once (operator request:
        // "all the colour dots on the palette at once for total control").
        // A dot with no value yet is omitted rather than parked at a
        // fabricated position. Tapping a dot grabs it — see TouchPad's pick
        // handling — so any colour can be edited without leaving the pad.
        markers={COLOR_SLOTS.flatMap((slot) => {
          const c = colors[slot - 1];
          if (!c) return [];
          return [{
            key: String(slot),
            x: clamp01(c.h),
            y: clamp01(c.s),
            color: hsvToCss(c.h, c.s, c.v),
            label: String(slot),
            active: active === 'all' ? slot === 1 : active === slot,
          }];
        })}
        onPickMarker={(key) => onSelectActive(Number(key) as ColorSlot)}
      />

      {/* Brightness (HSV "value") of the selected colour. Distinct from the rig
          master on the right panel — this tints the colour, the master scales
          the whole output. */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              letterSpacing: 1,
              color: C.secondary,
            }}
          >
            COLOR BRIGHTNESS
          </Text>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
            {unitPercent(v)}%
          </Text>
        </View>
        <HorizontalFader
          value={v}
          onChange={(nv: number) => {
            latestVRef.current = nv;
            emit({ h, s, v: nv }, false);
          }}
          onRelease={() => emit({ h, s, v: latestVRef.current }, true)}
          trackStyle={{
            height: 32,
            backgroundColor: C.surfaceContainerHigh,
            borderRadius: 16,
            opacity: disabled ? 0.4 : 1,
          }}
          fillStyle={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            backgroundColor: hsvToCss(h, s, 1),
            borderRadius: 16,
          }}
        />
      </View>

      {/* colorTransitionMs — how long the engine ramps between palette targets. */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              letterSpacing: 1,
              color: C.secondary,
            }}
          >
            COLOR FADE
          </Text>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
            {fadeMs === null ? '—' : `${Math.round(fadeMs)} ms`}
          </Text>
        </View>
        <HorizontalFader
          value={fadeMs === null ? 0 : clamp01(fadeMs / COLOR_FADE_MAX_MS)}
          onChange={(u: number) => {
            if (disabled) return;
            const ms = clamp01(u) * COLOR_FADE_MAX_MS;
            latestFadeRef.current = ms;
            onFadeDrag(ms);
          }}
          onRelease={() => {
            if (disabled || latestFadeRef.current === null) return;
            onFadeCommit(latestFadeRef.current);
          }}
          trackStyle={{
            height: 26,
            backgroundColor: C.surfaceContainerHigh,
            borderRadius: 13,
            opacity: disabled ? 0.4 : 1,
          }}
          fillStyle={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            backgroundColor: C.primary,
            borderRadius: 13,
          }}
        />
      </View>

      {/* ── BUTTON ROW (bottom): the five dots, then the palette actions ── */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {COLOR_SLOTS.map((slot) => {
          const c = colors[slot - 1] ?? null;
          return (
            <View key={slot} style={{ alignItems: 'center', gap: 4 }}>
              <ColorDot
                slot={slot}
                color={c}
                isActive={active === slot || active === 'all'}
                onPress={() => onSelectActive(slot)}
                disabled={disabled}
              />
              {/* Per-colour brightness — writes THIS slot regardless of which
                  colour the pad is currently editing. */}
              <DotBrightness
                color={c}
                disabled={disabled}
                onChange={(nv) => c && onColorDrag(slot, { h: c.h, s: c.s, v: nv })}
                onCommit={(nv) => c && onColorCommit(slot, { h: c.h, s: c.s, v: nv })}
              />
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <PaletteButton
          label="MASTER"
          hint="all 5 one colour"
          active={active === 'all'}
          onPress={() => onPalette('master')}
          disabled={disabled}
        />
        {/* The three schemes, calm to loud: HUE is one colour at five
            brightnesses; COMPLEMENT is five hues that go together; CONTRAST is
            five that clash. */}
        <PaletteButton
          label="HUE"
          hint="1 colour, 5 brightnesses"
          onPress={() => onPalette('monochrome')}
          disabled={disabled}
        />
        <PaletteButton
          label="COMPLEMENT"
          hint="5 that go together"
          onPress={() => onPalette('complement')}
          disabled={disabled}
        />
        <PaletteButton
          label="CONTRAST"
          hint="5 that clash"
          onPress={() => onPalette('contrast')}
          disabled={disabled}
        />
        {/* PAINT SHIP — puts all five colours on the rig at once by pinning
            five zones to fixed colours. Painted zones go STATIC (the engine
            overwrites those pixels flat, so the pattern AND the tracer stop
            animating there) — the hint says so, because that is the trade the
            operator is making. Rails and corner groups are left alone so most
            of the ship keeps moving. */}
        {/* CYCLE — the patterns only hold TWO colours (each pattern declares
            its own colorPalette1/2 hooks), so this walks those two slots
            through all five over time. Every colour gets used and the patterns
            keep animating; the engine's COLOR FADE does the crossfade. */}
        <PaletteButton
          label={cycling ? 'CYCLING' : 'CYCLE 5'}
          hint={cycling ? 'patterns walking all 5' : 'all 5 through the patterns'}
          active={cycling}
          onPress={onToggleCycle}
          disabled={disabled}
        />
        <PaletteButton
          label={painting ? 'PAINTING' : 'PAINT SHIP'}
          hint={painting ? 'zones held — tap to release' : 'all 5 on the rig (zones go static)'}
          active={painting}
          onPress={onTogglePaint}
          disabled={disabled}
        />
      </View>
    </View>
  );
}
