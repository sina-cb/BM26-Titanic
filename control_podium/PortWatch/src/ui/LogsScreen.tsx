// LogsScreen — wire-level event log.
//
// Every Titanic Frame v2 line that flows in or out is captured here:
// the request, the reply, pubs we observe in passing, and any decode
// or transport errors. Newest first.
//
// Time-window filter:
//   * Store retains up to MAX_LOG_ENTRIES (~1000) so a long quiet
//     spell still has something to scroll through.
//   * UI displays only the LAST_N_MINUTES of activity. That keeps the
//     scroll viewport responsive even after hours of use, and lines up
//     with the operator's mental model: "the log shows what just
//     happened, not the whole session."
//   * Force a re-render every 30 s so old rows fade out without the
//     user having to interact.

import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAppStore } from "../state/store";
import { useFormFactor, MAX_CONTENT_WIDTH } from "./layout";
import { C, F, R, S } from "./theme";

/** Time window the LogsScreen surfaces to the operator. */
const LAST_N_MINUTES = 5;

export function LogsScreen() {
  const log = useAppStore((s) => s.log);
  const clearLog = useAppStore((s) => s.clearLog);
  const ff = useFormFactor();
  const padding = ff === "compact" ? S.md : S.lg;

  // Tick to re-evaluate the cutoff every 30 s so rows that age out of
  // the window disappear without requiring user interaction.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const cutoff = Date.now() - LAST_N_MINUTES * 60_000;
  const visible = useMemo(
    () => log.filter((e) => e.ts >= cutoff),
    // We deliberately invalidate the memo on `tick` so the cutoff
    // refreshes; the dep on `log` itself catches any new rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, tick],
  );
  const hidden = log.length - visible.length;

  return (
    <View style={styles.outer}>
      <View style={[styles.header, { paddingHorizontal: padding }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>WIRE LOG</Text>
          <Text style={styles.sub}>
            {visible.length} entries · last {LAST_N_MINUTES} min · newest first
            {hidden > 0 ? ` · ${hidden} older hidden` : ""}
          </Text>
        </View>
        <Pressable
          onPress={clearLog}
          style={({ pressed }) => [
            styles.clearBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.clearBtnText}>CLEAR</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingHorizontal: padding, paddingBottom: padding * 2 },
        ]}
      >
        <View
          style={[
            styles.column,
            { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" },
          ]}
        >
          {visible.length === 0 && (
            <Text style={styles.empty}>
              {log.length === 0
                ? "No traffic yet."
                : `No traffic in the last ${LAST_N_MINUTES} min.`}
            </Text>
          )}
          {visible.map((e, i) => {
            const time = new Date(e.ts).toISOString().substring(11, 23);
            const ageSec = Math.max(0, Math.floor((Date.now() - e.ts) / 1000));
            return (
              <View
                key={`${e.ts}-${i}`}
                style={[
                  styles.row,
                  e.dir === "tx" ? styles.rowTx : styles.rowRx,
                  !e.ok && styles.rowErr,
                ]}
              >
                <View style={styles.rowHeader}>
                  <Text
                    style={[
                      styles.dirBadge,
                      e.dir === "tx" ? styles.dirTx : styles.dirRx,
                    ]}
                  >
                    {e.dir.toUpperCase()}
                  </Text>
                  <Text style={styles.time}>{time}</Text>
                  <Text style={styles.age}>{fmtAge(ageSec)}</Text>
                  {e.frame && (
                    <Text style={styles.fields} numberOfLines={1}>
                      src=0x{e.frame.src.toString(16).padStart(2, "0")} → dst=0x
                      {e.frame.dst.toString(16).padStart(2, "0")} · seq=0x
                      {e.frame.seq.toString(16).padStart(2, "0")}
                      {e.ctr !== undefined ? ` · ctr=${e.ctr}` : ""}
                    </Text>
                  )}
                </View>
                <Text style={styles.summary} numberOfLines={2}>
                  {e.summary}
                </Text>
                <Text style={styles.raw} numberOfLines={1}>
                  {e.raw}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function fmtAge(sec: number): string {
  if (sec < 1) return "now";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m`;
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    paddingTop: S.md,
    paddingBottom: S.md,
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
  },
  title: {
    color: C.text,
    fontSize: F.title,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  sub: { color: C.textDim, fontSize: F.small },
  clearBtn: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
  },
  clearBtnText: {
    color: C.text,
    fontSize: F.small,
    fontWeight: "800",
    letterSpacing: 2,
  },
  scroll: { paddingTop: S.md, paddingBottom: 32 },
  column: { gap: 6 },
  empty: {
    color: C.textDim,
    fontSize: F.body,
    textAlign: "center",
    marginTop: 32,
  },
  row: {
    backgroundColor: C.card,
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderLeftWidth: 3,
  },
  rowTx: { borderLeftColor: C.accent },
  rowRx: { borderLeftColor: C.ok },
  rowErr: { borderLeftColor: C.err },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    marginBottom: 4,
  },
  dirBadge: {
    fontFamily: "Menlo",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  dirTx: { color: C.accent, backgroundColor: C.accent + "22" },
  dirRx: { color: C.ok, backgroundColor: C.ok + "22" },
  time: {
    color: C.textDim,
    fontFamily: "Menlo",
    fontSize: 11,
  },
  age: {
    color: C.textMuted,
    fontFamily: "Menlo",
    fontSize: 10,
  },
  fields: {
    color: C.textDim,
    fontFamily: "Menlo",
    fontSize: 11,
    flex: 1,
  },
  summary: {
    color: C.text,
    fontSize: F.body,
    fontWeight: "600",
  },
  raw: {
    color: C.textMuted,
    fontFamily: "Menlo",
    fontSize: 11,
    marginTop: 4,
  },
});
