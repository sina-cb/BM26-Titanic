// ParamsCard — global + local pattern parameter controls.
//
// Sits between the DECK card and the GLOBAL FX card on the deck
// screen. Exposes the engine's two flavours of "parameter":
//
//   1. GLOBAL params (Central Param Center) — speed, size, count,
//      direction, rotate, plus two HSV color palettes. These are
//      shared across every channel; flipping one steers every active
//      pattern's `shared*` exports at once.
//
//   2. LOCAL params — the per-pattern WASM `slider*` exports of the
//      current deck pattern. These change with the pattern, which is
//      why the Local section auto-refreshes whenever the active
//      pattern changes.
//
// Both flavours use the same wire shape (paginated query for read,
// single-field cmd for write). Both use optimistic UI — the slider
// jumps to the new chip on tap, with a pending shimmer until the
// engine echoes the value back through the next `qry params` /
// `qry exports` round-trip.
//
// LoRa cost notes:
//   - `qry params` is one frame.
//   - `qry exports/p/<n>` is up to ~3 frames for the patterns we ship
//     today (most patterns expose ≤ 4 sliders, well under the budget).
//   - Writes are one frame each. Discrete chip steppers (no drag) keep
//     the duty cycle reasonable.

import React, { useCallback, useEffect, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import type { TitanicLink } from "../link/titanicLink";
import {
  buildExportOp,
  buildExportsPageQuery,
  buildGlobalParamOp,
  buildPaletteOp,
  buildParamsSnapshotQuery,
} from "../frame/ops";
import { useAppStore } from "../state/store";
import {
  parseExportsPage,
  parseGlobalParamsSnapshot,
  type HsvTriple,
  type LocalExport,
} from "../status/parse";
import { Card } from "./primitives/Card";
import { StepperBar } from "./primitives/StepperBar";
import { C, F, R, S } from "./theme";

interface Props {
  link: TitanicLink;
}

// Discrete value sets per param. Chosen to be (1) a multiple of the
// engine's sane defaults and (2) coarse enough to keep operators from
// nudging the rig once per LoRa air-frame. Float chips are formatted
// as percent labels but the wire format is the canonical [0, 1].
const PERCENT_PRESETS = [0, 0.25, 0.5, 0.75, 1] as const;
const ROTATE_PRESETS = [0, 0.25, 0.5, 0.75, 1] as const;

// Direction is a 3-state on the engine ({0=reverse, 0.5=still, 1=forward}).
// We mirror those exact wire values so a chip tap maps 1:1 to a write.
const DIRECTION_PRESETS = [0, 0.5, 1] as const;

// Palette hue presets — eight equally-spaced points around the
// colour wheel + one "white" chip at saturation 0. Each chip is
// rendered in its own colour so the picker reads as a swatch row
// without needing a custom HSV widget. Saturation/value are pinned
// to (1, 1) on tap; the operator who genuinely needs a desaturated
// palette can still write {h, s<1, v} via CaptainPad — PortWatch
// keeps the picker simple by design.
const HUE_PRESETS: ReadonlyArray<{ label: string; h: number; s: number; v: number; swatch: string }> = [
  { label: "RED",    h: 0.000, s: 1, v: 1, swatch: "#ef4444" },
  { label: "ORANGE", h: 0.083, s: 1, v: 1, swatch: "#f97316" },
  { label: "AMBER",  h: 0.13,  s: 1, v: 1, swatch: "#eab308" },
  { label: "GREEN",  h: 0.33,  s: 1, v: 1, swatch: "#22c55e" },
  { label: "TEAL",   h: 0.5,   s: 1, v: 1, swatch: "#06b6d4" },
  { label: "BLUE",   h: 0.66,  s: 1, v: 1, swatch: "#3b82f6" },
  { label: "VIOLET", h: 0.78,  s: 1, v: 1, swatch: "#8b5cf6" },
  { label: "MAGENTA",h: 0.92,  s: 1, v: 1, swatch: "#ec4899" },
  { label: "WHITE",  h: 0.0,   s: 0, v: 1, swatch: "#f8fafc" },
];

// LoRa retry policy mirrors the pattern picker — 3 attempts per page,
// all-or-nothing on failure. All four values sourced from
// .config.portwatch.yaml::exports (see scripts/sync-config.mjs and
// the YAML for per-knob rationale).
import { exportsCfg as _exportsCfg } from "../config";

const PAGE_TIMEOUT_MS       = _exportsCfg.page_timeout_ms;
const PAGE_RETRY_BACKOFF_MS = _exportsCfg.retry_backoff_ms;
const MAX_PAGE_RETRIES      = _exportsCfg.max_page_retries;
const MAX_EXPORT_PAGES      = _exportsCfg.max_pages;

export function ParamsCard({ link }: Props) {
  return (
    <>
      <GlobalParamsCard link={link} />
      <LocalParamsCard link={link} />
    </>
  );
}

// ── GLOBAL PARAMS ───────────────────────────────────────────────────

function GlobalParamsCard({ link }: { link: TitanicLink }) {
  const intent = useAppStore((s) => s.intent);
  const globalParams = useAppStore((s) => s.globalParams);
  const loading = useAppStore((s) => s.globalParamsLoading);
  const setGlobalParams = useAppStore((s) => s.setGlobalParams);
  const setGlobalParamsLoading = useAppStore((s) => s.setGlobalParamsLoading);
  const setLastReply = useAppStore((s) => s.setLastReply);
  const intendGlobalParam = useAppStore((s) => s.intendGlobalParam);
  const markIntentResolved = useAppStore((s) => s.markIntentResolved);

  // Resolve the live value for each scalar param. Optimistic intent
  // wins if it's still pending; otherwise we read off the last
  // snapshot. Null means "no signal yet" — render the chips but with
  // nothing highlighted.
  const intendedScalar = useCallback(
    (key: "speed" | "direction" | "count" | "size" | "rotate"): number | null => {
      const i = intent.globalParams[key];
      if (i && typeof i.value === "number") return i.value;
      if (!globalParams) return null;
      const v = globalParams[key === "direction" ? "direction" : key];
      return typeof v === "number" ? v : null;
    },
    [intent.globalParams, globalParams],
  );

  const intendedPalette = useCallback(
    (slot: 1 | 2): HsvTriple | null => {
      const k = slot === 1 ? "colorPalette1" : "colorPalette2";
      const i = intent.globalParams[k];
      if (i && typeof i.value === "object" && "h" in i.value) {
        return i.value as HsvTriple;
      }
      return globalParams ? (slot === 1 ? globalParams.palette1 : globalParams.palette2) : null;
    },
    [intent.globalParams, globalParams],
  );

  const refresh = useCallback(async () => {
    if (loading) return;
    setGlobalParamsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    try {
      const res = await link.sendOp(buildParamsSnapshotQuery(), {
        timeoutMs: PAGE_TIMEOUT_MS,
      });
      if (res.timedOut || !res.reply) {
        setLastReply(`PARAMS  refresh timeout (${res.rttMs} ms)`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
        return;
      }
      if (res.reply.typ === "nak") {
        setLastReply(`PARAMS  nak ${res.reply.arg}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined,
        );
        return;
      }
      const parsed = parseGlobalParamsSnapshot(res.reply.arg, Date.now());
      setGlobalParams(parsed);
      setLastReply(`PARAMS  refreshed · ${res.rttMs} ms`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } finally {
      setGlobalParamsLoading(false);
    }
  }, [link, loading, setGlobalParams, setGlobalParamsLoading, setLastReply]);

  const onScalar = useCallback(
    (key: "speed" | "direction" | "count" | "size" | "rotate") =>
      async (value: number) => {
        intendGlobalParam(key, value);
        try {
          const res = await link.sendOp(buildGlobalParamOp(key, value));
          toastReply(setLastReply, res, `${key.toUpperCase()} ${value}`);
        } finally {
          markIntentResolved(`globalParam:${key}`);
        }
      },
    [link, intendGlobalParam, markIntentResolved, setLastReply],
  );

  const onPalette = useCallback(
    (slot: 1 | 2) => async (h: number, s: number, v: number) => {
      const key = slot === 1 ? "colorPalette1" : "colorPalette2";
      const triple: HsvTriple = { h, s, v };
      intendGlobalParam(key, triple);
      try {
        const res = await link.sendOp(buildPaletteOp(slot, h, s, v));
        toastReply(setLastReply, res, `PALETTE ${slot} h=${h.toFixed(2)}`);
      } finally {
        markIntentResolved(`globalParam:${key}`);
      }
    },
    [link, intendGlobalParam, markIntentResolved, setLastReply],
  );

  // Find the closest preset chip to the live value so the highlight
  // doesn't go dark when the engine reports a custom value (e.g.
  // 0.42 from CaptainPad) that doesn't match a chip exactly.
  const closestPreset = useCallback(
    <T extends number>(presets: ReadonlyArray<T>, value: number | null): T | null => {
      if (value === null) return null;
      let best: T = presets[0];
      let bestDist = Math.abs(presets[0] - value);
      for (const p of presets) {
        const d = Math.abs(p - value);
        if (d < bestDist) {
          best = p;
          bestDist = d;
        }
      }
      return best;
    },
    [],
  );

  const speed = intendedScalar("speed");
  const size = intendedScalar("size");
  const count = intendedScalar("count");
  const direction = intendedScalar("direction");
  const rotate = intendedScalar("rotate");
  const palette1 = intendedPalette(1);
  const palette2 = intendedPalette(2);

  const speedPending = !!intent.globalParams.speed?.pending;
  const sizePending = !!intent.globalParams.size?.pending;
  const countPending = !!intent.globalParams.count?.pending;
  const directionPending = !!intent.globalParams.direction?.pending;
  const rotatePending = !!intent.globalParams.rotate?.pending;
  const p1Pending = !!intent.globalParams.colorPalette1?.pending;
  const p2Pending = !!intent.globalParams.colorPalette2?.pending;

  return (
    <Card title="GLOBAL PARAMS" accent={C.param}>
      <RefreshHeader
        loading={loading}
        accent={C.param}
        synced={globalParams ? globalParams.receivedAtMs : null}
        onPress={refresh}
        emptyMessage="tap REFRESH to read engine globals"
        loaded={globalParams !== null}
      />
      <StepperBar<number>
        label="SPEED"
        values={[...PERCENT_PRESETS]}
        current={closestPreset(PERCENT_PRESETS, speed)}
        onChange={onScalar("speed")}
        pending={speedPending}
        accent={C.param}
        format={percentLabel}
      />
      <StepperBar<number>
        label="SIZE"
        values={[...PERCENT_PRESETS]}
        current={closestPreset(PERCENT_PRESETS, size)}
        onChange={onScalar("size")}
        pending={sizePending}
        accent={C.param}
        format={percentLabel}
      />
      <StepperBar<number>
        label="COUNT"
        values={[...PERCENT_PRESETS]}
        current={closestPreset(PERCENT_PRESETS, count)}
        onChange={onScalar("count")}
        pending={countPending}
        accent={C.param}
        format={percentLabel}
      />
      <StepperBar<number>
        label="DIRECTION"
        values={[...DIRECTION_PRESETS]}
        current={closestPreset(DIRECTION_PRESETS, direction)}
        onChange={onScalar("direction")}
        pending={directionPending}
        accent={C.param}
        format={directionLabel}
      />
      <StepperBar<number>
        label="ROTATE"
        values={[...ROTATE_PRESETS]}
        current={closestPreset(ROTATE_PRESETS, rotate)}
        onChange={onScalar("rotate")}
        pending={rotatePending}
        accent={C.param}
        format={percentLabel}
      />
      <PaletteRow
        label="PALETTE 1"
        value={palette1}
        pending={p1Pending}
        onPress={onPalette(1)}
      />
      <PaletteRow
        label="PALETTE 2"
        value={palette2}
        pending={p2Pending}
        onPress={onPalette(2)}
      />
    </Card>
  );
}

function percentLabel(v: number): string {
  if (v === 0) return "0";
  if (v === 1) return "100";
  return `${Math.round(v * 100)}`;
}

function directionLabel(v: number): string {
  if (v === 0) return "REV";
  if (v === 0.5) return "STILL";
  return "FWD";
}

// ── Palette row ─────────────────────────────────────────────────────

function PaletteRow({
  label,
  value,
  pending,
  onPress,
}: {
  label: string;
  value: HsvTriple | null;
  pending: boolean;
  onPress: (h: number, s: number, v: number) => void;
}) {
  // Find the closest swatch chip to the live value so the highlight
  // collapses correctly even when CaptainPad set an in-between hue.
  const activeIdx = useMemo(() => {
    if (!value) return null;
    // Score = (hue distance) + (sat-mismatch penalty) so the WHITE
    // chip wins when sat≈0 regardless of how close the hue is.
    const score = (preset: typeof HUE_PRESETS[number]) => {
      // Hue is circular: distance is min(|a-b|, 1-|a-b|).
      const dh = Math.abs(value.h - preset.h);
      const hueDist = Math.min(dh, 1 - dh);
      const satMismatch = Math.abs(value.s - preset.s);
      return hueDist + satMismatch * 2;
    };
    let best = 0;
    let bestScore = score(HUE_PRESETS[0]);
    for (let i = 1; i < HUE_PRESETS.length; i++) {
      const s2 = score(HUE_PRESETS[i]);
      if (s2 < bestScore) {
        best = i;
        bestScore = s2;
      }
    }
    return best;
  }, [value]);

  return (
    <View style={styles.paletteOuter}>
      <View style={styles.paletteHeader}>
        <Text style={[styles.paletteLabel, { color: C.param }]}>{label}</Text>
        {value ? (
          <View style={[styles.paletteSwatch, { backgroundColor: hsvToCss(value) }]} />
        ) : null}
        {pending ? <ActivityIndicator size="small" color={C.param} /> : null}
      </View>
      <View style={styles.paletteRow}>
        {HUE_PRESETS.map((p, i) => {
          const active = i === activeIdx;
          return (
            <Pressable
              key={p.label}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                onPress(p.h, p.s, p.v);
              }}
              style={({ pressed }) => [
                styles.swatch,
                {
                  backgroundColor: p.swatch,
                  borderColor: active ? C.text : "transparent",
                  borderWidth: active ? 2 : 0,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  styles.swatchLabel,
                  // Force a high-contrast label colour against the swatch.
                  { color: active ? C.bg : "rgba(0,0,0,0.65)" },
                ]}
                numberOfLines={1}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function hsvToCss(c: HsvTriple): string {
  // Standard HSV→RGB; we only ever feed in 0..1 components so the
  // wraparound on hue is intentional.
  const h = ((c.h % 1) + 1) % 1;
  const s = Math.max(0, Math.min(1, c.s));
  const v = Math.max(0, Math.min(1, c.v));
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// ── LOCAL (per-pattern) PARAMS ──────────────────────────────────────

function LocalParamsCard({ link }: { link: TitanicLink }) {
  const intent = useAppStore((s) => s.intent);
  const status = useAppStore((s) => s.engineStatus);
  const localExports = useAppStore((s) => s.localExports);
  const loading = useAppStore((s) => s.localExportsLoading);
  const setLocalExports = useAppStore((s) => s.setLocalExports);
  const setLocalExportsLoading = useAppStore((s) => s.setLocalExportsLoading);
  const setLastReply = useAppStore((s) => s.setLastReply);
  const intendLocalExport = useAppStore((s) => s.intendLocalExport);
  const markIntentResolved = useAppStore((s) => s.markIntentResolved);

  const refresh = useCallback(async () => {
    if (loading) return;
    setLocalExportsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    const collected: LocalExport[] = [];
    let totalPages = 1;
    let aborted = false;
    let lastErr: string | null = null;

    try {
      let done = false;
      for (let page = 0; page < MAX_EXPORT_PAGES && !done; page++) {
        let pageOk = false;
        for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
          const res = await link.sendOp(buildExportsPageQuery(page), {
            timeoutMs: PAGE_TIMEOUT_MS,
          });
          let failure: string | null = null;
          if (res.timedOut || !res.reply) failure = "timeout";
          else if (res.reply.typ === "nak") failure = `nak ${res.reply.arg}`;
          if (failure) {
            lastErr = `page ${page + 1} attempt ${attempt}: ${failure}`;
            if (attempt < MAX_PAGE_RETRIES) {
              await new Promise((r) => setTimeout(r, PAGE_RETRY_BACKOFF_MS));
              continue;
            }
            aborted = true;
            break;
          }
          const parsed = parseExportsPage(res.reply!.arg);
          if (!parsed) {
            lastErr = `page ${page + 1} attempt ${attempt}: malformed reply`;
            if (attempt < MAX_PAGE_RETRIES) {
              await new Promise((r) => setTimeout(r, PAGE_RETRY_BACKOFF_MS));
              continue;
            }
            aborted = true;
            break;
          }
          for (const e of parsed.exports) collected.push(e);
          totalPages = parsed.totalPages;
          pageOk = true;
          if (parsed.pageIndex >= parsed.totalPages - 1) done = true;
          break;
        }
        if (!pageOk) {
          aborted = true;
          break;
        }
      }
      if (!aborted && !done) {
        aborted = true;
        lastErr = `gave up after ${MAX_EXPORT_PAGES} pages`;
      }
      if (aborted) {
        setLastReply(
          `EXPORTS  refresh failed${lastErr ? ` — ${lastErr}` : ""}`,
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined,
        );
        return;
      }
      setLocalExports(collected);
      setLastReply(
        `EXPORTS  ${collected.length} loaded · ${totalPages} pages`,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } finally {
      setLocalExportsLoading(false);
    }
  }, [link, loading, setLastReply, setLocalExports, setLocalExportsLoading]);

  // Auto-refresh when the active pattern changes — local exports are
  // pattern-scoped (every pattern declares its own slider* exports)
  // so a stale list would point control IDs at something the engine
  // doesn't know about.
  //
  // We auto-fetch on EVERY transition, including the first observed
  // pattern after a fresh connect. Previously we used to skip the
  // first auto-fetch to avoid "noisy boot" — but that hid the local
  // params on every reconnect AND on every external pattern change
  // that landed before the operator opened the ParamsCard. The
  // operator's mental model is "the local params row always shows
  // the live pattern's sliders", so we lean toward over-fetching
  // (one extra paged LoRa fetch per connect) over the silent-empty
  // failure mode.
  const activePattern = status?.activePattern ?? null;
  const lastFetchedFor = React.useRef<string | null>(null);
  useEffect(() => {
    if (!activePattern) return;
    if (lastFetchedFor.current === activePattern) return;
    lastFetchedFor.current = activePattern;
    refresh().catch(() => undefined);
  }, [activePattern, refresh]);

  const onSlider = useCallback(
    (controlId: number) => async (v0: number) => {
      intendLocalExport(controlId, v0);
      try {
        const res = await link.sendOp(buildExportOp(controlId, v0));
        toastReply(setLastReply, res, `EXP ${controlId} = ${v0}`);
      } finally {
        markIntentResolved(`localExport:${controlId}`);
      }
    },
    [link, intendLocalExport, markIntentResolved, setLastReply],
  );

  const sliders = useMemo(
    () => (localExports || []).filter((e) => e.kind === 1),
    [localExports],
  );
  const nonSliders = useMemo(
    () => (localExports || []).filter((e) => e.kind !== 1),
    [localExports],
  );

  const intendValue = useCallback(
    (id: number, fallback: number) => {
      const i = intent.localExports[String(id)];
      if (i) return i.value;
      return fallback;
    },
    [intent.localExports],
  );

  return (
    <Card
      title="LOCAL PARAMS"
      accent={C.param}
      badge={activePattern ? activePattern.toUpperCase() : "NO PATTERN"}
      badgeColor={C.pattern}
    >
      <RefreshHeader
        loading={loading}
        accent={C.param}
        synced={null}
        loaded={localExports !== null}
        emptyMessage="tap REFRESH to read pattern exports"
        onPress={refresh}
      />
      {localExports === null ? null : sliders.length === 0 ? (
        <Text style={styles.emptyNote}>
          {nonSliders.length === 0
            ? "no controllable sliders in this pattern"
            : `pattern declares ${nonSliders.length} non-slider export${nonSliders.length === 1 ? "" : "s"} (kind ≠ 1) which PortWatch doesn't surface yet`}
        </Text>
      ) : (
        sliders.map((e) => {
          const closest = closestExportPreset(intendValue(e.id, e.v0));
          const pending = !!intent.localExports[String(e.id)]?.pending;
          return (
            <StepperBar<number>
              key={String(e.id)}
              label={prettyExportName(e.name)}
              values={[...PERCENT_PRESETS]}
              current={closest}
              onChange={onSlider(e.id)}
              pending={pending}
              accent={C.param}
              format={percentLabel}
            />
          );
        })
      )}
    </Card>
  );
}

function closestExportPreset(value: number): number {
  let best = PERCENT_PRESETS[0] as number;
  let bestDist = Math.abs(best - value);
  for (const p of PERCENT_PRESETS) {
    const d = Math.abs(p - value);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

function prettyExportName(name: string): string {
  // Patterns conventionally name slider exports `sliderFoo` or
  // `sliderFooBar`. Strip the prefix and split CamelCase so the chip
  // header reads cleanly.
  return name
    .replace(/^slider/i, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toUpperCase();
}

// ── Shared header (refresh button + sync state) ─────────────────────

function RefreshHeader({
  loading,
  accent,
  synced,
  loaded,
  emptyMessage,
  onPress,
}: {
  loading: boolean;
  accent: string;
  synced: number | null;
  loaded: boolean;
  emptyMessage: string;
  onPress: () => void;
}) {
  const syncedLabel = synced
    ? `synced ${formatAge(Date.now() - synced)} ago`
    : loaded
      ? "synced"
      : emptyMessage;
  return (
    <View style={styles.refreshOuter}>
      <Text style={[styles.refreshSyncedLabel, { color: C.textDim }]} numberOfLines={1}>
        {syncedLabel}
      </Text>
      <Pressable
        onPress={onPress}
        disabled={loading}
        style={({ pressed }) => [
          styles.refreshBtn,
          {
            borderColor: accent,
            backgroundColor: pressed ? C.cardActive : "transparent",
          },
          loading && { opacity: 0.5 },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={accent} />
        ) : (
          <Text style={[styles.refreshBtnText, { color: accent }]}>REFRESH</Text>
        )}
      </Pressable>
    </View>
  );
}

function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)}m`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function toastReply(
  setLastReply: (s: string | null) => void,
  res: {
    timedOut: boolean;
    rttMs: number;
    reply: { typ: string; arg: string } | null;
  },
  label: string,
) {
  if (res.timedOut || !res.reply) {
    setLastReply(`TIMEOUT  ${label} (${res.rttMs} ms)`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
    return;
  }
  const r = res.reply;
  const tag = r.typ.toUpperCase();
  setLastReply(`${tag}  ${label}  ·  ${res.rttMs} ms${r.arg ? "  ·  " + r.arg : ""}`);
  if (r.typ === "nak") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
      () => undefined,
    );
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
  }
}

const styles = StyleSheet.create({
  refreshOuter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: S.sm,
    paddingBottom: S.xs,
  },
  refreshSyncedLabel: {
    flex: 1,
    fontSize: F.micro,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  refreshBtn: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    borderWidth: 1,
    minWidth: 92,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshBtnText: {
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  paletteOuter: {
    gap: S.sm,
  },
  paletteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
  },
  paletteLabel: {
    fontSize: F.small,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    flex: 1,
  },
  paletteSwatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.border,
  },
  paletteRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: S.xs,
  },
  swatch: {
    minWidth: 48,
    height: 32,
    borderRadius: R.pill,
    paddingHorizontal: S.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  emptyNote: {
    color: C.textMuted,
    fontSize: F.small,
    fontStyle: "italic",
  },
});
