/**
 * Pinned tests for the deck-swap watchdog delay derivation.
 *
 * Operator bug (report 20260725_14): "it sometimes shows not-super-bright
 * names" — the deck playlist stayed at opacity 0.55 with every row disabled
 * and every tap swallowed (0 POSTs) after an engine-side swap cancellation
 * ate the `deckSwapComplete` event. The engine now broadcasts a cancelled
 * complete; this watchdog is the second line of defence for the cases the
 * engine can't cover (WS drop between started and complete — deckSwap events
 * are not replayed on reconnect).
 */
import { describe, expect, it } from 'vitest';

import {
  DECK_SWAP_WATCHDOG_FALLBACK_DURATION_MS,
  DECK_SWAP_WATCHDOG_SLACK_MS,
  deckSwapCompleteReleasesLock,
  deckSwapWatchdogDelayMs,
} from './deck_swap_watchdog';

describe('deckSwapWatchdogDelayMs', () => {
  it('waits out the broadcast fade duration plus slack', () => {
    // api_server.js puts the real fade length on every deckSwapStarted.
    expect(deckSwapWatchdogDelayMs(1000)).toBe(1000 + DECK_SWAP_WATCHDOG_SLACK_MS);
    expect(deckSwapWatchdogDelayMs(4000)).toBe(4000 + DECK_SWAP_WATCHDOG_SLACK_MS);
  });

  it('never fires before the fade could possibly have landed', () => {
    // Clearing the lock DURING a live fade would re-enable rows whose taps the
    // engine then 409s — worse than the dim. Slack must be strictly positive.
    for (const d of [0, 1, 250, 1000, 8000, 30000]) {
      expect(deckSwapWatchdogDelayMs(d)).toBeGreaterThan(d);
    }
  });

  it('falls back to a generous default when durationMs is absent', () => {
    const expected = DECK_SWAP_WATCHDOG_FALLBACK_DURATION_MS + DECK_SWAP_WATCHDOG_SLACK_MS;
    expect(deckSwapWatchdogDelayMs(undefined)).toBe(expected);
    expect(deckSwapWatchdogDelayMs(null)).toBe(expected);
  });

  it('falls back for junk payload shapes rather than arming a broken timer', () => {
    // A NaN/Infinity delay would make setTimeout fire immediately (NaN → 1 ms),
    // clearing the lock mid-fade; a string would do the same. Both must fall
    // back instead.
    const expected = DECK_SWAP_WATCHDOG_FALLBACK_DURATION_MS + DECK_SWAP_WATCHDOG_SLACK_MS;
    expect(deckSwapWatchdogDelayMs(NaN)).toBe(expected);
    expect(deckSwapWatchdogDelayMs(Infinity)).toBe(expected);
    expect(deckSwapWatchdogDelayMs(-1)).toBe(expected);
    expect(deckSwapWatchdogDelayMs('2000')).toBe(expected);
    expect(deckSwapWatchdogDelayMs({ durationMs: 2000 })).toBe(expected);
  });

  it('always returns a finite positive number setTimeout can use', () => {
    for (const v of [0, 1000, undefined, null, NaN, 'x', {}, [], -5]) {
      const d = deckSwapWatchdogDelayMs(v);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
  });
});

/**
 * Hardening from report 20260725_16 note 2: the deck tab used to clear
 * `deckSwapInFlight` on ANY `deckSwapComplete`. Safe today only because the
 * engine broadcasts cancels synchronously and 409s swap-over-swap — this
 * makes it structurally safe instead.
 */
describe('deckSwapCompleteReleasesLock', () => {
  const A = 'deck_1_1785198475637';
  const B = 'deck_2_1785198490848';

  it('releases when the complete matches the swap we are locked for', () => {
    expect(deckSwapCompleteReleasesLock(A, A)).toBe(true);
  });

  it('ignores a stale complete for a superseded swap', () => {
    // The dangerous interleave: CANCELLED(A) lands after started(B) armed the
    // lock. Clearing here would re-enable rows mid-fade for B.
    expect(deckSwapCompleteReleasesLock(B, A)).toBe(false);
  });

  it('heals a client that missed deckSwapStarted (no id stored)', () => {
    // Mounted mid-fade, or a WS blip ate the started event — deckSwap events
    // are NOT replayed on reconnect. Such a client must still be released by
    // the next complete, or we would trade one wedge for another.
    expect(deckSwapCompleteReleasesLock(null, A)).toBe(true);
    expect(deckSwapCompleteReleasesLock(null, undefined)).toBe(true);
    expect(deckSwapCompleteReleasesLock(null, 42)).toBe(true);
    expect(deckSwapCompleteReleasesLock('', A)).toBe(true);
  });

  it('heals when the complete carries no usable transitionId', () => {
    // An engine/broadcast path that omits the id must never wedge the list.
    for (const junk of [undefined, null, '', 0, 42, {}, [], NaN, true]) {
      expect(deckSwapCompleteReleasesLock(A, junk)).toBe(true);
    }
  });

  it('is exact — no prefix or loose matching between swap ids', () => {
    expect(deckSwapCompleteReleasesLock(A, `${A}x`)).toBe(false);
    expect(deckSwapCompleteReleasesLock(A, A.slice(0, -1))).toBe(false);
    expect(deckSwapCompleteReleasesLock('deck_1_1', 'deck_1_2')).toBe(false);
  });

  it('always returns a boolean', () => {
    for (const stored of [null, '', A]) {
      for (const incoming of [undefined, null, '', A, B, 7, {}]) {
        expect(typeof deckSwapCompleteReleasesLock(stored, incoming)).toBe('boolean');
      }
    }
  });
});
