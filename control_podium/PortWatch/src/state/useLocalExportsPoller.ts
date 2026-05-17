// useLocalExportsPoller — secondary sync path for per-pattern exports.
// ====================================================================
//
// `useStatusPoller` keeps `engineStatus` in sync. `useGlobalParamsPoller`
// keeps the CPC scalars + palettes in sync. Local (per-pattern) exports
// have their own sync needs:
//
//   * On pattern change → `LocalParamsCard` auto-refreshes off
//     `engineStatus.activePattern` (the pattern-change-triggers-refresh
//     path). That covers the common case.
//   * On CaptainPad slider nudge WITHOUT a pattern swap → no event
//     reaches PortWatch via the existing pattern-change trigger.
//     The exports' v0 values silently drift until the operator hits
//     REFRESH on the ParamsCard.
//
// This poller is the safety net for the second case. It periodically
// re-fetches the deck base channel's full exports list (paginated
// the same way `LocalParamsCard.refresh()` does) and routes the
// result through `setLocalExports`. The store's reconciliation
// handles pending optimistic intents — a PortWatch slider drag in
// flight keeps its optimistic value; a stale (resolved) intent
// disagreeing with the poll is dropped so the engine wins.
//
// Design mirrors useStatusPoller / useGlobalParamsPoller:
//   * Single in-flight at a time (no stacked qrys).
//   * Best-effort (failures swallowed; next tick tries again).
//   * Paused while disconnected.
//   * Restarts on `connectGeneration` bump.
//   * Skipped while a manual REFRESH (or pattern-change auto-fetch)
//     is already running — they share the same setter.
//
// Cadence is configurable through `.config.portwatch.yaml::polling.
// local_exports_interval_ms`. Default 10 s (longer than the 5 s
// status/globals pollers because exports paginate, costing N round-
// trips per tick instead of 1). Set the YAML to `0` to disable
// polling entirely and rely on pattern-change + manual REFRESH only.

import { useEffect } from "react";
import { TitanicLink } from "../link/titanicLink";
import { buildExportsPageQuery } from "../frame/ops";
import { parseExportsPage } from "../status/parse";
import type { LocalExport } from "../status/parse";
import { useAppStore } from "./store";
import { exportsCfg as _exportsCfg } from "../config";

// Reuse the same paging caps the manual refresh uses — we don't want
// the poller to chase a runaway engine (max_pages) any further than
// the user-driven path would, and a single per-page timeout shared
// across both callers keeps "what counts as a dropped page?" honest.
const MAX_PAGES = _exportsCfg.max_pages;
const MAX_RETRIES = _exportsCfg.max_page_retries;
const RETRY_BACKOFF_MS = _exportsCfg.retry_backoff_ms;

export interface UseLocalExportsPollerOpts {
  intervalMs: number;
  /** Per-page round-trip timeout (ms). */
  timeoutMs: number;
  connectGeneration: number;
  isConnected: boolean;
}

export function useLocalExportsPoller(
  link: TitanicLink | null,
  opts: UseLocalExportsPollerOpts,
): void {
  const { intervalMs, timeoutMs, connectGeneration, isConnected } = opts;

  useEffect(() => {
    if (!link || !isConnected || intervalMs <= 0) return;

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight || cancelled) return;
      // Skip if a manual REFRESH (or pattern-change auto-fetch) is
      // currently running — they share `setLocalExports`, and a
      // racing poll would briefly snap the slider back to a stale
      // half-fetched value before the manual flow finished.
      if (useAppStore.getState().localExportsLoading) return;
      // Skip when the engine hasn't named an active pattern yet.
      // Without a pattern, the engine's per-pattern exports list
      // is empty by definition and we'd just waste a LoRa frame.
      const status = useAppStore.getState().engineStatus;
      if (!status?.activePattern) return;
      inFlight = true;
      try {
        const collected: LocalExport[] = [];
        let totalPages = 1;
        let aborted = false;

        for (let page = 0; page < MAX_PAGES && !aborted; page++) {
          let pageOk = false;
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (cancelled) return;
            const res = await link.sendOp(buildExportsPageQuery(page), {
              timeoutMs,
            });
            if (cancelled) return;
            if (res.timedOut || !res.reply || res.reply.typ === "nak") {
              // Polling is best-effort; back off and retry once
              // within the per-page budget so a single transient
              // drop doesn't abort the whole sync.
              if (attempt < MAX_RETRIES) {
                await new Promise((r) =>
                  setTimeout(r, RETRY_BACKOFF_MS),
                );
                continue;
              }
              aborted = true;
              break;
            }
            const parsed = parseExportsPage(res.reply.arg);
            if (!parsed) {
              if (attempt < MAX_RETRIES) {
                await new Promise((r) =>
                  setTimeout(r, RETRY_BACKOFF_MS),
                );
                continue;
              }
              aborted = true;
              break;
            }
            for (const e of parsed.exports) collected.push(e);
            totalPages = parsed.totalPages;
            pageOk = true;
            if (parsed.pageIndex >= parsed.totalPages - 1) {
              // All pages done; the outer `for` naturally exits
              // because we set page = MAX_PAGES below.
              page = MAX_PAGES;
            }
            break;
          }
          if (!pageOk) aborted = true;
        }

        if (cancelled) return;
        if (aborted) {
          // Don't write a partial list — that would shrink the
          // visible sliders and confuse the operator. Next tick
          // tries fresh.
          return;
        }
        // Successful tick: route through setLocalExports so its
        // reconcile-against-intent logic gets the chance to drop
        // stale (resolved) intents that disagree with the engine.
        useAppStore.getState().setLocalExports(collected);
        // Intentionally not touching `localExportsLoading` — the
        // poller is invisible to the UI's spinner state. The
        // manual REFRESH path owns that flag.
        // Hint suppressed because totalPages is reported for log
        // parity with the manual refresh but the poller's banner
        // would just churn the lastReply ribbon.
        void totalPages;
      } catch {
        // Best-effort polling: silently retry next tick.
      } finally {
        inFlight = false;
      }
    };

    // First poll fires immediately so reconnects pick up
    // CaptainPad-side slider drift right away, not after the first
    // 10 s tick.
    void poll();

    const id = setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [link, isConnected, intervalMs, timeoutMs, connectGeneration]);
}
