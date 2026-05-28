import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { updateParamCenter } from '@/utils/api';
import { MiniFader } from '@/components/ui/MiniFader';
import { useSharedParamValues, useLiveParamValues, useOscStatus } from '@/hooks/useEngineState';
import { OscStatusPill } from '@/components/OscStatusPill';
import { ColorPickerModal, DualSwatch } from '@/components/ColorPickerModal';
import { IconSymbol } from '@/components/ui/icon-symbol';

// BPM-sync "auto-driven" accent (green). Lives here as a local
// constant so this file doesn't depend on a brand-new theme token
// landing in every consumer's TS server cache. Mirrors the value in
// constants/theme.ts → C.tertiary.
const ACCENT_AUTO = '#1b9e77';

// Live state flows through the module-level `useEngineState`
// subscription, so this component has no props. Pre-split it took
// a `wsRef` prop for sending sharedParam writes; that's now
// `engineEvents.send(...)` via `updateParamCenter`.
export const CPCControls = () => {
  const C = usePalette();
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
    // 0..gainMax from config). The master `audioReactivity` scale
    // was retired 2026-05-26 — per-stem gains in the Audio Analysis
    // tab are the only level control now. BPM is an OSC-driven
    // readout from LX Studio.
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
  // Live keys all ride /ws/signals at the analyser's broadcastHz (mic*
  // and stems* are 15-30 Hz; tempoBpm is 5 Hz). Reading them via
  // useLiveParamValues — instead of via useSharedParamValues like the
  // rest of CPC — keeps the meters in the deck/mixer chrome ticking
  // at the engine's actual rate. Pre-fix they were stuck at the boot
  // sharedParams snapshot because sharedParams only re-broadcasts when
  // an operator turns a knob, not on every analyser tick.
  const live = useLiveParamValues({
    micLow: 0, micMid: 0, micHigh: 0, micKick: 0,
    stemsVocals: 0, stemsBass: 0, stemsDrums: 0,
    tempoBpm: 0,
  });
  const params = useMemo(
    () => ({ ...steadyParams, ...live }),
    [steadyParams, live],
  );
  // The Deck's two old per-colour swatches collapsed into one COLORS
  // button (May 2026). The picker itself lives in ColorPickerModal —
  // hue-only writes, atomic dual apply, presets sourced from
  // config.yaml. We only track open/closed here.
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  // Collapsible Global Params + Audio Reactivity rows (operator review
  // May 2026): the top strip eats 2× the vertical space the pattern
  // selection actually needs, especially in landscape on the iPad
  // Pro 11". The collapse keeps the OSC pill / BPM / a glance-at
  // SPEED & REACT value visible so a quick check at the edge of the
  // venue still reads at a glance. State is client-side only; it
  // resets on app cold-boot which matches the operator's expectation
  // (they want to start every show with the full picture).
  const [globalsCollapsed, setGlobalsCollapsed] = useState(false);
  const [audioCollapsed, setAudioCollapsed] = useState(false);

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
  // Operator request May 26 2026: when sync is ON, show the live BPM
  // beside the SPEED %. Format: "BPM 128 · 73%" — the MiniFader
  // already prints the percent, so the badge carries the BPM half.
  // Falls back to "BPM —" if the analyser hasn't seen a tempo yet
  // so the operator knows sync is wired but starving for tempo input.
  const speedBadge    = bpmSyncOn
    ? `BPM ${bpm > 0 ? Math.round(bpm) : '—'}`
    : undefined;
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
          glued together. The label cell also doubles as the
          collapse-toggle hit target (operator review May 2026 — they
          asked for a one-tap "give me back the vertical space" so
          taller iPads can squeeze in more pattern rows). */}
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={() => setGlobalsCollapsed(c => !c)}
          accessibilityLabel={globalsCollapsed ? 'Expand global parameters' : 'Collapse global parameters'}
          style={{ width: labelWidth, marginRight: labelGap, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <IconSymbol name={globalsCollapsed ? 'chevron.right' : 'chevron.down'} size={10} color={C.secondary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>{isPortrait ? 'GLOBALS' : 'GLOBAL PARAMS'}</Text>
        </TouchableOpacity>

        {globalsCollapsed ? (
          <CollapsedGlobalsSummary
            speed={speedDisplay}
            speedBadge={speedBadge}
            speedFill={speedFill}
            size={params.size ?? 0.5}
            h1={params.colorPalette1?.h ?? 0}
            h2={params.colorPalette2?.h ?? 0.5}
            bpm={params.tempoBpm ?? 0}
            onEditColors={() => setColorPickerOpen(true)}
          />
        ) : (
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
              isPortrait={isPortrait}
              onPress={() => setColorPickerOpen(true)}
            />

            {/* BPM tile sits just before the OSC pill — a "tempo + source
                health" cluster at the end of the row. */}
            <BpmTile bpm={params.tempoBpm ?? 0} isPortrait={isPortrait} synced={bpmSyncOn} />

            <OscStatusPill compact={isPortrait} />
          </View>
        )}
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
            directly under SPEED — no white-space gap. The label
            cell also doubles as the collapse-toggle hit target. */}
        <TouchableOpacity
          onPress={() => setAudioCollapsed(c => !c)}
          accessibilityLabel={audioCollapsed ? 'Expand audio reactivity' : 'Collapse audio reactivity'}
          style={{ width: labelWidth, marginRight: labelGap, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <IconSymbol name={audioCollapsed ? 'chevron.right' : 'chevron.down'} size={10} color={C.secondary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>{isPortrait ? 'AUDIO' : 'AUDIO REACTIVITY'}</Text>
        </TouchableOpacity>

        {audioCollapsed ? (
          // Live mic/stem values arrive already post-gain (gain applied
          // at the source in audio_analyzer.js / osc_listener.js before
          // the value reaches CPC). Do NOT multiply by *Gain here — that
          // would double-gain the meter. The patterns receive the same
          // post-gain values, so what you see here is what the patterns
          // see. See docs/29 for the architecture.
          <CollapsedAudioSummary
            isPortrait={isPortrait}
            bass={params.stemsBass ?? 0}
            drums={params.stemsDrums ?? 0}
            vocals={params.stemsVocals ?? 0}
            kick={params.micKick ?? 0}
          />
        ) : (
          // Master REACTIVITY MiniFader was removed 2026-05-26 (operator
          // review): per-stem gains in the Audio Analysis tab are now
          // the only level controls, freeing this row to be all live
          // meters at full width.
          //
          // Values below are already post-gain — see comment above.
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 6 : 10, paddingRight: isPortrait ? 4 : 12 }}>
              <LiveMeterColumn
                isPortrait={isPortrait}
                top={{ label: 'BASS',   value: params.stemsBass   ?? 0 }}
                bot={{ label: 'DRUMS',  value: params.stemsDrums  ?? 0 }}
              />
              <LiveMeterColumn
                isPortrait={isPortrait}
                top={{ label: 'VOCALS', value: params.stemsVocals ?? 0 }}
                bot={{ label: 'LOW',    value: params.micLow      ?? 0 }}
              />
              <LiveMeterColumn
                isPortrait={isPortrait}
                top={{ label: 'MID',    value: params.micMid      ?? 0 }}
                bot={{ label: 'HIGH',   value: params.micHigh     ?? 0 }}
              />
              <LiveMeterColumn
                isPortrait={isPortrait}
                top={{ label: 'KICK',   value: params.micKick     ?? 0, accent: true }}
              />
          </View>
        )}
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
// Compact-tile shape shared by COLORS / BPM / OSC. Operator review
// 2026-05-28 — these three should read as one cluster (visual signal +
// status cluster) distinct from the SPEED/SIZE sliders.
const GLOBALS_TILE_WIDTH_PORTRAIT  = 60;
const GLOBALS_TILE_WIDTH_LANDSCAPE = 86;
const GLOBALS_TILE_HEIGHT = 48;

function ColorPairButton({ h1, h2, isPortrait, onPress }: { h1: number; h2: number; isPortrait: boolean; onPress: () => void }) {
  const C = usePalette();
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel="Open colour picker"
      accessibilityRole="button"
      style={{
        width: w, height: GLOBALS_TILE_HEIGHT,
        paddingVertical: 4, paddingHorizontal: 6,
        borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
        backgroundColor: C.surface,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8,
        }}>
          COLORS
        </Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <DualSwatch h1={h1} h2={h2} size={22} />
      </View>
    </TouchableOpacity>
  );
}

// ── Audio cells ─────────────────────────────────────────────────────────────
//
// The Deck's audio row is read-only: four compact LiveMeterColumns
// showing what's reaching the pattern after `stemGain` is applied.
// Per-band gain sliders live in the Audio Analysis tab now (see
// CaptainPad/app/(tabs)/audio.tsx → GainRow). The master
// `audioReactivity` scale was retired 2026-05-26 — there is no
// global level above per-stem gains anymore.
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
  const C = usePalette();
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
  const C = usePalette();
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
  const C = usePalette();
  const hasSignal = bpm > 0;
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  // Green border + dot when BPM is auto-driving speed, so the
  // operator can spot from across the venue whether the show is
  // currently hands-on or beat-locked.
  const accent = synced ? ACCENT_AUTO : hasSignal ? C.primary : C.ghostBorder;
  return (
    <View style={{
      width: w, height: GLOBALS_TILE_HEIGHT,
      paddingVertical: 4, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: synced ? ACCENT_AUTO : C.ghostBorder,
      backgroundColor: C.surface,
      justifyContent: 'space-between',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: synced ? ACCENT_AUTO : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          BPM
        </Text>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
      </View>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 20,
        color: hasSignal ? C.text : C.icon,
        textAlign: 'center',
        lineHeight: 22,
      }}>
        {hasSignal ? Math.round(bpm) : '—'}
      </Text>
    </View>
  );
}

// ── Collapsed-row summaries ────────────────────────────────────────────
//
// One-line read-only snapshots for the GLOBAL PARAMS and AUDIO
// REACTIVITY rows. The label cell's chevron toggles between these
// summaries and the full editor rows above. Operator-perceptible
// data only — SPEED %, SIZE %, the dual-hue swatch, BPM readout for
// globals; four micro-meters (BASS / DRUMS / VOX / KICK) for audio
// (the master REACT readout was retired with audioReactivity on
// 2026-05-26). Sized so the row fits in ~24px regardless of orientation.

function CollapsedGlobalsSummary({
  speed, speedBadge, speedFill, size, h1, h2, bpm, onEditColors,
}: {
  speed: number; speedBadge?: string; speedFill?: string;
  size: number; h1: number; h2: number; bpm: number;
  onEditColors: () => void;
}) {
  const C = usePalette();
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 8, height: 24 }}>
      <CollapsedReadout label="SPEED" value={Math.round(speed * 100)} accent={speedFill} badge={speedBadge} />
      <CollapsedReadout label="SIZE" value={Math.round(size * 100)} />
      <TouchableOpacity onPress={onEditColors} accessibilityLabel="Open colour picker" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <DualSwatch h1={h1} h2={h2} size={18} />
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>COLORS</Text>
      </TouchableOpacity>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        BPM <Text style={{ color: bpm > 0 ? C.text : C.icon }}>{bpm > 0 ? Math.round(bpm) : '—'}</Text>
      </Text>
      <View style={{ flex: 1 }} />
      <OscStatusPill compact />
    </View>
  );
}

function CollapsedAudioSummary({
  isPortrait, bass, drums, vocals, kick,
}: {
  isPortrait: boolean;
  bass: number; drums: number; vocals: number; kick: number;
}) {
  // Master REACT readout was removed alongside the audioReactivity
  // param on 2026-05-26. The four micro-meters are the whole summary
  // now.
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 14, paddingRight: 8, height: 24 }}>
      <CollapsedMeter label="BAS" value={bass} />
      <CollapsedMeter label="DRM" value={drums} />
      <CollapsedMeter label="VOX" value={vocals} />
      <CollapsedMeter label="KCK" value={kick} accent />
    </View>
  );
}

function CollapsedReadout({ label, value, accent, badge }: { label: string; value: number; accent?: string; badge?: string }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: accent || C.text }}>{value}</Text>
      {badge ? (
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 7, color: accent || C.secondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>{badge}</Text>
      ) : null}
    </View>
  );
}

function CollapsedMeter({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const C = usePalette();
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ flex: 1, minWidth: 36, maxWidth: 70, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: C.surfaceContainerHigh, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${v * 100}%`, backgroundColor: accent ? C.primaryContainer : C.primary }} />
      </View>
    </View>
  );
}
