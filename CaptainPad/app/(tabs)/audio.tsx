// Audio Analysis tab — operator surface for the in-engine mic
// listener and BPM → speed sync (docs/25 §8.2).
//
// Structure (top-down) — matches the operator's mental flow:
//   1. Header (icon + title + reset)
//   2. MASTER ENABLE / DISABLE (mic listener on/off)
//   3. BPM → SPEED SYNC (works independently of the mic; runs off
//      whatever tempoBpm source is live — OSC today, mic-detected
//      tomorrow)
//   4. MICROPHONE — status + tap-to-pick device (server-side mic list)
//   5. LIVE DATA — STEMS (OSC-driven, three meters + per-stem gains)
//   6. LIVE DATA — MIC ANALYSIS (mic-driven; meters + nested band /
//      kick tuning sliders)
//
// Important UI note: every interactive sub-component (FaderRow,
// BandMeter, …) lives at MODULE scope. Defining them inside the
// screen function would give them a new component identity on every
// parent state change, which unmounts / remounts the underlying
// HorizontalFader mid-drag and makes the sliders feel broken.

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import {
  fetchAudioConfig, patchAudioConfig, resetAudioConfig,
  fetchAudioDevices, getApiBaseAsync, updateParamCenter,
} from '@/utils/api';
import { useAudioStatus, useSharedParamValues, useLiveParamValues, useOscStatus, useParamRange, type AudioStatus, type OscPillState } from '@/hooks/useEngineState';

const C = Colors.light;
// "Auto-driven" accent — mirrors Colors.light.tertiary in theme.ts.
// Local copy keeps this screen working even when the theme's TS shape
// isn't yet picked up by the consuming module's checker.
const ACCENT_AUTO = '#1b9e77';

interface AudioConfig {
  enabled: boolean;
  capture: {
    backend: string; device: string | null; deviceLabel?: string | null; deviceId?: string | null;
    sampleRate: number; channels: number; inputFormat: string | null;
  };
  fftSize: number;
  hopSize: number;
  // Bands now use an asymmetric attack/release envelope + noise gate
  // (2026-05-25; see marsin_engine/lib/audio_analyzer.js).
  bands: {
    lowMaxHz: number; midMaxHz: number;
    attackMs: number; releaseMs: number; noiseGate: number;
  };
  kick:  { minHz: number; maxHz: number; threshold: number; refractoryMs: number; decayMs: number };
}

// BPM-sync absolute bounds. Operator picks min/max inside this band;
// the UI refuses to let them cross (each slider's bound moves to keep
// them at least 1 BPM apart). Mirrors the registry range in
// marsin_engine/lib/param_center.js.
const BPM_MIN_ABS = 60;
const BPM_MAX_ABS = 180;

interface AudioDevice {
  id: string;
  label: string;
  platform: string;
  inputFormat: string;
  ffmpegDevice: string;
  isDefault?: boolean;
  alternativeName?: string;
}

// ── Card primitives ─────────────────────────────────────────────────────
// Match the Config tab's card layout: rounded surface, ghostBorder,
// ambient shadow, generous padding. Sub-cards (used inside the live
// data sections) are slightly inset and use the lower surface tier.

const CARD = {
  ...globalStyles.card,
  padding: 20,
  marginBottom: 20,
  alignSelf: 'stretch',
  ...globalStyles.ambientShadow,
} as const;

const SUB_CARD = {
  backgroundColor: C.surfaceContainerLow,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: C.ghostBorder,
  padding: 14,
  marginTop: 12,
} as const;

function SectionHeader({ icon, title, hint, right }: {
  icon: string; title: string; hint?: string; right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
      <View style={{
        width: 36, height: 36, borderRadius: 8,
        backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center',
      }}>
        <IconSymbol name={icon as any} size={20} color={C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 0.8 }}>
          {title}
        </Text>
        {hint ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

function SubHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </Text>
      {right ?? null}
    </View>
  );
}

// ── Sliders ─────────────────────────────────────────────────────────────

type FaderRowProps = {
  label: string;
  suffix?: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  hint?: string;
  onDrag: (v: number) => void;
  onCommit: (v: number) => void;
};

function FaderRow({ label, suffix, min, max, value, step, hint, onDrag, onCommit }: FaderRowProps) {
  const [draftNorm, setDraftNorm] = useState<number | null>(null);
  const lastValRef = useRef<number>(value);

  const span = max - min || 1;
  const externalNorm = Math.max(0, Math.min(1, (value - min) / span));
  const norm = draftNorm ?? externalNorm;

  const snap = useCallback((v: number) => (step ? Math.round(v / step) * step : v), [step]);

  const handleChange = useCallback((v: number) => {
    setDraftNorm(v);
    const real = snap(min + v * span);
    lastValRef.current = real;
    onDrag(real);
  }, [min, span, snap, onDrag]);

  const handleRelease = useCallback(() => {
    onCommit(lastValRef.current);
    setDraftNorm(null);
  }, [onCommit]);

  const display = snap(draftNorm !== null ? min + draftNorm * span : value);
  const isInt = Number.isInteger(display);

  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 11 }}>
          {isInt ? display : display.toFixed(2)}{suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
      <HorizontalFader
        value={norm}
        onChange={handleChange}
        onRelease={handleRelease}
        trackStyle={{ height: 22, backgroundColor: C.surfaceContainerHigh, borderRadius: 11 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 11 }}
      />
      {hint ? <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 4 }}>{hint}</Text> : null}
    </View>
  );
}

function GainRow({ label, paramKey, value }: { label: string; paramKey: string; value: number }) {
  const [gMin, gMax] = useParamRange(paramKey, [0, 2]);
  const span = Math.max(0.0001, gMax - gMin);
  const [draft, setDraft] = useState<number | null>(null);
  const showVal = draft !== null ? draft : value;
  const norm = (showVal - gMin) / span;
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 11 }}>{showVal.toFixed(2)}×</Text>
      </View>
      <HorizontalFader
        value={Math.max(0, Math.min(1, norm))}
        onChange={(v: number) => setDraft(gMin + v * span)}
        onRelease={() => { if (draft !== null) { updateParamCenter({ [paramKey]: draft }); setDraft(null); } }}
        trackStyle={{ height: 18, backgroundColor: C.surfaceContainerHigh, borderRadius: 9 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 9 }}
      />
    </View>
  );
}

// `value` here is the already-post-gain live value (gain is applied at
// the source in audio_analyzer.js / osc_listener.js before the value
// reaches CPC — see docs/29). We do NOT multiply by `gain` again or we
// would double-gain the meter; this is the same value the patterns see.
// `gain` is still rendered in the label so the operator can confirm the
// current setting while tuning the GainRow below.
function BandMeter({ label, value, gain, accent = C.primary }: { label: string; value: number; gain: number; accent?: string }) {
  const effective = Math.max(0, Math.min(1, value));
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>
          {(effective * 100).toFixed(0)}%  ·  gain {gain.toFixed(2)}×
        </Text>
      </View>
      <View style={{
        height: 12, borderRadius: 6,
        backgroundColor: C.surfaceContainerHigh,
        borderWidth: 1, borderColor: C.ghostBorder, overflow: 'hidden',
      }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${effective * 100}%`, backgroundColor: accent }} />
      </View>
    </View>
  );
}

// ── Master toggle (large pill, used at top of the page) ─────────────────

function MasterToggle({ on, busy, onPress, label, subtitle, accent = ACCENT_AUTO }: {
  on: boolean; busy?: boolean; onPress: () => void; label: string; subtitle?: string; accent?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12,
        backgroundColor: on ? accent : C.surfaceContainerHigh,
        borderWidth: 1, borderColor: on ? accent : C.ghostBorder,
        opacity: busy ? 0.7 : 1,
      }}
    >
      <View style={{
        width: 22, height: 22, borderRadius: 11,
        backgroundColor: on ? '#000' : C.surface,
        borderWidth: 2, borderColor: on ? '#000' : C.ghostBorder,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: on ? '#000' : C.text, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: on ? '#000' : C.secondary, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={on ? '#000' : C.primary} /> : null}
    </TouchableOpacity>
  );
}

// ── Mic picker ──────────────────────────────────────────────────────────

function MicPickerRow({ device, isCurrent, onPress, busy }: {
  device: AudioDevice; isCurrent: boolean; onPress: () => void; busy?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginTop: 6,
        backgroundColor: isCurrent ? 'rgba(0, 99, 155, 0.08)' : C.surfaceContainerLowest,
        borderWidth: isCurrent ? 2 : 1,
        borderColor: isCurrent ? C.primary : C.ghostBorder,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <View style={{
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: isCurrent ? '#34C759' : C.surfaceContainerHigh,
        borderWidth: 1, borderColor: isCurrent ? '#34C759' : C.ghostBorder,
      }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.text }}>
          {device.label}
          {device.isDefault ? <Text style={{ color: C.secondary, fontSize: 10 }}>  (default)</Text> : null}
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 1 }}>
          {device.inputFormat} · {device.ffmpegDevice}
        </Text>
      </View>
      {isCurrent ? (
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.8 }}>
          ACTIVE
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Pinned live meters strip ─────────────────────────────────────────────
//
// Compact horizontal strip rendered as a SIBLING of the AUDIO tab's
// ScrollView, so it stays anchored at the top regardless of scroll
// position (the load-bearing UX win: operator can keep eyes on the
// meters while tuning sliders further down).
//
// Subscribes to ONLY the live audio keys + status hooks — never reads
// steady params or the AudioConfig blob — so the surrounding body's
// re-render path is fully decoupled from analyser ticks. See
// useLiveParamValues per-key short-circuit in hooks/useEngineState.ts.
//
// Layout: ~88 px total height.
//   Top row  : MIC / OSC / SYNC status pills (left-aligned).
//   Main row : LEFT half = 4 MIC bars (LOW / MID / HIGH / KICK)
//              RIGHT half = 3 STEMS bars (VOCALS / BASS / DRUMS) + BPM pill.

function MeterBar({ label, value, accent = ACCENT_AUTO }: {
  label: string; value: number; accent?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ flex: 1, marginHorizontal: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: C.secondary, textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}>{label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12,
          color: C.text,
        }}>{v.toFixed(2)}</Text>
      </View>
      <View style={{
        height: 18, borderRadius: 9,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        overflow: 'hidden',
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${v * 100}%`, backgroundColor: accent,
        }} />
      </View>
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'on' | 'off' | 'warn' }) {
  const palette =
    tone === 'on'   ? { bg: ACCENT_AUTO,            fg: '#000',        border: ACCENT_AUTO } :
    tone === 'warn' ? { bg: '#f8d7da',              fg: '#842029',     border: C.error } :
                      { bg: C.surfaceContainerHigh, fg: C.secondary,   border: C.ghostBorder };
  return (
    <View style={{
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
      backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
      marginRight: 8,
    }}>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: palette.fg, textTransform: 'uppercase', letterSpacing: 0.8,
      }}>{label}</Text>
    </View>
  );
}

function PinnedAudioMeters({
  audioStatus, oscStatus,
}: {
  audioStatus: AudioStatus | null;
  oscStatus: OscPillState | null;
}) {
  // Per-key live subscription. Only the four mic keys + three stem
  // keys + tempoBpm participate in the equality check, so this strip
  // re-renders only when one of THESE values actually ticks. The body
  // below never re-renders on liveParams.
  const live = useLiveParamValues({
    micLow: 0, micMid: 0, micHigh: 0, micKick: 0,
    stemsBass: 0, stemsDrums: 0, stemsVocals: 0,
    tempoBpm: 0,
  } as Record<string, number>) as Record<string, number>;
  // Pull bpmSpeedSync from steady params for the SYNC pill — cheap;
  // changes only when operator toggles it.
  const steady = useSharedParamValues({ bpmSpeedSync: 0 }) as Record<string, number>;

  const micOn       = audioStatus?.enabled === true;
  const micPhase    = audioStatus?.phase ?? (micOn ? 'unknown' : 'off');
  const micTone: 'on' | 'off' | 'warn' =
    !micOn                      ? 'off'  :
    micPhase === 'error'        ? 'warn' :
    micPhase === 'restarting'   ? 'warn' :
                                  'on';
  const oscState  = oscStatus?.state ?? null;
  const oscTone: 'on' | 'off' | 'warn' =
    oscState === 'live'     ? 'on'   :
    oscState === 'unmapped' ? 'warn' :
                              'off';
  const oscLabel  = oscState ? `OSC ${oscState.toUpperCase()}` : 'OSC …';
  const syncOn    = (steady.bpmSpeedSync ?? 0) >= 0.5;
  const syncTone: 'on' | 'off' | 'warn' =
    syncOn && oscState !== 'live' ? 'warn' :
    syncOn                        ? 'on'   :
                                    'off';
  const bpm = live.tempoBpm > 0 ? Math.round(live.tempoBpm) : null;

  return (
    <View style={{
      alignSelf: 'stretch',
      paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16,
      backgroundColor: C.surfaceContainerHigh,
      borderBottomWidth: 1, borderBottomColor: C.ghostBorder,
      ...globalStyles.ambientShadow,
      zIndex: 10,
    }}>
      {/* Status pills row — full width, left aligned */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <StatusPill label={micOn ? `MIC ${micPhase.toUpperCase()}` : 'MIC OFF'} tone={micTone} />
        <StatusPill label={oscLabel} tone={oscTone} />
        <StatusPill label={syncOn ? 'BPM SYNC ON' : 'BPM SYNC OFF'} tone={syncTone} />
      </View>
      {/* Meters row — two equal halves split by a vertical divider */}
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {/* LEFT half: MIC bands */}
        <View style={{ flex: 1, paddingRight: 16 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
            color: C.secondary, textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 8,
          }}>MIC</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <MeterBar label="LOW"  value={live.micLow}  accent={ACCENT_AUTO} />
            <MeterBar label="MID"  value={live.micMid}  accent={ACCENT_AUTO} />
            <MeterBar label="HIGH" value={live.micHigh} accent={ACCENT_AUTO} />
            <MeterBar label="KICK" value={live.micKick} accent={C.error} />
          </View>
        </View>
        {/* Vertical divider */}
        <View style={{ width: 1, backgroundColor: C.ghostBorder, marginHorizontal: 0 }} />
        {/* RIGHT half: stems + BPM */}
        <View style={{ flex: 1, paddingLeft: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
              color: C.secondary, textTransform: 'uppercase',
              letterSpacing: 1,
            }}>STEMS</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <MeterBar label="VOCALS" value={live.stemsVocals} accent={C.primary} />
            <MeterBar label="BASS"   value={live.stemsBass}   accent={C.primary} />
            <MeterBar label="DRUMS"  value={live.stemsDrums}  accent={C.primary} />
            {/* BPM pill — biggest single number on the strip */}
            <View style={{
              marginLeft: 12, paddingHorizontal: 12, paddingVertical: 4,
              borderRadius: 10,
              backgroundColor: bpm ? C.primaryContainer : C.surfaceContainerLowest,
              borderWidth: 1, borderColor: bpm ? C.primary : C.ghostBorder,
              minWidth: 72, alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, letterSpacing: 0.8 }}>
                BPM
              </Text>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, color: bpm ? '#003a44' : C.icon, marginTop: 2 }}>
                {bpm ?? '—'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── BPM live read-outs ───────────────────────────────────────────────────
//
// Tiny live-only siblings of the BPM-sync MasterToggle. Pulled out so
// the surrounding card (which renders steady-state sliders + the
// toggle) never re-renders just because tempoBpm ticked.

function BpmStaleWarning({ bpmSyncOn, oscMissing, oscState }: {
  bpmSyncOn: boolean; oscMissing: boolean; oscState: string | null;
}) {
  // Steady-only render path when SYNC is OFF (nothing to warn about).
  const live = useLiveParamValues({ tempoBpm: 0 } as Record<string, number>) as Record<string, number>;
  if (!bpmSyncOn) return null;
  const bpmStale = !live.tempoBpm || live.tempoBpm <= 0;
  if (!oscMissing && !bpmStale) return null;
  return (
    <View style={{
      borderRadius: 8, borderWidth: 1, borderColor: C.error,
      padding: 10, marginBottom: 12,
      backgroundColor: 'rgba(255,80,80,0.08)',
    }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 2 }}>
        ⚠ NO BPM SIGNAL
      </Text>
      <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 11 }}>
        {oscMissing
          ? `OSC listener is ${oscState ?? 'unknown'}; nothing is feeding /lx/tempo/bpm. Speed will not move.`
          : 'OSC is live but no tempoBpm has arrived yet. Confirm LX Studio is sending /lx/tempo/bpm.'}
      </Text>
    </View>
  );
}

function BpmTempoLine() {
  const live = useLiveParamValues({ tempoBpm: 0 } as Record<string, number>) as Record<string, number>;
  const steady = useSharedParamValues({ bpmSpeedMin: 60, bpmSpeedMax: 180 } as Record<string, number>) as Record<string, number>;
  const bpm = live.tempoBpm;
  const mapped = useMemo(() => {
    if (!steady.bpmSpeedMin || !steady.bpmSpeedMax || steady.bpmSpeedMin === steady.bpmSpeedMax || !bpm) return null;
    return Math.max(0, Math.min(1, (bpm - steady.bpmSpeedMin) / (steady.bpmSpeedMax - steady.bpmSpeedMin)));
  }, [bpm, steady.bpmSpeedMin, steady.bpmSpeedMax]);
  return (
    <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 8 }}>
      {bpm > 0
        ? `tempo ${Math.round(bpm)} BPM${mapped !== null ? ` → speed ${mapped.toFixed(2)}` : ''}`
        : 'No tempo signal yet.'}
    </Text>
  );
}

// ── Stems live card ──────────────────────────────────────────────────────
//
// Owns the OSC-driven stems meters + per-stem gain sub-card. Subscribes
// to ONLY {stemsBass, stemsDrums, stemsVocals} live keys + the matching
// gain steady keys, so this card re-renders independently of the rest
// of the page (mic meters, tuning sliders, mic picker).

function StemsLiveCard() {
  const live = useLiveParamValues({
    stemsBass: 0, stemsDrums: 0, stemsVocals: 0,
  } as Record<string, number>) as Record<string, number>;
  const steady = useSharedParamValues({
    stemsVocalsGain: 1, stemsBassGain: 1, stemsDrumsGain: 1,
  } as Record<string, number>) as Record<string, number>;
  return (
    <View style={CARD}>
      <SectionHeader
        icon="dot.radiowaves.left.and.right"
        title="STEMS — LIVE (OSC)"
        hint="Vocals / Bass / Drums streamed from the external analyser. Independent of mic toggle."
      />
      <BandMeter label="VOCALS" value={live.stemsVocals ?? 0} gain={steady.stemsVocalsGain ?? 1} accent={C.primary} />
      <BandMeter label="BASS"   value={live.stemsBass   ?? 0} gain={steady.stemsBassGain   ?? 1} accent={C.primary} />
      <BandMeter label="DRUMS"  value={live.stemsDrums  ?? 0} gain={steady.stemsDrumsGain  ?? 1} accent={C.primary} />
      <View style={SUB_CARD}>
        <SubHeader title="PER-STEM GAIN" />
        <GainRow label="VOCALS" paramKey="stemsVocalsGain" value={steady.stemsVocalsGain ?? 1} />
        <GainRow label="BASS"   paramKey="stemsBassGain"   value={steady.stemsBassGain   ?? 1} />
        <GainRow label="DRUMS"  paramKey="stemsDrumsGain"  value={steady.stemsDrumsGain  ?? 1} />
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 6 }}>
          The deck&apos;s master REACT slider multiplies all of these.
        </Text>
      </View>
    </View>
  );
}

// ── Mic live card ────────────────────────────────────────────────────────
//
// Owns the mic-band + kick meters, the "last kick" hint, and the
// PER-BAND GAIN sub-card. Subscribes to ONLY {micLow, micMid, micHigh,
// micKick} live keys + the four micGain steady keys.
//
// audioStatus is passed in (instead of read via useAudioStatus here) so
// we share the parent's subscription — no need to open a second slice
// listener for the same audioStatus object.

function MicLiveCard({ audioStatus }: { audioStatus: AudioStatus | null }) {
  const live = useLiveParamValues({
    micLow: 0, micMid: 0, micHigh: 0, micKick: 0,
  } as Record<string, number>) as Record<string, number>;
  const steady = useSharedParamValues({
    micLowGain: 1, micMidGain: 1, micHighGain: 1, micKickGain: 1,
  } as Record<string, number>) as Record<string, number>;
  // "Last kick" is wall-clock dependent — recompute on each render.
  // The card already re-renders at the live tick rate, so this is free.
  const lastKickAgo = audioStatus?.lastKickMs ? Math.max(0, Date.now() - audioStatus.lastKickMs) : null;
  return (
    <>
      <BandMeter label="LOW"  value={live.micLow}  gain={steady.micLowGain  ?? 1} accent={ACCENT_AUTO} />
      <BandMeter label="MID"  value={live.micMid}  gain={steady.micMidGain  ?? 1} accent={ACCENT_AUTO} />
      <BandMeter label="HIGH" value={live.micHigh} gain={steady.micHighGain ?? 1} accent={ACCENT_AUTO} />
      <BandMeter label="KICK" value={live.micKick} gain={steady.micKickGain ?? 1} accent={C.error} />
      <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 2, marginBottom: 4 }}>
        {lastKickAgo === null ? 'Last kick hit: never' : `Last kick hit: ${lastKickAgo < 10_000 ? `${(lastKickAgo / 1000).toFixed(1)} s` : '>10 s'} ago`}
      </Text>

      <View style={SUB_CARD}>
        <SubHeader title="PER-BAND GAIN" />
        <GainRow label="MIC LOW"  paramKey="micLowGain"  value={steady.micLowGain  ?? 1} />
        <GainRow label="MIC MID"  paramKey="micMidGain"  value={steady.micMidGain  ?? 1} />
        <GainRow label="MIC HIGH" paramKey="micHighGain" value={steady.micHighGain ?? 1} />
        <GainRow label="MIC KICK" paramKey="micKickGain" value={steady.micKickGain ?? 1} />
      </View>
    </>
  );
}

// ── Signal diagnostics (raw vs post + shared-time trails) ──────────────
//
// Operator brief 2026-05-26 — "Add a row (only in the audio tab) to
// show the raw signals, and below that the post-processed signals,
// and then below each of those add the trails (with a common time
// frame for the trail plots)."
//
// Layout:
//   RAW : 4 mic bars + 3 stems bars  →  trail strip (one row per
//                                       signal, shared X = last N s)
//   POST: 4 mic bars + 3 stems bars  →  trail strip (same X axis)
//
// Both trails share ONE viewport-wide time window so the operator can
// compare gain's effect at a glance — raw envelope vs post envelope.
// The window is operator-selectable {5, 10, 15, 30 s} and persists to
// AsyncStorage. Buffer lives in memory only.
//
// Lifecycle: the sample timer only runs while the audio tab is
// focused (useFocusEffect). With ~7×2 signals × max 90 samples × 4 B
// ≈ 5 KB of memory, the cost is dominated by the sample timer, which
// is gated to focus.
//
// Subscription scope: this component owns its own
// useLiveParamValues({raw + post keys}) — the bars re-render on every
// live tick, but the rest of the AUDIO body never reads these keys
// so it stays still. Preserves the spinner-hang perf fix
// (commit dd69649, "useLiveParamValues per-key short-circuit").

const SIGNAL_WINDOW_KEY = '@CaptainPad:audioTrailWindowS';
const WINDOW_OPTIONS_S = [5, 10, 15, 30] as const;
const DEFAULT_WINDOW_S = 10;
const TRAIL_SAMPLE_HZ = 3;             // 3 Hz visual cadence — well under the 20 Hz WS rate
const TRAIL_SAMPLE_MS = 1000 / TRAIL_SAMPLE_HZ;
const MAX_TRAIL_S = WINDOW_OPTIONS_S[WINDOW_OPTIONS_S.length - 1];
const MAX_BUFFER_LEN = MAX_TRAIL_S * TRAIL_SAMPLE_HZ;

// The 7 signal slots rendered per row. `rawKey` reads from the
// engine-published `<liveKey>Raw` mirror; `postKey` is the gained
// `<liveKey>`. Order matches the pinned strip above so the operator's
// eye-tracking stays consistent: mic L/M/H/K first, then stems V/B/D.
type SignalSlot = {
  label: string;
  rawKey: string;
  postKey: string;
  accent: string;
};

// Module-scope to keep array identity stable across renders (avoids
// useEffect / useMemo dep churn that would resize the ring buffer
// every render). Same pattern as the pinned-strip's hard-coded MIC /
// STEMS labels.
const MIC_SIGNALS = [
  { label: 'LOW',  rawKey: 'micLowRaw',  postKey: 'micLow',  accent: ACCENT_AUTO },
  { label: 'MID',  rawKey: 'micMidRaw',  postKey: 'micMid',  accent: ACCENT_AUTO },
  { label: 'HIGH', rawKey: 'micHighRaw', postKey: 'micHigh', accent: ACCENT_AUTO },
  { label: 'KICK', rawKey: 'micKickRaw', postKey: 'micKick', accent: C.error },
] as const satisfies readonly SignalSlot[];

const STEMS_SIGNALS = [
  { label: 'VOC', rawKey: 'stemsVocalsRaw', postKey: 'stemsVocals', accent: C.primary },
  { label: 'BAS', rawKey: 'stemsBassRaw',   postKey: 'stemsBass',   accent: C.primary },
  { label: 'DRM', rawKey: 'stemsDrumsRaw',  postKey: 'stemsDrums',  accent: C.primary },
] as const satisfies readonly SignalSlot[];

const ALL_SIGNALS: readonly SignalSlot[] = [...MIC_SIGNALS, ...STEMS_SIGNALS];

// Build the defaults snapshot once at module scope — useLiveParamValues
// pins keys from the FIRST call's defaults so any per-render literal
// would be wasted work and a hazard for the pinned-key set.
const DIAGNOSTICS_DEFAULTS: Record<string, number> = (() => {
  const acc: Record<string, number> = {};
  for (const s of ALL_SIGNALS) { acc[s.rawKey] = 0; acc[s.postKey] = 0; }
  return acc;
})();

// Compact bar — narrower than <BandMeter> because we render 7 of them
// across a single row. Same colour + scale conventions so raw vs post
// reads at a glance.
function DiagBar({ label, value, accent }: { label: string; value: number; accent: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ flex: 1, marginHorizontal: 3 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary,
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>{label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.text,
        }}>{v.toFixed(2)}</Text>
      </View>
      <View style={{
        height: 10, borderRadius: 5,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder, overflow: 'hidden',
      }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
                       width: `${v * 100}%`, backgroundColor: accent }} />
      </View>
    </View>
  );
}

// Per-row sparkline rendered as <View> bars — no SVG dependency
// (operator constraint: do NOT add react-native-svg). Each bar is one
// sampled value scaled to row height. Older samples LEFT, newest
// RIGHT. We always render MAX_BUFFER_LEN bar slots so layout stays
// stable across window changes; only the last `bufferLen` slots are
// filled (window picker controls how many we draw).
const TRAIL_ROW_HEIGHT = 22;

function TrailRow({ label, samples, bufferLen, accent }: {
  label: string; samples: readonly number[]; bufferLen: number; accent: string;
}) {
  // Last `bufferLen` samples, padded LEFT with empty so the newest
  // sample always sits at the right edge regardless of how full the
  // ring is. This is what makes the time axis read left-to-right with
  // "now" anchored at the right edge.
  const padded: (number | null)[] = useMemo(() => {
    const out: (number | null)[] = new Array(bufferLen).fill(null);
    const take = Math.min(samples.length, bufferLen);
    for (let i = 0; i < take; i++) {
      out[bufferLen - take + i] = samples[samples.length - take + i];
    }
    return out;
  }, [samples, bufferLen]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
      <Text style={{
        width: 36, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
        color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.4,
      }}>{label}</Text>
      <View style={{
        flex: 1, flexDirection: 'row', alignItems: 'flex-end',
        height: TRAIL_ROW_HEIGHT, backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder, borderRadius: 3,
        paddingHorizontal: 1, paddingVertical: 1, overflow: 'hidden',
      }}>
        {padded.map((s, idx) => {
          const filled = s !== null;
          const h = filled ? Math.max(1, (s as number) * (TRAIL_ROW_HEIGHT - 2)) : 0;
          return (
            <View key={idx} style={{
              flex: 1, marginHorizontal: 0.5,
              height: h, backgroundColor: filled ? accent : 'transparent',
            }} />
          );
        })}
      </View>
    </View>
  );
}

function WindowPicker({ value, onChange }: {
  value: number; onChange: (s: number) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {WINDOW_OPTIONS_S.map(s => {
        const active = s === value;
        return (
          <TouchableOpacity
            key={s}
            onPress={() => onChange(s)}
            style={{
              paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
              backgroundColor: active ? C.primary : C.surfaceContainerLowest,
              borderWidth: 1, borderColor: active ? C.primary : C.ghostBorder,
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
              color: active ? '#fff' : C.secondary, letterSpacing: 0.6,
            }}>{s}s</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SignalDiagnostics() {
  // Live subscription — per-key short-circuit means this re-renders
  // only when one of the 14 listed keys actually ticks. Module-scope
  // `DIAGNOSTICS_DEFAULTS` keeps the key set pinned across renders.
  const live = useLiveParamValues(DIAGNOSTICS_DEFAULTS) as Record<string, number>;

  // Operator-tunable trail window — persisted across launches.
  const [windowS, setWindowS] = useState<number>(DEFAULT_WINDOW_S);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SIGNAL_WINDOW_KEY).then(raw => {
      if (!alive || !raw) return;
      const parsed = parseInt(raw, 10);
      if (WINDOW_OPTIONS_S.includes(parsed as typeof WINDOW_OPTIONS_S[number])) {
        setWindowS(parsed);
      }
    }).catch(() => { /* benign — first launch, AsyncStorage cold */ });
    return () => { alive = false; };
  }, []);
  const setWindow = useCallback((s: number) => {
    setWindowS(s);
    AsyncStorage.setItem(SIGNAL_WINDOW_KEY, String(s))
      .catch(() => { /* benign — persistence is best-effort */ });
  }, []);

  // Ring buffer state — one number[] per (slot, raw|post) pair. Using
  // useState with array IDENTITY changes so <TrailRow>'s useMemo
  // recomputes the padded view. The buffer is bounded at MAX_BUFFER_LEN
  // regardless of selected window (we always keep enough for the
  // largest window, then slice the tail for rendering).
  const [trails, setTrails] = useState<{ raw: number[][]; post: number[][] }>(() => ({
    raw:  ALL_SIGNALS.map(() => []),
    post: ALL_SIGNALS.map(() => []),
  }));

  // Always read the latest live values from a ref so the sample timer
  // callback (started once per focus) doesn't need `live` in its deps.
  // The component re-renders on every live tick, which updates the
  // ref; the timer pulls from the ref at TRAIL_SAMPLE_HZ.
  const liveRef = useRef(live);
  liveRef.current = live;

  // Sample timer — runs ONLY while the audio tab is focused. Pushes
  // one frame into every ring buffer at TRAIL_SAMPLE_HZ. Tab blur
  // clears the timer so we don't burn cycles on background tabs.
  useFocusEffect(useCallback(() => {
    const interval = setInterval(() => {
      const snap = liveRef.current;
      setTrails(prev => {
        const nextRaw  = prev.raw.map((buf, i) => {
          const v = snap[ALL_SIGNALS[i].rawKey] ?? 0;
          const out = buf.length >= MAX_BUFFER_LEN ? buf.slice(buf.length - MAX_BUFFER_LEN + 1) : buf.slice();
          out.push(v);
          return out;
        });
        const nextPost = prev.post.map((buf, i) => {
          const v = snap[ALL_SIGNALS[i].postKey] ?? 0;
          const out = buf.length >= MAX_BUFFER_LEN ? buf.slice(buf.length - MAX_BUFFER_LEN + 1) : buf.slice();
          out.push(v);
          return out;
        });
        return { raw: nextRaw, post: nextPost };
      });
    }, TRAIL_SAMPLE_MS);
    return () => clearInterval(interval);
  }, []));

  const bufferLen = windowS * TRAIL_SAMPLE_HZ;

  return (
    <View style={CARD}>
      <SectionHeader
        icon="waveform.path.ecg.rectangle"
        title="SIGNAL DIAGNOSTICS"
        hint="Raw (pre-gain) vs post (gained) for every audio signal, with a shared-time trail."
        right={<WindowPicker value={windowS} onChange={setWindow} />}
      />

      {/* ── RAW row ───────────────────────────────────────────────── */}
      <SubHeader title="RAW (PRE-GAIN)" />
      <View style={{ flexDirection: 'row', marginBottom: 8 }}>
        <View style={{ flex: 4, flexDirection: 'row', alignItems: 'flex-end' }}>
          {MIC_SIGNALS.map(s => (
            <DiagBar key={s.rawKey} label={s.label}
                     value={live[s.rawKey] ?? 0} accent={s.accent} />
          ))}
        </View>
        <View style={{ width: 1, backgroundColor: C.ghostBorder, marginHorizontal: 8 }} />
        <View style={{ flex: 3, flexDirection: 'row', alignItems: 'flex-end' }}>
          {STEMS_SIGNALS.map(s => (
            <DiagBar key={s.rawKey} label={s.label}
                     value={live[s.rawKey] ?? 0} accent={s.accent} />
          ))}
        </View>
      </View>
      <View style={{ marginBottom: 12 }}>
        {ALL_SIGNALS.map((s, i) => (
          <TrailRow key={`raw-${s.rawKey}`} label={s.label}
                    samples={trails.raw[i]} bufferLen={bufferLen}
                    accent={s.accent} />
        ))}
      </View>

      {/* ── POST row ──────────────────────────────────────────────── */}
      <SubHeader title="POST (GAINED)" />
      <View style={{ flexDirection: 'row', marginBottom: 8 }}>
        <View style={{ flex: 4, flexDirection: 'row', alignItems: 'flex-end' }}>
          {MIC_SIGNALS.map(s => (
            <DiagBar key={s.postKey} label={s.label}
                     value={live[s.postKey] ?? 0} accent={s.accent} />
          ))}
        </View>
        <View style={{ width: 1, backgroundColor: C.ghostBorder, marginHorizontal: 8 }} />
        <View style={{ flex: 3, flexDirection: 'row', alignItems: 'flex-end' }}>
          {STEMS_SIGNALS.map(s => (
            <DiagBar key={s.postKey} label={s.label}
                     value={live[s.postKey] ?? 0} accent={s.accent} />
          ))}
        </View>
      </View>
      <View>
        {ALL_SIGNALS.map((s, i) => (
          <TrailRow key={`post-${s.postKey}`} label={s.label}
                    samples={trails.post[i]} bufferLen={bufferLen}
                    accent={s.accent} />
        ))}
      </View>

      <Text style={{
        fontFamily: 'Inter_400Regular', fontSize: 10,
        color: C.icon, marginTop: 8,
      }}>
        Both trails share the same {windowS}s window — compare raw envelope vs gained envelope at a glance.
      </Text>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────

// ── Mount strategy ────────────────────────────────────────────────────────
//
// The outer screen owns ONLY the static config HTTP load + the cheap
// control-plane status pills. It deliberately does NOT subscribe to
// `useLiveParamValues` / `useSharedParamValues` — those fire
// `_ensureInitialized()` which opens /ws/signals + /ws/params, and
// /ws/signals starts streaming liveParams at 20 Hz immediately on
// connect. If those hooks ran at mount, the resulting JSON.parse +
// listener fan-out work would queue behind the `await fetchAudioConfig`
// microtask on the iPad's single JS thread — which is the bug that
// made the spinner sit for 30 s when 1+ mixer channels were active.
//
// Once `cfg` is non-null, we mount <AudioConfigLoaded> which IS allowed
// to subscribe to the live hooks. By that point the HTTP fetch has
// already returned and the first paint of the static config is on
// screen, so the operator never sees the spinner stick.

export default function AudioAnalysisScreen() {
  const status = useAudioStatus();
  const oscStatus = useOscStatus();
  const [cfg, setCfg] = useState<AudioConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    await getApiBaseAsync();
    const r = await fetchAudioConfig();
    if (r.ok) { setCfg(r.data as AudioConfig); setLoadError(null); }
    else { setLoadError(r.error || 'unknown error'); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (loadError) {
    return (
      <View style={globalStyles.container}>
        <ScrollView contentContainerStyle={{ padding: 48 }} style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, marginBottom: 8 }}>
            AUDIO CONFIG UNAVAILABLE
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text }}>{loadError}</Text>
          <TouchableOpacity onPress={reload} style={{ marginTop: 16, padding: 12, backgroundColor: C.primary, borderRadius: 8, alignSelf: 'flex-start' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#fff' }}>RETRY</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
  if (!cfg) {
    return (
      <View style={globalStyles.container}>
        <ScrollView contentContainerStyle={{ padding: 48, alignItems: 'center' }} style={{ flex: 1 }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, marginTop: 16 }}>Loading audio config…</Text>
        </ScrollView>
      </View>
    );
  }

  return <AudioConfigBody cfg={cfg} setCfg={setCfg} status={status} oscStatus={oscStatus} reload={reload} />;
}

// ── Loaded body ────────────────────────────────────────────────────────────
//
// Mounted ONLY when cfg is non-null. This is where the live-data hooks
// (useLiveParamValues / useSharedParamValues) live — and therefore the
// only place where /ws/signals + /ws/params subscriptions get opened.
// By the time React mounts this component, the parent has already
// painted the static config once, so the operator never sees a stuck
// spinner even if /ws/signals is firehose-streaming behind us.

function AudioConfigBody({
  cfg, setCfg, status, oscStatus, reload,
}: {
  cfg: AudioConfig;
  setCfg: React.Dispatch<React.SetStateAction<AudioConfig | null>>;
  status: ReturnType<typeof useAudioStatus>;
  oscStatus: ReturnType<typeof useOscStatus>;
  reload: () => Promise<void>;
}) {
  const [patchError, setPatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Steady (operator-tuned, persistent) params — sliders, sync
  // toggles, gain knobs. These are quiet by default; only redrawn
  // when the operator turns a knob.
  //
  // NB: this body deliberately does NOT subscribe to `useLiveParamValues`.
  // Live high-rate keys (micLow/Mid/High/Kick, stems*, tempoBpm) re-render
  // at 15-30 Hz; folding them in here re-rendered the ENTIRE config
  // body — every FaderRow, mic picker, BPM range slider — at that
  // cadence. Live meters now live in their own components
  // (<PinnedAudioMeters />, <StemsLiveCard />, <MicLiveCard />,
  // <BpmTempoLine />) which each subscribe to ONLY the live keys they
  // need. See useLiveParamValues per-key short-circuit in
  // hooks/useEngineState.ts.
  const sp = useSharedParamValues({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 180, speed: 0,
    micLowGain: 1, micMidGain: 1, micHighGain: 1, micKickGain: 1,
    stemsVocalsGain: 1, stemsBassGain: 1, stemsDrumsGain: 1,
  } as Record<string, number>) as Record<string, number>;

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    const r = await fetchAudioDevices();
    if (r.ok) setDevices(r.data?.devices || []);
    else setDevicesError(r.error || 'failed to list mics');
    setDevicesLoading(false);
  }, []);

  // Optimistic local-only update while dragging.
  const updateLocal = useCallback((group: 'bands' | 'kick', field: string, value: number) => {
    setCfg(prev => prev && ({ ...prev, [group]: { ...prev[group], [field]: value } } as AudioConfig));
  }, []);

  // PATCH on slider release — one network hit per gesture, not per drag tick.
  const commitField = useCallback(async (group: 'bands' | 'kick', field: string, value: number) => {
    const r = await patchAudioConfig({ [group]: { [field]: value } });
    if (!r.ok) { setPatchError(r.error || 'patch failed'); reload(); }
    else setPatchError(null);
  }, [reload]);

  // Master enable/disable. Restarts ffmpeg capture under the hood.
  const toggleEnabled = useCallback(async () => {
    if (!cfg) return;
    const target = !cfg.enabled;
    setBusy('enable');
    setCfg(prev => prev && ({ ...prev, enabled: target }));
    const r = await patchAudioConfig({ enabled: target });
    setBusy(null);
    if (!r.ok) { setPatchError(r.error || 'failed to toggle'); reload(); }
    else { setPatchError(null); reload(); }
  }, [cfg, reload]);

  // Mic picker: swap device on the server. Engine stops ffmpeg cleanly
  // and respawns on the new input.
  const selectDevice = useCallback(async (d: AudioDevice) => {
    setBusy(`mic:${d.id}`);
    const r = await patchAudioConfig({
      capture: {
        device:      d.ffmpegDevice,
        deviceLabel: d.label,
        deviceId:    d.id,
        inputFormat: d.inputFormat,
        platform:    d.platform,
      },
    });
    setBusy(null);
    if (!r.ok) { setPatchError(r.error || 'failed to switch mic'); }
    else { setPatchError(null); setPickerOpen(false); reload(); }
  }, [reload]);

  // ── Derived ────────────────────────────────────────────────────────
  const enabled  = cfg?.enabled ?? false;
  const phase    = status?.phase ?? (enabled ? 'unknown' : 'off');
  const phaseColor =
    phase === 'running'    ? ACCENT_AUTO :
    phase === 'starting'   ? C.primary :
    phase === 'restarting' ? C.error :
    phase === 'error'      ? C.error :
    C.icon;

  const bpmSyncOn  = (sp.bpmSpeedSync ?? 0) >= 0.5;
  const oscState   = oscStatus?.state ?? null;
  const oscMissing = bpmSyncOn && oscState !== 'live';

  // ── Render ─────────────────────────────────────────────────────────
  //
  // NB: globalStyles.container is `flexDirection: 'row'` (used by other
  // tabs to layout sidebars). For AUDIO we want the pinned strip
  // STACKED ABOVE the scrolling body, full viewport width, so the
  // outer wrapper here is an explicit COLUMN. The strip sits at the
  // top edge as its own "rig" piece; the page title + cards scroll
  // below it.
  return (
    <View style={{ flex: 1, flexDirection: 'column', backgroundColor: C.background }}>
      {/* Pinned live meters strip — sibling of the ScrollView so it
          stays anchored at the top regardless of scroll position.
          Mounted only after cfg loads (we're already inside that
          gate). All live-data subscriptions live INSIDE this
          component — the body below never reads liveParams. */}
      <PinnedAudioMeters audioStatus={status} oscStatus={oscStatus} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 32, paddingBottom: 80 }}
      >
        {/* ── Page title ────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <IconSymbol name="waveform" size={32} color={C.primary} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, color: C.text, letterSpacing: 1.5 }}>
              AUDIO
            </Text>
          </View>
          <TouchableOpacity
            onPress={async () => {
              const r = await resetAudioConfig();
              if (!r.ok) setPatchError(r.error || 'reset failed');
              else { setPatchError(null); reload(); }
            }}
            style={{
              paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
              borderWidth: 1, borderColor: C.ghostBorder,
              backgroundColor: C.surfaceContainerLowest,
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Reset to defaults
            </Text>
          </TouchableOpacity>
        </View>

        {patchError ? (
          <View style={{ ...CARD, borderColor: C.error, backgroundColor: 'rgba(186, 26, 26, 0.06)' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>REQUEST REJECTED</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>{patchError}</Text>
          </View>
        ) : null}

        {/* ── SIGNAL DIAGNOSTICS (raw vs post + shared-time trail) ──────
            Lives above the tuning cards so the operator's eye lands on
            "what is the rig actually seeing right now?" before any
            knob adjustments. Owns its own live subscription so the
            tuning sliders below stay decoupled from analyser ticks. */}
        <SignalDiagnostics />

        {/* ── 1. MASTER ENABLE / DISABLE ────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="power"
            title="MIC ANALYSIS"
            hint="Enable the on-device microphone listener (FFT → bands + kick → CPC)."
          />
          <MasterToggle
            on={enabled}
            busy={busy === 'enable'}
            onPress={toggleEnabled}
            label={enabled ? '● LISTENING' : 'DISABLED'}
            subtitle={enabled
              ? `${phase.toUpperCase()} · ${status?.captureFps ?? 0} fps · ${cfg.capture.sampleRate} Hz`
              : 'Tap to start listening. Sliders below are read-only until enabled.'}
            accent={enabled ? phaseColor : ACCENT_AUTO}
          />
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 12 }}>
            This toggle only affects the mic listener. Stems (Vocals/Bass/Drums) are streamed
            independently over OSC and stay active when this is off.
          </Text>
        </View>

        {/* ── 2. BPM → SPEED SYNC ───────────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="metronome"
            title="BPM → SPEED SYNC"
            hint="Drive the global SPEED param from live tempo (OSC /lx/tempo/bpm)."
          />
          <BpmStaleWarning bpmSyncOn={bpmSyncOn} oscMissing={oscMissing} oscState={oscState} />
          <MasterToggle
            on={bpmSyncOn}
            onPress={() => updateParamCenter({ bpmSpeedSync: bpmSyncOn ? 0 : 1 })}
            label={bpmSyncOn ? '● SYNC ON · SPEED DRIVEN BY BPM' : 'SYNC OFF · SPEED MANUAL'}
            subtitle={bpmSyncOn ? 'Live tempo / mapped speed shown below.' : 'Tap to drive SPEED from live BPM.'}
          />
          {/* Live tempo + mapped speed read-out. Subscribes ONLY to
              tempoBpm + bpmSpeedMin/Max so the rest of the BPM card
              stays still while it ticks. */}
          {bpmSyncOn ? <BpmTempoLine /> : null}
          <View style={SUB_CARD}>
            <SubHeader title={`BPM MAPPING (${BPM_MIN_ABS}–${BPM_MAX_ABS} BPM)`} />
            {/* Min slider caps at (max - 1); max slider floors at (min + 1).
               Hard absolute bounds [60, 180] mirror the param_center
               registry. Operator picks the working window inside that. */}
            <FaderRow
              label="BPM min"
              min={BPM_MIN_ABS}
              max={Math.max(BPM_MIN_ABS + 1, (sp.bpmSpeedMax ?? BPM_MAX_ABS) - 1)}
              value={Math.max(BPM_MIN_ABS, Math.min(BPM_MAX_ABS, sp.bpmSpeedMin ?? BPM_MIN_ABS))}
              step={1}
              onDrag={() => { /* commit on release */ }}
              onCommit={(v) => updateParamCenter({ bpmSpeedMin: Math.max(BPM_MIN_ABS, Math.min(v, (sp.bpmSpeedMax ?? BPM_MAX_ABS) - 1)) })}
              hint={`BPM value that maps to speed = 0. Hard floor ${BPM_MIN_ABS}; must stay below BPM max.`}
            />
            <FaderRow
              label="BPM max"
              min={Math.min(BPM_MAX_ABS - 1, (sp.bpmSpeedMin ?? BPM_MIN_ABS) + 1)}
              max={BPM_MAX_ABS}
              value={Math.max(BPM_MIN_ABS, Math.min(BPM_MAX_ABS, sp.bpmSpeedMax ?? BPM_MAX_ABS))}
              step={1}
              onDrag={() => { /* commit on release */ }}
              onCommit={(v) => updateParamCenter({ bpmSpeedMax: Math.min(BPM_MAX_ABS, Math.max(v, (sp.bpmSpeedMin ?? BPM_MIN_ABS) + 1)) })}
              hint={`BPM value that maps to speed = 1. Hard ceiling ${BPM_MAX_ABS}; must stay above BPM min.`}
            />
          </View>
        </View>

        {/* ── 3. MICROPHONE ─────────────────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="mic"
            title="MICROPHONE"
            hint="Select which mic on the engine machine to listen to."
            right={
              <TouchableOpacity
                onPress={() => { setPickerOpen(o => !o); if (!devices && !pickerOpen) loadDevices(); }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: pickerOpen ? C.primary : C.surfaceContainerLowest,
                  borderWidth: 1, borderColor: pickerOpen ? C.primary : C.ghostBorder,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: pickerOpen ? '#fff' : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {pickerOpen ? 'Close' : 'Change'}
                </Text>
              </TouchableOpacity>
            }
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: phaseColor }} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 14 }}>
              {cfg.capture.deviceLabel || cfg.capture.device || 'No device selected'}
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.secondary, fontSize: 11 }}>
              {enabled ? `· ${phase}` : '· disabled'}
            </Text>
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11 }}>
            {cfg.capture.inputFormat || '—'} · {cfg.capture.sampleRate} Hz · {cfg.capture.channels} ch · {cfg.fftSize}-pt FFT · {status?.captureFps ?? 0} fps
          </Text>
          {status?.error ? (
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 11, marginTop: 6 }}>
              {status.error}
            </Text>
          ) : null}

          {pickerOpen ? (
            <View style={SUB_CARD}>
              <SubHeader
                title={`AVAILABLE DEVICES${devices ? ` (${devices.length})` : ''}`}
                right={
                  <TouchableOpacity onPress={loadDevices} disabled={devicesLoading} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.primary, letterSpacing: 0.6 }}>
                      {devicesLoading ? 'SCANNING…' : '↻ REFRESH'}
                    </Text>
                  </TouchableOpacity>
                }
              />
              {devicesError ? (
                <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 11 }}>{devicesError}</Text>
              ) : null}
              {devicesLoading && !devices ? (
                <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={C.primary} />
                </View>
              ) : null}
              {devices && devices.length === 0 ? (
                <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 12 }}>
                  No audio devices found on the engine. Check ffmpeg + OS permissions.
                </Text>
              ) : null}
              {devices?.map((d) => (
                <MicPickerRow
                  key={d.id}
                  device={d}
                  isCurrent={
                    cfg.capture.deviceId === d.id ||
                    (cfg.capture.device === d.ffmpegDevice && cfg.capture.inputFormat === d.inputFormat)
                  }
                  onPress={() => selectDevice(d)}
                  busy={busy === `mic:${d.id}`}
                />
              ))}
            </View>
          ) : null}
        </View>

        {/* ── 4. LIVE DATA — STEMS (OSC) ───────────────────────────── */}
        {/* Live meters extracted into <StemsLiveCard /> — it owns its
            own useLiveParamValues({stemsBass, stemsDrums, stemsVocals})
            subscription so the surrounding tuning UI doesn't re-render
            at the OSC stem cadence. */}
        <StemsLiveCard />

        {/* ── 5. LIVE DATA — MIC ANALYSIS ──────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="waveform.path.ecg"
            title="MIC — LIVE ANALYSIS"
            hint="Bands + kick from the mic. Tuning sliders nested below."
          />
          {/* Live mic-band + kick meters + "last kick" hint. Subscribes
              to ONLY {micLow, micMid, micHigh, micKick} live keys; the
              surrounding tuning sliders below stay still. */}
          <MicLiveCard audioStatus={status} />

          <View style={SUB_CARD}>
            <SubHeader title="BANDS — CROSSOVERS" />
            <FaderRow
              label="Low max" suffix="Hz" min={50} max={Math.max(60, cfg.bands.midMaxHz - 50)} value={cfg.bands.lowMaxHz}
              step={5}
              onDrag={(v) => updateLocal('bands', 'lowMaxHz', v)}
              onCommit={(v) => commitField('bands', 'lowMaxHz', v)}
              hint="Upper edge of the LOW band. EDM kick + sub-bass live here."
            />
            <FaderRow
              label="Mid max" suffix="Hz" min={cfg.bands.lowMaxHz + 50} max={cfg.capture.sampleRate / 2 - 50} value={cfg.bands.midMaxHz}
              step={50}
              onDrag={(v) => updateLocal('bands', 'midMaxHz', v)}
              onCommit={(v) => commitField('bands', 'midMaxHz', v)}
              hint="Upper edge of the MID band; everything above goes to HIGH."
            />
          </View>

          <View style={SUB_CARD}>
            <SubHeader title="BANDS — ENVELOPE & GATE" />
            {/* Asymmetric attack/release envelope (VU-meter
                convention): snap up on peaks, smooth fall on
                releases. Defaults 8 ms / 180 ms are the EDM-VJ
                sweet spot — see audio_analyzer.js header. */}
            <FaderRow
              label="Attack" suffix="ms" min={1} max={50} value={cfg.bands.attackMs}
              step={1}
              onDrag={(v) => updateLocal('bands', 'attackMs', v)}
              onCommit={(v) => commitField('bands', 'attackMs', v)}
              hint="How fast a band rises on a peak. 5–20 ms feels musical."
            />
            <FaderRow
              label="Release" suffix="ms" min={20} max={800} value={cfg.bands.releaseMs}
              step={10}
              onDrag={(v) => updateLocal('bands', 'releaseMs', v)}
              onCommit={(v) => commitField('bands', 'releaseMs', v)}
              hint="How slow a band falls after a peak. 100–300 ms typical."
            />
            <FaderRow
              label="Noise gate" min={0} max={0.2} value={cfg.bands.noiseGate}
              step={0.005}
              onDrag={(v) => updateLocal('bands', 'noiseGate', v)}
              onCommit={(v) => commitField('bands', 'noiseGate', v)}
              hint="Bands below this floor read as 0. Raise if HVAC keeps meters lit."
            />
          </View>

          <View style={SUB_CARD}>
            <SubHeader title="KICK DETECTOR" />
            <FaderRow
              label="Energy min" suffix="Hz" min={20} max={Math.max(30, cfg.kick.maxHz - 10)} value={cfg.kick.minHz}
              step={5}
              onDrag={(v) => updateLocal('kick', 'minHz', v)}
              onCommit={(v) => commitField('kick', 'minHz', v)}
            />
            <FaderRow
              label="Energy max" suffix="Hz" min={cfg.kick.minHz + 10} max={400} value={cfg.kick.maxHz}
              step={5}
              onDrag={(v) => updateLocal('kick', 'maxHz', v)}
              onCommit={(v) => commitField('kick', 'maxHz', v)}
              hint="EDM kick fundamental sits 50–80 Hz; the click transient is ~100 Hz."
            />
            <FaderRow
              label="Threshold ×" min={1.05} max={4.0} value={cfg.kick.threshold}
              step={0.05}
              onDrag={(v) => updateLocal('kick', 'threshold', v)}
              onCommit={(v) => commitField('kick', 'threshold', v)}
              hint="Instant energy must be this many × running average."
            />
            <FaderRow
              label="Refractory" suffix="ms" min={0} max={1000} value={cfg.kick.refractoryMs}
              step={10}
              onDrag={(v) => updateLocal('kick', 'refractoryMs', v)}
              onCommit={(v) => commitField('kick', 'refractoryMs', v)}
              hint="Minimum gap between two kick fires."
            />
            <FaderRow
              label="Decay" suffix="ms" min={20} max={1000} value={cfg.kick.decayMs}
              step={10}
              onDrag={(v) => updateLocal('kick', 'decayMs', v)}
              onCommit={(v) => commitField('kick', 'decayMs', v)}
              hint="How fast micKick envelope falls back to 0."
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
