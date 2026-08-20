// LinkBar — slim persistent connection strip.
//
// Renders ABOVE the tab bar whenever a Heltec is connected. Shows the
// captain Heltec's advertised name, our node id, the AES key
// fingerprint (proves both ends are running the same secret), and a
// short row of live link counters. The most recent reply / nak / pong
// summary tucks under the counters so the operator gets one-glance
// confirmation that their last action landed.
//
// Stability rules:
//   * We poll readLinkStats() every 3 s. That's 4 short BLE reads —
//     the Heltec serves them out of memory, so cost is negligible.
//   * `setStats` is partial-merge with a no-op short-circuit, so a
//     poll that returns identical values triggers zero renders.
//   * Each Stat subscribes to its own slice of the store via
//     fine-grained selectors. A SNR change doesn't re-render TX/RX,
//     etc. — that's what kept the top metrics from flickering on
//     every poll cycle.
//   * Numeric formatters are stable: ints stay ints, dB shows one
//     decimal, dBm shows zero. The `Stat` component never receives
//     "—" alongside a number on the same render, so it never has to
//     re-layout the column width.

import React, { memo, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BleClient } from "../ble/client";
import { maskFingerprint } from "../security/secretStore";
import { useAppStore } from "../state/store";
import { C, F, R, S } from "./theme";

interface Props {
  ble: BleClient;
  fingerprint: string;
  src: number;
  onDisconnect: () => void;
  /** Open the SecretEntrySheet to replace the active key in flight. */
  onChangeSecret?: () => void;
}

export function LinkBar({ ble, fingerprint, src, onDisconnect, onChangeSecret }: Props) {
  const conn = useAppStore((s) => s.conn);
  const setStats = useAppStore((s) => s.setStats);
  const lastReply = useAppStore((s) => s.lastReplySummary);

  // Periodically poll the firmware-side LoRa link snapshot. Cheap (~4
  // BLE reads), gives the operator something to watch while walking.
  useEffect(() => {
    if (conn.kind !== "connected") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await ble.readLinkStats();
        if (cancelled) return;
        setStats({
          loraTxCount: s.txCount,
          loraRxCount: s.rxCount,
          loraLastRssi: s.rssi,
          loraLastSnr: s.snr,
        });
      } catch {
        // BLE reads can fail mid-disconnect; do not log a per-tick
        // error to avoid spamming the metro logs (and the screen).
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [conn.kind, ble, setStats]);

  if (conn.kind !== "connected") return null;

  return (
    <View style={styles.bar}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {conn.deviceName}
          </Text>
          <Text style={styles.idLine} numberOfLines={1}>
            src=0x{src.toString(16).padStart(2, "0")} · key{" "}
            {maskFingerprint(fingerprint, "tail")}
          </Text>
        </View>
        {onChangeSecret && (
          <Pressable
            onPress={onChangeSecret}
            style={({ pressed }) => [
              styles.changeKeyBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.changeKeyBtnText}>CHANGE KEY</Text>
          </Pressable>
        )}
        <Pressable
          onPress={onDisconnect}
          style={({ pressed }) => [
            styles.disconnectBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.disconnectBtnText}>DISCONNECT</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <BleRssiStat />
        <LoraRssiStat />
        <SnrStat />
        <TxStat />
        <RxStat />
      </View>

      {lastReply && (
        <Text style={styles.lastReply} numberOfLines={1}>
          {lastReply}
        </Text>
      )}
    </View>
  );
}

// ── Per-cell subscribers ────────────────────────────────────────────
//
// Each cell selects a single primitive from the store. Because the
// selector returns `number | null`, Zustand's referential-equality
// check means re-renders only happen when the underlying value
// actually changed — even if some other field of `stats` updated on
// the same poll cycle.

const BleRssiStat = memo(function BleRssiStat() {
  const v = useAppStore((s) => s.stats.bleRssi);
  return <Stat label="BLE" value={fmtDbm(v)} unit="dBm" />;
});

const LoraRssiStat = memo(function LoraRssiStat() {
  const v = useAppStore((s) => s.stats.loraLastRssi);
  return <Stat label="LoRa" value={fmtDbm(v)} unit="dBm" />;
});

const SnrStat = memo(function SnrStat() {
  const v = useAppStore((s) => s.stats.loraLastSnr);
  return <Stat label="SNR" value={fmtSnr(v)} unit="dB" />;
});

const TxStat = memo(function TxStat() {
  const v = useAppStore((s) => s.stats.loraTxCount);
  return <Stat label="TX" value={fmtCount(v)} />;
});

const RxStat = memo(function RxStat() {
  const v = useAppStore((s) => s.stats.loraRxCount);
  return <Stat label="RX" value={fmtCount(v)} />;
});

const Stat = memo(function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {unit && <Text style={styles.statUnit}>{unit}</Text>}
    </View>
  );
});

function fmtDbm(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}`;
}
function fmtSnr(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}
function fmtCount(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toString();
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: C.card,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    gap: S.sm,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  deviceName: {
    color: C.text,
    fontSize: F.subtitle,
    fontWeight: "800",
    letterSpacing: 1,
  },
  idLine: {
    color: C.textDim,
    fontSize: 11,
    fontFamily: "Menlo",
    marginTop: 2,
  },
  disconnectBtn: {
    backgroundColor: C.bg,
    borderColor: C.err,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
  },
  disconnectBtnText: {
    color: C.err,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  changeKeyBtn: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
  },
  changeKeyBtnText: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  statsRow: { flexDirection: "row", gap: 6 },
  statCol: {
    flex: 1,
    backgroundColor: C.cardSunken,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: R.pill,
    alignItems: "center",
    minHeight: 56,
  },
  statLabel: {
    color: C.textDim,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  statValue: {
    color: C.text,
    fontFamily: "Menlo",
    fontSize: F.body,
    marginTop: 2,
    fontWeight: "700",
  },
  statUnit: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: "600",
    marginTop: 1,
  },
  lastReply: {
    color: C.textDim,
    fontSize: F.small,
    fontFamily: "Menlo",
    marginTop: 4,
  },
});
