// PortWatch — TITANIC field-ops iPhone/iPad app.
// =================================================
// BLE-bridged Titanic Frame v2 client. Pairs with a captain Heltec
// over BLE, encrypts ops with the camp's pre-shared key (baked in
// from marsin_engine/secret.yaml at build time), writes the encrypted
// ASCII frame to the Heltec's CHAR_CMD characteristic. The Heltec
// transmits it verbatim over LoRa; the server bridge decrypts,
// validates, and relays to the MarsinEngine. The firmware NEVER sees
// the secret — that's the whole point of the AEAD-on-iPad path in
// docs/07_control_podium.md §3.6.8b and docs/21_portwatch_monitor.md.
//
// Tabs (when connected):
//   * DECK   — quick actions + deck (autopilot/patterns) + global FX
//              + disabled pyro placeholder. The primary control surface.
//   * STATUS — live engine / bridge / simulation health, derived from
//              the periodic status pub the bridge broadcasts.
//   * LOGS   — wire-level event log (every TX and RX, raw frame body).
//   * TESTS  — connectivity probe + range test.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
// SafeAreaView from RN core is deprecated. The replacement from
// react-native-safe-area-context reads notch/home-bar insets out of
// SafeAreaProvider (added in index.js) and applies them as padding.
import { SafeAreaView } from "react-native-safe-area-context";

import { BleClient } from "./src/ble/client";
import { Codec } from "./src/crypto/codec";
import { TitanicLink, WireEvent } from "./src/link/titanicLink";
import {
  DEFAULT_IPHONE_NODE_ID,
  SERVER_ID,
  TYPE_PUB,
  TYPE_REP,
} from "./src/frame/types";
import {
  isCompactStatusArg,
  liftGlobalParamsFromCompactStatus,
  parseEngineStatus,
} from "./src/status/parse";
import {
  buildHello,
  buildStatusQuery,
} from "./src/frame/ops";
import { ScanScreen } from "./src/ui/ScanScreen";
import { DeckScreen } from "./src/ui/DeckScreen";
import { StatusScreen } from "./src/ui/StatusScreen";
import { LogsScreen } from "./src/ui/LogsScreen";
import { TestsScreen } from "./src/ui/TestsScreen";
import { LinkBar } from "./src/ui/LinkBar";
import { useAppStore } from "./src/state/store";
import { useStatusPoller } from "./src/state/useStatusPoller";
import { useGlobalParamsPoller } from "./src/state/useGlobalParamsPoller";
import { useLocalExportsPoller } from "./src/state/useLocalExportsPoller";
import { loadPersistedWorld } from "./src/state/persistedCache";
import { polling } from "./src/config";
import { C, F, S } from "./src/ui/theme";

// The generated secret is created by `npm run sync-secret`:
//   * dev / preview: contains the camp's PSK from marsin_engine/
//                    secret.yaml (BAKED_AT_BUILD = true).
//   * production:    contains a sentinel (BAKED_AT_BUILD = false), and
//                    we route the operator through the runtime key
//                    entry sheet which stores the key in iOS Keychain.
//   * postinstall stub: BAKED_AT_BUILD = false AND fingerprint =
//                    '<NOT-BAKED>'; the bring-up screen below explains
//                    how to fix this state.
import {
  KEY_BYTES as BAKED_KEY_BYTES,
  KEY_FINGERPRINT as BAKED_KEY_FINGERPRINT,
  BAKED_AT_BUILD,
} from "./src/_generated/secret.generated";
import { SecretEntrySheet } from "./src/ui/SecretEntrySheet";
import {
  clearRuntimeSecret,
  loadRuntimeSecret,
} from "./src/security/secretStore";

const POSTINSTALL_STUB: boolean =
  !BAKED_AT_BUILD && (BAKED_KEY_FINGERPRINT as string) === "<NOT-BAKED>";

type Tab = "deck" | "status" | "logs" | "tests";

const TAB_LABELS: Record<Tab, string> = {
  deck: "DECK",
  status: "STATUS",
  logs: "LOGS",
  tests: "TESTS",
};

const TAB_ORDER: Tab[] = ["deck", "status", "logs", "tests"];

export default function App() {
  // The mutable transports live outside React state — they're stable
  // for the lifetime of the app and the store reads from them via
  // event callbacks.
  const ble = useMemo(() => new BleClient(), []);

  // Active secret resolution.
  //
  // Resolution order (highest priority first):
  //   1. iOS Keychain entry (operator-overridden / production-entered).
  //   2. Baked key from sync-secret.mjs (dev / preview only).
  //   3. Nothing — SecretEntrySheet appears.
  //
  // We always check Keychain first, even on baked builds, so the
  // operator can override the baked key without rebuilding (between
  // camps, for a typo recovery, etc.). "Forget / Reset" wipes the
  // override and falls back to the baked key (or the entry sheet).
  //
  // `runtimeOverride` is true when the active key came from Keychain.
  // It changes the wording of the FORGET action ("Reset to baked" vs
  // "Forget") so we don't mislead the operator about what happens.
  const [secretBytes, setSecretBytes] = useState<Uint8Array | null>(null);
  const [secretFingerprint, setSecretFingerprint] = useState<string>("");
  const [runtimeOverride, setRuntimeOverride] = useState<boolean>(false);
  const [secretLoaded, setSecretLoaded] = useState<boolean>(false);

  // Always-available "change key" affordance — shown alongside the
  // hero on the Scan screen and alongside the disconnect button on
  // the LinkBar. When true, the SecretEntrySheet is rendered on top
  // of whatever screen is active so the operator can replace the key
  // without disconnecting / reinstalling.
  const [changingSecret, setChangingSecret] = useState<boolean>(false);

  useEffect(() => {
    if (POSTINSTALL_STUB) return;
    let cancelled = false;
    void (async () => {
      const stored = await loadRuntimeSecret();
      if (cancelled) return;
      if (stored) {
        setSecretBytes(stored.bytes);
        setSecretFingerprint(stored.fingerprint);
        setRuntimeOverride(true);
      } else if (BAKED_AT_BUILD) {
        setSecretBytes(BAKED_KEY_BYTES);
        setSecretFingerprint(BAKED_KEY_FINGERPRINT as string);
        setRuntimeOverride(false);
      }
      setSecretLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const codec = useMemo(
    () => (secretBytes ? new Codec(secretBytes) : null),
    [secretBytes],
  );

  const appendLog = useAppStore((s) => s.appendLog);
  const setConn = useAppStore((s) => s.setConn);
  const setStats = useAppStore((s) => s.setStats);
  const conn = useAppStore((s) => s.conn);
  const markPaired = useAppStore((s) => s.markPaired);
  const setEngineStatus = useAppStore((s) => s.setEngineStatus);
  const setGlobalParams = useAppStore((s) => s.setGlobalParams);
  const resetIntent = useAppStore((s) => s.resetIntent);
  const bumpConnectGeneration = useAppStore((s) => s.bumpConnectGeneration);

  // ── Persistent world hydration ──────────────────────────────────
  // Read the FULL persisted world (playlist library, per-playlist
  // patterns, per-pattern last-seen local exports, last snapshot
  // timestamp, AND last-seen global params) off AsyncStorage once on
  // app launch. Until this completes, the deck card + ParamsCard
  // render their default empty state; once hydration lands the
  // operator sees the last snapshot they took plus the most recent
  // slider positions immediately — instead of "Waiting for engine
  // state…" while the first BLE connect, status poll, and params
  // poll race to fill in the picture.
  //
  // Failure to hydrate (corrupt JSON, AsyncStorage failure) leaves
  // the store at defaults; the next REFRESH writes a fresh snapshot.
  // We do NOT block UI on this — the effect just kicks off the read
  // and the store sets land asynchronously.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const persisted = await loadPersistedWorld();
      if (cancelled) return;
      const store = useAppStore.getState();
      store.hydrateWorldSnapshot(persisted.world);
      if (persisted.globalParams !== null) {
        // Route through setGlobalParams so partial-merge semantics
        // are preserved (this is the only hydration path that calls
        // the setter; subsequent PUB/poll updates overwrite normally).
        store.setGlobalParams(persisted.globalParams);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wire event handler — append to log, AND if it's a status pub/rep
  // from the server, pull the parsed engine status into the store so
  // every screen sees a consistent view of the rig.
  //
  // The compact-status payload now carries the CPC global params
  // (sp / dr / ct / sz / rt / p1 / p2) in addition to the engine
  // status fields. We lift them off the same arg and route into
  // `setGlobalParams` so the ParamsCard sees CaptainPad-side nudges
  // within the PUB cadence (~100 ms after the engine fires
  // `sharedParams` WS) instead of waiting for the 5 s
  // `qry params/snapshot` poll. `setGlobalParams` merges partials,
  // so missing fields preserve their previously-known values.
  const onWireEvent = useCallback(
    (e: WireEvent) => {
      appendLog(e);
      if (e.dir !== "rx" || !e.frame || !e.ok) return;
      if (e.frame.src !== SERVER_ID) return;
      // Periodic broadcast: typ=pub, dst=broadcast, arg = compact KV.
      // Reply to qry engine/status: typ=rep, dst=our src, same KV.
      // The compact-status REP gate lives in parse.ts so the routing
      // check and the parser schema can't drift — see the doc on
      // isCompactStatusArg for the rationale + the May 2026
      // "stuck on Waiting for engine state…" regression that
      // motivated the widened marker set.
      const isStatusRep =
        e.frame.typ === TYPE_REP && isCompactStatusArg(e.frame.arg);
      if (e.frame.typ === TYPE_PUB || isStatusRep) {
        setEngineStatus(parseEngineStatus(e.frame.arg, e.ts));
        const globals = liftGlobalParamsFromCompactStatus(e.frame.arg, e.ts);
        if (globals) {
          setGlobalParams(globals);
        }
      }
    },
    [appendLog, setEngineStatus, setGlobalParams],
  );

  const link = useMemo(
    () =>
      codec
        ? new TitanicLink(codec, ble, {
            src: DEFAULT_IPHONE_NODE_ID,
            defaultTimeoutMs: 6_000,
            onWireEvent,
          })
        : null,
    [codec, ble, onWireEvent],
  );

  // ── Primary engine-status sync path: poll `qry engine/status` ─────
  // every 5 s while connected. The REP routes through `onWireEvent`
  // above (since compact_status always includes `pat/`, the rep
  // filter accepts it) into setEngineStatus → every UI card stays
  // eventually consistent with the engine even when broadcast PUBs
  // drop. See `src/state/useStatusPoller.ts` for the full rationale
  // and docs/21 §10.12.
  const connectGeneration = useAppStore((s) => s.connectGeneration);
  useStatusPoller(link, {
    intervalMs: polling.status_interval_ms,
    timeoutMs: polling.status_timeout_ms,
    connectGeneration,
    isConnected: conn.kind === "connected",
  });
  // Same cadence for global params — single-frame qry, dwarfed by
  // pattern paging. CaptainPad changes to speed / size / palette /
  // etc. surface in PortWatch's GlobalParamsCard within one
  // interval even when broadcast PUBs drop entirely. The poll
  // self-suppresses while a manual REFRESH is in flight to avoid
  // racing the snapshot.
  useGlobalParamsPoller(link, {
    intervalMs: polling.status_interval_ms,
    timeoutMs: polling.status_timeout_ms,
    connectGeneration,
    isConnected: conn.kind === "connected",
  });
  // Per-pattern (local) exports poller — longer cadence (10 s
  // default) because each tick paginates and can cost N round-trips
  // on a pattern with many sliders. Closes the gap left by the
  // pattern-change-triggers-refresh path: CaptainPad nudging a
  // slider WITHOUT swapping pattern would otherwise leave
  // PortWatch's LocalParamsCard sitting on a stale v0 until the
  // operator manually hit REFRESH.
  useLocalExportsPoller(link, {
    intervalMs: polling.local_exports_interval_ms,
    timeoutMs: polling.local_exports_timeout_ms,
    connectGeneration,
    isConnected: conn.kind === "connected",
  });

  const [tab, setTab] = useState<Tab>("deck");

  useEffect(() => () => ble.destroy(), [ble]);

  const onConnect = useCallback(
    async (deviceId: string, _deviceName: string) => {
      if (!link) return;
      const { deviceName: name } = await ble.connect(
        deviceId,
        link.onLine,
        (rssi) => {
          // Functional update: every writer (BLE-RSSI poll here, the
          // LoRa-stats poll in LinkBar, etc.) merges its own slice and
          // the store no-ops the result if nothing changed. Avoids the
          // closed-over-stale-stats race that caused the top-bar
          // metrics to flicker between "—" and a value.
          setStats({ bleRssi: rssi });
        },
      );
      markPaired(deviceId);
      setConn({ kind: "connected", deviceId, deviceName: name });
      setTab("deck");
      // Bump connectGeneration BEFORE the qry burst — this is the
      // signal each card's auto-hydrate effect listens to. Doing it
      // here (in the connect callback, after BLE is fully up and
      // setConn has fired) guarantees the cards' useEffects see a
      // ready link by the time their hydrators fire.
      bumpConnectGeneration();
      // ── Connect-time engine-status hydration ──────────────────────
      // Two-step kick to get a clean engineStatus snapshot fast:
      //
      //   1. HLO  — wakes the bridge's periodic publisher
      //             (bridge.py::_handle_frame), which sends a fresh
      //             compact-status PUB toward us within tens of
      //             milliseconds. That PUB lands on `onWireEvent`
      //             below and refreshes the store's engineStatus
      //             with the lock owner / view mode / deck playlist
      //             name / active pattern.
      //   2. qry engine/status — belt-and-suspenders for the rare
      //             case the publisher wake-up was lost. Cheap on
      //             the wire (one frame each direction).
      //
      // We deliberately do NOT fire the playlist / patterns / params
      // / exports qrys here. Those replies need their per-card
      // parsers (parsePlaylistsPage, parsePlaylistPatternsPage,
      // parseExportsPage, parseParamsSnapshot) — App.tsx doesn't
      // have them and adding the plumbing here would duplicate
      // every card's parse logic. Instead, each card auto-hydrates
      // itself on first mount (PlaylistSwitcher, DeckCard pattern
      // picker, ParamsCard) — the cards already own the parser AND
      // the store action, so calling their existing `refresh()`
      // path is a one-line useEffect.
      //
      // Doing it card-side has a second benefit: in mixer mode the
      // PlaylistSwitcher / pattern picker still need to hydrate
      // (the operator can preview the picker without taking
      // control), so card-side useEffect is the right scope —
      // it doesn't depend on which view the engine is currently
      // rendering.
      void (async () => {
        const ops = [buildHello(), buildStatusQuery()];
        for (const op of ops) {
          try {
            await link.sendOp(op, { timeoutMs: 6_000 });
          } catch {
            // Best-effort: if even the basic status fetch fails the
            // periodic PUB will eventually populate the store; the
            // cards can still render their own auto-hydrate on top.
          }
        }
      })();
    },
    [ble, link, setConn, setStats, markPaired, bumpConnectGeneration],
  );

  const onDisconnect = useCallback(async () => {
    if (link) link.cleanup();
    await ble.disconnect();
    resetIntent();
    setConn({ kind: "disconnected" });
  }, [ble, link, setConn, resetIntent]);

  const onForgetSecret = useCallback(async () => {
    await clearRuntimeSecret();
    if (link) link.cleanup();
    await ble.disconnect();
    resetIntent();
    setConn({ kind: "disconnected" });
    if (BAKED_AT_BUILD) {
      // Fall back to the baked key — dev / preview operators stay
      // productive after a "Reset" without having to re-enter.
      setSecretBytes(BAKED_KEY_BYTES);
      setSecretFingerprint(BAKED_KEY_FINGERPRINT as string);
      setRuntimeOverride(false);
    } else {
      // Production: drop everything; the SecretEntrySheet takes over.
      setSecretBytes(null);
      setSecretFingerprint("");
      setRuntimeOverride(false);
    }
  }, [ble, link, resetIntent, setConn]);

  const onChangeSecret = useCallback(() => {
    setChangingSecret(true);
  }, []);

  const onSecretCommitted = useCallback(
    (bytes: Uint8Array, fingerprint: string) => {
      setSecretBytes(bytes);
      setSecretFingerprint(fingerprint);
      setRuntimeOverride(true);
      setChangingSecret(false);
      // Bounce any open BLE link — the codec just changed, every
      // pending sequence number is now bound to the wrong key.
      if (link) link.cleanup();
      void ble.disconnect();
      resetIntent();
      setConn({ kind: "disconnected" });
    },
    [ble, link, resetIntent, setConn],
  );

  const onCancelChangeSecret = useCallback(() => {
    setChangingSecret(false);
  }, []);

  const isConnected = conn.kind === "connected";

  // 1) Postinstall stub — only happens when the developer hasn't run
  //    sync-secret in dev mode yet (production builds skip this branch).
  if (POSTINSTALL_STUB) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.notBaked}>
          <Text style={styles.notBakedTitle}>SECRET NOT BAKED</Text>
          <Text style={styles.notBakedBody}>
            The shared key was not present at build time. PortWatch
            cannot send any frames until you wire it up:
          </Text>
          <View style={styles.cmdBox}>
            <Text style={styles.cmdMono}>
              cp marsin_engine/secret.yaml.example {"\n"}
              {"  "}marsin_engine/secret.yaml
            </Text>
            <Text style={styles.cmdMono}>cd control_podium/PortWatch</Text>
            <Text style={styles.cmdMono}>npm run sync-secret</Text>
            <Text style={styles.cmdMono}>npm run ios</Text>
          </View>
          <Text style={styles.notBakedBody}>
            See {"`"}control_podium/PortWatch/README.md{"`"} for the
            full bring-up steps.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // 2) Production: still loading from Keychain or never entered yet.
  if (!secretLoaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.notBaked}>
          <Text style={styles.notBakedBody}>Loading saved key…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!secretBytes || !codec || !link) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <StatusBar barStyle="light-content" />
        <SecretEntrySheet onSecretReady={onSecretCommitted} />
      </SafeAreaView>
    );
  }

  // CHANGE KEY — operator opened the sheet from a fully-loaded state.
  // We render the sheet ON TOP of the app instead of as a modal so it
  // owns the keyboard / safe-area like first-launch entry does, but
  // the existing connection (if any) remains intact in the background
  // until they actually commit a new key. A Cancel button drops them
  // back to where they were.
  if (changingSecret) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <StatusBar barStyle="light-content" />
        <SecretEntrySheet
          onSecretReady={onSecretCommitted}
          onCancel={onCancelChangeSecret}
          currentFingerprint={secretFingerprint}
        />
      </SafeAreaView>
    );
  }

  // 3) Normal app — secret is present, codec/link are constructed.
  // The "forget / reset" affordance is shown whenever a runtime
  // override is active OR we're in production (where forget makes
  // the user re-enter on next launch). Hidden for baked builds with
  // no override since "forget" would have no effect.
  const canForget = runtimeOverride || !BAKED_AT_BUILD;
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {!isConnected ? (
          <ScanScreen
            ble={ble}
            onConnect={onConnect}
            onChangeSecret={onChangeSecret}
            onForgetSecret={canForget ? onForgetSecret : undefined}
            forgetFallsBackToBaked={runtimeOverride && BAKED_AT_BUILD}
            keyFingerprint={secretFingerprint}
          />
        ) : (
          <View style={{ flex: 1 }}>
            <LinkBar
              ble={ble}
              fingerprint={secretFingerprint}
              src={DEFAULT_IPHONE_NODE_ID}
              onDisconnect={onDisconnect}
              onChangeSecret={onChangeSecret}
            />

            <View style={styles.tabBar}>
              {TAB_ORDER.map((t) => (
                <TabButton
                  key={t}
                  label={TAB_LABELS[t]}
                  active={tab === t}
                  onPress={() => setTab(t)}
                />
              ))}
            </View>

            <View style={{ flex: 1 }}>
              {tab === "deck" && <DeckScreen link={link} />}
              {tab === "status" && (
                <StatusScreen link={link} fingerprint={secretFingerprint} />
              )}
              {tab === "logs" && <LogsScreen />}
              {tab === "tests" && <TestsScreen link={link} ble={ble} />}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active && styles.tabActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  tabBar: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomColor: "transparent",
    borderBottomWidth: 3,
  },
  tabActive: { borderBottomColor: C.accent },
  tabText: {
    color: C.textDim,
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 2,
  },
  tabTextActive: { color: C.accent },
  notBaked: {
    flex: 1,
    padding: S.xl,
    justifyContent: "center",
    gap: S.lg,
  },
  notBakedTitle: {
    color: C.err,
    fontSize: F.display,
    fontWeight: "900",
    letterSpacing: 2,
  },
  notBakedBody: { color: C.text, fontSize: F.body, lineHeight: 22 },
  cmdBox: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  cmdMono: {
    color: C.accent,
    fontFamily: "Menlo",
    fontSize: 13,
  },
});
