// TestsScreen — tools for verifying the link is healthy.
//
// Cards:
//
//   CONNECTIVITY  — one-shot probes of the firmware's BLE characteristics
//                   plus a single `qry engine/status` round-trip. Run
//                   this BEFORE walking the playa to confirm the
//                   captain Heltec is alive end-to-end.
//   RANGE TEST    — burst of pings with summary stats (existing range
//                   tester, kept feature-complete). Walk the rig with
//                   this running; the stop button works mid-burst.
//
// Both cards are independent; running one doesn't affect the other.

import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { BleClient } from "../ble/client";
import {
  CHAR_BW,
  CHAR_FREQ,
  CHAR_FW_VER,
  CHAR_SF,
  CHAR_TXPOW,
  CHAR_UPTIME,
} from "../ble/uuids";
import { TitanicLink } from "../link/titanicLink";
import { OpDescriptor, buildPing, buildStatusQuery } from "../frame/ops";
import { useFormFactor, MAX_CONTENT_WIDTH } from "./layout";
import { Card } from "./primitives/Card";
import { StatRow, StatTone } from "./primitives/StatRow";
import { StepperBar } from "./primitives/StepperBar";
import { C, F, R, S } from "./theme";

interface Props {
  link: TitanicLink;
  ble: BleClient;
}

export function TestsScreen({ link, ble }: Props) {
  const ff = useFormFactor();
  const padding = ff === "compact" ? S.md : S.lg;
  return (
    <ScrollView
      contentContainerStyle={[
        styles.scroll,
        { paddingHorizontal: padding, paddingBottom: padding * 2 },
      ]}
    >
      <View style={[styles.column, { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" }]}>
        <ConnectivityCard link={link} ble={ble} />
        <RangeTestCard link={link} />
      </View>
    </ScrollView>
  );
}

// ── CONNECTIVITY ────────────────────────────────────────────────────

interface ConnectivityResult {
  fwVersion: string | null;
  uptimeSec: number | null;
  freqMhz: number | null;
  spreadingFactor: number | null;
  bandwidthKhz: number | null;
  txPowerDbm: number | null;
  rxStats: { txCount: number | null; rxCount: number | null; rssi: number | null; snr: number | null };
  pingMs: number | null;
  statusMs: number | null;
  statusReplyArg: string | null;
}

function ConnectivityCard({ link, ble }: { link: TitanicLink; ble: BleClient }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConnectivityResult | null>(null);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      // BLE-side characteristic reads (synchronous over an established
      // BLE link — no LoRa traffic generated).
      const [fwVersion, uptimeRaw, freqRaw, sfRaw, bwRaw, txPowRaw] = await Promise.all([
        ble.readStringChar(CHAR_FW_VER),
        ble.readNumberChar(CHAR_UPTIME),
        ble.readNumberChar(CHAR_FREQ),
        ble.readNumberChar(CHAR_SF),
        ble.readNumberChar(CHAR_BW),
        ble.readNumberChar(CHAR_TXPOW),
      ]);
      const rxStats = await ble.readLinkStats();

      // LoRa-side: a ping (server replies pon) and a status query.
      const pingStart = Date.now();
      let pingMs: number | null = null;
      try {
        const r = await link.sendOp(buildPing(), { timeoutMs: 6_000 });
        pingMs = r.timedOut ? null : Date.now() - pingStart;
      } catch {
        pingMs = null;
      }

      const statusStart = Date.now();
      let statusMs: number | null = null;
      let statusReplyArg: string | null = null;
      try {
        const r = await link.sendOp(buildStatusQuery(), { timeoutMs: 8_000 });
        if (!r.timedOut && r.reply) {
          statusMs = Date.now() - statusStart;
          statusReplyArg = r.reply.arg;
        }
      } catch {
        statusMs = null;
      }

      setResult({
        fwVersion,
        uptimeSec: uptimeRaw,
        // Firmware reports the configured frequency in MHz (e.g.
        // "915.0"), not Hz, so we round to the nearest int and
        // surface as MHz directly. See firmware FREQUENCY define.
        freqMhz: freqRaw === null ? null : Math.round(freqRaw),
        spreadingFactor: sfRaw,
        // Firmware reports bandwidth directly in kHz (e.g. "250").
        bandwidthKhz: bwRaw === null ? null : Math.round(bwRaw),
        txPowerDbm: txPowRaw,
        rxStats: rxStats,
        pingMs,
        statusMs,
        statusReplyArg,
      });
      Haptics.notificationAsync(
        pingMs !== null && statusMs !== null
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }, [ble, link, running]);

  return (
    <Card title="LORA PROBE" accent={C.accent}>
      <Text style={styles.sub}>
        Full path probe: BLE characteristics on the captain Heltec
        first (firmware version, radio config, link counters), then a
        LoRa ping → pong and a `qry engine/status` round-trip via the
        server bridge. Under 1s end-to-end is healthy at close range;
        under 4s is acceptable at edge of coverage.
      </Text>
      <Pressable
        onPress={run}
        disabled={running}
        style={({ pressed }) => [
          styles.runBtn,
          pressed && { opacity: 0.85 },
          running && { opacity: 0.6 },
        ]}
      >
        <Text style={styles.runBtnText}>
          {running ? "RUNNING…" : "RUN LORA PROBE"}
        </Text>
      </Pressable>

      {result && (
        <View style={styles.resultGroup}>
          <SectionTitle text="FIRMWARE" />
          <StatRow label="Version" value={result.fwVersion} mono />
          <StatRow label="Uptime" value={fmtUptime(result.uptimeSec)} mono />
          <StatRow
            label="Freq"
            value={result.freqMhz === null ? null : `${result.freqMhz} MHz`}
            mono
          />
          <StatRow
            label="Spreading"
            value={result.spreadingFactor === null ? null : `SF${result.spreadingFactor}`}
            mono
          />
          <StatRow
            label="Bandwidth"
            value={
              result.bandwidthKhz === null
                ? null
                : `${result.bandwidthKhz} kHz`
            }
            mono
          />
          <StatRow
            label="TX power"
            value={result.txPowerDbm === null ? null : `${result.txPowerDbm} dBm`}
            mono
          />

          <SectionTitle text="RADIO COUNTERS" />
          <StatRow label="LoRa TX" value={result.rxStats.txCount} mono />
          <StatRow label="LoRa RX" value={result.rxStats.rxCount} mono />
          <StatRow
            label="Last RSSI"
            value={result.rxStats.rssi === null ? null : `${result.rxStats.rssi}`}
            mono
            tone={result.rxStats.rssi !== null && result.rxStats.rssi >= -100 ? "good" : "warn"}
          />
          <StatRow
            label="Last SNR"
            value={result.rxStats.snr === null ? null : result.rxStats.snr.toFixed(1)}
            mono
          />

          <SectionTitle text="LORA ROUND-TRIPS" />
          <StatRow
            label="ping → pon"
            value={result.pingMs === null ? "TIMEOUT" : `${result.pingMs} ms`}
            mono
            tone={pingTone(result.pingMs)}
          />
          <StatRow
            label="qry → rep"
            value={result.statusMs === null ? "TIMEOUT" : `${result.statusMs} ms`}
            mono
            tone={pingTone(result.statusMs)}
          />
          {result.statusReplyArg && (
            <Text style={styles.replyLine}>
              {truncate(result.statusReplyArg, 80)}
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}

// ── RANGE TEST ──────────────────────────────────────────────────────

interface PingSample {
  idx: number;
  rttMs: number | null;
}

const BURST_OPTIONS = [10, 25, 50, 100] as const;
const INTERVAL_OPTIONS = [400, 800, 1500, 3000] as const;
const PING_OP: OpDescriptor = {
  id: "range-ping",
  label: "PING",
  kind: "pin",
  arg: "",
};

function RangeTestCard({ link }: { link: TitanicLink }) {
  const [samples, setSamples] = useState<PingSample[]>([]);
  const [running, setRunning] = useState(false);
  const [burstSize, setBurstSize] = useState<number>(BURST_OPTIONS[0]);
  const [intervalMs, setIntervalMs] = useState<number>(INTERVAL_OPTIONS[1]);
  const cancelRef = useRef(false);

  const stats = computeStats(samples);

  const start = async () => {
    if (running) return;
    cancelRef.current = false;
    setSamples([]);
    setRunning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);

    for (let i = 0; i < burstSize; i++) {
      if (cancelRef.current) break;
      const start = Date.now();
      let rtt: number | null;
      try {
        const res = await link.sendOp(PING_OP, { timeoutMs: 4_000 });
        rtt = res.timedOut ? null : res.rttMs;
      } catch {
        rtt = null;
      }
      const sample: PingSample = { idx: i, rttMs: rtt };
      setSamples((prev) => [...prev, sample]);
      if (rtt === null) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
      }
      const elapsed = Date.now() - start;
      const wait = Math.max(0, intervalMs - elapsed);
      if (i < burstSize - 1 && wait > 0 && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    setRunning(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
  };

  const cancel = () => {
    cancelRef.current = true;
  };

  return (
    <Card title="RANGE TEST" accent={C.link}>
      <Text style={styles.sub}>
        Walk the rig — every successful ping = you're in coverage.
        Loss above 20% means the link is at its edge.
      </Text>
      <StepperBar<number>
        label="BURST"
        unit="pings"
        values={[...BURST_OPTIONS]}
        current={burstSize}
        onChange={setBurstSize}
        accent={C.link}
        disabled={running}
      />
      <StepperBar<number>
        label="INTERVAL"
        unit="ms"
        values={[...INTERVAL_OPTIONS]}
        current={intervalMs}
        onChange={setIntervalMs}
        accent={C.link}
        disabled={running}
      />
      {!running ? (
        <Pressable
          onPress={start}
          style={({ pressed }) => [
            styles.runBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.runBtnText}>START</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={cancel}
          style={({ pressed }) => [
            styles.runBtn,
            { backgroundColor: C.err + "22", borderColor: C.err },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.runBtnText, { color: C.err }]}>STOP</Text>
        </Pressable>
      )}

      <View style={styles.statsCard}>
        <View style={styles.statRow}>
          <Stat label="SENT" value={String(samples.length)} />
          <Stat label="RECV" value={String(stats.received)} />
          <Stat
            label="LOSS"
            value={
              samples.length === 0
                ? "—"
                : `${Math.round((stats.lost / samples.length) * 100)}%`
            }
            color={
              samples.length === 0
                ? C.text
                : stats.lost === 0
                  ? C.ok
                  : stats.lost / samples.length > 0.2
                    ? C.err
                    : C.warn
            }
          />
        </View>
        <View style={styles.statRow}>
          <Stat label="MIN" value={fmtMs(stats.minMs)} />
          <Stat label="AVG" value={fmtMs(stats.avgMs)} />
          <Stat label="MAX" value={fmtMs(stats.maxMs)} />
        </View>
        <View style={styles.statRow}>
          <Stat label="P50" value={fmtMs(stats.p50)} />
          <Stat label="P90" value={fmtMs(stats.p90)} />
          <Stat label="P99" value={fmtMs(stats.p99)} />
        </View>
      </View>

      {samples.length > 0 && (
        <View style={styles.histCard}>
          <Text style={styles.histTitle}>RTT HISTOGRAM (ms)</Text>
          {renderHistogram(samples)}
        </View>
      )}

      {samples.length > 0 && (
        <View style={styles.timeline}>
          <Text style={styles.histTitle}>TIMELINE</Text>
          <View style={styles.timelineRow}>
            {samples.map((s) => (
              <View
                key={s.idx}
                style={[
                  styles.timelineCell,
                  s.rttMs === null
                    ? { backgroundColor: C.err + "55" }
                    : { backgroundColor: rttColor(s.rttMs) },
                ]}
              />
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function SectionTitle({ text }: { text: string }) {
  return <Text style={styles.sectionTitle}>{text}</Text>;
}

function pingTone(ms: number | null): StatTone {
  if (ms === null) return "bad";
  if (ms < 1500) return "good";
  if (ms < 4000) return "warn";
  return "bad";
}

function fmtMs(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 10) return n.toFixed(1);
  return Math.round(n).toString();
}

function rttColor(ms: number): string {
  if (ms < 800) return C.ok + "88";
  if (ms < 2000) return C.warn + "88";
  return C.err + "88";
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

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={statStyles.col}>
      <Text style={statStyles.label}>{label}</Text>
      <Text style={[statStyles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

interface RangeStats {
  received: number;
  lost: number;
  minMs: number | null;
  maxMs: number | null;
  avgMs: number | null;
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

function computeStats(samples: PingSample[]): RangeStats {
  const ok = samples.filter((s) => s.rttMs !== null).map((s) => s.rttMs!);
  const empty: RangeStats = {
    received: 0,
    lost: 0,
    minMs: null,
    maxMs: null,
    avgMs: null,
    p50: null,
    p90: null,
    p99: null,
  };
  const lost = samples.length - ok.length;
  if (ok.length === 0) return { ...empty, lost };
  ok.sort((a, b) => a - b);
  const sum = ok.reduce((a, b) => a + b, 0);
  const pct = (q: number) => {
    const idx = Math.min(ok.length - 1, Math.floor(q * (ok.length - 1)));
    return ok[idx];
  };
  return {
    received: ok.length,
    lost,
    minMs: ok[0],
    maxMs: ok[ok.length - 1],
    avgMs: sum / ok.length,
    p50: pct(0.5),
    p90: pct(0.9),
    p99: pct(0.99),
  };
}

function renderHistogram(samples: PingSample[]): React.ReactNode {
  const bins = [
    { lo: 0, hi: 200, label: "<200" },
    { lo: 200, hi: 400, label: "200-400" },
    { lo: 400, hi: 800, label: "400-800" },
    { lo: 800, hi: 1500, label: ".8-1.5s" },
    { lo: 1500, hi: 3000, label: "1.5-3s" },
    { lo: 3000, hi: Infinity, label: ">3s" },
  ];
  const counts = bins.map((b) =>
    samples.filter(
      (s) => s.rttMs !== null && s.rttMs >= b.lo && s.rttMs < b.hi,
    ).length,
  );
  const lossCount = samples.filter((s) => s.rttMs === null).length;
  const max = Math.max(1, ...counts, lossCount);
  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      {bins.map((b, i) => (
        <View key={b.label} style={histStyles.row}>
          <Text style={histStyles.binLabel}>{b.label}</Text>
          <View style={histStyles.barWrap}>
            <View
              style={[
                histStyles.bar,
                {
                  width: `${(counts[i] / max) * 100}%`,
                  backgroundColor:
                    b.lo < 800 ? C.ok : b.lo < 2000 ? C.warn : C.err,
                },
              ]}
            />
          </View>
          <Text style={histStyles.count}>{counts[i]}</Text>
        </View>
      ))}
      <View style={histStyles.row}>
        <Text style={histStyles.binLabel}>LOST</Text>
        <View style={histStyles.barWrap}>
          <View
            style={[
              histStyles.bar,
              { width: `${(lossCount / max) * 100}%`, backgroundColor: C.err },
            ]}
          />
        </View>
        <Text style={histStyles.count}>{lossCount}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingVertical: S.md,
  },
  column: {
    gap: S.md,
  },
  sub: { color: C.textDim, fontSize: F.body, lineHeight: 20 },
  runBtn: {
    backgroundColor: C.accent + "22",
    borderColor: C.accent,
    borderWidth: 2,
    paddingVertical: S.md + 4,
    borderRadius: R.pill * 1.5,
    alignItems: "center",
    marginTop: 4,
  },
  runBtnText: {
    color: C.accent,
    fontSize: F.title,
    fontWeight: "900",
    letterSpacing: 4,
  },
  resultGroup: { gap: 8, marginTop: 8 },
  sectionTitle: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: S.md,
    textTransform: "uppercase",
  },
  replyLine: {
    color: C.textMuted,
    fontFamily: "Menlo",
    fontSize: F.micro,
    marginTop: 4,
  },
  statsCard: {
    backgroundColor: C.cardSunken,
    borderRadius: R.pill,
    padding: S.md,
    gap: S.md,
  },
  statRow: { flexDirection: "row", gap: S.sm },
  histCard: {
    backgroundColor: C.cardSunken,
    borderRadius: R.pill,
    padding: S.md,
  },
  histTitle: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  timeline: { gap: S.sm },
  timelineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    marginTop: 4,
  },
  timelineCell: {
    width: 12,
    height: 18,
    borderRadius: 2,
  },
});

const statStyles = StyleSheet.create({
  col: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: R.pill,
    padding: S.sm,
    alignItems: "center",
  },
  label: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
  },
  value: {
    color: C.text,
    fontSize: F.title,
    fontWeight: "800",
    fontFamily: "Menlo",
    marginTop: 2,
  },
});

const histStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: S.sm },
  binLabel: {
    color: C.textDim,
    fontSize: F.small,
    width: 64,
    fontFamily: "Menlo",
  },
  barWrap: { flex: 1, height: 12, backgroundColor: C.bg, borderRadius: 3 },
  bar: { height: "100%", borderRadius: 3 },
  count: {
    color: C.text,
    fontSize: F.small,
    width: 28,
    textAlign: "right",
    fontFamily: "Menlo",
  },
});
