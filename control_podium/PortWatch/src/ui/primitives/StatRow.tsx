// StatRow — generic key/value row used inside Status cards.
//
// Every Status card has a vertical list of "label : value" pairs. This
// component standardises the styling so labels stay aligned across
// rows and per-status colour cues work consistently (e.g. red value
// when `tone="bad"`).

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { C, F, S } from "../theme";

export type StatTone = "neutral" | "good" | "warn" | "bad" | "muted";

interface Props {
  label: string;
  value: string | number | null | undefined;
  tone?: StatTone;
  /** Optional small line under the value (units, source). */
  hint?: string;
  /** Mono font for the value (e.g. when it's a hex string or a count). */
  mono?: boolean;
}

export function StatRow({ label, value, tone, hint, mono }: Props) {
  const valueStr =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.valueWrap}>
        <Text
          style={[
            styles.value,
            mono && styles.mono,
            tone && { color: COLORS[tone] },
          ]}
          numberOfLines={1}
        >
          {valueStr}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const COLORS: Record<StatTone, string> = {
  neutral: C.text,
  good: C.ok,
  warn: C.warn,
  bad: C.err,
  muted: C.textMuted,
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: S.md,
    minHeight: 28,
  },
  label: {
    color: C.textDim,
    fontSize: F.small,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    width: 110,
  },
  valueWrap: {
    flex: 1,
    alignItems: "flex-end",
  },
  value: {
    color: C.text,
    fontSize: F.body,
    fontWeight: "700",
    textAlign: "right",
  },
  mono: {
    fontFamily: "Menlo",
  },
  hint: {
    color: C.textMuted,
    fontSize: F.micro,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "right",
  },
});
