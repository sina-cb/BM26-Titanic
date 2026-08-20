/**
 * deck_swap_watchdog — PURE delay derivation for the deck tab's lost-
 * `deckSwapComplete` watchdog. No React / react-native imports so vitest can
 * pin it in plain Node (same posture as deck_tx_logic.ts, utils/midi/*).
 *
 * Why a watchdog exists (report 20260725_14, root cause 1): while the deck
 * tab's `deckSwapInFlight` is true, PlaylistPanel renders the whole entry
 * list at opacity 0.55 and disables every row — taps are swallowed
 * client-side with zero POSTs. The flag is set by `deckSwapStarted` and
 * cleared ONLY by `deckSwapComplete`. Anything that eats the completion
 * event (engine-side swap cancellation — now fixed at the source via
 * PatternMixer.onDeckSwapCancelled — or a plain WS blip between the two
 * events, since deckSwap events are NOT replayed on reconnect) wedged the
 * list dim-and-dead until a tab switch remounted it. The watchdog is the
 * belt to the engine fix's braces: worst case the operator waits out the
 * fade plus the slack below instead of losing the list entirely.
 */

/** Slack added on top of the transition's own duration before we give up. */
export const DECK_SWAP_WATCHDOG_SLACK_MS = 2000;

/**
 * Fallback fade length when the broadcast carries no usable `durationMs`.
 * Deliberately generous: arming too SHORT would clear the in-flight lock
 * while a real fade is still running, re-enabling taps the engine would
 * then 409. Late is safe; early is a regression.
 */
export const DECK_SWAP_WATCHDOG_FALLBACK_DURATION_MS = 5000;

/**
 * How long after `deckSwapStarted` to force-clear `deckSwapInFlight` if no
 * `deckSwapComplete` ever arrives.
 *
 * @param durationMs the broadcast's own `durationMs` (api_server.js emits it
 *   on every `deckSwapStarted`); anything not a finite, non-negative number
 *   falls back to DECK_SWAP_WATCHDOG_FALLBACK_DURATION_MS.
 */
export function deckSwapWatchdogDelayMs(durationMs: unknown): number {
  const usable =
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs
      : DECK_SWAP_WATCHDOG_FALLBACK_DURATION_MS;
  return usable + DECK_SWAP_WATCHDOG_SLACK_MS;
}

/**
 * Should this `deckSwapComplete` release the in-flight lock?
 *
 * The deck tab used to clear `deckSwapInFlight` on ANY complete, ignoring
 * `transitionId` (report 20260725_16 note 2). That is correct TODAY only
 * because (a) `cancelDeckPatternSwap()` broadcasts synchronously so a
 * cancelled-complete for swap A can never overtake a later `deckSwapStarted`
 * for swap B on the same ordered socket, and (b) the engine 409s
 * swap-over-swap. Relax either — defer a cancel to a render tick, queue
 * swaps instead of refusing them — and a stale complete for A would unlock a
 * live B, re-enabling rows mid-fade. Matching the id makes that structurally
 * impossible instead of incidentally safe.
 *
 * Both permissive cases MUST still heal, or this hardening trades one wedge
 * for another:
 *   - no id stored (the client missed `deckSwapStarted` — mounted mid-fade,
 *     or a WS blip ate it) → any complete releases;
 *   - the complete carries no usable id (older engine, or a broadcast path
 *     that omits it) → it releases.
 * Only a complete whose id is present AND differs from the stored one is
 * ignored — and the watchdog remains the backstop for that case.
 *
 * @param storedId  transitionId captured from the last `deckSwapStarted`
 *                  (null when none was seen)
 * @param completeId the incoming `deckSwapComplete`'s `transitionId`
 */
export function deckSwapCompleteReleasesLock(
  storedId: string | null,
  completeId: unknown
): boolean {
  if (!storedId) return true;
  if (typeof completeId !== 'string' || completeId === '') return true;
  return completeId === storedId;
}
