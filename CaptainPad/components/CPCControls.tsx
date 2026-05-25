import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Colors } from '@/constants/theme';
import { updateParamCenter } from '@/utils/api';
import { MiniFader } from '@/components/ui/MiniFader';
import { useSharedParamValues, useLiveParamValues, useOscStatus } from '@/hooks/useEngineState';
import { OscStatusPill } from '@/components/OscStatusPill';
import { ColorPickerModal, DualSwatch } from '@/components/ColorPickerModal';

const C = Colors.light;
// BPM-sync "auto-driven" accent (green). Lives here as a local
// constant so this file doesn't depend on a brand-new theme token
// landing in every consumer's TS server cache. Mirrors the value in
// constants/theme.ts → Colors.light.tertiary.
const ACCENT_AUTO = '#1b9e77';

// Note: the `wsRef` prop is accepted for backward-compat with the
// existing tab files but no longer required — live state now flows
// through the module-level `useEngineState` subscription, which means
// PortWatch / scripts / any future external writer ends up reflected
// here automatically.
export const CPCControls = ({ wsRef: _wsRef }: { wsRef?: unknown } = {}) => {
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const defaultParams = useMemo(() => ({
    speed: 0.5,
    size: 0.5,
    rotate: 0,
    colorPalette1: { h: 0, s: 1, v: 1 },
    colorPalette2: { h: 0.5, s: 1, v: 1 },
    // Audio row. See marsin_engine/lib/param_center.js for full
    // semantics. Three stems with per-stem operator gains (range
    // 0..gainMax from config), one master `audioReactivity`, and
    // an OSC-driven BPM readout from LX Studio.
    audioReactivity: 0.5,
    stemsVocals: 0.0,
    stemsBass: 0.0,
    stemsDrums: 0.0,
    stemsVocalsGain: 1.0,
    stemsBassGain: 1.0,
    stemsDrumsGain: 1.0,
    tempoBpm: 0.0,
    // Mic-derived bands + kick (docs/25). Same operator-gain × master
    // contract as the OSC stems so patterns can treat them uniformly.
    micLow: 0.0,
    micMid: 0.0,
    micHigh: 0.0,
    micKick: 0.0,
    micLowGain: 1.0,
    micMidGain: 1.0,
    micHighGain: 1.0,
    micKickGain: 1.0,
    // BPM → speed sync visibility on the Deck (docs/25 §6). Read-only
    // here; the operator changes them from the Audio Analysis tab.
    bpmSpeedSync: 0.0,
    bpmSpeedMin: 60,
    bpmSpeedMax: 180,
  }), []);

  // Live shared-param values. Every sharedParams broadcast (whether it
  // originated from this UI, PortWatch over LoRa, or any script) flows
  // through the engineEvents bus → useSharedParamValues → here, so the
  // sliders/colour swatches always show the canonical engine state.
  //
  // tempoBpm is on the separate `liveParams` channel because it
  // ticks at the analyser's rate; reading it via useLiveParamValues
  // keeps this component's re-render scope tight (the BpmTile child
  // is the only thing that visibly changes when BPM nudges).
  const steadyParams = useSharedParamValues(defaultParams) as typeof defaultParams;
  const { tempoBpm } = useLiveParamValues({ tempoBpm: 0 });
  const params = useMemo(() => ({ ...steadyParams, tempoBpm }), [steadyParams, tempoBpm]);
  // The Deck's two old per-colour swatches collapsed into one COLORS
  // button (May 2026). The picker itself lives in ColorPickerModal —
  // hue-only writes, atomic dual apply, presets sourced from
  // config.yaml. We only track open/closed here.
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // Writers post to /param-center. The engine's POST handler
  // broadcasts a fresh sharedParams to every subscriber (including us),
  // so we don't need a separate optimistic local-state path — the
  // broadcast round-trip is already sub-second on Wi-Fi.
  const update = (key: string, val: any) => {
    updateParamCenter({ [key]: val });
  };

  const faderMaxWidth = isPortrait ? 90 : 140;
  // Shared label column for row-1 and row-2 so REACT lines up under
  // SPEED. labelGap is the same number for both rows; widening one
  // requires widening both — that's the whole point of the constants.
  const labelWidth = isPortrait ? 60 : 110;
  const labelGap   = isPortrait ? 8 : 12;

  // Master reactivity gates every stem. Patterns combine these as
  // `audioReactivity * stemsXGain * stemsX` — see CPC registry.
  const master = params.audioReactivity ?? 0;

  // BPM → speed sync surface state (see docs/25 §6 + Audio tab). When
  // sync is ON we tag the SPEED fader green and pull its display from
  // the live mapped value so the operator can see "speed is being
  // auto-driven by tempoBpm" without leaving the Deck. We also surface
  // a warning if sync expects OSC but OSC isn't flowing.
  const oscStatus  = useOscStatus();
  const bpmSyncOn  = (params.bpmSpeedSync ?? 0) >= 0.5;
  const bpmMin     = params.bpmSpeedMin ?? 60;
  const bpmMax     = params.bpmSpeedMax ?? 180;
  const bpm        = params.tempoBpm ?? 0;
  const bpmMapped  =
    bpmSyncOn && bpm > 0 && bpmMin !== bpmMax
      ? Math.max(0, Math.min(1, (bpm - bpmMin) / (bpmMax - bpmMin)))
      : null;
  const speedDisplay  = bpmMapped !== null ? bpmMapped : (params.speed ?? 0.5);
  const speedFill     = bpmSyncOn ? ACCENT_AUTO : undefined;
  const speedBadge    = bpmSyncOn ? 'BPM' : undefined;
  const bpmSyncStale  = bpmSyncOn && (
    (oscStatus && oscStatus.state !== 'live') || bpm <= 0
  );

  return (
    <View style={{ backgroundColor: C.surfaceContainerLowest, padding: isPortrait ? 8 : 12, borderBottomWidth: 1, borderBottomColor: C.ghostBorder, gap: isPortrait ? 8 : 10 }}>

      {/* ── Warning banner: BPM sync expects OSC but it's not flowing ─ */}
      {bpmSyncStale ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
          borderWidth: 1, borderColor: C.error,
          backgroundColor: 'rgba(255,80,80,0.10)',
        }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 10 }}>⚠ BPM SYNC ON · NO OSC TEMPO</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 11, flex: 1 }}>
            Speed will not move until /lx/tempo/bpm starts arriving. Disable sync on the Audio tab, or fix the OSC source.
          </Text>
        </View>
      ) : null}

      {/* ── Row 1: pattern globals + colour swatches + BPM + OSC pill ─ */}
      {/* Order: SPEED · SIZE · C1 · C2 · BPM · OSC. `count` and `dir`
          were demoted to pattern-local in May 2026 — they were too
          per-pattern to act as globals. The OSC pill is intentionally
          LAST so the eye finishes the row on health status rather than
          starting there. */}
      {/* Row labels share `labelWidth` so the first slider in each row
          starts at the same x. Tweaking one number keeps the two rows
          glued together. */}
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' }}>
        <View style={{ width: labelWidth, marginRight: labelGap, justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>{isPortrait ? 'GLOBALS' : 'GLOBAL PARAMS'}</Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: isPortrait ? 8 : 20, paddingRight: isPortrait ? 4 : 12, flex: 1 }}>
          <View style={{ flex: 1, maxWidth: faderMaxWidth }}>
            <MiniFader
              label="SPEED"
              value={speedDisplay}
              fillColor={speedFill}
              badge={speedBadge}
              onChange={(v) => update('speed', v)}
            />
          </View>

          <View style={{ flex: 1, maxWidth: faderMaxWidth }}>
            <MiniFader label="SIZE" value={params.size ?? 0.5} onChange={(v) => update('size', v)} />
          </View>

          {/* Single COLORS button. Tapping opens the tabbed picker
              (Presets · Manual) — see ColorPickerModal. We render both
              hues as a split-circle swatch so the operator can see the
              current pair at a glance without opening the modal. */}
          <ColorPairButton
            h1={params.colorPalette1?.h ?? 0}
            h2={params.colorPalette2?.h ?? 0.5}
            onPress={() => setColorPickerOpen(true)}
          />

          {/* BPM tile sits just before the OSC pill — a "tempo + source
              health" cluster at the end of the row. */}
          <BpmTile bpm={params.tempoBpm ?? 0} isPortrait={isPortrait} synced={bpmSyncOn} />

          <OscStatusPill compact={isPortrait} />
        </View>
      </View>

      {/* ── Row 2: audio — REACT + compact live-only meter columns ──────
          New layout (per operator review):
            REACT slider · [BAS+DRM] · [VOC+LOW] · [MID+HIGH] · [KICK]
          The deck shows ONLY live data — operators set per-band gains
          from the Audio Analysis tab, not here. The meter rows are
          intentionally NOT touch-responsive (they show effective
          post-gain energy that's already being driven by OSC / mic).
       */}
      <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.ghostBorder, paddingTop: isPortrait ? 6 : 8 }}>
        {/* Same labelWidth + labelGap as row 1 so REACT lines up
            directly under SPEED — no white-space gap. */}
        <View style={{ width: labelWidth, marginRight: labelGap, justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>{isPortrait ? 'AUDIO' : 'AUDIO REACTIVITY'}</Text>
        </View>

        {/* Master REACT — same shape (flex:1, maxWidth: faderMaxWidth)
            as every fader in row 1, so it sits in the SPEED column. */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 20, paddingRight: isPortrait ? 4 : 12 }}>
          <View style={{ flex: 1, maxWidth: faderMaxWidth }}>
            <MiniFader
              label={isPortrait ? 'REACT' : 'REACTIVITY'}
              value={master}
              onChange={(v) => update('audioReactivity', v)}
            />
          </View>

          <View style={{ flex: 1, flexDirection: 'row', gap: isPortrait ? 6 : 10 }}>
            <LiveMeterColumn
              isPortrait={isPortrait}
              top={{ label: 'BASS',   value: (params.stemsBass   ?? 0) * (params.stemsBassGain   ?? 1) }}
              bot={{ label: 'DRUMS',  value: (params.stemsDrums  ?? 0) * (params.stemsDrumsGain  ?? 1) }}
            />
            <LiveMeterColumn
              isPortrait={isPortrait}
              top={{ label: 'VOCALS', value: (params.stemsVocals ?? 0) * (params.stemsVocalsGain ?? 1) }}
              bot={{ label: 'LOW',    value: (params.micLow      ?? 0) * (params.micLowGain      ?? 1) }}
            />
            <LiveMeterColumn
              isPortrait={isPortrait}
              top={{ label: 'MID',    value: (params.micMid      ?? 0) * (params.micMidGain      ?? 1) }}
              bot={{ label: 'HIGH',   value: (params.micHigh     ?? 0) * (params.micHighGain     ?? 1) }}
            />
            <LiveMeterColumn
              isPortrait={isPortrait}
              top={{ label: 'KICK',   value: (params.micKick     ?? 0) * (params.micKickGain     ?? 1), accent: true }}
            />
          </View>
        </View>
      </View>

      {/* Tabbed colour picker. Hue-only writes — see ColorPickerModal. */}
      <ColorPickerModal
        visible={colorPickerOpen}
        initialH1={params.colorPalette1?.h ?? 0}
        initialH2={params.colorPalette2?.h ?? 0.5}
        onClose={() => setColorPickerOpen(false)}
      />
    </View>
  );
};

// ── Small subcomponents ────────────────────────────────────────────────────

/**
 * Single COLORS button on the Deck. Shows both global hues as a split
 * circle so the operator can confirm the current pair at a glance.
 * Tapping opens the tabbed picker (Presets · Manual).
 */
/**
 * Single COLORS button. Wide pill (~96px) sized so it sits comfortably
 * next to the SPEED/SIZE MiniFaders and gives the operator a fat
 * tap-target on the iPad. Shows both global hues as a split-circle
 * preview + a "COLORS" caption; opens the tabbed picker on tap.
 */
function ColorPairButton({ h1, h2, onPress }: { h1: number; h2: number; onPress: () => void }) {
  return (
    <View>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', marginBottom: 2 }}>COLORS</Text>
      <TouchableOpacity
        onPress={onPress}
        accessibilityLabel="Open colour picker"
        accessibilityRole="button"
        style={{
          minWidth: 96, paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 10, borderWidth: 1, borderColor: C.ghostBorder,
          backgroundColor: C.surface,
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }}
      >
        <DualSwatch h1={h1} h2={h2} size={32} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
          color: C.text, letterSpacing: 0.6,
        }}>
          EDIT
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Audio cells ─────────────────────────────────────────────────────────────
//
// The Deck's audio row is read-only: four compact LiveMeterColumns
// showing what's reaching the pattern after `audioReactivity *
// stemGain` is applied. Per-band gain sliders live in the Audio
// Analysis tab now (see CaptainPad/app/(tabs)/audio.tsx → GainRow).
/**
 * LiveMeterColumn — compact, read-only "what the patterns are seeing right
 * now" display for the Deck audio row.
 *
 * Two stacked bars (top + bottom) per column, each showing the
 * post-gain, post-master value for one band. The deck used to also
 * own per-band gain sliders, but the operator review (2026-05-24)
 * moved those to the Audio Analysis tab — the deck is for performing,
 * the tab is for tuning. Keeping the meters non-interactive avoids the
 * "I dragged something but nothing changed" confusion the per-stem
 * sliders kept causing.
 *
 * `accent` on the top row uses a brighter fill (e.g. for KICK, which
 * is a transient envelope) so it stands out at a glance.
 */
function LiveMeterColumn({ isPortrait, top, bot }: {
  isPortrait: boolean;
  top: { label: string; value: number; accent?: boolean };
  bot?: { label: string; value: number; accent?: boolean };
}) {
  const cellMinWidth = isPortrait ? 56 : 80;
  return (
    <View style={{
      flex: 1, minWidth: cellMinWidth,
      paddingVertical: 4, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surface,
      justifyContent: 'space-between',
    }}>
      <CompactMeterRow {...top} />
      {bot ? (
        <>
          <View style={{ height: 4 }} />
          <CompactMeterRow {...bot} />
        </>
      ) : null}
    </View>
  );
}

function CompactMeterRow({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: C.text }}>{Math.round(v * 100)}</Text>
      </View>
      <View style={{
        height: 8, borderRadius: 4,
        backgroundColor: C.surfaceContainerHigh,
        overflow: 'hidden',
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${v * 100}%`,
          backgroundColor: accent ? C.primaryContainer : C.primary,
        }} />
      </View>
    </View>
  );
}

// The Deck used to render per-stem GAIN sliders here (StemCell / KickCell).
// Per operator review (2026-05-24), those gain controls moved to the
// Audio Analysis tab and the Deck is now read-only (LiveMeterColumn
// above). If you need the gain UI on a new surface, use the GainRow
// component in CaptainPad/app/(tabs)/audio.tsx.

// BPM gets its own compact tile (no operator gain — it's a tempo
// reference, not a level to scale). The big numeric readout makes
// it easy to glance at from across the venue. A faint pulse-dot
// next to the number lights when fresh data is arriving so the
// operator can tell at a glance whether the upstream LX tempo
// source is live.
function BpmTile({ bpm, isPortrait, synced }: { bpm: number; isPortrait: boolean; synced?: boolean }) {
  const hasSignal = bpm > 0;
  const cellWidth = isPortrait ? 60 : 86;
  // Green border + dot when BPM is auto-driving speed, so the
  // operator can spot from across the venue whether the show is
  // currently hands-on or beat-locked.
  const accent = synced ? ACCENT_AUTO : hasSignal ? C.primary : C.ghostBorder;
  return (
    <View style={{
      width: cellWidth,
      paddingVertical: 4, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: synced ? ACCENT_AUTO : C.ghostBorder,
      backgroundColor: C.surface,
      justifyContent: 'space-between',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: synced ? ACCENT_AUTO : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {synced ? 'BPM ●' : 'BPM'}
        </Text>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
      </View>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: isPortrait ? 20 : 24,
        color: hasSignal ? C.text : C.icon,
        textAlign: 'center',
        lineHeight: isPortrait ? 24 : 28,
      }}>
        {hasSignal ? Math.round(bpm) : '—'}
      </Text>
    </View>
  );
}
