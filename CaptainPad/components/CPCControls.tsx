import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { updateParamCenter, getCachedColorPalettes, warmColorPalettesCache } from '@/utils/api';
import { MiniFader } from '@/components/ui/MiniFader';
import { useSharedParamValues, useLiveParamValues, useLiveParams, useOscStatus, useAudioSignals, type AudioSignalDescriptor } from '@/hooks/useEngineState';
import {
  useTempoState,
  useTempoTap,
  tempoSourceHasOverride,
  type TempoSource,
} from '@/hooks/use_tempo_tap';
import { OscStatusPill } from '@/components/OscStatusPill';
import { ColorPickerModal, ColorQueueModal, DualSwatch, type ColorPalettePreset } from '@/components/ColorPickerModal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { curateDeckSignals, audioAccentHex } from '@/utils/audioSignals';

// BPM-sync "auto-driven" accent (green). Lives here as a local
// constant so this file doesn't depend on a brand-new theme token
// landing in every consumer's TS server cache. Mirrors the value in
// constants/theme.ts → C.tertiary.
const ACCENT_AUTO = '#1b9e77';

// Live state flows through the module-level `useEngineState`
// subscription, so this component has no props. Pre-split it took
// a `wsRef` prop for sending sharedParam writes; that's now
// `engineEvents.send(...)` via `updateParamCenter`.
//
// `trailing` is an optional accessory rendered at the RIGHT end of the
// GLOBALS row (row 1). The mixer uses it to seat its compact GROUPS
// button next to the globals cluster (the channel-grouping UI moved
// into a floating modal launched from there); the deck passes nothing,
// so its globals row is unchanged.
interface CPCControlsProps {
  trailing?: React.ReactNode;
}

export const CPCControls = ({ trailing }: CPCControlsProps = {}) => {
  const C = usePalette();
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const defaultParams = useMemo(() => ({
    speed: 0.5,
    size: 0.5,
    rotate: 0,
    colorPalette1: { h: 0, s: 1, v: 1 },
    colorPalette2: { h: 0.5, s: 1, v: 1 },
    // The audio reactivity row is rendered DYNAMICALLY from the live
    // audio CPC keys the Companion routes in (see useAudioSignals +
    // the live subscription below) — no per-signal keys are listed
    // here, so adding/removing a signal in the Companion can't leave
    // a dead column behind. tempoBpm rides the live bus (its own tile).
    // BPM → speed sync visibility on the Deck (docs/25 §6). Read-only
    // here; the operator changes them from the Audio Analysis tab.
    bpmSpeedSync: 0.0,
    bpmSpeedMin: 60,
    bpmSpeedMax: 180,
  }), []);

  // Dynamic audio-signal set the Companion routes into the CPC. Derived
  // from the engine schema (live audio keys) so the deck/mixer chrome
  // shows exactly what's live — low/mid/high/kick, dom1/dom2, energy,
  // slow, build, party, … — and nothing it doesn't.
  const audioSignals = useAudioSignals();

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
  // The tempo rides /ws/signals at the analyser's broadcastHz (5 Hz).
  // Reading it via useLiveParamValues — instead of via
  // useSharedParamValues like the rest of CPC — keeps the BPM tile
  // ticking at the engine's actual rate. The per-signal audio meters
  // read the whole live doc (useLiveParams) inside <DynamicAudioRow />
  // so the live key set stays dynamic (the Companion can add/remove
  // signals at runtime) without the hook's pinned-key-set hazard.
  //
  // Tempo SOURCE (tempo arbitration, engine feat/optimize_channels): the
  // engine now arbitrates "OSC auto-drives, tap overrides" and broadcasts the
  // APPLIED pattern-clock `tempoBpm` + `tempoSource` + raw `oscTempoBpm` on the
  // mixer/deck control bus. That applied tempo is the SINGLE SOURCE OF TRUTH
  // for what's driving the clock — read it via useTempoState (NOT the
  // analyser's `audioBpm`, which is now only the raw "incoming OSC" readout).
  //
  // `live.audioBpm` (from /ws/signals) is kept ONLY as the secondary "what OSC
  // is hearing" number; it no longer drives the primary BPM display, so the
  // globals tile and the deck TAP button can never disagree about the clock.
  const tempo = useTempoState();
  const live = useLiveParamValues({ audioBpm: 0, tempoBpm: 0 });
  // Primary BPM = the engine-applied pattern clock. Fall back to the live
  // tempoBpm signal only before the first mixer/deck broadcast lands.
  const liveBpm = tempo.bpm != null ? tempo.bpm : (live.tempoBpm ?? 0);
  const params = useMemo(
    () => ({ ...steadyParams, ...live }),
    [steadyParams, live],
  );
  // The Deck's two old per-colour swatches collapsed into one COLORS
  // button (May 2026). The picker itself lives in ColorPickerModal —
  // hue-only writes, atomic dual apply, presets sourced from
  // config.yaml. We only track open/closed here.
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // ── Quick-cue colour queue (operator request 2026-06-16) ────────────
  // A single QUEUE slot sits right of the COLORS button. Empty: tapping
  // it opens a chooser (ColorQueueModal) to pick one curated pair, which
  // ARMS the slot (no light change). Armed: tapping the slot sends that
  // pair LIVE — same colorPalette1/2 the main picker writes, so the
  // engine fades to it over colorTransitionMs (docs/36) — then the cue
  // clears back to empty. The ✕ (top-right) removes the cue without
  // sending. The armed pair is a FROZEN snapshot: editing the main
  // colour never changes it. Cue is local + ephemeral to this pad — only
  // firing writes the shared params.
  const [palettes, setPalettes] = useState<ColorPalettePreset[]>(() => getCachedColorPalettes());
  const [queued, setQueued] = useState<ColorPalettePreset | null>(null);
  const [queuePickerOpen, setQueuePickerOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await warmColorPalettesCache({ force: palettes.length === 0 });
      if (!cancelled && Array.isArray(next) && next.length > 0) setPalettes(next);
    })();
    return () => { cancelled = true; };
    // Load once on mount; the picker modal handles config.yaml live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tap the slot: armed → send live then clear the cue (back to empty);
  // empty → open the chooser.
  const onSlotTap = useCallback(() => {
    if (queued) {
      updateParamCenter({
        colorPalette1: { h: queued.c1, s: 1, v: 1 },
        colorPalette2: { h: queued.c2, s: 1, v: 1 },
      });
      setQueued(null);
    } else {
      setQueuePickerOpen(true);
    }
  }, [queued]);
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

  // QA round8 #2: the GLOBALS row left a ~40% dead gutter to the right of
  // the OSC tile in landscape because the SPEED/SIZE faders were capped at
  // 140 and couldn't grow into the slack. Portrait stays capped (the row is
  // already tight there); landscape uncaps so the two faders flex-grow to
  // absorb the gutter — "big but compact". The inter-tile gap also tightens
  // (20→12) so the cluster reads as intentionally dense rather than sparse.
  const faderMaxWidth = isPortrait ? 90 : undefined;
  const globalsRowGap = isPortrait ? 8 : 12;
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
  // Global tap-tempo cluster (tempo arbitration). Same shared tap logic as the
  // deck TAP button, so a tap from either surface means exactly the same
  // thing. `tempo.source` drives the source tag + the SYNC affordance.
  const { tap: onTap, sync: onTempoSync } = useTempoTap();
  const showSync    = tempoSourceHasOverride(tempo.source);
  const bpmSyncOn  = (params.bpmSpeedSync ?? 0) >= 0.5;
  const bpmMin     = params.bpmSpeedMin ?? 60;
  const bpmMax     = params.bpmSpeedMax ?? 180;
  const bpm        = liveBpm ?? 0;
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
            Speed will not move until the Audio Companion streams a tempo (audioBpm). Disable sync on the Audio tab, or fix the OSC source.
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
          {/* One label in BOTH orientations (round-10 fix): portrait used to
              read "GLOBALS" while landscape read "GLOBAL PARAMS" for the same
              collapsible group. Standardized to "GLOBALS" — the shorter form
              fits the compact label cell in both orientations and matches the
              deck header strip caption. */}
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>GLOBALS</Text>
        </TouchableOpacity>

        {globalsCollapsed ? (
          <CollapsedGlobalsSummary
            speed={speedDisplay}
            speedBadge={speedBadge}
            speedFill={speedFill}
            size={params.size ?? 0.5}
            h1={params.colorPalette1?.h ?? 0}
            h2={params.colorPalette2?.h ?? 0.5}
            bpm={bpm}
            onEditColors={() => setColorPickerOpen(true)}
          />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: globalsRowGap, paddingRight: isPortrait ? 4 : 12, flex: 1 }}>
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

            {/* Twin QUEUE tile — looks like COLORS, but cues. Empty: tap
                opens the chooser; armed: tap sends live; ✕ clears. See
                onSlotTap / QueuedColorSlot. */}
            <QueuedColorSlot
              queued={queued}
              onPress={onSlotTap}
              onClear={() => setQueued(null)}
              isPortrait={isPortrait}
            />

            {/* Global TAP cluster — reachable on every tab that shows the
                GLOBALS bar (deck + mixer), not only the deck header. Tap to
                set the clock (arms the engine's manual override); the source
                tag + SYNC affordance live in the BPM tile to its right. */}
            <GlobalTapTile
              onTap={onTap}
              source={tempo.source}
              isPortrait={isPortrait}
            />

            {/* BPM tile sits just before the OSC pill — the "tempo + source
                health" cluster at the end of the row. Now source-aware: it
                shows the APPLIED tempo + an OSC/TAP/HELD tag, and a SYNC
                affordance when a manual tap override is active. */}
            <BpmTile
              bpm={bpm}
              isPortrait={isPortrait}
              synced={bpmSyncOn}
              source={tempo.source}
              showSync={showSync}
              onSync={onTempoSync}
            />

            <OscStatusPill compact={isPortrait} />
          </View>
        )}

        {/* Optional right-end accessory (mixer-only GROUPS button). Sits at
            the far right of the GLOBALS row so it reclaims the slack the deck
            leaves empty; the deck passes no `trailing`, so its row is
            unchanged. Rendered outside the collapsible body so it stays
            reachable whether or not GLOBALS is collapsed. */}
        {trailing ? (
          <View style={{ marginLeft: globalsRowGap, justifyContent: 'center' }}>
            {trailing}
          </View>
        ) : null}
      </View>

      {/* ── Row 2: audio — dynamic live-only signal meters ──────────────
          The columns are rendered from whatever audio CPC keys the
          Companion routes in (useAudioSignals → the engine schema), so
          adding/removing a signal in the Companion adds/removes a meter
          here automatically. The deck shows ONLY live data — operators
          tune signals in the Companion / Audio tab, not here. The meters
          are intentionally NOT touch-responsive (they show the effective
          post-chain value already being driven into the CPC).
       */}
      <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.ghostBorder, paddingTop: isPortrait ? 6 : 8 }}>
        {/* Same labelWidth + labelGap as row 1 so AUDIO lines up
            directly under SPEED — no white-space gap. The label
            cell also doubles as the collapse-toggle hit target. */}
        <TouchableOpacity
          onPress={() => setAudioCollapsed(c => !c)}
          accessibilityLabel={audioCollapsed ? 'Expand audio signals' : 'Collapse audio signals'}
          style={{ width: labelWidth, marginRight: labelGap, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <IconSymbol name={audioCollapsed ? 'chevron.right' : 'chevron.down'} size={10} color={C.secondary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>{isPortrait ? 'AUDIO' : 'AUDIO SIGNALS'}</Text>
        </TouchableOpacity>

        <DynamicAudioRow
          signals={audioSignals}
          isPortrait={isPortrait}
          collapsed={audioCollapsed}
        />
      </View>

      {/* Tabbed colour picker. Hue-only writes — see ColorPickerModal. */}
      <ColorPickerModal
        visible={colorPickerOpen}
        initialH1={params.colorPalette1?.h ?? 0}
        initialH2={params.colorPalette2?.h ?? 0.5}
        onClose={() => setColorPickerOpen(false)}
      />

      {/* Chooser for the QUEUE tile — selecting a pair arms it (no light
          change); the colour only goes live when the operator taps the
          armed slot. */}
      <ColorQueueModal
        visible={queuePickerOpen}
        presets={palettes}
        onSelect={setQueued}
        onClose={() => setQueuePickerOpen(false)}
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

/**
 * QueuedColorSlot — a twin of the COLORS tile (same width/height/border/
 * swatch) that CUES instead of editing. Empty: a dashed "+" placeholder,
 * tapping opens the chooser (ColorQueueModal) to arm a pair. Armed: shows
 * that pair as a DualSwatch (identical visual to COLORS), caption flips to
 * GO, and tapping sends it live; a ✕ at the top-right removes the cue.
 *
 * The armed pair is a frozen snapshot — editing the main colour never
 * changes it. The ✕ is a sibling overlay (not nested in the main
 * touchable) so its tap can't double-fire the slot.
 */
function QueuedColorSlot({ queued, onPress, onClear, isPortrait }: {
  queued: ColorPalettePreset | null;
  onPress: () => void;
  onClear: () => void;
  isPortrait: boolean;
}) {
  const C = usePalette();
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  return (
    <View style={{
      width: w, height: GLOBALS_TILE_HEIGHT,
      borderRadius: 8, borderWidth: 1, borderColor: queued ? C.primary : C.ghostBorder,
      backgroundColor: C.surface,
    }}>
      <TouchableOpacity
        onPress={onPress}
        accessibilityLabel={queued ? `Send queued colour ${queued.name} live` : 'Open colour queue'}
        accessibilityRole="button"
        style={{ flex: 1, paddingVertical: 4, paddingHorizontal: 6, justifyContent: 'space-between' }}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: queued ? C.primary : C.secondary,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}
        >
          {queued ? 'GO' : 'QUEUE'}
        </Text>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {queued ? (
            <DualSwatch h1={queued.c1} h2={queued.c2} size={22} />
          ) : (
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              borderWidth: 1, borderStyle: 'dashed', borderColor: C.ghostBorder,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, lineHeight: 15, color: C.secondary }}>+</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      {queued ? (
        <TouchableOpacity
          onPress={onClear}
          accessibilityLabel="Remove queued colour"
          accessibilityRole="button"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ position: 'absolute', top: 1, right: 3, padding: 2 }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary }}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Audio cells (dynamic) ────────────────────────────────────────────────────
//
// The Deck's audio row is read-only and DYNAMIC: one compact meter per
// live audio CPC key the Companion routes in (useAudioSignals). The deck
// is for performing; signal tuning lives in the Companion / Audio tab,
// so the meters are non-interactive (they show the value already reaching
// the patterns). Adding/removing a signal in the Companion adds/removes a
// meter here with no code change.

/**
 * DynamicAudioRow — renders the per-signal meters (or the collapsed
 * one-line summary) from the live audio doc + the dynamic signal list.
 * Subscribes to the WHOLE live doc so the key set can change at runtime
 * without tripping useLiveParamValues' pinned-key-set contract.
 *
 * CURATE, DON'T DUMP: the deck/mixer is the densest screen in the app, so
 * this row shows ONLY the best-practice subset (LOW / MID / HIGH / KICK +
 * a beat cue — see utils/audioSignals.ts → curateDeckSignals) rather than
 * the full dynamic set. The FULL set lives on the AUDIO tab. The curation
 * gracefully degrades: a curated cue the Companion isn't publishing is
 * simply omitted. A "+N on AUDIO tab" hint flags how many live signals
 * aren't shown here so the operator knows where the rest are.
 */
function DynamicAudioRow({ signals, isPortrait, collapsed }: {
  signals: AudioSignalDescriptor[];
  isPortrait: boolean;
  collapsed: boolean;
}) {
  const C = usePalette();
  const liveDoc = useLiveParams();
  const valueOf = useCallback((key: string): number => {
    const slot = liveDoc?.params?.[key];
    const v = slot && typeof slot.value === 'number' ? slot.value : 0;
    return v;
  }, [liveDoc]);

  // Best-practice deck subset (LOW/MID/HIGH/KICK + beat cue), in curated
  // order. The remainder count drives the "+N on AUDIO tab" hint.
  const curated = useMemo(() => curateDeckSignals(signals), [signals]);

  if (signals.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', paddingLeft: 4 }}>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: isPortrait ? 9 : 10, color: C.icon }}>
          No live audio signals — design them in the Audio Companion.
        </Text>
      </View>
    );
  }

  // If NONE of the curated cues are live (an exotic Companion routing that
  // publishes signals we don't recognise), fall back to the first few live
  // signals so the row is never blank while audio IS flowing.
  //
  // QA round1 #21: the strip is a SINGLE row, so cap how many cells it shows
  // (4 portrait / 6 landscape) and roll the rest into the "+N on AUDIO tab"
  // hint. Pre-fix the expanded row pushed every curated cue (up to 6) into a
  // narrow portrait strip where each cell's 52px minWidth forced the strip to
  // overflow its right edge.
  const maxCells = isPortrait ? 4 : 6;
  const baseSet = curated.length > 0 ? curated : signals;
  const shownSet = baseSet.slice(0, maxCells);
  const remainder = signals.length - shownSet.length;

  if (collapsed) {
    // One-line micro-meter summary — the curated cues only, so the row
    // stays ~24px regardless of how many the Companion publishes.
    return (
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 14, paddingRight: 8, height: 24 }}>
        {shownSet.map((s) => (
          <CollapsedMeter
            key={s.key}
            label={s.label}
            value={normalizeAudio(s, valueOf(s.postKey))}
            accent={/kick/i.test(s.key)}
          />
        ))}
        {remainder > 0 ? (
          // QA round8 #4: was 8px / C.icon (faint grey) — below the
          // legibility floor in a glare environment. Bumped to 9px and the
          // higher-contrast secondary so the "more signals live" hint reads.
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary }}>+{remainder}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 6 : 10 }}>
      {shownSet.map((s) => (
        <LiveMeterColumn
          key={s.key}
          isPortrait={isPortrait}
          signal={s}
          value={valueOf(s.postKey)}
        />
      ))}
      {remainder > 0 ? (
        // QA round8 #4: the "+N on AUDIO tab" hint was 8px / C.icon (faint
        // grey) — sub-legible at the edge of the venue. Bumped to 9px and
        // C.secondary for readable contrast without out-shouting the meters.
        <Text
          numberOfLines={2}
          style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, maxWidth: 54, textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          +{remainder} on AUDIO tab
        </Text>
      ) : null}
    </View>
  );
}

// Map a raw CPC value to a [0,1] bar fill given the signal's kind/range.
// Intensity signals are already [0,1]; frequency signals are normalised by
// their schema max (Hz); bpm is normalised by 300 (the schema bpm range).
function normalizeAudio(signal: AudioSignalDescriptor, value: number): number {
  if (signal.kind === 'intensity') return Math.max(0, Math.min(1, value));
  if (signal.max > 0) return Math.max(0, Math.min(1, value / signal.max));
  return Math.max(0, Math.min(1, value));
}

// Human-readable value text for the meter header: Hz for frequency, the
// integer count for bpm, percent for intensity.
function audioValueText(signal: AudioSignalDescriptor, value: number): string {
  if (signal.kind === 'frequency') return `${Math.round(value)}Hz`;
  if (signal.kind === 'bpm') return value > 0 ? `${Math.round(value)}` : '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}`;
}

// Compact meter label for the dense GLOBALS audio strip. The engine ships
// verbose band names ("ENERGY RATIO") that mid-word-clip in the strip's
// narrow cells (QA round1 #21: "ENERGY RA…"). Collapse a multi-word label to
// its first word so the cue stays whole instead of truncating — never an
// ellipsis on a control label. Single-word labels pass through untouched.
function audioMeterLabel(label: string): string {
  const trimmed = label.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

/**
 * LiveMeterColumn — compact, read-only "what the patterns are seeing right
 * now" display for one dynamic audio signal. Non-interactive (tuning lives
 * in the Companion / Audio tab). KICK gets a brighter accent fill so the
 * transient stands out at a glance.
 */
function LiveMeterColumn({ isPortrait, signal, value }: {
  isPortrait: boolean;
  signal: AudioSignalDescriptor;
  value: number;
}) {
  const C = usePalette();
  const cellMinWidth = isPortrait ? 52 : 72;
  const fill = normalizeAudio(signal, value);
  // Identity colour — the curated bands read with their Companion accent
  // (teal LOW, blue MID, red KICK, …) so the deck cue matches the AUDIO
  // tab trace and the modulation source trail. One shared source of truth
  // in utils/audioSignals.ts.
  const accentHex = audioAccentHex(signal);
  return (
    <View style={{
      flex: 1, minWidth: cellMinWidth, maxWidth: isPortrait ? 80 : 110,
      paddingVertical: 4, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surface,
      justifyContent: 'center',
    }}>
      {/* QA round1 #21: bumped 8→9px and secondary→text so the band labels
          and values read at the edge of the venue; the label is abbreviated
          to its first word (audioMeterLabel) so it stays whole instead of
          clipping mid-word ("ENERGY RA…"). */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.text, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1, marginRight: 4 }}>{audioMeterLabel(signal.label)}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.text }}>{audioValueText(signal, value)}</Text>
      </View>
      <View style={{
        height: 8, borderRadius: 4,
        backgroundColor: C.surfaceContainerHigh,
        overflow: 'hidden',
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${fill * 100}%`,
          backgroundColor: accentHex,
        }} />
      </View>
    </View>
  );
}

// The TAP source-tag accent: OSC reads as auto-driven (green), a manual
// override reads as "operator hands on" (tertiary), HELD stays muted.
function sourceAccent(C: ReturnType<typeof usePalette>, source: TempoSource): string {
  if (source === 'osc') return ACCENT_AUTO;
  if (source === 'manual') return C.tertiary;
  return C.secondary;
}

/**
 * GlobalTapTile — the compact TAP button for the GLOBALS bar. Same tile
 * footprint as COLORS / BPM / OSC so it reads as part of that cluster. Tapping
 * registers a tap (the shared hook averages intervals → POST /mixer/tempo).
 * The applied BPM + source live in the BpmTile to its right, so this tile is
 * just the trigger (keeps the cluster decluttered — one number, not three).
 */
function GlobalTapTile({ onTap, source, isPortrait }: {
  onTap: () => void;
  source: TempoSource;
  isPortrait: boolean;
}) {
  const C = usePalette();
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  // Tint the border when a manual tap override is active so the operator can
  // see "I'm holding the tempo" from this tile too.
  const manual = source === 'manual';
  return (
    <TouchableOpacity
      onPress={onTap}
      accessibilityLabel="Tap tempo"
      accessibilityRole="button"
      style={{
        width: w, height: GLOBALS_TILE_HEIGHT,
        paddingVertical: 4, paddingHorizontal: 6,
        borderRadius: 8, borderWidth: 1,
        borderColor: manual ? C.tertiary : C.primary,
        backgroundColor: C.surface,
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        TAP
      </Text>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18,
        color: manual ? C.tertiary : C.primary, textAlign: 'center', lineHeight: 20,
      }}>
        ⊙
      </Text>
    </TouchableOpacity>
  );
}

// BPM gets its own compact tile (no operator gain — it's a tempo
// reference, not a level to scale). The big numeric readout makes
// it easy to glance at from across the venue. Now source-aware: a small
// source-based border colour tells the operator what's driving the clock
// (green = OSC auto-follow, tertiary = manual override), and a SYNC affordance
// appears only while a manual tap override is active (tap → hand control back
// to OSC).
function BpmTile({ bpm, isPortrait, synced, source, showSync, onSync }: {
  bpm: number;
  isPortrait: boolean;
  synced?: boolean;
  source: TempoSource;
  showSync: boolean;
  onSync: () => void;
}) {
  const C = usePalette();
  const hasSignal = bpm > 0;
  // The BPM tile widens a touch when it has to carry the SYNC chip so the
  // number + tag + SYNC don't crowd; otherwise it matches the cluster width.
  const baseW = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  const w = showSync ? baseW + (isPortrait ? 22 : 30) : baseW;
  const accent = sourceAccent(C, source);
  // OSC auto-follow keeps the green "beat-locked" border; a manual override
  // tints tertiary; otherwise the resting ghost border.
  const border = source === 'osc' ? ACCENT_AUTO : source === 'manual' ? C.tertiary : C.ghostBorder;
  // QA round1 #4: a bare BPM number sitting next to an "OSC IDLE" pill reads
  // as a contradiction ("is the clock running or not?"). Append a MINIMAL
  // source qualifier so the held/osc case is unambiguous — `· HELD` when a
  // tempo is held with no live driver, `· OSC` when OSC is auto-following.
  // Manual override is already signalled by the tertiary tint + SYNC chip, so
  // it stays bare (no `· TAP`). This is intentionally a one-word qualifier,
  // NOT the verbose source tag retired on 2026-06-22.
  const qualifier = hasSignal && source === 'held' ? 'HELD' : hasSignal && source === 'osc' ? 'OSC' : null;
  return (
    <View style={{
      width: w, height: GLOBALS_TILE_HEIGHT,
      paddingVertical: 4, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: border,
      backgroundColor: C.surface,
      flexDirection: 'row', alignItems: 'center',
    }}>
      <View style={{ flex: 1, justifyContent: 'space-between', height: '100%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: accent, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            BPM{qualifier ? <Text style={{ color: C.secondary }}> · {qualifier}</Text> : null}
          </Text>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hasSignal ? accent : C.ghostBorder }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18,
            color: hasSignal ? C.text : C.icon, lineHeight: 20,
          }}>
            {hasSignal ? Math.round(bpm) : '—'}
          </Text>
        </View>
      </View>
      {showSync ? (
        <TouchableOpacity
          onPress={onSync}
          accessibilityLabel="Sync tempo back to OSC"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={{
            marginLeft: 4, height: 40, paddingHorizontal: 5,
            borderRadius: 6, borderWidth: 1, borderColor: C.tertiary,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: C.tertiary, letterSpacing: 0.8 }}>
            SYNC
          </Text>
        </TouchableOpacity>
      ) : null}
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
      <CollapsedReadout label="SPEED" value={Math.round(speed * 100)} unit="%" accent={speedFill} badge={speedBadge} />
      <CollapsedReadout label="SIZE" value={Math.round(size * 100)} unit="%" />
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

function CollapsedReadout({ label, value, unit, accent, badge }: { label: string; value: number; unit?: string; accent?: string; badge?: string }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      {/* QA round8 #3: level-like 0–100 params carry a "%" unit so the
          collapsed GLOBALS readout isn't a bare integer (matches the deck
          HUE's "°"). The unit is rendered a touch smaller/secondary so the
          number still leads. */}
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: accent || C.text }}>
        {value}{unit ? <Text style={{ fontSize: 9, color: C.secondary }}>{unit}</Text> : null}
      </Text>
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
