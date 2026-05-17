// StatusScreen — full chain visibility from this phone to the engine.
//
// The card stack mirrors the actual data path so the operator can read
// it like a flow diagram, top to bottom:
//
//   1. PHONE                — this app + active key fingerprint.
//   2. BLE LINK             — Phone <-> Captain Heltec (RSSI, fw uptime).
//   3. LORA LINK            — Captain <-> Server Heltec (TX / RX counts,
//                             last RSSI / SNR).
//   4. SERVER BRIDGE        — Server Heltec USB <-> Pi bridge (status
//                             pub cadence, frame age).
//   5. MARSINENGINE         — bridge <-> engine (active pattern,
//                             brightness, blackout, autopilot, speed,
//                             uptime — sourced from the compact pub).
//   6. SIMULATION           — engine render loop health (engine FPS).
//   7. PYRO   (DISABLED)    — never on LoRa, surfaced for completeness.
//   8. HORN   (DISABLED)    — pending engine feedback channel.
//
// Each card carries a "step badge" with its position in the chain and
// a tone-coloured pill summarising its current health. Health tones
// are derived defensively — `muted` is the preferred fallback so we
// never accuse a card of being broken when the data is just late.

import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { TitanicLink } from "../link/titanicLink";
import { buildStatusQuery } from "../frame/ops";
import { maskFingerprint } from "../security/secretStore";
import { useAppStore } from "../state/store";
import { useFormFactor, MAX_CONTENT_WIDTH } from "./layout";
import { Card } from "./primitives/Card";
import { StatRow, StatTone } from "./primitives/StatRow";
import { C, F, R, S } from "./theme";

interface Props {
  link: TitanicLink;
  fingerprint: string;
}

export function StatusScreen({ link, fingerprint }: Props) {
  const ff = useFormFactor();
  const padding = ff === "compact" ? S.md : S.lg;
  const conn = useAppStore((s) => s.conn);
  const stats = useAppStore((s) => s.stats);
  const status = useAppStore((s) => s.engineStatus);

  // Re-render every 5s so the "X s ago" labels stay live without
  // having to push a setState through every status update.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // One-shot status fetch on mount so we have something to render even
  // before the next periodic pub arrives.
  useEffect(() => {
    if (conn.kind !== "connected") return;
    void link
      .sendOp(buildStatusQuery(), { timeoutMs: 8_000 })
      .catch(() => undefined);
  }, [conn.kind, link]);

  const now = Date.now();
  const lastPubAgeSec = status
    ? Math.max(0, Math.floor((now - status.receivedAtMs) / 1000))
    : null;

  // ── Health derivations ─────────────────────────────────────────
  //
  // Each step's health is a function of (a) is the previous step
  // healthy enough to give us data, and (b) what does the data say.
  // We deliberately bias toward "muted" / "warn" over "bad" so a
  // single missed pub doesn't make the operator panic; you only see
  // BAD when there's clear, quantitative evidence.

  const phoneTone: StatTone = "good"; // we ARE the phone
  const bleTone: StatTone =
    conn.kind !== "connected"
      ? "bad"
      : stats.bleRssi === null
        ? "muted"
        : rssiTone(stats.bleRssi, "ble");

  // LoRa link is healthy iff we've sent SOMETHING and we've heard back
  // (RX increased since boot). Without a TX/RX exchange we can't tell
  // a quiet rig from a broken radio; show "waiting" until both
  // counters are non-null and at least one frame has flowed.
  const loraTone: StatTone =
    conn.kind !== "connected"
      ? "muted"
      : stats.loraTxCount === null || stats.loraRxCount === null
        ? "muted"
        : stats.loraRxCount === 0
          ? "warn"
          : stats.loraLastRssi === null
            ? "muted"
            : rssiTone(stats.loraLastRssi, "lora");

  // Bridge healthy iff a pub or rep arrived recently. Pubs are
  // emitted on 5s (active) or 30s (idle) cadence — we treat <40s as
  // healthy, 40-90s as degraded, >90s as bad.
  const bridgeTone: StatTone =
    lastPubAgeSec === null
      ? "muted"
      : lastPubAgeSec < 40
        ? "good"
        : lastPubAgeSec < 90
          ? "warn"
          : "bad";

  // Engine healthy iff bridge is healthy AND `dn` is not set.
  const engineTone: StatTone = !status
    ? "muted"
    : status.engineDown
      ? "bad"
      : bridgeTone === "bad"
        ? "muted" // can't tell — bridge isn't reporting
        : "good";

  // Sim healthy iff engine is healthy AND fps > 0.
  const simTone: StatTone = !status
    ? "muted"
    : status.engineDown
      ? "bad"
      : status.fps === null
        ? "muted"
        : status.fps === 0
          ? "warn"
          : "good";

  return (
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
        {/* 1. PHONE */}
        <ChainCard
          step={1}
          title="PHONE"
          accent={C.accent}
          tone={phoneTone}
          subtitle="this app · field-ops console"
        >
          <StatRow label="App" value="PortWatch" />
          <StatRow
            label="Key fp"
            value={maskFingerprint(fingerprint, "tail")}
            mono
            tone="muted"
            hint="AES-128 fingerprint · masked for privacy · matches every camp machine"
          />
        </ChainCard>

        <Connector />

        {/* 2. BLE LINK */}
        <ChainCard
          step={2}
          title="BLE LINK"
          accent={C.link}
          tone={bleTone}
          subtitle="phone ↔ captain heltec"
        >
          <StatRow
            label="Heltec"
            value={
              conn.kind === "connected" ? conn.deviceName : "(disconnected)"
            }
            tone={conn.kind === "connected" ? "good" : "bad"}
          />
          <StatRow
            label="BLE RSSI"
            value={fmtDbm(stats.bleRssi)}
            mono
            tone={rssiTone(stats.bleRssi, "ble")}
            hint="dBm"
          />
        </ChainCard>

        <Connector />

        {/* 3. LORA LINK */}
        <ChainCard
          step={3}
          title="LORA LINK"
          accent={C.brightness}
          tone={loraTone}
          subtitle="captain ↔ server heltec"
        >
          <StatRow
            label="LoRa RSSI"
            value={fmtDbm(stats.loraLastRssi)}
            mono
            tone={rssiTone(stats.loraLastRssi, "lora")}
            hint="dBm · last frame"
          />
          <StatRow
            label="LoRa SNR"
            value={
              stats.loraLastSnr === null ? null : stats.loraLastSnr.toFixed(1)
            }
            mono
            hint="dB"
          />
          <StatRow
            label="TX / RX"
            value={
              stats.loraTxCount !== null && stats.loraRxCount !== null
                ? `${stats.loraTxCount} / ${stats.loraRxCount}`
                : null
            }
            mono
            hint="frames since boot"
          />
          {stats.loraTxCount !== null &&
            stats.loraRxCount !== null &&
            stats.loraTxCount > 0 &&
            stats.loraRxCount === 0 && (
              <Text style={styles.note}>
                Sent {stats.loraTxCount} but heard nothing back. Check the
                server-side Heltec is on, paired with the bridge, and on
                the same SF/BW config.
              </Text>
            )}
        </ChainCard>

        <Connector />

        {/* 4. SERVER BRIDGE */}
        <ChainCard
          step={4}
          title="SERVER BRIDGE"
          accent={C.ok}
          tone={bridgeTone}
          subtitle="server heltec USB ↔ raspberry pi"
        >
          <StatRow
            label="Last pub"
            value={lastPubAgeSec === null ? null : `${lastPubAgeSec}s ago`}
            mono
            tone={bridgeTone}
            hint="status broadcast cadence: 5–30 s"
          />
          <StatRow
            label="Frame"
            value={status ? truncate(status.rawArg, 40) : null}
            mono
            tone="muted"
            hint="raw arg"
          />
          {bridgeTone === "bad" && (
            <Text style={styles.note}>
              No status pubs in {lastPubAgeSec}s. Either the LoRa link
              dropped, the server-side companion isn&apos;t running, or
              the bridge has crashed. Check the server before chasing
              the engine.
            </Text>
          )}
        </ChainCard>

        <Connector />

        {/* 5. MARSINENGINE */}
        <ChainCard
          step={5}
          title="MARSINENGINE"
          accent={C.brightness}
          tone={engineTone}
          subtitle="bridge → engine REST"
        >
          {status?.engineDown ? (
            <Text style={styles.dn}>
              Bridge reports the engine is unreachable from the Pi
              (dn=1 in the latest pub). Engine likely crashed, restart
              it on the server.
            </Text>
          ) : (
            <>
              <StatRow
                label="Active pat"
                value={status?.activePattern}
                mono
                tone={status?.activePattern ? "neutral" : "muted"}
              />
              <StatRow
                label="Brightness"
                value={
                  status?.brightness === null ||
                  status?.brightness === undefined
                    ? null
                    : `${status.brightness}%`
                }
                mono
              />
              <StatRow
                label="Blackout"
                value={status ? boolStr(status.blackout) : null}
                tone={status?.blackout ? "bad" : "neutral"}
              />
              <StatRow
                label="Autopilot"
                value={status ? boolStr(status.autopilot) : null}
                tone={status?.autopilot ? "good" : "neutral"}
              />
              <StatRow
                label="Speed"
                value={
                  status?.speed === null || status?.speed === undefined
                    ? null
                    : status.speed.toFixed(2)
                }
                mono
              />
              <StatRow
                label="Uptime"
                value={fmtUptime(status?.uptimeSec ?? null)}
                mono
                hint="engine"
              />
            </>
          )}
        </ChainCard>

        <Connector />

        {/* 6. SIMULATION */}
        <ChainCard
          step={6}
          title="SIMULATION"
          accent={C.pattern}
          tone={simTone}
          subtitle="engine → renderer"
        >
          <StatRow
            label="Engine FPS"
            value={status?.fps}
            mono
            tone={simTone}
            hint={
              status?.fps === 0
                ? "engine alive but render loop idle"
                : "frames / second"
            }
          />
          <StatRow
            label="Pattern"
            value={status?.activePattern}
            mono
            tone={status?.activePattern ? "neutral" : "muted"}
          />
          {simTone === "warn" && (
            <Text style={styles.note}>
              FPS=0 means the engine&apos;s render loop has stalled —
              the visualiser likely disconnected or the model file
              isn&apos;t mounted. Sim path needs attention even though
              the engine itself is up.
            </Text>
          )}
        </ChainCard>

        <Connector dimmed />

        {/* 7. PYRO (always disabled) */}
        <ChainCard
          step={7}
          title="PYRO CONTROL"
          accent={C.pyro}
          tone="muted"
          subtitle="separate transport · never on LoRa"
          disabled
          badgeOverride="DISABLED"
          badgeColorOverride={C.pyro}
        >
          <StatRow label="Bus" value="OFFLINE" tone="muted" />
          <StatRow label="Source" value="not on LoRa" tone="muted" mono />
          <Text style={styles.note}>
            The pyro bus runs on a separate transport with its own
            interlocks. PortWatch is intentionally never the trigger.
          </Text>
        </ChainCard>

        {/* 8. HORN (status surface not wired) */}
        <ChainCard
          step={8}
          title="HORN CONTROL"
          accent={C.horn}
          tone="muted"
          subtitle="awaiting engine feedback channel"
          disabled
          badgeOverride="STATUS NOT WIRED"
          badgeColorOverride={C.horn}
        >
          <StatRow label="Last fire" value="—" tone="muted" mono />
          <StatRow label="State" value="unknown" tone="muted" />
          <Text style={styles.note}>
            Horn fires via fx/horn (see Deck card) but the engine
            doesn&apos;t report horn state in its status pub yet. This
            card lights up once the engine surfaces a `hrn/` field.
          </Text>
        </ChainCard>
      </View>
    </ScrollView>
  );
}

// ── Chain card wrapper ─────────────────────────────────────────────

function ChainCard({
  step,
  title,
  accent,
  tone,
  subtitle,
  disabled,
  badgeOverride,
  badgeColorOverride,
  children,
}: {
  step: number;
  title: string;
  accent: string;
  tone: StatTone;
  subtitle?: string;
  disabled?: boolean;
  badgeOverride?: string;
  badgeColorOverride?: string;
  children: React.ReactNode;
}) {
  const badge = badgeOverride ?? badgeFor(tone);
  const badgeColor = badgeColorOverride ?? badgeColorFor(tone);
  return (
    <Card
      title={title}
      accent={accent}
      badge={badge}
      badgeColor={badgeColor}
      disabled={disabled}
    >
      <View style={styles.chainHeader}>
        <View style={[styles.stepBadge, { borderColor: accent }]}>
          <Text style={[styles.stepBadgeText, { color: accent }]}>
            STEP {step}
          </Text>
        </View>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {children}
    </Card>
  );
}

function Connector({ dimmed }: { dimmed?: boolean }) {
  return (
    <View style={styles.connector}>
      <View
        style={[
          styles.connectorLine,
          dimmed && { backgroundColor: C.border, opacity: 0.4 },
        ]}
      />
      <Text style={[styles.connectorChevron, dimmed && { opacity: 0.4 }]}>
        ↓
      </Text>
      <View
        style={[
          styles.connectorLine,
          dimmed && { backgroundColor: C.border, opacity: 0.4 },
        ]}
      />
    </View>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function badgeFor(t: StatTone): string {
  switch (t) {
    case "good":
      return "OK";
    case "warn":
      return "DEGRADED";
    case "bad":
      return "DOWN";
    case "muted":
      return "WAITING";
    default:
      return "—";
  }
}

function badgeColorFor(t: StatTone): string {
  switch (t) {
    case "good":
      return C.ok;
    case "warn":
      return C.warn;
    case "bad":
      return C.err;
    default:
      return C.textDim;
  }
}

function fmtDbm(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return `${Math.round(n)}`;
}

function rssiTone(rssi: number | null, kind: "ble" | "lora"): StatTone {
  if (rssi === null) return "muted";
  const thresh =
    kind === "ble" ? { good: -65, warn: -85 } : { good: -100, warn: -115 };
  if (rssi >= thresh.good) return "good";
  if (rssi >= thresh.warn) return "warn";
  return "bad";
}

function boolStr(b: boolean | null | undefined): string | null {
  if (b === null || b === undefined) return null;
  return b ? "YES" : "NO";
}

function fmtUptime(sec: number | null): string | null {
  if (sec === null) return null;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

const styles = StyleSheet.create({
  scroll: {
    paddingVertical: S.md,
  },
  column: {
    gap: 0, // connectors provide the visual gap themselves
  },
  chainHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    marginBottom: 4,
  },
  stepBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: R.pill,
    borderWidth: 1,
  },
  stepBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    fontFamily: "Menlo",
  },
  subtitle: {
    color: C.textDim,
    fontSize: F.small,
    fontStyle: "italic",
    flex: 1,
  },
  connector: {
    alignItems: "center",
    paddingVertical: 2,
  },
  connectorLine: {
    width: 2,
    height: 6,
    backgroundColor: C.borderStrong,
  },
  connectorChevron: {
    color: C.borderStrong,
    fontSize: 14,
    fontWeight: "800",
    marginVertical: -2,
  },
  dn: {
    color: C.err,
    fontSize: F.body,
    fontWeight: "700",
    fontStyle: "italic",
  },
  note: {
    color: C.textMuted,
    fontSize: F.small,
    fontStyle: "italic",
    lineHeight: 18,
    marginTop: 4,
  },
});
