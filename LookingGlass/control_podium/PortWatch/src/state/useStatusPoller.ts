// useStatusPoller — primary engine-status sync path.
// ============================================================
//
// Why this exists
// ---------------
// The bridge already broadcasts `compact_status` PUBs to PortWatch
// (event-driven via the WS subscriber + a periodic fallback). On a
// reliable network that's enough. In the field over LoRa it isn't:
//
//   * BLE notifications can be dropped silently by iOS under load
//     (no error surfaces to the app — the notification just never
//     fires).
//   * The half-duplex LoRa radio can drop a PUB during a busy moment
//     (operator hammering pattern picks, CaptainPad streaming
//     param updates, the engine WS firehose).
//   * A single missed PUB leaves PortWatch's `engineStatus` stale
//     until the next event, which can be tens of seconds away if
//     the engine is quiet.
//
// The symptom the operator sees is: "I changed something on
// CaptainPad and PortWatch doesn't update." We solve this with a
// SECOND, INDEPENDENT sync path: PortWatch unicasts
// `qry engine/status` on a fixed cadence (default 5 s). Each REP
// re-builds `engineStatus` end-to-end. Even if every PUB in a 4 s
// window dropped, the next poll closes the gap.
//
// Design notes
// ------------
// * **Single in-flight at a time.** If the previous poll is still
//   awaiting a REP (LoRa congested), the next tick is skipped — no
//   stacking. We never have two outstanding `qry engine/status`
//   requests on the wire.
// * **Best-effort, no errors surfaced.** Failures just mean the
//   next tick is 5 s away. We don't toast or vibrate — polling is
//   background plumbing, not a user-visible feature.
// * **Reply routing is reused.** REP frames whose KV body contains
//   `pat/` or `dn/` already flow through `App.tsx::onWireEvent` →
//   `setEngineStatus`. compact_status always has `pat/`, so no
//   special routing here.
// * **Paused while disconnected.** No interval timer when the BLE
//   link isn't connected — saves battery and avoids a flood of
//   timeouts when the operator walks out of range.
// * **Reset on (re)connect.** Bumping `connectGeneration` tears
//   the old timer down and starts a fresh one so the very first
//   poll after a (re)connect lands ~immediately rather than waiting
//   up to `intervalMs` for the existing interval to tick.

import { useEffect } from "react";
import { TitanicLink } from "../link/titanicLink";
import { buildStatusQuery } from "../frame/ops";

export interface UseStatusPollerOpts {
  /** ms between polls. 0 disables the timer (testing only). */
  intervalMs: number;
  /** per-poll timeout passed to `link.sendOp`. */
  timeoutMs: number;
  /**
   * `connectGeneration` from the store. Bumps on every successful
   * BLE pair; we restart the interval whenever this changes so the
   * very first poll after a (re)connect lands ~immediately rather
   * than waiting up to `intervalMs` for the existing interval to
   * tick.
   */
  connectGeneration: number;
  /** True iff the BLE link is currently usable. */
  isConnected: boolean;
}

/**
 * Pure (no React) factory for the polling loop. Returns
 * `{ start, stop }` so this same loop can be exercised in a vitest
 * without a JSDOM / RNTL harness. The React hook is a thin shell
 * that delegates to this.
 */
export interface PollerController {
  start: () => void;
  stop: () => void;
  /** Visible to tests; current "is a poll still on the wire?" guard. */
  isInFlight: () => boolean;
}

export function createStatusPoller(
  link: Pick<TitanicLink, "sendOp"> | null,
  opts: { intervalMs: number; timeoutMs: number },
): PollerController {
  let inFlight = false;
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const poll = async (): Promise<void> => {
    if (inFlight || cancelled || !link) return;
    inFlight = true;
    try {
      await link.sendOp(buildStatusQuery(), { timeoutMs: opts.timeoutMs });
      // REP routing is handled by App.tsx::onWireEvent →
      // setEngineStatus. Nothing to do here on success.
    } catch {
      // Swallow: a timeout / send failure just means the next
      // tick will try again. Polling is the "eventual" half of
      // eventual consistency — single failures are expected.
    } finally {
      inFlight = false;
    }
  };

  return {
    start: () => {
      if (cancelled || intervalId !== null) return;
      // Fire the FIRST poll immediately on start. Without this,
      // the operator would have to wait `intervalMs` after BLE
      // pair before the supplemental sync kicked in.
      void poll();
      if (opts.intervalMs > 0) {
        intervalId = setInterval(() => {
          void poll();
        }, opts.intervalMs);
      }
    },
    stop: () => {
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    isInFlight: () => inFlight,
  };
}

export function useStatusPoller(
  link: TitanicLink | null,
  opts: UseStatusPollerOpts,
): void {
  const { intervalMs, timeoutMs, connectGeneration, isConnected } = opts;

  useEffect(() => {
    if (!link || !isConnected || intervalMs <= 0) return;
    const controller = createStatusPoller(link, { intervalMs, timeoutMs });
    controller.start();
    return () => {
      controller.stop();
    };
    // `connectGeneration` is intentionally a dep so the effect
    // re-runs on every successful pair (tearing the old timer
    // down, starting a fresh one with a fresh first-poll).
  }, [link, isConnected, intervalMs, timeoutMs, connectGeneration]);
}
