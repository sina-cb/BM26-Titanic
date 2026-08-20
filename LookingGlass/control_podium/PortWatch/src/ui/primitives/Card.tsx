// Card — the only container PortWatch uses for grouping controls.
//
// Every screen is a vertical scroll of cards. Cards have a uniform
// surface, a strong title bar (with optional accent colour to mark the
// card's domain — e.g. green for FX, pink for Autopilot), and an
// optional disabled/badge state.
//
// The disabled state intentionally just dims the surface; it does NOT
// block child Pressables. Each child decides whether to honour the
// `disabled` semantic, because some cards have only some controls
// disabled (e.g. the Deck card with autopilot ON disables the manual
// pattern picker).

import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { C, F, R, S } from "../theme";

interface Props {
  title: string;
  /** Optional left accent stripe + title colour. Falls back to text/border. */
  accent?: string;
  /** Tiny right-side badge — e.g. "DISABLED", "WIP", or a live status. */
  badge?: string;
  /** Badge colour; defaults to textDim. */
  badgeColor?: string;
  /** Visually communicate "all controls inside are non-functional". */
  disabled?: boolean;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Card({
  title,
  accent,
  badge,
  badgeColor,
  disabled,
  children,
  style,
}: Props) {
  const accentColor = accent ?? C.borderStrong;
  return (
    <View
      style={[
        styles.card,
        { borderLeftColor: accentColor },
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.header}>
        <Text
          style={[
            styles.title,
            { color: accent ?? C.text },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {badge ? (
          <View
            style={[
              styles.badge,
              { borderColor: badgeColor ?? C.textDim },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: badgeColor ?? C.textDim },
              ]}
            >
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: R.card,
    borderLeftWidth: 4,
    borderTopColor: C.border,
    borderRightColor: C.border,
    borderBottomColor: C.border,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    overflow: "hidden",
  },
  disabled: {
    opacity: 0.55,
  },
  header: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
  },
  title: {
    fontSize: F.subtitle,
    fontWeight: "800",
    letterSpacing: 2,
    flex: 1,
    textTransform: "uppercase",
  },
  badge: {
    borderWidth: 1,
    paddingHorizontal: S.sm,
    paddingVertical: 2,
    borderRadius: R.pill,
  },
  badgeText: {
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  body: {
    paddingHorizontal: S.lg,
    paddingBottom: S.lg,
    gap: S.md,
  },
});
