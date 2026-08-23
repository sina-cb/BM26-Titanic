// stage_button — the button family the SPECIAL EVENTS tab draws.
//
// Pure presentation. Every enable/disable decision arrives as a prop from
// special_events_view.ts (which derives it from engine state); nothing here
// decides whether a tap is legal.
//
// Night ergonomics (docs/52 §5, .agent/os/ui_design.md):
//   * stage rows  ≥ 88 pt tall, ceremonial choice buttons ≥ 160 pt — the
//     biggest targets in the app, because they are pressed by a person who is
//     looking at the ship, not at the glass.
//   * quick-effect and chrome buttons ≥ 56 pt with hitSlop on top.
//   * All chrome colour from `usePalette()`; only the SHOW's own accents are
//     data, and they arrive pre-contrast-checked as `AccentPaint`.
//   * accessibilityRole / Label / State on every control.

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import type {
  AccentPaint,
  ChoiceViewModel,
  EffectViewModel,
  StageViewModel,
} from '@/components/special_events/special_events_view';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Stage rows: tall enough to hit without looking. */
const STAGE_MIN_HEIGHT = 88;
/** The reveal moment. The biggest thing this app draws. */
const CEREMONY_MIN_HEIGHT = 168;
/** Quick effects + chrome. Comfortably over the 44 pt floor. */
const SMALL_MIN_HEIGHT = 56;

// ── Stage row ─────────────────────────────────────────────────────────────

export interface EventStageButtonProps {
  stage: StageViewModel;
  /** Contrast-checked show accent, or null to use theme tokens. */
  paint: AccentPaint | null;
  /** Dim to near-black — a ceremonial stage is live elsewhere on the column. */
  dimmed: boolean;
  onPress: () => void;
}

export function EventStageButton({ stage, paint, dimmed, onPress }: EventStageButtonProps) {
  const C = usePalette();
  const isArmed = stage.state === 'armed';
  const isCurrent = stage.state === 'current';
  const isDone = stage.state === 'done';

  const accent = paint ? paint.fill : C.primary;
  const opacity = dimmed ? 0.18 : (stage.state === 'locked' ? 0.4 : (isDone ? 0.55 : 1));

  const statusWord = isCurrent ? 'LIVE' : (isArmed ? 'NEXT' : (isDone ? 'DONE' : 'LOCKED'));
  const countdown = stage.countdownSec === null ? null : formatCountdown(stage.countdownSec);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!stage.fireable}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${stage.label} — ${statusWord.toLowerCase()} stage`}
      accessibilityHint={stage.requiresConfirm ? 'Re-runs the stage that is already live' : undefined}
      accessibilityState={{ disabled: !stage.fireable, selected: isCurrent }}
      style={{
        minHeight: STAGE_MIN_HEIGHT,
        borderRadius: 18,
        paddingHorizontal: 22,
        paddingVertical: 18,
        marginBottom: 14,
        opacity,
        justifyContent: 'center',
        backgroundColor: isArmed ? C.surfaceContainerHigh : C.surfaceContainerLow,
        borderWidth: isCurrent || isArmed ? 3 : 1,
        borderColor: isCurrent || isArmed ? accent : C.ghostBorder,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {isDone ? (
          <IconSymbol name="checkmark.circle.fill" size={26} color={C.secondary} />
        ) : (
          <View style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: isCurrent || isArmed ? accent : C.ghostBorder,
          }} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 26,
            letterSpacing: 0.6,
            color: C.text,
          }}>
            {stage.label}
          </Text>
          {/* The show's own one-liner. Authored in the YAML next to the stage,
              so what the operator reads at 2 a.m. is what the show author
              meant, not something this file guessed. */}
          {stage.hint === null ? null : (
            <Text style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 13,
              lineHeight: 18,
              color: C.secondary,
              marginTop: 3,
            }}>
              {stage.hint}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 12,
            letterSpacing: 1.6,
            color: isCurrent || isArmed ? accent : C.secondary,
          }}>
            {statusWord}
          </Text>
          {countdown === null ? null : (
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 22,
              color: C.text,
              marginTop: 2,
            }}>
              {countdown}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/** Seconds → `M:SS` for the auto-advance readout. */
export function formatCountdown(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ── Ceremonial choice button ──────────────────────────────────────────────

export interface EventChoiceButtonProps {
  choice: ChoiceViewModel;
  paint: AccentPaint | null;
  onPress: () => void;
}

export function EventChoiceButton({ choice, paint, onPress }: EventChoiceButtonProps) {
  const C = usePalette();
  const fill = choice.enabled ? (paint ? paint.fill : C.primary) : C.surfaceContainerLow;
  const ink = choice.enabled ? (paint ? paint.ink : C.onPrimary) : C.secondary;
  const stateLabel = choice.selected ? 'LIVE' : (choice.enabled ? 'ENABLED' : 'OFF');
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!choice.enabled}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`${choice.label} — ${stateLabel.toLowerCase()}`}
      accessibilityHint={choice.requiresConfirm
        ? 'Replaces the answer already on the rig — asks for confirmation'
        : 'Reveals this answer on the whole ship'}
      accessibilityState={{ disabled: !choice.enabled, selected: choice.selected }}
      style={{
        flex: 1,
        minHeight: choice.compact ? SMALL_MIN_HEIGHT : CEREMONY_MIN_HEIGHT,
        borderRadius: choice.compact ? 14 : 24,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        backgroundColor: fill,
        borderWidth: choice.enabled ? 0 : 1,
        borderColor: C.ghostBorder,
        opacity: choice.enabled ? 1 : 0.4,
      }}
    >
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: choice.compact ? 4 : 10,
      }}>
        <View style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: choice.enabled ? ink : C.ghostBorder,
        }} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: choice.compact ? 10 : 12,
          letterSpacing: 1.5,
          color: ink,
        }}>
          {stateLabel}
        </Text>
      </View>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: choice.compact ? 16 : 40,
        letterSpacing: 1,
        textAlign: 'center',
        color: ink,
      }}>
        {choice.label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Quick-effect pulse ────────────────────────────────────────────────────

export interface EventEffectButtonProps {
  effect: EffectViewModel;
  paint: AccentPaint | null;
  onPress: () => void;
}

export function EventEffectButton({ effect, paint, onPress }: EventEffectButtonProps) {
  const C = usePalette();
  const accent = paint ? paint.fill : C.tertiary;
  const stateLabel = !effect.enabled
    ? 'LOCKED'
    : effect.mode === 'toggle'
      ? (effect.active ? 'ON' : 'OFF')
      : 'READY';
  const highlighted = effect.enabled && (effect.mode === 'pulse' || effect.active);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!effect.enabled}
      activeOpacity={0.8}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`${effect.label} — quick effect ${stateLabel.toLowerCase()}`}
      accessibilityState={{ disabled: !effect.enabled, selected: effect.active }}
      style={{
        flexGrow: 1,
        flexBasis: 160,
        minHeight: SMALL_MIN_HEIGHT,
        minWidth: 160,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: effect.active ? C.secondaryContainer : (
          effect.enabled ? C.surfaceContainerHigh : C.surfaceContainerLow
        ),
        borderWidth: 2,
        borderColor: highlighted ? accent : C.ghostBorder,
        opacity: effect.enabled ? 1 : 0.35,
      }}
    >
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
      }}>
        <View style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: highlighted ? accent : C.ghostBorder,
        }} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 10,
          letterSpacing: 1.5,
          color: highlighted ? accent : C.secondary,
        }}>
          {stateLabel}
        </Text>
      </View>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 15,
        letterSpacing: 1,
        textAlign: 'center',
        color: effect.enabled ? C.text : C.secondary,
      }}>
        {effect.label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Chrome (EXTEND / FINISH / ABORT) ──────────────────────────────────────

export type EventChromeTone = 'extend' | 'finish' | 'abort';

export interface EventChromeButtonProps {
  label: string;
  tone: EventChromeTone;
  disabled?: boolean;
  onPress: () => void;
}

export function EventChromeButton({ label, tone, disabled = false, onPress }: EventChromeButtonProps) {
  const C = usePalette();
  // ABORT is deliberately the ONLY outlined-red control on the surface: it must
  // never be mistaken for a ceremonial button in the dark.
  const border = tone === 'abort' ? C.error : (tone === 'finish' ? C.primary : C.ghostBorder);
  const fill = tone === 'finish' ? C.primaryContainer : 'transparent';
  const text = tone === 'abort' ? C.error : C.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{
        minHeight: SMALL_MIN_HEIGHT,
        minWidth: 150,
        paddingHorizontal: 22,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: fill,
        borderWidth: 2,
        borderColor: border,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 15,
        letterSpacing: 1.2,
        color: text,
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
