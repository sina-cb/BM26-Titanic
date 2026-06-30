// useEngineConnection — shared engine boot + WS subscription lifecycle for
// the deck (index.tsx) and mixer (mixer.tsx) screens.
//
// Why this exists:
//   Both screens replicated the same dance, byte for byte:
//     1. getApiBaseAsync() → stash in an apiBaseRef.
//     2. testConnection(base) → drive the CONNECTED / OFFLINE pill.
//     3. Nudge the singleton WS buses to reconnect ONLY if they're down
//        (a forced reconnect on every tab focus tears a live socket
//        apart and flashes "Engine Offline").
//     4. Seed view-specific REST state (deck channel / mixer state / …).
//     5. subscribe() to the control bus, subscribeStatus() for the pill,
//        and subscribe() to the viz bus — then tear all three down.
//     6. Re-run the boot on AppState 'active'.
//   This hook owns steps 1-3, 5 (subscription lifecycle), and 6. Each
//   screen supplies its own REST seeding (`seed`) and its own per-bus
//   message handlers (`onControl`, `onStatus`, `onViz`) so behavior is
//   IDENTICAL to the hand-rolled versions — this is a refactor, not a
//   behavior change.
//
// Codex P0 — NO fallback behaviors: connection failures surface through
// `onStatus` / the returned status exactly as before; this hook neither
// swallows errors nor substitutes default state.

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getApiBaseAsync, testConnection } from '@/utils/api';
import { engineEvents, type EngineMessage, type BusStatus } from '@/utils/engineEvents';
import { engineVizEvents } from '@/utils/engineVizEvents';

export interface UseEngineConnectionOptions {
  /** REST warm-seed for the consuming screen. Receives the resolved API
   *  base and the connection probe result. Called on mount and on every
   *  AppState 'active'. Should no-op (or bail) when `connected` is false,
   *  matching the prior per-screen behavior. */
  seed: (base: string, connected: boolean) => void | Promise<void>;
  /** Control-plane (engineEvents) message handler. */
  onControl: (msg: EngineMessage) => void;
  /** Connection-status handler (drives the CONNECTED / OFFLINE pill). */
  onStatus: (status: BusStatus) => void;
  /** Viz-plane (engineVizEvents) message handler. Optional — the deck
   *  and mixer both use it today, but keeping it optional documents that
   *  the viz subscription is independent of the control subscription. */
  onViz?: (msg: EngineMessage) => void;
}

export interface UseEngineConnectionResult {
  /** Ref holding the most-recently-resolved API base. Mirrors the
   *  apiBaseRef both screens kept locally. */
  apiBaseRef: React.MutableRefObject<string>;
  /** Re-run the full boot (resolve base, probe, nudge buses, seed).
   *  Exposed so a screen can wire it to e.g. a manual refresh button. */
  reconnect: () => Promise<void>;
}

export function useEngineConnection(opts: UseEngineConnectionOptions): UseEngineConnectionResult {
  const apiBaseRef = useRef<string>('');

  // Keep the latest callbacks in a ref so the boot/subscribe effect can
  // depend on a stable identity and never re-subscribe just because the
  // consumer passed fresh inline closures. The consumers DO memoize their
  // handlers today, but routing through a ref makes this hook robust to
  // either style and keeps the WS subscription stable for the screen's
  // lifetime (the pre-refactor screens subscribed exactly once).
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const boot = useCallback(async () => {
    const base = await getApiBaseAsync();
    apiBaseRef.current = base;

    const conn = await testConnection(base);
    optsRef.current.onStatus({ connected: conn.ok, lastError: conn.ok ? undefined : conn.error });

    // Only nudge the singleton buses if they're actually down — a forced
    // reconnect on every focus tears the live socket apart and surfaces
    // as the "Engine Offline" flash. The buses self-heal on AppState
    // 'active' and on socket close, so this is a safety net.
    if (!engineEvents.getStatus().connected) engineEvents.reconnect();
    if (!engineVizEvents.getStatus().connected) engineVizEvents.reconnect();

    await optsRef.current.seed(base, conn.ok);
  }, []);

  useEffect(() => {
    boot();

    const unsubControl = engineEvents.subscribe((msg) => optsRef.current.onControl(msg));
    const unsubStatus = engineEvents.subscribeStatus((s) => optsRef.current.onStatus(s));
    const unsubViz = engineVizEvents.subscribe((msg) => {
      const handler = optsRef.current.onViz;
      if (handler) handler(msg);
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') boot();
    });

    return () => {
      sub.remove();
      unsubControl();
      unsubStatus();
      unsubViz();
    };
  }, [boot]);

  return { apiBaseRef, reconnect: boot };
}
