import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, Modal, ScrollView, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePalette } from '@/hooks/use-theme';
import { updateParamCenter, getCachedColorPalettes, warmColorPalettesCache } from '@/utils/api';
import { MiniFader } from '@/components/ui/MiniFader';
import { useSharedParamValues, useLiveParamValues, useLiveParams, useAudioSignals, type AudioSignalDescriptor } from '@/hooks/useEngineState';
import {
  useTempoState,
  useTempoTap,
  type TempoSource,
  type TempoSourcePref,
} from '@/hooks/use_tempo_tap';
import { OscStatusPill } from '@/components/OscStatusPill';
import { ColorPickerModal, ColorQueueModal, DualSwatch, type ColorPalettePreset } from '@/components/ColorPickerModal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { curateDeckSignals, audioAccentHex } from '@/utils/audioSignals';
import { KnobPill } from '@/components/ui/knob_pill';
import { globalKnobNumber } from '@/utils/midi/knob_page';

// BPM-sync "auto-driven" accent (green). Lives here as a local
// constant so this file doesn't depend on a brand-new theme token
// landing in every consumer's TS server cache. Mirrors the value in
// constants/theme.ts → C.tertiary.
const ACCENT_AUTO = '#1b9e77';

// Max audio-signal plots an operator can pick / the row will show. The row is a
// single line, so it's capped; the picker disables further selection at this many.
const AUDIO_PLOTS_MAX = 10;

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
  // Which screen this instance lives on — selects the persistence key for the
  // audio-plot selection so Deck and Mixer remember different picks.
  screen?: 'deck' | 'mixer';
  // Soft PLAN lock gate (planLocked && !leaseHeld). When true every MUTATING
  // control in the GLOBALS row (SPEED, SYNC, COLORS, QUEUE, TAP, the BPM
  // source selector) is disabled — dimmed, handlers blocked — until the
  // operator takes over. Read-only surfaces stay live: the collapse chevrons
  // (client-side view state), the AUDIO meters + plot picker (display-only
  // local selection), and the OSC status pill (a read-only details sheet).
  disabled?: boolean;
  // DECK-ONLY (docs/63 §3.1). The Deck's DeckWorkspaceBar ("the view
  // optimizer") renders here, between row 1 (GLOBALS) and row 2 (AUDIO
  // SIGNALS) — "under the globals". Undefined renders NOTHING (no wrapper
  // element, no extra gap) so the mixer — which never passes this — stays
  // byte-identical (docs/63 §5 pin 8).
  optimizerSlot?: React.ReactNode;
  // DECK-ONLY (docs/63 §3.1). When true, row 2 (the AUDIO SIGNALS meters +
  // the plot-picker button) and its <AudioPlotPicker> modal are not
  // rendered. The `useAudioPlotSelection` hook and the live audio-signals
  // subscription stay unconditional — only the JSX is gated — so the
  // AsyncStorage-backed selection is untouched and simply doesn't mount
  // while hidden. The mixer never passes this, so its AUDIO row is
  // unaffected.
  hideAudioRow?: boolean;
}

/**
 * Persisted, per-screen selection of WHICH audio-signal plots show in the AUDIO
 * row. `null` = no saved pick → use the curated default (curateDeckSignals).
 * Stored under `@CaptainPad:audioPlots:<screen>` so Deck and Mixer differ.
 * Follows the established AsyncStorage best-effort pattern (audio.tsx).
 */
function useAudioPlotSelection(screen: 'deck' | 'mixer') {
  const storageKey = `@CaptainPad:audioPlots:${screen}`;
  const [selected, setSelected] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (!alive || raw == null) return;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setSelected(arr.filter((k): k is string => typeof k === 'string'));
      } catch { /* benign — first launch / corrupt entry */ }
    }).catch(() => { /* best-effort */ });
    return () => { alive = false; };
  }, [storageKey]);
  const update = useCallback((next: string[] | null) => {
    setSelected(next);
    if (next == null || next.length === 0) AsyncStorage.removeItem(storageKey).catch(() => {});
    else AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
  }, [storageKey]);
  return [selected, update] as const;
}

export const CPCControls = ({ trailing, screen = 'deck', disabled = false, optimizerSlot, hideAudioRow = false }: CPCControlsProps = {}) => {
  const C = usePalette();
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const defaultParams = useMemo(() => ({
    speed: 0.5,
    // NOTE: no `size` here. The global SIZE fader was removed from this bar
    // on 2026-07-27 (operator request — it was never used live and its ~98pt
    // crushed the portrait row). The engine `size` CPC param still exists and
    // is still drivable from MIDI / scripts; only the touch UI is gone.
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
  const live = useLiveParamValues({ audioBpm: 0 });
  // Primary BPM = the engine-applied pattern clock. Fall back to the raw OSC
  // reading (audioBpm — the Companion's analyzed tempo, the ONE OSC source)
  // only before the first mixer/deck broadcast lands. (2026-06-29 cleanup: the
  // LX /lx/tempo/bpm → `tempoBpm` CPC param is no longer read as a fallback.)
  const liveBpm = tempo.bpm != null ? tempo.bpm : (live.audioBpm ?? 0);
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
    // Soft PLAN lock — the armed QUEUE slot writes the shared colour params
    // live; blocked while gated (the tile is also disabled below).
    if (disabled) return;
    if (queued) {
      updateParamCenter({
        colorPalette1: { h: queued.c1, s: 1, v: 1 },
        colorPalette2: { h: queued.c2, s: 1, v: 1 },
      });
      setQueued(null);
    } else {
      setQueuePickerOpen(true);
    }
  }, [queued, disabled]);
  // Collapsible Global Params + Audio Reactivity rows (operator review
  // May 2026): the top strip eats 2× the vertical space the pattern
  // selection actually needs, especially in landscape on the iPad
  // Pro 11". The collapse keeps the OSC pill / BPM / a glance-at
  // SPEED & REACT value visible so a quick check at the edge of the
  // venue still reads at a glance. State is client-side only; it
  // resets on app cold-boot which matches the operator's expectation
  // (they want to start every show with the full picture).
  const [globalsCollapsed, setGlobalsCollapsed] = useState(false);
  // AUDIO row (party 2026-07-11): no collapse/expand any more — it's a single,
  // always-visible MINIMAL-height strip (operator request). The disclosure
  // chevron + collapsed/expanded variants were removed; the meters are thin
  // (label + tiny bar) and read-only.
  // Customizable AUDIO row: which signal plots to show (persisted per screen) +
  // the picker modal open state.
  const [audioSelected, setAudioSelected] = useAudioPlotSelection(screen);
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);

  // Writers post to /param-center. The engine's POST handler
  // broadcasts a fresh sharedParams to every subscriber (including us),
  // so we don't need a separate optimistic local-state path — the
  // broadcast round-trip is already sub-second on Wi-Fi.
  const update = (key: string, val: any) => {
    // Soft PLAN lock — every write path funnels through here (or through the
    // per-control disabled gating below), so a gated surface can never post.
    if (disabled) return;
    updateParamCenter({ [key]: val });
  };

  // QA round8 #2: the GLOBALS row left a ~40% dead gutter to the right of
  // the OSC tile in landscape because the SPEED fader was capped at
  // 140 and couldn't grow into the slack. Landscape uncaps so the fader
  // flex-grows to absorb the gutter — "big but compact". The inter-tile gap
  // also tightens (20→12) so the cluster reads as intentionally dense.
  //
  // Portrait used to cap the fader at 90 because every tile fought for room on
  // one nowrap line (~700pt of fixed tiles on a 768pt iPad — crushed faders +
  // right-edge clipping, the "broken mixer GLOBALS" the operator reported).
  // Portrait now lays the tiles out in TWO rows (below), so the SPEED fader is
  // uncapped there too and only carries a sane minimum width.
  const globalsRowGap = isPortrait ? 8 : 12;
  // Shared label column for row-1 and row-2 so REACT lines up under
  // SPEED. labelGap is the same number for both rows; widening one
  // requires widening both — that's the whole point of the constants.
  const labelWidth = isPortrait ? 60 : 110;
  const labelGap   = isPortrait ? 8 : 12;

  // BPM → speed sync surface state (see bpm_speed_sync.js + Audio tab). When
  // sync is ON we tag the SPEED fader green and pull its display from the live
  // mapped value so the operator can see "speed is being auto-driven by the
  // arbitrated tempo" without leaving the Deck. We surface a warning only when
  // there is NO tempo to follow at all (source-agnostic — OSC OR TAP counts).
  // Global tap-tempo cluster (tempo arbitration). Same shared tap logic as the
  // deck TAP button, so a tap from either surface means exactly the same
  // thing. `tempo.sourcePref` (sticky) drives the OSC↔TAP selector highlight;
  // `setSource` flips it. State rides the mixer broadcast, so deck + mixer agree.
  const { tap: onTap, setSource: onSetSource } = useTempoTap();
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
  // Sync is now SOURCE-AGNOSTIC (it follows the arbitrated tempo — OSC OR
  // TAP). So the warning fires only when there is NO usable tempo at all
  // (bpm <= 0), NOT merely because OSC isn't live — a tapped tempo with OSC
  // off is a perfectly valid driver for SPEED.
  const bpmSyncStale  = bpmSyncOn && bpm <= 0;

  // ── GLOBALS-row tiles ────────────────────────────────────────
  // Built once as nodes so the PORTRAIT two-row layout and the LANDSCAPE
  // single-row layout stack the exact SAME controls with zero duplicated JSX
  // — a tile can never drift between orientations.
  const speedCluster = (
    <View style={{
      flex: 1,
      // Portrait: uncapped but never squeezed below a usable fader width.
      // Landscape: uncapped so it grows into the row's slack (QA round8 #2).
      minWidth: isPortrait ? 120 : undefined,
      flexDirection: 'row', alignItems: 'center', gap: 6,
    }}>
      <View style={{ flex: 1 }}>
        {/* The GLOBALS-row SPEED fader is the CANONICAL speed UI, so
            it wears the physical-knob badge directly: MFT knob 1
            (row-0 global, knob_page.ts) drives this exact value on
            BOTH tabs. Sync state already surfaces here — green fill +
            BPM badge while bpmSpeedSync owns speed (the knob's push
            toggles the same flag SpeedSyncToggle does). */}
        <MiniFader
          label="SPEED"
          value={speedDisplay}
          fillColor={speedFill}
          badge={speedBadge}
          leading={<KnobPill knobNumber={globalKnobNumber('speed')} />}
          disabled={disabled}
          onChange={(v) => update('speed', v)}
        />
      </View>
      {/* SPEED ← BPM sync toggle, on the MAIN UI (operator request
          feat/optimize_channels). Toggles the engine `bpmSpeedSync`
          param so the engine maps the ARBITRATED tempo (OSC OR TAP)
          onto SPEED. Source-agnostic — see bpm_speed_sync.js. When ON
          with no tempo available it tints amber (a warning) but stays
          toggleable so the operator can arm sync before audio starts. */}
      <SpeedSyncToggle
        on={bpmSyncOn}
        starving={bpmSyncOn && bpm <= 0}
        disabled={disabled}
        onToggle={() => update('bpmSpeedSync', bpmSyncOn ? 0 : 1)}
      />
    </View>
  );

  // Single COLORS button. Tapping opens the tabbed picker (Presets · Manual)
  // — see ColorPickerModal. We render both hues as a split-circle swatch so
  // the operator can see the current pair at a glance without opening it.
  const colorsTile = (
    <ColorPairButton
      h1={params.colorPalette1?.h ?? 0}
      h2={params.colorPalette2?.h ?? 0.5}
      isPortrait={isPortrait}
      disabled={disabled}
      onPress={() => setColorPickerOpen(true)}
    />
  );

  // Twin QUEUE tile — looks like COLORS, but cues. Empty: tap opens the
  // chooser; armed: tap sends live; ✕ clears. See onSlotTap / QueuedColorSlot.
  const queueTile = (
    <QueuedColorSlot
      queued={queued}
      onPress={onSlotTap}
      onClear={() => setQueued(null)}
      isPortrait={isPortrait}
      disabled={disabled}
    />
  );

  // Dedicated, full-size TAP button — the ACTUAL tap target (operator request
  // feat/optimize_channels): tapping lives here, NOT on the tiny BPM source
  // selector. It's in the GLOBALS bar so it renders on BOTH deck + mixer, and
  // useTempoTap().tap() feeds a MODULE-GLOBAL tap series — so taps are global
  // and synced across tabs and respected app-wide.
  const tapTile = (
    <GlobalTapTile isPortrait={isPortrait} sourcePref={tempo.sourcePref} disabled={disabled} onTap={onTap} />
  );

  // BPM tile — the APPLIED tempo readout + a STICKY SOURCE SELECTOR (OSC vs
  // TAP). The selector only CHOOSES the source, it does not tap: OSC follows
  // the live OSC feed; TAP holds the current tempo (then refine it with the big
  // TAP button). The selection is sticky and shared across deck + mixer — it
  // never bounces OSC↔TAP.
  const bpmTile = (
    <BpmTile
      bpm={bpm}
      isPortrait={isPortrait}
      source={tempo.source}
      sourcePref={tempo.sourcePref}
      disabled={disabled}
      onSelectOsc={() => onSetSource('osc')}
      onSelectTap={() => onSetSource('tap')}
    />
  );

  const oscTile = <OscStatusPill compact={isPortrait} />;

  return (
    <View style={{ backgroundColor: C.surfaceContainerLowest, padding: isPortrait ? 6 : 8, borderBottomWidth: 1, borderBottomColor: C.ghostBorder, gap: isPortrait ? 6 : 6 }}>

      {/* ── Warning banner: BPM sync expects OSC but it's not flowing ─ */}
      {bpmSyncStale ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
          borderWidth: 1, borderColor: C.error,
          backgroundColor: 'rgba(255,80,80,0.10)',
        }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 10 }}>⚠ BPM SYNC ON · NO TEMPO</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 11, flex: 1 }}>
            Speed will not move until there is a tempo to follow — tap one in (TAP) or let the Audio Companion stream one over OSC. Toggle SYNC off to release SPEED.
          </Text>
        </View>
      ) : null}

      {/* ── Row 1: pattern globals + colour swatches + BPM + OSC pill ─ */}
      {/* Order: SPEED · COLORS · QUEUE · TAP · BPM · OSC. `count` and `dir`
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
            h1={params.colorPalette1?.h ?? 0}
            h2={params.colorPalette2?.h ?? 0.5}
            bpm={bpm}
            disabled={disabled}
            onEditColors={() => setColorPickerOpen(true)}
          />
        ) : isPortrait ? (
          /* PORTRAIT — TWO ROWS (operator request 2026-07-27). One nowrap line
             could not hold SPEED+SYNC · COLORS · QUEUE · TAP · BPM · OSC (plus
             GROUPS on the mixer) on a 768–810pt iPad: the fixed tiles ate the
             budget, the flex fader collapsed to a sliver, and the trailing tiles
             clipped off the right edge — the "GLOBALS is broken in vertical"
             report. Split by function instead of letting the row overflow:
               row A = the CONTROLS the operator drives (speed + colour),
               row B = TEMPO + status readouts.
             The mixer's GROUPS accessory joins the END of row A in portrait
             (instead of hanging outside the body) so it stays reachable without
             stealing width from the fader. Landscape is untouched below. */
          <View style={{ flex: 1, gap: 6, paddingRight: 4 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: globalsRowGap }}>
              {speedCluster}
              {colorsTile}
              {queueTile}
              {trailing ? <View style={{ justifyContent: 'center' }}>{trailing}</View> : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: globalsRowGap }}>
              {tapTile}
              {bpmTile}
              {oscTile}
              {/* Left-align row B under row A's controls; the slack sits at the
                  right rather than stretching the tempo tiles. */}
              <View style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          /* LANDSCAPE — unchanged single row. The OSC pill is intentionally
             LAST so the eye finishes the row on health status. */
          <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: globalsRowGap, paddingRight: 12, flex: 1 }}>
            {speedCluster}
            {colorsTile}
            {queueTile}
            {tapTile}
            {bpmTile}
            {oscTile}
          </View>
        )}

        {/* Optional right-end accessory (mixer-only GROUPS button). Sits at
            the far right of the GLOBALS row so it reclaims the slack the deck
            leaves empty; the deck passes no `trailing`, so its row is
            unchanged. Rendered outside the collapsible body so it stays
            reachable whether or not GLOBALS is collapsed — EXCEPT in expanded
            portrait, where it already sits at the end of row A (rendering it
            here too would duplicate the button). */}
        {trailing && (!isPortrait || globalsCollapsed) ? (
          <View style={{ marginLeft: globalsRowGap, justifyContent: 'center' }}>
            {trailing}
          </View>
        ) : null}
      </View>

      {/* ── Deck-only optimizer slot (docs/63 §3.1) — the DeckWorkspaceBar
          ("view optimizer") renders here, under GLOBALS and above AUDIO
          SIGNALS. Undefined (the mixer's case) renders NOTHING — not an
          empty View — so the outer View's `gap` never adds phantom space
          and the mixer stays byte-identical (docs/63 §5 pin 8). */}
      {optimizerSlot}

      {/* ── Row 2: audio — dynamic live-only signal meters ──────────────
          The columns are rendered from whatever audio CPC keys the
          Companion routes in (useAudioSignals → the engine schema), so
          adding/removing a signal in the Companion adds/removes a meter
          here automatically. The deck shows ONLY live data — operators
          tune signals in the Companion / Audio tab, not here. The meters
          are intentionally NOT touch-responsive (they show the effective
          post-chain value already being driven into the CPC).

          DECK-ONLY hideAudioRow (docs/63 §3.1): when true, this row and its
          <AudioPlotPicker> modal below are both skipped — gated on the SAME
          condition so they can never drift apart and leave the modal
          mounted over a hidden row. The `useAudioPlotSelection` hook above
          and the `useAudioSignals` subscription stay unconditional; only
          this JSX is gated.
       */}
      {!hideAudioRow ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.ghostBorder, paddingTop: isPortrait ? 4 : 6 }}>
          {/* Same labelWidth + labelGap as row 1 so AUDIO lines up directly under
              SPEED — no white-space gap. STATIC label now (party 2026-07-11): the
              row is always the minimal strip, so the old collapse chevron/toggle
              is gone. */}
          <View
            style={{ width: labelWidth, marginRight: labelGap, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>{isPortrait ? 'AUDIO' : 'AUDIO SIGNALS'}</Text>
          </View>

          <DynamicAudioRow
            signals={audioSignals}
            isPortrait={isPortrait}
            selectedKeys={audioSelected}
          />

          {/* Edit which plots show — opens the picker. Right-aligned, compact. */}
          <TouchableOpacity
            onPress={() => setAudioPickerOpen(true)}
            accessibilityLabel="Choose which audio signals to show"
            style={{ marginLeft: 6, paddingHorizontal: 6, paddingVertical: 4, justifyContent: 'center' }}
          >
            <IconSymbol name="slider.horizontal.3" size={14} color={C.secondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      {!hideAudioRow ? (
        <AudioPlotPicker
          visible={audioPickerOpen}
          signals={audioSignals}
          selected={audioSelected}
          onChange={setAudioSelected}
          onClose={() => setAudioPickerOpen(false)}
        />
      ) : null}

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
 * next to the SPEED MiniFader and gives the operator a fat
 * tap-target on the iPad. Shows both global hues as a split-circle
 * preview + a "COLORS" caption; opens the tabbed picker on tap.
 */
// Compact-tile shape shared by COLORS / BPM / OSC. Operator review
// 2026-05-28 — these three should read as one cluster (visual signal +
// status cluster) distinct from the SPEED slider.
const GLOBALS_TILE_WIDTH_PORTRAIT  = 60;
const GLOBALS_TILE_WIDTH_LANDSCAPE = 86;
// party 2026-07-11: dropped 48→40 to compact the GLOBALS row into a dense
// single line. 40pt still clears the operator's ~40pt tap-target floor.
const GLOBALS_TILE_HEIGHT = 40;

function ColorPairButton({ h1, h2, isPortrait, disabled, onPress }: { h1: number; h2: number; isPortrait: boolean; disabled?: boolean; onPress: () => void }) {
  const C = usePalette();
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel="Open colour picker"
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={{
        width: w, height: GLOBALS_TILE_HEIGHT,
        paddingVertical: 4, paddingHorizontal: 6,
        borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
        backgroundColor: C.surface,
        justifyContent: 'space-between',
        opacity: disabled ? 0.45 : 1,
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
function QueuedColorSlot({ queued, onPress, onClear, isPortrait, disabled }: {
  queued: ColorPalettePreset | null;
  onPress: () => void;
  onClear: () => void;
  isPortrait: boolean;
  disabled?: boolean;
}) {
  const C = usePalette();
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  return (
    <View style={{
      width: w, height: GLOBALS_TILE_HEIGHT,
      borderRadius: 8, borderWidth: 1, borderColor: queued ? C.primary : C.ghostBorder,
      backgroundColor: C.surface,
      opacity: disabled ? 0.45 : 1,
    }}>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={queued ? `Send queued colour ${queued.name} live` : 'Open colour queue'}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
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
          disabled={disabled}
          accessibilityLabel="Remove queued colour"
          accessibilityRole="button"
          accessibilityState={{ disabled: !!disabled }}
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
function DynamicAudioRow({ signals, isPortrait, selectedKeys }: {
  signals: AudioSignalDescriptor[];
  isPortrait: boolean;
  selectedKeys: string[] | null;
}) {
  const C = usePalette();
  const liveDoc = useLiveParams();
  const valueOf = useCallback((key: string): number => {
    const slot = liveDoc?.params?.[key];
    const v = slot && typeof slot.value === 'number' ? slot.value : 0;
    return v;
  }, [liveDoc]);

  // WHICH plots to show: the operator's saved selection (in their chosen order,
  // only those still live), else the curated best-practice subset. The remainder
  // count drives the "+N on AUDIO tab" hint.
  // Whether an explicit operator selection is driving the row (vs. the curated
  // default) — a selection shows up to AUDIO_PLOTS_MAX; the default keeps the
  // tighter 4/6 best-practice cap.
  const hasSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.length === 0) return false;
    return selectedKeys.some((k) => signals.find((s) => s.key === k));
  }, [selectedKeys, signals]);
  const curated = useMemo(() => {
    if (selectedKeys && selectedKeys.length > 0) {
      const live = new Map(signals.map((s) => [s.key, s] as const));
      const picked = selectedKeys
        .map((k) => live.get(k))
        .filter((s): s is AudioSignalDescriptor => !!s);
      if (picked.length > 0) return picked;
    }
    return curateDeckSignals(signals);
  }, [selectedKeys, signals]);

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
  // A custom selection shows every picked plot (up to AUDIO_PLOTS_MAX); the
  // curated default keeps the tighter single-glance cap.
  const maxCells = hasSelection ? AUDIO_PLOTS_MAX : (isPortrait ? 4 : 6);
  const baseSet = curated.length > 0 ? curated : signals;
  const shownSet = baseSet.slice(0, maxCells);
  const remainder = signals.length - shownSet.length;

  // Single, always-visible MINIMAL strip — thin meters (label + tiny bar),
  // read-only. No collapsed/expanded variants (party 2026-07-11).
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

/**
 * AudioPlotPicker — modal to choose WHICH audio signal plots show in the row.
 * Lists every live signal with a checkbox; toggling persists immediately via the
 * parent's onChange. "Reset to default" clears the pick (→ curated default).
 * When no explicit pick exists yet, the curated default is shown pre-checked so
 * the operator sees the starting point.
 */
function AudioPlotPicker({ visible, signals, selected, onChange, onClose }: {
  visible: boolean;
  signals: AudioSignalDescriptor[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
  onClose: () => void;
}) {
  const C = usePalette();
  const curatedKeys = useMemo(() => curateDeckSignals(signals).map((s) => s.key), [signals]);
  // The working selection: the saved pick, or the curated default when unset.
  const base = selected && selected.length > 0 ? selected : curatedKeys;
  const sel = useMemo(() => new Set(base), [base]);
  const atCap = base.length >= AUDIO_PLOTS_MAX;
  const toggle = (key: string) => {
    const has = base.includes(key);
    if (!has && atCap) return;   // at the cap — must remove one before adding more
    const next = has ? base.filter((k) => k !== key) : [...base, key];
    onChange(next.length > 0 ? next : []);   // empty array persists as "none shown"
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Pressable onPress={() => { /* swallow inner taps */ }} style={{ width: '90%', maxWidth: 560, maxHeight: '82%', backgroundColor: C.surfaceContainerLow, borderRadius: 14, borderWidth: 1, borderColor: C.ghostBorder, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>Audio plots</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close"><Text style={{ color: C.secondary, fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: atCap ? C.primary : C.secondary, marginBottom: 10 }}>
            {atCap
              ? `Showing ${base.length}/${AUDIO_PLOTS_MAX} — remove one to add another. Saved for this screen.`
              : `Tap to add or remove a plot (${base.length}/${AUDIO_PLOTS_MAX}). Your pick is saved for this screen.`}
          </Text>
          <ScrollView style={{ maxHeight: 380 }}>
            {signals.length === 0 ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, paddingVertical: 12 }}>
                No live audio signals — design them in the Audio Companion.
              </Text>
            ) : signals.map((s) => {
              const on = sel.has(s.key);
              const accent = audioAccentHex(s);
              // At the cap, unselected rows can't be added — dim + block them so
              // the limit is visible, not a silent no-op tap.
              const blocked = !on && atCap;
              return (
                <TouchableOpacity
                  key={s.key}
                  onPress={() => toggle(s.key)}
                  disabled={blocked}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 6, opacity: blocked ? 0.35 : 1 }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: on ? accent : C.ghostBorder, backgroundColor: on ? accent : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                    {on ? <Text style={{ color: '#000', fontSize: 12, fontFamily: 'SpaceGrotesk_700Bold' }}>✓</Text> : null}
                  </View>
                  <Text style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: C.text }}>{s.label}</Text>
                  <Text style={{ fontFamily: 'SpaceMono_400Regular', fontSize: 10, color: C.icon }}>{s.key}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <TouchableOpacity onPress={() => onChange(null)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder }}>
              <Text style={{ color: C.secondary, fontSize: 12, fontFamily: 'SpaceGrotesk_700Bold' }}>Reset to default</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8, backgroundColor: C.primary }}>
              <Text style={{ color: C.onPrimary, fontSize: 12, fontFamily: 'SpaceGrotesk_700Bold' }}>Done</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  const cellMinWidth = isPortrait ? 48 : 64;
  const fill = normalizeAudio(signal, value);
  // Identity colour — the curated bands read with their Companion accent
  // (teal LOW, blue MID, red KICK, …) so the deck cue matches the AUDIO
  // tab trace and the modulation source trail. One shared source of truth
  // in utils/audioSignals.ts.
  const accentHex = audioAccentHex(signal);
  // party 2026-07-11: MINIMAL meter — no bordered/filled box, no vertical
  // padding, thin 5pt bar. Just label + value + a tiny bar, so the whole AUDIO
  // row reads as one dense, short strip (~18px) instead of a 41px card row.
  return (
    <View style={{
      flex: 1, minWidth: cellMinWidth, maxWidth: isPortrait ? 80 : 110,
      justifyContent: 'center',
    }}>
      {/* Label abbreviated to its first word (audioMeterLabel) so it stays
          whole instead of clipping mid-word ("ENERGY RA…"). */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.text, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1, marginRight: 4 }}>{audioMeterLabel(signal.label)}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary }}>{audioValueText(signal, value)}</Text>
      </View>
      <View style={{
        height: 5, borderRadius: 3,
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

// The BPM source-tag accent: OSC reads as auto-driven (green), a manual
// override reads as "operator hands on" (tertiary), HELD stays muted.
function sourceAccent(C: ReturnType<typeof usePalette>, source: TempoSource): string {
  if (source === 'osc') return ACCENT_AUTO;
  if (source === 'manual') return C.tertiary;
  return C.secondary;
}

/**
 * SpeedSyncToggle — a compact SYNC button that sits to the right of the SPEED
 * fader on the GLOBALS bar. Toggles the engine `bpmSpeedSync` param so SPEED
 * is auto-driven from the ARBITRATED tempo (OSC OR TAP — see
 * bpm_speed_sync.js). ON = green (matches the SPEED fader's auto-driven tint).
 * ON-but-starving (sync armed, no tempo yet) = amber, a warning that speed
 * won't move until a tempo arrives — but the toggle stays operable so the
 * operator can arm sync ahead of audio.
 */
function SpeedSyncToggle({ on, starving, disabled, onToggle }: {
  on: boolean;
  starving: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const C = usePalette();
  const accent = on ? (starving ? '#ffc107' : ACCENT_AUTO) : C.secondary;
  return (
    <TouchableOpacity
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={
        on
          ? (starving ? 'Speed follows BPM: on, but no tempo yet' : 'Speed follows BPM: on')
          : 'Speed follows BPM: off'
      }
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      style={{
        width: 34, height: GLOBALS_TILE_HEIGHT,
        borderRadius: 7, borderWidth: 1,
        borderColor: on ? accent : C.ghostBorder,
        backgroundColor: on ? `${accent}22` : C.surface,
        alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: accent, letterSpacing: 0.6 }}>
        SYNC
      </Text>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 7, color: on ? accent : C.icon, letterSpacing: 0.4 }}>
        {on ? (starving ? 'NO BPM' : 'ON') : 'OFF'}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * GlobalTapTile — the dedicated, FULL-SIZE tap target (operator request
 * feat/optimize_channels). Each press registers a tap via useTempoTap().tap(),
 * which feeds a MODULE-GLOBAL tap series (see use_tempo_tap.ts) — so taps
 * accumulate across the deck and mixer tabs and drive the one global tempo.
 * Kept SEPARATE from the BPM source selector so the tap target stays big and
 * reliable (the selector only chooses OSC vs TAP, it does not tap).
 */
function GlobalTapTile({ isPortrait, sourcePref, disabled, onTap }: {
  isPortrait: boolean;
  sourcePref: TempoSourcePref;
  disabled?: boolean;
  onTap: () => void;
}) {
  const C = usePalette();
  const w = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  // Tint when TAP is the (sticky) selected source, so the button reads as
  // "you are driving the tempo by tapping". Sticky — doesn't flicker with OSC.
  const armed = sourcePref === 'tap';
  return (
    <TouchableOpacity
      onPress={onTap}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Tap tempo — tap repeatedly on the beat to set the global BPM"
      accessibilityState={{ disabled: !!disabled }}
      style={{
        width: w, height: GLOBALS_TILE_HEIGHT,
        borderRadius: 8, borderWidth: 1,
        borderColor: armed ? C.tertiary : C.ghostBorder,
        backgroundColor: armed ? C.tertiary : C.surface,
        alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, lineHeight: 20,
        letterSpacing: 1, color: armed ? C.surfaceContainerLowest : C.text,
      }}>
        TAP
      </Text>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 0.6,
        color: armed ? C.surfaceContainerLowest : C.secondary, textTransform: 'uppercase',
      }}>
        tempo
      </Text>
    </TouchableOpacity>
  );
}

/**
 * BpmTile — the applied BPM readout + a STICKY SOURCE SELECTOR (operator
 * request feat/optimize_channels). The selector ONLY chooses where the clock
 * comes from — it is NOT a tap target (the dedicated GlobalTapTile taps):
 *
 *   - OSC side → follow the live OSC feed (setSource('osc')). Highlighted when
 *                the STICKY pref is 'osc' — and STAYS highlighted through a brief
 *                OSC dropout (live source 'held'), so it never bounces to TAP.
 *   - TAP side → hold the CURRENT tempo (setSource('tap')); refine it with the
 *                big TAP button. Highlighted when the sticky pref is 'tap'.
 *
 * The SELECTOR highlight tracks the sticky `sourcePref` (no flapping); the
 * accent/border colour reflects the LIVE `source` (green when OSC is actually
 * driving, neutral when OSC-selected-but-held). The big numeric readout stays
 * so the tempo reads from across the venue.
 */
function BpmTile({ bpm, isPortrait, source, sourcePref, disabled, onSelectOsc, onSelectTap }: {
  bpm: number;
  isPortrait: boolean;
  source: TempoSource;
  sourcePref: TempoSourcePref;
  disabled?: boolean;
  onSelectOsc: () => void;
  onSelectTap: () => void;
}) {
  const C = usePalette();
  const hasSignal = bpm > 0;
  const accent = sourceAccent(C, source);
  // Widen the tile to seat the OSC/TAP selector beside the number.
  const baseW = isPortrait ? GLOBALS_TILE_WIDTH_PORTRAIT : GLOBALS_TILE_WIDTH_LANDSCAPE;
  const w = baseW + (isPortrait ? 30 : 40);
  // Selector highlight = the STICKY preference (never flaps). Border = LIVE
  // status (green only when OSC is actually driving).
  const oscActive = sourcePref === 'osc';
  const tapActive = sourcePref === 'tap';
  const border = source === 'osc' ? ACCENT_AUTO : tapActive ? C.tertiary : C.ghostBorder;
  return (
    <View style={{
      width: w, height: GLOBALS_TILE_HEIGHT,
      paddingVertical: 4, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: border,
      backgroundColor: C.surface,
      flexDirection: 'row', alignItems: 'center', gap: 5,
    }}>
      <View style={{ flex: 1, justifyContent: 'space-between', height: '100%' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: accent, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          BPM
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18,
            color: hasSignal ? C.text : C.icon, lineHeight: 20,
          }}>
            {hasSignal ? Math.round(bpm) : '—'}
          </Text>
        </View>
      </View>

      {/* SOURCE selector (OSC vs TAP) — chooses the clock source only; it does
          NOT tap (the GlobalTapTile is the tap target). The active segment
          fills in its source accent so "what's driving the clock" reads at a
          glance. Height tracks the compacted tile (40 − 8pt tile padding). */}
      <View style={{ width: 30, height: 32, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.ghostBorder, opacity: disabled ? 0.45 : 1 }}>
        <TouchableOpacity
          onPress={onSelectOsc}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: oscActive, disabled: !!disabled }}
          accessibilityLabel="Use OSC as the tempo source (follow the live OSC feed)"
          hitSlop={{ top: 4, left: 4, right: 4, bottom: 0 }}
          style={{
            flex: 1, alignItems: 'center', justifyContent: 'center',
            backgroundColor: oscActive ? ACCENT_AUTO : C.surface,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 0.4, color: oscActive ? '#003a44' : C.secondary }}>
            OSC
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSelectTap}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: tapActive, disabled: !!disabled }}
          accessibilityLabel="Use tapped tempo as the source (hold the current BPM; tap to refine)"
          hitSlop={{ top: 0, left: 4, right: 4, bottom: 4 }}
          style={{
            flex: 1, alignItems: 'center', justifyContent: 'center',
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
            backgroundColor: tapActive ? C.tertiary : C.surface,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 0.4, color: tapActive ? C.surfaceContainerLowest : C.secondary }}>
            TAP
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Collapsed-row summaries ────────────────────────────────────────────
//
// One-line read-only snapshots for the GLOBAL PARAMS and AUDIO
// REACTIVITY rows. The label cell's chevron toggles between these
// summaries and the full editor rows above. Operator-perceptible
// data only — SPEED %, the dual-hue swatch, BPM readout for
// globals; four micro-meters (BASS / DRUMS / VOX / KICK) for audio
// (the master REACT readout was retired with audioReactivity on
// 2026-05-26). Sized so the row fits in ~24px regardless of orientation.

function CollapsedGlobalsSummary({
  speed, speedBadge, speedFill, h1, h2, bpm, disabled, onEditColors,
}: {
  speed: number; speedBadge?: string; speedFill?: string;
  h1: number; h2: number; bpm: number;
  disabled?: boolean;
  onEditColors: () => void;
}) {
  const C = usePalette();
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 8, height: 24 }}>
      <CollapsedReadout label="SPEED" value={Math.round(speed * 100)} unit="%" accent={speedFill} badge={speedBadge} />
      {/* Soft PLAN lock — the COLORS shortcut opens the (mutating) colour
          picker, so it's gated with the expanded-row controls. The readouts
          above stay full-brightness (display-only). */}
      <TouchableOpacity
        onPress={onEditColors}
        disabled={disabled}
        accessibilityLabel="Open colour picker"
        accessibilityState={{ disabled: !!disabled }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: disabled ? 0.45 : 1 }}
      >
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

