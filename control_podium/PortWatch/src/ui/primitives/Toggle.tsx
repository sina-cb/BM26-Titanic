// Toggle — large pressable on/off button.
//
// We don't use the native `Switch` because (a) its hit area is tiny on
// iPad and (b) it doesn't surface `pending` state, which we need a lot
// of since LoRa round-trips can take seconds.
//
// State semantics:
//   * `value === true`  — control is ON. Surface is filled with the
//                         accent colour.
//   * `value === false` — control is OFF. Surface is the card colour
//                         with a thin accent border.
//   * `pending`         — we just sent a frame and haven't seen the
//                         reply yet. UI shows the OPTIMISTIC new value
//                         with a faint shimmer / dim so the user knows
//                         the action is in flight.
//   * `disabled`        — non-interactive. We use this for things like
//                         "pattern picker" while autopilot is ON, and
//                         for the Pyro placeholder which isn't wired
//                         into the bridge yet.

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { C, F, R, S } from "../theme";

interface Props {
  label: string;
  /** Optional secondary label (e.g. "MASTER", "GLOBAL"). */
  sub?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Domain accent — green for FX, pink for autopilot, etc. */
  accent: string;
  pending?: boolean;
  disabled?: boolean;
  /** Press-and-hold semantics — onChange(true) on press, false on release. */
  momentary?: boolean;
  /** Optional renderer for an icon glyph on the right edge. */
  trailing?: React.ReactNode;
}

export function Toggle({
  label,
  sub,
  value,
  onChange,
  accent,
  pending,
  disabled,
  momentary,
  trailing,
}: Props) {
  const handlePress = () => {
    if (disabled || momentary) return;
    Haptics.selectionAsync().catch(() => undefined);
    onChange(!value);
  };
  const handlePressIn = () => {
    if (disabled || !momentary) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(
      () => undefined,
    );
    onChange(true);
  };
  const handlePressOut = () => {
    if (disabled || !momentary) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
    onChange(false);
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: value ? accent + "26" : C.cardSunken,
          borderColor: value ? accent : C.border,
        },
        pressed && !disabled && {
          backgroundColor: value ? accent + "44" : C.cardActive,
        },
        disabled && styles.disabled,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.label,
            { color: value ? accent : C.text },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {sub ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {pending ? (
        <ActivityIndicator color={accent} size="small" />
      ) : (
        trailing ?? (
          <Text
            style={[
              styles.stateGlyph,
              { color: value ? accent : C.textDim },
            ]}
          >
            {momentary ? "↧" : value ? "ON" : "OFF"}
          </Text>
        )
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 56,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderRadius: R.pill * 1.5,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  sub: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 2,
    textTransform: "uppercase",
  },
  stateGlyph: {
    fontSize: F.small,
    fontWeight: "900",
    letterSpacing: 2,
    minWidth: 32,
    textAlign: "right",
  },
});
