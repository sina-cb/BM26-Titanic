// StepperBar — discrete-value picker laid out as a horizontal track.
//
// Why we don't use the React-Native community `Slider`:
//   * Continuous sliders make the user generate dozens of writes per
//     gesture; LoRa is a 1 fps medium and that overflows the bridge.
//   * Discrete steps make the operator's intent crisp on the wire — one
//     gesture = one frame, with no debouncing logic to get wrong.
//   * The discrete steps map naturally to chip-style affordances on
//     iPad, which read better than a thin native track.
//
// Behaviour:
//   * Tapping a chip fires `onChange(value)` once. There is no drag.
//   * The currently-selected chip is rendered with the accent colour
//     filled in.
//   * `pending` shows a thin shimmer until the bridge replies; this
//     makes it obvious that the action is in flight even on a 5-second
//     LoRa round-trip.

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

interface Props<T extends number | string> {
  /** Optional label above the bar. */
  label?: string;
  /** Optional sub-label / unit (e.g. "%", "ms"). */
  unit?: string;
  values: ReadonlyArray<T>;
  current: T | null;
  onChange: (next: T) => void;
  accent: string;
  pending?: boolean;
  disabled?: boolean;
  /** Optional formatter for the value labels (defaults to String). */
  format?: (v: T) => string;
}

export function StepperBar<T extends number | string>({
  label,
  unit,
  values,
  current,
  onChange,
  accent,
  pending,
  disabled,
  format,
}: Props<T>) {
  const fmt = format ?? ((v: T) => String(v));
  return (
    <View style={styles.outer}>
      {(label || unit || pending) && (
        <View style={styles.header}>
          {label ? (
            <Text style={[styles.label, { color: accent }]}>
              {label}
            </Text>
          ) : null}
          {unit ? <Text style={styles.unit}>{unit}</Text> : null}
          {pending ? (
            <ActivityIndicator color={accent} size="small" />
          ) : null}
        </View>
      )}
      <View style={styles.track}>
        {values.map((v) => {
          const active = current === v;
          return (
            <Pressable
              key={String(v)}
              disabled={disabled}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                onChange(v);
              }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? accent + "33" : C.cardSunken,
                  borderColor: active ? accent : C.border,
                },
                pressed && !disabled && { opacity: 0.7 },
                disabled && styles.disabled,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? accent : C.text },
                ]}
              >
                {fmt(v)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { gap: S.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
  },
  label: {
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
    flex: 1,
    textTransform: "uppercase",
  },
  unit: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  track: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: S.sm,
  },
  chip: {
    flexBasis: "18%",
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: S.sm,
    borderWidth: 1,
    borderRadius: R.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.4,
  },
  chipText: {
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: "Menlo",
  },
});
