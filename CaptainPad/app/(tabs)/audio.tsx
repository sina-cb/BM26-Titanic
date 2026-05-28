// Audio Analysis tab — operator surface for the in-engine mic
// listener, per-signal post-processing chains, and BPM → speed sync
// (docs/25 §8.2; docs/29 chain-based audio post-processing).
//
// Structure (top-down) — matches the operator's mental flow, post
// operator brief 2026-05-26 (BPM out of SETTINGS, analyzer config
// embedded per-signal in chain editor):
//   1. PINNED meter strip (mic + stems + BPM, live, sticks at top)
//   2. Page title
//   3. patchError banner (only when something just failed)
//   4. MIC ANALYSIS — the master enable/disable toggle. Stays at the
//      top of the scroll body so operators can flip it without
//      hunting through SETTINGS during a show.
//   5. BPM → SPEED SYNC (compact) — pulled out of SETTINGS into its
//      own card right under MASTER ENABLE so the mapping is reachable
//      without expanding a disclosure.
//   6. SIGNALS · CHAINS — Phase 5 per-signal chain editor, now with
//      embedded ANALYZER sub-sections per signal (crossovers +
//      envelope for mic LOW/MID/HIGH, kick detector for micKick).
//      Analyzer state is still global in the engine (single FFT) but
//      surfaced per-signal so it lives with the band the operator is
//      tuning.
//   7. SETTINGS — collapsed-by-default disclosure with only the rig-
//      build settings: mic picker, engine FFT/hop size (read-only),
//      Reset to defaults (still fires BOTH /audio/config/reset AND
//      /audio/chains/reset).
//
// What's retired (history at commit a76eba5): the standalone STEMS —
// GAIN card, the MIC LIVE card, and the wrapping MIC — ANALYSIS card.
// Per-band / per-stem gain remains editable from the chain editor's
// Gain-op slider and via CPCControls in the deck/mixer chrome.
//
// Important UI note: every interactive sub-component (FaderRow, …)
// lives at MODULE scope. Defining them inside the screen function
// would give them a new component identity on every parent state
// change, which unmounts / remounts the underlying HorizontalFader
// mid-drag and makes the sliders feel broken.

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
// react-native-svg is declared in package.json at 15.10.0 (Expo SDK 54
// compat). Until the operator runs `npm install` + `npx expo prebuild
// --platform ios --clean` + rebuild, this import resolves at type-check
// time but the native module is absent — runtime will throw
// "RNSVGSvgView not found". This is the intentional cost of adding a
// native dep mid-cycle. See the rework brief, 2026-05-26.
import Svg, { Polyline } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import {
  fetchAudioConfig, patchAudioConfig, resetAudioConfig,
  fetchAudioDevices, getApiBaseAsync, updateParamCenter,
  resetAllAudioChains,
} from '@/utils/api';
import { useAudioStatus, useSharedParamValues, useLiveParamValues, useOscStatus, type AudioStatus, type AudioStatusDevice, type OscPillState } from '@/hooks/useEngineState';
import { AudioChainsCard } from '@/components/audio/AudioChainsCard';

// "Auto-driven" accent — mirrors C.tertiary in theme.ts.
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
const BPM_MIN_ABS = 50;
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
//
// Factory functions: the active palette flips at runtime when the
// operator toggles dark mode, so these styles can't be captured at
// module load. Components call them inside a `useMemo` keyed on the
// palette.

function makeCard(palette: Palette, globalStyles: GlobalStyles) {
  return {
    ...globalStyles.card,
    padding: 20,
    marginBottom: 20,
    alignSelf: 'stretch' as const,
    ...globalStyles.ambientShadow,
  };
}

function makeSubCard(C: Palette) {
  return {
    backgroundColor: C.surfaceContainerLow,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    padding: 14,
    marginTop: 12,
  } as const;
}

function SectionHeader({ icon, title, hint, right }: {
  icon: string; title: string; hint?: string; right?: React.ReactNode;
}) {
  const C = usePalette();
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
  const C = usePalette();
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
  const C = usePalette();
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

// `GainRow` (the per-band / per-stem gain slider that POST'd a single
// CPC key throttled-live) was retired in Phase 6 along with the MIC —
// ANALYSIS and STEMS — GAIN cards. The same params remain editable via
// the chain editor's Gain-op slider and via CPCControls in the
// deck/mixer chrome — see AudioChainsCard + components/CPCControls.tsx.

// `BandMeter` used to render the per-band level read-out inside the MIC
// LIVE + STEMS LIVE cards. As of operator brief 2026-05-26 those rows
// were deleted — they duplicate the bars in the pinned
// <PinnedAudioMeters /> strip at the top of the AUDIO tab. The component
// was removed wholesale; if a future card needs a 12-px band meter, lift
// the bar+label block out of <SignalColumn /> (it shares the same
// clamp-to-[0,1] + percent label pattern).

// ── Master toggle (large pill, used at top of the page) ─────────────────

function MasterToggle({ on, busy, onPress, label, subtitle, accent = ACCENT_AUTO }: {
  on: boolean; busy?: boolean; onPress: () => void; label: string; subtitle?: string; accent?: string;
}) {
  const C = usePalette();
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
  const C = usePalette();
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
// Layout: stacked column per signal.
//   Top row  : MIC / OSC / SYNC status pills (left-aligned) + window picker (right).
//   Main row : 4 MIC columns + 3 STEMS columns + BPM pill.
//   Each signal column stacks vertically:
//     [LABEL + VALUE] → [bar meter] → [SVG trail plot]
//   Trail is TouchDesigner-style: a small SVG with two overlaid polylines —
//   a ghosted RAW line (1 px, 50% opacity) behind a solid POST line
//   (1.5 px, full opacity). Option A from the rework brief — denser than
//   stacked plots, matches CHOP-overlay convention.

// Per-signal slot metadata. `rawKey` reads from the engine-published
// `<liveKey>Raw` mirror; `postKey` is the gained `<liveKey>`. Module-scope
// so array identity is stable — keeps the live-key set pinned across
// renders (avoids useLiveParamValues key-set churn).
// Accent is stored as a *token reference* rather than a raw colour so the
// meter follows light/dark mode. `'auto'` and `'primary'` resolve from
// the active palette at render time; literal hex strings are also
// supported for any future fixed-colour slot.
type SignalAccent = 'auto' | 'primary' | 'error' | string;

type SignalSlot = {
  label: string;
  rawKey: string;
  postKey: string;
  accent: SignalAccent;
};

const MIC_SIGNALS: readonly SignalSlot[] = [
  { label: 'LOW',  rawKey: 'micLowRaw',  postKey: 'micLow',  accent: 'auto' },
  { label: 'MID',  rawKey: 'micMidRaw',  postKey: 'micMid',  accent: 'auto' },
  { label: 'HIGH', rawKey: 'micHighRaw', postKey: 'micHigh', accent: 'auto' },
  { label: 'KICK', rawKey: 'micKickRaw', postKey: 'micKick', accent: 'error' },
];

const STEMS_SIGNALS: readonly SignalSlot[] = [
  { label: 'VOC', rawKey: 'stemsVocalsRaw', postKey: 'stemsVocals', accent: 'primary' },
  { label: 'BAS', rawKey: 'stemsBassRaw',   postKey: 'stemsBass',   accent: 'primary' },
  { label: 'DRM', rawKey: 'stemsDrumsRaw',  postKey: 'stemsDrums',  accent: 'primary' },
];

function resolveAccent(accent: SignalAccent, palette: Palette): string {
  if (accent === 'auto') return ACCENT_AUTO;
  if (accent === 'primary') return palette.primary;
  if (accent === 'error') return palette.error;
  return accent;
}

const ALL_SIGNALS: readonly SignalSlot[] = [...MIC_SIGNALS, ...STEMS_SIGNALS];

// Build the defaults snapshot once at module scope — useLiveParamValues
// pins keys from the FIRST call's defaults so any per-render literal
// would be wasted work and a hazard for the pinned-key set.
const PINNED_LIVE_DEFAULTS: Record<string, number> = (() => {
  const acc: Record<string, number> = {
    tempoBpm: 0,
  };
  for (const s of ALL_SIGNALS) { acc[s.rawKey] = 0; acc[s.postKey] = 0; }
  return acc;
})();

// Trail buffer + window-picker constants. Same AsyncStorage key as
// before (operator preference roams across rebuilds).
const SIGNAL_WINDOW_KEY = '@CaptainPad:audioTrailWindowS';
const WINDOW_OPTIONS_S = [5, 10, 15, 30] as const;
const DEFAULT_WINDOW_S = 10;
const TRAIL_SAMPLE_HZ = 15;            // 15 Hz visual cadence — enough resolution for a smooth polyline
const TRAIL_SAMPLE_MS = 1000 / TRAIL_SAMPLE_HZ;
const MAX_TRAIL_S = WINDOW_OPTIONS_S[WINDOW_OPTIONS_S.length - 1];
const MAX_BUFFER_LEN = MAX_TRAIL_S * TRAIL_SAMPLE_HZ;

const TRAIL_HEIGHT = 28;               // SVG plot height per signal column
const SVG_VIEW_W   = 100;              // viewBox width — strokes scale to the actual rendered width
const SVG_VIEW_H   = 100;              // viewBox height — y inverted because SVG grows downward

// Build a polyline "x,y x,y …" point string from a sample buffer. Older
// samples LEFT, newest RIGHT. Empty leading slots are skipped (line
// just starts later) — keeps the "now" anchored to the right edge.
function buildPoints(samples: readonly number[], bufferLen: number): string {
  if (!samples.length || bufferLen <= 1) return '';
  const take = Math.min(samples.length, bufferLen);
  const startIdx = bufferLen - take;       // x slot where the line starts
  const stepX = SVG_VIEW_W / (bufferLen - 1);
  const parts: string[] = [];
  for (let i = 0; i < take; i++) {
    const v = Math.max(0, Math.min(1, samples[samples.length - take + i] ?? 0));
    const x = (startIdx + i) * stepX;
    const y = SVG_VIEW_H * (1 - v);        // invert: 0 at bottom, 1 at top
    parts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

// One signal column: header label, then two stacked sub-rows — RAW
// (ghost-toned bar + trace) and POST (solid bar + trace). Stacking
// them (vs overlaying) means the operator can read each separately
// and verify gain divergence at a glance.
function SignalColumn({ slot, raw, post, rawSamples, postSamples, bufferLen }: {
  slot: SignalSlot;
  raw: number;
  post: number;
  rawSamples: readonly number[];
  postSamples: readonly number[];
  bufferLen: number;
}) {
  const C = usePalette();
  const accentColor = resolveAccent(slot.accent, C);
  const rv = Math.max(0, Math.min(1, raw));
  const pv = Math.max(0, Math.min(1, post));
  const rawPoints  = useMemo(() => buildPoints(rawSamples,  bufferLen), [rawSamples,  bufferLen]);
  const postPoints = useMemo(() => buildPoints(postSamples, bufferLen), [postSamples, bufferLen]);
  return (
    <View style={{ flex: 1, marginHorizontal: 4 }}>
      {/* header — slot label */}
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: C.secondary, textTransform: 'uppercase',
        letterSpacing: 0.6, marginBottom: 4,
      }}>{slot.label}</Text>

      {/* RAW sub-row — tag+value, bar, trace */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, letterSpacing: 0.6, opacity: 0.7,
        }}>RAW</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: C.text, opacity: 0.7,
        }}>{rv.toFixed(2)}</Text>
      </View>
      <View style={{
        height: 14, borderRadius: 7,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        overflow: 'hidden', marginTop: 2,
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${rv * 100}%`, backgroundColor: accentColor,
          opacity: 0.5,
        }} />
      </View>
      <View style={{
        marginTop: 2,
        height: TRAIL_HEIGHT,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${SVG_VIEW_W} ${SVG_VIEW_H}`}
          preserveAspectRatio="none"
        >
          {rawPoints ? (
            <Polyline
              points={rawPoints}
              fill="none"
              stroke={accentColor}
              strokeOpacity={0.55}
              strokeWidth={1}
            />
          ) : null}
        </Svg>
      </View>

      {/* POST sub-row — tag+value, bar, trace */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: accentColor, letterSpacing: 0.6,
        }}>POST</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12,
          color: C.text,
        }}>{pv.toFixed(2)}</Text>
      </View>
      <View style={{
        height: 18, borderRadius: 9,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        overflow: 'hidden', marginTop: 2,
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pv * 100}%`, backgroundColor: accentColor,
        }} />
      </View>
      <View style={{
        marginTop: 2,
        height: TRAIL_HEIGHT,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${SVG_VIEW_W} ${SVG_VIEW_H}`}
          preserveAspectRatio="none"
        >
          {postPoints ? (
            <Polyline
              points={postPoints}
              fill="none"
              stroke={accentColor}
              strokeWidth={1.5}
            />
          ) : null}
        </Svg>
      </View>
    </View>
  );
}

function WindowPicker({ value, onChange }: {
  value: number; onChange: (s: number) => void;
}) {
  const C = usePalette();
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

function StatusPill({ label, tone }: { label: string; tone: 'on' | 'off' | 'warn' }) {
  const C = usePalette();
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
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  // Per-key live subscription. The 7 raw + 7 post audio keys + tempoBpm
  // participate in the equality check, so this strip re-renders only
  // when one of THESE values actually ticks. The body below never
  // re-renders on liveParams. PINNED_LIVE_DEFAULTS is built at module
  // scope so the key set stays pinned across renders.
  const live = useLiveParamValues(PINNED_LIVE_DEFAULTS) as Record<string, number>;
  // Pull bpmSpeedSync from steady params for the SYNC pill — cheap;
  // changes only when operator toggles it.
  const steady = useSharedParamValues({ bpmSpeedSync: 0 }) as Record<string, number>;

  // ── Window picker — persisted to AsyncStorage (same key as before).
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

  // ── Ring buffer — one number[] per (signal, raw|post) pair. Identity
  // changes on each tick so SignalColumn's useMemo recomputes the
  // polyline points string. Bounded at MAX_BUFFER_LEN; window picker
  // controls how many tail samples we hand to the SVG.
  const [trails, setTrails] = useState<{ raw: number[][]; post: number[][] }>(() => ({
    raw:  ALL_SIGNALS.map(() => []),
    post: ALL_SIGNALS.map(() => []),
  }));

  // Always read the latest live values from a ref so the sample timer
  // callback (started once per focus) doesn't need `live` in its deps.
  // The strip re-renders on every live tick, which updates the ref;
  // the timer pulls from the ref at TRAIL_SAMPLE_HZ.
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

  const micOn       = audioStatus?.enabled === true;
  const micPhase    = audioStatus?.phase ?? (micOn ? 'unknown' : 'off');
  // Engine commit 5d830d6 added coded error states. When audioStatus
  // reports `configured_mic_not_found` or `device_enumeration_failed`
  // the engine is intentionally not running capture and `enabled` is
  // false — so the pill needs to escalate from "MIC OFF" (passive) to
  // "MIC ERR" (warn) so the operator notices on the meter strip even
  // before scrolling to the banner below.
  const micCodedErr =
    audioStatus?.error === 'configured_mic_not_found' ||
    audioStatus?.error === 'device_enumeration_failed';
  const micTone: 'on' | 'off' | 'warn' =
    micCodedErr                 ? 'warn' :
    !micOn                      ? 'off'  :
    micPhase === 'error'        ? 'warn' :
    micPhase === 'restarting'   ? 'warn' :
                                  'on';
  const micLabel = micCodedErr ? 'MIC ERR' : (micOn ? `MIC ${micPhase.toUpperCase()}` : 'MIC OFF');
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
      {/* Status pills row + shared window picker on the right.
          One picker controls ALL 7 trails (operator never has to think
          about which axis they're tuning). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <StatusPill label={micLabel} tone={micTone} />
        <StatusPill label={oscLabel} tone={oscTone} />
        <StatusPill label={syncOn ? 'BPM SYNC ON' : 'BPM SYNC OFF'} tone={syncTone} />
        <View style={{ flex: 1 }} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, letterSpacing: 0.8, marginRight: 8,
        }}>TRAIL</Text>
        <WindowPicker value={windowS} onChange={setWindow} />
      </View>
      {/* Meters row — two halves split by a vertical divider. Each
          half contains N signal columns, each stacking
          [label+value]→[bar]→[trail]. The BPM pill rides at the right
          end of the STEMS half (no trail — BPM has its own pace). */}
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {/* LEFT half: MIC bands */}
        <View style={{ flex: 4, paddingRight: 16 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
            color: C.secondary, textTransform: 'uppercase',
            letterSpacing: 1, marginBottom: 8,
          }}>MIC</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {MIC_SIGNALS.map((slot, i) => (
              <SignalColumn
                key={slot.postKey}
                slot={slot}
                raw={live[slot.rawKey] ?? 0}
                post={live[slot.postKey] ?? 0}
                rawSamples={trails.raw[i]}
                postSamples={trails.post[i]}
                bufferLen={bufferLen}
              />
            ))}
          </View>
        </View>
        {/* Vertical divider */}
        <View style={{ width: 1, backgroundColor: C.ghostBorder, marginHorizontal: 0 }} />
        {/* RIGHT half: stems + BPM. Stems get the same SignalColumn
            treatment as mic; BPM stays as a pill (no trail). */}
        <View style={{ flex: 4, paddingLeft: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
              color: C.secondary, textTransform: 'uppercase',
              letterSpacing: 1,
            }}>STEMS</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {STEMS_SIGNALS.map((slot, i) => (
              <SignalColumn
                key={slot.postKey}
                slot={slot}
                raw={live[slot.rawKey] ?? 0}
                post={live[slot.postKey] ?? 0}
                rawSamples={trails.raw[MIC_SIGNALS.length + i]}
                postSamples={trails.post[MIC_SIGNALS.length + i]}
                bufferLen={bufferLen}
              />
            ))}
            {/* BPM pill — biggest single number on the strip. No trail
                under it: BPM ticks at the song's pace, not the analyser's. */}
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
  const C = usePalette();
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

// `BpmTempoLine` (the multi-line "tempo X BPM → speed Y" read-out used
// inside the retired SETTINGS BPM sub-card) was deleted alongside that
// sub-card on 2026-05-26. The CompactBpmCard renders a single-line
// inline read-out via <BpmInlineReadout /> instead. Restore from git
// history if a future card needs the verbose tempo line back.

// Compact inline live read-out for the BPM card header. Single line,
// quiet typography — just "126 BPM → 0.43" or "—". Subscribes ONLY to
// tempoBpm + bpmSpeedMin/Max so the rest of the BPM card doesn't
// re-render on every tempo tick.
function BpmInlineReadout() {
  const C = usePalette();
  const live = useLiveParamValues({ tempoBpm: 0 } as Record<string, number>) as Record<string, number>;
  const steady = useSharedParamValues({ bpmSpeedMin: 60, bpmSpeedMax: 180 } as Record<string, number>) as Record<string, number>;
  const bpm = live.tempoBpm;
  const mapped = useMemo(() => {
    if (!steady.bpmSpeedMin || !steady.bpmSpeedMax || steady.bpmSpeedMin === steady.bpmSpeedMax || !bpm) return null;
    return Math.max(0, Math.min(1, (bpm - steady.bpmSpeedMin) / (steady.bpmSpeedMax - steady.bpmSpeedMin)));
  }, [bpm, steady.bpmSpeedMin, steady.bpmSpeedMax]);
  if (!(bpm > 0)) {
    return (
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.icon, fontSize: 12, letterSpacing: 0.4 }}>
        —
      </Text>
    );
  }
  return (
    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 12, letterSpacing: 0.4 }}>
      {Math.round(bpm)} BPM{mapped !== null ? ` → ${mapped.toFixed(2)}` : ''}
    </Text>
  );
}

// ── Compact BPM → SPEED SYNC card (operator brief 2026-05-26) ──────────
// Sits between MASTER ENABLE and SIGNALS · CHAINS. Single-row header
// (title + status pill + live read-out), tap-to-toggle status pill (no
// separate MasterToggle bar), two BPM sliders side-by-side, one-line
// hint. ~half the height of the old SETTINGS-buried version.
//
// Wire identical to the retired version: PATCH bpmSpeedSync /
// bpmSpeedMin / bpmSpeedMax via updateParamCenter. The slider min/max
// are kept ≥ 1 BPM apart on commit (client-side guard; engine validates).

function CompactBpmCard({
  sp, bpmSyncOn, oscMissing, oscState,
}: {
  sp: Record<string, number>;
  bpmSyncOn: boolean;
  oscMissing: boolean;
  oscState: string | null;
}) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const CARD = useMemo(() => makeCard(C, globalStyles), [C, globalStyles]);
  const minVal = Math.max(BPM_MIN_ABS, Math.min(BPM_MAX_ABS, sp.bpmSpeedMin ?? BPM_MIN_ABS));
  const maxVal = Math.max(BPM_MIN_ABS, Math.min(BPM_MAX_ABS, sp.bpmSpeedMax ?? BPM_MAX_ABS));
  return (
    <View style={CARD}>
      {/* Header row — title + tap-to-toggle status pill + live read-out.
          Tap the pill to flip SYNC; saves a whole MasterToggle row. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text,
          letterSpacing: 0.8, flex: 1,
        }}>
          BPM → SPEED SYNC
        </Text>
        <BpmInlineReadout />
        <TouchableOpacity
          onPress={() => updateParamCenter({ bpmSpeedSync: bpmSyncOn ? 0 : 1 })}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
            backgroundColor: bpmSyncOn ? ACCENT_AUTO : C.surfaceContainerHigh,
            borderWidth: 1,
            borderColor: bpmSyncOn ? ACCENT_AUTO : (oscMissing ? C.error : C.ghostBorder),
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
            color: bpmSyncOn ? '#000' : C.secondary,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>
            {bpmSyncOn ? 'SYNC ON' : 'SYNC OFF'}
          </Text>
        </TouchableOpacity>
      </View>
      {/* Stale/no-signal banner only when sync is on AND something is
          actually wrong. BpmStaleWarning self-gates and self-subscribes. */}
      <BpmStaleWarning bpmSyncOn={bpmSyncOn} oscMissing={oscMissing} oscState={oscState} />
      {/* Two sliders on one row (min | max). Reuses FaderRow but with
          a compacted column layout — short labels, no per-slider hint
          paragraph. The one-liner hint sits below the pair. */}
      {/* Fixed slider scales [BPM_MIN_ABS, BPM_MAX_ABS] on both ends —
          operator brief 2026-05-27. Previously each end's slider range
          was derived from the other (max={maxVal-1}, min={minVal+1}),
          which made the slider knobs visibly shift along their tracks
          as the partner was dragged. Cross-bound constraint (min < max)
          stays enforced at COMMIT time via the existing clamp. */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <FaderRow
            label="BPM min"
            min={BPM_MIN_ABS}
            max={BPM_MAX_ABS}
            value={minVal}
            step={1}
            onDrag={() => { /* commit on release */ }}
            onCommit={(v) => updateParamCenter({ bpmSpeedMin: Math.max(BPM_MIN_ABS, Math.min(v, maxVal - 1)) })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <FaderRow
            label="BPM max"
            min={BPM_MIN_ABS}
            max={BPM_MAX_ABS}
            value={maxVal}
            step={1}
            onDrag={() => { /* commit on release */ }}
            onCommit={(v) => updateParamCenter({ bpmSpeedMax: Math.min(BPM_MAX_ABS, Math.max(v, minVal + 1)) })}
          />
        </View>
      </View>
      <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: -4 }}>
        Maps live tempo ({BPM_MIN_ABS}–{BPM_MAX_ABS} BPM) onto speed 0–1. Sync drives global SPEED from /lx/tempo/bpm.
      </Text>
    </View>
  );
}

// ── Cross-machine mic-not-found banner (engine commit 5d830d6) ──────────
//
// When the engine boots a scene whose saved mic isn't on this machine
// (operator moved rigs), capture stays off and audioStatus carries
// `error: 'configured_mic_not_found'` plus `availableDevices` (same wire
// as /audio/devices) and `missingDevice`. The banner surfaces the
// problem prominently above SIGNALS · CHAINS and offers a one-tap
// picker built from the engine-supplied device list — no extra fetch.
//
// The companion `device_enumeration_failed` state (engine can't list
// devices at all — typically missing ffmpeg) renders a simpler version
// with operator-side resolution copy and no picker. Banner self-hides
// the moment audioStatus.error clears (engine restarts capture and
// broadcasts a healthy snapshot).
//
// Codex P0 corners handled:
//   - configured_mic_not_found + empty availableDevices → "No mics
//     available" copy instead of an empty picker.
//   - malformed device entries are filtered upstream in
//     useEngineState's audioStatus handler (missing required fields
//     → dropped) so picker rows here are always valid.

function MicNotFoundBanner({
  audioStatus, busyMicId, onPickDevice, onExpandSettings,
}: {
  audioStatus: AudioStatus | null;
  busyMicId: string | null;
  onPickDevice: (d: AudioStatusDevice) => void;
  onExpandSettings: () => void;
}) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const CARD = useMemo(() => makeCard(C, globalStyles), [C, globalStyles]);
  const err = audioStatus?.error;
  // Hide cleanly when healthy or for any non-coded error (legacy free-form
  // strings continue to surface inline in the MICROPHONE picker card).
  if (err !== 'configured_mic_not_found' && err !== 'device_enumeration_failed') {
    return null;
  }
  const errorBg = 'rgba(186, 26, 26, 0.08)';
  // ── device_enumeration_failed — simpler render, no picker.
  if (err === 'device_enumeration_failed') {
    const detail = audioStatus?.enumerationError?.message
      || 'no detail provided by engine';
    return (
      <View style={{
        ...CARD, borderColor: C.error, backgroundColor: errorBg,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 8,
            backgroundColor: 'rgba(186, 26, 26, 0.15)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <IconSymbol name="exclamationmark.triangle.fill" size={20} color={C.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14,
              color: C.error, letterSpacing: 0.6, marginBottom: 4,
            }}>
              Audio devices unavailable
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12, lineHeight: 17 }}>
              Engine can&apos;t list devices: {detail}. Check ffmpeg availability and engine logs, then restart the engine.
            </Text>
          </View>
        </View>
      </View>
    );
  }
  // ── configured_mic_not_found — picker + jump-to-SETTINGS action.
  const missing = audioStatus?.missingDevice;
  const missingName = missing?.deviceLabel || missing?.device || missing?.deviceId || 'the saved mic';
  const devices = audioStatus?.availableDevices ?? [];
  return (
    <View style={{ ...CARD, borderColor: C.error, backgroundColor: errorBg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 8,
          backgroundColor: 'rgba(186, 26, 26, 0.15)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <IconSymbol name="exclamationmark.triangle.fill" size={20} color={C.error} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14,
            color: C.error, letterSpacing: 0.6, marginBottom: 4,
          }}>
            Configured microphone not available
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12, lineHeight: 17 }}>
            Saved mic &ldquo;{missingName}&rdquo; isn&apos;t on this machine. Pick a new one to start listening.
          </Text>
        </View>
        {/* Secondary action — operator who prefers the full SETTINGS
            picker (richer rig context) can jump there in one tap. The
            inline picker below is the fastest path; this is a fallback. */}
        <TouchableOpacity
          onPress={onExpandSettings}
          style={{
            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.error,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
            color: C.error, textTransform: 'uppercase', letterSpacing: 0.8,
          }}>
            Open Settings
          </Text>
        </TouchableOpacity>
      </View>
      {devices.length === 0 ? (
        <View style={{
          padding: 12, borderRadius: 8,
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.ghostBorder,
        }}>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>
            No microphones available — connect one and restart engine.
          </Text>
        </View>
      ) : (
        <View>
          <SubHeader title={`AVAILABLE DEVICES (${devices.length})`} />
          {devices.map((d) => (
            <MicPickerRow
              key={d.id}
              device={d}
              // Engine has stopped capture in this state, so nothing is
              // "current" — every row is a fresh pick. We pass
              // isCurrent={false} explicitly so the picker doesn't try
              // to highlight one based on the stale (missing) cfg state.
              isCurrent={false}
              onPress={() => onPickDevice(d)}
              busy={busyMicId === d.id}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Stems / mic gain cards — RETIRED (Phase 6, 2026-05-26) ──────────────
//
// The standalone `MicLiveCard` (PER-BAND GAIN) and `StemsLiveCard`
// (PER-STEM GAIN) sub-cards used to live here. Phase 5 moved every
// signal's gain into the chain editor's first-op `Gain` slider; the
// underlying CPC keys (micLowGain, …, stemsBassGain, …) are also still
// driven by the deck/mixer chrome's CPCControls. Retiring these cards
// removes the duplicate UI without losing any control surface.
//
// Likewise, the wrapping `MIC — ANALYSIS` card (which held PER-BAND
// GAIN + the analyser tuning sub-cards) is retired — its tuning
// sub-cards (BANDS — CROSSOVERS, BANDS — ENVELOPE & GATE, KICK
// DETECTOR, ENGINE) now live inside the bottom SETTINGS disclosure.
// If you bring them back, look at git history at commit 5455686.

// ── SETTINGS collapsible (Phase 6) ──────────────────────────────────────
//
// All operator settings that are touched at rig-build time but rarely
// mid-show live inside a single disclosure card pinned to the bottom of
// the AUDIO tab. Wireframe A §SETTINGS in docs/29. Collapsed by default;
// preference persists across rebuilds via AsyncStorage.

const SETTINGS_COLLAPSED_KEY = '@CaptainPad:audioSettingsCollapsed';

// ENGINE section (fftSize / hopSize) is render-only — see the read-only
// display deep in <AudioConfigLoaded /> below. The fields are deliberately
// non-live-tunable per marsin_engine/lib/audio_config.js §AUDIO_LIVE_FIELDS
// (changing either requires analyzer reconstruction). A previous iteration
// rendered a discrete pill picker (FFT_SIZE_OPTIONS + hopOptionsFor +
// PillPicker) and PATCHed the top-level field; every tap hit a 400
// "field is not live-tunable; restart the engine to change it" — a
// misleading affordance. Restore from git history at commit 51623ae if
// reviving an editor that goes through a proper restart flow.

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
  const globalStyles = useGlobalStyles();
  const C = usePalette();
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
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const CARD = useMemo(() => makeCard(C, globalStyles), [C, globalStyles]);
  const SUB_CARD = useMemo(() => makeSubCard(C), [C]);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[] | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Ref to the page-level ScrollView so "Open Settings" on the cross-
  // machine mic banner can scroll the (off-screen) SETTINGS disclosure
  // at the bottom into view. Without this the operator taps the button
  // and sees no visible change — the card expanded, but below the fold.
  const scrollRef = useRef<ScrollView | null>(null);
  // SETTINGS collapse — Phase 6, default collapsed. AsyncStorage roams
  // the operator's preference across rebuilds. We start collapsed and
  // the effect below may flip to false if AsyncStorage has a stored
  // 'false'. This means a fresh install gets the documented default
  // (collapsed) even if AsyncStorage is cold.
  const [settingsCollapsed, setSettingsCollapsed] = useState<boolean>(true);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SETTINGS_COLLAPSED_KEY).then((raw) => {
      if (!alive || raw == null) return;
      if (raw === 'false') setSettingsCollapsed(false);
      else if (raw === 'true') setSettingsCollapsed(true);
    }).catch(() => { /* benign — first launch, AsyncStorage cold */ });
    return () => { alive = false; };
  }, []);
  const toggleSettings = useCallback(() => {
    setSettingsCollapsed((prev) => {
      const next = !prev;
      AsyncStorage.setItem(SETTINGS_COLLAPSED_KEY, String(next))
        .catch(() => { /* benign — persistence is best-effort */ });
      return next;
    });
  }, []);

  // Steady (operator-tuned, persistent) params — sliders, sync
  // toggles, gain knobs. These are quiet by default; only redrawn
  // when the operator turns a knob.
  //
  // NB: this body deliberately does NOT subscribe to `useLiveParamValues`.
  // Live high-rate keys (micLow/Mid/High/Kick, stems*, tempoBpm) re-render
  // at 15-30 Hz; folding them in here re-rendered the ENTIRE config
  // body — every FaderRow, mic picker, BPM range slider — at that
  // cadence. Live meters now live in their own components —
  // <PinnedAudioMeters /> + <BpmTempoLine /> — which each subscribe to
  // ONLY the live keys they need. Per-band / per-stem gain sliders are
  // retired from this tab (Phase 6); the same params remain editable
  // via chain-editor Gain ops + the deck/mixer chrome's CPCControls.
  const sp = useSharedParamValues({
    bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 180, speed: 0,
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

  // Reset to defaults — Phase 6, docs/29 §Interactions step 7. Fires
  // BOTH endpoints (analyzer config + every signal's default chain).
  // Surfaces inline error if either fails; chains broadcast will refresh
  // the AudioChainsCard on its own via /ws/control `audioChainsChanged`.
  const resetToDefaults = useCallback(async () => {
    setBusy('reset');
    const [cfgRes, chainsRes] = await Promise.all([
      resetAudioConfig(),
      resetAllAudioChains(),
    ]);
    setBusy(null);
    const errors: string[] = [];
    if (!cfgRes.ok) errors.push(`config: ${cfgRes.error || 'reset failed'}`);
    if (!chainsRes.ok) errors.push(`chains: ${chainsRes.error || 'reset failed'}`);
    if (errors.length) {
      setPatchError(errors.join(' · '));
    } else {
      setPatchError(null);
    }
    // Always reload audio config: even a chains-only failure still
    // means the analyzer side reset succeeded and we need the fresh
    // numbers reflected in the sliders.
    reload();
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
  // and respawns on the new input. AudioDevice and AudioStatusDevice
  // both have the picker fields the engine wants — accept the union so
  // both the SETTINGS picker and the banner's fix-it picker share one
  // commit path. Banner picks omit reload-from-cfg implications: once
  // the engine successfully restarts capture it broadcasts a healthy
  // audioStatus (error cleared), the banner hides on its own, and the
  // reload() below also resyncs the SETTINGS cfg.
  const selectDevice = useCallback(async (d: AudioDevice | AudioStatusDevice) => {
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

  // "Open Settings" action on the cross-machine mic banner — expand the
  // SETTINGS disclosure and (if not already loaded) warm the device list
  // so the operator who wants the full rig context lands on a ready picker.
  // We also persist the expansion so a remount keeps it open.
  const openSettingsForMic = useCallback(() => {
    setSettingsCollapsed(false);
    AsyncStorage.setItem(SETTINGS_COLLAPSED_KEY, 'false')
      .catch(() => { /* benign — persistence is best-effort */ });
    setPickerOpen(true);
    if (!devices) loadDevices();
    // The SETTINGS disclosure lives at the bottom of the page; without
    // this scroll the operator taps the banner's "Open Settings" and
    // sees nothing change because the expanded card is below the fold.
    // Two RAF ticks (then a fallback timeout) wait for the disclosure
    // body to render so scrollToEnd lands on the now-tall content.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    });
    setTimeout(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, 200);
  }, [devices, loadDevices]);

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
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 32, paddingBottom: 80 }}
      >
        {/* ── Page title ──────────────────────────────────────────────
            Reset is no longer a top-right header action — it lives at
            the bottom of the SETTINGS disclosure (Phase 6 / docs/29
            §Interactions step 7) and now fires BOTH chain + config
            resets. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32, gap: 16 }}>
          <IconSymbol name="waveform" size={32} color={C.primary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, color: C.text, letterSpacing: 1.5 }}>
            AUDIO
          </Text>
        </View>

        {patchError ? (
          <View style={{ ...CARD, borderColor: C.error, backgroundColor: 'rgba(186, 26, 26, 0.06)' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>REQUEST REJECTED</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>{patchError}</Text>
          </View>
        ) : null}

        {/* ── 1. MASTER ENABLE / DISABLE ──────────────────────────────
            Stays at the top of the scrolling body (above CHAINS) per
            the coordinator brief — operators reach for this constantly
            when troubleshooting "why is the kick not firing?" and we
            don't want them hunting for it inside SETTINGS. */}
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
              : 'Tap to start listening. Chains + SETTINGS below are read-only until enabled.'}
            accent={enabled ? phaseColor : ACCENT_AUTO}
          />
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 12 }}>
            This toggle only affects the mic listener. Stems (Vocals/Bass/Drums) are streamed
            independently over OSC and stay active when this is off.
          </Text>
        </View>

        {/* ── 2. BPM → SPEED SYNC (compact) ─────────────────────────────
            Operator brief 2026-05-26 — pulled out of SETTINGS so the
            mapping is reachable without expanding a disclosure. Tap
            the SYNC pill to flip; min/max sliders side-by-side. The
            stale/no-signal banner is self-rendered when sync is on. */}
        <CompactBpmCard
          sp={sp}
          bpmSyncOn={bpmSyncOn}
          oscMissing={oscMissing}
          oscState={oscState}
        />

        {/* ── Cross-machine mic-not-found banner ──────────────────────
            Surfaces engine commit 5d830d6 audioStatus coded errors:
            `configured_mic_not_found` (saved mic absent on this rig —
            inline picker shows availableDevices the engine sent with
            the status payload) and `device_enumeration_failed` (engine
            can't list mics — operator-side fix). Renders nothing when
            audioStatus is healthy or carries any other error string. */}
        <MicNotFoundBanner
          audioStatus={status}
          busyMicId={busy?.startsWith('mic:') ? busy.slice(4) : null}
          onPickDevice={selectDevice}
          onExpandSettings={openSettingsForMic}
        />

        {/* ── 3. SIGNALS · CHAINS ───────────────────────────────────────
            Per-signal post-processing chain editor (docs/29 Phase 5).
            One row per signal with [edit] disclosure → drag-reorderable
            op list with per-op param sliders + the engine's 5 Hz
            signalChain pre/post preview meters.
            Operator brief 2026-05-26: the chain editor now embeds an
            ANALYZER sub-section per signal — crossovers + envelope for
            mic LOW/MID/HIGH, kick detector for micKick. We pass the
            same audio config + commit handlers we used to keep in the
            SETTINGS sub-cards; analyzer state is still global in the
            engine (single FFT), surfaced per-signal in the UI so it
            lives with the band the operator is tuning. */}
        <AudioChainsCard
          audioConfig={cfg}
          // patchError is shown in the page-level banner above; the
          // AnalyzerSection's null-cfg branch is only reachable if the
          // parent's initial fetch failed (which mounts a different
          // screen entirely), so we hand down `null` here. Reload is
          // wired for completeness — if the engine ever ships a
          // post-mount `audioConfig` invalidation event, the retry
          // button is already wired.
          audioConfigError={null}
          onUpdateAudioConfigLocal={updateLocal}
          onCommitAudioConfigField={commitField}
          onRetryAudioConfig={reload}
        />

        {/* ── 4. SETTINGS (collapsed by default) ───────────────────────
            Pinned bottom disclosure that holds everything rarely touched
            mid-show. Operator brief 2026-05-26: the old BPM mapping,
            BANDS — CROSSOVERS, BANDS — ENVELOPE & GATE, and KICK
            DETECTOR sub-cards have all moved out — BPM is now its own
            compact card above CHAINS; analyzer config is embedded per
            signal inside the chain editor. What remains here is what
            genuinely belongs in "configuration": mic picker, engine
            (FFT/hop, read-only), reset-to-defaults. */}
        <View style={CARD}>
          <TouchableOpacity
            onPress={toggleSettings}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 8,
              backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center',
            }}>
              <IconSymbol name="slider.horizontal.3" size={20} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 0.8 }}>
                SETTINGS
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 2 }}>
                Microphone · Engine · Reset
              </Text>
            </View>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: C.secondary }}>
              {settingsCollapsed ? '▾' : '▴'}
            </Text>
          </TouchableOpacity>

          {!settingsCollapsed ? (
            <View style={{ marginTop: 16 }}>
              {/* ── MICROPHONE ───────────────────────────────────────── */}
              <View style={SUB_CARD}>
                <SubHeader
                  title="MICROPHONE"
                  right={
                    <TouchableOpacity
                      onPress={() => { setPickerOpen(o => !o); if (!devices && !pickerOpen) loadDevices(); }}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
                        backgroundColor: pickerOpen ? C.primary : C.surfaceContainerLowest,
                        borderWidth: 1, borderColor: pickerOpen ? C.primary : C.ghostBorder,
                      }}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: pickerOpen ? '#fff' : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
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
                  <View style={{ marginTop: 10 }}>
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

              {/* ── ENGINE (fftSize / hopSize) — READ-ONLY ─────────── */}
              {/* fftSize and hopSize live in marsin_engine/lib/audio_config.js
                  §AUDIO_LIVE_FIELDS as deliberately-NOT-live-tunable:
                  changing either requires reconstructing the analyzer
                  (FFT bin table, hop buffer, ffmpeg pipeline). The engine
                  team's design choice is to surface this with an explicit
                  400 ("field \"fftSize\" is not live-tunable; restart the
                  engine to change it") rather than silently restart audio
                  capture under the operator. We mirror that contract here:
                  show the running values so the operator knows what they
                  have, but no editable control — a disabled picker is a
                  misleading affordance per Wireframe A guidance. To
                  change either, edit marsin_engine/config.yaml
                  (audio.fftSize / audio.hopSize) and restart the engine. */}
              <View style={SUB_CARD}>
                <SubHeader title="ENGINE" />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <Text style={{
                    fontFamily: 'SpaceGrotesk_700Bold', color: C.text,
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8,
                  }}>FFT size</Text>
                  <Text style={{
                    fontFamily: 'SpaceGrotesk_700Bold', color: C.primary,
                    fontSize: 12,
                  }}>{cfg.fftSize}-pt</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <Text style={{
                    fontFamily: 'SpaceGrotesk_700Bold', color: C.text,
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8,
                  }}>Hop size</Text>
                  <Text style={{
                    fontFamily: 'SpaceGrotesk_700Bold', color: C.primary,
                    fontSize: 12,
                  }}>{cfg.hopSize}</Text>
                </View>
                <Text style={{
                  fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
                  marginTop: 2, lineHeight: 14,
                }}>
                  Read-only — these fields are not live-tunable. To change,
                  edit marsin_engine/config.yaml (audio.fftSize / audio.hopSize)
                  and restart the engine. Bigger FFT = finer band edges, more
                  latency; 2048-pt with hopSize 1024 (50 % overlap) is the
                  EDM-VJ default.
                </Text>
              </View>

              {/* ── RESET TO DEFAULTS ───────────────────────────────── */}
              {/* docs/29 §Interactions step 7 — fires BOTH endpoints:
                  POST /audio/config/reset + POST /audio/chains/reset.
                  Errors are surfaced inline in the patchError banner
                  above; no silent fallbacks. */}
              <TouchableOpacity
                onPress={resetToDefaults}
                disabled={busy === 'reset'}
                style={{
                  marginTop: 16, alignSelf: 'flex-start',
                  paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8,
                  borderWidth: 1, borderColor: C.error,
                  backgroundColor: 'rgba(186, 26, 26, 0.06)',
                  opacity: busy === 'reset' ? 0.7 : 1,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.error, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Reset to defaults
                </Text>
                {busy === 'reset' ? <ActivityIndicator size="small" color={C.error} /> : null}
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 6 }}>
                Restores analyzer tuning (bands, envelope, kick, engine) AND every
                signal&apos;s default post-processing chain. Mic device selection is preserved.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
