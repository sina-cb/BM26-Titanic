// deck_window_requests — a module-level pub/sub so a surface OUTSIDE the deck
// screen (docs/61 §4.4's app-wide COLOR chip, W4) can ask the deck workspace
// to restore a window, without either side importing the other.
//
// WHY A BROKER, NOT A PROP. The chip lives in the shared header and renders on
// every tab; the window it wants to restore is owned by the deck screen's
// workspace state. Threading that through navigation params or a shared
// store would couple two components that otherwise know nothing about each
// other. A tiny pub/sub — the same shape as `utils/op_dialog.ts`'s host
// registration — lets the chip fire a HINT and the deck workspace decide what
// "restore colors" means (it may already be visible, hidden-rail, or the
// window may not even be mounted yet).
//
// A REQUEST IS A HINT, NOT A COMMAND. `requestDeckWindow` never throws and
// never queues: with no subscriber it is a no-op, exactly like a tap on a
// deep link nobody is listening for yet. This module carries zero state
// beyond the current subscriber set — no timers, no persistence (`_217`'s
// no-timer rule extends to every colours-window-adjacent file by house
// style, and there is nothing here worth a clock anyway).
//
// Pure TypeScript, zero React / React Native imports — tested under the
// `utils/*.test.ts` glob (vitest node environment), same as `op_dialog.ts`.

export type DeckWindowRequestId = 'colors' | 'overlays';

type DeckWindowRequestListener = (id: DeckWindowRequestId) => void;

const _listeners = new Set<DeckWindowRequestListener>();

/**
 * Ask the deck workspace to restore/open a window. A no-op when nothing is
 * subscribed — this is a UI hint (the operator can always reach the same
 * window by navigating there manually), not a command that must land.
 */
export function requestDeckWindow(id: DeckWindowRequestId): void {
  for (const fn of _listeners) fn(id);
}

/**
 * Subscribe to window-restore requests. Returns the unsubscribe function.
 * Multiple subscribers are supported and all of them fire, in subscription
 * order, for every request.
 */
export function subscribeDeckWindowRequests(fn: (id: DeckWindowRequestId) => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
