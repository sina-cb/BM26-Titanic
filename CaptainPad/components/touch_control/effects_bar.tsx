// effects_bar — STROBE · RANDOM · TRACERS row across the bottom of the
// TOUCH CONTROL tab.
//
// Sits below both panels so it obeys this tab's layout rule (surfaces on top,
// buttons on the bottom) without crowding either panel's own button row.
//
// ── What these buttons drive ─────────────────────────────────────────────
// Library effects are reached through GEM slots, not the legacy
// `POST /global-effect` route (that one throws on any non-legacy id). Each
// button resolves to the slot already bound to its (effectId, presetId) and
// toggles THAT slot, so the operator's existing effect layout is reused
// rather than rewritten. Only "RANDOM" (Frost Sparkle) is bound nowhere on
// this rig, so the screen provisions it into the first free slot at id >= 9 —
// past the 8 slots the Deck/Mixer grid and VSN1 page display.
//
// A button whose effect is not bound AND could not be provisioned renders in
// an explicit UNBOUND state rather than pretending to work — Codex P0: a
// control that silently does nothing is worse than one that says it can't.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import {
  TOUCH_EFFECTS,
  findSlotFor,
  type EffectSlotLike,
  type EffectSpec,
} from './touch_control_logic';

export interface EffectsBarProps {
  /** Live slot status from GET /global-effect-slots/status + the
   *  `globalEffectSlots` broadcast. Empty until the first seed lands. */
  slots: EffectSlotLike[];
  /** Toggle the slot bound to this effect. The screen resolves/provisions. */
  onToggle: (spec: EffectSpec) => void;
  disabled: boolean;
}

function EffectButton({
  spec,
  slot,
  onPress,
  disabled,
}: {
  spec: EffectSpec;
  slot: EffectSlotLike | null;
  onPress: () => void;
  disabled: boolean;
}) {
  const C = usePalette();
  const active = slot?.active === true;
  // Not bound to any slot yet. The screen provisions RANDOM on demand, so this
  // is a transient state for it — but it must still READ honestly meanwhile.
  const unbound = slot === null;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${spec.label} effect`}
      accessibilityState={{ selected: active, disabled }}
      style={{
        flexGrow: 1,
        flexBasis: 110,
        minHeight: 64,
        paddingHorizontal: 12,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: active ? C.primary : C.ghostBorder,
        backgroundColor: active ? C.primary : C.surfaceContainerLowest,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 13,
          letterSpacing: 1,
          color: active ? C.onPrimary : C.text,
        }}
      >
        {spec.label}
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 9,
          marginTop: 2,
          textAlign: 'center',
          color: active ? C.onPrimary : C.icon,
        }}
      >
        {unbound ? 'not bound' : active ? 'ON' : 'off'}
      </Text>
    </TouchableOpacity>
  );
}

export function EffectsBar({ slots, onToggle, disabled }: EffectsBarProps) {
  const C = usePalette();

  const gate = TOUCH_EFFECTS.filter((e) => e.group === 'gate');
  const overlay = TOUCH_EFFECTS.filter((e) => e.group === 'overlay');
  const tracers = TOUCH_EFFECTS.filter((e) => e.group === 'tracer');

  // Lookup keys on effect + PRESET only — deliberately NOT on paramsOverride.
  // Two reasons: (1) each tracer now owns its own preset, which is the same
  // granularity the engine's own `active` check uses, so presets are already
  // unique; (2) `speedHz` inside the override is changed at runtime by the Z
  // axis, and matching on it would make a slot "disappear" the moment its
  // speed was tuned.
  const render = (spec: EffectSpec) => (
    <EffectButton
      key={spec.key}
      spec={spec}
      slot={findSlotFor(slots, spec.effectId, spec.presetId)}
      onPress={() => onToggle(spec)}
      disabled={disabled}
    />
  );

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 14,
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: C.ghostBorder,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 12,
            letterSpacing: 2,
            color: C.text,
          }}
        >
          EFFECTS
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon, flex: 1 }}>
          tracers run a light band down the fixtures on a loop — one direction at a time
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {gate.map(render)}
        {overlay.map(render)}

        {/* Tracer group — visually bracketed so the three pattern types read
            as variants of ONE effect rather than three unrelated buttons. */}
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            flexGrow: 3,
            flexBasis: 340,
            padding: 6,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLow,
          }}
        >
          <View style={{ justifyContent: 'center', paddingHorizontal: 4 }}>
            <Text
              style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 10,
                letterSpacing: 1,
                color: C.secondary,
              }}
            >
              TRACERS
            </Text>
          </View>
          {tracers.map(render)}
        </View>
      </View>
    </View>
  );
}
