// Tiny pub/sub for engine WebSocket messages.
//
// Why this exists:
//   The deck and mixer tabs each own their own WS connection. Components
//   nested below them (PlaylistPanel, future playlist sidebar, …) need to
//   react to engine broadcasts (`mixer`, `playlistLibrary`,
//   `playlistEntryCaptured`, …) without taking over the socket's onmessage
//   handler. A module-level event bus lets the screen forward every parsed
//   message here, and any number of subscribers can listen for whatever
//   they care about.
//
// Why not Context: Context would require restructuring routes/_layout.tsx
// to wrap both tabs. A module bus has the same call-site ergonomics
// (`engineEvents.subscribe(msg => …)`) with one fewer abstraction.

export type EngineMessage = {
  type: string;
  [key: string]: unknown;
};

type Listener = (msg: EngineMessage) => void;

const listeners: Set<Listener> = new Set();

export const engineEvents = {
  /** Called by the deck / mixer tab whenever the WS receives a message. */
  emit(msg: EngineMessage) {
    listeners.forEach((l) => {
      try {
        l(msg);
      } catch {
        // A buggy listener must never break the WS pipeline.
      }
    });
  },
  /** Returns an unsubscribe function. */
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
