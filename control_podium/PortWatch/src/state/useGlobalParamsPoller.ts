// useGlobalParamsPoller — secondary sync path for global parameters.
// ====================================================================
//
// `useStatusPoller` keeps `engineStatus` (pattern, playlist, target
// channel, view, lock, …) in sync. Global parameters
// (speed / count / size / direction / rotate / palette1 / palette2)
// are a separate snapshot served by the bridge's
// `qry params/snapshot`. Without this poller, a CaptainPad-side
// change to e.g. speed would never surface in PortWatch's
// GlobalParamsCard until the operator hit REFRESH manually.
//
// Same design as useStatusPoller:
//   * Single in-flight at a time (no stacked qrys).
//   * Best-effort (failures swallowed; next tick tries again).
//   * Paused while disconnected.
//   * Restarts on `connectGeneration` bump.
//
// The two pollers run independently; both round-trips fit in a
// single LoRa frame so the total background traffic is ~2 unicasts
// every 5 s = 24 frames/min, well within the link's airtime budget
// and dwarfed by per-card auto-hydrate bursts (pattern/playlist
// paging).

import { useEffect } from "react";
import { TitanicLink } from "../link/titanicLink";
import { buildParamsSnapshotQuery } from "../frame/ops";
import { parseGlobalParamsSnapshot } from "../status/parse";
import { useAppStore } from "./store";

export interface UseGlobalParamsPollerOpts {
  intervalMs: number;
  timeoutMs: number;
  connectGeneration: number;
  isConnected: boolean;
}

export function useGlobalParamsPoller(
  link: TitanicLink | null,
  opts: UseGlobalParamsPollerOpts,
): void {
  const { intervalMs, timeoutMs, connectGeneration, isConnected } = opts;

  useEffect(() => {
    if (!link || !isConnected || intervalMs <= 0) return;

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight || cancelled) return;
      // Skip if a manual REFRESH (or auto-hydrate) is currently
      // running — overlapping qrys would either NAK (rate-limit) or
      // race on `setGlobalParams`, briefly snapping the slider back
      // to a half-fetched value before the manual flow finishes.
      if (useAppStore.getState().globalParamsLoading) return;
      inFlight = true;
      try {
        const res = await link.sendOp(buildParamsSnapshotQuery(), {
          timeoutMs,
        });
        if (cancelled) return;
        if (res.timedOut || !res.reply || res.reply.typ === "nak") {
          return;
        }
        const parsed = parseGlobalParamsSnapshot(res.reply.arg, Date.now());
        if (parsed) {
          useAppStore.getState().setGlobalParams(parsed);
        }
      } catch {
        // Best-effort polling: silently retry next tick.
      } finally {
        inFlight = false;
      }
    };

    // First poll fires immediately so a fresh BLE pair shows
    // current params within ~1 s, not after the first 5 s tick.
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
