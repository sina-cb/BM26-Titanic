// show_autopilot_card — the SHOW AUTOPILOT card on the SPECIAL EVENTS tab
// (docs/57 §4, report `_240`).
//
// Operator, verbatim: *"show the current pattern name on the auto pilot, and
// simplify the auto pilot, play, and time, 1, 5, 10, 15 that's it."*
//
// Five things, top to bottom, and nothing else drawn:
//
//   1. NOW PLAYING — the live name of the deck's active playlist entry.
//   2. GLOBAL SPEED — the shared rig clock used by every Baby pattern.
//   3. PLAY / PAUSE — the rotation on/off.
//   4. Time pills 5 / 15 / 30 / 60 SECONDS.
//   5. Transition selection — SINGLE / SHUFFLE ALL, with the live duration.
//
// What this replaced was the deck's full `<PatternAutopilotPanel>`: cadence
// pills from 1 s to 3 m, pattern-order shuffle, GROUP + SIZE + DWELL, a full
// transition picker/time editor, and a next-swap countdown. Those settings
// remain AUTHORABLE in show YAML and reachable over the unchanged wire. This
// card exposes only the operator's requested transition choice — one authored
// transition or SHUFFLE ALL — because the reveal needs a safe two-button
// decision, not the complete VJ panel. The DECK tab's panel is untouched (no
// edits under `components/deck/`).
//
// The countdown is deliberately omitted ("that's it"): the name changing plus
// the lit PLAY carries liveness. It is a one-line add-back if that reads wrong
// on the rig.
//
// PURE PRESENTATION + ROUND TRIPS. This card holds NO local state: every
// control emits a sparse patch and the values redraw from the engine's answer,
// so a cadence the engine refused snaps back instead of lying. Pill mapping and
// the off-pill caption live in `show_autopilot_logic.ts` (unit-tested).
//
// Night ergonomics (docs/54, .agent/os/ui_design.md): one panel object —
// surface + hairline + identity dot + uppercase title; PLAY is a live-green
// state-tinted toggle; the pills wear the quiet-chip tone; the name is
// SpaceGrotesk. Every target clears 44 pt.

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { MiniFader } from '@/components/ui/MiniFader';
import {
  PILL_SECONDS,
  TRANSITION_SELECTIONS,
  litPillSeconds,
  offPillCaption,
  pillSeconds,
} from '@/components/special_events/show_autopilot_logic';
import {
  nowPlayingTitle,
  type EventAutopilotPatch,
  type EventNowPlaying,
} from '@/utils/special_events_api';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
/** Comfortably over the 44 pt floor, matching the tab's chrome buttons. */
const CONTROL_MIN_HEIGHT = 56;

export interface ShowAutopilotCardProps {
  /** Rotation running? */
  active: boolean;
  /** Live cadence in seconds, straight off the runner. */
  everySec: number | null;
  /** The deck's active entry, or null when there is nothing to name. */
  nowPlaying: EventNowPlaying | null;
  /** Randomize transition scripts for each swap? */
  transitionShuffle: boolean;
  /** Live transition time; rendered honestly even after a live override. */
  transitionDurationMs: number;
  /** Shared 0..1 rig clock. Kept live from the engine, never card-local state. */
  globalSpeed: number;
  /** Dim to near-black — a ceremonial stage is live elsewhere on the column. */
  dimmed: boolean;
  onChange: (patch: EventAutopilotPatch) => void;
  onGlobalSpeedChange: (speed: number) => void;
}

export function ShowAutopilotCard({
  active, everySec, nowPlaying, transitionShuffle, transitionDurationMs,
  globalSpeed, dimmed, onChange, onGlobalSpeedChange,
}: ShowAutopilotCardProps) {
  const C = usePalette();
  const title = nowPlayingTitle(nowPlaying);
  const litSeconds = litPillSeconds(everySec);
  const caption = offPillCaption(everySec);

  return (
    <View
      accessibilityLabel="Show autopilot"
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: C.ghostBorder,
        backgroundColor: C.surfaceContainerLow,
        paddingHorizontal: 18,
        paddingVertical: 16,
        marginBottom: 18,
        opacity: dimmed ? 0.18 : 1,
      }}
    >
      {/* ── identity ─────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: active ? C.tertiary : C.ghostBorder,
        }} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 12,
          letterSpacing: 1.6,
          color: C.secondary,
        }}>
          SHOW AUTOPILOT
        </Text>
      </View>

      {/* ── 1. NOW PLAYING ───────────────────────────────────────────── */}
      {/* The deck's active entry, named the way the operator named it. A deck
          with no entry to name says so rather than showing a confident blank. */}
      <Text style={{
        fontFamily: 'Inter_400Regular',
        fontSize: 11,
        letterSpacing: 1.2,
        color: C.secondary,
        marginTop: 14,
      }}>
        NOW PLAYING
      </Text>
      <Text
        numberOfLines={1}
        accessibilityLabel={title === null ? 'Nothing playing' : `Now playing ${title}`}
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 24,
          letterSpacing: 0.4,
          color: title === null ? C.secondary : C.text,
          marginTop: 2,
        }}
      >
        {title === null ? '—' : title}
      </Text>

      {/* ── 2. GLOBAL SPEED ───────────────────────────────────────────── */}
      <View style={{ width: '100%', maxWidth: 440, marginTop: 16 }}>
        <MiniFader
          label="GLOBAL SPEED"
          badge="RIG"
          value={Math.max(0, Math.min(1, globalSpeed))}
          disabled={dimmed}
          onChange={onGlobalSpeedChange}
        />
      </View>

      {/* ── 3. PLAY / PAUSE ──────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <TouchableOpacity
          onPress={() => onChange({ active: !active })}
          disabled={dimmed}
          activeOpacity={0.8}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={active ? 'Pause the show autopilot' : 'Play the show autopilot'}
          accessibilityState={{ disabled: dimmed, selected: active }}
          style={{
            minHeight: CONTROL_MIN_HEIGHT,
            minWidth: 132,
            paddingHorizontal: 22,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active ? C.surfaceContainerHigh : C.surfaceContainerLowest,
            borderWidth: 2,
            borderColor: active ? C.tertiary : C.ghostBorder,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 16,
            letterSpacing: 1.4,
            color: active ? C.tertiary : C.secondary,
          }}>
            {active ? 'PAUSE' : 'PLAY'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── 4. TIME PILLS ────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
        {PILL_SECONDS.map((seconds) => {
          const lit = litSeconds === seconds;
          return (
            <TouchableOpacity
              key={seconds}
              onPress={() => onChange({ everySec: pillSeconds(seconds) })}
              disabled={dimmed}
              activeOpacity={0.8}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`Change pattern every ${seconds} seconds`}
              accessibilityState={{ disabled: dimmed, selected: lit }}
              style={{
                minHeight: CONTROL_MIN_HEIGHT,
                minWidth: 62,
                paddingHorizontal: 14,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: lit ? C.surfaceContainerHigh : C.surfaceContainerLowest,
                borderWidth: lit ? 2 : 1,
                borderColor: lit ? C.primary : C.ghostBorder,
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 18,
                color: lit ? C.text : C.secondary,
              }}>
                {seconds}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 11,
          letterSpacing: 1.2,
          color: C.secondary,
          marginLeft: 4,
        }}>
          SECONDS
        </Text>
      </View>

      {/* An authored cadence that matches no pill lights nothing and prints
          itself here — the card never rounds a number the operator chose. */}
      {caption === null ? null : (
        <Text style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 11,
          color: C.secondary,
          marginTop: 8,
        }}>
          {`Show file says ${caption} — tap a pill to change it.`}
        </Text>
      )}

      {/* ── 5. TRANSITION STYLE ─────────────────────────────────────────── */}
      <Text style={{
        fontFamily: 'Inter_400Regular',
        fontSize: 11,
        letterSpacing: 1.2,
        color: C.secondary,
        marginTop: 16,
      }}>
        {`TRANSITIONS · ${(transitionDurationMs / 1000).toFixed(
          transitionDurationMs % 1000 === 0 ? 0 : 1,
        )} SEC`}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {TRANSITION_SELECTIONS.map((selection) => {
          const lit = transitionShuffle === selection.shuffle;
          return (
            <TouchableOpacity
              key={selection.label}
              onPress={() => onChange({ transition: { shuffle: selection.shuffle } })}
              disabled={dimmed}
              activeOpacity={0.8}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={selection.shuffle
                ? 'Shuffle all transition styles'
                : 'Use the single authored transition style'}
              accessibilityState={{ disabled: dimmed, selected: lit }}
              style={{
                minHeight: CONTROL_MIN_HEIGHT,
                minWidth: 132,
                paddingHorizontal: 18,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: lit ? C.surfaceContainerHigh : C.surfaceContainerLowest,
                borderWidth: lit ? 2 : 1,
                borderColor: lit ? C.primary : C.ghostBorder,
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 14,
                letterSpacing: 0.8,
                color: lit ? C.text : C.secondary,
              }}>
                {selection.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
