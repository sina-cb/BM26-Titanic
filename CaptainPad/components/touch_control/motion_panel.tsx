// motion_panel — the RIGHT half of the TOUCH CONTROL tab: the 3D pad, Z speed,
// master brightness, and the tempo / sync buttons.
//
// ── Panel layout rule (operator request) ─────────────────────────────────
// On BOTH panels of this tab the draggable SURFACE is on top and every BUTTON
// lives in a single row at the bottom. Here that means: 3D pad → Z·SPEED →
// BRIGHTNESS → (sync notice) → button row (TAP · OSC · TAP · SYNC).
//
// ── About the "3D" pad (read this before changing the mapping) ────────────
// The MarsinEngine exposes NO Cartesian x/y/z parameter. Its spatial concept
// is view/group masks (lib/strand_views.js), not coordinates — confirmed
// against the live engine's full 73-entry /param-center/schema, which contains
// no positional key. So an XYZ pad has nothing literal to write to.
//
// What the CPC DOES expose is the trio that governs a pattern's spatial
// character: `size` (scale across the ship), `rotate` (orientation), `speed`
// (motion rate). The pad drives those, and every axis is labelled with the
// parameter it actually moves. This is a deliberate, honest mapping rather
// than a fake coordinate readout — an operator must be able to look at the
// control and know what the rig will do. Changing it to real coordinates would
// require an engine change, which is out of scope for an additive tab.
//
// TEMPO reuses the existing `use_tempo_tap` hooks unchanged, so this surface
// and the deck/mixer TAP clusters agree on what a tap means and already share
// the module-level tap series (a tap here continues a series started there).
// Those hooks own their own fail-loud Alerts.

import React, { useRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { useTempoState, useTempoTap, type TempoSourcePref } from '@/hooks/use_tempo_tap';
import { TouchPad } from './touch_pad';
import {
  PAD_AXES,
  clamp01,
  unitPercent,
  clampBrightness,
  brightnessToPadX,
  MIN_BRIGHTNESS,
} from './touch_control_logic';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export interface MotionPanelProps {
  /** Rig master fader [0,1], or null while unknown. */
  master: number | null;
  onMasterDrag: (v: number) => void;
  onMasterCommit: (v: number) => void;
  /** CPC `size` / `rotate` / `speed`, or null while unknown. */
  size: number | null;
  rotate: number | null;
  speed: number | null;
  onPadDrag: (size: number, rotate: number) => void;
  onPadCommit: (size: number, rotate: number) => void;
  onSpeedDrag: (v: number) => void;
  onSpeedCommit: (v: number) => void;
  /** Engine `bpmSpeedSync` — when on, the engine re-drives `speed` from the
   *  BPM and a manual Z move will be overwritten. Surfaced, never hidden. */
  bpmSpeedSyncOn: boolean;
  /** Turn the engine's BPM→SPEED sync on/off, handing SPEED between the
   *  audio engine and the operator. */
  onBpmSyncToggle: (on: boolean) => void;
  disabled: boolean;
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, letterSpacing: 2, color: C.text }}
      >
        {title}
      </Text>
      {hint ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, flex: 1 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function MotionPanel({
  master,
  onMasterDrag,
  onMasterCommit,
  size,
  rotate,
  speed,
  onPadDrag,
  onPadCommit,
  onSpeedDrag,
  onSpeedCommit,
  bpmSpeedSyncOn,
  onBpmSyncToggle,
  disabled,
}: MotionPanelProps) {
  const C = usePalette();
  const tempo = useTempoState();
  const { tap, setSource } = useTempoTap();

  // Unknown engine values still need a crosshair position; we park at centre
  // and write nothing until the operator touches the pad.
  //
  // X is now the rig MASTER BRIGHTNESS (operator request). The pad's X travel
  // maps onto [MIN_BRIGHTNESS..1], so the far-left of the pad is the 10% floor
  // rather than a dead strip the finger can enter but the rig ignores.
  const padX = master === null ? 0.5 : brightnessToPadX(master);
  const padY = rotate === null ? 0.5 : clamp01(rotate);
  const zValue = speed === null ? 0 : clamp01(speed);

  // HorizontalFader.onRelease takes no arguments and fires right after its
  // final onChange, BEFORE React re-renders — so reading `master` / `speed`
  // from the render closure there would commit a one-frame-stale value, and
  // because drag sends are rate-gated that stale number could be the last one
  // the rig ever receives. Carry the true latest value across in a ref.
  const latestMasterRef = useRef(master === null ? MIN_BRIGHTNESS : clampBrightness(master));
  latestMasterRef.current = master === null ? latestMasterRef.current : clampBrightness(master);
  const latestSpeedRef = useRef(zValue);
  latestSpeedRef.current = zValue;

  const sourceButton = (pref: TempoSourcePref, label: string) => {
    const isActive = tempo.sourcePref === pref;
    return (
      <TouchableOpacity
        key={pref}
        onPress={() => {
          if (disabled) return;
          setSource(pref);
        }}
        disabled={disabled}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        style={{
          minHeight: 64,
          paddingHorizontal: 18,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: isActive ? C.primary : C.ghostBorder,
          backgroundColor: isActive ? C.primary : 'transparent',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 12,
            letterSpacing: 1,
            color: isActive ? C.onPrimary : C.secondary,
          }}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const faderTrack = {
    height: 44,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 22,
    opacity: disabled ? 0.4 : 1,
  };
  const faderFill = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: C.primary,
    borderRadius: 22,
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      {/* ── Header: title, axis legend, live readouts ─────────────────── */}
      <SectionTitle
        title="3D"
        hint={`X ${PAD_AXES.x.label} · Y ${PAD_AXES.y.label} · Z ${PAD_AXES.z.label}`}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary }}>
          {PAD_AXES.x.label} {master === null ? '—' : `${unitPercent(master)}%`}
        </Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary }}>
          {PAD_AXES.y.label} {rotate === null ? '—' : `${unitPercent(rotate)}%`}
        </Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary }}>
          {PAD_AXES.z.label} {speed === null ? '—' : `${unitPercent(speed)}%`}
        </Text>
        <View style={{ flex: 1 }} />
        {/* BPM is a READOUT, not a button, so it stays up here with the other
            readouts; only the TAP control moves to the bottom button row. */}
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary }}>
          BPM {tempo.bpm === null ? '—' : Math.round(tempo.bpm)}
          <Text style={{ color: C.icon }}> · {tempo.source}</Text>
        </Text>
      </View>

      {/* ── PAD ON TOP ───────────────────────────────────────────────── */}
      <TouchPad
        label="Brightness and rotate pad"
        x={padX}
        y={padY}
        disabled={disabled}
        thumbColor={C.primary}
        style={{ flex: 1, minHeight: 180 }}
        onChange={(nx, ny) => {
          if (disabled) return;
          onPadDrag(nx, ny);
        }}
        onRelease={(nx, ny) => {
          if (disabled) return;
          onPadCommit(nx, ny);
        }}
      />

      {/* ── Z · SPEED — directly UNDER the pad (operator layout request) ─ */}
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              letterSpacing: 1,
              color: C.secondary,
            }}
          >
            Z · {PAD_AXES.z.label}
          </Text>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
            {speed === null ? '—' : `${unitPercent(speed)}%`}
          </Text>
        </View>
        <HorizontalFader
          value={zValue}
          onChange={(v: number) => {
            if (disabled) return;
            const next = clamp01(v);
            latestSpeedRef.current = next;
            onSpeedDrag(next);
          }}
          onRelease={() => {
            if (disabled) return;
            onSpeedCommit(latestSpeedRef.current);
          }}
          trackStyle={faderTrack}
          fillStyle={faderFill}
        />
      </View>

      {/* ── BRIGHTNESS (rig master) ──────────────────────────────────── */}
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              letterSpacing: 1,
              color: C.secondary,
            }}
          >
            BRIGHTNESS · RIG MASTER
          </Text>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
            {master === null ? '—' : `${unitPercent(master)}%`}
            <Text style={{ color: C.icon }}> · min {unitPercent(MIN_BRIGHTNESS)}%</Text>
          </Text>
        </View>
        <HorizontalFader
          value={master === null ? MIN_BRIGHTNESS : clampBrightness(master)}
          onChange={(v: number) => {
            if (disabled) return;
            // Floored here AND in the screen's write path — this tab can never
            // take the rig below MIN_BRIGHTNESS by any route.
            const next = clampBrightness(v);
            latestMasterRef.current = next;
            onMasterDrag(next);
          }}
          onRelease={() => {
            if (disabled) return;
            onMasterCommit(latestMasterRef.current);
          }}
          trackStyle={faderTrack}
          fillStyle={faderFill}
        />
      </View>

      {/* While the sync is ON the engine re-drives SPEED from the tempo, so a
          manual Z move is overwritten within a frame or two. Say so plainly —
          the SYNC button in the row below is the one-tap fix. */}
      {bpmSpeedSyncOn && (
        <View
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: C.tertiary,
            backgroundColor: C.surfaceContainerLow,
            padding: 10,
          }}
        >
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.tertiary }}>
            AUDIO ENGINE IS DRIVING {PAD_AXES.z.label}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 11,
              color: C.secondary,
              marginTop: 2,
            }}
          >
            A manual Z move will be overwritten. Tap SYNC ON below to take manual control.
          </Text>
        </View>
      )}

      {/* ── BUTTON ROW (bottom) ─────────────────────────────────────────
          Every button on this panel lives here: tap-tempo, the tempo source
          selector, and the audio-engine sync toggle. */}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <TouchableOpacity
          onPress={() => {
            if (disabled) return;
            tap();
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Tap tempo"
          style={{
            flexGrow: 2,
            flexBasis: 120,
            minHeight: 64,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.primary,
            opacity: disabled ? 0.4 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 20,
              letterSpacing: 3,
              color: C.onPrimary,
            }}
          >
            TAP
          </Text>
        </TouchableOpacity>

        {sourceButton('osc', 'OSC')}
        {sourceButton('tap', 'TAP')}

        {/* AUDIO ENGINE SYNC — hands SPEED between the audio engine and the
            operator. Writes CPC `bpmSpeedSync` (1 = engine drives, 0 = manual);
            the engine reads it as a boolean at a 0.5 threshold
            (lib/bpm_speed_sync.js). Label states the CURRENT state; the
            sub-line states what a tap will do, so there is no ambiguity about
            whether the word is a status or an action. */}
        <TouchableOpacity
          onPress={() => {
            if (disabled) return;
            onBpmSyncToggle(!bpmSpeedSyncOn);
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={
            bpmSpeedSyncOn
              ? 'Audio engine sync is on, tap to take manual speed control'
              : 'Audio engine sync is off, tap to let the audio engine drive speed'
          }
          accessibilityState={{ selected: bpmSpeedSyncOn }}
          style={{
            flexGrow: 1,
            flexBasis: 150,
            minHeight: 64,
            paddingHorizontal: 14,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: bpmSpeedSyncOn ? C.tertiary : C.ghostBorder,
            backgroundColor: bpmSpeedSyncOn ? 'transparent' : C.surfaceContainerHigh,
            opacity: disabled ? 0.4 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 13,
              letterSpacing: 1,
              color: bpmSpeedSyncOn ? C.tertiary : C.text,
            }}
          >
            {bpmSpeedSyncOn ? 'SYNC ON' : 'SYNC OFF'}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 10,
              color: C.icon,
              marginTop: 2,
              textAlign: 'center',
            }}
          >
            {bpmSpeedSyncOn ? 'tap for manual' : 'manual — tap for audio'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
        X {PAD_AXES.x.hint} · Y {PAD_AXES.y.hint} · Z {PAD_AXES.z.hint}
      </Text>
    </View>
  );
}
