// DeckScreen — the primary command surface.
//
// Top-level stack:
//
//   QUICK ACTIONS card
//     ├─ BLACKOUT toggle
//     └─ BRIGHTNESS stepper
//
//   DECK card
//     ├─ AUTOPILOT toggle
//     ├─ AUTOPILOT INTERVAL stepper
//     ├─ TRANSITIONS stepper (DISABLED placeholder)
//     ├─ ACTIVE PATTERN row (read-only, sourced from engine status)
//     └─ PATTERN PICKER scroll list with REFRESH button (pages over LoRa)
//
//   GLOBAL FX card
//     └─ VintageWhite / Fogger / UV Blast / Blast All White toggles
//
//   HORN card (DISABLED — surfaces the path but no LoRa wire-up yet)
//   PYRO card (DISABLED — never on LoRa, safety isolated)
//
// Pattern picker rules:
//   * REFRESH triggers a paged fetch (`qry engine/patterns/p/<n>`)
//     looping over every page so the operator sees the FULL catalog,
//     not a single LoRa frame's worth.
//   * Rendered as a vertically-scrollable list inside a fixed-height
//     viewport (~4 rows visible) so a 30-pattern playlist doesn't
//     blow the deck card off the screen.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { TitanicLink } from "../link/titanicLink";
import {
  AUTOPILOT_INTERVAL_PRESETS,
  BRIGHTNESS_PRESETS,
  STATEFUL_FX_MACROS,
  buildAutopilotIntervalOp,
  buildAutopilotOp,
  buildBlackoutOp,
  buildBrightnessOp,
  buildFxOp,
  buildPatternOp,
  buildPatternsPageQuery,
  buildPlaylistPatternsPageQuery,
  buildStatusQuery,
  buildViewOverrideOp,
  buildViewRenewOp,
} from "../frame/ops";
import {
  buildDeckPlaylistQuery,
  buildPlaylistOp,
  buildPlaylistsPageQuery,
} from "../frame/ops";
import {
  parseDeckPlaylist,
  parsePatternPage,
  parsePlaylistPatternsPage,
  parsePlaylistsPage,
  type EngineStatus,
} from "../status/parse";
import { useAppStore } from "../state/store";
import { rebuildWorld } from "../state/rebuildWorld";
import { useFormFactor, MAX_CONTENT_WIDTH } from "./layout";
import { Card } from "./primitives/Card";
import { StepperBar } from "./primitives/StepperBar";
import { Toggle } from "./primitives/Toggle";
import { C, F, R, S } from "./theme";
import { ParamsCard } from "./ParamsCard";
// `CFG.patterns.*` and `CFG.lease.*` are sourced from
// .config.portwatch.yaml via scripts/sync-config.mjs. See
// src/config/index.ts for the import surface and the YAML for
// per-knob rationale + failure-mode comments.
import { CFG } from "../config";

const MAX_PATTERN_PAGES   = CFG.patterns.max_pages;
const MAX_PAGE_RETRIES    = CFG.patterns.max_page_retries;
const PAGE_TIMEOUT_MS     = CFG.patterns.page_timeout_ms;
const RETRY_BACKOFF_MS    = CFG.patterns.retry_backoff_ms;

function _formatRelative(ts: number): string {
  // Lightweight "X ago" for the snapshot freshness hint. Buckets are
  // chosen to communicate "freshly refreshed" vs "stale" without
  // demanding a 1 Hz re-render — the hint is sampled at render time
  // and is allowed to drift up to one bucket. Operators only glance
  // at it after a REFRESH or when wondering "is my picker current?".
  const dt = Math.max(0, Date.now() - ts);
  if (dt < 60_000) return "fresh (just refreshed)";
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)} min ago`;
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)} h ago`;
  return `${Math.round(dt / 86_400_000)} d ago`;
}
/** ~4 rows visible at a time before scrolling kicks in. */
const PATTERN_LIST_HEIGHT = 260;

interface Props {
  link: TitanicLink;
}

export function DeckScreen({ link }: Props) {
  const ff = useFormFactor();
  const padding = ff === "compact" ? S.md : S.lg;
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
        <QuickActionsCard link={link} />
        <DeckCard link={link} />
        <ParamsCard link={link} />
        <GlobalFxCard link={link} />
        <HornCard />
        <PyroCard />
      </View>
    </ScrollView>
  );
}

// ── QUICK ACTIONS ───────────────────────────────────────────────────

function QuickActionsCard({ link }: { link: TitanicLink }) {
  const status = useAppStore((s) => s.engineStatus);
  const intent = useAppStore((s) => s.intent);
  const setLastReply = useAppStore((s) => s.setLastReply);
  const intendBlackout = useAppStore((s) => s.intendBlackout);
  const intendBrightness = useAppStore((s) => s.intendBrightness);
  const markIntentResolved = useAppStore((s) => s.markIntentResolved);

  const blackoutValue = intent.blackout?.value ?? status?.blackout ?? false;
  const blackoutPending = intent.blackout?.pending ?? false;
  const brightnessValue = intent.brightness?.value ?? status?.brightness ?? null;
  const brightnessPending = intent.brightness?.pending ?? false;

  const onBlackout = useCallback(
    async (next: boolean) => {
      intendBlackout(next);
      try {
        const res = await link.sendOp(buildBlackoutOp(next));
        toastReply(setLastReply, res, `BLACKOUT ${next ? "ON" : "OFF"}`);
      } finally {
        markIntentResolved("blackout");
      }
    },
    [link, intendBlackout, markIntentResolved, setLastReply],
  );

  const onBrightness = useCallback(
    async (level: number) => {
      intendBrightness(level);
      try {
        const res = await link.sendOp(buildBrightnessOp(level));
        toastReply(setLastReply, res, `BRIGHTNESS ${level}%`);
      } finally {
        markIntentResolved("brightness");
      }
    },
    [link, intendBrightness, markIntentResolved, setLastReply],
  );

  // Block writes until we have at least one engineStatus snapshot so
  // the operator never fires a global blackout/brightness change
  // against a UI that's still showing default placeholder values.
  // This is part of the "never show bad data" contract — the same
  // reason DeckCard's override gate hides its action buttons until
  // status arrives.
  const ready = status !== null;
  return (
    <Card title="QUICK ACTIONS" accent={C.accent}>
      <Toggle
        label={!ready ? "BLACKOUT" : blackoutValue ? "BLACKOUT" : "RIG LIVE"}
        sub={
          !ready
            ? "waiting for engine state…"
            : blackoutValue
              ? "global · engine muted"
              : "global"
        }
        value={blackoutValue}
        pending={blackoutPending}
        onChange={onBlackout}
        accent={C.blackout}
        disabled={!ready}
      />
      <StepperBar<number>
        label="BRIGHTNESS"
        unit="%"
        values={[...BRIGHTNESS_PRESETS]}
        current={brightnessValue}
        onChange={onBrightness}
        pending={brightnessPending}
        disabled={!ready}
        accent={C.brightness}
      />
    </Card>
  );
}

// ── DECK ────────────────────────────────────────────────────────────

function DeckCard({ link }: { link: TitanicLink }) {
  const status = useAppStore((s) => s.engineStatus);
  const intent = useAppStore((s) => s.intent);
  const patternList = useAppStore((s) => s.patternList);
  const patternsLoading = useAppStore((s) => s.patternsLoading);
  const patternListError = useAppStore((s) => s.patternListError);
  const worldRebuildInProgress = useAppStore((s) => s.worldRebuildInProgress);
  const snapshotBuiltAtMs = useAppStore((s) => s.snapshotBuiltAtMs);
  const setPatternList = useAppStore((s) => s.setPatternList);
  const cachePatternsForPlaylist = useAppStore(
    (s) => s.cachePatternsForPlaylist,
  );
  const invalidatePatternsCache = useAppStore(
    (s) => s.invalidatePatternsCache,
  );
  const setPatternsLoading = useAppStore((s) => s.setPatternsLoading);
  const setPatternListError = useAppStore((s) => s.setPatternListError);
  // Connect generation: bumps in App.tsx::onConnect after every
  // successful BLE pair. Hydration `useEffect`s subscribe to it as a
  // stable trigger that only fires on a real (re)connection — we
  // used to use a per-render `useRef` latch which silently skipped
  // hydration if the latch survived a Fast Refresh or if a parent
  // re-render fired the effect before BLE was up.
  const connectGeneration = useAppStore((s) => s.connectGeneration);
  // The Deck card needs to know when a playlist swap is in flight so
  // it can grey-out the pattern REFRESH button. The PlaylistSwitcher
  // (child component below) flips this flag while it's writing the
  // swap and chains a refresh on success — gating from this side
  // prevents the operator from racing the two with a manual tap.
  const deckPlaylistSwitching = useAppStore((s) => s.deckPlaylistSwitching);
  const setLastReply = useAppStore((s) => s.setLastReply);
  const intendAutopilot = useAppStore((s) => s.intendAutopilot);
  const intendAutopilotInterval = useAppStore((s) => s.intendAutopilotInterval);
  const intendActivePattern = useAppStore((s) => s.intendActivePattern);
  const intendViewOverride = useAppStore((s) => s.intendViewOverride);
  const markIntentResolved = useAppStore((s) => s.markIntentResolved);

  const [patternBusy, setPatternBusy] = useState<string | null>(null);
  const [paginationProgress, setPaginationProgress] = useState<{
    page: number;
    total: number;
    attempt: number;
  } | null>(null);

  const autopilotValue = intent.autopilot?.value ?? status?.autopilot ?? false;
  const autopilotPending = intent.autopilot?.pending ?? false;
  // Interval source-of-truth chain (highest priority first):
  //   1. Local pending intent (the operator just nudged the picker;
  //      show the new value with a pending shimmer until the engine
  //      echoes it back).
  //   2. Engine status `apd/<sec>` from the latest compact PUB.
  //   3. null → picker shows the lowest preset as a placeholder.
  // Without this, the picker would re-render to its `useState` default
  // every time a status pub landed, making it impossible to see what
  // the engine currently has set.
  const autopilotInterval =
    intent.autopilotInterval?.value ?? status?.autopilotIntervalSec ?? null;
  const autopilotIntervalPending = intent.autopilotInterval?.pending ?? false;
  // Active pattern: optimistic override of the engine's last-known
  // value. As soon as the operator taps a row in the picker we set
  // this so the highlight jumps instantly — without it the user
  // sees their tap, then a 1–3 s "did anything happen?" gap until
  // the BLE→LoRa→engine→LoRa→BLE PUB round-trip completes.
  const activePattern =
    intent.activePattern?.value ?? status?.activePattern ?? null;
  const activePatternPending = intent.activePattern?.pending ?? false;

  // ── Deck-control gating ───────────────────────────────────────────
  // PortWatch's deck card writes (autopilot, pattern selection) only
  // make sense when the engine is actually rendering the deck channel.
  // When the live mixer panel has the engine in mixer view AND nobody
  // has pinned the deck override, our pattern writes would land on a
  // hidden channel and confuse the operator. Gate the controls and
  // surface a one-tap OVERRIDE button.
  //
  // Source-of-truth chain for both signals mirrors the rest of the
  // store: optimistic intent first (so the OVERRIDE button feels
  // instant), then the most recent engine PUB. CRITICAL — when the
  // engine status hasn't arrived yet (status === null) we MUST treat
  // every gate as locked, otherwise the UI defaults to "DECK ACTIVE"
  // and offers TAKE LOCK before we know what the engine is even
  // doing. That false-positive is the bug behind the "loaded
  // PortWatch in mixer mode and it shows deck controls" report.
  const viewOverrideActive =
    intent.viewOverride?.value ?? status?.viewOverrideActive ?? false;
  const viewOverridePending = intent.viewOverride?.pending ?? false;
  const engineView = status?.engineView ?? null;
  // Operator can drive the deck if AND ONLY IF we have a fresh
  // engine snapshot AND either (a) they're holding the override pin
  // OR (b) the engine is naturally on the deck view. The `!!status`
  // gate is the new safety net — without it `engineView === "deck"`
  // is `null === "deck"` (false) but `viewOverrideActive` is also
  // false, so canControlDeck stays false naturally; however an
  // intent.viewOverride pending value would flip it true, which is
  // wrong when we don't even know what view the engine is in yet.
  const canControlDeck =
    !!status && (viewOverrideActive || engineView === "deck");
  // Lease metadata for the lock UI. The engine sends remaining seconds
  // on every compact PUB; we surface that as an "expires in Ns" pill
  // and as the trigger for our defensive renew (re-take if remaining
  // dips below LEASE_LOW_WATER_SEC).
  const controlLockOwner = status?.controlLockOwner ?? null;
  const controlLockLeaseRemainSec = status?.controlLockLeaseRemainSec ?? 0;
  // Lease renew cadence + defensive low-water mark. Both sourced
  // from .config.portwatch.yaml::lease (see scripts/sync-config.mjs).
  // Engine-side lease is 30s (CONTROL_LOCK_LEASE_MS in api_server.js);
  // our 20s renew gives 10s of margin for a dropped LoRa round-trip.
  const LEASE_RENEW_INTERVAL_MS = CFG.lease.renew_interval_ms;
  const LEASE_LOW_WATER_SEC = CFG.lease.low_water_sec;

  // ── Lease renewer ─────────────────────────────────────────────────
  // While we hold the lock, fire a silent `view/renew` every 20 s so
  // the engine's 30 s lease never expires under us. We also fire a
  // defensive renew immediately if the engine reports the lease is
  // about to expire (LEASE_LOW_WATER_SEC) — this covers the case
  // where one or two periodic renews were lost over LoRa.
  //
  // We use the *engine-confirmed* owner string (controlLockOwner)
  // rather than the local intent. The intent says "I asked for the
  // lock"; the owner field says "the engine agreed and is still
  // counting down the lease for me". Renewing based on intent
  // would keep pinging the engine even after a successful release
  // (during the brief window where the engine has cleared but we
  // haven't reconciled the intent yet), wasting LoRa airtime.
  //
  // Cleanup happens on:
  //   * unmount (tab navigation, app teardown)
  //   * owner changing to anything other than "portwatch"
  //   * link going down (the next renew tick errors out; harmless)
  const lastRenewAtRef = useRef<number>(0);
  useEffect(() => {
    if (controlLockOwner !== "portwatch") {
      lastRenewAtRef.current = 0;
      return undefined;
    }
    let cancelled = false;
    const renewOnce = async () => {
      if (cancelled) return;
      // Don't double-fire if a tick AND a low-water trigger race.
      const now = Date.now();
      if (now - lastRenewAtRef.current < 2_000) return;
      lastRenewAtRef.current = now;
      try {
        // Silent — no toast, no haptic, no intent flip. The wire log
        // shows the CMD so an operator debugging the link can still
        // see the renews going out.
        await link.sendOp(buildViewRenewOp(), { timeoutMs: 6_000 });
      } catch {
        // Swallow: if the link is down the lease will expire and
        // CaptainPad will get control back, which is the intended
        // safe-fail behaviour.
      }
    };
    const tick = setInterval(renewOnce, LEASE_RENEW_INTERVAL_MS);
    // Defensive renew: if the engine says "your lease is almost
    // over" before our 20 s timer fires, jump the gun. This handles
    // the case where a renew was lost over LoRa and we'd otherwise
    // sit through the expiry.
    if (controlLockLeaseRemainSec > 0 && controlLockLeaseRemainSec <= LEASE_LOW_WATER_SEC) {
      renewOnce();
    }
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [controlLockOwner, controlLockLeaseRemainSec, link]);

  const onAutopilot = useCallback(
    async (next: boolean) => {
      intendAutopilot(next);
      try {
        const res = await link.sendOp(buildAutopilotOp(next));
        toastReply(setLastReply, res, `AUTOPILOT ${next ? "ON" : "OFF"}`);
      } finally {
        markIntentResolved("autopilot");
      }
    },
    [link, intendAutopilot, markIntentResolved, setLastReply],
  );

  const onIntervalChange = useCallback(
    async (sec: number) => {
      intendAutopilotInterval(sec);
      try {
        const res = await link.sendOp(buildAutopilotIntervalOp(sec));
        toastReply(setLastReply, res, `AUTOPILOT EVERY ${sec}s`);
      } finally {
        markIntentResolved("autopilotInterval");
      }
    },
    [link, intendAutopilotInterval, markIntentResolved, setLastReply],
  );

  // Multi-page fetch with all-or-nothing semantics.
  //
  // Source: the engine's CURRENT deck playlist
  //   (`qry engine/playlist-patterns/p/<n>`). This intentionally
  //   scopes the picker to the operator's working set — switching
  //   to a name not in the playlist would still work over the radio,
  //   but it would silently move the deck off the playlist cursor,
  //   which is the opposite of what an operator expects from a
  //   playlist-scoped picker.
  //
  // Fallback: when the engine has no playlist loaded, the bridge
  //   replies with `pl/-,c/` (zero patterns). We surface that as the
  //   empty state — the operator can load a playlist from the
  //   PlaylistSwitcher above and re-tap REFRESH.
  //
  // Each page is retried up to MAX_PAGE_RETRIES times (LoRa drops a
  // frame here and there — one or two attempts usually recovers).
  // If ANY page still can't be fetched after retries, the WHOLE refresh
  // fails and we leave the previous catalog untouched. We never show a
  // half-baked list because:
  //
  //   * the visible patterns would silently shrink → operators stop
  //     trusting the picker
  //   * a "+N more" tail is tempting to tap and would send a name the
  //     engine doesn't have
  const refreshPatterns = useCallback(async (opts?: { force?: boolean }) => {
    if (patternsLoading) return;
    // A playlist swap is in flight (the engine is reloading entries
    // and the bridge briefly returns the OLD playlist's pattern list
    // while it catches up). Refreshing right now would race with the
    // swap and present a stale list to the operator. The
    // PlaylistSwitcher chains a refresh once the swap completes.
    if (deckPlaylistSwitching) return;
    const force = opts?.force === true;

    // ── Persistent cache short-circuit ──────────────────────────
    // The pattern cache is keyed by playlist NAME and persisted to
    // AsyncStorage (see `state/persistedCache.ts`). Lookup contract:
    //
    //   1. Have a cache entry for the active playlist's name → HIT.
    //   2. No entry yet (first time we've seen this playlist on this
    //      device, OR the operator just hit REFRESH on the picker) →
    //      MISS, paginate over LoRa, write the entry back.
    //
    // No hashes, no validity windows, no auto-rehydrate. The cache
    // is authoritative until the operator taps REFRESH — the engine
    // could change underneath us and PortWatch would still serve the
    // last known list, which is the field UX the operator asked
    // for ("on pattern switch, or first load, load and cache, and
    // persist it until I press refresh").
    //
    // `force=true` (manual REFRESH button) skips the cache.
    const liveStatus = useAppStore.getState().engineStatus;
    const activePlaylistName = liveStatus?.deckPlaylistName ?? null;
    const cached = activePlaylistName
      ? useAppStore.getState().patternsByPlaylist[activePlaylistName]
      : undefined;
    const cacheHit =
      !force &&
      activePlaylistName !== null &&
      cached !== undefined &&
      cached.patterns.length > 0;
    if (cacheHit && cached) {
      setPatternList({
        patterns: cached.patterns,
        truncatedExtra: cached.truncatedExtra,
        receivedAtMs: cached.receivedAtMs,
        rawArg: cached.rawArg,
      });
      setPatternListError(null);
      setLastReply(
        `PATTERNS  ${cached.patterns.length} cached · playlist=${activePlaylistName} · HIT`,
      );
      Haptics.selectionAsync().catch(() => undefined);
      return;
    }
    if (!force && activePlaylistName) {
      setLastReply(
        `PATTERNS  loading · playlist=${activePlaylistName} · first load · paginating…`,
      );
    }

    setPatternsLoading(true);
    setPaginationProgress(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    const collected: string[] = [];
    let totalCount = 0;
    let totalPages = 1;
    const fetchStartedAt = Date.now();
    let lastErr: string | null = null;
    let aborted = false;
    let resolvedPlaylist: string | null = null;

    let done = false;
    try {
      for (let page = 0; page < MAX_PATTERN_PAGES && !done; page++) {
        let pageOk = false;
        for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
          setPaginationProgress({
            page: page + 1,
            total: totalPages,
            attempt,
          });
          const res = await link.sendOp(
            buildPlaylistPatternsPageQuery(page),
            { timeoutMs: PAGE_TIMEOUT_MS },
          );

          // Helper: classify the reply. Anything not OK is retried up
          // to MAX_PAGE_RETRIES; we record the latest error so a final
          // failure can surface it.
          let failure: string | null = null;
          if (res.timedOut || !res.reply) {
            failure = `timeout`;
          } else if (res.reply.typ === "nak") {
            // Bridge returned `nak <reason>` — engine briefly
            // unavailable, bridge restarting, etc. Worth retrying.
            failure = `nak ${res.reply.arg}`;
          }

          if (failure) {
            lastErr = `page ${page + 1} attempt ${attempt}: ${failure}`;
            if (attempt < MAX_PAGE_RETRIES) {
              await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
              continue;
            }
            aborted = true;
            break;
          }

          // res.reply is non-null and not a nak by this point.
          const parsed = parsePlaylistPatternsPage(res.reply!.arg);
          if (!parsed) {
            // Malformed framing is almost certainly a one-off bit
            // flip; still worth a couple of retries before giving up.
            lastErr = `page ${page + 1} attempt ${attempt}: malformed reply`;
            if (attempt < MAX_PAGE_RETRIES) {
              await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
              continue;
            }
            aborted = true;
            break;
          }

          // Detect a playlist swap MID-FETCH: pages 0..N must agree
          // on the playlist name. If they don't, we're chasing a
          // moving target and should abort cleanly — the operator
          // can retry once the new playlist is settled.
          if (page === 0) {
            resolvedPlaylist = parsed.playlistName;
          } else if (parsed.playlistName !== resolvedPlaylist) {
            lastErr = `playlist changed mid-fetch (${resolvedPlaylist ?? "-"} → ${parsed.playlistName ?? "-"})`;
            aborted = true;
            break;
          }
          for (const name of parsed.patterns) collected.push(name);
          totalCount = parsed.totalCount;
          totalPages = parsed.totalPages;
          pageOk = true;
          if (parsed.pageIndex >= parsed.totalPages - 1) {
            done = true;
          }
          break;
        }

        if (!pageOk) {
          aborted = true;
          break;
        }
      }

      // Hit the safety cap without the bridge marking the last page —
      // that's a misconfigured bridge (e.g. infinite pages). Treat it
      // as an abort rather than a partial success so we don't silently
      // present a clipped catalog.
      if (!aborted && !done) {
        aborted = true;
        lastErr = `gave up after ${MAX_PATTERN_PAGES} pages with no end-of-list marker`;
      }

      const elapsed = Date.now() - fetchStartedAt;

      if (aborted) {
        // ALL-OR-NOTHING: do NOT update patternList. The previous
        // catalog (if any) stays visible so the operator isn't
        // forced to recover from a worse state than they started in.
        setLastReply(
          `PATTERNS  refresh failed after ${MAX_PAGE_RETRIES}× retries` +
            (lastErr ? ` — ${lastErr}` : ""),
        );
        // Surface the failure into the store so the picker header can
        // render a "FAILED · RETRY" pill instead of silently sitting
        // on the previous state. We pass the most informative error
        // available; the UI shortens it to a single line.
        setPatternListError(
          lastErr
            ? `${lastErr.replace(/\s+/g, " ")}`
            : "patterns refresh failed",
        );
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);
        return;
      }

      // Success: COMPLETE catalog scoped to the deck's active
      // playlist (or empty when no playlist is loaded). Always
      // include the playlist name in the wire log + lastReply so
      // the operator can sanity-check the picker scope at a glance.
      //
      // Atomic write: stamp BOTH `patternList` (the live picker
      // contents) AND `patternsByPlaylist[resolvedPlaylist]` (the
      // persistent cache). The setter fire-and-forget persists to
      // AsyncStorage so the next app launch starts hydrated. Cache
      // writes are skipped when the engine had no playlist loaded
      // (`resolvedPlaylist === null`) since there's no key to file
      // the entry under.
      cachePatternsForPlaylist(resolvedPlaylist, {
        patterns: collected,
        truncatedExtra: 0,
        receivedAtMs: Date.now(),
        rawArg: `paged:${collected.length}/${totalCount}:pl=${resolvedPlaylist ?? "-"}`,
      });
      // Clear any stale error pill — the picker is fresh now.
      setPatternListError(null);
      if (collected.length === 0 && !resolvedPlaylist) {
        setLastReply(
          `PATTERNS  no playlist loaded · use DECK PLAYLIST switcher · ${elapsed} ms`,
        );
      } else {
        setLastReply(
          `PATTERNS  ${collected.length} loaded` +
            (resolvedPlaylist ? ` · playlist=${resolvedPlaylist}` : "") +
            ` · ${totalPages} pages · ${elapsed} ms`,
        );
      }
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => undefined);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown");
      setLastReply(`ERROR  patterns query: ${msg}`);
      setPatternListError(msg);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error,
      ).catch(() => undefined);
    } finally {
      setPaginationProgress(null);
      setPatternsLoading(false);
    }
  }, [
    link,
    patternsLoading,
    deckPlaylistSwitching,
    setLastReply,
    setPatternList,
    cachePatternsForPlaylist,
    setPatternsLoading,
    setPatternListError,
  ]);

  // ── Auto-hydrate the pattern picker ───────────────────────────────
  // The previous implementation latched on a `useRef` that flipped
  // true after the first invocation. That worked in dev but had two
  // failure modes in production:
  //
  //   1. The latch was set BEFORE `refresh()` actually ran — if the
  //      first attempt happened before BLE finished its first round-
  //      trip, the qry timed out and we silently never retried.
  //   2. On Fast Refresh / unmount-remount cycles the latch was reset
  //      to `false` only if our cleanup ran, which doesn't always
  //      happen on hot reload.
  //
  // Replaced by a `connectGeneration`-driven trigger: every successful
  // BLE pair bumps the counter in App.tsx, which fires this effect
  // exactly once per real connection. We also re-fire whenever the
  // deck playlist name changes externally (CaptainPad switched, or
  // the engine just finished loading one we asked for).
  //
  // Errors are surfaced via `setPatternListError` (read by the
  // PATTERN PICKER header to render a FAILED · RETRY pill).
  const deckPlaylistName = status?.deckPlaylistName ?? null;
  const lastHydratedPlaylistRef = useRef<string | null>(null);
  const lastHydratedConnRef = useRef<number>(-1);
  // Serial-load gate (see store.ts::playlistsHydratedForConn). The
  // pattern picker only starts hydrating AFTER the playlist library
  // has finished — they used to fire in parallel, which on LoRa
  // means two qry pages racing each other, two pending acks, and
  // the per-page timeout firing on whichever stream got queued
  // behind the other. Now they run back-to-back, eliminating the
  // contention entirely.
  const playlistsHydratedForConn = useAppStore(
    (s) => s.playlistsHydratedForConn,
  );
  useEffect(() => {
    // Skip while a switch is mid-flight — refreshPatterns would
    // race the engine's playlist-load and either NAK or return
    // stale patterns. The PlaylistSwitcher's onSelect chains a
    // refresh once the swap completes (`onSwitched`), so we
    // don't need to drive it from here.
    if (deckPlaylistSwitching) return;
    if (patternsLoading) return;
    if (connectGeneration === 0) return; // not connected yet
    // SERIAL GATE: wait for the playlist library hydration to
    // finish for this connection generation before kicking the
    // pattern-list hydration. PlaylistSwitcher.refresh()'s
    // `finally` block writes this sentinel on both success and
    // failure paths so a transient LoRa drop on the playlists
    // query won't permanently block us.
    if (playlistsHydratedForConn !== connectGeneration) return;
    const newConnection = lastHydratedConnRef.current !== connectGeneration;
    const playlistChanged =
      !newConnection && lastHydratedPlaylistRef.current !== deckPlaylistName;
    if (!newConnection && !playlistChanged) return;
    lastHydratedConnRef.current = connectGeneration;
    lastHydratedPlaylistRef.current = deckPlaylistName;
    refreshPatterns().catch(() => undefined);
  }, [
    connectGeneration,
    deckPlaylistName,
    deckPlaylistSwitching,
    patternsLoading,
    refreshPatterns,
    playlistsHydratedForConn,
  ]);

  const onPatternSelect = useCallback(
    async (name: string) => {
      // Optimistic UI: flip the highlight + ACTIVE PATTERN row
      // before sending. The intent is reconciled (and dropped) when
      // the next compact PUB carries `pat/<name>` matching this
      // value — see store.setEngineStatus.
      intendActivePattern(name);
      setPatternBusy(name);
      Haptics.selectionAsync().catch(() => undefined);
      try {
        const res = await link.sendOp(buildPatternOp(name), { timeoutMs: 8_000 });
        toastReply(setLastReply, res, `PATTERN ${name}`);
        if (!res.timedOut) {
          // Kick a status query so the PUB lands faster than the
          // bridge's WS-driven broadcast cadence (which is already
          // sub-second, but the explicit qry path is bound by a 6 s
          // timeout instead of the publisher's 5 s sleep). Worst
          // case the reply just races the WS-triggered PUB and one
          // wins — both carry the new `pat/<name>`, so reconciliation
          // is idempotent.
          link
            .sendOp(buildStatusQuery(), { timeoutMs: 6_000 })
            .catch(() => undefined);
        }
      } finally {
        setPatternBusy(null);
        // Resolve only the pending flag — leave the value in place so
        // the row stays highlighted until the PUB lands and clears
        // the intent entirely. (See store.setEngineStatus reconciler.)
        markIntentResolved("activePattern");
      }
    },
    [link, intendActivePattern, markIntentResolved, setLastReply],
  );

  const onOverrideToggle = useCallback(
    async (next: boolean) => {
      intendViewOverride(next);
      Haptics.impactAsync(
        next
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light,
      ).catch(() => undefined);
      try {
        const res = await link.sendOp(
          buildViewOverrideOp(next ? "deck" : "clear"),
          { timeoutMs: 6_000 },
        );
        toastReply(
          setLastReply,
          res,
          next ? "DECK OVERRIDE ON" : "DECK OVERRIDE CLEARED",
        );
        // Same status-kick rationale as pattern selection: cuts the
        // "did it take?" window from "next periodic PUB" to "next
        // status reply".
        if (!res.timedOut) {
          link
            .sendOp(buildStatusQuery(), { timeoutMs: 6_000 })
            .catch(() => undefined);
        }
      } finally {
        markIntentResolved("viewOverride");
      }
    },
    [link, intendViewOverride, markIntentResolved, setLastReply],
  );

  // Pattern selection on PortWatch is allowed when:
  //   1. The engine is on (or pinned to) the deck view, AND
  //   2. Autopilot is OFF — manual taps fight the autopilot stepper
  //      otherwise.
  // Refresh + viewing the catalog are always allowed regardless of
  // override / autopilot state — operators need the list to plan the
  // next cue even when they're not the one driving.
  // Disable manual pattern selection while a playlist swap is in
  // flight too — tapping a pattern row during the swap would race
  // the engine's `loadPlaylistEntry` and almost certainly leave us
  // on the wrong cursor inside the new playlist.
  const patternsManualEnabled =
    canControlDeck && !autopilotValue && !deckPlaylistSwitching;

  return (
    <Card title="DECK" accent={C.pattern}>
      {/* ── Override gate ──────────────────────────────────────────
          The gate is a STRICT 4-state machine driven by:
            engineStatus  (null = "we have no idea what view we're in")
            engineView    ("deck" | "mixer" | null)
            viewOverrideActive  (true = PortWatch holds the lock)

          We must NEVER guess. Until the engine status arrives over
          LoRa, every card below stays disabled and the operator
          sees an explicit "WAITING FOR ENGINE STATE" tile instead of
          the "DECK ACTIVE / TAKE LOCK" row that the previous code
          fell through to when status was null. That fallback was the
          bug behind "I put the engine on mixer, opened PortWatch and
          it shows deck controls" — the UI was painting a deck card
          before any PUB had landed.

          State precedence (highest first so the renderer's chain is
          obvious to a code reviewer):
            1. status === null              →  WAITING (no actions)
            2. viewOverrideActive           →  OVERRIDE ACTIVE + RELEASE
            3. engineView === "mixer"       →  MIXER MODE + TAKE OVERRIDE
            4. engineView === "deck"        →  DECK ACTIVE + TAKE LOCK
            5. engineView === null otherwise→  UNKNOWN VIEW warning */}
      {!status ? (
        <View style={styles.waitingForStateBox}>
          <ActivityIndicator color={C.pattern} />
          <View style={{ flex: 1 }}>
            <Text style={styles.waitingForStateTitle}>
              WAITING FOR ENGINE STATE
            </Text>
            <Text style={styles.waitingForStateSub}>
              LoRa is slow on first connect · holding controls until the
              bridge sends a snapshot
            </Text>
          </View>
        </View>
      ) : viewOverrideActive ? (
        <View style={styles.overrideActiveBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.overrideActiveTitle}>DECK OVERRIDE ACTIVE</Text>
            <Text style={styles.overrideActiveSub}>
              {controlLockOwner === "portwatch" && controlLockLeaseRemainSec > 0
                ? `engine pinned · lease ${controlLockLeaseRemainSec}s · auto-renewing`
                : "engine pinned to deck · CaptainPad sees a warning"}
            </Text>
          </View>
          <Pressable
            onPress={() => onOverrideToggle(false)}
            disabled={viewOverridePending}
            style={({ pressed }) => [
              styles.overrideReleaseBtn,
              pressed && { opacity: 0.7 },
              viewOverridePending && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.overrideReleaseText}>RELEASE</Text>
          </Pressable>
        </View>
      ) : engineView === "mixer" ? (
        <Pressable
          onPress={() => onOverrideToggle(true)}
          disabled={viewOverridePending}
          style={({ pressed }) => [
            styles.overrideTakeBtn,
            pressed && { opacity: 0.7 },
            viewOverridePending && { opacity: 0.5 },
          ]}
        >
          <Text style={styles.overrideTakeTitle}>MIXER MODE · TAKE OVERRIDE</Text>
          <Text style={styles.overrideTakeSub}>
            engine is on MIXER view · controls below are locked until you take the deck
          </Text>
        </Pressable>
      ) : engineView === "deck" ? (
        // Engine is naturally on deck and nobody has the lock. Pattern
        // changes work without an override (CaptainPad and PortWatch
        // can both write), but the operator can still TAKE the lock
        // here to freeze CaptainPad and own the deck exclusively.
        <View style={styles.deckActiveBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deckActiveTitle}>DECK ACTIVE</Text>
            <Text style={styles.deckActiveSub}>
              engine on deck · CaptainPad can also edit
            </Text>
          </View>
          <Pressable
            onPress={() => onOverrideToggle(true)}
            disabled={viewOverridePending}
            style={({ pressed }) => [
              styles.deckTakeLockBtn,
              pressed && { opacity: 0.7 },
              viewOverridePending && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.deckTakeLockText}>TAKE LOCK</Text>
          </Pressable>
        </View>
      ) : (
        // Status is set but `vw` was missing or unknown. Don't fall
        // back to a deck affordance — that's exactly the false-positive
        // we're trying to avoid. Tell the operator what we see and
        // keep everything below disabled.
        <View style={styles.waitingForStateBox}>
          <Text style={styles.waitingForStateTitle}>UNKNOWN ENGINE VIEW</Text>
          <Text style={styles.waitingForStateSub}>
            engine status arrived without a recognised view · controls
            stay disabled until next snapshot
          </Text>
        </View>
      )}

      <Toggle
        label="AUTOPILOT"
        sub={
          !status
            ? "waiting for engine state…"
            : !canControlDeck
              ? "locked · take override to enable"
              : autopilotValue
                ? "rotating patterns"
                : "manual control"
        }
        value={autopilotValue}
        pending={autopilotPending}
        onChange={onAutopilot}
        accent={C.autopilot}
        disabled={!canControlDeck}
      />
      <StepperBar<number>
        label="AUTOPILOT INTERVAL"
        unit="seconds"
        values={[...AUTOPILOT_INTERVAL_PRESETS]}
        current={autopilotInterval}
        onChange={onIntervalChange}
        pending={autopilotIntervalPending}
        accent={C.autopilot}
        disabled={!canControlDeck || !autopilotValue}
      />
      <View style={styles.disabledRow}>
        <Text style={styles.disabledLabel}>TRANSITIONS</Text>
        <Text style={styles.disabledHint}>
          Coming soon — bridge command not wired yet.
        </Text>
      </View>

      <View style={styles.activePatternBox}>
        <Text style={styles.activePatternLabel}>
          ACTIVE PATTERN{activePatternPending ? " · sending…" : ""}
        </Text>
        <Text style={styles.activePatternValue} numberOfLines={1}>
          {activePattern ?? (status ? "—" : "waiting for engine state…")}
        </Text>
      </View>

      {/* Playlist switcher. Sits above the pattern picker because
          switching the playlist invalidates the picker (the engine
          loads a new pattern from the new playlist's first entry).
          We refresh the pattern list automatically on switch so the
          operator never has to remember to chain the two actions. */}
      <PlaylistSwitcher link={link} canControl={canControlDeck} onSwitched={refreshPatterns} />

      <View style={styles.patternsHeader}>
        <Text style={[styles.patternsTitle, { color: C.pattern }]}>
          PATTERN PICKER
        </Text>
        <Pressable
          onPress={() => {
            // Unified REFRESH-WORLD: one press rebuilds the operator's
            // ENTIRE persistent local snapshot — playlist library +
            // every playlist's pattern list — and stamps the snapshot
            // timestamp. The action persists each slice as it lands
            // so a mid-flight BLE drop still leaves the cache durable
            // up to the last-completed playlist.
            //
            // Operators asked for "one button refreshes everything"
            // because the previous design (per-card REFRESH buttons)
            // required them to remember which one to tap; this one
            // covers both the picker and the playlist switcher in a
            // single press. Subsequent CaptainPad-driven playlist
            // switches then render INSTANTLY from the prefilled cache
            // (see `setEngineStatus`).
            void rebuildWorld(link).then((result) => {
              setLastReply(result.summary);
            });
          }}
          // Disable while the unified rebuild is in flight OR a per-
          // playlist load OR a swap is happening — the rebuild
          // shares the LoRa link with all of them and stacking would
          // produce interleaved page fetches.
          disabled={
            worldRebuildInProgress || patternsLoading || deckPlaylistSwitching
          }
          style={({ pressed }) => [
            styles.refreshBtn,
            pressed && { opacity: 0.7 },
            (worldRebuildInProgress || patternsLoading || deckPlaylistSwitching) && {
              opacity: 0.5,
            },
          ]}
        >
          <Text style={styles.refreshBtnText}>
            {worldRebuildInProgress
              ? "REBUILDING…"
              : patternsLoading
                ? "LOADING…"
                : deckPlaylistSwitching
                  ? "SWITCHING…"
                  : "REFRESH"}
          </Text>
        </Pressable>
      </View>

      {snapshotBuiltAtMs !== null && !worldRebuildInProgress && (
        // Surface the snapshot age so the operator knows whether the
        // displayed library is days-old or seconds-old. "fresh" means
        // less than 60 s; we keep it lightweight (no live ticking) by
        // sampling on render — close enough for an info hint.
        <Text style={styles.snapshotFreshness}>
          local snapshot · {_formatRelative(snapshotBuiltAtMs)}
        </Text>
      )}

      {patternsLoading && paginationProgress && (
        <View style={styles.progressRow}>
          <ActivityIndicator color={C.pattern} size="small" />
          <Text style={styles.progressText}>
            page {paginationProgress.page} of {paginationProgress.total}
            {paginationProgress.attempt > 1
              ? ` · retry ${paginationProgress.attempt}/${MAX_PAGE_RETRIES}`
              : ""}
          </Text>
        </View>
      )}

      {patternsLoading && !patternList ? (
        // First-load spinner: there's no previous catalog to keep
        // visible, so render an explicit Loading row instead of the
        // "Tap REFRESH" hint that would mislead the operator into
        // thinking the picker is idle.
        <View style={styles.cardLoadingRow}>
          <ActivityIndicator color={C.pattern} size="small" />
          <Text style={styles.patternsHint}>
            Loading patterns from engine over LoRa…
          </Text>
        </View>
      ) : patternListError && !patternList ? (
        // Auto-hydrate aborted and we have nothing to show. Surface
        // the error + a manual RETRY button. We deliberately do NOT
        // hide this when patternList is non-null — a previous
        // catalog stays visible (per the all-or-nothing contract);
        // the error just goes into the wire log instead.
        <View style={styles.cardErrorBox}>
          <Text style={styles.cardErrorTitle}>PATTERNS FAILED TO LOAD</Text>
          <Text style={styles.cardErrorSub} numberOfLines={2}>
            {patternListError}
          </Text>
          <Pressable
            onPress={() => {
              const active =
                useAppStore.getState().engineStatus?.deckPlaylistName ?? null;
              if (active) invalidatePatternsCache(active);
              refreshPatterns({ force: true }).catch(() => undefined);
            }}
            disabled={patternsLoading || deckPlaylistSwitching}
            style={({ pressed }) => [
              styles.cardErrorRetryBtn,
              pressed && { opacity: 0.7 },
              (patternsLoading || deckPlaylistSwitching) && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.cardErrorRetryText}>RETRY</Text>
          </Pressable>
        </View>
      ) : !patternList ? (
        <Text style={styles.patternsHint}>
          Tap REFRESH to pull the engine&apos;s pattern list over LoRa.
        </Text>
      ) : (
        <PatternList
          patterns={patternList.patterns}
          truncatedExtra={patternList.truncatedExtra}
          activePattern={activePattern}
          busyPattern={patternBusy}
          disabled={!patternsManualEnabled}
          onSelect={onPatternSelect}
        />
      )}
    </Card>
  );
}

function PatternList({
  patterns,
  truncatedExtra,
  activePattern,
  busyPattern,
  disabled,
  onSelect,
}: {
  patterns: string[];
  truncatedExtra: number;
  activePattern: string | null;
  busyPattern: string | null;
  disabled: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <View>
      {/*
        Fixed-height viewport with internal scroll. Limits the deck card
        to a sane height even with 40+ patterns; scrollEnabled is on by
        default. We use a plain ScrollView (not FlatList) because the
        rows are tiny and we never expect catalogues over a few hundred
        names — virtualisation overhead would cost more than it saves.
        nestedScrollEnabled lets this work inside the outer ScrollView
        without the gesture being captured at the wrong layer.
      */}
      <View style={styles.patternListBox}>
        <ScrollView
          style={{ maxHeight: PATTERN_LIST_HEIGHT }}
          contentContainerStyle={styles.patternListContent}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          {patterns.length === 0 && (
            <Text style={styles.patternsHint}>
              Engine returned an empty list.
            </Text>
          )}
          {patterns.map((name) => {
            const active = name === activePattern;
            const busy = name === busyPattern;
            return (
              <Pressable
                key={name}
                disabled={disabled || busyPattern !== null}
                onPress={() => onSelect(name)}
                style={({ pressed }) => [
                  styles.patternRow,
                  active && {
                    borderColor: C.pattern,
                    backgroundColor: C.pattern + "26",
                  },
                  pressed && !disabled && { opacity: 0.7 },
                  disabled && { opacity: 0.5 },
                  busy && { opacity: 0.6 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.patternName,
                      { color: active ? C.pattern : C.text },
                    ]}
                    numberOfLines={1}
                  >
                    {prettyPattern(name)}
                  </Text>
                  <Text style={styles.patternRaw} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                {active && <Text style={styles.patternActiveBadge}>LIVE</Text>}
                {busy && <ActivityIndicator color={C.pattern} size="small" />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {truncatedExtra > 0 && (
        <Text style={styles.patternsHint}>
          Catalog incomplete: {truncatedExtra} more not loaded. Try
          REFRESH again.
        </Text>
      )}
      {disabled && (
        <Text style={styles.patternsHint}>
          Disable autopilot to pick a pattern manually.
        </Text>
      )}
    </View>
  );
}

function prettyPattern(name: string): string {
  return name.replace(/^\d+_/, "").replace(/[_-]/g, " ");
}

// ── PLAYLIST SWITCHER ──────────────────────────────────────────────
//
// Read-only picker for the deck base channel's active playlist.
//
// Edit/create flows intentionally live ONLY on CaptainPad — the LoRa
// surface is for switching, not for content authoring (the playlist
// edit flow needs the full PlaylistManager API which doesn't fit in
// a couple of frame args).
//
// On a successful switch we kick off a fresh pattern-picker refresh
// because the engine reloads the playlist's first usable entry — the
// previous picker rows would still SHOW, but their CRC32 ids are
// stale relative to the new playlist's entry ids. Refreshing gives
// the operator a coherent view in one tap.

function PlaylistSwitcher({
  link,
  canControl,
  onSwitched,
}: {
  link: TitanicLink;
  canControl: boolean;
  onSwitched: () => Promise<void> | void;
}) {
  const intent = useAppStore((s) => s.intent);
  // engineStatus.deckPlaylistName is updated continuously from every
  // compact-status PUB (every CaptainPad/engine-side playlist swap
  // triggers a `mixer` WS event → bridge republishes → fresh PUB).
  // We prefer it over the one-shot `deckPlaylist` qry result because:
  //   1. It populates from the FIRST PUB after BLE pair, so the LIVE
  //      chip lights up even when the explicit `deck/playlist` qry
  //      hasn't replied yet (or failed silently over LoRa).
  //   2. It stays in sync when CaptainPad changes the deck playlist
  //      mid-show without any extra subscription work here.
  // The local `deckPlaylist` field is still kept as a secondary
  // source so a deliberate refresh can override (e.g. operator just
  // tapped REFRESH and we want the freshly-fetched name to win
  // immediately rather than wait for the next PUB).
  const engineDeckPlaylistName = useAppStore(
    (s) => s.engineStatus?.deckPlaylistName ?? null,
  );
  const playlistLibrary = useAppStore((s) => s.playlistLibrary);
  const playlistLibraryLoading = useAppStore((s) => s.playlistLibraryLoading);
  const playlistLibraryError = useAppStore((s) => s.playlistLibraryError);
  const setPlaylistLibrary = useAppStore((s) => s.setPlaylistLibrary);
  const setPlaylistLibraryLoading = useAppStore((s) => s.setPlaylistLibraryLoading);
  const setPlaylistLibraryError = useAppStore((s) => s.setPlaylistLibraryError);
  const deckPlaylist = useAppStore((s) => s.deckPlaylist);
  const setDeckPlaylist = useAppStore((s) => s.setDeckPlaylist);
  const deckPlaylistSwitching = useAppStore((s) => s.deckPlaylistSwitching);
  const setDeckPlaylistSwitching = useAppStore(
    (s) => s.setDeckPlaylistSwitching,
  );
  const patternsLoading = useAppStore((s) => s.patternsLoading);
  const setLastReply = useAppStore((s) => s.setLastReply);
  const intendDeckPlaylist = useAppStore((s) => s.intendDeckPlaylist);
  const markIntentResolved = useAppStore((s) => s.markIntentResolved);
  const connectGeneration = useAppStore((s) => s.connectGeneration);
  // Serial-load gate: opens once playlists are hydrated (success or
  // fail) so the deck card's patterns auto-hydration can proceed.
  const markPlaylistsHydrated = useAppStore((s) => s.markPlaylistsHydrated);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (playlistLibraryLoading) return;
    const force = opts?.force === true;

    // ── Persistent cache short-circuit ──────────────────────────
    // Plain "do we have a library cached at all?" check. The
    // library was hydrated from AsyncStorage on app start so a
    // fresh launch already has it. Only the REFRESH button (force)
    // or a never-seen-before install (cache empty) triggers a
    // paginated LoRa fetch.
    //
    // This is the headline of the cache redesign: no hashes, no
    // server-driven invalidation. Until the operator explicitly
    // says "fetch me a fresh list", the cache is the truth.
    const currentLibrary = useAppStore.getState().playlistLibrary;
    if (!force && currentLibrary !== null && currentLibrary.length > 0) {
      setLastReply(
        `PLAYLISTS  ${currentLibrary.length} cached · HIT (tap REFRESH to refetch)`,
      );
      // Open the serial gate so the pattern picker doesn't wait
      // forever. The patterns picker still hydrates per-playlist
      // (a different cache key) so we're not free-riding on this
      // cache for those.
      markPlaylistsHydrated(connectGeneration);
      return;
    }

    setPlaylistLibraryLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    const collected: string[] = [];
    let totalPages = 1;
    let aborted = false;
    let lastErr: string | null = null;

    try {
      let done = false;
      const PLAYLIST_PAGE_TIMEOUT = PAGE_TIMEOUT_MS;
      const MAX_PLAYLIST_PAGES = MAX_PATTERN_PAGES;
      for (let page = 0; page < MAX_PLAYLIST_PAGES && !done; page++) {
        let pageOk = false;
        for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
          const res = await link.sendOp(buildPlaylistsPageQuery(page), {
            timeoutMs: PLAYLIST_PAGE_TIMEOUT,
          });
          let failure: string | null = null;
          if (res.timedOut || !res.reply) failure = "timeout";
          else if (res.reply.typ === "nak") failure = `nak ${res.reply.arg}`;
          if (failure) {
            lastErr = `page ${page + 1} attempt ${attempt}: ${failure}`;
            if (attempt < MAX_PAGE_RETRIES) {
              await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
              continue;
            }
            aborted = true;
            break;
          }
          const parsed = parsePlaylistsPage(res.reply!.arg);
          if (!parsed) {
            lastErr = `page ${page + 1} attempt ${attempt}: malformed reply`;
            if (attempt < MAX_PAGE_RETRIES) {
              await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
              continue;
            }
            aborted = true;
            break;
          }
          for (const n of parsed.playlists) collected.push(n);
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
        lastErr = `gave up after ${MAX_PATTERN_PAGES} pages`;
      }
      if (aborted) {
        setLastReply(`PLAYLISTS  refresh failed${lastErr ? ` — ${lastErr}` : ""}`);
        // Surface to the store so the FAILED · RETRY pill in the
        // switcher header lights up (the operator otherwise has no
        // way to know that auto-hydrate aborted on a slow first
        // connect — they'd just see "Loading…" forever).
        setPlaylistLibraryError(
          lastErr ? `${lastErr.replace(/\s+/g, " ")}` : "playlists refresh failed",
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => undefined,
        );
        return;
      }
      // Atomic cache update: write the library and let the setter
      // fire-and-forget persist to AsyncStorage. The next app launch
      // hydrates from disk so a returning operator skips this fetch
      // entirely.
      setPlaylistLibrary(collected);
      setPlaylistLibraryError(null);
      setLastReply(
        `PLAYLISTS  ${collected.length} loaded · ${totalPages} pages`,
      );
      // Also fetch the live deck playlist so the highlight is correct
      // immediately after refresh — without this, the operator would
      // see the rows but not know which one was already loaded.
      try {
        const dRes = await link.sendOp(buildDeckPlaylistQuery(), {
          timeoutMs: PAGE_TIMEOUT_MS,
        });
        if (!dRes.timedOut && dRes.reply && dRes.reply.typ !== "nak") {
          setDeckPlaylist(parseDeckPlaylist(dRes.reply.arg));
        }
      } catch {
        // Ignore; the highlight will resolve on the next switch attempt.
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } finally {
      setPlaylistLibraryLoading(false);
      // Open the SERIAL GATE so the pattern picker can start its
      // own hydration now. We do this in `finally` so a failed
      // playlist load still releases the gate — otherwise a
      // transient LoRa failure on the playlists query would
      // permanently block the patterns picker for this connection
      // (and the operator's manual REFRESH-the-picker recovery
      // wouldn't help because the effect would never re-fire).
      markPlaylistsHydrated(connectGeneration);
    }
  }, [
    link,
    playlistLibraryLoading,
    setPlaylistLibrary,
    setPlaylistLibraryLoading,
    setPlaylistLibraryError,
    setDeckPlaylist,
    setLastReply,
    connectGeneration,
    markPlaylistsHydrated,
  ]);

  // ── Auto-hydrate on (re)connect ───────────────────────────────────
  // Driven by `connectGeneration` instead of mount lifecycle. The
  // counter bumps in App.tsx::onConnect AFTER BLE is fully paired
  // and setConn fires.
  //
  // `refresh()` checks the persistent cache first — if we have a
  // library list, it's a HIT (zero LoRa frames) and the serial
  // gate opens so the pattern picker can hydrate next. If the
  // cache is empty (fresh install, never seen this rig before)
  // we paginate over LoRa exactly once and persist the result.
  //
  // No auto-rehydrate on engine mutation: the user explicitly
  // asked for "unless I press refresh, don't change the pattern
  // list anymore". Engine-side library changes (add / delete a
  // playlist on CaptainPad) won't show up here until the operator
  // taps REFRESH.
  const lastHydratedConnRef = useRef<number>(-1);
  useEffect(() => {
    if (connectGeneration === 0) return; // not connected yet
    if (lastHydratedConnRef.current === connectGeneration) return;
    if (playlistLibraryLoading) return;
    lastHydratedConnRef.current = connectGeneration;
    refresh().catch(() => undefined);
  }, [connectGeneration, playlistLibraryLoading, refresh]);

  const onSelect = useCallback(
    async (name: string) => {
      // setDeckPlaylistSwitching gates BOTH the playlist chips (here)
      // and the pattern REFRESH button (in DeckCard) so the operator
      // can't issue a second switch or a manual refresh while the
      // engine is still reloading. We always clear the flag in the
      // finally block so a thrown error never strands the UI in a
      // permanently-disabled state.
      setDeckPlaylistSwitching(true);
      intendDeckPlaylist(name);
      try {
        const res = await link.sendOp(buildPlaylistOp(name));
        toastReply(setLastReply, res, `PLAYLIST ${name}`);
        if (!res.timedOut && res.reply && res.reply.typ !== "nak") {
          // Eager confirmation — record the new deck playlist
          // BEFORE the LoRa pub catches up so the highlight feels
          // instant even at the worst LoRa latencies. The next pub
          // will overwrite this with the canonical engine state
          // anyway.
          setDeckPlaylist({ name, entryId: null, rawArg: `local:${name}` });

          // Pull a FRESH engine-status REP so `engineStatus`
          // (deckPlaylistName + playlistPatternsHash) reflects the
          // NEW playlist before refreshPatterns runs its cache
          // check. Without this gate refreshPatterns would compare
          // the NEW playlist's cache against the OLD playlist's
          // `pph` and either falsely HIT the old cache or
          // refuse-to-hit a perfectly-fresh new cache — the same
          // stale-hash race that motivated `pph`'s introduction.
          //
          // We `await` the REP (not just its dispatch) so the wire
          // event handler in App.tsx has called
          // `setEngineStatus(newStatus)` by the time refreshPatterns
          // reads off the store. Failure here is recoverable: the
          // periodic PUB will catch up within `long_interval_s`,
          // and refreshPatterns falls back to paginated fetch on
          // any cache lookup we can't conclude.
          try {
            await link.sendOp(buildStatusQuery(), { timeoutMs: 4_000 });
          } catch {
            // Best-effort — refreshPatterns owns the retry path.
          }
        }
        markIntentResolved("deckPlaylist");
        // Always refresh patterns after a switch — even on a failed
        // switch the operator probably wants to confirm what's
        // loaded. We `await` so the SWITCHING… label stays on the
        // chip + the pattern refresh button until the engine has
        // returned the new playlist's entries.
        try {
          await onSwitched();
        } catch {
          // refreshPatterns owns its own error toast.
        }
      } finally {
        setDeckPlaylistSwitching(false);
      }
    },
    [
      link,
      intendDeckPlaylist,
      markIntentResolved,
      setDeckPlaylist,
      setDeckPlaylistSwitching,
      setLastReply,
      onSwitched,
    ],
  );

  // LIVE-chip resolution chain (highest priority first):
  //   1. Local pending intent — the operator just tapped a chip; show
  //      THAT name as LIVE until the engine confirms or rejects.
  //   2. Most recent compact PUB (`engineStatus.deckPlaylistName`) —
  //      continuously updated, including external CaptainPad swaps.
  //   3. One-shot qry `deck/playlist` result — only relevant before
  //      the first PUB lands; covered by (2) on every connect.
  const activeName =
    intent.deckPlaylist?.value ??
    engineDeckPlaylistName ??
    deckPlaylist?.name ??
    null;
  const switchPending = intent.deckPlaylist?.pending ?? false;
  // While a swap (or the chained pattern refresh) is in flight, ALL
  // chips are disabled — clicking a different one would queue an
  // overlapping switch and confuse the engine + the operator. The
  // PlaylistSwitcher's own REFRESH button is also disabled because
  // a library refresh would race the swap reply too.
  const switchingNow = deckPlaylistSwitching || patternsLoading;

  return (
    <View>
      <View style={styles.patternsHeader}>
        <Text style={[styles.patternsTitle, { color: C.pattern }]}>
          DECK PLAYLIST
          {switchPending
            ? " · sending…"
            : deckPlaylistSwitching
              ? " · switching…"
              : ""}
        </Text>
        <Pressable
          // Manual REFRESH always bypasses the cache (force: true).
          // The operator tapped a button labelled REFRESH — they
          // explicitly want a fresh round-trip, usually because
          // they suspect the cache is wrong. Auto-hydration on
          // reconnect omits the flag and gets the cache hit path.
          onPress={() => refresh({ force: true })}
          disabled={playlistLibraryLoading || switchingNow}
          style={({ pressed }) => [
            styles.refreshBtn,
            pressed && { opacity: 0.7 },
            (playlistLibraryLoading || switchingNow) && { opacity: 0.5 },
          ]}
        >
          <Text style={styles.refreshBtnText}>
            {playlistLibraryLoading
              ? "REFRESHING…"
              : switchingNow
                ? "SWITCHING…"
                : "REFRESH"}
          </Text>
        </Pressable>
      </View>
      {playlistLibraryLoading && playlistLibrary === null ? (
        // First-load spinner: we have nothing to show, and a fetch is
        // in flight from auto-hydrate. Operator sees "Loading…" with
        // an inline spinner instead of a deceptive empty list.
        <View style={styles.cardLoadingRow}>
          <ActivityIndicator color={C.pattern} size="small" />
          <Text style={styles.patternsHint}>
            Loading playlists from engine over LoRa…
          </Text>
        </View>
      ) : playlistLibraryError && playlistLibrary === null ? (
        // Auto-hydrate aborted (timeout / nak after retries) and we
        // never had a previous catalog. Show the failure + a manual
        // RETRY pill so the operator can recover without restarting
        // the app.
        <View style={styles.cardErrorBox}>
          <Text style={styles.cardErrorTitle}>PLAYLISTS FAILED TO LOAD</Text>
          <Text style={styles.cardErrorSub} numberOfLines={2}>
            {playlistLibraryError}
          </Text>
          <Pressable
            // Error-state RETRY also forces — the previous attempt
            // failed, the cache is empty / stale, retry into a real
            // fetch instead of silently hitting the cache miss path
            // again on the next render.
            onPress={() => refresh({ force: true })}
            disabled={playlistLibraryLoading}
            style={({ pressed }) => [
              styles.cardErrorRetryBtn,
              pressed && { opacity: 0.7 },
              playlistLibraryLoading && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.cardErrorRetryText}>RETRY</Text>
          </Pressable>
        </View>
      ) : playlistLibrary === null ? (
        // Initial unprimed state — only reachable in dev (we
        // bumpConnectGeneration on every connect). Keep the manual-
        // refresh hint as a safety net.
        <Text style={styles.patternsHint}>
          Tap REFRESH to load the engine&apos;s saved playlists over LoRa.
        </Text>
      ) : playlistLibrary.length === 0 ? (
        <Text style={styles.patternsHint}>
          Engine has no saved playlists.
        </Text>
      ) : (
        <View style={styles.playlistRow}>
          {playlistLibrary.map((name) => {
            const active = name === activeName;
            const sending = switchPending && intent.deckPlaylist?.value === name;
            const disabled = !canControl || sending || switchingNow;
            return (
              <Pressable
                key={name}
                disabled={disabled}
                onPress={() => onSelect(name)}
                style={({ pressed }) => [
                  styles.playlistChip,
                  active && {
                    borderColor: C.pattern,
                    backgroundColor: C.pattern + "26",
                  },
                  pressed && !disabled && { opacity: 0.7 },
                  disabled && { opacity: 0.5 },
                ]}
              >
                <Text
                  style={[
                    styles.playlistChipLabel,
                    { color: active ? C.pattern : C.text },
                  ]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                {sending && <ActivityIndicator size="small" color={C.pattern} />}
                {active && !sending && (
                  <Text style={styles.playlistChipBadge}>LIVE</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
      {!canControl && playlistLibrary !== null && playlistLibrary.length > 0 && (
        <Text style={styles.patternsHint}>
          Take the deck override (above) to switch playlists from PortWatch.
        </Text>
      )}
    </View>
  );
}

// ── GLOBAL FX ───────────────────────────────────────────────────────

function GlobalFxCard({ link }: { link: TitanicLink }) {
  const intent = useAppStore((s) => s.intent);
  const setLastReply = useAppStore((s) => s.setLastReply);
  const intendFx = useAppStore((s) => s.intendFx);
  const markIntentResolved = useAppStore((s) => s.markIntentResolved);

  const onFxToggle = useCallback(
    (name: string) => async (next: boolean) => {
      intendFx(name, next);
      try {
        const res = await link.sendOp(buildFxOp(name, next));
        toastReply(setLastReply, res, `FX ${name} ${next ? "ON" : "OFF"}`);
      } finally {
        markIntentResolved(`fx:${name}`);
      }
    },
    [link, intendFx, markIntentResolved, setLastReply],
  );

  return (
    <Card title="GLOBAL FX" accent={C.fx}>
      {STATEFUL_FX_MACROS.map((m) => {
        const fxState = intent.fxStates[m.name];
        const value = fxState?.value ?? false;
        const pending = fxState?.pending ?? false;
        return (
          <Toggle
            key={m.name}
            label={m.label}
            sub={`fx/${m.name}`}
            value={value}
            pending={pending}
            onChange={onFxToggle(m.name)}
            accent={C.fx}
          />
        );
      })}
    </Card>
  );
}

// ── HORN (DISABLED) ─────────────────────────────────────────────────
//
// Promoted out of the GLOBAL FX card so its disabled state is unmistakable
// and so future wiring (a momentary press-and-hold control) can land
// cleanly without re-shuffling the GLOBAL FX list.

function HornCard() {
  return (
    <Card
      title="HORN"
      accent={C.horn}
      badge="DISABLED"
      badgeColor={C.horn}
      disabled
    >
      <Toggle
        label="HORN"
        sub="momentary · awaiting wire-up"
        value={false}
        accent={C.horn}
        momentary
        onChange={() => undefined}
        disabled
      />
      <Text style={styles.disabledNote}>
        Horn is intentionally not on the LoRa control surface yet —
        the engine doesn&apos;t echo horn state in its status pub, so a
        live momentary button without feedback was rejected. Re-enable
        once the engine surfaces a `hrn/` field.
      </Text>
    </Card>
  );
}

// ── PYRO (DISABLED) ─────────────────────────────────────────────────

function PyroCard() {
  return (
    <Card
      title="PYRO"
      accent={C.pyro}
      badge="DISABLED"
      badgeColor={C.pyro}
      disabled
    >
      <Toggle
        label="PYRO"
        sub="momentary · safety-isolated"
        value={false}
        accent={C.pyro}
        momentary
        onChange={() => undefined}
        disabled
      />
      <Text style={styles.disabledNote}>
        The flame-effect bus is intentionally not exposed over LoRa —
        the bridge HARD-rejects every fire/* command regardless of role.
        See docs/21_portwatch_monitor.md §4.3.
      </Text>
    </Card>
  );
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
  scroll: {
    paddingVertical: S.md,
  },
  column: {
    gap: S.md,
  },
  disabledRow: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.pill * 1.5,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    opacity: 0.5,
    gap: 2,
  },
  disabledLabel: {
    color: C.textDim,
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  disabledHint: {
    color: C.textMuted,
    fontSize: F.micro,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  // ── Override / deck-active rows ─────────────────────────────────
  // Three visual states sit at the top of the deck card; styling
  // makes the safety semantics readable from across a stage:
  //   • TAKE OVERRIDE  — amber/red, prompts action ("you're locked")
  //   • DECK OVERRIDE ACTIVE — solid pattern accent, you OWN the deck
  //   • DECK ACTIVE — subtle, the engine is naturally on deck
  //   • WAITING FOR ENGINE STATE — muted neutral, no actionable
  //       affordance, paired with a spinner so the operator can see
  //       PortWatch is intentionally holding back instead of broken.
  waitingForStateBox: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
  },
  waitingForStateTitle: {
    color: C.text,
    fontSize: F.body,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  waitingForStateSub: {
    color: C.textMuted,
    fontSize: F.micro,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  overrideTakeBtn: {
    backgroundColor: C.cardSunken,
    borderColor: C.blackout,
    borderWidth: 1.5,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    gap: 2,
    alignItems: "center",
  },
  overrideTakeTitle: {
    color: C.blackout,
    fontSize: F.body,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  overrideTakeSub: {
    color: C.textMuted,
    fontSize: F.micro,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  overrideActiveBox: {
    backgroundColor: C.pattern + "1A",
    borderColor: C.pattern,
    borderWidth: 1.5,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
  },
  overrideActiveTitle: {
    color: C.pattern,
    fontSize: F.body,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  overrideActiveSub: {
    color: C.textMuted,
    fontSize: F.micro,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  overrideReleaseBtn: {
    backgroundColor: C.cardSunken,
    borderColor: C.pattern,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
  },
  overrideReleaseText: {
    color: C.pattern,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  deckActiveBox: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    gap: S.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  // Compact "TAKE LOCK" pill — visually quieter than the full-width
  // TAKE OVERRIDE button (engine is already on deck, so the action is
  // "lock CaptainPad out", not "redirect the engine"). Same accent
  // colour as the active-override release pill so the override
  // family of controls reads as one set.
  deckTakeLockBtn: {
    backgroundColor: C.pattern,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
  },
  deckTakeLockText: {
    color: C.bg,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  deckActiveTitle: {
    color: C.text,
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  deckActiveSub: {
    color: C.textMuted,
    fontSize: F.micro,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  activePatternBox: {
    backgroundColor: C.cardSunken,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    gap: 4,
  },
  activePatternLabel: {
    color: C.textDim,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  activePatternValue: {
    color: C.text,
    fontFamily: "Menlo",
    fontSize: F.subtitle,
    fontWeight: "700",
  },
  patternsHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  patternsTitle: {
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
    flex: 1,
    textTransform: "uppercase",
  },
  refreshBtn: {
    backgroundColor: C.cardSunken,
    borderColor: C.pattern,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.pill,
  },
  refreshBtnText: {
    color: C.pattern,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  snapshotFreshness: {
    color: C.textDim,
    fontSize: F.micro,
    fontStyle: "italic",
    marginTop: S.xs,
    marginBottom: S.xs,
    letterSpacing: 1,
  },
  patternsHint: {
    color: C.textDim,
    fontSize: F.small,
    fontStyle: "italic",
    marginTop: S.sm,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    marginTop: 4,
  },
  progressText: {
    color: C.pattern,
    fontSize: F.small,
    fontFamily: "Menlo",
  },
  // Reusable LOADING row for sub-cards that fetch from the bridge
  // (PlaylistSwitcher / pattern picker). Pairs an inline spinner with
  // the existing patternsHint copy so the operator can tell at a
  // glance that PortWatch is intentionally waiting on the wire and
  // not stuck on a stale empty state.
  cardLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    marginTop: S.sm,
  },
  // Reusable FAILED + RETRY box. Lit only when auto-hydrate aborts
  // and there's no previous catalog to fall back on. The visual
  // weight (red border / red title) is intentionally heavier than
  // the LOADING row — a failed first hydration on a fresh BLE pair
  // means the operator probably can't drive the deck without a
  // manual intervention, and we want them to notice.
  cardErrorBox: {
    marginTop: S.sm,
    backgroundColor: C.cardSunken,
    borderColor: C.blackout,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    gap: 4,
    alignItems: "flex-start",
  },
  cardErrorTitle: {
    color: C.blackout,
    fontSize: F.small,
    fontWeight: "900",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  cardErrorSub: {
    color: C.textDim,
    fontSize: F.micro,
    fontFamily: "Menlo",
  },
  cardErrorRetryBtn: {
    marginTop: 4,
    backgroundColor: C.cardSunken,
    borderColor: C.blackout,
    borderWidth: 1,
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
  },
  cardErrorRetryText: {
    color: C.blackout,
    fontSize: F.micro,
    fontWeight: "800",
    letterSpacing: 2,
  },
  patternListBox: {
    backgroundColor: C.cardSunken,
    borderRadius: R.pill,
    padding: 4,
    marginTop: S.sm,
  },
  patternListContent: {
    gap: 4,
    padding: 4,
  },
  patternRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    backgroundColor: C.card,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.md,
    paddingVertical: S.sm + 2,
    minHeight: 52,
  },
  patternName: {
    fontSize: F.body,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  patternRaw: {
    color: C.textMuted,
    fontFamily: "Menlo",
    fontSize: F.micro,
    marginTop: 2,
  },
  patternActiveBadge: {
    color: C.pattern,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: C.pattern + "22",
    borderWidth: 1,
    borderColor: C.pattern + "55",
  },
  // Playlist switcher chips. Renders as a wrapping row of pills, not
  // a vertical list — most installations have ≤ 6 named playlists,
  // so the wrap behaviour reads naturally without needing a
  // dedicated scroller.
  playlistRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: S.sm,
    paddingTop: S.xs,
  },
  playlistChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    backgroundColor: C.card,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    minHeight: 36,
  },
  playlistChipLabel: {
    fontSize: F.small,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  playlistChipBadge: {
    color: C.pattern,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: C.pattern + "22",
    borderWidth: 1,
    borderColor: C.pattern + "55",
  },
  disabledNote: {
    color: C.textMuted,
    fontSize: F.small,
    fontStyle: "italic",
    lineHeight: 18,
  },
});
