// Engine WebSocket singleton bus factory.
//
// One singleton bus per WS topic (control / params / viz). Each owns
// ONE WebSocket connection to the engine for the lifetime of the
// app. Tabs and components subscribe to whichever bus they need
// instead of opening their own raw sockets — the cost of JSON.parse
// is paid once per topic per app, regardless of how many tabs are
// listening.
//
// Why singletons:
//   Pre-May-2026 the iPad opened a separate WS per tab (mixer, deck,
//   audio, monitor) AND another from the RigContextBridge provider.
//   Every connection received the full firehose (mixer + vis + params
//   + …) and parsed each base64 vis frame independently. During a
//   burst channel add, the main thread queued so many parses that
//   control events (`channelPlaylistData`, `playlistLibrary`) couldn't
//   land in time and operators saw "no playlists yet" on the 3rd
//   added channel.
//
//   The fix has two parts: split outbound by topic on the engine
//   (lib/api_server.js), and split inbound by topic on the iPad
//   (these singletons + the new tabs that subscribe instead of
//   opening their own socket).
//
// Reconnect / lifecycle:
//   - Lazy connect on first subscribe or first send.
//   - Exponential backoff (250 ms → 5 s) on close / error.
//   - Reconnect on AppState 'active' if currently disconnected.
//   - Outbound queue (cap 64) buffers sends while connecting so a tap
//     immediately after app foreground doesn't drop.
//   - `reconnect(newBase?)` forces a clean re-open after the API base
//     detector finds a different engine IP.

import { AppState, Platform } from 'react-native';
// From the dependency-free apiBase.ts, NOT api.ts — api.ts imports
// engineEvents (cache-prime listener), so importing it from here was
// the require cycle api → engineEvents → engineBus → api.
import { getApiBaseAsync } from './apiBase';

export type EngineMessage = {
  type: string;
  [key: string]: unknown;
};

type Listener = (msg: EngineMessage) => void;

export interface BusStatus {
  connected: boolean;
  lastError?: string;
}

type StatusListener = (s: BusStatus) => void;

export interface EngineBus {
  /** Returns an unsubscribe function. Calls connect() lazily on first subscribe. */
  subscribe: (l: Listener) => () => void;
  /** Status push (connected / error). Listener is called immediately with the current status. */
  subscribeStatus: (l: StatusListener) => () => void;
  /** Read-only snapshot of current status. */
  getStatus: () => BusStatus;
  /** Send a JSON-serialisable message. Queued (cap 64) if not yet open. */
  send: (obj: unknown) => boolean;
  /** Force reconnect (e.g. after API base discovery rediscovers a new IP). */
  reconnect: () => void;
}

export function createBus(pathSegment: string): EngineBus {
  let ws: WebSocket | null = null;
  let alive = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 250;
  const MAX_BACKOFF_MS = 5_000;
  const MAX_QUEUE = 64;
  let outboundQueue: string[] = [];
  const listeners: Set<Listener> = new Set();
  const statusListeners: Set<StatusListener> = new Set();
  let status: BusStatus = { connected: false };

  function notifyStatus() {
    statusListeners.forEach((l) => {
      try { l(status); } catch { /* a buggy listener must never break the bus */ }
    });
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    if (!alive) return;
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(connect, wait);
  }

  // Detach handlers from a (probably about-to-close) socket so its
  // late-firing onclose can't kick the bus into a reconnect storm. We
  // do this whenever we deliberately replace `ws` (connect/reconnect),
  // because keeping the handler attached would race the new socket's
  // onopen with the old socket's reconnect-on-close path.
  function detachAndClose(socket: WebSocket | null) {
    if (!socket) return;
    try {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
    } catch { /* ignore */ }
    try { socket.close(); } catch { /* ignore */ }
  }

  function connect() {
    clearReconnectTimer();
    if (!alive) return;
    // If there's already a live or in-flight socket, don't open a
    // second one. The existing socket's onclose handler will trigger
    // a reconnect if it really dies.
    if (ws && (ws.readyState === 0 /* CONNECTING */ || ws.readyState === 1 /* OPEN */)) {
      return;
    }
    getApiBaseAsync()
      .then((base) => {
        if (!alive) return;
        const wsUrl = base.replace(/^http/, 'ws') + pathSegment;
        // Belt-and-braces: detach any stale predecessor before we
        // allocate. Without the detach, the about-to-close socket's
        // onclose would race the new socket's onopen and storm.
        detachAndClose(ws);
        try {
          ws = new WebSocket(wsUrl);
        } catch {
          scheduleReconnect();
          return;
        }
        ws.onopen = () => {
          backoffMs = 250;
          status = { connected: true };
          notifyStatus();
          const drained = outboundQueue;
          outboundQueue = [];
          for (const m of drained) {
            try { ws!.send(m); } catch { /* ignore */ }
          }
        };
        ws.onclose = () => {
          status = { connected: false };
          notifyStatus();
          scheduleReconnect();
        };
        ws.onerror = (e: WebSocketMessageEvent | Event) => {
          status = {
            connected: false,
            lastError: (e && (e as { message?: string }).message) || 'ws error',
          };
          notifyStatus();
          // onclose follows naturally and triggers scheduleReconnect.
        };
        ws.onmessage = (e: WebSocketMessageEvent) => {
          let m: EngineMessage | null = null;
          try {
            m = JSON.parse(typeof e.data === 'string' ? e.data : '');
          } catch {
            return;
          }
          if (!m) return;
          listeners.forEach((l) => {
            try { l(m as EngineMessage); } catch { /* swallow */ }
          });
        };
      })
      .catch(() => scheduleReconnect());
  }

  function ensureConnected() {
    if (!ws && !reconnectTimer) connect();
  }

  function send(obj: unknown): boolean {
    let str: string;
    try { str = JSON.stringify(obj); } catch { return false; }
    if (ws && ws.readyState === 1 /* OPEN */) {
      try { ws.send(str); return true; } catch { return false; }
    }
    if (outboundQueue.length < MAX_QUEUE) outboundQueue.push(str);
    ensureConnected();
    return false;
  }

  // Reconnect on app foreground. Some sockets can survive a long
  // background and reappear OK; many die silently. Forcing a re-open
  // on resume is the simplest way to guarantee a fresh stream.
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (!ws || ws.readyState >= 2 /* CLOSING|CLOSED */) {
          backoffMs = 250;
          connect();
        }
      }
    });
  }

  return {
    subscribe(l) {
      ensureConnected();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeStatus(l) {
      try { l(status); } catch { /* ignore */ }
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    getStatus() {
      return status;
    },
    send,
    reconnect() {
      backoffMs = 250;
      // Detach handlers first so the old socket's onclose can't
      // schedule a competing reconnect after we already started one.
      detachAndClose(ws);
      ws = null;
      status = { connected: false };
      notifyStatus();
      connect();
    },
  };
}
