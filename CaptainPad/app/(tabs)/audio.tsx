// Audio Analysis tab — operator surface for the in-engine mic
// listener, per-signal post-processing chains, and BPM → speed sync
// (docs/25 §8.2; docs/29 chain-based audio post-processing).
//
// Structure (top-down) — matches the operator's mental flow, post
// operator brief 2026-05-26 (BPM out of SETTINGS, analyzer config
// embedded per-signal in chain editor):
//   1. Page title
//   2. Live meters section (AUDIO SIGNALS grid + BPM, in-flow — the
//      whole tab is one scrollable area, no pinned strip)
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
import { useAudioStatus, useSharedParamValues, useLiveParamValues, useLiveParams, useOscStatus, useAudioSignals, type AudioStatus, type AudioStatusDevice, type OscPillState, type AudioSignalDescriptor } from '@/hooks/useEngineState';
import { AudioTraceCanvas } from '@/components/audio/AudioTraceCanvas';
import { audioAccentHex } from '@/utils/audioSignals';

// "Auto-driven" accent — mirrors C.tertiary in theme.ts.
// Local copy keeps this screen working even when the theme's TS shape
// isn't yet picked up by the consuming module's checker.
const ACCENT_AUTO = '#1b9e77';

// Mirrors the engine's /audio/config blob verbatim so we can read it back and
// PATCH a subset. NOTE: this tab only reads/writes capture.device* + bands.
// inputGain + fftSize/hopSize (read-only); the kick/bands-crossover/
// structureDetector fields are kept for type fidelity with the engine doc but
// are NOT edited here (the per-signal analyzer tuning moved to the Companion).
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
    inputGain?: number; // software mic-preamp (audio.bands.inputGain)
  };
  kick:  { minHz: number; maxHz: number; threshold: number; refractoryMs: number; decayMs: number };
  // Audio structure detector (build/drop/sustain cues, docs/30). Optional:
  // absent until the engine has it in its merged audio config. Only the
  // fields the UI reads/patches are typed here.
  structureDetector?: {
    enabled?: boolean;
    dropEdgeMode?: 'level' | 'windowed';
    dropDeltaWindowMs?: number;
    buildThreshold?: number; dropEnergyJump?: number;
    eventRefractoryMs?: number; stemsTimeoutMs?: number;
  };
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

// `SectionHeader` (icon tile + title + hint, used by the retired MIC
// ANALYSIS card) was removed on 2026-06-17 with that card — it had no
// other consumer. The SETTINGS disclosure renders its own inline header.
// Restore from git history if a future card needs the icon-tile header.

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
// CPCControls in the deck/mixer chrome (components/CPCControls.tsx); the
// per-signal chain editor that also exposed them was removed from
// CaptainPad on 2026-06-17 (chain design moved to the Audio Companion).

// `BandMeter` used to render the per-band level read-out inside the MIC
// LIVE + STEMS LIVE cards. As of operator brief 2026-05-26 those rows
// were deleted — they duplicate the bars in the
// <LiveAudioMeters /> section at the top of the AUDIO tab. The component
// was removed wholesale; if a future card needs a 12-px band meter, lift
// the bar+label block out of <SignalColumn /> (it shares the same
// clamp-to-[0,1] + percent label pattern).

// ── Master toggle (large pill) — RETIRED (2026-06-17) ───────────────────
// `MasterToggle` drove the MIC ANALYSIS enable/disable card. That card was
// removed when the Audio Companion became the sole analyzer (the in-engine
// listener is obsolete and fought the Companion for the device). The
// component was its only consumer, so it was deleted. Restore from git
// history if a large enable/disable pill is needed again.

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

// ── Live meters section ──────────────────────────────────────────────────
//
// The live AUDIO SIGNALS grid + status pills + INPUT GAIN, rendered as a
// normal in-flow section near the top of the AUDIO tab's single page
// ScrollView (it used to be a pinned strip; the whole tab now scrolls as
// one area).
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

// A signal slot for the meter strip. Derived at runtime from the engine
// schema (useAudioSignals) — the strip is DYNAMIC: it renders whatever
// audio CPC keys the Companion routes in (low/mid/high/kick, dom1/dom2,
// energy/slow/build, party, …). `accent` is chosen per-signal so KICK /
// frequency signals read apart from the [0,1] intensities.
type SignalSlot = {
  key: string;
  label: string;
  rawKey: string | null;
  postKey: string;
  accent: SignalAccent;
  kind: 'intensity' | 'frequency' | 'bpm';
  max: number;
};

function resolveAccent(accent: SignalAccent, palette: Palette): string {
  if (accent === 'auto') return ACCENT_AUTO;
  if (accent === 'primary') return palette.primary;
  if (accent === 'error') return palette.error;
  return accent;
}

// Pick an accent for a dynamic signal. The per-signal identity-colour map
// (Companion SOURCE_ACCENT mirror) now lives in utils/audioSignals.ts as a
// single source of truth shared with the deck meters + the modulation
// source trail — `audioAccentHex` resolves the fixed hex. Kept as a thin
// wrapper returning a `SignalAccent` so the existing resolveAccent path /
// literal-hex slots are unchanged.
function accentFor(sig: AudioSignalDescriptor): SignalAccent {
  return audioAccentHex(sig);
}

function toSignalSlot(sig: AudioSignalDescriptor): SignalSlot {
  return {
    key: sig.key,
    label: sig.label,
    rawKey: sig.rawKey,
    postKey: sig.postKey,
    accent: accentFor(sig),
    kind: sig.kind,
    max: sig.max,
  };
}

// Normalise a raw CPC value to a [0,1] bar/trail fill given the slot kind.
function normalizeSlot(slot: SignalSlot, value: number): number {
  if (slot.kind === 'intensity') return Math.max(0, Math.min(1, value));
  if (slot.max > 0) return Math.max(0, Math.min(1, value / slot.max));
  return Math.max(0, Math.min(1, value));
}

// Human-readable value for a slot's header readout.
function slotValueText(slot: SignalSlot, value: number): string {
  if (slot.kind === 'frequency') return `${Math.round(value)}Hz`;
  if (slot.kind === 'bpm') return value > 0 ? `${Math.round(value)}` : '—';
  return Math.max(0, Math.min(1, value)).toFixed(2);
}

// Trace canvas height. The pinned strip's trace is the MAIN visualisation
// of the audio page, so it's given a generous, touch-friendly height.
const PINNED_TRACE_HEIGHT = 40;

// AUDIO SIGNALS grid — the signals lay out as a 3-column × N-row grid
// (operator brief 2026-06-17) rather than one horizontally-scrolling
// row, to read cleaner on the iPad and mirror the Audio Companion's
// desktop layout. 3 cells across, wrapping to new rows; the BPM tile
// rides along as its own cell. `flexWrap` + percentage-width cells give
// the wrap; per-cell padding makes the gutters (RN's `gap` on a wrap
// container is unreliable across cells, so we pad inside each cell).
const SIGNAL_GRID_COLUMNS = 3;

// Engine INPUT GAIN bounds for the strip slider (software mic-preamp). This
// is a REAL gain: it patches audio.bands.inputGain on the engine, so it lifts
// low/mid/high/kick above the noise gate for the meters AND the detectors /
// patterns. Range kept generous for a quiet playa mic / line feed.
const INPUT_GAIN_MIN = 0;
const INPUT_GAIN_MAX = 10;

// One signal column — Companion-quality. Header (label + live POST value),
// a compact POST bar meter, then a single tall SMOOTH trace canvas that
// overlays a bold POST line (with a translucent area fill) over a thin RAW
// ghost line in the signal's colour. The trace interpolates client-side at
// ~60 fps from the throttled live values handed in here (see
// <AudioTraceCanvas />), so it glides between WS updates without any extra
// network traffic. Overlaying RAW behind POST (vs the old stacked plots)
// matches the Companion's CHOP-overlay convention and is denser — letting
// the trace be the MAIN visualisation of the page.
const SignalColumn = React.memo(function SignalColumn({ slot, raw, post, active, traceHeight }: {
  slot: SignalSlot;
  raw: number;
  post: number;
  active: boolean;
  traceHeight: number;
}) {
  const C = usePalette();
  const accentColor = resolveAccent(slot.accent, C);
  // Bars/traces are normalised to [0,1] by the slot's range (intensity is
  // already [0,1]; frequency/bpm are scaled by their schema max). The header
  // text shows the TRUE engine value (Hz / bpm / 0..1). Some signals (dom /
  // detectors / derived) have NO raw mirror — pass null so the RAW ghost is
  // hidden and only the POST line draws.
  const hasRaw = slot.rawKey !== null;
  const pv = normalizeSlot(slot, post);
  const rawNorm = hasRaw ? normalizeSlot(slot, raw) : null;
  return (
    <View style={{ flex: 1 }}>
      {/* header — slot label + live POST value */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <Text numberOfLines={1} style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
          color: accentColor, textTransform: 'uppercase',
          letterSpacing: 0.5, flexShrink: 1,
        }}>{slot.label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text,
        }}>{slotValueText(slot, post)}</Text>
      </View>

      {/* POST bar meter — compact, full intensity. */}
      <View style={{
        height: 6, borderRadius: 3,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        overflow: 'hidden', marginBottom: 2,
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pv * 100}%`, backgroundColor: accentColor,
        }} />
      </View>

      {/* The MAIN visual — smooth 60 fps scrolling RAW(thin)+POST(bold) trace. */}
      <View style={{ borderWidth: 1, borderColor: C.ghostBorder, borderRadius: 4, overflow: 'hidden' }}>
        <AudioTraceCanvas
          post={pv}
          raw={rawNorm}
          color={accentColor}
          background={C.surfaceContainerLowest}
          gridColor={C.ghostBorder}
          height={traceHeight}
          active={active}
        />
      </View>

      {/* RAW value footnote (only when a raw mirror exists) — keeps the
          gain-divergence read-out the previous stacked layout offered,
          without a second trace. */}
      {hasRaw ? (
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, letterSpacing: 0.6, opacity: 0.7, marginTop: 2,
        }}>RAW {slotValueText(slot, raw)}</Text>
      ) : null}
    </View>
  );
});

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

function LiveAudioMeters({
  oscStatus, inputGain, onCommitInputGain,
}: {
  oscStatus: OscPillState | null;
  inputGain: number;
  onCommitInputGain: (g: number) => void;
}) {
  const C = usePalette();
  // DYNAMIC signal set — derived from the engine schema (the audio CPC
  // keys the Companion routes in). The strip renders whatever is live;
  // adding/removing a signal in the Companion adds/removes a column with
  // no code change. Slots carry the post key + (optional) raw mirror key.
  const signals = useAudioSignals();
  const slots = useMemo<SignalSlot[]>(() => signals.map(toSignalSlot), [signals]);
  // Whole live doc — the key set is dynamic, so we read it directly rather
  // than via useLiveParamValues (whose pinned-key-set contract assumes a
  // fixed list). The strip re-renders at the analyser cadence; the body
  // below is a sibling of the ScrollView and never reads this.
  const liveDoc = useLiveParams();
  const valueOf = useCallback((key: string | null): number => {
    if (!key) return 0;
    const slot = liveDoc?.params?.[key];
    return slot && typeof slot.value === 'number' ? slot.value : 0;
  }, [liveDoc]);
  // Prefer the Companion's analyzed tempo (audioBpm); fall back to the
  // legacy tempoBpm (/lx/tempo/bpm) only when audioBpm is absent.
  const tempoLive = useLiveParamValues({ audioBpm: 0, tempoBpm: 0 }) as Record<string, number>;
  // Pull bpmSpeedSync from steady params for the SYNC pill — cheap;
  // changes only when operator toggles it.
  const steady = useSharedParamValues({ bpmSpeedSync: 0 }) as Record<string, number>;

  // ── Tab-focus gate — the <AudioTraceCanvas /> rAF loops pause when the
  // AUDIO tab is blurred so background tabs burn zero CPU (congestion / power
  // guard). `active` flips false on blur, true on focus.
  const [active, setActive] = useState(true);
  useFocusEffect(useCallback(() => {
    setActive(true);
    return () => setActive(false);
  }, []));

  // NB: the per-frame trace smoothing + ring buffer now live INSIDE each
  // <AudioTraceCanvas /> (client-side rAF interpolation). The old 15 Hz
  // setInterval that pushed every signal's samples into a shared trails
  // object was removed — it ticked the WHOLE strip at the network cadence
  // and produced a stepped polyline. The canvas instead reads the latest
  // throttled value (handed down as a prop from the existing live bus) and
  // glides between updates at the device frame rate, so there is no extra
  // network traffic and the motion is smooth. The window picker / trail-
  // length controls went with it (the trace window is now a fixed, calm
  // ~10 s-equivalent scroll — see ADVANCE_HZ in AudioTraceCanvas).

  // The in-engine MIC status pill (MIC LISTENING / RESTARTING / ERR /
  // OFF) was removed on 2026-06-17 — it reflected the retired in-engine
  // mic listener, which is obsolete now that the Audio Companion is the
  // sole analyzer. The cross-machine "configured_mic_not_found" /
  // "device_enumeration_failed" capture errors still surface in the
  // MicNotFoundBanner below. The OSC + BPM SYNC pills (which reflect the
  // Companion's OSC path) stay.
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
  const effectiveBpm = tempoLive.audioBpm > 0 ? tempoLive.audioBpm : tempoLive.tempoBpm;
  const bpm = effectiveBpm > 0 ? Math.round(effectiveBpm) : null;

  return (
    <View style={{ marginBottom: 24 }}>
      {/* Status pills row + LIVE rate on the right. This is a normal
          section of the page (no longer a pinned strip) — it flows in the
          single page ScrollView so the whole AUDIO tab scrolls as one. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <StatusPill label={oscLabel} tone={oscTone} />
        <StatusPill label={syncOn ? 'BPM SYNC ON' : 'BPM SYNC OFF'} tone={syncTone} />
        <View style={{ flex: 1 }} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, letterSpacing: 0.8,
        }}>LIVE · 60 FPS</Text>
      </View>
      {/* Section header — "AUDIO SIGNALS" on the left, the live BPM read-out
          on the right. BPM is the song tempo, NOT an analyser signal, so it
          sits OUTSIDE the signal grid (its own headline chip) rather than
          riding as a grid cell styled like the meters. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: C.secondary, textTransform: 'uppercase', letterSpacing: 1,
        }}>AUDIO SIGNALS</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
            color: C.secondary, letterSpacing: 0.8, textTransform: 'uppercase',
          }}>BPM</Text>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22,
            color: bpm ? C.primary : C.icon,
          }}>{bpm ?? '—'}</Text>
        </View>
      </View>
      {slots.length === 0 ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, paddingVertical: 12 }}>
          No live audio signals yet — design them in the Audio Companion (a raw source → ops → an OSC-out), and they appear here.
        </Text>
      ) : (
        // Full-height 3×N grid that wraps to new rows. No inner scroll /
        // height cap — the whole AUDIO tab is ONE page ScrollView, so the
        // grid simply lays out at full height and scrolls with everything
        // else (no pinned strip, no nested scroller to fight the page).
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {slots.map((slot) => (
            <View key={slot.key} style={{ width: `${100 / SIGNAL_GRID_COLUMNS}%`, paddingHorizontal: 6, marginBottom: 10 }}>
              <SignalColumn
                slot={slot}
                raw={valueOf(slot.rawKey)}
                post={valueOf(slot.postKey)}
                active={active}
                traceHeight={PINNED_TRACE_HEIGHT}
              />
            </View>
          ))}
        </View>
      )}
      {/* INPUT GAIN — software mic-preamp, UNDER the grid. A REAL engine
          gain (patches audio.bands.inputGain): it lifts the mic bands
          above the noise gate so a quiet mic/feed drives the meters AND
          the detectors/patterns. */}
      <View style={{ marginTop: 4, marginHorizontal: 6, maxWidth: 360 }}>
        <FaderRow
          label="INPUT GAIN"
          suffix="×"
          min={INPUT_GAIN_MIN}
          max={INPUT_GAIN_MAX}
          step={0.1}
          value={inputGain}
          hint="Software mic-preamp (0–10×). Boosts a quiet mic/line feed so the mic bands lift above the noise gate — affects the engine (meters + kick + patterns), not just the display."
          onDrag={() => { /* FaderRow shows the live draft; commit on release */ }}
          onCommit={onCommitInputGain}
        />
      </View>
    </View>
  );
}

// STRUCTURE DETECTOR card — RETIRED (2026-06-17). The dedicated
// build/drop/sustain preview card (StructureDetectorCard +
// StructureSignalColumn + the STRUCTURE_* state-mirror helpers) was an
// unused, under-development preview and has been removed. The build /
// energy / slow signals it previewed still arrive on the live bus and
// surface in the dynamic AUDIO SIGNALS row at the top of this tab when
// the Companion routes them in. Restore from git history if a dedicated
// detector card returns to CaptainPad.

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
  // Prefer the Companion's analyzed tempo (audioBpm); fall back to
  // tempoBpm (legacy /lx/tempo/bpm path) only when audioBpm is absent.
  const live = useLiveParamValues({ audioBpm: 0, tempoBpm: 0 } as Record<string, number>) as Record<string, number>;
  if (!bpmSyncOn) return null;
  const effectiveBpm = live.audioBpm > 0 ? live.audioBpm : live.tempoBpm;
  const bpmStale = !effectiveBpm || effectiveBpm <= 0;
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
          ? `OSC listener is ${oscState ?? 'unknown'}; the Audio Companion isn't streaming a BPM. Speed will not move.`
          : 'OSC is live but no BPM has arrived yet. Confirm the Audio Companion is analyzing tempo and streaming audioBpm.'}
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
// audioBpm/tempoBpm + bpmSpeedMin/Max so the rest of the BPM card doesn't
// re-render on every tempo tick. Prefers the Companion's analyzed tempo
// (audioBpm); falls back to tempoBpm only when audioBpm is absent.
function BpmInlineReadout() {
  const C = usePalette();
  const live = useLiveParamValues({ audioBpm: 0, tempoBpm: 0 } as Record<string, number>) as Record<string, number>;
  const steady = useSharedParamValues({ bpmSpeedMin: 60, bpmSpeedMax: 180 } as Record<string, number>) as Record<string, number>;
  const bpm = live.audioBpm > 0 ? live.audioBpm : live.tempoBpm;
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
        Maps live tempo ({BPM_MIN_ABS}–{BPM_MAX_ABS} BPM) onto speed 0–1. Sync drives global SPEED from the Audio Companion&apos;s analyzed BPM (audioBpm).
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
  // <LiveAudioMeters /> + <BpmTempoLine /> — which each subscribe to
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

  // The per-band/per-kick `updateLocal` + `commitField` helpers were
  // retired with the SIGNALS · CHAINS card (2026-06-17) — they fed the
  // chain editor's embedded analyzer sliders, which now live in the
  // Audio Companion. The analyzer config still reaches the engine via
  // patchAudioConfig (source, input gain, mic device, reset) below.

  // Reset to defaults — Phase 6, docs/29 §Interactions step 7. Fires
  // BOTH endpoints (analyzer config + every signal's default chain).
  // Surfaces inline error if either fails. The chains reset is still fired
  // so a CaptainPad reset restores engine-side signal chains to defaults
  // even though chain DESIGN now lives in the Audio Companion (the chain
  // editor card was removed from this tab on 2026-06-17).
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

  // Software INPUT GAIN (audio.bands.inputGain) — real engine gain set from
  // the pinned strip slider. Optimistic local update, then patch + reload.
  const commitInputGain = useCallback(async (g: number) => {
    if (!cfg) return;
    const clamped = Math.max(INPUT_GAIN_MIN, Math.min(INPUT_GAIN_MAX, g));
    setCfg(prev => prev && ({ ...prev, bands: { ...prev.bands, inputGain: clamped } }));
    const r = await patchAudioConfig({ bands: { inputGain: clamped } });
    if (!r.ok) { setPatchError(r.error || 'failed to set input gain'); reload(); }
    else { setPatchError(null); }
  }, [cfg, reload, setCfg]);

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

  // Audio SOURCE is always the MIC / capture device (operator brief
  // 2026-06-17). The TEST (synthetic) and FILE (clip replay) sources were
  // removed from this tab — the deck runs off the live mic. The CAPTURE
  // DEVICE picker below sets `capture.device` (which the Companion honors);
  // there is no source-mode switch anymore.

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
  // tabs to layout sidebars). For AUDIO we want a single full-width
  // COLUMN that is ONE scrollable area — title, live meters, sync, and
  // settings all flow inside the same page ScrollView (no pinned strip).
  return (
    <View style={{ flex: 1, flexDirection: 'column', backgroundColor: C.background }}>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 16 }}>
          <IconSymbol name="waveform" size={32} color={C.primary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, color: C.text, letterSpacing: 1.5 }}>
            AUDIO
          </Text>
        </View>

        {/* Live meters — now a normal in-flow section (not a pinned
            strip), so the whole AUDIO tab is one scrollable area. All
            live-data subscriptions live INSIDE this component. */}
        <LiveAudioMeters
          oscStatus={oscStatus}
          inputGain={cfg?.bands?.inputGain ?? 1}
          onCommitInputGain={commitInputGain}
        />

        {patchError ? (
          <View style={{ ...CARD, borderColor: C.error, backgroundColor: 'rgba(186, 26, 26, 0.06)' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>REQUEST REJECTED</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>{patchError}</Text>
          </View>
        ) : null}

        {/* MIC ANALYSIS — RETIRED (2026-06-17). The master enable/disable
            toggle (MasterToggle) drove the in-engine mic listener's
            FFT → bands + kick analyzer. That analyzer is obsolete now that
            the Marsin Audio Companion is the sole analyzer: the engine no
            longer analyzes audio, and the toggle only fought the Companion
            for the capture device (producing a confusing "MIC RESTARTING"
            state). The card + its toggle + the toggleEnabled handler + the
            in-engine MIC status pill were removed. Capture SOURCE / device
            config still lives in SETTINGS below. Restore from git history
            if the in-engine analyzer ever returns. */}

        {/* ── 1. BPM → SPEED SYNC (compact) ─────────────────────────────
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

        {/* STRUCTURE DETECTOR — RETIRED (2026-06-17). The dedicated
            build/drop/sustain preview card was an unused, under-
            development preview and has been removed. The build / energy /
            slow signals the detector previewed still surface in the
            dynamic AUDIO SIGNALS row at the top of this tab whenever the
            Companion routes them in over OSC. */}

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

        {/* SIGNALS · CHAINS — RETIRED (2026-06-17). Chain / signal DESIGN
            now lives in the Marsin Audio Companion; CaptainPad is a lean
            control/monitor surface. The designed signals arrive in the
            engine CPC over OSC from the Companion and are shown in the
            pinned AUDIO SIGNALS row at the top of this tab
            (useAudioSignals / useLiveParams). The per-signal chain editor
            (AudioChainsCard) and the analyzer commit handlers it consumed
            were removed here. Restore from git history if the editor ever
            comes back to CaptainPad. */}

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
                Overall gain · Device · Engine · Reset
              </Text>
            </View>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: C.secondary }}>
              {settingsCollapsed ? '▾' : '▴'}
            </Text>
          </TouchableOpacity>

          {!settingsCollapsed ? (
            <View style={{ marginTop: 16 }}>
              {/* ── OVERALL GAIN ─────────────────────────────────────────
                  The single software preamp the whole PCM lane sees (bands /
                  kick / dom / FFT). Live-tunable (audio.bands.inputGain). Same
                  control as the strip's INPUT GAIN — one source of truth. */}
              <View style={SUB_CARD}>
                <SubHeader title="OVERALL GAIN" />
                <FaderRow
                  label="INPUT GAIN"
                  suffix="×"
                  min={INPUT_GAIN_MIN}
                  max={INPUT_GAIN_MAX}
                  step={0.1}
                  value={cfg?.bands?.inputGain ?? 1}
                  hint="Software preamp on the audio input (0–10×). Boosts a quiet feed so every signal lifts above the noise gate — affects the engine, not just the display."
                  onDrag={() => { /* commit on release */ }}
                  onCommit={commitInputGain}
                />
              </View>

              {/* ── MICROPHONE / CAPTURE DEVICE ───────────────────────── */}
              <View style={SUB_CARD}>
                <SubHeader
                  title="CAPTURE DEVICE"
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
