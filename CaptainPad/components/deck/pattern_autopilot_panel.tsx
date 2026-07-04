/**
 * PatternAutopilotPanel — the DECK "AUTOPILOT PATTERNS" card, extracted from
 * the deck screen (app/(tabs)/index.tsx) into a PURE CONTROLLED component so it
 * can be reused inside the timeline Cue editor.
 *
 * Presentational only — modeled exactly on its sibling ColorAutopilotPanel and
 * DeckTransitionControls: props in, a single onChange(patch) out. It owns NO
 * engine coupling (no @/utils/api import, no POST). The parent supplies the live
 * state (kept in sync by the deck's /ws/control reconcile) and translates each
 * emitted patch into the matching setAutopilot / group-field write.
 *
 * Card layout (matched pair with the ColorAutopilotPanel / DECK TX cards):
 *   Header row  : TITLE · next-swap countdown · PLAY/PAUSE   …   SHUFFLE · GROUP
 *   Cadence     : AutopilotTimerPills ("SWITCH EVERY" cadence, seconds)
 *   Group knobs : SIZE / DWELL pills (only while GROUP is on)
 *   DECK TX     : nested <DeckTransitionControls bare> (only when `deckTx` given)
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  AutopilotTimerPills,
  TimerPillBar,
  SwapCountdown,
  DeckTransitionControls,
} from '@/components/DeckTransitionControls';

/** The nested DECK TX config the panel forwards verbatim to
 *  <DeckTransitionControls>. Same shape as api.ts's DeckTransitionConfig, but
 *  restated locally so the presentational panel stays free of api.ts coupling. */
export interface PatternAutopilotDeckTx {
  enabled: boolean;
  mode: string;
  durationMs: number;
  shuffle: boolean;
}

/** Single patch emitted for every knob (mirrors ColorAutopilotPanel.onChange).
 *  Exactly one key is present per emit. */
export interface PatternAutopilotPatch {
  active?: boolean;
  delayStr?: string;
  shuffle?: boolean;
  groupMode?: boolean;
  groupSize?: number;
  groupDwell?: number;
}

export interface PatternAutopilotPanelProps {
  /** Playlist auto-cycling on/off (PLAY vs PAUSE). */
  active: boolean;
  /** Cadence, seconds-as-string (matches the deck's `playlistDelayStr` state).
   *  The pills work in integer seconds; the panel parses/stringifies at the
   *  boundary so the parent's string state is preserved byte-for-byte. */
  delayStr: string;
  /** Pattern shuffle on/off. */
  shuffle: boolean;
  /** Pattern-group locality on/off (reveals SIZE/DWELL when on). */
  groupMode: boolean;
  /** Group window span (adjacent entries). */
  groupSize: number;
  /** Swaps to linger in a group window before grabbing a fresh one. */
  groupDwell: number;
  /** Absolute wall-clock ms of the next pattern swap (null when none scheduled).
   *  Rendered by the self-ticking <SwapCountdown>. */
  nextSwapAtMs?: number | null;
  /** One patch callback for every knob. The panel never POSTs — the parent maps
   *  each patch key onto the matching write. */
  onChange: (patch: PatternAutopilotPatch) => void;
  /** OPTIONAL nested DECK TX. When provided, render <DeckTransitionControls bare>
   *  as a sub-section; when null/omitted, render no DECK TX section (so the cue
   *  editor can gate it). */
  deckTx?: PatternAutopilotDeckTx | null;
  /** Patch callback for the nested DECK TX; required whenever `deckTx` is set. */
  onDeckTxChange?: (patch: Partial<PatternAutopilotDeckTx>) => void;
  /** Render WITHOUT the outer surfaceContainerHigh card chrome, for embedding in
   *  another card (e.g. the cue editor). Default = full card wrapper. */
  bare?: boolean;
  /** Soft-disable: pointerEvents 'none' + dimmed opacity (the deck's planGate). */
  disabled?: boolean;
  /** Card label. Default "AUTOPILOT PATTERNS". */
  title?: string;
  /** Fired on every knob press BEFORE onChange — lets the deck keep firing its
   *  takeover-lease notifyInteraction() on each interaction. */
  onInteraction?: () => void;
}

export const PatternAutopilotPanel: React.FC<PatternAutopilotPanelProps> = ({
  active,
  delayStr,
  shuffle,
  groupMode,
  groupSize,
  groupDwell,
  nextSwapAtMs,
  onChange,
  deckTx,
  onDeckTxChange,
  bare = false,
  disabled = false,
  title = 'AUTOPILOT PATTERNS',
  onInteraction,
}) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();

  // Soft PLAN lock: the whole card (PLAY/PAUSE, SHUFFLE, GROUP, cadence pills,
  // SIZE/DWELL, and the nested DECK TX) changes what's playing, so it's gated as
  // one section — pointerEvents 'none' stops every interactive child; the dim
  // marks it disabled.
  return (
    <View
      pointerEvents={disabled ? 'none' : 'auto'}
      style={bare
        ? { gap: 6, opacity: disabled ? 0.45 : 1 }
        : { marginBottom: 12, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, ...globalStyles.ghostBorder, gap: 6, opacity: disabled ? 0.45 : 1 }}
    >
      {/* Header sits on the SAME row as PLAY/PAUSE + SHUFFLE + GROUP so it costs
          zero extra vertical height — the label rides the baseline of the
          tallest control next to it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase' }}>{title}</Text>
          {/* Next-pattern-swap countdown — rides right after the label, only
              while a swap is scheduled. Self-ticking (its own 1 Hz interval) so
              it never re-renders the deck screen; reads identically whether the
              operator or a plan cue owns the cadence. */}
          <SwapCountdown targetMs={nextSwapAtMs ?? null} />
          <TouchableOpacity
            onPress={() => { onInteraction?.(); onChange({ active: !active }); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: active ? C.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: active ? 'transparent' : C.ghostBorder }}
          >
            <IconSymbol name={active ? "pause.fill" : "play.fill"} size={16} color={active ? "#FFF" : C.text} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: active ? "#FFF" : C.text, fontSize: 12 }}>
              {active ? 'PAUSE' : 'PLAY'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity
            onPress={() => { onInteraction?.(); onChange({ shuffle: !shuffle }); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
            accessibilityRole="switch"
            accessibilityLabel={shuffle ? 'Disable autopilot shuffle' : 'Enable autopilot shuffle'}
          >
            <IconSymbol name="shuffle" size={16} color={shuffle ? C.primary : C.icon} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: shuffle ? C.primary : C.icon, fontSize: 12, letterSpacing: 0.5 }}>SHUFFLE</Text>
          </TouchableOpacity>
          {/* PATTERN-GROUP LOCALITY: GROUP rides next to SHUFFLE with the SAME
              on/off treatment (icon + label tint primary when on, icon token
              when off). Toggling it POSTs the group fields to
              /deck/playlist/autopilot via setAutopilot's group arg. */}
          <TouchableOpacity
            onPress={() => { onInteraction?.(); onChange({ groupMode: !groupMode }); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
            accessibilityRole="switch"
            accessibilityLabel={groupMode ? 'Disable autopilot pattern groups' : 'Enable autopilot pattern groups'}
          >
            <IconSymbol name="square.grid.2x2" size={16} color={groupMode ? C.primary : C.icon} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: groupMode ? C.primary : C.icon, fontSize: 12, letterSpacing: 0.5 }}>GROUP</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Row 2: timer pill-bar */}
      <AutopilotTimerPills
        value={parseInt(delayStr, 10) || 30}
        onChange={(v) => {
          onInteraction?.();
          onChange({ delayStr: String(v) });
        }}
      />

      {/* PATTERN-GROUP LOCALITY: SIZE/DWELL only render while GROUP is ON, so an
          OFF group costs no layout beyond the toggle. SIZE = how many adjacent
          entries the window spans (→ groupSize); DWELL = how many swaps to linger
          in that window before grabbing a fresh one (→ groupDwell). Reuse the
          compact TimerPillBar so the chips match the cadence pills. */}
      {groupMode ? (
        <View style={{ gap: 6 }}>
          <TimerPillBar
            label="SIZE"
            compact
            presets={[2, 3, 4, 5]}
            value={groupSize}
            onChange={(v) => { onInteraction?.(); onChange({ groupSize: v }); }}
            formatter={(v) => String(v)}
          />
          <TimerPillBar
            label="DWELL"
            compact
            presets={[4, 6, 8, 12]}
            value={groupDwell}
            onChange={(v) => { onInteraction?.(); onChange({ groupDwell: v }); }}
            formatter={(v) => String(v)}
          />
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary }}>
            dwell = swaps before a new group
          </Text>
        </View>
      ) : null}

      {/* ── DECK TRANSITIONS (nested INTO the AUTOPILOT PATTERNS card, operator
          request 2026-07-04: "the Deck TX and the pattern autopilot are the same
          work"). Soft-swap pattern changes via the engine's hidden deck shadow
          channel — playlist auto-cycling AND per-tap entry swaps route through
          this. A thin divider sets it apart within the card. OPTIONAL so the cue
          editor can gate it: only rendered when the parent hands us a live
          deckTx + its change handler. */}
      {deckTx && onDeckTxChange ? (
        <>
          <View style={{ height: 1, backgroundColor: C.ghostBorder, opacity: 0.6, marginTop: 2 }} />
          <DeckTransitionControls
            bare
            enabled={deckTx.enabled}
            mode={deckTx.mode}
            durationMs={deckTx.durationMs}
            shuffle={deckTx.shuffle}
            onChange={onDeckTxChange}
          />
        </>
      ) : null}
    </View>
  );
};
