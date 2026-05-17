// ScanScreen — first screen the operator sees. Lists discovered Heltec
// radios and connects to the one they tap.
//
// Design rules:
//   * Filter at the OS level by SERVICE UUID (handled in client.ts);
//     we only display what comes through that filter.
//   * Stable sort: bucket-by-RSSI in 5 dBm steps so two radios at
//     similar signal don't keep swapping rows. Tiebreaker is firstSeen
//     so the order is deterministic across renders.
//   * "Paired" badge shows on devices we've successfully connected to
//     in this app session (see store.ts pairedDeviceIds for the
//     intent / scope).
//   * Unpair flow is honest about iOS: apps can't remove BLE bonds, so
//     we offer to deep-link the user into Settings → Bluetooth and
//     clear our local marker.

import React, { useEffect, useMemo, useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BleClient } from "../ble/client";
import { maskFingerprint } from "../security/secretStore";
import { useAppStore } from "../state/store";
import { useFormFactor, MAX_CONTENT_WIDTH } from "./layout";
import { C, F, R, S } from "./theme";

/**
 * Width of the "RSSI bucket" used to stabilise the device-list sort
 * order. Two devices whose smoothed RSSI is within RSSI_BUCKET_DBM of
 * each other are considered "equally close" and ordered by first-seen
 * timestamp — that's what stops the list from visibly twitching when
 * two radios sit on the table next to each other and their RSSI swaps
 * back and forth by 1-3 dBm. A clearly closer radio still floats up.
 */
const RSSI_BUCKET_DBM = 5;

/**
 * Open iOS Settings → Bluetooth. Apps cannot remove BLE bonds, so the
 * unpair UX is "deep-link the user one tap from where they need to
 * be."
 *
 * Strategy (in order of preference):
 *   1. `App-Prefs:Bluetooth` — Apple's documented URL scheme that
 *      lands directly on the Bluetooth settings page. Works in dev,
 *      ad-hoc, TestFlight, and App Store builds.
 *   2. `App-Prefs:` — root Settings page (one tap from Bluetooth).
 *      Used if (1) silently fails on the current iOS build.
 *   3. `Linking.openSettings()` — the app's own Settings page. Last
 *      resort.
 */
async function openIosBluetoothSettings(): Promise<void> {
  const candidates = ["App-Prefs:Bluetooth", "App-Prefs:"];
  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // try the next one
    }
  }
  await Linking.openSettings().catch(() => undefined);
}

interface Props {
  ble: BleClient;
  onConnect: (deviceId: string, deviceName: string) => Promise<void>;
  /**
   * Always-available "Change key" affordance. Opens the SecretEntry
   * sheet on top of the scan screen so the operator can override the
   * baked / stored key with a fresh one (e.g. between camps, or to
   * recover from a typo without reinstalling). Wired to App.tsx's
   * onChangeSecret which surfaces the sheet inline.
   */
  onChangeSecret: () => void;
  /**
   * Optional "reset to baked / forget key" affordance. Provided when:
   *   * The current key came from Keychain (i.e. either a production
   *     build or a baked build that the operator overrode), so we
   *     have something to clear.
   *   * Wiring this differs by build flavor:
   *       - production: Forget → SecretEntrySheet on next render
   *       - dev/preview with override: Forget → fall back to baked
   */
  onForgetSecret?: () => Promise<void> | void;
  /**
   * Whether the Forget action falls back to a baked key (vs. clears
   * to nothing). Only changes the wording of the confirmation alert
   * so we don't lie to the operator about what's about to happen.
   */
  forgetFallsBackToBaked?: boolean;
  /**
   * Fingerprint to surface in the hero. Lets the operator confirm
   * (across the room, with the engine maintainer) that they're about
   * to talk to the right rig. Always shown masked by default.
   */
  keyFingerprint?: string;
}

export function ScanScreen({
  ble,
  onConnect,
  onChangeSecret,
  onForgetSecret,
  forgetFallsBackToBaked,
  keyFingerprint,
}: Props) {
  const ff = useFormFactor();
  const padding = ff === "compact" ? S.md : S.lg;
  const conn = useAppStore((s) => s.conn);
  const discovered = useAppStore((s) => s.discovered);
  const upsertDiscovered = useAppStore((s) => s.upsertDiscovered);
  const clearDiscovered = useAppStore((s) => s.clearDiscovered);
  const setConn = useAppStore((s) => s.setConn);
  const pairedDeviceIds = useAppStore((s) => s.pairedDeviceIds);
  const unmarkPaired = useAppStore((s) => s.unmarkPaired);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await ble.requestPermissions();
      if (cancelled) return;
      if (!ok) {
        setConn({ kind: "permissionDenied" });
        return;
      }
      setConn({ kind: "scanning" });
      try {
        ble.startScan(
          (d) => upsertDiscovered({ ...d, lastSeenMs: Date.now() }),
          // ble-plx callback errors arrive asynchronously, after
          // startScan() has returned — surface them so the UI can
          // render "scan failed: ..." instead of failing silently.
          (msg) => setConn({ kind: "error", message: `scan: ${msg}` }),
        );
      } catch (err: any) {
        setConn({ kind: "error", message: err?.message ?? String(err) });
      }
    })();
    return () => {
      cancelled = true;
      ble.stopScan();
    };
  }, [ble, setConn, upsertDiscovered]);

  // Memoised so the sort + bucket maths only re-run when the dict
  // identity changes (the store no-ops upserts that produce identical
  // entries — see store.ts upsertDiscovered).
  const list = useMemo(() => {
    const arr = Object.values(discovered);
    arr.sort((a, b) => {
      const bucketA = Math.round(a.rssi / RSSI_BUCKET_DBM) * RSSI_BUCKET_DBM;
      const bucketB = Math.round(b.rssi / RSSI_BUCKET_DBM) * RSSI_BUCKET_DBM;
      if (bucketA !== bucketB) return bucketB - bucketA; // closer first
      return a.firstSeenMs - b.firstSeenMs; // stable tiebreak
    });
    return arr;
  }, [discovered]);

  // Honest UX for "unpair" — see openIosBluetoothSettings() comment.
  const handleForget = useCallback(
    (deviceId: string, deviceName: string) => {
      Alert.alert(
        `Unpair ${deviceName}?`,
        "iOS controls the actual Bluetooth bond — only you can remove it. " +
          "We can clear our local 'paired' marker and jump you to " +
          "iOS Settings → Bluetooth to fully forget the device.\n\n" +
          `Once there, tap the (i) next to "${deviceName}", then ` +
          '"Forget This Device".',
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Clear marker only",
            onPress: () => unmarkPaired(deviceId),
          },
          {
            text: "Open Bluetooth Settings",
            onPress: () => {
              unmarkPaired(deviceId);
              void openIosBluetoothSettings();
            },
          },
        ],
        { cancelable: true },
      );
    },
    [unmarkPaired],
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scroll,
        { paddingHorizontal: padding, paddingBottom: padding * 2 },
      ]}
    >
      <View style={[styles.column, { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" }]}>
        <View style={styles.heroBox}>
          <Text style={styles.title}>FIND CONTROLLER</Text>
          <Text style={styles.sub}>
            Pick any tcon_* radio in range — a captain handheld
            (e.g. tcon_sina, tcon_misha), the server (tcon_server), or
            any future crew unit. iOS will prompt for a 6-digit pairing
            PIN on the first connect; the Heltec OLED auto-jumps to a
            dedicated PIN page so the digits are easy to read across
            the room.
          </Text>
          {keyFingerprint ? (
            <KeyRow
              fingerprint={keyFingerprint}
              onChange={onChangeSecret}
              onForget={onForgetSecret}
              forgetFallsBackToBaked={forgetFallsBackToBaked}
            />
          ) : null}
        </View>

        {conn.kind === "permissionDenied" && (
          <View style={[styles.banner, { borderColor: C.err }]}>
            <Text style={[styles.bannerText, { color: C.err }]}>
              Bluetooth permission was denied. Enable it for "PortWatch"
              in iOS Settings → Bluetooth.
            </Text>
          </View>
        )}
        {conn.kind === "error" && (
          <View style={[styles.banner, { borderColor: C.err }]}>
            <Text style={[styles.bannerText, { color: C.err }]}>{conn.message}</Text>
          </View>
        )}

        <View style={styles.scanRow}>
          {conn.kind === "scanning" ? (
            <>
              <ActivityIndicator color={C.accent} />
              <Text style={styles.scanLabel}>scanning…</Text>
            </>
          ) : (
            <Text style={[styles.scanLabel, { color: C.textDim }]}>
              {list.length === 0 ? "—" : `${list.length} radios visible`}
            </Text>
          )}
          <Pressable
            onPress={() => clearDiscovered()}
            style={({ pressed }) => [
              styles.smallBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.smallBtnText}>CLEAR</Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {list.length === 0 && conn.kind === "scanning" ? (
            <Text style={styles.empty}>
              No captain radios visible yet. Make sure a Heltec is on
              and within ~5 m of your device.
            </Text>
          ) : null}

          {list.map((d) => {
            const isConnecting =
              conn.kind === "connecting" && conn.deviceId === d.id;
            const isPaired = !!pairedDeviceIds[d.id];
            return (
              <Pressable
                key={d.id}
                disabled={conn.kind === "connecting"}
                onPress={async () => {
                  setConn({
                    kind: "connecting",
                    deviceId: d.id,
                    deviceName: d.name,
                  });
                  ble.stopScan();
                  try {
                    await onConnect(d.id, d.name);
                  } catch (err: any) {
                    setConn({
                      kind: "error",
                      message: err?.message ?? String(err),
                    });
                  }
                }}
                style={({ pressed }) => [
                  styles.deviceRow,
                  pressed && styles.deviceRowPressed,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.deviceTitleRow}>
                    <Text style={styles.deviceName}>{d.name}</Text>
                    {isPaired && (
                      <View style={styles.pairedBadge}>
                        <Text style={styles.pairedBadgeText}>PAIRED</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.deviceMeta}>
                    {d.id} · RSSI {d.rssi} dBm
                  </Text>
                </View>
                {/*
                  Nested Pressable for the Unpair affordance: in RN's
                  gesture responder system, the inner Pressable becomes
                  the touch responder and the outer row's onPress is
                  NOT fired for taps that land here, so this won't
                  accidentally trigger a connect. We only render it for
                  paired rows so unpaired devices don't waste header
                  space.
                */}
                {isPaired && !isConnecting && (
                  <Pressable
                    onPress={() => handleForget(d.id, d.name)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.unpairBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.unpairBtnText}>UNPAIR</Text>
                  </Pressable>
                )}
                {isConnecting ? (
                  <ActivityIndicator color={C.accent} />
                ) : (
                  <Text style={styles.connectArrow}>›</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

// ── KeyRow ─────────────────────────────────────────────────────────
// Pulled out so the masking + reveal state lives in its own scope and
// doesn't trigger ScanScreen re-renders on toggle.
//
// The fingerprint is itself a hash of the key (not the key itself), so
// revealing it doesn't compromise the secret — but the fingerprint
// uniquely identifies which camp's key we're carrying, and a glance
// from across the room is plenty to correlate that. We default to a
// "tail-only" mask (•••••3a4f) so two operators standing together can
// still confirm "yep, same key" without a full reveal.
function KeyRow({
  fingerprint,
  onChange,
  onForget,
  forgetFallsBackToBaked,
}: {
  fingerprint: string;
  onChange: () => void;
  onForget?: () => Promise<void> | void;
  forgetFallsBackToBaked?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  const display = revealed
    ? maskFingerprint(fingerprint, "full")
    : maskFingerprint(fingerprint, "tail");

  const handleForget = () => {
    if (!onForget) return;
    const fallback = forgetFallsBackToBaked
      ? "PortWatch will revert to the key that was baked into this " +
        "build at compile time. The rig itself is unaffected."
      : "PortWatch will lose the camp's pre-shared key from this " +
        "device's Keychain and prompt you to enter it again. The " +
        "rig itself is unaffected.";
    Alert.alert(
      forgetFallsBackToBaked ? "Reset to baked key?" : "Forget shared key?",
      fallback,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: forgetFallsBackToBaked ? "Reset" : "Forget",
          style: "destructive",
          onPress: () => {
            void onForget();
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={styles.keyRow}>
      <Text style={styles.keyLabel}>KEY</Text>
      <Text style={styles.keyValue}>{display}</Text>
      <Pressable
        onPress={() => setRevealed((r) => !r)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.smallBtn,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.smallBtnText}>
          {revealed ? "HIDE" : "REVEAL"}
        </Text>
      </Pressable>
      <Pressable
        onPress={onChange}
        hitSlop={6}
        style={({ pressed }) => [
          styles.changeBtn,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.changeBtnText}>CHANGE</Text>
      </Pressable>
      {onForget && (
        <Pressable
          onPress={handleForget}
          hitSlop={6}
          style={({ pressed }) => [
            styles.forgetBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.forgetBtnText}>
            {forgetFallsBackToBaked ? "RESET" : "FORGET"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: S.lg,
    paddingBottom: 32,
  },
  column: {
    gap: S.md,
  },
  heroBox: {
    paddingHorizontal: S.md,
    paddingTop: S.sm,
    gap: S.sm,
  },
  title: {
    color: C.text,
    fontSize: F.display,
    fontWeight: "900",
    letterSpacing: 1,
  },
  sub: {
    color: C.textDim,
    fontSize: F.body,
    lineHeight: 22,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    marginTop: S.sm,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    backgroundColor: C.cardSunken,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    flexWrap: "wrap",
  },
  keyLabel: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  keyValue: {
    color: C.accent,
    fontFamily: "Menlo",
    fontSize: F.small,
    flex: 1,
    minWidth: 80,
  },
  changeBtn: {
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.accent,
    borderRadius: R.pill,
  },
  changeBtnText: {
    color: C.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  forgetBtn: {
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.pill,
  },
  forgetBtnText: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  banner: {
    borderWidth: 1,
    borderRadius: R.card,
    padding: S.md,
    backgroundColor: C.card,
  },
  bannerText: {
    fontSize: F.body,
    fontWeight: "700",
  },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    marginTop: S.sm,
    paddingHorizontal: S.md,
  },
  scanLabel: {
    color: C.accent,
    fontSize: F.body,
    flex: 1,
  },
  smallBtn: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.pill,
  },
  smallBtnText: {
    color: C.text,
    fontWeight: "800",
    letterSpacing: 1.5,
    fontSize: F.small,
  },
  list: {
    marginTop: S.sm,
    gap: S.sm,
  },
  empty: {
    color: C.textDim,
    fontSize: F.body,
    fontStyle: "italic",
    marginTop: S.lg,
    textAlign: "center",
    paddingHorizontal: S.lg,
  },
  deviceRow: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.card,
    padding: S.md,
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
  },
  deviceRowPressed: {
    backgroundColor: C.cardActive,
  },
  deviceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
  },
  deviceName: {
    color: C.text,
    fontSize: F.title,
    fontWeight: "700",
  },
  deviceMeta: {
    color: C.textDim,
    fontSize: F.small,
    marginTop: 2,
    fontFamily: "Menlo",
  },
  pairedBadge: {
    backgroundColor: C.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pairedBadgeText: {
    color: C.bg,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  unpairBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: 6,
  },
  unpairBtnText: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  connectArrow: {
    color: C.accent,
    fontSize: 32,
    fontWeight: "300",
  },
});
